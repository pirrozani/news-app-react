import { useEffect, useRef } from 'react'

export function useAutoScroll(
  draft: string,
  running: boolean,
  messageCount: number,
) {
  const bottom = useRef<HTMLDivElement>(null)
  const followBottom = useRef(true)
  useEffect(() => {
    const onScroll = () => {
      followBottom.current =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 180
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    if (followBottom.current && (running || messageCount))
      bottom.current?.scrollIntoView({ behavior: 'instant', block: 'end' })
  }, [draft, running, messageCount])
  return { bottom, followBottom }
}
