import MarkdownIt from 'markdown-it'
import type { Source } from '../shared/contracts'
import { DeskError } from './errors'

const parser = new MarkdownIt({ html: true, linkify: true }).enable('linkify')

export function validateDraft(draft: string, sources: Source[]): string {
  const text = draft.trim()
  if (!text || text.length > 12_000)
    throw new DeskError('The answer was empty or too long. Please retry.')
  if (/https?:|www\.|!\[|<\/?[a-z]|\[[^\]]*\]\s*\(/i.test(text)) {
    throw new DeskError(
      'The draft contained an unsupported link or HTML and was not saved. Please retry.',
    )
  }
  const inspect = (tokens: ReturnType<typeof parser.parse>) => {
    for (const token of tokens) {
      if (
        [
          'link_open',
          'image',
          'html_inline',
          'html_block',
          'fence',
          'code_block',
          'code_inline',
        ].includes(token.type)
      ) {
        throw new DeskError(
          'The draft contained unsupported formatting and was not saved. Please retry.',
        )
      }
      if (token.children) inspect(token.children)
    }
  }
  inspect(parser.parse(text, {}))
  const ids = new Set(sources.map((source) => source.id))
  let citations = 0
  for (const marker of text.match(/\[S[^\]\n]*\]/g) ?? []) {
    if (!/^\[S\d+\]$/.test(marker) || !ids.has(marker.slice(1, -1))) {
      throw new DeskError(
        'The draft cited an unknown source and was not saved. Please retry.',
      )
    }
    citations++
  }
  if (/\[s/i.test(text.replace(/\[S\d+\]/g, '')))
    throw new DeskError(
      'The draft contained a malformed source marker. Please retry.',
    )
  if (sources.length && !citations)
    throw new DeskError('The answer did not cite its sources. Please retry.')
  return text
}
