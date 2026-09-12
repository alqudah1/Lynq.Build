// The contact inbox.
//
// The contact form has always written to public.contact_inquiries, and the
// table has always had a status column (new / read / resolved) intended for
// exactly this screen — but the screen did not exist, so the only way to read
// a customer enquiry was to open the Supabase dashboard. The source action
// even claimed messages were "surfaced to Rand in the admin", which was not
// true until this page.
//
// Deliberately not a CRM: a list, the message in full, and three states.

import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdmin } from "@/lib/admin-auth";
import { listInquiries, INQUIRY_STATUSES } from "@/lib/inquiries";
import { notifyStatus } from "@/lib/notify";
import { setInquiryStatus, signOut } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Enquiries | Arcubed", robots: { index: false, follow: false } };

export default async function AdminInquiriesPage() {
  if (!(await isAdmin())) redirect("/admin");
  const inquiries = await listInquiries();
  const notify = notifyStatus();
  const unread = inquiries.filter((i) => i.status === "new").length;

  return (
    <main className="adm">
      <header className="adm-head">
        <div>
          <p className="adm-kicker">Arcubed</p>
          <h1 className="adm-title">Enquiries</h1>
        </div>
        <form action={signOut}>
          <button type="submit" className="adm-signout">Sign out</button>
        </form>
      </header>

      <nav className="adm-tabs" aria-label="Admin sections">
        <Link href="/admin/orders">Orders</Link>
        <Link href="/admin/inquiries" aria-current="page">
          Enquiries{unread ? ` (${unread})` : ""}
        </Link>
      </nav>

      {/* Stated plainly rather than hidden: if the notification credential is
          missing, enquiries are still safe here, but nobody is being emailed
          when one arrives. */}
      {!notify.configured ? (
        <p className="adm-note">
          Email notification is not switched on, so new enquiries appear here only. Set{" "}
          {notify.missing.map((m, i) => (
            <span key={m}>
              {i > 0 ? " and " : ""}
              <code>{m}</code>
            </span>
          ))}{" "}
          in the deployment environment to be emailed when one arrives.
        </p>
      ) : null}

      {inquiries.length === 0 ? (
        <p className="adm-note">
          No enquiries yet. Messages from the contact form appear here as soon as someone sends one.
        </p>
      ) : (
        <ul className="adm-list">
          {inquiries.map((q) => (
            <li key={q.id} className={`adm-inq adm-inq-${q.status}`}>
              <div className="adm-order-top">
                <div>
                  <p className="adm-num">{q.name}</p>
                  <p className="adm-when">
                    {q.createdAt ? new Date(q.createdAt).toLocaleString("en-GB") : ""}
                  </p>
                </div>
                <p className="adm-inq-topic">{q.topic}</p>
              </div>

              <p className="adm-inq-message">{q.message}</p>

              <div className="adm-inq-foot">
                {/* mailto, not a form: replying happens in Rand's own mail
                    client, which is where the conversation should continue. */}
                <a className="adm-inq-reply" href={`mailto:${q.email}?subject=${encodeURIComponent("Re: your Arcubed enquiry")}`}>
                  {q.email}
                </a>
                <form action={setInquiryStatus} className="adm-inq-status">
                  <input type="hidden" name="inquiryId" value={q.id} />
                  <label className="adm-flag" htmlFor={`st-${q.id}`}>Status</label>
                  <select id={`st-${q.id}`} name="status" defaultValue={q.status}>
                    {INQUIRY_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <button type="submit">Save</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
