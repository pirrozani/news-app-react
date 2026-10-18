import type { DeskEvent, SessionView, TurnInput } from '../../shared/contracts'
import { readSSE } from '../../shared/sse'

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response
  let message = 'The news desk is unavailable. Please try again.'
  try {
    message = ((await response.json()) as { error?: string }).error || message
  } catch {
    /* non-JSON server response */
  }
  throw new Error(message)
}

export async function getSession(signal?: AbortSignal): Promise<SessionView> {
  const response = await checked(
    await fetch('/api/session', {
      headers: { Accept: 'application/json' },
      signal,
    }),
  )
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error(
      'The server returned an unexpected page. Reload or contact the operator if the problem continues.',
    )
  return response.json()
}

export async function clearSession(): Promise<SessionView> {
  return (
    await checked(await fetch('/api/session', { method: 'DELETE' }))
  ).json()
}

export async function cancelTurn(): Promise<void> {
  await checked(await fetch('/api/cancel', { method: 'POST' }))
}

export async function streamTurn(
  input: TurnInput,
  signal: AbortSignal,
  onEvent: (event: DeskEvent) => void,
): Promise<void> {
  const response = await checked(
    await fetch('/api/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(input),
      signal,
    }),
  )
  if (
    !response.headers.get('content-type')?.includes('text/event-stream') ||
    !response.body
  )
    throw new Error(
      'No report stream was received. Reload the page and try again.',
    )
  let terminal = false
  for await (const frame of readSSE(response.body, signal)) {
    const event = JSON.parse(frame.data) as DeskEvent
    if (
      !['status', 'sources', 'draft_delta', 'completed', 'failed'].includes(
        event.type,
      )
    )
      throw new Error('An unexpected stream event was received.')
    onEvent(event)
    if (event.type === 'completed' || event.type === 'failed') {
      terminal = true
      break
    }
  }
  if (!terminal)
    throw new Error(
      'The connection ended before the report completed. Your question is saved; please retry.',
    )
}
