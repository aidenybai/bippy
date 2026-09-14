# Website

`bippy.dev` redirects to the project README and serves two SVG badge API routes:

- `/api/badges/version` queries `https://registry.npmjs.org/bippy/latest`.
- `/api/badges/downloads` sums npm's available daily download counts (up to 18 months). This matches Shields' `/npm/dt/bippy` URL, which now redirects to `/npm/d18m/bippy`; it is not a lifetime total.

The routes use `badge-maker`, Shields' renderer, to retain the flat black styling without requesting images from Shields.

Validated npm values are cached separately in Next.js's persistent Data Cache and revalidated hourly. Failed refreshes retain the last successful value. Upstream requests time out after five seconds.

Successful SVG responses are cached for five minutes in browsers and one hour on the CDN, with a one-day stale-while-revalidate/stale-if-error window. Cold-cache failures return an `unavailable` SVG with HTTP 502 and `Cache-Control: no-store`.

```sh
pnpm --filter @bippy/website test
pnpm --filter @bippy/website build
```
