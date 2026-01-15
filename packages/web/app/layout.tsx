import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI RAG - 前端代码搜索系统',
  description: '基于 Ollama 的前端代码 RAG 系统',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
