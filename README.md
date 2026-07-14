# AIPeterLab

Static Cloudflare Pages site for `aipeterlab.com`.

## Cloudflare Pages settings

- Production branch: `main`
- Build command: `exit 0`
- Build output directory: `/`
- Primary custom domain: `aipeterlab.com`

Cloudflare supports static HTML sites on Pages. For static sites with no build step, Cloudflare documents `exit 0` as the build command and the folder containing `index.html` as the build output directory.

## Custom domain setup

In Cloudflare:

1. Go to Workers & Pages.
2. Create a Pages project from the GitHub repository for this folder.
3. Deploy the project.
4. Open the Pages project, then Custom domains.
5. Add `aipeterlab.com`.

Because this domain is already registered in Cloudflare, Cloudflare should manage the needed DNS record after the custom domain is attached.

## `www` redirect setup

Cloudflare documents the `www` to apex redirect as a Bulk Redirect plus a proxied DNS record:

- Source URL: `www.aipeterlab.com`
- Target URL: `https://aipeterlab.com`
- Status: `301`
- Options: preserve query string, subpath matching, preserve path suffix, include subdomains
- DNS record: `A`, name `www`, IPv4 address `192.0.2.1`, proxy status `Proxied`

This redirect is not implemented in `_redirects` because Cloudflare Pages `_redirects` does not handle domain-level redirects.

## Current pages

- `/`
- `https://qld.aipeterlab.com/`
- `/sso/`
- `https://btc.aipeterlab.com/`
- `/metlife/`

Some dashboard pages are placeholders so the public paths are stable before each dashboard is migrated.
