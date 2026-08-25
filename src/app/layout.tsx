import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ThemeProviderWrapper } from './theme-wrapper'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Draco LOP — 登泰國際物流營運管理平台',
  description: '登泰國際物流營運管理平台 (Draco Logistic Operation Platform) · 登泰國際物流股份有限公司',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#1e3a5f',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        {/* 防止 dark mode 閃白：在 HTML render 前先檢查 localStorage */}
        <script dangerouslySetInnerHTML={{ __html: `
          try { if(localStorage.getItem('draco-dark-mode')==='1') document.documentElement.classList.add('dark') } catch(e){}
        `}} />
      </head>
      <body className={inter.className}>
        <ThemeProviderWrapper>{children}</ThemeProviderWrapper>
      </body>
    </html>
  )
}
