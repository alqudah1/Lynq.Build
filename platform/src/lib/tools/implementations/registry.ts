import type { ToolImplementation } from "../implementation-types";
import { brainSearchTool } from "./brain-search";
import { brainGetContextTool } from "./brain-get-context";
import { artifactCreateReportTool } from "./artifact-create-report";
import { communicationsCreateDraftTool } from "./communications-create-draft";
import { communicationsSendTool } from "./communications-send";
import { communicationsGetStatusTool } from "./communications-get-status";
import { communicationsListConversationTool } from "./communications-list-conversation";

/**
 * The complete set of tool implementations shipped so far. Module 8's own
 * three, plus Module 16's four Communications OS tools (the `"communication"`
 * tool category already existed in the schema, unused until now — this is
 * the first module to fill it in). Keyed by `toolKey@version` so a future
 * version of an existing tool can coexist with the implementation an
 * already-completed execution's historical `tool_invocations` row still
 * needs to resolve.
 */
const IMPLEMENTATIONS: Record<string, ToolImplementation> = {
  "brain.search@1": brainSearchTool as ToolImplementation,
  "brain.get_context@1": brainGetContextTool as ToolImplementation,
  "artifact.create_report@1": artifactCreateReportTool as ToolImplementation,
  "communications.create_draft@1": communicationsCreateDraftTool as ToolImplementation,
  "communications.send@1": communicationsSendTool as ToolImplementation,
  "communications.get_status@1": communicationsGetStatusTool as ToolImplementation,
  "communications.list_conversation@1": communicationsListConversationTool as ToolImplementation,
};

export function resolveToolImplementation(toolKey: string, version: number): ToolImplementation | null {
  return IMPLEMENTATIONS[`${toolKey}@${version}`] ?? null;
}

export function registerToolImplementation(implementation: ToolImplementation): void {
  IMPLEMENTATIONS[`${implementation.toolKey}@${implementation.version}`] = implementation;
}

export { brainSearchTool, brainGetContextTool, artifactCreateReportTool, communicationsCreateDraftTool, communicationsSendTool, communicationsGetStatusTool, communicationsListConversationTool };
