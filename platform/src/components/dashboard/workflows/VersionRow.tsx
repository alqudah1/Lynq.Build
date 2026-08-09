import Link from "next/link";
import type { WorkflowVersion } from "@/lib/workflows/versions";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  valid: { label: "Valid", tone: "info" },
  published: { label: "Published", tone: "success" },
  superseded: { label: "Superseded", tone: "neutral" },
  rejected: { label: "Rejected", tone: "danger" },
};

export function VersionRow({ organizationSlug, definitionId, version, isCurrent }: { organizationSlug: string; definitionId: string; version: WorkflowVersion; isCurrent: boolean }) {
  const status = STATUS[version.status] ?? { label: version.status, tone: "neutral" as BadgeTone };
  return (
    <li className="lynq-transition flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-b-0 hover:bg-white/[0.02]">
      <div className="flex flex-col gap-1">
        <Link href={`/app/${organizationSlug}/workflows/${definitionId}/builder?versionId=${version.id}`} className="lynq-transition text-sm font-medium text-foreground hover:text-accent-foreground">
          Version {version.versionNumber}
        </Link>
        <div className="flex items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          {isCurrent ? <Badge tone="accent">Current published</Badge> : null}
        </div>
      </div>
      {version.changeReason ? <p className="max-w-sm text-xs text-muted">{version.changeReason}</p> : null}
    </li>
  );
}
