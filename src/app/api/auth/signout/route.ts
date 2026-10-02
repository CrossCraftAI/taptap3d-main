// Sign out.
//
// POST AND NOT GET, because a GET that ends a session is a session anybody
// can end with an `<img src>` on another site. The control is a form in the
// shell, which is also why this is a route rather than a server action: it
// has to work on the sign-in page and anywhere else, and it redirects.

import { NextResponse, type NextRequest } from "next/server";

import { closeSession, SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  // THE ROW GOES, not just the cookie. Clearing the cookie alone leaves a
  // live session for anyone who copied it, which is the whole reason this
  // product keeps sessions in a table it can delete from.
  await closeSession(request.cookies.get(SESSION_COOKIE)?.value);
  const response = NextResponse.redirect(new URL("/sign-in", request.url));
  response.cookies.delete({ name: SESSION_COOKIE, path: "/" });
  return response;
}
