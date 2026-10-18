import type { NewsSession } from './session'

export interface AppEnv {
  AI: Ai
  ASSETS: Fetcher
  SESSIONS: DurableObjectNamespace<NewsSession>
  PLANNER_MODEL: string
  WRITER_MODEL: string
  APP_ENABLED?: string
  TURN_RATE_LIMITER: RateLimit
}
