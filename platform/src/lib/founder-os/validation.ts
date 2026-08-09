import { z } from "zod";

export const FOUNDER_ROLES = ["founder_viewer", "founder_executive", "founder_admin"] as const;
export type FounderRole = (typeof FOUNDER_ROLES)[number];

export const FOUNDER_CAPABILITIES = [
  "founder_workspace_view",
  "founder_workspace_view_financial",
  "founder_workspace_view_sales",
  "founder_workspace_view_marketing",
  "founder_workspace_view_operations",
  "founder_workspace_view_agents",
  "founder_workspace_manage_goals",
  "founder_workspace_manage_decisions",
  "founder_workspace_manage_layout",
  "founder_workspace_admin",
] as const;
export type FounderCapability = (typeof FOUNDER_CAPABILITIES)[number];

export const FOUNDER_DECISION_STATUSES = ["proposed", "decided", "superseded", "archived"] as const;
export type FounderDecisionStatus = (typeof FOUNDER_DECISION_STATUSES)[number];

export const FOUNDER_GOAL_STATUSES = ["active", "completed", "missed", "archived"] as const;
export type FounderGoalStatus = (typeof FOUNDER_GOAL_STATUSES)[number];

export const MAX_ATTENTION_ITEMS = 50;
export const MAX_ACTIVITY_FEED_ITEMS = 30;

export const titleSchema = z.string().trim().min(1).max(200);
export const decisionTextSchema = z.string().trim().min(1).max(4000);
