import { useEffect, useState } from 'react'

import { initialTheme, type Theme } from '../lib/theme'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return initialTheme(
        localStorage.getItem('news-theme'),
        matchMedia('(prefers-color-scheme: dark)').matches,
      )
    } catch {
      return 'light'
    }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('news-theme', theme)
    } catch {
      /* storage is optional */
    }
  }, [theme])
  return [theme, setTheme] as const
}
