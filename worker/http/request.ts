import { DeskError } from '../errors'
import { parseTurn, type TurnInput } from '../../shared/contracts'

export async function readTurn(request: Request): Promise<TurnInput> {
  const reader = request.body?.getReader()
  if (!reader) throw new DeskError('Expected a question.')
  let raw = ''
  let bytes = 0
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        raw += decoder.decode()
        break
      }
      bytes += value.byteLength
      if (bytes > 20_000) throw new DeskError('The request is too large.', 413)
      raw += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  try {
    return parseTurn(JSON.parse(raw))
  } catch {
    throw new DeskError(
      'Invalid question or settings. Use up to 4,000 characters, a valid region, and two to six sources.',
    )
  }
}

export function assertSameOrigin(request: Request): void {
  if (request.headers.get('Origin') !== new URL(request.url).origin) {
    throw new DeskError(
      'This request must come from the news desk on the same origin.',
      403,
    )
  }
}
