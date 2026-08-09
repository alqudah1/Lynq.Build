import type { ProjectMilestone } from "@/lib/projects/milestones";
import type { ProgressResult } from "@/lib/projects/progress";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { InlineStatusForm } from "./InlineStatusForm";
import { Card } from "@/components/ui/Card";

const MILESTONE_STATUS_OPTIONS = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "at_risk", label: "At risk" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export function MilestoneItem({ milestone, progress, action }: { milestone: ProjectMilestone; progress: ProgressResult; action: (formData: FormData) => Promise<ActionResult> }) {
  const targetDate = milestone.targetDate ? new Date(milestone.targetDate).toLocaleDateString() : "No target date";

  return (
    <Card as="li" padding="sm" className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-foreground">{milestone.title}</p>
        <p className="text-xs text-subtle">
          {targetDate} · {progress.percentage === null ? "No linked tasks" : `${progress.percentage}% (${progress.completedCount}/${progress.eligibleCount} tasks)`}
        </p>
      </div>
      <InlineStatusForm label={`Status for ${milestone.title}`} name="status" currentValue={milestone.status} options={MILESTONE_STATUS_OPTIONS} expectedRevision={milestone.revision} action={action} />
    </Card>
  );
}
