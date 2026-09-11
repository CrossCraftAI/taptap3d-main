// Create the development organisation.
//
// There is no sign-up yet, and `currentOrgId()` refuses to guess when there is
// no org — so this is how a fresh clone becomes usable. It is NOT demo data: the
// demo (ROADMAP M1) is seeded by walking the real onboarding path, so that the
// path is exercised rather than bypassed.
//
// Idempotent, because a seed that fails the second time is a seed nobody runs.

import { eq } from "drizzle-orm";

import { getDb, getPool, orgs } from "@/db";

const SLUG = process.env.TAPTAP3D_ORG_SLUG ?? "dev";
const NAME = process.env.TAPTAP3D_ORG_NAME ?? "Development";

async function main(): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ id: orgs.id, name: orgs.name })
    .from(orgs)
    .where(eq(orgs.slug, SLUG))
    .limit(1);

  if (existing) {
    console.log(`seed: org "${SLUG}" already exists (${existing.id})`);
  } else {
    const [created] = await db
      .insert(orgs)
      .values({ name: NAME, slug: SLUG })
      .returning({ id: orgs.id });
    console.log(`seed: created org "${SLUG}" (${created!.id})`);
  }

  // Said out loud, because more than one org is exactly the state in which
  // currentOrgId() refuses to act — and finding that out from a seed message is
  // better than finding it out from a page that will not load.
  const all = await db.select({ slug: orgs.slug }).from(orgs);
  if (all.length > 1) {
    console.log(
      `seed: ${all.length} orgs exist (${all.map((o) => o.slug).join(", ")}). ` +
        "Set TAPTAP3D_ORG_SLUG to choose one.",
    );
  }

  await getPool().end();
}

main().catch((error) => {
  console.error("seed: failed —", error instanceof Error ? error.message : error);
  process.exit(1);
});
