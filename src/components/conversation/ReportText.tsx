import type { Message, Source } from '../../../shared/contracts'

export function ReportText({
  message,
  onSource,
}: {
  message: Message
  onSource: (source: Source) => void
}) {
  return (
    <div className="report-text">
      {message.content.split(/(\[S\d+\])/g).map((piece, index) => {
        const source = message.sources?.find((item) => `[${item.id}]` === piece)
        return source ? (
          <button
            className="citation"
            key={index}
            onClick={() => onSource(source)}
            aria-label={`Inspect source ${source.id}: ${source.outlet}`}
          >
            {source.id.slice(1)}
          </button>
        ) : (
          <span key={index}>{piece}</span>
        )
      })}
    </div>
  )
}
