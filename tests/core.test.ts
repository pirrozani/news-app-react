import { describe, expect, it, vi } from 'vitest'
import type { Message, Source } from '../shared/contracts'
import { parseTurn } from '../shared/contracts'
import { readSSE } from '../shared/sse'
import {
  asksForFreshness,
  fallbackQuery,
  isRewrite,
  plan,
  write,
  writerHistory,
} from '../worker/ai/agents'
import { validateDraft } from '../worker/citations'
import type { AppEnv } from '../worker/env'
import {
  parseFeed,
  resolveLocale,
  displayURL,
  relevantSources,
  research,
} from '../worker/research'

export const source: Source = {
  id: 'S1',
  title: 'Fusion project reports a milestone',
  outlet: 'Example News',
  url: 'https://example.com/news',
  publishedAt: null,
  retrievedAt: '2026-10-18T12:00:00Z',
  content:
    'The project announced an experimental milestone this week. Researchers said further testing is required.',
  evidence: 'feed-excerpt',
}
const stream = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of new TextEncoder().encode(text))
        controller.enqueue(Uint8Array.of(byte))
      controller.close()
    },
  })
const aiEnv = (run: ReturnType<typeof vi.fn>) =>
  ({
    AI: { run },
    PLANNER_MODEL: 'small',
    WRITER_MODEL: 'small',
  }) as unknown as AppEnv
const signal = () => new AbortController().signal

describe('routing and bounded inputs', () => {
  it('validates user input', () => {
    expect(
      parseTurn({
        id: crypto.randomUUID(),
        question: ' Hello ',
        locale: 'auto',
        sourceCount: 3,
      }).question,
    ).toBe('Hello')
    for (const bad of [
      null,
      {},
      {
        id: crypto.randomUUID(),
        question: 'x'.repeat(4001),
        locale: 'auto',
        sourceCount: 3,
      },
    ])
      expect(() => parseTurn(bad)).toThrow()
  })
  it('preserves Greek and recognizes explicit freshness', () => {
    expect(resolveLocale('Greek news Αθήνα', 'auto')).toBe('el-GR')
    expect(resolveLocale('Αθήνα', 'en-US')).toBe('en-US')
    expect(asksForFreshness('Τι συμβαίνει σήμερα;')).toBe(true)
    expect(
      fallbackQuery('What is the latest news about fusion energy?', []),
    ).toContain('fusion energy')
  })
  it.each([
    { locale: ['auto'] },
    { locale: {} },
    { locale: null },
    { locale: 123 },
  ])('rejects non-string locales: %j', ({ locale }) => {
    expect(() =>
      parseTurn({
        id: crypto.randomUUID(),
        question: 'News',
        locale,
        sourceCount: 3,
      }),
    ).toThrow('region')
  })
  it('rejects malformed turn IDs', () => {
    expect(() =>
      parseTurn({
        id: '-'.repeat(36),
        question: 'News',
        locale: 'auto',
        sourceCount: 3,
      }),
    ).toThrow('ID')
  })
  it('only shortcuts unambiguous transformations', () => {
    expect(isRewrite('Summarize those reports in two sentences')).toBe(true)
    expect(isRewrite('Summarize those reports and find new facts')).toBe(false)
  })
  it('does not call a model for first questions, rewrites, or explicit updates', async () => {
    const run = vi.fn()
    const env = aiEnv(run)
    expect((await plan(env, 'fusion energy', [], [], signal())).reused).toBe(
      false,
    )
    expect(
      (await plan(env, 'Summarize those reports', [], [source], signal()))
        .reused,
    ).toBe(true)
    expect(
      (await plan(env, 'Latest fusion developments', [], [source], signal()))
        .reused,
    ).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })
  it('falls back when the planner truncates or returns malformed output', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ response: 'NO_SEARCH but maybe search' })
    expect(
      (await plan(aiEnv(run), 'fusion experiments', [], [source], signal()))
        .reused,
    ).toBe(false)
    run.mockResolvedValue({
      choices: [{ message: { content: 'NO_SEARCH' }, finish_reason: 'length' }],
    })
    expect(
      (await plan(aiEnv(run), 'fusion experiments', [], [source], signal()))
        .reused,
    ).toBe(false)
  })
  it('remaps historical source IDs and bounds history', () => {
    const message: Message = {
      id: 'a',
      role: 'assistant',
      content: 'Earlier [S1]',
      sources: [source],
      createdAt: '',
    }
    expect(writerHistory([message], [{ ...source, id: 'S2' }])[0].content).toBe(
      'Earlier [S2]',
    )
    expect(writerHistory([message], [])[0].content).toContain('earlier source')
  })
})

describe('citations', () => {
  it('accepts only inventory IDs', () =>
    expect(
      validateDraft('The project reported progress [S1].', [source]),
    ).toContain('[S1]'))
  it.each([
    'No citations',
    'Claim [S9]',
    'Claim [S1,S2]',
    'Claim [S1] https://evil.example',
    'Claim [S1] www.example.com',
    'Claim [S1] <b>HTML</b>',
    'Claim [S1] ![image](https://example.com)',
    'Claim `[S1]`',
    '[link](https://example.com/news)',
  ])('rejects unsafe draft %s', (draft) =>
    expect(() => validateDraft(draft, [source])).toThrow(),
  )
})

describe('RSS evidence', () => {
  const xml = (description: string) =>
    `<rss><channel><item><title>${source.title} - Example News</title><source>Example News</source><link>${source.url}</link><description><![CDATA[${description}]]></description><pubDate>Sun, 18 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`
  it('parses bounded, plain-text excerpts and separate timestamps', () => {
    const results = parseFeed(xml(`<p>${source.content}</p>`), 3)
    expect(results).toHaveLength(1)
    expect(results[0].content).toBe(source.content)
    expect(results[0].evidence).toBe('feed-excerpt')
    expect(results[0].publishedAt).toBe('2026-10-18T10:00:00.000Z')
  })
  it('rejects title-only evidence and XML entities', () => {
    expect(parseFeed(xml(`${source.title} Example News`), 3)).toHaveLength(0)
    expect(() =>
      parseFeed('<!DOCTYPE rss [<!ENTITY x "x">]><rss/>', 3),
    ).toThrow()
  })
  it.each([
    'javascript:alert(1)',
    'http://localhost/x',
    'http://127.0.0.1/x',
    'https://user:pass@example.com',
  ])('rejects unsafe source URL %s', (url) =>
    expect(displayURL(url)).toBeNull(),
  )
  it('does not replace an empty search with unrelated publisher headlines', () => {
    expect(relevantSources([source], 'fusion project')).toHaveLength(1)
    expect(relevantSources([source], 'climate regulation')).toHaveLength(0)
  })
  it('uses only approved publisher feeds as a topic-matched fallback', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) => {
        if (
          ['news.google.com', 'www.bing.com'].includes(
            new URL(String(url)).hostname,
          )
        )
          return new Response('<rss><channel/></rss>', {
            headers: { 'Content-Type': 'application/xml' },
          })
        return new Response(xml(source.content), {
          headers: { 'Content-Type': 'application/xml' },
        })
      })
    try {
      const result = await research('fusion project', 'en-US', 3, signal())
      expect(result.sources).toHaveLength(1)
      expect(result.sources[0].id).toBe('S1')
      expect(result.warnings.join(' ')).toContain('selected publisher')
      expect(
        fetchMock.mock.calls.every(
          (call) => !String(call[0]).startsWith('https://example.com'),
        ),
      ).toBe(true)
      expect(
        fetchMock.mock.calls.every((call) => call[1]?.redirect === 'manual'),
      ).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(5)
    } finally {
      fetchMock.mockRestore()
    }
  })
  it('parses real Bing RSS source metadata and decodes publisher links without following them', () => {
    const feed = `<rss xmlns:News="urn:news"><channel><item><title>Renewable energy expands in Europe</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3A%2F%2Fexample.com%2Fenergy%3Fa%3D1%26b%3D2&amp;mkt=en-US</link><description>European governments announced new investment in wind and solar power, with projects due to begin next year.</description><News:Source>Example Energy</News:Source></item></channel></rss>`
    const results = parseFeed(feed, 3)
    expect(results).toHaveLength(1)
    expect(results[0].outlet).toBe('Example Energy')
    expect(results[0].url).toBe('https://example.com/energy?a=1&b=2')
  })
  it('uses query-specific Bing RSS before falling back to broad publisher feeds', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async (url) =>
          new Response(
            String(url).includes('news.google.com')
              ? '<rss><channel/></rss>'
              : xml(source.content),
            { headers: { 'Content-Type': 'application/xml' } },
          ),
      )
    try {
      const result = await research(
        'renewable energy Europe',
        'en-US',
        3,
        signal(),
      )
      expect(result.sources).toHaveLength(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const target = new URL(String(fetchMock.mock.calls[1][0]))
      expect(target.origin).toBe('https://www.bing.com')
      expect(target.searchParams.get('q')).toBe('renewable energy Europe')
      expect(target.searchParams.get('mkt')).toBe('en-US')
      expect(result.warnings.join(' ')).toContain('Bing News RSS instead')
    } finally {
      fetchMock.mockRestore()
    }
  })
  it('rejects feed redirects without following their Location', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'http://127.0.0.1/private' },
        }),
    )
    try {
      const result = await research(
        'renewable energy Europe',
        'en-US',
        3,
        signal(),
      )
      expect(result.sources).toHaveLength(0)
      expect(
        fetchMock.mock.calls.every((call) => call[1]?.redirect === 'manual'),
      ).toBe(true)
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0]).includes('127.0.0.1'),
        ),
      ).toBe(false)
    } finally {
      fetchMock.mockRestore()
    }
  })
})

describe('streaming', () => {
  it('handles arbitrary byte chunks, CRLF, comments, and multi-line data', async () => {
    const frames = []
    for await (const frame of readSSE(
      stream(
        ': keepalive\r\nevent: status\r\ndata: hello\r\ndata: world\r\n\r\n',
      ),
    ))
      frames.push(frame)
    expect(frames).toEqual([{ event: 'status', data: 'hello\nworld' }])
  })
  it('rejects an incomplete final event', async () => {
    await expect(async () => {
      for await (const _ of readSSE(stream('data: partial'))) {
        /* drain */
      }
    }).rejects.toThrow('inside an event')
  })
  it('preserves Greek characters split across UTF-8 byte boundaries', async () => {
    const frames = []
    for await (const frame of readSSE(
      stream('data: Ειδήσεις από την Αθήνα\n\n'),
    ))
      frames.push(frame.data)
    expect(frames).toEqual(['Ειδήσεις από την Αθήνα'])
  })
  it('normalizes legacy and OpenAI provider chunks', async () => {
    const run = vi
      .fn()
      .mockResolvedValue(
        stream(
          'data: {"response":"A claim "}\n\ndata: {"response":"[S1]\\nEND_OF_REPORT"}\n\ndata: [DONE]\n\n',
        ),
      )
    const deltas: string[] = []
    expect(
      await write(aiEnv(run), 'question', [], [source], signal(), (text) =>
        deltas.push(text),
      ),
    ).toBe('A claim [S1]')
    expect(deltas.join('')).toBe('A claim [S1]')
  })
  it('accepts a provider-confirmed stop when Granite omits the text marker', async () => {
    const run = vi
      .fn()
      .mockResolvedValue(
        stream(
          'data: {"choices":[{"delta":{"content":"The project reported progress [S1]."},"finish_reason":null}],"usage":{"completion_tokens":1}}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":1}}\n\ndata: [DONE]\n\n',
        ),
      )
    const deltas: string[] = []
    const draft = await write(
      aiEnv(run),
      'question',
      [],
      [source],
      signal(),
      (text) => deltas.push(text),
    )
    expect(draft).toBe('The project reported progress [S1].')
    expect(deltas.join('')).toBe(draft)
    expect(validateDraft(draft, [source])).toBe(draft)
    expect(run).toHaveBeenCalledOnce()
  })
  it('accepts explicit stop at a clean EOF and strips an optional completion marker', async () => {
    const run = vi
      .fn()
      .mockResolvedValue(
        stream(
          'data: {"choices":[{"delta":{"content":"Progress [S1].\\nEND_OF_REPORT"},"finish_reason":"stop"}]}\n\n',
        ),
      )
    const deltas: string[] = []
    expect(
      await write(aiEnv(run), 'question', [], [source], signal(), (text) =>
        deltas.push(text),
      ),
    ).toBe('Progress [S1].')
    expect(deltas.join('')).toBe('Progress [S1].')
  })
  it('recognizes legacy top-level finish metadata without requiring a marker', async () => {
    const run = vi
      .fn()
      .mockResolvedValue(
        stream(
          'data: {"response":"Progress [S1].","finish_reason":"stop"}\n\n',
        ),
      )
    expect(
      await write(aiEnv(run), 'question', [], [source], signal(), () => {}),
    ).toBe('Progress [S1].')
  })
  it('does not let a marker hide a provider-reported token limit or content filter', async () => {
    const run = vi
      .fn()
      .mockResolvedValue(
        stream(
          'data: {"choices":[{"delta":{"content":"Progress [S1].\\nEND_OF_REPORT"},"finish_reason":"length"}]}\n\n',
        ),
      )
    await expect(
      write(aiEnv(run), 'question', [], [source], signal(), () => {}),
    ).rejects.toThrow('token limit')
    run.mockResolvedValue(
      stream(
        'data: {"choices":[{"delta":{"content":"Progress [S1].\\nEND_OF_REPORT"},"finish_reason":"content_filter"}]}\n\n',
      ),
    )
    await expect(
      write(aiEnv(run), 'question', [], [source], signal(), () => {}),
    ).rejects.toThrow('did not complete')
  })
  it('rejects legacy budget exhaustion without a finish reason', async () => {
    const run = vi
      .fn()
      .mockImplementation(async (_model, input) =>
        stream(
          `data: ${JSON.stringify({ response: 'Progress [S1].\nEND_OF_REPORT', usage: { completion_tokens: input.max_tokens } })}\n\ndata: [DONE]\n\n`,
        ),
      )
    await expect(
      write(aiEnv(run), 'question', [], [source], signal(), () => {}),
    ).rejects.toThrow('token limit')
  })
  it('rejects truncation and premature EOF', async () => {
    const run = vi
      .fn()
      .mockResolvedValue(
        stream(
          'data: {"choices":[{"delta":{"content":"Partial"},"finish_reason":"length"}]}\n\n',
        ),
      )
    await expect(
      write(aiEnv(run), 'question', [], [source], signal(), () => {}),
    ).rejects.toThrow('token limit')
    run.mockResolvedValue(stream('data: {"response":"Partial"}\n\n'))
    await expect(
      write(aiEnv(run), 'question', [], [source], signal(), () => {}),
    ).rejects.toThrow('interrupted')
    run.mockResolvedValue(
      stream('data: {"response":"Truncated [S1]"}\n\ndata: [DONE]\n\n'),
    )
    await expect(
      write(aiEnv(run), 'question', [], [source], signal(), () => {}),
    ).rejects.toThrow('did not confirm')
  })
})
