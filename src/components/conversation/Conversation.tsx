import type { Message, Source } from '../../../shared/contracts'
import { dateLabel } from '../../lib/dates'
import { Icon } from '../ui/Icon'
import { ReportText } from './ReportText'

interface Props {
  messages: Message[]
  onSource: (message: Message, source?: Source) => void
}

export function Conversation({ messages, onSource }: Props) {
  return (
    <section className="conversation" aria-label="Conversation">
      {messages.map((message) =>
        message.role === 'user' ? (
          <article className="question-message" key={message.id}>
            <div className="message-label">YOUR QUESTION</div>
            <h2>{message.content}</h2>
          </article>
        ) : (
          <article className="answer-message" key={message.id}>
            <div className="answer-heading">
              <span className="desk-monogram">n·</span>
              <span className="message-label">THE DESK</span>
              <span className="answer-type">
                {message.reused ? 'Evidence reused' : 'Source-grounded report'}
              </span>
            </div>
            <ReportText
              message={message}
              onSource={(source) => onSource(message, source)}
            />
            <div className="answer-meta">
              <button onClick={() => onSource(message, message.sources?.[0])}>
                <Icon name="book" size={15} />
                {message.sources?.length ?? 0} sources
                <Icon name="chevron" size={13} />
              </button>
              <span>{dateLabel(message.createdAt)}</span>
            </div>
            {message.warnings?.map((warning) => (
              <p className="evidence-warning" key={warning}>
                {warning}
              </p>
            ))}
          </article>
        ),
      )}
    </section>
  )
}
