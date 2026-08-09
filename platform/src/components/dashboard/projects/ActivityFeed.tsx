import type { ProjectEvent } from "@/lib/projects/events";
import { EmptyState } from "@/components/ui/EmptyState";

const EVENT_LABELS: Record<string, string> = {
  project_created: "Project created",
  project_updated: "Project updated",
  project_status_changed: "Status changed",
  project_archived: "Project archived",
  project_member_added: "Member added",
  project_member_role_changed: "Member role changed",
  project_member_removed: "Member removed",
  project_phase_created: "Phase created",
  project_phase_updated: "Phase updated",
  project_milestone_created: "Milestone created",
  project_milestone_updated: "Milestone updated",
  project_task_created: "Task created",
  project_task_updated: "Task updated",
  project_task_status_changed: "Task status changed",
  project_task_assigned: "Task assigned",
  project_task_assignment_removed: "Task assignment removed",
  project_task_dependency_added: "Dependency added",
  project_task_dependency_removed: "Dependency removed",
  project_artifact_linked: "Artifact linked",
  project_agent_execution_launched: "Agent execution launched",
  project_approval_linked: "Approval linked",
};

/** The user-facing project timeline — never the security/compliance audit log. */
export function ActivityFeed({ events, actorNameById }: { events: ProjectEvent[]; actorNameById: Map<string, string> }) {
  if (events.length === 0) {
    return <EmptyState title="No activity yet." />;
  }

  return (
    <ol className="flex flex-col">
      {events.map((event) => (
        <li key={event.id} className="border-b border-border py-3 text-sm text-foreground last:border-b-0">
          <span className="text-subtle">{new Date(event.createdAt).toLocaleString()}</span>
          {" — "}
          {EVENT_LABELS[event.eventType] ?? event.eventType}
          {event.actorUserId ? ` by ${actorNameById.get(event.actorUserId) ?? "someone"}` : event.actorAgentId ? " by an agent" : ""}
        </li>
      ))}
    </ol>
  );
}
