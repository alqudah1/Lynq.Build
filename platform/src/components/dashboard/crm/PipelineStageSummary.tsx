import type { CrmPipelineStage } from "@/lib/crm/stages";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export interface StageSummary {
  stage: CrmPipelineStage;
  count: number;
  totalAmount: number;
}

/** Structured stage list with opportunity counts/value — deliberately a plain, accessible list, never a drag-and-drop Kanban board. */
export function PipelineStageSummary({ summaries }: { summaries: StageSummary[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {summaries.map(({ stage, count, totalAmount }) => (
        <Card as="li" key={stage.id} padding="sm" className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2 text-foreground">
            {stage.name}
            {stage.isWon ? <Badge tone="success">Won</Badge> : null}
            {stage.isLost ? <Badge tone="danger">Lost</Badge> : null}
          </span>
          <span className="text-muted">
            {count} {count === 1 ? "opportunity" : "opportunities"} · {totalAmount.toLocaleString()}
          </span>
        </Card>
      ))}
    </ul>
  );
}
