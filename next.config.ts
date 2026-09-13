import type { NextConfig } from "next";

const config: NextConfig = {
  // Standalone, because the deployment target is a container rather than a
  // platform that understands Next. It is set here rather than discovered at
  // deploy time so the Dockerfile and the local build agree.
  output: "standalone",
  typedRoutes: true,
  // KEPT OUT OF THE BUNDLE ON PURPOSE. Next bundles application dependencies
  // into the server chunks, which means drizzle-orm vanishes from node_modules
  // in a standalone build — and the boot-time migration runner, which is a plain
  // .mjs script rather than part of the app, then cannot import it. `pg` survived
  // only because native bindings are external by default.
  //
  // Measured, not assumed: the first image built cleanly and died on boot with
  // "Cannot find package 'drizzle-orm' imported from /app/migrate.mjs".
  // puppeteer-core joins them for a different reason: it resolves a browser at
  // runtime and carries .mjs/.cjs shims Turbopack should not try to inline.
  serverExternalPackages: ["drizzle-orm", "pg", "puppeteer-core"],
  // AND the migrator forced into the trace. Marking the package external was not
  // enough: Next traces only the FILES the application actually reaches, and the
  // app imports drizzle-orm/node-postgres (the driver) but never
  // node-postgres/migrator — which the boot script does. The second image got
  // one error further than the first and died on the subpath instead of the
  // package.
  //
  // Keyed to a route because that is the shape of the option; any server route
  // would do, and /api/health is the one that cannot work without a database
  // anyway.
  outputFileTracingIncludes: {
    "/api/health": ["./node_modules/drizzle-orm/**"],
    // Same problem, different package: marking puppeteer-core external stops it
    // being bundled but does not put it in the standalone output, and the PDF
    // route then dies on a missing module at the moment someone asks for the
    // one artefact the software exists to produce.
    "/events/[id]/catalogue/pdf": ["./node_modules/puppeteer-core/**"],
  },
};

export default config;
