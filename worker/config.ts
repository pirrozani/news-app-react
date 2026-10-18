import type { Locale } from '../shared/contracts'
import type { AppEnv } from './env'

const DEFAULT_MODEL = '@cf/ibm-granite/granite-4.0-h-micro'

// Server-side defaults. Environment model overrides take precedence when set.
export const config = {
  ai: {
    planner: {
      model: DEFAULT_MODEL,
      maxTokens: 96,
      temperature: 0.1,
      historyMessages: 2,
      historyChars: 1000,
      sourceExcerptChars: 300,
    },
    writer: {
      model: DEFAULT_MODEL,
      maxTokens: 768,
      temperature: 0.2,
      historyMessages: 6,
      historyChars: 2000,
    },
  },
  research: {
    timeoutMs: 10_000,
    maxBytes: 1_000_000,
    excerptChars: 1000,
    // Exact server-selected RSS URLs only; article URLs remain display-only.
    publisherFeeds: {
      'en-US': [
        { url: 'https://feeds.bbci.co.uk/news/rss.xml', outlet: 'BBC News' },
        {
          url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
          outlet: 'BBC News',
        },
        {
          url: 'https://www.theguardian.com/world/rss',
          outlet: 'The Guardian',
        },
      ],
      'el-GR': [
        { url: 'https://www.ertnews.gr/feed/', outlet: 'ERT News' },
        { url: 'https://www.in.gr/feed/', outlet: 'in.gr' },
      ],
    } satisfies Record<
      Exclude<Locale, 'auto'>,
      { url: string; outlet: string }[]
    >,
  },
  session: {
    idleTtlMs: 2 * 60 * 60 * 1000,
    turnTimeoutMs: 75_000,
    maxMessages: 30,
  },
} as const

export function resolveAIConfig(
  env: Pick<AppEnv, 'PLANNER_MODEL' | 'WRITER_MODEL'>,
) {
  return {
    planner: {
      ...config.ai.planner,
      model: env.PLANNER_MODEL?.trim() || config.ai.planner.model,
    },
    writer: {
      ...config.ai.writer,
      model: env.WRITER_MODEL?.trim() || config.ai.writer.model,
    },
  }
}
