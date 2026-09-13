// Create the first organisation, on purpose and by hand.
//
// `currentOrgId()` refuses to guess when no org exists, which is correct and is
// why a fresh deployment shows "No organisation yet" rather than inventing a
// tenant. This is the one-off that ends that state:
//
//   fly ssh console -a taptap3d -C "node /app/seed-org.mjs 'Ming Tak Auctions' mingtak"
//
// It is NOT self-serve signup (ROADMAP D15) and it is not a migration step. It
// is an operator creating the first tenant of a deployment, which is a thing
// someone must do exactly once and should have to mean.
//
// Idempotent: a slug that already exists is reported and left alone.

import pg from "pg";

const [, , nameArg, slugArg] = process.argv;
const name = nameArg ?? process.env.TAPTAP3D_ORG_NAME;
const slug = slugArg ?? process.env.TAPTAP3D_ORG_SLUG;

if (!name || !slug) {
  console.error("usage: node seed-org.mjs '<name>' <slug>");
  console.error("   or: set TAPTAP3D_ORG_NAME and TAPTAP3D_ORG_SLUG");
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  // The slug is what TAPTAP3D_ORG_SLUG pins a deployment to, so it has to be
  // something a person can type into an environment variable without quoting.
  console.error(`"${slug}" is not a slug — lowercase letters, digits and hyphens.`);
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const existing = await pool.query(`select id, name from orgs where slug = $1`, [slug]);
  if (existing.rows.length > 0) {
    console.log(`seed-org: "${slug}" already exists (${existing.rows[0].id})`);
  } else {
    const created = await pool.query(
      `insert into orgs (name, slug) values ($1, $2) returning id`,
      [name, slug],
    );
    console.log(`seed-org: created "${slug}" (${created.rows[0].id})`);
  }

  // Said out loud, because more than one org is exactly the state in which
  // currentOrgId() refuses to act — and hearing it here is better than finding
  // out from a page that will not load.
  const all = await pool.query(`select slug from orgs order by created_at`);
  if (all.rows.length > 1) {
    console.log(
      `seed-org: ${all.rows.length} orgs exist (${all.rows.map((r) => r.slug).join(", ")}). ` +
        `Set TAPTAP3D_ORG_SLUG on the app to choose one.`,
    );
  }
} finally {
  await pool.end();
}
