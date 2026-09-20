import { NextResponse, type NextRequest } from "next/server";

// Optional access gate for a public deployment. When BLANKETT_ACCESS_KEY is set, a visitor must
// arrive once with `?key=<value>` (the link that is shared); a cookie then admits them for 30 days.
// Unset, the gate is off and nothing changes for local development.
//
// Twilio fetches TwiML, posts call status and pulls audio with no cookie, so those routes stay open.
const OPEN_PATHS = ["/api/phone/twiml", "/api/phone/status", "/api/phone/audio", "/locked"];
const COOKIE = "blankett_access";
const KEY_PARAM = "key";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(request: NextRequest) {
  const secret = process.env.BLANKETT_ACCESS_KEY;
  if (!secret) return NextResponse.next();

  const { pathname, searchParams } = request.nextUrl;
  if (OPEN_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const presented = searchParams.get(KEY_PARAM);
  if (presented !== null && timingSafeEqual(presented, secret)) {
    // Admit, then drop the key from the address bar so it is not copied around or logged by the client.
    const clean = request.nextUrl.clone();
    clean.searchParams.delete(KEY_PARAM);
    const res = NextResponse.redirect(clean);
    res.cookies.set(COOKIE, secret, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return res;
  }

  const cookie = request.cookies.get(COOKIE)?.value ?? "";
  if (timingSafeEqual(cookie, secret)) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "This deployment requires an access key." }, { status: 401 });
  const locked = request.nextUrl.clone();
  locked.pathname = "/locked";
  locked.search = "";
  return NextResponse.rewrite(locked, { status: 401 });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|demo-documents/).*)"],
};
