# LYNQ Office Release Coordination

The LYNQ Office has three coordinated work lanes. They share one product, but only the release manager may release production.

## Release manager

- Task ID: `019fe7a4-73fc-77d1-a074-d14ecc754f21`
- Owns shared navigation, layouts, authentication, environment configuration, database migrations, integration review, production releases, rollbacks, and aliases for `app.lynq.build`.
- Is the only lane allowed to merge or push to `main`, deploy or promote production, roll back production, or change the production alias.

## Feature lanes

- Content Studio task: `01a03582-ae4a-7c50-9ab2-632cbdbb50b5`
- Outreach task: `01a02a79-c24f-78c2-8ff1-7b467a10dfec`
- Feature lanes use feature branches and preview deployments only.
- They must hand off the branch, commit, changed files, database/environment changes, verification results, preview URL, and known risks.

Never run direct production Vercel commands from a feature lane. Use the guarded release command documented in `platform/.agents/RELEASE_POLICY.md`.
