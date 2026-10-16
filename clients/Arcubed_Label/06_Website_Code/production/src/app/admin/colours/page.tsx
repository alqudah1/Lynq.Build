import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { signOut } from "../actions";
import { createColour } from "./actions";
import * as wf from "@/lib/colour-workflow";
import AvailabilitySwitch from "./AvailabilitySwitch";

export const dynamic = "force-dynamic";
export const metadata = { title: "Colours | Arcubed", robots: { index: false, follow: false } };

const STATUS: Record<wf.CandidateStatus, string> = { draft: "Draft", in_review: "In review", approved: "Approved", rejected: "Rejected" };

export default async function ColoursPage(props: PageProps<"/admin/colours">) {
  if (!(await isAdmin())) redirect("/admin");
  const sp = await props.searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const available = await wf.workflowAvailable();

  return (
    <main className="adm">
      <header className="adm-head">
        <div>
          <p className="adm-kicker">Arcubed</p>
          <h1 className="adm-title">Colours</h1>
        </div>
        <form action={signOut}>
          <button type="submit" className="adm-signout">Sign out</button>
        </form>
      </header>
      <nav className="adm-tabs" aria-label="Admin sections">
        <Link href="/admin/orders">Orders</Link>
        <Link href="/admin/inquiries">Inquiries</Link>
        <Link href="/admin/colours" aria-current="page">Colours</Link>
        <Link href="/admin/colour-lab">Colour Studio</Link>
      </nav>

      {!available ? (
        <section className="cw-setup">
          <p className="adm-h">Not switched on yet</p>
          <p className="adm-note">
            Adding new colours needs one database update (<code>20261015180000_colour_workflow.sql</code>) that has not been
            applied to this database. It adds a private table for colours in progress and changes nothing that exists.
            Until then, nothing here can change what the shop sells.
          </p>
        </section>
      ) : (
        <Workflow error={error} />
      )}
    </main>
  );
}

async function Workflow({ error }: { error: string | null }) {
  const [candidates, bags, catalogue] = await Promise.all([wf.listCandidates(), wf.listBags(), wf.listCatalogue()]);
  return (
    <>
      <section className="cw-section">
        <h2 className="cw-h2">New colours</h2>
        <p className="adm-note cw-lede">
          A new colour goes from Rand&rsquo;s yarn photograph to the shop in steps: measure the yarn, check it on each bag,
          approve it, confirm the supplier can provide it, then publish. Nothing is for sale until it is published.
        </p>
        {error ? <p className="adm-error" role="alert">{error}</p> : null}
        <form action={createColour} className="cw-new">
          <label className="cw-field">
            <span>Colour name</span>
            <input name="name" required maxLength={40} placeholder="e.g. Lilac" autoComplete="off" />
          </label>
          <label className="cw-field">
            <span>Yarn</span>
            <select name="material" required defaultValue="">
              <option value="" disabled>Choose…</option>
              {Object.entries(wf.MATERIALS).map(([k, v]) => <option key={k} value={k}>{v} ({bags.filter((b) => b.material === k).map((b) => b.name).join(", ")})</option>)}
            </select>
          </label>
          <button type="submit" className="cw-btn">Add colour</button>
        </form>
        {candidates.length ? (
          <ul className="cw-list">
            {candidates.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/colours/${c.id}`} className="cw-row">
                  <span className="cw-chip" style={{ background: c.hex ?? "#eee" }} aria-hidden="true" />
                  <span className="cw-row-name">{c.name}<span className="cw-row-sub">{wf.MATERIALS[c.material]}{c.bags.length ? ` · ${c.bags.map((s) => bags.find((b) => b.slug === s)?.name ?? s).join(", ")}` : ""}</span></span>
                  <span className={`cw-status cw-s-${c.status}`}>{STATUS[c.status]}</span>
                  <span className={`cw-status ${c.publishedColourId ? "cw-s-live" : "cw-s-off"}`}>{c.publishedColourId ? "Published" : "Not for sale"}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="adm-note">No new colours yet.</p>
        )}
      </section>

      <section className="cw-section">
        <h2 className="cw-h2">Colours on sale</h2>
        <p className="adm-note cw-lede">Turn a colour off on a bag when the yarn is unavailable. It disappears from the shop and can no longer be ordered; turning it on again brings it back.</p>
        <div className="cw-bags">
          {bags.map((b) => (
            <div key={b.id} className="cw-bag">
              <p className="cw-bag-name">{b.name}</p>
              <ul>
                {catalogue.filter((e) => e.productId === b.id).map((e) => (
                  <li key={e.colourId} className={e.active ? "" : "is-off"}>
                    <span>{e.colourName}</span>
                    <AvailabilitySwitch productId={b.id} colourId={e.colourId} active={e.active} label={`${e.colourName} on the ${b.name}`} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
