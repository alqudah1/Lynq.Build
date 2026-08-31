# Claude lane — Jarvis Command Center UI

## Starting point

- Repository: `alqudah1/lynq.build`
- Base branch: `codex/release-manager-integration`
- Required base commit: `5d071d8`
- Create branch: `claude/jarvis-command-center-ui`
- Working application: `platform/`

## Objective

Build the founder-facing Jarvis Command Center interface over LYNQ's existing, real Office directive and execution systems. It must let Mustafa issue a plain-language command and then understand what Jarvis planned, which agents are working, which handoff is active, what failed, what needs approval, and what was completed.

## Existing systems to reuse

- `src/components/dashboard/office/OfficeCommandCenter.tsx`
- `src/app/api/organizations/[organizationId]/office/directives/route.ts`
- `GET src/app/api/organizations/[organizationId]/office/directives/[projectId]/route.ts` for live project/step/approval status
- `src/lib/office/directives.ts`
- `src/lib/office/execution.ts`
- Existing Project, Agent Runtime, Runtime Queue, My Work, approval, artifact, and workflow APIs/components

Do not create mock results, a second execution engine, or a second approval system.

## UI scope

1. Rename the founder-facing assistant presentation to Jarvis while keeping legal/system identifiers stable.
2. Create a clear command composer with useful example commands.
3. After dispatch, show one live project plan with ordered handoffs.
4. Clearly distinguish queued, running, waiting for approval, blocked/failed, and completed states.
5. Link every step to its real task, execution, artifact, approval, pull request, or preview when available.
6. Add an obvious `Needs your approval` area and a plain-language failure/retry explanation.
7. Add an accessible mobile layout and back navigation.
8. Keep LYNQ's existing black/white brand palette; do not introduce unrelated green branding.

## Hard boundaries

- Do not edit database schema or migrations.
- Do not edit authentication, environment configuration, shared navigation, root layouts, or release scripts.
- Do not build calling, SMS, email sending, or autonomous outreach in this lane.
- Do not change safety or approval rules.
- Do not push or merge `main`, deploy production, promote, roll back, or change aliases.
- Preview deployment only, if the environment permits it.

## Verification and handoff

Run typecheck, lint, relevant unit/accessibility tests, and production build. Commit the work to the feature branch and return:

1. Branch and commit SHA
2. Changed files
3. Tests and results
4. Preview URL
5. Known risks and remaining backend needs

The release manager will review and integrate the commit.
