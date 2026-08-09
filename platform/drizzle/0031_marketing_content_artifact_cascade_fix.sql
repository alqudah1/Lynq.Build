ALTER TABLE "marketing_content_item_artifacts" DROP CONSTRAINT "marketing_content_item_artifacts_artifact_id_agent_artifacts_id_fk";
--> statement-breakpoint
ALTER TABLE "marketing_content_item_artifacts" ADD CONSTRAINT "marketing_content_item_artifacts_artifact_id_agent_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."agent_artifacts"("id") ON DELETE cascade ON UPDATE no action;