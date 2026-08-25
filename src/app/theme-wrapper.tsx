'use client'

import { ThemeProvider } from '@/lib/theme-context'

export function ThemeProviderWrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>
}
