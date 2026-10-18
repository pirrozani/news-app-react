export class DeskError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export function safeError(error: unknown): string {
  if (error instanceof DeskError) return error.message
  if (
    error instanceof Error &&
    ['AbortError', 'TimeoutError'].includes(error.name)
  ) {
    return 'This request was canceled or timed out. Your question is saved; you can retry.'
  }
  return 'The news desk could not finish this request. Check your Workers AI configuration or quota, then retry.'
}
