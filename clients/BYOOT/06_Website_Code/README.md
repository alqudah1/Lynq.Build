# This folder is intentionally not a standard static site build

BYOOT is not a standard LYNQ static client site. Per
`LYNQ_ENGINEERING_STANDARD.md` B.1, it classifies as a **real product**
(user-facing, data-driven, ~43,000 listings, needs real persistence and
scale) — not the `clients/<CLIENT>/06_Website_Code/` zero-build HTML/CSS/JS
pattern used for brochure sites.

**This folder will likely stay empty.** The actual codebase will live
elsewhere — most likely a new top-level directory in this repo structured
like `platform/` (Next.js + TypeScript + Postgres, own Vercel project), or
possibly a separate repo entirely. Where exactly is not yet decided.

That decision is Step 4 of `BYOOT_AUDIT.md` (repo root), which is currently
**blocked pending the client's GitHub repo URL**. Do not assume this empty
folder means the build is missing or behind — check `BYOOT_AUDIT.md`'s
placement recommendation before concluding anything about where the code
should be.
