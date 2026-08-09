import type { ProjectPhase } from "@/lib/projects/phases";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { InlineStatusForm } from "./InlineStatusForm";
import { Card } from "@/components/ui/Card";

const PHASE_STATUS_OPTIONS = [
  { value: "not_started", label: "Not started" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export function PhaseItem({ phase, action }: { phase: ProjectPhase; action: (formData: FormData) => Promise<ActionResult> }) {
  return (
    <Card as="li" padding="sm" className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-foreground">{phase.name}</p>
        {phase.description ? <p className="text-xs text-muted">{phase.description}</p> : null}
      </div>
      <InlineStatusForm label={`Status for ${phase.name}`} name="status" currentValue={phase.status} options={PHASE_STATUS_OPTIONS} expectedRevision={phase.revision} action={action} />
    </Card>
  );
}
