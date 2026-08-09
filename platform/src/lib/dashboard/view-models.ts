/**
 * Client-safe view models for the dashboard shell (Step 5A). Each mapping
 * function is the explicit, testable boundary between a full domain record
 * (which may carry IDs, timestamps, or other fields never meant to reach
 * client components) and what actually gets passed as props to a "use
 * client" component. Never pass a raw `OrganizationForUser`/`WorkspaceForUser`
 * row directly to a client component — always go through one of these.
 */

export interface OrganizationSwitcherItem {
  slug: string;
  name: string;
  role: string;
}

export interface WorkspaceSwitcherItem {
  slug: string;
  name: string;
  role: string;
}

export function toOrganizationSwitcherItems(
  organizations: { slug: string; name: string; role: string }[]
): OrganizationSwitcherItem[] {
  return organizations.map((org) => ({ slug: org.slug, name: org.name, role: org.role }));
}

export function toWorkspaceSwitcherItems(
  workspaces: { slug: string; name: string; role: string }[]
): WorkspaceSwitcherItem[] {
  return workspaces.map((ws) => ({ slug: ws.slug, name: ws.name, role: ws.role }));
}
