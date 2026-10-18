import { assertSameOrigin } from './http/request'
import type { AppEnv } from './env'
import { DeskError, safeError } from './errors'
export { NewsSession } from './session'

const routes = new Set([
  'GET /api/session',
  'DELETE /api/session',
  'POST /api/turn',
  'POST /api/cancel',
])

function withNoIndex(response: Response): Response {
  // Asset/redirect responses can have immutable headers. Rewrap without buffering
  // the body so SSE remains streamed and all hostnames share the same policy.
  const result = new Response(response.body, response)
  result.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return result
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    // Not declared in Wrangler vars: dashboard edits survive deployments with keep_vars.
    // Missing means open by default. Invalid values fail closed.
    if (env.APP_ENABLED !== undefined && env.APP_ENABLED !== 'true') {
      const message =
        'The news desk is temporarily closed. Please check back later.'
      return withNoIndex(
        url.pathname.startsWith('/api/')
          ? Response.json(
              { error: message },
              {
                status: 503,
                headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
              },
            )
          : new Response(
              `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Newsdesk — temporarily closed</title></head><body><main><h1>The news desk is temporarily closed.</h1><p>Please check back later.</p></main></body></html>`,
              {
                status: 503,
                headers: {
                  'Content-Type': 'text/html; charset=utf-8',
                  'Cache-Control': 'no-store',
                  'Retry-After': '60',
                  'X-Content-Type-Options': 'nosniff',
                },
              },
            ),
      )
    }
    if (!url.pathname.startsWith('/api/'))
      return withNoIndex(await env.ASSETS.fetch(request))
    let response: Response
    try {
      if (!routes.has(`${request.method} ${url.pathname}`))
        throw new DeskError('Not found.', 404)
      if (request.method !== 'GET') assertSameOrigin(request)
      if (
        url.pathname === '/api/turn' &&
        !request.headers.get('content-type')?.startsWith('application/json')
      )
        throw new DeskError('Expected a JSON request.', 415)
      if (Number(request.headers.get('content-length') ?? 0) > 20_000)
        throw new DeskError('The request is too large.', 413)
      if (
        url.pathname === '/api/turn' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ) {
        const ip = request.headers.get('CF-Connecting-IP')
        if (!ip || !env.TURN_RATE_LIMITER)
          throw new DeskError(
            'Public request protection is unavailable. Please try again later.',
            503,
          )
        const { success } = await env.TURN_RATE_LIMITER.limit({
          key: `turn:${ip}`,
        })
        if (!success)
          throw new DeskError(
            'Too many questions from this connection. Please wait a minute and try again.',
            429,
          )
      }
      const existing = request.headers
        .get('cookie')
        ?.match(/(?:^|;\s*)news_session=([0-9a-f-]{36})(?:;|$)/i)?.[1]
      const session = existing ?? crypto.randomUUID()
      const id = env.SESSIONS.idFromName(`anonymous:${session}`)
      response = await env.SESSIONS.get(id).fetch(request)
      response = new Response(response.body, response)
      if (!existing)
        response.headers.set(
          'Set-Cookie',
          `news_session=${session}; Path=/; HttpOnly; SameSite=Strict${url.protocol === 'https:' ? '; Secure' : ''}`,
        )
    } catch (error) {
      response = Response.json(
        { error: safeError(error) },
        { status: error instanceof DeskError ? error.status : 500 },
      )
      if (response.status === 429) response.headers.set('Retry-After', '60')
    }
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('Referrer-Policy', 'no-referrer')
    return withNoIndex(response)
  },
} satisfies ExportedHandler<AppEnv>
