import { redirect } from "next/navigation";
import { isAdmin, adminConfigured } from "@/lib/admin-auth";
import SignInForm from "./SignInForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders | Arcubed", robots: { index: false, follow: false } };

export default async function AdminSignInPage() {
  if (await isAdmin()) redirect("/admin/orders");
  return (
    <main className="adm-gate">
      <p className="adm-kicker">Arcubed</p>
      <h1 className="adm-title">Orders</h1>
      {adminConfigured() ? (
        <SignInForm />
      ) : (
        <p className="adm-note">
          Order management is not switched on yet. Set <code>ARCUBED_ADMIN_PASSPHRASE</code> in the
          deployment environment and redeploy.
        </p>
      )}
    </main>
  );
}
