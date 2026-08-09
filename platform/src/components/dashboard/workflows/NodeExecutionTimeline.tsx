import type { WorkflowNodeExecution } from "@/lib/workflows/node-executions";
import type { WorkflowNode } from "@/lib/workflows/nodes";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: "Pending", tone: "neutral" },
  ready: { label: "Ready", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  waiting: { label: "Waiting", tone: "warning" },
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  skipped: { label: "Skipped", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function NodeExecutionTimeline({ nodeExecutions, nodesById }: { nodeExecutions: WorkflowNodeExecution[]; nodesById: Map<string, WorkflowNode> }) {
  if (nodeExecutions.length === 0) {
    return <EmptyState title="No node activity yet." />;
  }

  return (
    <ol className="flex flex-col">
      {nodeExecutions.map((nodeExecution, index) => {
        const node = nodesById.get(nodeExecution.workflowNodeId);
        const status = STATUS[nodeExecution.status] ?? { label: nodeExecution.status, tone: "neutral" as BadgeTone };
        return (
          <li key={nodeExecution.id} className="relative flex gap-4 pb-4 last:pb-0">
            {index < nodeExecutions.length - 1 ? <span aria-hidden="true" className="absolute left-[7px] top-4 h-full w-px bg-border" /> : null}
            <span aria-hidden="true" className="relative z-10 mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-background bg-accent" />
            <Card padding="sm" className="flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">
                  {node?.name ?? "Unknown node"} <span className="text-xs font-normal uppercase tracking-[0.08em] text-subtle">({node?.nodeType})</span>
                </p>
                <div className="flex items-center gap-2">
                  {nodeExecution.attemptNumber > 1 ? <span className="text-xs text-subtle">attempt {nodeExecution.attemptNumber}</span> : null}
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
              </div>
              {nodeExecution.failureClassification ? <p className="mt-2 rounded-sm border border-danger/30 bg-danger-wash px-2 py-1 text-xs text-danger">Failure: {nodeExecution.failureClassification}</p> : null}
              <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {nodeExecution.runtimeExecutionId ? (
                  <div>
                    <dt className="inline text-subtle">Agent execution: </dt>
                    <dd className="inline">{nodeExecution.runtimeExecutionId.slice(0, 8)}</dd>
                  </div>
                ) : null}
                {nodeExecution.toolInvocationId ? (
                  <div>
                    <dt className="inline text-subtle">Tool invocation: </dt>
                    <dd className="inline">{nodeExecution.toolInvocationId.slice(0, 8)}</dd>
                  </div>
                ) : null}
                {nodeExecution.approvalRequestId ? (
                  <div>
                    <dt className="inline text-subtle">Approval: </dt>
                    <dd className="inline">{nodeExecution.approvalRequestId.slice(0, 8)}</dd>
                  </div>
                ) : null}
                {nodeExecution.projectTaskId ? (
                  <div>
                    <dt className="inline text-subtle">Project task: </dt>
                    <dd className="inline">{nodeExecution.projectTaskId.slice(0, 8)}</dd>
                  </div>
                ) : null}
                {nodeExecution.artifactId ? (
                  <div>
                    <dt className="inline text-subtle">Artifact: </dt>
                    <dd className="inline">{nodeExecution.artifactId.slice(0, 8)}</dd>
                  </div>
                ) : null}
              </dl>
            </Card>
          </li>
        );
      })}
    </ol>
  );
}
