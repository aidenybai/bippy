import { NextResponse, type NextRequest } from "next/server";

const LOCALE_COOKIE = "Preferred-Locale";

export const config = { matcher: ["/((?!.*skipped).*)"] };

export function middleware(request: NextRequest) {
  const requested = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = requested ?? "en";
  const response = NextResponse.next({ request: { headers: new Headers(request.headers) } });
  response.headers.set("X-Locale", locale);
  if (requested !== locale) {
    response.cookies.set(LOCALE_COOKIE, locale, { sameSite: "strict" });
  }
  return response;
}
