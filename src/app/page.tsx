import { redirect } from 'next/navigation'

// 當 Supabase 密碼重設信 redirect 回根目錄（帶 ?code=xxx）時，
// 轉送到 callback 路由來交換 session，再導到 /set-password
export default function Home({
  searchParams,
}: {
  searchParams: { code?: string; type?: string }
}) {
  if (searchParams.code) {
    // recovery / invite 流程 → set-password
    // 其他流程也走 callback，callback 會處理完 session 後再決定去哪
    redirect(`/api/auth/callback?code=${searchParams.code}&next=/set-password`)
  }
  redirect('/dashboard')
}
