# GCP adoption

Prepared 7 October 2026. No GCP project exists yet; nothing has been provisioned or cut over.

Use Cloud Run + Cloud SQL PostgreSQL + a private Cloud Storage bucket. Keep one shared schema with `org_id` filters, Google sign-in, and explicit per-user house selection. The house cookie is a preference only: each request rechecks membership. `TAPTAP3D_ORG_SLUG` restricts authenticated users rather than bypassing their memberships. Leave it unset on the multi-tenant service.

## Create the project

Create a project in the Cloud Console and attach your billing account. Enable Cloud Run, Cloud Build, Artifact Registry, Cloud SQL Admin, Secret Manager and Cloud Storage APIs. Install the Google Cloud CLI and authenticate. Prefer `asia-east2` (Hong Kong); colocate SQL, bucket and Run. Review the resource estimate in your own account before creating SQL; Cloud SQL is the standing cost even when Run scales to zero.

Create an Artifact Registry Docker repository, a PostgreSQL instance with backups/PITR and deletion protection, and database/user `taptap3d`. Create a bucket with uniform bucket-level access and public access prevention. Create runtime service account `taptap3d-runtime` with Cloud SQL Client, bucket-scoped Storage Object User, and access to the three specific secrets below. Never make the assets bucket public; `/api/assets/[hash]` checks the acting org before reading a blob.

## Configuration

Store these in Secret Manager (supply versions before deploying):

| Secret | Runtime variable | Value |
|---|---|---|
| taptap3d-database-url | DATABASE_URL | `postgresql://USER:ENCODED_PASSWORD@localhost/taptap3d?host=%2Fcloudsql%2FPROJECT%3Aasia-east2%3AINSTANCE` |
| taptap3d-google-client-id | GOOGLE_CLIENT_ID | Web OAuth client id |
| taptap3d-google-client-secret | GOOGLE_CLIENT_SECRET | Web OAuth client secret |

Attach the SQL instance to the Cloud Run service and migration job. Configure `TAPTAP3D_GCS_BUCKET`, `TAPTAP3D_PUBLIC_ORIGIN` and `TAPTAP3D_RUN_MIGRATIONS=false`. Require both Google credentials. No unauthenticated org fallback should be used for a multi-tenant production service. The private bucket uses the service account's Application Default Credentials; no JSON key is needed.

## Build and release

Use the existing Dockerfile. Run these in PowerShell, after replacing the task variables:

The same configuration is supplied as `service.yaml` and `migration-job.yaml`
for `gcloud run services replace` / `gcloud run jobs replace`. Replace every
uppercase placeholder first; the manifests contain no credentials and are not
yet applied. The service manifest uses a health startup probe and caps the
initial connection/PDF workload. Configure public access only after sign-in
and the public origin are present.

```powershell
$projectId = 'YOUR_PROJECT'
$region = 'asia-east2'
$instance = "$($projectId):$($region):YOUR_SQL_INSTANCE"
$bucketName = 'YOUR_PRIVATE_BUCKET'
$publicOrigin = 'https://YOUR_RUN_HOST'
$image = "$region-docker.pkg.dev/$projectId/taptap3d/app:YOUR_COMMIT"
$runtimeAccount = "taptap3d-runtime@$projectId.iam.gserviceaccount.com"
gcloud builds submit --project=$projectId --tag=$image .
gcloud run jobs deploy taptap3d-migrate --project=$projectId --region=$region --image=$image --service-account=$runtimeAccount --set-cloudsql-instances=$instance --set-secrets=DATABASE_URL=taptap3d-database-url:latest --command=node --args=/app/migrate.mjs --tasks=1 --parallelism=1 --max-retries=0
gcloud run jobs execute taptap3d-migrate --project=$projectId --region=$region --wait
# Stop here if migration failed. Release only after it completes.
gcloud run deploy taptap3d --project=$projectId --region=$region --image=$image --service-account=$runtimeAccount --execution-environment=gen2 --add-cloudsql-instances=$instance --memory=2Gi --cpu=2 --concurrency=2 --min-instances=0 --max-instances=3 --timeout=300 --allow-unauthenticated --set-env-vars="HOSTNAME=0.0.0.0,TAPTAP3D_GCS_BUCKET=$bucketName,TAPTAP3D_PUBLIC_ORIGIN=$publicOrigin,TAPTAP3D_RUN_MIGRATIONS=false" --set-secrets="DATABASE_URL=taptap3d-database-url:latest,GOOGLE_CLIENT_ID=taptap3d-google-client-id:latest,GOOGLE_CLIENT_SECRET=taptap3d-google-client-secret:latest"
```

`allow-unauthenticated` makes the Google sign-in page reachable; the app's database-backed session and membership checks protect house data. Initially use the generated Run hostname (obtain it from a private first deployment, then add public access after configuring origin and OAuth). Add its exact `/api/auth/google/callback` to the Web OAuth client's authorised redirects. Cap instances and concurrency initially because the PDF renderer runs Chromium and the pg pool permits ten connections per instance. Measure a full 300-lot export before raising these limits.

## Transfer and prove isolation before cutover

Render the prepared manifests after the project resources and hostname exist:

```powershell
./deploy/gcp/render.ps1 -ProjectId YOUR_PROJECT -SqlInstance YOUR_SQL_INSTANCE -Bucket YOUR_PRIVATE_BUCKET -PublicOrigin https://YOUR_RUN_HOST -ImageTag YOUR_COMMIT
```

The renderer writes `.data/gcp/service.yaml` and `.data/gcp/migration-job.yaml`; it does not provision or deploy. `-Region` changes the default Hong Kong region in both manifests. Keep the generated files out of source control. After transferring the database and blobs, set the destination environment variables and run `npm run assets:verify`. It downloads and hashes every unique referenced object, checks its byte size and exits nonzero on a mismatch, without printing customer identifiers.

1. Pause writes on Fly. Back up its database and copy the asset volume; keep Fly intact for rollback.
2. Restore the full database into Cloud SQL, preserving UUIDs, memberships, policies and audit history. Invalidate copied sessions so users sign in afresh on the new host.
3. Copy the volume's `objects/` directory to `gs://BUCKET/objects/`, preserving paths. Compare asset row hashes and object counts; download and hash samples from the destination.
4. Run migrations once through the Job; do not run them concurrently at container startup.
5. Create two test houses and separate memberships. Test imports, previews, PDFs, assets, comments, settings and mutations with cross-house UUIDs. Test a forged house cookie, a revoked membership, and an invalid session with a deployment pin set. All must refuse access.
6. Switch houses and verify the ledger resets, an old event URL cannot be opened, and house A's settings do not alter house B's output.
7. Rehearse backup restore and rollback. Point the beta domain at Run only after these checks pass. Retain Fly and its volume until acceptance.

The current code still relies on application query scoping; this is not database row-level security. The pilot release enforces administrator-only settings and publication approval, and owner-only team management. Existing memberships are not automatically promoted: confirm a first owner for each organisation before release. See [pilot readiness](../../PILOT-READINESS.md) for the implementation and acceptance sequence. Enterprise SSO remains ROADMAP D14.

References: [Cloud SQL connections](https://docs.cloud.google.com/sql/docs/postgres/connect-run), [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract), [immutable object preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions).
