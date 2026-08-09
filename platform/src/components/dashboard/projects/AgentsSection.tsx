import type { ProjectExecutionLink } from "@/lib/projects/links";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  queued: { label: "Queued", tone: "neutral" },
  assigned: { label: "Assigned", tone: "neutral" },
  gathering_context: { label: "Starting", tone: "info" },
  planning: { label: "Planning", tone: "info" },
  reasoning: { label: "Reasoning", tone: "info" },
  waiting: { label: "Waiting", tone: "warning" },
  executing: { label: "Running", tone: "info" },
  delegating: { label: "Delegating", tone: "info" },
  human_approval: { label: "Awaiting approval", tone: "warning" },
  verifying: { label: "Verifying", tone: "info" },
  paused: { label: "Paused", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  archived: { label: "Archived", tone: "neutral" },
};

/**
 * Every agent execution ever launched for this project — read-only here;
 * launching happens from the task it targets (see the Tasks tab), never
 * generically. "Support the existing Company Knowledge Analyst agent
 * only" — this section reflects that: one agent, real executions, no
 * autonomous assignment.
 */
export function AgentsSection({ links, taskTitleById }: { links: ProjectExecutionLink[]; taskTitleById: Map<string, string> }) {
  if (links.length === 0) {
    return <EmptyState title="No agent executions launched yet." description="Launch the Company Knowledge Analyst from a task in the Tasks tab." />;
  }

  return (
    <ul className="flex flex-col gap-2">
      {links.map((link) => {
        const status = STATUS[link.executionStatus] ?? { label: link.executionStatus, tone: "neutral" as BadgeTone };
        return (
          <Card as="li" key={link.id} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-foreground">Task: {taskTitleById.get(link.taskId) ?? link.taskId}</span>
            <Badge tone={status.tone}>{status.label}</Badge>
          </Card>
        );
      })}
    </ul>
  );
}
