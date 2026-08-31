# LYNQ Office release policy

## One product, three lanes

| Lane | Owns | Production access |
| --- | --- | --- |
| Release manager | Integration, shared shell, auth, schema, migrations, environment, verification, deployment | Yes |
| Content Studio | Marketing production and Content Studio | Preview only |
| Outreach | CRM leads, outreach drafts, qualification, outreach channel | Preview only |

The release manager task is `019fe7a4-73fc-77d1-a074-d14ecc754f21`.

## Rules

1. Feature lanes work on feature branches and never push or merge to `main`.
2. Feature lanes never deploy, promote, roll back, or alias production.
3. Shared navigation, layouts, authentication, environment configuration, schema, and migrations belong to the release manager.
4. UI work receives a preview deployment before integration.
5. Every handoff uses `.agents/HANDOFF_TEMPLATE.md`.
6. The release manager reviews, integrates, runs the full verification suite, and performs the single production release.

## Commands

- Preview: `pnpm deploy:preview`
- Production: `LYNQ_RELEASE_MANAGER_TASK_ID=019fe7a4-73fc-77d1-a074-d14ecc754f21 pnpm deploy:production -- --confirm-app-lynq-build`

The production command fails unless both the release-manager identity and exact confirmation flag are present. Direct production commands are forbidden because they bypass the safety check.
