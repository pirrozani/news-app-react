import { test, expect } from '@playwright/test'

test('initializes one session despite Strict Mode effect replay', async ({
  page,
}) => {
  await expect(page.getByText('Session only', { exact: true })).toBeVisible()
  let sessionRequests = 0
  await page.route('**/api/session', (route) => {
    sessionRequests++
    return route.fulfill({
      json: { messages: [], failedTurn: null, busy: false },
    })
  })
  await page.reload()
  await expect(page.getByText('Session only', { exact: true })).toBeVisible()
  expect(sessionRequests).toBe(1)
})

test('keeps an explicitly saved light theme after reload', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('news-theme', 'light'))
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('releases modal focus isolation when resized to desktop', async ({
  page,
}, info) => {
  if (info.project.name !== 'mobile') return
  await page.getByRole('button', { name: 'Open settings' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Desk settings' }),
  ).toBeVisible()
  await expect(page.locator('main')).toHaveAttribute('inert', '')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('main')).not.toHaveAttribute('inert', '')
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    'hidden',
  )
})

test('selects recovered report evidence when a running session finishes', async ({
  page,
}, info) => {
  let reads = 0
  await page.route('**/api/session', (route) => {
    reads++
    return route.fulfill({
      json:
        reads === 1
          ? { messages: [], busy: true, failedTurn: null }
          : {
              messages: [
                {
                  id: 'recovered:answer',
                  role: 'assistant',
                  content: 'Recovered progress [S1].',
                  sources: [source],
                  createdAt: '2026-10-18T12:00:00Z',
                },
              ],
              busy: false,
              failedTurn: null,
            },
    })
  })
  await page.reload()
  await expect(
    page.getByText('Recovered progress', { exact: false }),
  ).toBeVisible()
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'Open source inspector' }).click()
  await expect(page.getByText(source.title, { exact: true })).toBeVisible()
  await expect(page.getByText(source.content, { exact: true })).toBeVisible()
})

const source = {
  id: 'S1',
  title: 'Fusion experiment reports a milestone',
  outlet: 'Example Science',
  url: 'https://example.com/fusion',
  publishedAt: '2026-10-17T10:00:00Z',
  retrievedAt: '2026-10-18T12:00:00Z',
  content:
    'Researchers reported progress in a fusion experiment. Further testing is needed before commercial use.',
  evidence: 'feed-excerpt',
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    if (route.request().url().endsWith('/api/turn')) {
      const input = route.request().postDataJSON()
      const events = [
        {
          type: 'status',
          stage: 'researching',
          detail: 'Searching RSS: fusion energy',
        },
        {
          type: 'sources',
          sources: [source],
          warnings: [],
          query: 'fusion energy',
          reused: false,
        },
        { type: 'draft_delta', text: 'Researchers reported progress [S1].' },
        {
          type: 'completed',
          message: {
            id: `${input.id}:answer`,
            role: 'assistant',
            content: 'Researchers reported progress [S1].',
            sources: [source],
            query: 'fusion energy',
            warnings: [
              'Evidence is limited to RSS excerpts, not full articles.',
            ],
            reused: false,
            createdAt: '2026-10-18T12:00:00Z',
          },
        },
      ]
      await route.fulfill({
        contentType: 'text/event-stream',
        body: events
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(''),
      })
    } else
      await route.fulfill({
        json: { messages: [], failedTurn: null, busy: false },
      })
  })
  await page.goto('/')
})

test('renders the editorial desk, uses editable suggestions, and inspects citations', async ({
  page,
}, info) => {
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex, nofollow',
  )
  await expect(page.getByRole('heading', { name: /go beyond/i })).toBeVisible()
  await expect(page.getByText('Session only', { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('empty.png'), fullPage: true })
  await page.getByRole('button', { name: /what’s new in fusion/i }).click()
  await expect(page.getByLabel('Ask a news question or follow up')).toHaveValue(
    'What is the latest news about fusion energy?',
  )
  await page.getByRole('button', { name: 'Send question' }).click()
  await expect(
    page.getByText('Researchers reported progress', { exact: false }).first(),
  ).toBeVisible()
  await page.getByRole('button', { name: /inspect source S1/i }).click()
  await expect(
    page.getByText('Fusion experiment reports a milestone', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Read source' })).toHaveAttribute(
    'href',
    source.url,
  )
  await expect(page.getByText(source.content, { exact: true })).toBeVisible()
  if (info.project.name === 'mobile') {
    await expect(
      page.getByRole('dialog', { name: 'Source inspector' }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({ path: info.outputPath('report.png'), fullPage: true })
})

test('shows safe errors and retries the same question without duplicating it', async ({
  page,
}) => {
  await page.route('**/api/turn', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ type: 'failed', error: 'Feed unavailable. Please retry.' })}\n\n`,
    }),
  )
  await page
    .getByLabel('Ask a news question or follow up')
    .fill('Latest fusion news')
  await page.getByRole('button', { name: 'Send question' }).click()
  await expect(page.getByRole('alert')).toContainText('Feed unavailable')
  await page.getByRole('button', { name: 'Retry question' }).click()
  await expect(
    page.getByRole('heading', { name: 'Latest fusion news', exact: true }),
  ).toHaveCount(1)
  await expect(page.locator('a[href*="evil"]')).toHaveCount(0)
})

test('persists theme selection and keeps settings keyboard-accessible', async ({
  page,
}, info) => {
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'Open settings' }).click()
  const button = page.getByRole('button', { name: /switch to .* theme/i })
  const label = await button.getAttribute('aria-label')
  await button.click()
  const expected = label?.includes('dark') ? 'dark' : 'light'
  await expect(page.locator('html')).toHaveAttribute('data-theme', expected)
  if (info.project.name === 'mobile') await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', expected)
})

test('does not send questions while the operator has closed the app', async ({
  page,
}) => {
  let turns = 0
  await page.route('**/api/session', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'The news desk is temporarily closed.' },
    }),
  )
  await page.route('**/api/turn', (route) => {
    turns++
    return route.abort()
  })
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('temporarily closed')
  await page.getByLabel('Ask a news question or follow up').fill('Latest news')
  await expect(
    page.getByRole('button', { name: 'Send question' }),
  ).toBeDisabled()
  expect(turns).toBe(0)
})
