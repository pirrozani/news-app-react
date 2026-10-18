# Public deployment and dashboard controls

## Local development

Install dependencies with `npm ci`, then run `npm run dev`. The app is public and requires no sign-in. `.dev.vars` remains git-ignored and can optionally hold local overrides.

The Cloudflare Vite plugin runs the Worker and React together. Workers AI is remote even during local development: log in with Wrangler only when you intentionally want live inference. Inference uses account quotas and can incur charges. Loading the interface does not run inference. Offline tests mock AI and RSS.

Checks: `npm test`, `npm run test:browser`, `npm run lint`, `npm run build`, and `npm run cf-typegen` after binding changes. `npm run check:feeds` is an opt-in network check that sends a sample query to RSS providers but never calls Workers AI.

## Deploy for everyone

1. Use a Cloudflare account with Workers AI, Durable Objects, and rate-limit bindings available. Review quotas and pricing.
2. Review `wrangler.jsonc`. The deployment target is the existing **`news-app`** Worker, not the repository directory name. `workers_dev=true` enables the public deployed Worker URL. Preview URLs remain disabled.
3. Run `npx wrangler login` if needed, then `npm run deploy` when you are ready to publish. These are operator actions, not performed by offline tests.
4. Open the resulting `workers.dev` URL in an incognito window. There should be no sign-in or group prompt. Verify separate browsers do not share conversations.
5. Optionally add a custom domain through the dashboard.
6. Run a small approved live-model smoke test in Greek and English. Confirm no-evidence behavior when snippets are insufficient.

There are no inference credentials in the browser. Public access means visitors can consume the operator's Workers AI allocation. Monitor usage before broadly sharing the URL.

## Close or reopen from the Cloudflare dashboard

Go to **Workers & Pages → news-app → Settings → Variables and Secrets** (dashboard labels may change).

1. Add/edit the text variable **`APP_ENABLED`**.
2. Set its value to **`false`** and save/deploy the change to close the app.
3. Set it to **`true`** and save/deploy to reopen it.

The closed state applies to every hostname/route for this Worker, including the homepage, static assets, and API. New requests receive HTTP 503 and cannot start research or inference. Existing open tabs receive the closed message on their next API call. Already-submitted inference may still finish and consume usage: this is not an immediate cancellation of provider compute.

`APP_ENABLED` is intentionally omitted from Wrangler's `vars` and defaults to open when missing. `keep_vars=true` preserves dashboard-managed variables during normal Wrangler deployments, so redeploying code does not silently replace the dashboard switch. Do not add an overriding local `APP_ENABLED=true` entry to Wrangler config if you want to retain dashboard control. Invalid configured values fail closed.

If you instead disable a URL or remove a domain in the dashboard, ensure every other public URL is also disabled; the application switch is simpler because it covers all routes.

## Bindings and public protection

- `AI`: native Workers AI binding.
- `SESSIONS`: SQLite-backed session Durable Objects.
- `TURN_RATE_LIMITER`: 10 public questions per connection IP per 60 seconds at a Cloudflare location. Namespace `18272601` must be unique to this app in your account; change it if already used elsewhere.
- `APP_ENABLED`: dashboard-managed on/off switch.
- `PLANNER_MODEL` / `WRITER_MODEL`: initial candidate `@cf/ibm-granite/granite-4.0-h-micro`.

Public turn requests require Cloudflare's connection metadata and the rate-limit binding; if protection is unavailable they fail closed. Localhost development uses session-level limits instead. Mutating API requests require same-origin requests and appropriate JSON bodies. Cancel and Clear are not blocked by the public question rate limiter.

The app also bounds question size, source downloads, history, and model output; permits one active generation per browser session; and limits session request frequency. Rate limiting is best-effort/local/eventually consistent. Shared IPs may share the limit, and distributed abuse can evade it. These safeguards are not a hard account-wide spend cap or a complete bot-defense system. Use Cloudflare usage monitoring/platform controls, and consider Turnstile or WAF rules if abuse appears.

## Retention and logs

Conversations remain isolated by an unguessable HttpOnly session cookie, not shared between public visitors. Application data expires after two idle hours or Clear. Cloudflare recovery, metrics, and log retention are separate policies. Raw prompts, feed excerpts, and drafts are not logged by default. Operational errors do not expose raw provider exceptions. Full-article extraction, saved history, and user-configurable feeds need separate reviews.

## Search-engine indexing

Every Worker response, including HTML, assets, API streams, errors, and the closed page, carries `X-Robots-Tag: noindex, nofollow`. Static asset headers repeat that policy, and the HTML shell/closed page include a matching robots meta tag. This asks Google and other compliant search engines not to index the app or follow links from its pages, across both `workers.dev` and custom hostnames.

Do not add `Disallow: /` in `robots.txt` or another crawl block if you want Google to discover the `noindex` directive: blocked crawlers cannot read the page's headers/meta tags. Crawl permission is not indexing permission. The app stays public; these directives are not access control and do not stop non-compliant bots.

Deploy the change before checking the live URL. Existing search results may remain until recrawled; use Google Search Console's removal tool if you need faster temporary removal, keeping `noindex` in place for the long term.

## Durable Object namespace conflict (10065)

The existing namespace is named `news-app-react_NewsSession`, but its owning Worker is **`news-app`**. Namespace display names can retain an older Worker name. The namespace uses SQLite, class `NewsSession`, and migration `v1` is already applied to the owner.

Deploying a new Worker named `news-app-react` tries to create that same namespace display name and fails with error 10065. Deploy into the owner, `news-app`, with the existing class and `v1` migration unchanged. This reuses the namespace rather than deleting it or starting new session storage.

Use `npm run deploy`, which rebuilds first. Vite generates a redirected deploy configuration under `dist/`; a bare Wrangler invocation after changing the source Worker name can still use an old build. To validate the configuration without publishing:

```sh
npm run build
npx wrangler deploy --dry-run
```

Do not delete the namespace, introduce a new creation tag, or rename the class merely to silence this error: those actions can lose access to existing session data or affect another Worker.
