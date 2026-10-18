import { useEffect, useRef, useState } from 'react'
import type {
  DeskEvent,
  Locale,
  SessionView,
  Source,
  Stage,
} from '../../shared/contracts'
import { cancelTurn, clearSession, getSession, streamTurn } from '../lib/api'

export function useNewsSession() {
  const [session, setSession] = useState<SessionView>({
    messages: [],
    failedTurn: null,
    busy: false,
  })
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [running, setRunning] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [stage, setStage] = useState<Stage>('planning')
  const [detail, setDetail] = useState('')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [selectedMessage, setSelectedMessage] = useState<string | null>(null)
  const [selectedSource, setSelectedSource] = useState<string | null>(null)
  const [pendingSources, setPendingSources] = useState<Source[]>([])
  const abort = useRef<AbortController | null>(null)
  const locked = useRef(false)
  const revision = useRef(0)
  const initialSession = useRef<Promise<SessionView> | null>(null)
  const busy = running || session.busy

  function selectLatest(value: SessionView) {
    const latest = value.messages.findLast(
      (message) => message.role === 'assistant',
    )
    setSelectedMessage(latest?.id ?? null)
    setSelectedSource(latest?.sources?.[0]?.id ?? null)
  }

  useEffect(() => {
    let alive = true
    // Strict Mode replays setup/cleanup in development. Reuse the initial read
    // instead of aborting a session-creating request and issuing another one.
    const request = (initialSession.current ??= getSession())
    request
      .then((value) => {
        if (!alive) return
        setSession(value)
        setConnected(true)
        selectLatest(value)
      })
      .catch((reason) => {
        if (alive)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Could not load the conversation.',
          )
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
      abort.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!session.busy || running || clearing) return
    const controller = new AbortController()
    const version = revision.current
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const value = await getSession(controller.signal)
        if (controller.signal.aborted || revision.current !== version) return
        setSession(value)
        if (!value.busy) selectLatest(value)
      } catch {
        /* retain the current session during transient network failures */
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 1500)
    }
    timer = setTimeout(poll, 1500)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [session.busy, running, clearing])

  async function submit(
    text: string,
    locale: Locale,
    sourceCount: number,
    retryId?: string,
    onStart?: () => void,
  ) {
    if (!text.trim() || busy || clearing || locked.current || !connected) return
    locked.current = true
    revision.current++
    const id = retryId ?? crypto.randomUUID()
    const controller = new AbortController()
    abort.current = controller
    setRunning(true)
    setError('')
    setDraft('')
    setStage('planning')
    setDetail('Preparing your question')
    setPendingSources([])
    setSelectedMessage(null)
    setSelectedSource(null)
    setSession((previous) => ({
      ...previous,
      failedTurn: null,
      messages: previous.messages.some((message) => message.id === id)
        ? previous.messages
        : [
            ...previous.messages,
            {
              id,
              role: 'user',
              content: text.trim(),
              createdAt: new Date().toISOString(),
            },
          ],
    }))
    onStart?.()
    let failed = ''
    const onEvent = (event: DeskEvent) => {
      switch (event.type) {
        case 'status':
          setStage(event.stage)
          setDetail(event.detail)
          break
        case 'sources':
          setPendingSources(event.sources)
          break
        case 'draft_delta':
          setDraft((previous) => previous + event.text)
          break
        case 'failed':
          failed = event.error
          setError(event.error)
          break
        case 'completed':
          setSession((previous) => ({
            ...previous,
            busy: false,
            failedTurn: null,
            messages: [
              ...previous.messages.filter(
                (message) => message.id !== event.message.id,
              ),
              event.message,
            ],
          }))
          setSelectedMessage(event.message.id)
          setSelectedSource(event.message.sources?.[0]?.id ?? null)
      }
    }
    try {
      await streamTurn(
        { id, question: text.trim(), locale, sourceCount },
        controller.signal,
        onEvent,
      )
    } catch (reason) {
      failed = controller.signal.aborted
        ? 'Response stopped. Your question is saved; you can retry.'
        : reason instanceof Error
          ? reason.message
          : 'The report could not be completed.'
      setError(failed)
    } finally {
      if (failed)
        setSession((previous) => ({
          ...previous,
          failedTurn: { id, question: text.trim(), error: failed },
        }))
      setDraft('')
      setRunning(false)
      abort.current = null
      locked.current = false
    }
  }

  async function stop() {
    try {
      await cancelTurn()
      setSession((previous) => ({ ...previous, busy: true }))
      abort.current?.abort()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not stop the response.',
      )
    }
  }

  async function clear() {
    if (busy || locked.current || clearing) return false
    locked.current = true
    revision.current++
    setClearing(true)
    try {
      setSession(await clearSession())
      setPendingSources([])
      setSelectedMessage(null)
      setSelectedSource(null)
      setError('')
      return true
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not clear the conversation.',
      )
      return false
    } finally {
      setClearing(false)
      locked.current = false
    }
  }

  return {
    session,
    loading,
    connected,
    running,
    clearing,
    busy,
    stage,
    detail,
    draft,
    error,
    selectedMessage,
    setSelectedMessage,
    selectedSource,
    setSelectedSource,
    pendingSources,
    submit,
    stop,
    clear,
  }
}
