import { describe, expect, it } from 'vitest'
import { initialTheme } from '../src/lib/theme'
import { dateLabel } from '../src/lib/dates'

describe('display preferences', () => {
  it.each([false, true])(
    'preserves either saved theme regardless of system preference (%s)',
    (prefersDark) => {
      expect(initialTheme('light', prefersDark)).toBe('light')
      expect(initialTheme('dark', prefersDark)).toBe('dark')
    },
  )
  it('falls back to the system only for missing or invalid preferences', () => {
    expect(initialTheme(null, true)).toBe('dark')
    expect(initialTheme('unexpected', false)).toBe('light')
  })
  it('handles missing and invalid dates without crashing rendering', () => {
    expect(dateLabel(null)).toBe('Date unavailable')
    expect(dateLabel('invalid')).toBe('Date unavailable')
    expect(dateLabel('2026-10-18T12:00:00Z')).not.toBe('Date unavailable')
  })
})
