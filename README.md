# Newsdesk

A public, source-grounded news assistant built with React, TypeScript, Cloudflare Workers, and Workers AI. Anyone can use it without signing in; each browser has its own isolated conversation. An editorial workspace pairs concise reports with an inspectable source inventory.

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

## Small model, bounded work

- Initial Planner/Journalist candidate: `@cf/ibm-granite/granite-4.0-h-micro`.
- No model call for first-query routing, explicit updates, or unambiguous rewrites.
- Planner output: 96 tokens; writer output: 768 tokens.
- Default: three sources, 1,000 excerpt characters each, six bounded context messages.
- Research and citation checks are ordinary code, not autonomous agents.

**Greek quality and citation compliance require live evaluation before production approval.** No live inference or deployment is required by the test suite.

## Evidence limitations

Google News RSS is key-free, not guaranteed. Many summaries only repeat headlines; those results are omitted. Answers use meaningful feed excerpts, **not full articles**. Empty evidence returns an honest no-evidence response without invoking the writer. Citation checks establish link provenance, not independent fact-checking.

When Google News supplies no usable excerpts, the app searches Bing News RSS. If neither search feed supplies useful evidence, it checks matching recent entries in approved BBC/Guardian or ERT/in.gr feeds. Publisher fallback is limited feed coverage, not full-web search. Search queries are sent to the news providers. Research only fetches approved RSS endpoints; arbitrary article fetching and full-article extraction are not supported.

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
