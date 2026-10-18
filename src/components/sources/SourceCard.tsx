import type { Source } from '../../../shared/contracts'
import { dateLabel } from '../../lib/dates'
import { Icon } from '../ui/Icon'

export function SourceCard({
  source,
  selected,
  onSelect,
}: {
  source: Source
  selected: boolean
  onSelect: () => void
}) {
  return (
    <article className={`source-card ${selected ? 'selected' : ''}`}>
      <button
        className="source-card-heading"
        onClick={onSelect}
        aria-expanded={selected}
      >
        <span className="source-id">{source.id.slice(1).padStart(2, '0')}</span>
        <span>{source.outlet}</span>
        <span className="evidence-tag">RSS</span>
      </button>
      <h3>{source.title}</h3>
      <p className="source-date">Published {dateLabel(source.publishedAt)}</p>
      {selected && (
        <div className="source-excerpt">
          <span className="eyebrow">FEED EXCERPT</span>
          <p>{source.content}</p>
          <small>Retrieved {dateLabel(source.retrievedAt, true)}</small>
        </div>
      )}
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
      >
        Read source
        <Icon name="external" size={13} />
      </a>
    </article>
  )
}
