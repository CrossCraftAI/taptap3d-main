import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb, memberships, orgs } from "@/db";
import { publicOrigin } from "@/lib/auth/origin";
import { currentSession, cookieOptions, SESSION_DAYS } from "@/lib/auth/session";
import { HOUSE_COOKIE } from "@/lib/auth/house";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const origin = publicOrigin(request);
  if (request.headers.get("origin") !== origin) {
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  }
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const orgId = (await request.formData()).get("orgId");
  if (typeof orgId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
    return NextResponse.json({ error: "Choose a house." }, { status: 400 });
  }
  const [house] = await getDb().select({ id: orgs.id, slug: orgs.slug })
    .from(memberships).innerJoin(orgs, eq(orgs.id, memberships.orgId))
    .where(and(eq(memberships.userId, session.userId), eq(memberships.orgId, orgId))).limit(1);
  const pinned = process.env.TAPTAP3D_ORG_SLUG;
  if (!house || (pinned && house.slug !== pinned)) {
    return NextResponse.json({ error: "House unavailable." }, { status: 403 });
  }
  // A full navigation clears the previous house's client state and event URLs.
  const response = NextResponse.redirect(new URL("/", origin), 303);
  response.cookies.set(HOUSE_COOKIE, house.id,
    cookieOptions(new Date(Date.now() + SESSION_DAYS * 86400000)));
  return response;
}
