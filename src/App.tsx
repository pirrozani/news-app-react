import { useRef, useState } from 'react'
import type { Locale, Message, Source } from '../shared/contracts'
import { Icon } from './components/ui/Icon'
import { Conversation } from './components/conversation/Conversation'
import { TurnProgress } from './components/conversation/TurnProgress'
import { Composer } from './components/conversation/Composer'
import { SourceCard } from './components/sources/SourceCard'
import { useTheme } from './hooks/useTheme'
import { useDrawer } from './hooks/useDrawer'
import { useAutoScroll } from './hooks/useAutoScroll'
import { useNewsSession } from './hooks/useNewsSession'
import './styles/desk.css'

const suggestions = [
  {
    category: 'SCIENCE & TECH',
    title: 'What’s new in fusion energy?',
    prompt: 'What is the latest news about fusion energy?',
  },
  {
    category: 'GREECE',
    title: 'A closer look at Greek news',
    prompt: 'Ποιες είναι οι τελευταίες ειδήσεις για την ελληνική οικονομία;',
  },
  {
    category: 'CLIMATE',
    title: 'Follow the energy transition',
    prompt: 'What is the latest news about renewable energy in Europe?',
  },
]

function App() {
  const desk = useNewsSession()
  const {
    session,
    loading,
    connected,
    running,
    clearing,
    busy,
    stage,
    detail,
    draft,
    error,
    selectedMessage,
    setSelectedMessage,
    selectedSource,
    setSelectedSource,
    pendingSources,
    stop,
  } = desk
  const [question, setQuestion] = useState('')
  const [locale, setLocale] = useState<Locale>('auto')
  const [sourceCount, setSourceCount] = useState(3)
  const [theme, setTheme] = useTheme()
  const { drawer, setDrawer, settingsRef, sourcesRef } = useDrawer()
  const [confirmClear, setConfirmClear] = useState(false)
  const [today] = useState(() =>
    new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(new Date()),
  )
  const composer = useRef<HTMLTextAreaElement>(null)
  const { bottom, followBottom } = useAutoScroll(
    draft,
    running,
    session.messages.length,
  )
  const currentMessage = session.messages.find(
    (message) => message.id === selectedMessage,
  )
  const sources = currentMessage?.sources ?? pendingSources
  const completed = session.messages.filter(
    (message) => message.role === 'assistant',
  )

  function selectSource(message: Message, source?: Source) {
    setSelectedMessage(message.id)
    setSelectedSource(source?.id ?? null)
    if (matchMedia('(max-width: 1199px)').matches) setDrawer('sources')
  }

  async function submit(text: string, retryId?: string) {
    await desk.submit(text, locale, sourceCount, retryId, () => {
      setQuestion('')
      followBottom.current = true
    })
    composer.current?.focus()
  }

  async function newConversation() {
    if (busy || clearing) return
    if (session.messages.length && !confirmClear) {
      setConfirmClear(true)
      return
    }
    if (await desk.clear()) {
      setQuestion('')
      setConfirmClear(false)
      setDrawer(null)
      composer.current?.focus()
    }
  }

  return (
    <div className="desk-layout">
      <a className="skip-link" href="#composer">
        Skip to question
      </a>
      {drawer && (
        <div
          className="drawer-backdrop"
          onClick={() => setDrawer(null)}
          aria-hidden="true"
        />
      )}
      <aside
        ref={settingsRef}
        className={`rail ${drawer === 'settings' ? 'drawer-open' : ''}`}
        aria-label="Desk settings"
        role={drawer === 'settings' ? 'dialog' : undefined}
        aria-modal={drawer === 'settings' ? true : undefined}
      >
        <div className="brand">
          <div className="brand-mark">
            n<span>·</span>
          </div>
          <div>
            newsdesk<span>AN INDEPENDENT PERSPECTIVE</span>
          </div>
          <button
            className="icon-button drawer-close"
            aria-label="Close settings"
            onClick={() => setDrawer(null)}
          >
            <Icon name="close" />
          </button>
        </div>
        <button
          className="new-conversation"
          onClick={() => void newConversation()}
          disabled={busy || clearing || !connected}
        >
          <Icon name="plus" />
          New conversation<kbd>↗</kbd>
        </button>
        {confirmClear && (
          <div className="clear-confirm">
            <p>Clear this conversation and its source history?</p>
            <div>
              <button onClick={() => void newConversation()}>Yes, clear</button>
              <button onClick={() => setConfirmClear(false)}>Keep it</button>
            </div>
          </div>
        )}
        <div className="rail-section">
          <div className="eyebrow">YOUR WORKSPACE</div>
          <div className="workspace-item">
            <Icon name="book" />
            <span>Research desk</span>
            <span className="small-dot" />
          </div>
          <p className="rail-hint">
            One question. Multiple sources.
            <br />A clearer picture.
          </p>
        </div>
        <div className="rail-section preferences">
          <div className="eyebrow">RESEARCH PREFERENCES</div>
          <label htmlFor="locale">Language & region</label>
          <select
            id="locale"
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
            disabled={busy}
          >
            <option value="auto">Automatic · Greek / English</option>
            <option value="el-GR">Greek · Greece</option>
            <option value="en-US">English · United States</option>
          </select>
          <label htmlFor="source-count">
            Sources per report{' '}
            <span>{sourceCount.toString().padStart(2, '0')}</span>
          </label>
          <input
            id="source-count"
            type="range"
            min="2"
            max="6"
            value={sourceCount}
            onChange={(event) => setSourceCount(Number(event.target.value))}
            disabled={busy}
          />
          <div className="range-labels">
            <span>Focused</span>
            <span>Broader view</span>
          </div>
        </div>
        <div className="rail-bottom">
          <div className="model-note">
            <span className="small-dot" />
            <div>
              Small model. Focused work.
              <small>Workers AI · bounded inference</small>
            </div>
          </div>
          <div className="rail-footer">
            <span>
              <Icon name="check" size={14} />
              Your browser session
            </span>
            <button
              className="icon-button"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
          </div>
        </div>
      </aside>

      <main className="workspace" aria-busy={loading}>
        <header className="topbar">
          <div className="mobile-brand">
            newsdesk<span>·</span>
          </div>
          <span className="desktop-label">THE RESEARCH DESK</span>
          <div className="topbar-actions">
            <span className="session-badge">
              <span className="small-dot" />
              {loading
                ? 'Connecting'
                : connected
                  ? 'Session only'
                  : 'Setup needed'}
            </span>
            <button
              className="icon-button mobile-settings"
              aria-label="Open settings"
              onClick={() => setDrawer('settings')}
            >
              <Icon name="settings" />
            </button>
            <button
              className="icon-button mobile-sources"
              aria-label="Open source inspector"
              onClick={() => setDrawer('sources')}
            >
              <Icon name="book" />
            </button>
          </div>
        </header>
        <div
          className={`workspace-body ${session.messages.length ? 'has-messages' : ''}`}
        >
          <div className="edition">
            <span>{today}</span>
            <span>CONTEXT, NOT NOISE</span>
          </div>
          {!session.messages.length && (
            <section className="welcome">
              <div className="welcome-kicker">
                <span className="line" />
                YOUR WORLD, IN CONTEXT
              </div>
              <h1>
                Go beyond
                <br />
                the <em>headline.</em>
              </h1>
              <p>
                Ask what’s happening. Explore the sources.
                <br className="desktop-break" /> Find the context that makes the
                news make sense.
              </p>
              <div className="suggestion-grid">
                {suggestions.map((item) => (
                  <button
                    className="suggestion"
                    key={item.category}
                    onClick={() => {
                      setQuestion(item.prompt)
                      composer.current?.focus()
                    }}
                  >
                    <span className="eyebrow">{item.category}</span>
                    <span>{item.title}</span>
                    <Icon name="chevron" size={16} />
                  </button>
                ))}
              </div>
              <div className="how-it-works">
                <span>
                  <b>01</b> Ask a question
                </span>
                <span>
                  <b>02</b> Explore reporting
                </span>
                <span>
                  <b>03</b> See the sources
                </span>
              </div>
            </section>
          )}
          <Conversation messages={session.messages} onSource={selectSource} />
          {busy && (
            <TurnProgress
              stage={stage}
              running={running}
              detail={detail}
              draft={draft}
            />
          )}
          {(error || session.failedTurn?.error) && (
            <div className="error-panel" role="alert">
              <p>{error || session.failedTurn?.error}</p>
              <div>
                {session.failedTurn && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void submit(
                        session.failedTurn!.question,
                        session.failedTurn!.id,
                      )
                    }
                  >
                    <Icon name="refresh" size={15} />
                    Retry question
                  </button>
                )}
                {!connected && (
                  <button onClick={() => location.reload()}>
                    <Icon name="refresh" size={15} />
                    Reload after setup
                  </button>
                )}
              </div>
            </div>
          )}
          <div ref={bottom} />
        </div>
        <Composer
          inputRef={composer}
          question={question}
          onQuestion={setQuestion}
          onSubmit={() => void submit(question)}
          onStop={() => void stop()}
          sourceCount={sourceCount}
          hasMessages={!!session.messages.length}
          loading={loading}
          busy={busy}
          canSend={!!question.trim() && connected && !busy && !clearing}
        />
      </main>

      <aside
        ref={sourcesRef}
        className={`source-inspector ${drawer === 'sources' ? 'drawer-open' : ''}`}
        aria-label="Source inspector"
        role={drawer === 'sources' ? 'dialog' : undefined}
        aria-modal={drawer === 'sources' ? true : undefined}
      >
        <header className="inspector-header">
          <div>
            <Icon name="book" size={17} />
            <h2>The source desk</h2>
          </div>
          <span className="source-total">
            {sources.length.toString().padStart(2, '0')}
          </span>
          <button
            className="icon-button drawer-close"
            aria-label="Close source inspector"
            onClick={() => setDrawer(null)}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="inspector-body">
          {sources.length ? (
            <>
              <div className="source-context">
                <span className="eyebrow">BEHIND THIS REPORT</span>
                <p>
                  {currentMessage?.reused
                    ? 'Previous evidence, revisited.'
                    : 'The evidence behind the answer.'}
                </p>
                {currentMessage?.query && (
                  <small>Query: {currentMessage.query}</small>
                )}
              </div>
              {sources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source}
                  selected={source.id === selectedSource}
                  onSelect={() => setSelectedSource(source.id)}
                />
              ))}
            </>
          ) : (
            <div className="sources-empty">
              <div className="empty-illustration">
                <span />
                <span />
                <span />
                <Icon name="book" size={28} />
              </div>
              <h3>
                Every story
                <br />
                starts with a source.
              </h3>
              <p>
                Ask a question and the reporting behind your answer will appear
                here.
              </p>
              <div className="empty-rule" />
              <span className="eyebrow">OPEN. INSPECT. UNDERSTAND.</span>
            </div>
          )}
          {completed.length > 1 && (
            <label className="report-selector">
              Inspect an earlier report
              <select
                value={selectedMessage ?? ''}
                onChange={(event) => {
                  setSelectedMessage(event.target.value)
                  setSelectedSource(null)
                }}
              >
                <option value="" disabled>
                  Select a report
                </option>
                {completed.map((message, index) => (
                  <option key={message.id} value={message.id}>
                    Report {index + 1} · {message.query?.slice(0, 35)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="inspector-note">
          <span className="small-dot" />
          <p>
            Evidence, with its limits.
            <br />
            <span>
              RSS excerpts aren’t full articles. Dates and source links help you
              look closer.
            </span>
          </p>
        </div>
      </aside>
    </div>
  )
}

export default App
