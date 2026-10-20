# Newsdesk

Newsdesk is a news chat app. Ask a question, and it finds news excerpts, then uses AI to write a short report with sources you can inspect. No account is needed, and each browser session has its own conversation.

## Try it

The app is live at **[https://news-app.pirrozani.workers.dev](https://news-app.pirrozani.workers.dev/)**. No account is needed. Open the link and ask a news question.

## How the app works

1. **You ask a question.** For example: "What is the latest news about renewable energy in Europe?" You can choose English or Greek news feeds and request two to six sources. The default is three.
2. **The app decides whether to search.** A first question or a request for the latest news needs a search. A follow-up such as "shorten that" can reuse the previous sources. AI helps decide when a follow-up is unclear.
3. **The app collects news excerpts.** It searches Google News RSS, then Bing News RSS if Google has no useful excerpts. RSS feeds are lists of news items with titles, links, and short descriptions. If neither search works, the app checks selected BBC/Guardian or ERT/in.gr feeds for matching items. It skips descriptions that only repeat a headline.
4. **AI writes a short report.** It receives your question, some recent conversation history, and the collected excerpts. It is told to use only that evidence, answer in your language, and cite sources using labels such as `[S1]`.
5. **The app checks the answer.** Regular code checks that the answer finished, includes citations, and does not contain unknown source labels or AI-written links. Incomplete or rejected drafts are not saved as answers; you can retry the question.
6. **You read the report and inspect its sources.** Text appears as it is written, but it remains a draft until the checks pass. Select a citation to see the source details and its link.

```text
Your question → Decide whether to search → Collect excerpts → AI writes → Check answer → Show report
```

If no useful excerpts are found, the app says it cannot answer from the available news and skips AI writing. It does not replace missing news with an answer from the model's memory.

## Where AI helps

AI has two jobs:

- **Planner:** helps interpret unclear follow-up questions. It returns either a short search query or a decision to reuse the current sources. Clear cases use simple rules instead of an AI call.
- **Journalist:** turns the collected excerpts into a short, readable report. It can also rewrite or summarize a previous report using the same evidence.

AI does **not** fetch news or check citations. Regular code handles those tasks. The labels "Planner" and "Journalist" describe two roles in a fixed workflow, not independent agents browsing the web.

## The main parts

- **React and TypeScript:** the browser interface, including the chat, settings, and source viewer.
- **Cloudflare Worker:** the server that handles questions, retrieves news, requests AI output, and checks answers.
- **Cloudflare Workers AI:** runs the language model on Cloudflare, not in your browser.
- **Cloudflare Durable Object:** keeps each browser session's temporary conversation and sources separate. The app's stored conversation expires after two hours without activity, and you can clear it sooner.

## Local setup

```sh
npm ci
```

Start the local app:

```sh
npm run dev
```

Workers AI inference is remote even during local development and can incur charges. Loading the interface does not run inference. Tests mock external services and need no Cloudflare credentials. `.dev.vars.example` contains optional local settings.

## Open to everyone, controlled from your dashboard

The app is public and requires no sign-in. Inference requests have basic connection/session rate limits.

Pages and responses include `noindex, nofollow` directives for Google and other compliant search engines. This does not make the app private or block direct visitors.

To close it, go to **Cloudflare → Workers & Pages → news-app → Settings → Variables and Secrets**, set **`APP_ENABLED=false`**, and save/deploy. Set **`APP_ENABLED=true`** to reopen. The switch blocks all new page/API requests, not just one hostname; already-submitted inference may still finish. Dashboard settings are preserved on normal deployments with `keep_vars=true`.

## Keeping AI work small

- The default model for both roles is IBM Granite Micro: `@cf/ibm-granite/granite-4.0-h-micro`. Each role can use a different configured model.
- The app skips the Planner AI call for first questions, clear requests for fresh news, and clear rewrites. Writing a report still needs an AI call when usable evidence exists.
- Output limits are 96 tokens for the Planner and 768 for the Journalist. Tokens are the small pieces of text a model reads and writes.
- By default, the Journalist gets three sources, up to 1,000 excerpt characters per source, and up to six recent messages of 2,000 characters each.
- There are no automatic rewrite loops or automatic switches to more expensive models.

**Greek quality and citation compliance require live evaluation before production approval.** No live inference or deployment is required by the test suite.

## Configuration

Edit `worker/config.ts` for server-side defaults: planner/writer models, token
budgets, temperatures, context limits, feed download timeout/size, excerpt length,
approved publisher feeds, turn timeout, and session retention/history limits.
Current behavior is unchanged by the centralized defaults.

`PLANNER_MODEL` and `WRITER_MODEL` are optional independent environment overrides.
Set them in `.dev.vars` locally (see `.dev.vars.example`), Wrangler's `vars`, or
Cloudflare's **Variables and Secrets** for deployment. Missing or blank values use
the defaults. With `keep_vars=true`, existing dashboard model overrides survive
deployments and take precedence over `worker/config.ts`; remove them to use the
code defaults. Changing code defaults or Wrangler settings requires a deployment.

Keep bindings and connection rate limits in `wrangler.jsonc`. `APP_ENABLED` remains
the dashboard shutdown switch. Feed URLs are trusted operator configuration, never
user input; only exact configured URLs are fetched, without following redirects.
Protocol markers, request validation, and citation safety rules remain in code.

## Evidence limitations

The app reads **RSS excerpts, not full articles**. Excerpts can leave out important context, and the AI can still make mistakes. Citation checks confirm that source labels match the collected sources; they do **not** prove that every claim is supported or true. Open the original sources when accuracy matters.

The news feeds need no API key, but access is not guaranteed. Publisher-feed fallback only covers matching items in the selected feeds, not the whole web. Search queries are sent to the news providers. The server fetches only approved RSS feeds; it does not download article pages or fetch arbitrary URLs.

## Checks

```sh
npm test
npm run lint
npm run build
npm run cf-typegen
```

Browser tests mock the API and run against local Vite:

```sh
npx playwright install chromium
npm run test:browser
```

For an opt-in **live RSS check in the actual Worker runtime**, without calling Workers AI:

```sh
npm run check:feeds
```

This sends a sample renewable-energy query to the news feeds and reports retrieval/parsing results. It is separate from the offline test suite.

## Repository layout and maintenance

- `src/components/`: conversation presentation and shared UI controls.
- `src/hooks/`: session lifecycle, theme, responsive drawers, and scrolling.
- `src/lib/`: browser API transport and display helpers.
- `src/styles/`: global theme tokens and desk styling.
- `worker/ai/`: rules-first routing, writing, and inference transport.
- `worker/http/`: same-origin checks and bounded request parsing.
- `worker/research/`: approved RSS retrieval, parsing, and fallback selection.
- `shared/`: browser/Worker contracts and SSE parsing.
- `tests/`, `e2e/`, `checks/`: offline tests, browser tests, and opt-in live feed checks.

Run `npm run format` to format source, or `npm run check` to check formatting,
lint, types, and offline tests. Run browser tests and the production build separately.
Generated build output, local secrets, test reports, coverage, and TypeScript
build caches stay ignored. Keep `worker-configuration.d.ts` tracked: clean
checkouts need its Cloudflare runtime declarations before type checking.

## Further documentation

- [System architecture](docs/architecture.md)
- [Agent contracts and model policy](docs/agents.md)
- [Editorial UX](docs/ux.md)
- [Public deployment, dashboard shutdown, and operations](docs/deployment.md)

Deployment is an explicit operator action. The public `workers.dev` URL is enabled; preview URLs remain disabled. Public access uses your Cloudflare allocation: monitor usage, and do not treat basic rate limiting as a hard spending cap.

The Cloudflare deployment target is the existing **`news-app`** Worker, even though this repository is named `news-app-react`. Its existing `v1` migration and `NewsSession` namespace are reused; do not change the Worker name to match the repository directory.
