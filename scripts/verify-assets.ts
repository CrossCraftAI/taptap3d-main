import { getDb, getPool, assets } from "../src/db";
import { getAssetStore, hashBytes } from "../src/lib/assets/store";

// Operator-only integrity check. Use after transferring a database and its blobs.
// Prints counts, never filenames, tenant identifiers or customer record values.
try {
  const rows = await getDb().select({ hash: assets.contentHash, byteSize: assets.byteSize }).from(assets);
  const unique = new Map<string, Set<number>>();
  for (const row of rows) {
    if (!unique.has(row.hash)) unique.set(row.hash, new Set());
    unique.get(row.hash)!.add(row.byteSize);
  }
  let verified = 0, failed = 0;
  for (const [hash, sizes] of unique) {
    const bytes = await getAssetStore().get(hash);
    if (!bytes || [...sizes].some(byteSize => bytes.byteLength !== byteSize) || hashBytes(bytes) !== hash) failed++;
    else verified++;
  }
  console.log(JSON.stringify({ assetRows: rows.length, uniqueObjects: unique.size, verified, failed }));
  if (failed) process.exitCode = 1;
} catch { console.error("Asset verification failed. Check database, storage credentials and object availability."); process.exitCode = 1; }
finally { await getPool().end(); }
