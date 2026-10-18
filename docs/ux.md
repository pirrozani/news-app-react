# Editorial workspace UX

## Layout

Warm paper surfaces, ink-colored text, restrained green accents, serif editorial headings, and system sans-serif controls. No external font or image requests are required. Light and dark themes use the same spacing and contrast hierarchy.

- Left rail: brand, new conversation, language/region, source count, and theme.
- Main workspace: date, session status, introduction or conversation, progress, sticky composer.
- Right inspector: the selected answer's original sources with evidence labels, publication/retrieval times, and excerpts. Never silently replace an earlier answer's inventory with the latest search.
- Narrow screens: hide the rail behind a settings control and display the inspector as an accessible drawer.

## States

Empty state offers editable example prompts, not fake current headlines. Planning, researching, writing, and validating are explicit stages. Announce stage changes, not every streamed token. Stream plain text with no automatic hyperlinks. Completed citation buttons select and highlight a source. Warnings distinguish snippet-only evidence from feed failures.

Failed or canceled requests retain a single user question, remove the provisional draft, and offer retry. Cancellation and Clear must stop the server turn, not merely hide it. Clear is an intentional destructive action; confirm when a conversation exists. Users do not need to sign in. If the operator closes the app or a rate limit is reached, show an actionable message.

## Accessibility

Semantic landmarks and form labels; visible keyboard focus; source selection by keyboard; Escape closes mobile drawers; preserve and restore drawer focus; reduced-motion support; touch targets of at least 40px; no color-only status indicators. Avoid forced auto-scroll when the reader has scrolled away from the bottom. User text and model output are React text nodes, never raw HTML.

## Trust language

Use “source-grounded” and “feed excerpt,” never “verified facts” or “full article” for RSS evidence. Explain that RSS availability is best-effort and that synthesis is not independent fact-checking. Show publication and retrieval times separately. Make evidence reuse visible.
