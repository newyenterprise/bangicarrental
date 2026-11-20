import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Runs before matched requests:
 *  - redirects www to the canonical host,
 *  - refreshes the Supabase session cookie when one is present.
 * Authorisation itself is always checked again in the page or action.
 */
export async function proxy(request: NextRequest) {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
  if (host.startsWith('www.')) {
    const url = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${host.slice(4)}`);
    return NextResponse.redirect(url, 308);
  }

  let response = NextResponse.next({ request });
  const hasSession = request.cookies.getAll().some((c) => c.name.startsWith('sb-'));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!hasSession || !url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|vehicles/|api/health|api/stripe/webhook|api/cron/).*)'],
};
