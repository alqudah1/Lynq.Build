# LYNQ

LYNQ is a web design and automation studio. This repository holds three things:

| Folder | What it is | Live |
|---|---|---|
| [`platform/`](platform) | **LYNQ Office**, the operations platform the studio runs on | app.lynq.build (private workspace) |
| repository root | The studio's public website | [lynq.build](https://lynq.build) |
| [`clients/`](clients) | Websites built for clients | [kingsbridgegroup.ca](https://www.kingsbridgegroup.ca) |

Built and run by [Mustafa AlQudah](https://mustafaalqudah.com).

---

## LYNQ Office (`platform/`)

A multi-tenant workspace for running a small agency end to end: clients, projects, sales, marketing and social publishing, with AI doing the repetitive parts behind approvals and budgets.

**What it does**

- **Organizations and workspaces.** Invitations, roles and permission checks on every route, and an audit log of who changed what.
- **CRM and sales.** Companies, contacts, pipeline stages, playbooks and forecasting.
- **Projects and workflows.** Tasks with owners and dates, plus a workflow engine with retries and recovery. A Postgres-backed job queue with leases runs background work from a cron.
- **Social OS.**
  - **Plans:** a two-week content plan per brand, loaded into dated drafts that the system re-checks every hour.
  - **Graphics:** brand graphics and Instagram stories rendered on the server (SVG through librsvg and sharp to JPEG), with bundled fonts.
  - **Approvals:** every post is approved from a Telegram bot.
  - **Publishing:** to Instagram, Facebook and LinkedIn through their official APIs. Google Ads and Meta Ads are read-only.
- **AI behind guardrails.** Text, image and video providers (OpenAI, Anthropic, Runway, Higgsfield) sit behind one registry, with a per-organization daily budget, a log of every generation, and nothing spent until a person asks.
- **Voice.** Phone commands with a one-time code check, documented in [`platform/docs/JARVIS_PHONE_CONTROL.md`](platform/docs/JARVIS_PHONE_CONTROL.md).

**How it's built**

| | |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS 4 |
| Data | PostgreSQL on Neon, Drizzle ORM, 47 versioned migrations |
| Validation | Zod at every boundary; environment checked at request time, server-only |
| Media | sharp + librsvg for rendering, ffmpeg for video, Vercel Blob for storage |
| Hosting | Vercel (functions and cron), feature branches with preview deployments |
| Quality | 250+ test files (unit, integration against Postgres, accessibility) in Vitest, with typecheck and lint, run before every release |

Each module has a design document in [`platform/docs/`](platform/docs) that covers its data model, authorization and failure modes before any code was written. Start with [`platform/README.md`](platform/README.md) for local setup.

## The website (root)

Hand-built HTML, CSS and JavaScript. It has structured data for search engines and AI assistants (`llms.txt`, JSON-LD), and serverless functions in `api/` for booking requests and the site's chat assistant. It deploys with `_DEPLOY-LYNQ-SITE.command`, which publishes only an allowlist of website files.
