export function dateLabel(value: string | null, includeTime = false): string {
  const date = value ? new Date(value) : null
  if (!date || !Number.isFinite(date.getTime())) return 'Date unavailable'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(includeTime ? ({ hour: '2-digit', minute: '2-digit' } as const) : {}),
  }).format(date)
}
