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
}

export function getNavItems(organizationSlug: string): NavItem[] {
  return [
    { label: "Office", href: `/app/${organizationSlug}` },
    { label: "Projects", href: `/app/${organizationSlug}/projects` },
    { label: "My Work", href: `/app/${organizationSlug}/my-work` },
    { label: "Workflows", href: `/app/${organizationSlug}/workflows` },
    { label: "Workflow Executions", href: `/app/${organizationSlug}/workflow-executions` },
    { label: "CRM", href: `/app/${organizationSlug}/crm` },
    { label: "Sales", href: `/app/${organizationSlug}/sales` },
    { label: "Marketing", href: `/app/${organizationSlug}/marketing` },
    { label: "Communications", href: `/app/${organizationSlug}/communications` },
    { label: "Integrations", href: `/app/${organizationSlug}/integrations` },
    { label: "Analytics", href: `/app/${organizationSlug}/analytics` },
    { label: "Founder", href: `/app/${organizationSlug}/founder` },
    { label: "Members", href: `/app/${organizationSlug}/members` },
    { label: "Invitations", href: `/app/${organizationSlug}/invitations` },
    { label: "Settings", href: `/app/${organizationSlug}/settings` },
  ];
}
