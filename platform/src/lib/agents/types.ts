import type { AGENT_DEPARTMENTS, AGENT_PERMISSION_LEVELS, AGENT_LIFECYCLE_STAGES, AGENT_HEALTH_STATUSES } from "./validation";

export type AgentDepartment = (typeof AGENT_DEPARTMENTS)[number];
export type AgentPermissionLevel = (typeof AGENT_PERMISSION_LEVELS)[number];
export type AgentLifecycleStage = (typeof AGENT_LIFECYCLE_STAGES)[number];
export type AgentHealthStatus = (typeof AGENT_HEALTH_STATUSES)[number];
