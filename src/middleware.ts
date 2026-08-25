import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options })
          response = NextResponse.next({
            request: { headers: request.headers },
          })
          response.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options })
          response = NextResponse.next({
            request: { headers: request.headers },
          })
          response.cookies.set({ name, value: '', ...options })
        },
      },
    }
  )

  const { data: { session } } = await supabase.auth.getSession()

  // Public paths that don't require login
  // /assess/[code] 是公開作答頁，任何人都能進
  const publicPaths = ['/login', '/set-password', '/auth', '/assess']
  const isPublic = publicPaths.some(p => request.nextUrl.pathname.startsWith(p))

  // 若 URL 帶 ?code=xxx（Supabase 密碼重設 / 邀請信回流）
  // 不管路徑是哪裡，直接轉送給 /api/auth/callback 處理
  const code = request.nextUrl.searchParams.get('code')
  if (code && !request.nextUrl.pathname.startsWith('/api/auth/callback')) {
    const callbackUrl = request.nextUrl.clone()
    callbackUrl.pathname = '/api/auth/callback'
    callbackUrl.searchParams.set('next', '/set-password')
    return NextResponse.redirect(callbackUrl)
  }

  // If not logged in and not on a public page, redirect to login
  if (!session && !isPublic) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/login'
    return NextResponse.redirect(redirectUrl)
  }

  // 已登入：確認 users.is_active 還是 true（離職員工 is_active=false 應立即被擋）
  if (session && !isPublic) {
    const { data: profile } = await supabase
      .from('users')
      .select('is_active')
      .eq('id', session.user.id)
      .maybeSingle()

    if (profile && profile.is_active === false) {
      // 走 /api/auth/signout 清 cookies 後跳轉 /login
      const redirectUrl = request.nextUrl.clone()
      redirectUrl.pathname = '/api/auth/signout'
      redirectUrl.search = ''
      return NextResponse.redirect(redirectUrl)
    }
  }

  // If logged in and on login page, redirect to home
  if (session && request.nextUrl.pathname.startsWith('/login')) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/customers'
    return NextResponse.redirect(redirectUrl)
  }

  return response
}

export const config = {
  // Exclude all /api/* routes (they handle their own auth) and static assets
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|icon-.*\\.png|api/).*)'],
}
