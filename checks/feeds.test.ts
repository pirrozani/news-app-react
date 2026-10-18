import { expect, it, vi } from 'vitest'
import { parseFeed, relevantSources, research } from '../worker/research'
import { fallbackQuery } from '../worker/ai/agents'

/** Opt-in live RSS diagnostic. Never calls Workers AI. */
it('checks live RSS retrieval in the Worker runtime without inference', async () => {
  const realFetch = globalThis.fetch
  const tracedFetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, options) => {
      const host = new URL(String(input)).hostname
      try {
        const response = await realFetch(input, options)
        const xml = await response.clone().text()
        const usable = response.ok
          ? parseFeed(xml, 50, new Date().toISOString(), host)
          : []
        console.log(
          JSON.stringify({
            host,
            status: response.status,
            type: response.headers.get('content-type'),
            usableExcerpts: usable.length,
            matchingExcerpts: relevantSources(usable, 'renewable energy Europe')
              .length,
            examples: usable.slice(0, 3).map((source) => source.title),
          }),
        )
        return response
      } catch (error) {
        console.log(
          JSON.stringify({
            host,
            error: error instanceof Error ? error.message : 'Network failure',
          }),
        )
        throw error
      }
    })
  try {
    const query = fallbackQuery(
      'What is the latest news about renewable energy in Europe?',
      [],
    )
    const result = await research(
      query,
      'en-US',
      3,
      AbortSignal.timeout(40_000),
    )
    console.log(
      JSON.stringify({
        query,
        sources: result.sources.map((source) => ({
          title: source.title,
          outlet: source.outlet,
        })),
        warnings: result.warnings,
      }),
    )
    expect(tracedFetch).toHaveBeenCalled()
    expect(
      result.sources.length,
      'No usable sources were returned by the live feeds.',
    ).toBeGreaterThan(0)
  } finally {
    tracedFetch.mockRestore()
  }
})
