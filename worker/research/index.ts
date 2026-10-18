import { XMLParser } from 'fast-xml-parser'
import type { Locale, Source } from '../../shared/contracts'
import { DeskError } from '../errors'

const FEED_HOST = 'news.google.com'
const MAX_BYTES = 1_000_000
// Only these exact server-selected feed URLs can be fetched. Publisher article links are display-only.
const PUBLISHER_FEEDS = {
  'en-US': [
    { url: 'https://feeds.bbci.co.uk/news/rss.xml', outlet: 'BBC News' },
    {
      url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
      outlet: 'BBC News',
    },
    { url: 'https://www.theguardian.com/world/rss', outlet: 'The Guardian' },
  ],
  'el-GR': [
    { url: 'https://www.ertnews.gr/feed/', outlet: 'ERT News' },
    { url: 'https://www.in.gr/feed/', outlet: 'in.gr' },
  ],
}

export function resolveLocale(
  question: string,
  selection: Locale,
): Exclude<Locale, 'auto'> {
  return selection === 'auto'
    ? /\p{Script=Greek}/u.test(question)
      ? 'el-GR'
      : 'en-US'
    : selection
}

export function plainText(value: unknown, limit = 1000): string {
  const text =
    typeof value === 'object' && value
      ? String((value as Record<string, unknown>)['#text'] ?? '')
      : String(value ?? '')
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/g,
      (entity) =>
        ({
          '&amp;': '&',
          '&lt;': '<',
          '&gt;': '>',
          '&quot;': '"',
          '&apos;': "'",
          '&nbsp;': ' ',
        })[entity] ?? '',
    )
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const point =
        code[0].toLowerCase() === 'x'
          ? parseInt(code.slice(1), 16)
          : Number(code)
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
    })
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

export function displayURL(value: unknown): string | null {
  try {
    const url = new URL(String(value))
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      (url.port && !['80', '443'].includes(url.port))
    )
      return null
    const host = url.hostname.toLowerCase()
    // Display only. These URLs are never used as server-side fetch targets.
    if (
      !host.includes('.') ||
      host.endsWith('.localhost') ||
      host === 'localhost' ||
      /^\[|^\d+(\.\d+){3}$/.test(host)
    )
      return null
    if (url.href.length > 4096) return null
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

function sourceURL(value: unknown): string | null {
  const validated = displayURL(plainText(value, 4096))
  if (!validated) return null
  const url = new URL(validated)
  if (
    ['www.bing.com', 'bing.com'].includes(url.hostname) &&
    url.pathname === '/news/apiclick.aspx'
  ) {
    // RSS links encode the publisher URL. Decode data, never fetch the redirect.
    return displayURL(url.searchParams.get('url'))
  }
  return validated
}

export function parseFeed(
  xml: string,
  limit: number,
  now = new Date().toISOString(),
  publisher?: string,
): Source[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new DeskError('The feed contained unsupported XML declarations.')
  const parsed = new XMLParser({
    ignoreAttributes: true,
    processEntities: false,
    parseTagValue: false,
  }).parse(xml)
  const raw = parsed?.rss?.channel?.item ?? []
  const items = Array.isArray(raw) ? raw : [raw]
  const seen = new Set<string>()
  const sources: Source[] = []
  for (const item of items.slice(0, 100)) {
    if (!item || typeof item !== 'object') continue
    const url = sourceURL(item.link)
    const title = plainText(item.title, 250)
    const outlet =
      plainText(item.source ?? item['News:Source'], 100) ||
      publisher ||
      'Unknown outlet'
    const content = plainText(item.description)
    // Aggregator descriptions often repeat only the headline and outlet. Do not call that article evidence.
    const normalize = (value: string) =>
      value
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
    const outletName = normalize(outlet)
    const normalizedTitle = normalize(title)
    const headline = normalizedTitle.endsWith(outletName)
      ? normalizedTitle.slice(0, -outletName.length).trim()
      : normalizedTitle
    const excerpt = normalize(content)
    const extraEvidence = excerpt
      .replace(headline, '')
      .replace(outletName, '')
      .replace(/\s/g, '')
    if (
      !url ||
      !title ||
      content.length < 60 ||
      !excerpt ||
      headline.includes(excerpt) ||
      excerpt === normalizedTitle ||
      extraEvidence.length < 40
    )
      continue
    const key = new URL(url)
    for (const param of [...key.searchParams.keys()])
      if (/^utm_|^(fbclid|gclid)$/i.test(param)) key.searchParams.delete(param)
    const dedupe = `${normalize(title)}|${outlet}`
    if (seen.has(key.href) || seen.has(dedupe)) continue
    seen.add(key.href)
    seen.add(dedupe)
    const date = Date.parse(String(item.pubDate ?? ''))
    sources.push({
      id: `S${sources.length + 1}`,
      title,
      outlet,
      url,
      content,
      evidence: 'feed-excerpt',
      publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null,
      retrievedAt: now,
    })
    if (sources.length >= limit) break
  }
  return sources
}

async function downloadFeed(url: URL, signal: AbortSignal): Promise<string> {
  const approved = Object.values(PUBLISHER_FEEDS)
    .flat()
    .some((feed) => feed.url === url.href)
  const searchEndpoint =
    (url.origin === `https://${FEED_HOST}` && url.pathname === '/rss/search') ||
    (url.origin === 'https://www.bing.com' &&
      url.pathname === '/news/search' &&
      url.searchParams.get('format') === 'rss')
  if (!approved && !searchEndpoint) throw new Error('Unapproved feed')
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
  // Workers does not implement redirect: 'error'. Manual mode plus the status
  // check below rejects redirects without following an unapproved destination.
  const response = await fetch(url, {
    signal: timeout,
    redirect: 'manual',
    headers: {
      Accept: 'application/rss+xml, application/xml, text/xml',
      'User-Agent': 'NewsDesk/1.0',
    },
  })
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new Error('Feed unavailable')
  }
  const type = response.headers.get('content-type') ?? ''
  if (!/xml|rss|text\/plain/i.test(type)) {
    await response.body.cancel()
    throw new Error('Unexpected feed type')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      timeout.throwIfAborted()
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BYTES) throw new Error('Feed too large')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const joined = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}

export function relevantSources(sources: Source[], query: string): Source[] {
  const normalize = (value: string) =>
    value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()
  const filler = new Set(
    'latest current news today updates update now breaking what about world the and for with ειδησεις νεα τελευταιες τελευταια σημερα τωρα ποιες ποια ειναι στην στηνς στην για απο των της τον την'.split(
      ' ',
    ),
  )
  const keywords = [
    ...new Set(
      (normalize(query).match(/[\p{L}\p{N}]+/gu) ?? [])
        .filter((word) => word.length >= 3 && !filler.has(word))
        .map((word) => (word.length > 6 ? word.slice(0, 6) : word)),
    ),
  ]
  if (!keywords.length) return sources
  return sources.filter((source) => {
    const content = normalize(`${source.title} ${source.content}`)
    return (
      keywords.filter((keyword) => content.includes(keyword)).length >=
      Math.min(2, keywords.length)
    )
  })
}

export async function research(
  query: string,
  locale: Exclude<Locale, 'auto'>,
  limit: number,
  signal: AbortSignal,
): Promise<{ sources: Source[]; warnings: string[] }> {
  const url = new URL(`https://${FEED_HOST}/rss/search`)
  url.searchParams.set('q', query.slice(0, 200))
  const region =
    locale === 'el-GR'
      ? { hl: 'el', gl: 'GR', ceid: 'GR:el' }
      : { hl: 'en-US', gl: 'US', ceid: 'US:en' }
  for (const [key, value] of Object.entries(region))
    url.searchParams.set(key, value)
  const warnings = ['Evidence is limited to RSS excerpts, not full articles.']
  let sources: Source[] = []
  try {
    sources = parseFeed(await downloadFeed(url, signal), limit)
  } catch {
    signal.throwIfAborted()
    warnings.push('Google News RSS was unavailable.')
  }
  if (!sources.length) {
    const bing = new URL('https://www.bing.com/news/search')
    bing.searchParams.set('q', query.slice(0, 200))
    bing.searchParams.set('format', 'rss')
    bing.searchParams.set('mkt', locale)
    bing.searchParams.set('setlang', locale === 'el-GR' ? 'el' : 'en')
    try {
      sources = parseFeed(await downloadFeed(bing, signal), limit)
    } catch {
      signal.throwIfAborted()
      warnings.push('Bing News RSS was unavailable.')
    }
    if (sources.length)
      warnings.push(
        'Google News supplied no usable excerpts; searched Bing News RSS instead.',
      )
  }
  if (!sources.length) {
    const results = await Promise.allSettled(
      PUBLISHER_FEEDS[locale].map(async (feed) =>
        relevantSources(
          parseFeed(
            await downloadFeed(new URL(feed.url), signal),
            40,
            new Date().toISOString(),
            feed.outlet,
          ),
          query,
        ),
      ),
    )
    signal.throwIfAborted()
    const candidates = results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    )
    const seen = new Set<string>()
    sources = candidates
      .filter((source) => {
        const key = source.title.toLocaleLowerCase()
        if (seen.has(source.url) || seen.has(key)) return false
        seen.add(source.url)
        seen.add(key)
        return true
      })
      .slice(0, limit)
      .map((source, index) => ({ ...source, id: `S${index + 1}` }))
    warnings.push(
      'News search feeds supplied no usable excerpts. Checked matching recent entries from selected publisher feeds; coverage is limited.',
    )
  }
  if (sources.length < limit)
    warnings.push(
      'Fewer usable excerpts were available than requested; headline-only results were omitted.',
    )
  if (!sources.length)
    warnings.push(
      'No matching feed evidence was accessible. Try a different topic or try again later.',
    )
  return { sources, warnings }
}
