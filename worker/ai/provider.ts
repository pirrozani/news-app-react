import type { AppEnv } from '../env'

/** Native bindings cannot unsend inference; cancellation discards its result. */
export async function infer(
  env: AppEnv,
  model: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted()
  let abort: () => void = () => {}
  const interrupted = new Promise<never>((_, reject) => {
    abort = () =>
      reject(signal.reason ?? new DOMException('Canceled', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
  })
  const inference = env.AI.run(model as keyof AiModels, input as never).then(
    (result) => {
      if (signal.aborted && result instanceof ReadableStream)
        void result.cancel().catch(() => {})
      return result
    },
  )
  try {
    return await Promise.race([inference, interrupted])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
