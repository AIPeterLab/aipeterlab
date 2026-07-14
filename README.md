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
- `https://sso.aipeterlab.com/`
- `https://btc.aipeterlab.com/`
- `/metlife/`

Some dashboard pages are placeholders so the public paths are stable before each dashboard is migrated.

## Cloudflare signal scheduler

This repo also contains a separate Cloudflare Worker, `aipeterlab-signal-scheduler`, that can replace GitHub's unreliable `schedule` event for the three signal dashboards.

The Worker runs at `22:20` and `23:20` UTC and dispatches GitHub workflows only when the current hour in `America/New_York` is `18`. That keeps the effective refresh time at 6 PM New York time across daylight-saving changes.

Target workflows:

- `AIPeterLab/qqq-qld-signal-desk` -> `.github/workflows/daily-update.yml`
- `AIPeterLab/spy-sso-signal-desk` -> `.github/workflows/daily-update.yml`
- `AIPeterLab/btc-cycle-signal-desk` -> `.github/workflows/daily-update.yml`

Required Cloudflare Worker secret:

- `GITHUB_TOKEN`: GitHub fine-grained token with access to the three repositories and `Actions: Read and write`.

Optional Cloudflare Worker secret:

- `SCHEDULER_ADMIN_TOKEN`: enables authenticated manual `POST /run` dispatches.

Deploy:

```powershell
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```
