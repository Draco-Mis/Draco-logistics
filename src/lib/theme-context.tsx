'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

interface ThemeContextType {
  dark: boolean
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextType>({ dark: false, toggle: () => {} })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false)

  // 初始化：讀 localStorage 偏好
  // 本分支（科技感戰情室預覽）預設為深色；使用者仍可手動切回日間。
  useEffect(() => {
    const saved = localStorage.getItem('draco-dark-mode')
    if (saved === '0') {
      setDark(false)
      document.documentElement.classList.remove('dark')
    } else {
      setDark(true)
      document.documentElement.classList.add('dark')
    }
  }, [])

  function toggle() {
    setDark(prev => {
      const next = !prev
      if (next) {
        document.documentElement.classList.add('dark')
        localStorage.setItem('draco-dark-mode', '1')
      } else {
        document.documentElement.classList.remove('dark')
        localStorage.setItem('draco-dark-mode', '0')
      }
      return next
    })
  }

  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
