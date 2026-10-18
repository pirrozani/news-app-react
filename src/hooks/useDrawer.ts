import { useEffect, useRef, useState } from 'react'

export function useDrawer() {
  const [drawer, setDrawer] = useState<'settings' | 'sources' | null>(null)
  const settingsRef = useRef<HTMLElement>(null)
  const sourcesRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!drawer) return
    const returnFocus = document.activeElement as HTMLElement | null
    const panel =
      drawer === 'settings' ? settingsRef.current : sourcesRef.current
    const breakpoint = matchMedia(
      drawer === 'settings' ? '(max-width: 767px)' : '(max-width: 1199px)',
    )
    if (!breakpoint.matches || !panel) {
      setDrawer(null)
      return
    }
    const background = Array.from(panel.parentElement?.children ?? []).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element !== panel &&
        !element.classList.contains('drawer-backdrop'),
    )
    const previousInert = background.map((element) => element.inert)
    background.forEach((element) => {
      element.inert = true
    })
    const focusable = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, select, a[href], input, textarea, [tabindex="0"]',
        ),
      ).filter(
        (item) =>
          !item.hasAttribute('disabled') && item.getClientRects().length,
      )
    focusable()[0]?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawer(null)
      if (event.key !== 'Tab') return
      const items = focusable()
      const first = items[0],
        last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    const resize = () => {
      if (!breakpoint.matches) setDrawer(null)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', keydown)
    breakpoint.addEventListener('change', resize)
    return () => {
      document.body.style.overflow = previousOverflow
      background.forEach((element, index) => {
        element.inert = previousInert[index]
      })
      document.removeEventListener('keydown', keydown)
      breakpoint.removeEventListener('change', resize)
      if (returnFocus?.isConnected && returnFocus.getClientRects().length)
        returnFocus.focus()
    }
  }, [drawer])
  return { drawer, setDrawer, settingsRef, sourcesRef }
}
