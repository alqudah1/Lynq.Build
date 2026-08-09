import Link from "next/link";
import type { Project } from "@/lib/projects/projects";
import type { ProgressResult } from "@/lib/projects/progress";
import { Tr, Td } from "@/components/ui/Table";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  proposed: { label: "Proposed", tone: "neutral" },
  planning: { label: "Planning", tone: "info" },
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  blocked: { label: "Blocked", tone: "danger" },
  completed: { label: "Completed", tone: "accent" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  archived: { label: "Archived", tone: "neutral" },
};

export function ProjectRow({
  organizationSlug,
  project,
  progress,
  ownerName,
  workspaceName,
}: {
  organizationSlug: string;
  project: Project;
  progress: ProgressResult;
  ownerName: string;
  workspaceName: string | null;
}) {
  const targetDate = project.targetDate ? new Date(project.targetDate).toLocaleDateString() : "—";
  const status = STATUS[project.status] ?? { label: project.status, tone: "neutral" as BadgeTone };

  return (
    <Tr>
      <Td>
        <Link href={`/app/${organizationSlug}/projects/${project.id}`} className="lynq-transition text-foreground hover:text-accent-foreground">
          {project.name}
        </Link>
      </Td>
      <Td className="text-muted">{project.projectKey}</Td>
      <Td>
        <Badge tone={status.tone}>{status.label}</Badge>
      </Td>
      <Td className="hidden text-muted capitalize sm:table-cell">{project.priority}</Td>
      <Td className="hidden text-muted md:table-cell">{ownerName}</Td>
      <Td className="hidden text-muted lg:table-cell">{workspaceName ?? "—"}</Td>
      <Td className="hidden text-muted lg:table-cell">{targetDate}</Td>
      <Td>
        <ProgressBar percentage={progress.percentage} />
      </Td>
    </Tr>
  );
}
