ALTER TABLE "invitations" DROP CONSTRAINT "invitations_workspace_id_workspaces_id_fk";
--> statement-breakpoint
DROP INDEX "users_email_unique";--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" USING btree (lower("email"));