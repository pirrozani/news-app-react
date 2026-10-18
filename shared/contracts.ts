export type Locale = 'auto' | 'el-GR' | 'en-US'
export type Stage = 'planning' | 'researching' | 'writing' | 'validating'

export interface Source {
  id: string
  title: string
  outlet: string
  url: string
  publishedAt: string | null
  retrievedAt: string
  content: string
  evidence: 'feed-excerpt'
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  sources?: Source[]
  query?: string
  reused?: boolean
  warnings?: string[]
}

export interface SessionView {
  messages: Message[]
  failedTurn: { id: string; question: string; error: string } | null
  busy: boolean
}

export interface TurnInput {
  id: string
  question: string
  locale: Locale
  sourceCount: number
}

export type DeskEvent =
  | { type: 'status'; stage: Stage; detail: string }
  | {
      type: 'sources'
      sources: Source[]
      warnings: string[]
      query: string
      reused: boolean
    }
  | { type: 'draft_delta'; text: string }
  | { type: 'completed'; message: Message }
  | { type: 'failed'; error: string }

export const NO_EVIDENCE =
  'I couldn’t retrieve enough news evidence to answer this question. The feeds may contain only headlines, or may be temporarily unavailable. Try a more specific topic or try again later. I won’t substitute an answer from memory for current reporting.'

export function parseTurn(value: unknown): TurnInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid request.')
  const { id, question, locale, sourceCount } = value as Record<string, unknown>
  if (
    typeof id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new Error('Invalid turn ID.')
  if (
    typeof question !== 'string' ||
    !question.trim() ||
    question.length > 4000
  ) {
    throw new Error('Enter a question of up to 4,000 characters.')
  }
  if (
    typeof locale !== 'string' ||
    !['auto', 'el-GR', 'en-US'].includes(locale)
  )
    throw new Error('Invalid search region.')
  if (
    typeof sourceCount !== 'number' ||
    !Number.isInteger(sourceCount) ||
    sourceCount < 2 ||
    sourceCount > 6
  ) {
    throw new Error('Choose between two and six sources.')
  }
  return {
    id,
    question: question.trim(),
    locale: locale as Locale,
    sourceCount,
  }
}
