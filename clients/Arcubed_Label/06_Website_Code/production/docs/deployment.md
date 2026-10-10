# Deploying Arcubed

Set up 2026-10-09. The Vercel project `arcubed-label` has **no git
integration**: every deployment is made with the Vercel CLI from a local
checkout.

## Domains

| Domain | Role | Moves when |
|---|---|---|
| arcubed.shop | the live store (production domain) | a **production** deployment (`--prod`) |
| www.arcubed.shop | 308 redirect to arcubed.shop | — |
| arcubed-label.vercel.app | production domain | a production deployment |
| arcubed-preview.vercel.app | client preview, mirrors production | `vercel alias set` by hand |
| arcubed-review.vercel.app | review builds (unapproved work, e.g. the colour lab) | `vercel alias set` by hand |

Until 2026-10-09 arcubed.shop was assigned to the git branch
`arcubed/staging`, so ANY deployment from that branch — even a plain preview
— took over the live store. That assignment was removed; a preview
deployment from `arcubed/staging` was then made and verified not to move
arcubed.shop.

## Release to production

From a checkout of the approved commit (a detached worktree is fine):

```
cd clients/Arcubed_Label/06_Website_Code/production
vercel deploy --prod --yes
vercel alias set <new deployment URL> arcubed-preview.vercel.app
vercel inspect arcubed.shop           # must show the new deployment id
vercel inspect arcubed-preview.vercel.app
```

## Review build (never touches production)

```
vercel deploy --yes
vercel alias set <new deployment URL> arcubed-review.vercel.app
```

## Rolling back

`vercel alias set <previous production deployment URL> arcubed.shop` points
the store back immediately; make a fresh `--prod` deployment of the previous
commit afterwards so the project's production target matches.
