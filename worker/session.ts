import { DurableObject } from 'cloudflare:workers'
import type {
  DeskEvent,
  Message,
  SessionView,
  Source,
  TurnInput,
} from '../shared/contracts'
import { NO_EVIDENCE } from '../shared/contracts'
import { readTurn } from './http/request'
import { plan, write } from './ai/agents'
import { validateDraft } from './citations'
import type { AppEnv } from './env'
import { DeskError, safeError } from './errors'
import { research, resolveLocale } from './research'

const IDLE_TTL = 2 * 60 * 60 * 1000
interface State {
  messages: Message[]
  sources: Source[]
  failedTurn: SessionView['failedTurn']
  touched: number
  requests: number[]
}
const empty = (): State => ({
  messages: [],
  sources: [],
  failedTurn: null,
  touched: Date.now(),
  requests: [],
})

export class NewsSession extends DurableObject<AppEnv> {
  private state: State = empty()
  private active: AbortController | null = null
  private activeTask: Promise<void> | null = null

  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<State>('session')) ?? empty()
      if (Date.now() - this.state.touched >= IDLE_TTL) {
        this.state = empty()
        await ctx.storage.deleteAll()
      }
    })
  }

  private async save(): Promise<void> {
    this.state.touched = Date.now()
    await this.ctx.storage.put('session', this.state)
    await this.ctx.storage.setAlarm(this.state.touched + IDLE_TTL)
  }

  async alarm(): Promise<void> {
    if (!this.active && Date.now() >= this.state.touched + IDLE_TTL) {
      this.state = empty()
      await this.ctx.storage.deleteAll()
    } else await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL)
  }

  private view(): SessionView {
    return {
      messages: this.state.messages,
      failedTurn: this.state.failedTurn,
      busy: !!this.active,
    }
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname
      if (!this.active && Date.now() - this.state.touched >= IDLE_TTL) {
        this.state = empty()
        await this.ctx.storage.deleteAlarm()
        await this.ctx.storage.deleteAll()
      }
      if (request.method === 'GET' && path === '/api/session') {
        await this.save()
        return Response.json(this.view())
      }
      if (request.method === 'POST' && path === '/api/cancel') {
        this.active?.abort(new DOMException('Canceled', 'AbortError'))
        return Response.json({ ok: true })
      }
      if (request.method === 'DELETE' && path === '/api/session') {
        this.active?.abort(
          new DOMException('Conversation cleared', 'AbortError'),
        )
        await this.activeTask
        this.state = empty()
        await this.ctx.storage.deleteAlarm()
        await this.ctx.storage.deleteAll()
        return Response.json(this.view())
      }
      if (request.method !== 'POST' || path !== '/api/turn')
        return Response.json({ error: 'Not found.' }, { status: 404 })
      if (this.active)
        throw new DeskError(
          'A response is already running. Stop it before starting another.',
          409,
        )
      const input = await readTurn(request)
      // Request body reads yield; another request may have started in the meantime.
      if (this.active)
        throw new DeskError(
          'A response is already running. Stop it before starting another.',
          409,
        )
      if (
        this.state.messages.some(
          (message) =>
            message.id === input.id && message.content !== input.question,
        )
      )
        throw new DeskError(
          'A turn ID cannot be reused for a different question.',
        )
      const previous = this.state.messages.find(
        (message) => message.id === `${input.id}:answer`,
      )
      if (previous) {
        return new Response(
          `data: ${JSON.stringify({ type: 'completed', message: previous })}\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      const now = Date.now()
      this.state.requests = this.state.requests.filter(
        (time) => time > now - 60_000,
      )
      if (this.state.requests.length >= 10)
        throw new DeskError(
          'Please wait a minute before sending more requests.',
          429,
        )
      this.state.requests.push(now)
      const controller = new AbortController()
      this.active = controller
      const stream = new ReadableStream<Uint8Array>({
        start: (output) => {
          const send = (event: DeskEvent) => {
            controller.signal.throwIfAborted()
            output.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
            )
          }
          const task = this.runTurn(input, controller, send)
            .catch(() => {})
            .finally(() => {
              if (this.active === controller) this.active = null
              this.activeTask = null
              try {
                output.close()
              } catch {
                /* disconnected client */
              }
            })
          this.activeTask = task
          this.ctx.waitUntil(task)
        },
        cancel: () =>
          controller.abort(
            new DOMException('Client disconnected', 'AbortError'),
          ),
      })
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
        },
      })
    } catch (error) {
      return Response.json(
        { error: safeError(error) },
        { status: error instanceof DeskError ? error.status : 500 },
      )
    }
  }

  private async runTurn(
    input: TurnInput,
    controller: AbortController,
    send: (event: DeskEvent) => void,
  ): Promise<void> {
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(75_000),
    ])
    const history = this.state.messages.filter(
      (message) => message.id !== input.id,
    )
    if (!this.state.messages.some((message) => message.id === input.id)) {
      this.state.messages.push({
        id: input.id,
        role: 'user',
        content: input.question,
        createdAt: new Date().toISOString(),
      })
    }
    this.state.messages = this.state.messages.slice(-30)
    this.state.failedTurn = {
      id: input.id,
      question: input.question,
      error: 'The previous request was interrupted. Please retry.',
    }
    try {
      await this.save()
      send({
        type: 'status',
        stage: 'planning',
        detail: 'Deciding whether fresh reporting is needed',
      })
      const decision = await plan(
        this.env,
        input.question,
        history,
        this.state.sources,
        signal,
      )
      let warnings: string[]
      if (decision.reused) {
        warnings = [
          'Follow-up: reusing previous evidence; no fresh search was performed.',
        ]
      } else {
        this.state.sources = []
        await this.save()
        send({
          type: 'status',
          stage: 'researching',
          detail: `Searching RSS: ${decision.query}`,
        })
        const result = await research(
          decision.query,
          resolveLocale(`${input.question} ${decision.query}`, input.locale),
          input.sourceCount,
          signal,
        )
        this.state.sources = result.sources
        warnings = result.warnings
      }
      signal.throwIfAborted()
      await this.save()
      const sources = [...this.state.sources]
      send({
        type: 'sources',
        sources,
        warnings,
        query: decision.query,
        reused: decision.reused,
      })
      let content = NO_EVIDENCE
      if (sources.length) {
        send({
          type: 'status',
          stage: 'writing',
          detail: 'Writing a concise, source-grounded report',
        })
        const draft = await write(
          this.env,
          input.question,
          history,
          sources,
          signal,
          (text) => send({ type: 'draft_delta', text }),
        )
        send({
          type: 'status',
          stage: 'validating',
          detail: 'Checking source IDs and link provenance',
        })
        content = validateDraft(draft, sources)
      }
      signal.throwIfAborted()
      const message: Message = {
        id: `${input.id}:answer`,
        role: 'assistant',
        content,
        sources,
        query: decision.query,
        reused: decision.reused,
        warnings,
        createdAt: new Date().toISOString(),
      }
      this.state.messages.push(message)
      this.state.messages = this.state.messages.slice(-30)
      this.state.failedTurn = null
      await this.save()
      send({ type: 'completed', message })
    } catch (error) {
      const message = safeError(error)
      this.state.failedTurn = {
        id: input.id,
        question: input.question,
        error: message,
      }
      await this.save()
      // Cancellation still emits a terminal failure when the stream remains connected.
      if (!controller.signal.aborted) {
        try {
          send({ type: 'failed', error: message })
        } catch {
          /* client disconnected */
        }
      }
    }
  }
}
