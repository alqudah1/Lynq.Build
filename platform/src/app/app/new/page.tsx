import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { CreateOrganizationForm } from "@/components/dashboard/CreateOrganizationForm";

export const dynamic = "force-dynamic";

/** Create-organization form (Step 5B). No fake/default organization is ever created automatically — this is the only path one comes into existence, and the creator always becomes its first owner. */
export default async function NewOrganizationPage() {
  const env = loadEnv();
  const db = createDbClient(env);
  await requireDashboardUser(db, "/app/new");

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: "New organization" }]} />
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl italic font-light text-foreground">Create an organization</h1>
        <p className="text-sm text-muted">You&rsquo;ll be the first owner. No workspace is created automatically.</p>
      </header>
      <CreateOrganizationForm />
    </div>
  );
}
