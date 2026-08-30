/**
 * A small, hand-drawn icon set for the primary nav — deliberately not a
 * new dependency (per the refinement pass's own "do not add a large UI
 * dependency simply for appearance" instruction). Single stroke weight,
 * single size, `aria-hidden` always — the accessible name comes from the
 * nav link's own text, never the icon.
 */
import type { SVGProps } from "react";

function Base(props: SVGProps<SVGSVGElement>) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" width={18} height={18} {...props} />;
}

export function IconDashboard(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="4.5" rx="1.5" />
      <rect x="13.5" y="11" width="7" height="9.5" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    </Base>
  );
}

export function IconProjects(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M4 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2h7A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" />
    </Base>
  );
}

export function IconCrm(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19.5c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5" />
      <circle cx="17.5" cy="7.5" r="2.2" />
      <path d="M14.8 12.2c2.6.3 4.7 2.5 4.7 5.3" />
    </Base>
  );
}

export function IconSales(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M4 15l4.5-5 3.5 3 5.5-6.5" />
      <path d="M14 6h3.5v3.5" />
    </Base>
  );
}

export function IconMarketing(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M4 15.5V19h3.5M6 15.5l4-4 3 2.5 5-6" />
      <path d="M15 8h3v3" />
    </Base>
  );
}

export function IconContentStudio(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M9.5 9l5 3-5 3z" />
      <path d="M16.5 4v3M15 5.5h3" />
    </Base>
  );
}

export function IconCommandCenter(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M7 15v2M12 11v6M17 8v9" />
    </Base>
  );
}

export function IconWorkflows(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="19" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="M7 7l3.3 8.7M17 7l-3.3 8.7M7.2 6h9.6" />
    </Base>
  );
}

export function IconExecutions(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </Base>
  );
}

export function IconMyWork(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M9 5.5V4.8a1.3 1.3 0 0 1 1.3-1.3h3.4A1.3 1.3 0 0 1 15 4.8v.7" />
      <rect x="4" y="5.5" width="16" height="14" rx="1.8" />
      <path d="M4 11h16M9.5 11v1.6a.9.9 0 0 0 .9.9h3.2a.9.9 0 0 0 .9-.9V11" />
    </Base>
  );
}

export function IconBrain(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M9 4.5a3 3 0 0 0-3 3v.3a2.7 2.7 0 0 0-1.5 4.8A2.9 2.9 0 0 0 6 18.3a3 3 0 0 0 3 2.2" />
      <path d="M15 4.5a3 3 0 0 1 3 3v.3a2.7 2.7 0 0 1 1.5 4.8A2.9 2.9 0 0 1 18 18.3a3 3 0 0 1-3 2.2" />
      <path d="M9 4.7v15.6M15 4.7v15.6" />
    </Base>
  );
}

export function IconAgents(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="5" y="8" width="14" height="10" rx="2" />
      <path d="M12 8V5.2M9.5 5.2h5" />
      <circle cx="9.3" cy="12.6" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="12.6" r="1" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function IconClients(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M4 19.5v-1.2a4 4 0 0 1 4-4h1a4 4 0 0 1 4 4v1.2" />
      <circle cx="8.5" cy="8" r="3" />
      <path d="M15.5 19.5v-1a3.5 3.5 0 0 1 3-3.46" />
      <circle cx="16.3" cy="7.6" r="2.3" />
    </Base>
  );
}

export function IconProducts(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M12 3.5l7 3.6v9.8l-7 3.6-7-3.6V7.1z" />
      <path d="M5 7.1L12 10.7l7-3.6M12 10.7v9.8" />
    </Base>
  );
}

export function IconMembers(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19.5c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5" />
      <path d="M16 4.3a3 3 0 0 1 0 5.9M18.3 19.5c0-2.4-1.6-4.4-3.8-5.1" />
    </Base>
  );
}

export function IconInvitations(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.8" />
      <path d="M4 7l8 6 8-6" />
    </Base>
  );
}

export function IconSettings(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 4.2v2.1M12 17.7v2.1M4.2 12h2.1M17.7 12h2.1M6.5 6.5l1.5 1.5M16 16l1.5 1.5M17.5 6.5L16 8M8 16l-1.5 1.5" />
    </Base>
  );
}

export const NAV_ICON_BY_LABEL: Record<string, (props: SVGProps<SVGSVGElement>) => React.ReactElement> = {
  Dashboard: IconDashboard,
  Projects: IconProjects,
  CRM: IconCrm,
  Sales: IconSales,
  Marketing: IconMarketing,
  "Marketing Command Center": IconCommandCenter,
  "Content Studio": IconContentStudio,
  Workflows: IconWorkflows,
  "Workflow Executions": IconExecutions,
  "My Work": IconMyWork,
  Brain: IconBrain,
  Agents: IconAgents,
  Clients: IconClients,
  Products: IconProducts,
  Members: IconMembers,
  Invitations: IconInvitations,
  Settings: IconSettings,
};
