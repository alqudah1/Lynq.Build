/**
 * Desktop and mobile navigation share this exact list (Step 5A, extended
 * in Step 5B, 5C, Module 10, Module 11, Module 12, Module 13, Module 15,
 * and Module 16, Module 17, and Module 18) — a single source of truth so
 * the two surfaces can never drift out of sync. Every item below is a
 * working route; unfinished modules are omitted instead of appearing as
 * confusing dead-end navigation.
 */
export interface NavItem {
  label: string;
  href?: string;
  comingLater?: boolean;
  section: "Start" | "Work" | "Growth" | "Company" | "Administration";
}

type OrganizationRole = "owner" | "admin" | "member" | "viewer";

/**
 * The founder gets the full operating system. Team members get a deliberately
 * smaller, task-first navigation so they never have to guess where to start
 * or sift through founder-only tools.
 */
export function getNavItems(organizationSlug: string, role: OrganizationRole = "owner"): NavItem[] {
  const base = `/app/${organizationSlug}`;

  if (role === "member" || role === "viewer") {
    return [
      { label: "My Work", href: `${base}/my-work`, section: "Start" },
      { label: "Projects", href: `${base}/projects`, section: "Work" },
      { label: "Marketing Command Center", href: `${base}/marketing/command-center`, section: "Growth" },
      { label: "Content Studio", href: `${base}/marketing/content-studio`, section: "Growth" },
    ];
  }

  return [
    { label: "Office", href: base, section: "Start" },
    { label: "My Work", href: `${base}/my-work`, section: "Start" },
    { label: "Projects", href: `${base}/projects`, section: "Work" },
    { label: "Workflows", href: `${base}/workflows`, section: "Work" },
    { label: "Workflow Executions", href: `${base}/workflow-executions`, section: "Work" },
    { label: "Marketing", href: `${base}/marketing`, section: "Growth" },
    { label: "Marketing Command Center", href: `${base}/marketing/command-center`, section: "Growth" },
    { label: "Content Studio", href: `${base}/marketing/content-studio`, section: "Growth" },
    { label: "CRM", href: `${base}/crm`, section: "Growth" },
    { label: "Sales", href: `${base}/sales`, section: "Growth" },
    { label: "Communications", href: `${base}/communications`, section: "Growth" },
    { label: "Analytics", href: `${base}/analytics`, section: "Growth" },
    { label: "Founder", href: `${base}/founder`, section: "Company" },
    { label: "Integrations", href: `${base}/integrations`, section: "Administration" },
    { label: "Members", href: `${base}/members`, section: "Administration" },
    { label: "Invitations", href: `${base}/invitations`, section: "Administration" },
    { label: "Settings", href: `${base}/settings`, section: "Administration" },
  ];
}
