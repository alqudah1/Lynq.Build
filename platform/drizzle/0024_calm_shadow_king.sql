ALTER TABLE "workflow_executions" DROP CONSTRAINT "workflow_executions_project_org_fk";
--> statement-breakpoint
ALTER TABLE "workflow_executions" DROP CONSTRAINT "workflow_executions_project_task_org_fk";
--> statement-breakpoint
ALTER TABLE "workflow_executions" DROP CONSTRAINT "workflow_executions_current_node_org_fk";
--> statement-breakpoint
ALTER TABLE "workflow_node_executions" DROP CONSTRAINT "workflow_node_executions_runtime_execution_org_fk";
--> statement-breakpoint
ALTER TABLE "workflow_node_executions" DROP CONSTRAINT "workflow_node_executions_project_task_org_fk";
--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_project_task_id_project_tasks_id_fk" FOREIGN KEY ("project_task_id") REFERENCES "public"."project_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_current_node_id_workflow_nodes_id_fk" FOREIGN KEY ("current_node_id") REFERENCES "public"."workflow_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_executions" ADD CONSTRAINT "workflow_node_executions_runtime_execution_id_agent_executions_id_fk" FOREIGN KEY ("runtime_execution_id") REFERENCES "public"."agent_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_executions" ADD CONSTRAINT "workflow_node_executions_project_task_id_project_tasks_id_fk" FOREIGN KEY ("project_task_id") REFERENCES "public"."project_tasks"("id") ON DELETE set null ON UPDATE no action;