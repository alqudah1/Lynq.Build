ALTER TABLE "communication_messages" DROP CONSTRAINT "communication_messages_agent_org_fk";
--> statement-breakpoint
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;