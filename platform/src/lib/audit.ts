import "server-only";
import { randomUUID } from "node:crypto";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { auditLogs } from "@/db/schema";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

/**
 * The full Module 2 audit-event taxonomy (§10), covering both the
 * authentication/session domain (Step 3) and the organization/workspace
 * authorization domain (Step 4A). Moved here (from src/lib/auth/audit.ts)
 * because it is no longer auth-specific — Step 4A's domain services import
 * it directly, and tenancy code should not depend on `src/lib/auth/`.
 *
 * Auth/session events (Step 3, plus its security-correction pass):
 * `sign_up`, `oauth_login_success`, `oauth_login_failure`,
 * `oauth_link_conflict`, `oauth_account_linked`, `oauth_provider_unavailable`,
 * `logout`, `session_revoked`.
 *
 * Organization/workspace authorization events (Step 4A):
 * `organization_created`, `organization_updated`, `organization_deleted`,
 * `membership_added`, `membership_removed`, `role_changed`,
 * `workspace_created`, `workspace_updated`, `workspace_deleted`,
 * `workspace_access_added`, `workspace_access_removed`,
 * `workspace_role_changed`, `authorization_denied`.
 *
 * Invitation events (Step 4C): `invitation_created`, `invitation_refreshed`
 * (the atomic expired-pending-refresh behavior — §9's required refresh
 * path), `invitation_revoked`, `invitation_accepted`,
 * `invitation_acceptance_failed` (expired/revoked/already_used/
 * email_mismatch — the specific reason lives only in `metadata.reason`,
 * never in the event type itself, matching the "don't expose all internal
 * failure reasons in public HTTP responses" rule while still keeping them
 * queryable here). Creation-time authority failures (an admin inviting an
 * owner, a workspace outside the organization) reuse the existing
 * `authorization_denied` event with `metadata.reason` — consistent with how
 * Step 4A already records `last_owner`/`self_role_change`/etc. denials,
 * rather than inventing a new event type per denial reason.
 *
 * `invitation_viewed` was considered and deliberately NOT added: a public
 * token-preview `GET` can be hit repeatedly (page reloads, link previews)
 * with no meaningful security signal beyond what `invitation_accepted`/
 * `invitation_acceptance_failed` already capture, so it would be audit noise
 * without real investigative value — the "only if justified and not
 * excessively noisy" bar from the Step 4C requirements was not met.
 *
 * Brain — Module 1, Core Knowledge Storage
 * (platform/docs/MODULE_5_BRAIN_MODULE_1_CORE_STORAGE.md): `knowledge_item_created`,
 * `knowledge_item_archived`, `knowledge_access_denied`. Module 1's original
 * `knowledge_item_updated` is superseded by Module 2's `knowledge_version_created`
 * below — every content-changing update now creates a version, so that event
 * name is what actually describes the write; there is no longer any code
 * path that both changes content and is not a version creation.
 * `knowledge_item_viewed` was considered and deliberately NOT added, for the
 * identical "audit noise without real investigative value" reasoning as
 * `invitation_viewed` above — a routine authorized read carries no security
 * signal beyond what `knowledge_access_denied` already captures for the
 * cases that actually matter. Metadata for every Brain event is restricted
 * to item id, domain, classification, and workspace-scoped-or-not — never
 * the item's `title`/`content`, matching this file's own metadata
 * redaction rule below.
 *
 * Brain — Module 2, Immutable Version History
 * (platform/docs/MODULE_5_BRAIN_MODULE_2_VERSION_HISTORY.md):
 * `knowledge_version_created`, `knowledge_version_restored`,
 * `knowledge_version_conflict`. `knowledge_version_viewed` was considered
 * and deliberately NOT added, for the same "no security signal beyond what
 * the denial/conflict events already capture" reasoning as
 * `knowledge_item_viewed` above. Metadata for these events may include the
 * item id, version number, previous version number, a bounded change-reason
 * summary, workspace scope, and domain/classification — never the version's
 * `title`/`content`. A failed (stale) update or restore writes only
 * `knowledge_version_conflict`, never a misleading `knowledge_item_updated`
 * or `knowledge_version_created`.
 *
 * Brain — Module 3, Relationships
 * (platform/docs/MODULE_5_BRAIN_MODULE_3_RELATIONSHIPS.md):
 * `knowledge_relationship_created`, `knowledge_relationship_archived`.
 * No `knowledge_relationship_restored` — Module 3 does not implement
 * restore (see that document's "Deviations" section). No
 * `knowledge_relationship_viewed`, for the identical "no security signal"
 * reasoning applied to every other `_viewed` candidate above. A denied
 * relationship mutation reuses the existing `knowledge_access_denied` event
 * (targeting whichever endpoint item failed the check) rather than a new
 * relationship-specific denial event — the denial already happens inside
 * `getKnowledgeItemForUser`/`requireBrainMutateAccess`, which this module
 * calls unmodified for each endpoint; inventing a second denial event for
 * the same underlying check would be exactly the "duplicated business rule"
 * this module was told to avoid. Metadata for the two relationship events
 * may include the relationship id, both endpoint item ids, relationship
 * type, and workspace scope of each endpoint — never `explanation` (free
 * text, same redaction rule as `title`/`content`/`change_reason`
 * elsewhere in this file).
 *
 * Brain — Module 4, Trust Model & Evidence
 * (platform/docs/MODULE_5_BRAIN_MODULE_4_TRUST_AND_EVIDENCE.md):
 * `knowledge_source_recorded` (fires exactly once per version, the moment
 * its immutable Source is first written — never again, since Source has
 * no update path), `knowledge_trust_assessed` (fires every time a
 * version's trust tier is set or reassessed, including the very first
 * time), `knowledge_trust_conflict` (a stale-`expectedRevision`
 * reassessment attempt — never paired with a misleading
 * `knowledge_trust_assessed` for the same call), `knowledge_evidence_created`.
 * No `knowledge_evidence_updated`/`_restored` — evidence is append-only in
 * this module, with no mutation path at all (see that document's
 * "Deviations" section on `evidence_trust_tier`/`is_stale` being storage-
 * ready but not yet mutable). No `_viewed` events for any of these, for the
 * identical "no security signal" reasoning applied to every other `_viewed`
 * candidate above. A denied trust/evidence mutation reuses the existing
 * `knowledge_access_denied` event — the denial happens inside
 * `getKnowledgeItemForUser`/`requireBrainApproveAccess`/
 * `requireBrainMutateAccess`, unmodified, so no new denial event is
 * invented for the same underlying check. Metadata for the four new events
 * may include the item id, version number, trust tier (new and, for
 * `knowledge_trust_assessed`, previous), source type, evidence class,
 * and workspace scope — never `source_detail`, evidence `description`, or
 * `external_reference` (free text, the identical redaction rule already
 * applied to every other free-text field in this file).
 *
 * Brain — Module 7, Brain Permissions
 * (platform/docs/MODULE_5_BRAIN_MODULE_7_PERMISSIONS.md):
 * `brain_permission_granted`, `brain_permission_updated` (the grant's
 * `reason` changed — capability/scope/grantee are immutable once created),
 * `brain_permission_revoked`, `brain_permission_bootstrapped` (fires
 * exactly once per organization), `brain_permission_denied`.
 *
 * `brain_permission_denied` is deliberately DISTINCT from the existing
 * `knowledge_access_denied` — the two now mean different things. This
 * module keeps `knowledge_access_denied` exactly as it always meant:
 * organization- or workspace-*membership* failure (gates 1–3 of §10's
 * chain, unchanged since Module 1). `brain_permission_denied` is new and
 * covers only gate 4: the actor has real organization/workspace
 * membership but lacks the specific Domain Grant capability the operation
 * requires. Keeping them separate lets an investigator distinguish "this
 * person isn't even in the workspace" from "this person is in the
 * workspace but was never granted this capability" — collapsing them
 * would have been exactly the kind of audit-signal loss this file's own
 * design has avoided everywhere else. A grant-management denial (someone
 * without `manage_permissions`-equivalent authority trying to create/
 * revoke a grant) also reuses `brain_permission_denied`, not a third event
 * — it is the same underlying "you lack the capability this action
 * requires" shape, just for a meta-level capability instead of a content
 * one.
 *
 * `brain_permission_viewed` was considered and deliberately NOT added, for
 * the identical "no security signal beyond what denial events already
 * capture" reasoning applied to every other `_viewed` candidate above.
 * `knowledge_access_denied`'s own noise concern (this module's own "avoid
 * logging every normal read denial if it creates excessive noise"
 * instruction) is handled the same way it always has been in this
 * codebase: every DENIAL is audited (a security-relevant event, not
 * noise), while every ALLOWED read stays silent — the noise this
 * instruction warns against would only come from auditing successful,
 * routine reads, which this codebase has never done for Brain content.
 *
 * Metadata for the five new events may include: the grant id, target
 * (grantee) user id, domain, workspace scope, capability, and a bounded
 * `reason` summary — but `reason` is free text the actor themselves wrote
 * (unlike `source_detail`/evidence `description`, which describe knowledge
 * content), so it is included, bounded, exactly as `change_reason` already
 * is for version restores; it is never knowledge content, never a secret,
 * never a session/OAuth/invitation token.
 *
 * Brain — Modules 8/9, Draft Workflow & Review/Approval
 * (platform/docs/MODULE_5_BRAIN_MODULE_8_9_LIFECYCLE.md):
 * one event per forward/backward lifecycle transition —
 * `knowledge_item_submitted_for_review`, `knowledge_item_sent_back_to_draft`,
 * `knowledge_item_approved`, `knowledge_item_published`,
 * `knowledge_item_restored` (Archived → Approved, a genuine re-approval),
 * `knowledge_item_retired`. `knowledge_item_archived` (Module 1) is reused
 * unchanged for the Any → Archived transition, now reachable from more
 * source states than just `draft`. `knowledge_lifecycle_conflict` mirrors
 * `knowledge_version_conflict`'s exact precedent — a stale
 * `expectedVersionNumber` on a transition attempt, never paired with a
 * misleading success event for the same call. A denied transition (missing
 * capability, or the transition itself illegal from the current state)
 * reuses `knowledge_access_denied`/`brain_permission_denied` for the
 * authorization case and simply never writes a success event for the
 * `InvalidLifecycleTransitionError` case (the request never mutated
 * anything, so there is nothing to audit beyond the 409 response itself —
 * identical to how a Zod validation failure is never audited either).
 * Metadata may include the previous/new status, domain, workspace scope,
 * and (for retire) a bounded `reason` — never title/content.
 *
 * Agent Registry (`marketing/AGENT_FRAMEWORK.md` §2, §14; `src/lib/agents/`):
 * `agent_registered` (creation), `agent_anatomy_updated` (any anatomy/
 * permission-level edit — always paired with a new `agent_versions` row),
 * `agent_lifecycle_advanced` (every forward stage move except the two
 * named below), `agent_approved` (the testing → approval transition
 * specifically, since §2 also forces the permission level to `observer`
 * here — a fact worth its own event name rather than burying it in generic
 * metadata), `agent_retired` (terminal, mirrors `knowledge_item_retired`),
 * `agent_permission_level_changed`, `agent_health_recorded`,
 * `agent_credential_issued`/`agent_credential_revoked` (metadata is the
 * credential id and key prefix only — never the secret or its hash),
 * `agent_registry_denied` (missing owner/admin management authority — see
 * `src/lib/agents/authz.ts`).
 */
export type AuditEventType =
  | "sign_up"
  | "oauth_login_success"
  | "oauth_login_failure"
  | "oauth_link_conflict"
  | "oauth_account_linked"
  | "oauth_provider_unavailable"
  | "logout"
  | "session_revoked"
  | "organization_created"
  | "organization_updated"
  | "organization_deleted"
  | "membership_added"
  | "membership_removed"
  | "role_changed"
  | "workspace_created"
  | "workspace_updated"
  | "workspace_deleted"
  | "workspace_access_added"
  | "workspace_access_removed"
  | "workspace_role_changed"
  | "authorization_denied"
  | "invitation_created"
  | "invitation_refreshed"
  | "invitation_revoked"
  | "invitation_accepted"
  | "invitation_acceptance_failed"
  | "knowledge_item_created"
  | "knowledge_item_archived"
  | "knowledge_access_denied"
  | "knowledge_version_created"
  | "knowledge_version_restored"
  | "knowledge_version_conflict"
  | "knowledge_relationship_created"
  | "knowledge_relationship_archived"
  | "knowledge_source_recorded"
  | "knowledge_trust_assessed"
  | "knowledge_trust_conflict"
  | "knowledge_evidence_created"
  | "brain_permission_granted"
  | "brain_permission_updated"
  | "brain_permission_revoked"
  | "brain_permission_bootstrapped"
  | "brain_permission_denied"
  | "knowledge_item_submitted_for_review"
  | "knowledge_item_sent_back_to_draft"
  | "knowledge_item_approved"
  | "knowledge_item_published"
  | "knowledge_item_restored"
  | "knowledge_item_retired"
  | "knowledge_lifecycle_conflict"
  | "knowledge_decision_outcome_recorded"
  | "knowledge_decision_superseded"
  | "agent_registered"
  | "agent_anatomy_updated"
  | "agent_lifecycle_advanced"
  | "agent_approved"
  | "agent_retired"
  | "agent_permission_level_changed"
  | "agent_health_recorded"
  | "agent_credential_issued"
  | "agent_credential_revoked"
  | "agent_registry_denied"
  | "agent_version_conflict"
  | "agent_lifecycle_conflict"
  | "agent_brain_read"
  | "agent_brain_read_denied"
  | "agent_brain_write_denied"
  | "agent_brain_credential_invalid"
  | "agent_brain_credential_revoked"
  | "agent_brain_rate_limited"
  | "agent_execution_created"
  | "agent_execution_assigned"
  | "agent_execution_started"
  | "agent_execution_paused"
  | "agent_execution_resumed"
  | "agent_execution_cancelled"
  | "agent_execution_completed"
  | "agent_execution_failed"
  | "agent_execution_retry_scheduled"
  | "agent_execution_conflict"
  | "agent_task_created"
  | "agent_task_completed"
  | "agent_plan_created"
  | "agent_checkpoint_created"
  | "agent_approval_requested"
  | "agent_approval_approved"
  | "agent_approval_rejected"
  | "agent_approval_revision_requested"
  | "agent_approval_expired"
  | "agent_approval_cancelled"
  | "agent_artifact_created"
  | "agent_artifact_status_changed"
  | "agent_delegation_created"
  | "agent_delegation_cycle_rejected"
  | "agent_runtime_permission_denied"
  | "tool_registered"
  | "tool_enabled"
  | "tool_disabled"
  | "tool_invocation_requested"
  | "tool_invocation_started"
  | "tool_invocation_succeeded"
  | "tool_invocation_failed"
  | "tool_invocation_rate_limited"
  | "tool_invocation_permission_denied"
  | "tool_invocation_approval_required"
  | "knowledge_analyst_task_started"
  | "knowledge_analyst_report_created"
  | "knowledge_analyst_task_completed"
  | "runtime_job_enqueued"
  | "runtime_job_leased"
  | "runtime_job_started"
  | "runtime_job_heartbeat"
  | "runtime_job_completed"
  | "runtime_job_retry_scheduled"
  | "runtime_job_failed"
  | "runtime_job_cancelled"
  | "runtime_job_dead_lettered"
  | "runtime_job_reclaimed"
  | "runtime_reconciliation_started"
  | "runtime_reconciliation_completed"
  | "tool_invocation_reconciled"
  | "execution_reconciled"
  | "cleanup_job_completed"
  | "worker_registered"
  | "worker_credential_revoked"
  | "runtime_worker_permission_denied"
  | "project_created"
  | "project_updated"
  | "project_status_changed"
  | "project_archived"
  | "project_member_added"
  | "project_member_role_changed"
  | "project_member_removed"
  | "project_phase_created"
  | "project_phase_updated"
  | "project_milestone_created"
  | "project_milestone_updated"
  | "project_task_created"
  | "project_task_updated"
  | "project_task_status_changed"
  | "project_task_assigned"
  | "project_task_assignment_removed"
  | "project_task_dependency_added"
  | "project_task_dependency_removed"
  | "project_artifact_linked"
  | "project_agent_execution_launched"
  | "project_approval_linked"
  | "project_permission_denied"
  // Module 11 — Workflow Engine Core
  | "workflow_created"
  | "workflow_updated"
  | "workflow_archived"
  | "workflow_version_created"
  | "workflow_version_validated"
  | "workflow_version_published"
  | "workflow_execution_created"
  | "workflow_execution_started"
  | "workflow_execution_paused"
  | "workflow_execution_resumed"
  | "workflow_execution_completed"
  | "workflow_execution_failed"
  | "workflow_execution_cancelled"
  | "workflow_node_started"
  | "workflow_node_completed"
  | "workflow_node_failed"
  | "workflow_human_task_created"
  | "workflow_human_task_completed"
  | "workflow_approval_linked"
  | "workflow_agent_execution_linked"
  | "workflow_tool_invocation_linked"
  | "workflow_artifact_linked"
  | "workflow_project_linked"
  | "workflow_reconciled"
  | "workflow_permission_denied"
  // Module 12 — LYNQ CRM Core
  | "crm_contact_created"
  | "crm_contact_updated"
  | "crm_contact_archived"
  | "crm_company_created"
  | "crm_company_updated"
  | "crm_company_archived"
  | "crm_contact_company_linked"
  | "crm_contact_company_unlinked"
  | "crm_lead_created"
  | "crm_lead_updated"
  | "crm_lead_qualified"
  | "crm_lead_disqualified"
  | "crm_lead_converted"
  | "crm_pipeline_created"
  | "crm_pipeline_updated"
  | "crm_stage_created"
  | "crm_stage_updated"
  | "crm_opportunity_created"
  | "crm_opportunity_updated"
  | "crm_opportunity_stage_changed"
  | "crm_opportunity_won"
  | "crm_opportunity_lost"
  | "crm_opportunity_reopened"
  | "crm_activity_created"
  | "crm_note_created"
  | "crm_note_updated"
  | "crm_note_archived"
  | "crm_follow_up_created"
  | "crm_follow_up_completed"
  | "crm_follow_up_cancelled"
  | "crm_tag_created"
  | "crm_tag_assigned"
  | "crm_tag_unassigned"
  | "crm_custom_field_defined"
  | "crm_custom_field_value_set"
  | "crm_project_linked"
  | "crm_workflow_execution_started"
  | "crm_agent_permission_granted"
  | "crm_agent_permission_revoked"
  | "crm_permission_denied"
  // ---------------------------------------------------------------------
  // Sales OS — Module 13. The operational layer over CRM Core; never
  // duplicates a crm_* event, only records Sales-OS-specific process state
  // (config, teams, roles, playbooks, qualification/opportunity execution,
  // sequencing, targets, agent tasks). Metadata never contains CRM PII —
  // only ids, enum values, and field-name lists, identical to the crm_*
  // event rule above.
  // ---------------------------------------------------------------------
  | "sales_configuration_updated"
  | "sales_team_created"
  | "sales_team_member_added"
  | "sales_team_member_removed"
  | "sales_role_granted"
  | "sales_role_revoked"
  | "sales_lead_assigned"
  | "sales_lead_reassigned"
  | "sales_playbook_created"
  | "sales_playbook_version_published"
  | "sales_qualification_started"
  | "sales_qualification_completed"
  | "sales_opportunity_playbook_started"
  | "sales_opportunity_playbook_completed"
  | "sales_next_action_generated"
  | "sales_sequence_created"
  | "sales_sequence_published"
  | "sales_sequence_enrolled"
  | "sales_sequence_stopped"
  | "sales_sequence_step_advanced"
  | "sales_follow_up_created"
  | "sales_approval_linked"
  | "sales_target_created"
  | "sales_target_updated"
  | "sales_forecast_category_set"
  | "sales_agent_task_enqueued"
  | "sales_agent_artifact_created"
  | "sales_permission_denied"
  // ---------------------------------------------------------------------
  // Module 14 — Generic Agent Execution + CRM Lead Authorization Hardening.
  // `agent_task_handler_resolved`/`workflow_agent_task_*` are the generic,
  // task-type-agnostic counterparts to the old Knowledge-Analyst-only
  // `workflow_agent_execution_linked` (still emitted for tool_invocation,
  // unchanged); `crm_lead_qualified_via_sales`/`crm_lead_disqualified_via_sales`
  // are the CRM-side events for a qualification/disqualification performed
  // through the new narrow Sales-rep/manager authority path — never a
  // duplicate of `crm_lead_qualified`/`crm_lead_disqualified` (exactly one
  // of the two fires per transition, on the same audit row's targetId).
  // `sales_qualification_outcome_applied`/`sales_qualification_reconciled`/
  // `sales_qualification_permission_denied` are Sales OS's own operational
  // trail referencing that same CRM event, never re-logging its content.
  // ---------------------------------------------------------------------
  | "agent_task_handler_resolved"
  | "workflow_agent_task_started"
  | "workflow_agent_task_completed"
  | "workflow_agent_task_failed"
  | "workflow_agent_task_reconciled"
  | "crm_lead_qualified_via_sales"
  | "crm_lead_disqualified_via_sales"
  | "sales_qualification_outcome_applied"
  | "sales_qualification_reconciled"
  | "sales_qualification_permission_denied"
  // ---------------------------------------------------------------------
  // Marketing OS — Module 15. The operational layer over CRM Core/Sales
  // OS/Workflow Engine/Projects Core; never duplicates a crm_*/sales_*
  // event, only records Marketing-OS-specific process state (config,
  // teams, roles, campaigns, audiences, content, playbooks/runs,
  // destinations, attribution, budget, agent tasks, approvals). Metadata
  // never contains CRM PII, content bodies, or audience member data —
  // only ids, enum values, counts, and field-name lists, identical to the
  // sales_*/crm_* event rules above.
  // ---------------------------------------------------------------------
  | "marketing_configuration_updated"
  | "marketing_team_created"
  | "marketing_team_member_added"
  | "marketing_permission_granted"
  | "marketing_permission_revoked"
  | "marketing_permission_denied"
  | "marketing_campaign_created"
  | "marketing_campaign_updated"
  | "marketing_campaign_status_changed"
  | "marketing_campaign_archived"
  | "marketing_audience_created"
  | "marketing_audience_updated"
  | "marketing_content_created"
  | "marketing_brand_profile_created"
  | "marketing_creative_reference_created"
  | "marketing_content_studio_started"
  | "marketing_content_studio_package_created"
  | "marketing_content_studio_media_rendered"
  | "marketing_content_studio_saved"
  | "marketing_channel_accounts_seeded"
  | "marketing_performance_recorded"
  | "marketing_content_updated"
  | "marketing_content_submitted_for_review"
  | "marketing_content_approved"
  | "marketing_content_rejected"
  | "marketing_content_published"
  | "marketing_playbook_created"
  | "marketing_playbook_version_published"
  | "marketing_campaign_run_started"
  | "marketing_campaign_run_completed"
  | "marketing_destination_created"
  | "marketing_attribution_recorded"
  | "marketing_budget_updated"
  | "marketing_agent_task_started"
  | "marketing_agent_artifact_created"
  | "marketing_approval_linked"
  | "marketing_project_linked"
  | "marketing_next_action_generated"
  // ---------------------------------------------------------------------
  // Communications & Integrations Core — Module 16. The shared provider-
  // neutral layer CRM Core/Sales OS/Marketing OS build on. Never a message
  // body, full recipient identity, or provider secret in metadata — only
  // ids, enum values, counts, and bounded field-name lists, identical to
  // every other module's audit discipline above.
  // ---------------------------------------------------------------------
  | "integration_connection_created"
  | "integration_connection_verified"
  | "integration_connection_disabled"
  | "integration_credential_rotated"
  | "communication_permission_granted"
  | "communication_permission_revoked"
  | "communication_send_permission_denied"
  | "communication_conversation_created"
  | "communication_message_draft_created"
  | "communication_message_approved"
  | "communication_message_queued"
  | "communication_message_sent"
  | "communication_message_delivered"
  | "communication_message_failed"
  | "communication_message_received"
  | "communication_provider_event_received"
  | "communication_provider_event_deduplicated"
  | "communication_template_created"
  | "communication_template_version_published"
  | "communication_consent_updated"
  | "communication_suppressed"
  | "communication_bulk_created"
  | "communication_bulk_cancelled"
  | "communication_agent_draft_created"
  // ---------------------------------------------------------------------
  // Analytics OS — Module 17. Auditing is deliberately selective: a
  // human-driven query/report action is audited; a dashboard's own
  // routine auto-refresh polling is NOT (it calls the same query engine,
  // but only report save/view/export/drilldown and permission changes
  // are audit-worthy user actions — never a result payload in metadata).
  // ---------------------------------------------------------------------
  | "analytics_query_executed"
  | "analytics_report_created"
  | "analytics_report_updated"
  | "analytics_report_deleted"
  | "analytics_report_viewed"
  | "analytics_drilldown_accessed"
  | "analytics_export_created"
  | "analytics_permission_granted"
  | "analytics_permission_revoked"
  | "analytics_permission_denied"
  // -----------------------------------------------------------------------
  // Founder Workspace / Executive OS — Module 18. Deliberately selective in
  // the same spirit as Analytics OS's own audit list: a dashboard render
  // (including the daily brief's own on-screen recompute) is NOT audited —
  // only durable user-authored actions (decisions, goals, layout, roles,
  // real approval decisions, an actually-generated brief/agent task) are.
  // No sensitive payload (message bodies, PII, full agent inputs) is ever
  // in metadata — bounded ids/enums/counts only.
  // -----------------------------------------------------------------------
  | "founder_workspace_configuration_updated"
  | "founder_decision_created"
  | "founder_decision_updated"
  | "founder_decision_superseded"
  | "founder_goal_created"
  | "founder_goal_updated"
  | "founder_goal_completed"
  | "founder_daily_brief_generated"
  | "founder_agent_task_started"
  | "founder_agent_artifact_created"
  | "founder_permission_granted"
  | "founder_permission_revoked"
  | "founder_permission_denied"
  | "founder_approval_decided"
  // -----------------------------------------------------------------------
  // Jarvis secure phone control. Every event that changes what the platform
  // will actually DO on a founder's spoken instruction is audited: the call
  // itself, both verification outcomes, capture, confirmation, the dispatch
  // result, and the human decision on a gated command. Routine chatter is
  // NOT — an individual transcript turn carries no security signal beyond
  // what capture and confirmation already record, the identical "audit noise
  // without real investigative value" reasoning applied to
  // `knowledge_item_viewed` above.
  //
  // Metadata here is ids, enums, counts and booleans only. Never a
  // transcript, never a caller's phone number, never a verification
  // passcode — this file's blanket redaction rule, restated because this
  // module's inputs come from live speech and are therefore the likeliest
  // place for a secret to arrive by accident.
  // -----------------------------------------------------------------------
  | "jarvis_phone_call_started"
  | "jarvis_phone_call_ended"
  | "jarvis_phone_call_refused"
  | "jarvis_phone_founder_verified"
  | "jarvis_phone_passcode_issued"
  | "jarvis_phone_verification_failed"
  // The founder cleared their own caller budgets. Recorded because it reopens
  // a throttle that something spent — usually a spoofed line — and the pattern
  // of clears is the only durable evidence that happened.
  | "jarvis_phone_verification_lockout_cleared"
  | "jarvis_phone_command_captured"
  | "jarvis_phone_command_confirmed"
  | "jarvis_phone_command_gated"
  | "jarvis_phone_command_override_attempted"
  | "jarvis_phone_command_dispatched"
  | "jarvis_phone_command_dispatch_failed"
  | "jarvis_phone_command_retried"
  // A draft the founder never confirmed, expired because the call it belonged
  // to is over. Recorded with no actor: nobody asked for it.
  | "jarvis_phone_command_expired"
  | "jarvis_phone_command_decided";

export interface RecordAuditEventInput {
  eventType: AuditEventType;
  actorUserId?: string | null;
  /**
   * Brain Module 16/17 — the agent-actor counterpart to `actorUserId`.
   * Mutually exclusive with it in practice (never both set — see
   * `audit_logs_at_most_one_actor_check`), though this function itself
   * doesn't enforce that; the database constraint is the real guard, this
   * is just the write path callers use to populate whichever one applies.
   */
  actorAgentId?: string | null;
  organizationId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  /**
   * Never include tokens, session secrets, OAuth tokens, raw invitation
   * tokens, passwords, nonces, state values, PKCE verifiers, database
   * connection details, or any other secret here — see Module 2 §10/§14's
   * blanket redaction rule. Module 16 extends this rule explicitly to
   * agent credentials: never the raw secret, never its hash — only a
   * credential's non-secret id/key-prefix may ever appear here.
   */
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Thin, typed wrapper over an audit_logs insert — the only way application code writes audit events outside a batched transaction. */
export async function recordAuditEvent(db: Db, input: RecordAuditEventInput): Promise<void> {
  await db.insert(auditLogs).values({
    organizationId: input.organizationId ?? null,
    actorUserId: input.actorUserId ?? null,
    actorAgentId: input.actorAgentId ?? null,
    actorType: input.actorAgentId ? "agent" : input.actorUserId ? "human" : null,
    eventType: input.eventType,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: input.metadata ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });
}

/**
 * Builds (without executing) the raw INSERT query for an audit event, for
 * use inside a `rawSql.transaction([...])` batch alongside the row writes
 * it must succeed-or-fail together with — the established Step 3 principle
 * ("default to rolling back rather than producing an unlogged successful
 * mutation") applies identically to Step 4A's organization/workspace
 * mutations. `metadata` is explicitly JSON-stringified and cast to
 * `jsonb` — the raw neon() tagged-template client does not perform
 * Drizzle's automatic jsonb serialization.
 */
export function auditInsertQuery(rawSql: RawSql, input: RecordAuditEventInput) {
  const metadataJson = JSON.stringify(input.metadata ?? null);
  return rawSql`INSERT INTO audit_logs (id, organization_id, actor_user_id, event_type, target_type, target_id, metadata, ip_address, user_agent)
                VALUES (${randomUUID()}, ${input.organizationId ?? null}, ${input.actorUserId ?? null}, ${input.eventType}, ${input.targetType ?? null}, ${input.targetId ?? null}, ${metadataJson}::jsonb, ${input.ipAddress ?? null}, ${input.userAgent ?? null})`;
}
