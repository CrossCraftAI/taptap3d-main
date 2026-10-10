# Customer pilot release

Prepared 10 October 2026. Implemented in `feat/pilot-publication`; not deployed to the customer service. GCP has not been provisioned.

## Implemented

- Customer manifests require Google authentication and fail the readiness probe if it is missing. The public health endpoint does not expose raw database errors.
- Settings changes require a current owner or administrator membership. Members continue editing records and catalogues.
- Owners manage colleagues at `/settings/team`: grant access by Google account email, change roles and revoke access. The last owner cannot be removed or demoted. Granting access does not send email automatically.
- An operator can create an organisation and its first owner atomically with `npm run org:onboard -- --name "Pilot house" --slug pilot-house --owner owner@example.com`. A duplicate slug fails without changing the existing organisation. Use the intended environment's `DATABASE_URL`.
- Each lot has a Publish listing screen. Administrators explicitly select fields, title, description, language and photographs, attest image rights and review the content. No field or image is selected automatically.
- Approval copies record content into an immutable revision. Catalogue-specific overrides are separate and do not flow into this listing. Restricted fields cannot be approved. A subsequently restricted field also stops serving affected historical revisions.
- Public endpoints resolve an opaque publication identifier, never a private lot or tenant selector:
  - `GET /v1/publications/pub_UUID[?revision=rev_UUID&locale=en]`
  - `GET /embed/pub_UUID[?revision=rev_UUID&locale=en&theme=light]`
  - `GET /p/pub_UUID[?revision=rev_UUID&locale=en]`
  - `GET /v1/publications/pub_UUID/images/HASH?revision=rev_UUID`
- JSON includes schemaVersion `1`, publicationId, revision, updatedAt, canonicalUrl, title, description, actual language, approved fields and approved raster images with dimensions.
- HTTPS website origins are registered per publication. JSON uses exact-origin CORS; embeds use CSP frame-ancestors and exact-target postMessage events. Origin registration controls browser integrations; approved content is public to anyone with its URL.
- Responses and images use no-store. Withdrawal rejects all revisions and image reads with 410. Republishing after withdrawal issues a fresh identifier; old identifiers remain withdrawn. Already downloaded content cannot be recalled. An open iframe checks withdrawal every 30 seconds; external consumers must revalidate themselves.
- Embeds send version 1 `taptap3d:ready`, `taptap3d:resize` and `taptap3d:unavailable` messages containing publicationId and revision. Heights are clamped to 240–1600 pixels. Hosts must check event origin and source. Initial HTTP errors are handled with a host timeout/fallback, rather than an event from a loaded listing.

## Deployment sequence

1. Review the additive migrations `drizzle/0010_pale_alex_wilder.sql` and `drizzle/0011_adorable_expediter.sql` and back up the destination database and asset store.
2. Confirm at least one actual owner membership per organisation. Existing member rows are deliberately not promoted automatically. For an existing organisation that has no owner, run `npm run org:onboard -- --bootstrap-owner --slug existing-house --owner owner@example.com` against the intended database. It refuses an organisation that already has an owner; subsequent changes belong in Team access.
3. Configure both Google OAuth credentials and the exact `TAPTAP3D_PUBLIC_ORIGIN`. Set the matching `/api/auth/google/callback` redirect in the Google Web OAuth client. The local/shared-gate mode is for development, not a multi-tenant customer service.
4. Run migrations through the single migration job, then release the application. Keep Fly intact until the GCP rehearsal passes.
5. On a staging service, onboard two pilot organisations and use separate Google accounts. Exercise imports, previews, PDFs, images, comments, settings and approval with the other organisation's IDs. Test revoked membership and forged house cookies. These deployment checks complement the database tests; they have not been performed on GCP.
6. Approve a synthetic listing, register a test storefront origin, embed it, update the underlying record and verify the approved content does not change. Approve a new revision, pin the previous revision, withdraw and verify JSON, iframe, canonical page and image URLs all refuse reads. Test Chrome, Safari and a mobile storefront.
7. Rehearse backup restoration and rollback before moving customer writes or changing the beta domain. Measure a representative large PDF export and record its time, memory and error rate before adjusting concurrency.

## Decisions and access needed from the owner

| Owner action | What it enables |
| --- | --- |
| Create/choose a GCP project, attach billing and provide authenticated project access. | Provision managed database/storage and deploy the prepared manifests. |
| Confirm the first two pilot organisations and their owner Google account emails. | Bootstrap correct ownership, invite colleagues and test actual tenant isolation. |
| Supply representative source files and expected catalogue PDFs from a willing pilot, including scans if needed. | Validate mapping and layout against real work; decide which non-spreadsheet importer is needed. |
| Confirm a staging/beta hostname, its OAuth redirect and a test storefront origin. | Release and verify the public integration on a customer-like website. |
| Confirm which fields and images may be public, with permission from their owner. | Approve a real publication without guessing about reserves, consignors or image rights. |

## Remaining product work driven by pilot evidence

PDF/Word/email/scanned-document ingestion needs sample documents and a confirmed workflow. This release does not invent an extractor or claim support beyond spreadsheets and paste. It also does not add pricing, stock, bidding, checkout, payments, webhooks, API keys, automated invitation email, translations, subscription billing or a commerce-specific adapter. Publication records one selected language; locale requests fall back to that language and report its actual tag.

Public integration traffic limits and monitoring thresholds must be set against the chosen deployment and pilot traffic before a general release. The application provides no distributed API rate-limit service yet. The pilot routes are noindex; public SEO listing publication is a later explicit release choice.

## Validation

Local validation on 10 October 2026: 1,317 unit/database tests passed; typecheck, lint and production build passed. Chromium and WebKit checks passed for publication approval/withdrawal, iframe lifecycle messages, narrow-screen rendering, team grants/role changes/removal, existing settings, visibility and record types. The GCP manifest renderer was exercised with synthetic configuration. Developer documentation checks cover 19 pages and both runnable example tests pass.

The automated suites cover approval permissions, explicit projection, tenant ownership, revision pins, exact CORS/CSP origins, image withdrawal, fresh identifiers after withdrawal, last-owner protection and browser approval/withdrawal. Production account configuration, backup restoration and customer-specific import quality require the environment and sample inputs listed above. The existing PDF browser-path tracing warning remains in the build; it is not a failed compilation.
