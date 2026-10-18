import type { Ref } from 'react'
import { Icon } from '../ui/Icon'

interface Props {
  inputRef: Ref<HTMLTextAreaElement>
  question: string
  onQuestion: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  sourceCount: number
  hasMessages: boolean
  loading: boolean
  busy: boolean
  canSend: boolean
}

export function Composer({
  inputRef,
  question,
  onQuestion,
  onSubmit,
  onStop,
  sourceCount,
  hasMessages,
  loading,
  busy,
  canSend,
}: Props) {
  return (
    <footer className="composer-area">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (canSend) onSubmit()
        }}
      >
        <div className="composer-shell">
          <label className="sr-only" htmlFor="composer">
            Ask a news question or follow up
          </label>
          <textarea
            id="composer"
            ref={inputRef}
            value={question}
            onChange={(event) => onQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault()
                if (canSend) onSubmit()
              }
            }}
            placeholder={
              hasMessages
                ? 'Ask a follow-up or explore a new topic…'
                : 'What would you like to understand today?'
            }
            maxLength={4000}
            rows={2}
            disabled={loading}
          />
          <div className="composer-tools">
            <span>
              <Icon name="search" size={14} />
              RSS research<span className="tool-divider">/</span>
              {sourceCount} sources
            </span>
            {busy ? (
              <button
                type="button"
                className="send-button stop-button"
                aria-label="Stop response"
                onClick={onStop}
              >
                <Icon name="stop" size={16} />
              </button>
            ) : (
              <button
                className="send-button"
                type="submit"
                aria-label="Send question"
                disabled={!canSend}
              >
                <Icon name="arrow" size={19} />
              </button>
            )}
          </div>
        </div>
      </form>
      <p className="composer-disclaimer">
        Source-based synthesis, not independent fact-checking.{' '}
        <span>Always read the reporting.</span>
      </p>
    </footer>
  )
}
