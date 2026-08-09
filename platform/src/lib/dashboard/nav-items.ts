/**
 * Desktop and mobile navigation share this exact list (Step 5A, extended
 * in Step 5B, 5C, Module 10, Module 11, Module 12, Module 13, Module 15,
 * and Module 16, Module 17, and Module 18) — a single source of truth so
 * the two surfaces can never drift out of sync. "Dashboard", "Projects",
 * "Workflows", "Workflow Executions", "My Work", "CRM", "Sales",
 * "Marketing", "Communications", "Integrations", "Analytics", "Founder",
 * "Members", "Settings", and "Invitations" are real routes now;
 * Brain/Agents/Clients/Products remain explicit placeholders
 * ("Coming later") with no `href` at all, so they can never navigate to a
 * route that doesn't exist yet. "Clients" is deliberately left as a
 * placeholder rather than repointed at CRM — CRM is the canonical
 * contact/customer layer Sales OS and Marketing OS are both built on, not
 * a "Clients" feature in its own right; a future module may retire this
 * placeholder once a real client-facing surface exists.
 */
export interface NavItem {
  label: string;
  href?: string;
  comingLater?: boolean;
}

export function getNavItems(organizationSlug: string): NavItem[] {
  return [
    { label: "Office", href: `/app/${organizationSlug}` },
    { label: "Projects", href: `/app/${organizationSlug}/projects` },
    { label: "CRM", href: `/app/${organizationSlug}/crm` },
    { label: "Sales", href: `/app/${organizationSlug}/sales` },
    { label: "Marketing", href: `/app/${organizationSlug}/marketing` },
    { label: "Communications", href: `/app/${organizationSlug}/communications` },
    { label: "Integrations", href: `/app/${organizationSlug}/integrations` },
    { label: "Analytics", href: `/app/${organizationSlug}/analytics` },
    { label: "Founder", href: `/app/${organizationSlug}/founder` },
    { label: "Workflows", href: `/app/${organizationSlug}/workflows` },
    { label: "Workflow Executions", href: `/app/${organizationSlug}/workflow-executions` },
    { label: "My Work", href: `/app/${organizationSlug}/my-work` },
    { label: "Brain", comingLater: true },
    { label: "Agents", comingLater: true },
    { label: "Clients", comingLater: true },
    { label: "Products", comingLater: true },
    { label: "Members", href: `/app/${organizationSlug}/members` },
    { label: "Invitations", href: `/app/${organizationSlug}/invitations` },
    { label: "Settings", href: `/app/${organizationSlug}/settings` },
  ];
}
