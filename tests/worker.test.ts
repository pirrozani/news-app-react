import { exports, env } from 'cloudflare:workers'
import { describe, expect, it, vi, afterEach } from 'vitest'
import worker from '../worker/index'
import type { AppEnv } from '../worker/env'
import * as agents from '../worker/ai/agents'

afterEach(() => vi.restoreAllMocks())

describe('public API and session protection', () => {
  it('allows remote visitors without sign-in and issues a secure isolated session cookie', async () => {
    const response = await exports.default.fetch(
      'https://public.example/api/session',
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('Secure')
    expect(
      ((await response.json()) as { messages: unknown[] }).messages,
    ).toEqual([])
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })
  it('adds noindex headers to assets, SPA paths, and immutable redirect responses', async () => {
    const asset = vi.fn().mockImplementation(
      async () =>
        new Response('asset body', {
          headers: {
            'Cache-Control': 'public, max-age=3600',
            ETag: '"asset-v1"',
          },
        }),
    )
    const config = { ...env, ASSETS: { fetch: asset } } as unknown as AppEnv
    for (const path of [
      '/',
      '/index.html',
      '/research/topic',
      '/assets/app.js',
    ]) {
      const response = await worker.fetch(
        new Request<unknown, IncomingRequestCfProperties>(
          `https://public.example${path}`,
        ),
        config,
      )
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
      expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
      expect(response.headers.get('etag')).toBe('"asset-v1"')
      expect(await response.text()).toBe('asset body')
    }
    asset.mockResolvedValueOnce(
      Response.redirect('https://public.example/canonical', 302),
    )
    const redirected = await worker.fetch(
      new Request<unknown, IncomingRequestCfProperties>(
        'https://public.example/redirect',
      ),
      config,
    )
    expect(redirected.status).toBe(302)
    expect(redirected.headers.get('location')).toBe(
      'https://public.example/canonical',
    )
    expect(redirected.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })
  it('dashboard shutdown blocks both pages and API calls before any inference', async () => {
    const infer = vi.fn()
    const asset = vi.fn()
    const closed = {
      ...env,
      APP_ENABLED: 'false',
      AI: { run: infer },
      ASSETS: { fetch: asset },
    } as unknown as AppEnv
    const page = await worker.fetch(
      new Request<unknown, IncomingRequestCfProperties>(
        'https://public.example/',
      ),
      closed,
    )
    expect(page.status).toBe(503)
    const html = await page.text()
    expect(html).toContain('temporarily closed')
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(page.headers.get('cache-control')).toBe('no-store')
    const api = await worker.fetch(
      new Request<unknown, IncomingRequestCfProperties>(
        'https://public.example/api/turn',
        { method: 'POST' },
      ),
      closed,
    )
    expect(api.status).toBe(503)
    expect(api.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(await api.json()).toEqual({
      error: 'The news desk is temporarily closed. Please check back later.',
    })
    expect(infer).not.toHaveBeenCalled()
    expect(asset).not.toHaveBeenCalled()
    const reopened = await worker.fetch(
      new Request<unknown, IncomingRequestCfProperties>(
        'https://public.example/api/session',
      ),
      { ...env, APP_ENABLED: 'true' } as AppEnv,
    )
    expect(reopened.status).toBe(200)
  })
  it('rate-limits public questions by connection even when cookies change', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false })
    const config = { ...env, TURN_RATE_LIMITER: { limit } } as unknown as AppEnv
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await worker.fetch(
        new Request<unknown, IncomingRequestCfProperties>(
          'https://public.example/api/turn',
          {
            method: 'POST',
            headers: {
              Origin: 'https://public.example',
              'Content-Type': 'application/json',
              'CF-Connecting-IP': '203.0.113.7',
              Cookie: `news_session=${crypto.randomUUID()}`,
            },
            body: '{}',
          },
        ),
        config,
      )
      expect(response.status).toBe(429)
      expect(response.headers.get('retry-after')).toBe('60')
    }
    expect(limit.mock.calls.map((call) => call[0].key)).toEqual([
      'turn:203.0.113.7',
      'turn:203.0.113.7',
    ])
  })
  it('does not run public inference when connection protection is unavailable', async () => {
    const response = await worker.fetch(
      new Request<unknown, IncomingRequestCfProperties>(
        'https://public.example/api/turn',
        {
          method: 'POST',
          headers: {
            Origin: 'https://public.example',
            'Content-Type': 'application/json',
          },
          body: '{}',
        },
      ),
      env as unknown as AppEnv,
    )
    expect(response.status).toBe(503)
  })
  it('creates isolated browser sessions and rejects cross-origin writes', async () => {
    const response = await exports.default.fetch('http://localhost/api/session')
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(
      ((await response.json()) as { messages: unknown[] }).messages,
    ).toEqual([])
    const other = await exports.default.fetch('http://localhost/api/session')
    expect(other.headers.get('set-cookie')).not.toBe(
      response.headers.get('set-cookie'),
    )
    const denied = await exports.default.fetch('http://localhost/api/session', {
      method: 'DELETE',
      headers: { Origin: 'https://evil.example' },
    })
    expect(denied.status).toBe(403)
  })
  it('returns JSON for unknown API routes rather than SPA HTML', async () => {
    const response = await exports.default.fetch('http://localhost/api/missing')
    expect(response.status).toBe(404)
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(response.headers.get('content-type')).toContain('application/json')
  })
  it('returns no-evidence without model calls and does not duplicate idempotent turns', async () => {
    const initial = await exports.default.fetch('http://localhost/api/session')
    const cookie = initial.headers.get('set-cookie')!.split(';')[0]
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<rss><channel/></rss>', {
        headers: { 'Content-Type': 'application/xml' },
      }),
    )
    const input = {
      id: crypto.randomUUID(),
      question: 'fusion energy news',
      locale: 'auto',
      sourceCount: 3,
    }
    const request = () =>
      new Request<unknown, IncomingRequestCfProperties>(
        'http://localhost/api/turn',
        {
          method: 'POST',
          headers: {
            Origin: 'http://localhost',
            Cookie: cookie,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        },
      )
    const result = await worker.fetch(request(), env as unknown as AppEnv)
    expect(result.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(await result.text()).toContain('completed')
    expect(fetchMock).toHaveBeenCalledTimes(5)
    const replay = await worker.fetch(request(), env as unknown as AppEnv)
    expect(await replay.text()).toContain('completed')
    expect(fetchMock).toHaveBeenCalledTimes(5)
    const session = await exports.default.fetch(
      'http://localhost/api/session',
      { headers: { Cookie: cookie } },
    )
    const state = (await session.json()) as { messages: { role: string }[] }
    expect(state.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ])
    const cleared = await exports.default.fetch(
      'http://localhost/api/session',
      {
        method: 'DELETE',
        headers: { Cookie: cookie, Origin: 'http://localhost' },
      },
    )
    expect(
      ((await cleared.json()) as { messages: unknown[] }).messages,
    ).toHaveLength(0)
  })
})

async function sessionCookie(): Promise<string> {
  const response = await exports.default.fetch('http://localhost/api/session')
  return response.headers.get('set-cookie')!.split(';')[0]
}
const headers = (cookie: string) => ({
  Origin: 'http://localhost',
  Cookie: cookie,
  'Content-Type': 'application/json',
})
const turn = (cookie: string, question: string, id = crypto.randomUUID()) =>
  worker.fetch(
    new Request<unknown, IncomingRequestCfProperties>(
      'http://localhost/api/turn',
      {
        method: 'POST',
        headers: headers(cookie),
        body: JSON.stringify({ id, question, locale: 'auto', sourceCount: 3 }),
      },
    ),
    env as unknown as AppEnv,
  )
const feed = () =>
  new Response(
    '<rss><channel><item><title>Fusion project milestone - Science Daily</title><source>Science Daily</source><link>https://example.com/fusion</link><description>Researchers announced an experimental breakthrough this week. They said additional testing is required before commercial use can begin.</description></item></channel></rss>',
    { headers: { 'Content-Type': 'application/xml' } },
  )
const readSession = async (cookie: string) =>
  (
    await exports.default.fetch('http://localhost/api/session', {
      headers: { Cookie: cookie },
    })
  ).json() as Promise<import('../shared/contracts').SessionView>

describe('session correctness with mocked model and RSS', () => {
  it('saves provider-completed answers without a marker but still rejects invalid citations', async () => {
    const cookie = await sessionCookie()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => feed())
    let content = 'Researchers reported a breakthrough [S1].'
    const run = vi.fn().mockImplementation(
      async () =>
        new ReadableStream<Uint8Array>({
          start(output) {
            const frames = [
              {
                choices: [{ delta: { content }, finish_reason: null }],
                usage: { completion_tokens: 1 },
              },
              {
                choices: [{ delta: {}, finish_reason: 'stop' }],
                usage: { completion_tokens: 1 },
              },
            ]
            output.enqueue(
              new TextEncoder().encode(
                frames
                  .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
                  .join('') + 'data: [DONE]\n\n',
              ),
            )
            output.close()
          },
        }),
    )
    const realWrite = agents.write
    vi.spyOn(agents, 'write').mockImplementation(
      (bindings, question, history, sources, signal, delta) =>
        realWrite(
          { ...bindings, AI: { run } as unknown as Ai },
          question,
          history,
          sources,
          signal,
          delta,
        ),
    )
    const result = await (await turn(cookie, 'Latest fusion news')).text()
    expect(result).toContain('"type":"completed"')
    expect(result).not.toContain('"type":"failed"')
    let state = await readSession(cookie)
    expect(state.messages.at(-1)?.content).toBe(content)
    expect(state.failedTurn).toBeNull()
    expect(run).toHaveBeenCalledOnce()

    content = 'An unsupported claim [S99].'
    expect(await (await turn(cookie, 'Latest fusion news')).text()).toContain(
      '"type":"failed"',
    )
    state = await readSession(cookie)
    expect(
      state.messages.filter((message) => message.role === 'assistant'),
    ).toHaveLength(1)
    expect(state.failedTurn?.error).toContain('unknown source')
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('retains answer snapshots, reuses evidence for rewrites, and clears stale context before a failed new search', async () => {
    const cookie = await sessionCookie()
    const search = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => feed())
    const writer = vi
      .spyOn(agents, 'write')
      .mockResolvedValue('Researchers reported a breakthrough [S1].')
    expect(await (await turn(cookie, 'Latest fusion news')).text()).toContain(
      'completed',
    )
    expect(
      await (await turn(cookie, 'Summarize those reports')).text(),
    ).toContain('"reused":true')
    expect(search).toHaveBeenCalledOnce()
    search.mockResolvedValue(
      new Response('<rss><channel/></rss>', {
        headers: { 'Content-Type': 'application/xml' },
      }),
    )
    const failedResearch = await (
      await turn(cookie, 'Latest climate news')
    ).text()
    expect(failedResearch).toContain('couldn’t retrieve enough')
    expect(failedResearch).toContain('"sources":[]')
    const state = await readSession(cookie)
    const answers = state.messages.filter(
      (message) => message.role === 'assistant',
    )
    expect(answers[0].sources).toHaveLength(1)
    expect(answers[1].sources).toHaveLength(1)
    expect(answers[2].sources).toHaveLength(0)
    expect(writer).toHaveBeenCalledTimes(2)
    expect((await readSession(await sessionCookie())).messages).toHaveLength(0)
  })

  it('rejects invalid citations, then retries without duplicating the user question', async () => {
    const cookie = await sessionCookie()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => feed())
    const writer = vi
      .spyOn(agents, 'write')
      .mockResolvedValueOnce('An unsupported claim [S99].')
      .mockResolvedValue('A supported claim [S1].')
    const id = crypto.randomUUID()
    expect(
      await (await turn(cookie, 'Latest fusion news', id)).text(),
    ).toContain('"type":"failed"')
    let state = await readSession(cookie)
    expect(state.messages).toHaveLength(1)
    expect(state.failedTurn?.id).toBe(id)
    expect(
      await (await turn(cookie, 'Latest fusion news', id)).text(),
    ).toContain('"type":"completed"')
    state = await readSession(cookie)
    expect(state.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ])
    expect(state.failedTurn).toBeNull()
    expect(writer).toHaveBeenCalledTimes(2)
    const collision = await turn(cookie, 'Different question', id)
    expect(collision.status).toBe(400)
  })

  it('rejects overlapping turns and Clear cancels work without saving its draft', async () => {
    const cookie = await sessionCookie()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => feed())
    let started: () => void = () => {}
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    vi.spyOn(agents, 'write').mockImplementation(
      async (_env, _question, _history, _sources, signal, delta) => {
        delta('An unfinished draft')
        started()
        return new Promise<string>((_, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Canceled', 'AbortError')),
            { once: true },
          ),
        )
      },
    )
    const response = await turn(cookie, 'Latest fusion news')
    const output = response.text()
    await ready
    expect((await turn(cookie, 'Latest climate news')).status).toBe(409)
    const cleared = await exports.default.fetch(
      'http://localhost/api/session',
      { method: 'DELETE', headers: headers(cookie) },
    )
    expect(cleared.status).toBe(200)
    expect(await output).not.toContain('"type":"completed"')
    expect((await readSession(cookie)).messages).toHaveLength(0)
  })

  it('bounds streamed request bodies even without a Content-Length header', async () => {
    const cookie = await sessionCookie()
    const response = await worker.fetch(
      new Request<unknown, IncomingRequestCfProperties>(
        'http://localhost/api/turn',
        {
          method: 'POST',
          headers: headers(cookie),
          body: new ReadableStream({
            start(output) {
              output.enqueue(new TextEncoder().encode('x'.repeat(21_000)))
              output.close()
            },
          }),
        },
      ),
      env as unknown as AppEnv,
    )
    expect(response.status).toBe(413)
    expect((await readSession(cookie)).messages).toHaveLength(0)
  })
})
