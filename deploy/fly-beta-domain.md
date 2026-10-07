# Optional beta domain on Fly

The landing site's apex and `www` routes belong to Cloudflare. `beta.taptap3d.com` may continue to serve the platform on Fly during GCP preparation.

1. `flyctl certs add beta.taptap3d.com -a taptap3d`. Apply the returned DNS records in the Cloudflare zone and validate with `flyctl certs check beta.taptap3d.com -a taptap3d`. Inspect existing DNS before changing it.
2. Add `https://beta.taptap3d.com/api/auth/google/callback` to the existing **Web application** OAuth client's authorised redirects. Retain the old callback during the transition.
3. After TLS and DNS work, run `flyctl secrets set TAPTAP3D_PUBLIC_ORIGIN=https://beta.taptap3d.com -a taptap3d`. Test sign-in, sign-out, failed sign-in and PDF export on the beta hostname.
4. Users must sign in again because session cookies are host scoped. The fly.dev hostname still exists; adding a custom domain does not rename the app. Canonical host redirects can follow after OAuth acceptance.

On 7 October 2026 the certificate request was created on app `taptap3d` under `tktaiaa@connect.ust.hk`. Validation is pending DNS. Fly returned A `66.241.125.125` and AAAA `2a09:8280:1::18c:b166:0` for `beta.taptap3d.com`. No DNS or public-origin secret has been changed. [Fly custom domains](https://fly.io/docs/networking/custom-domain/).
