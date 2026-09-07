import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { listOrders, ORDER_STATUSES, PAYMENT_STATUSES } from "@/lib/orders";
import { formatMoney } from "@/lib/site-settings";
import { setStatus, signOut } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders | Arcubed", robots: { index: false, follow: false } };

function address(a: Record<string, unknown> | null): string {
  if (!a) return "";
  return [a.city, a.address, a.building, a.zone].filter(Boolean).join(", ");
}

export default async function AdminOrdersPage() {
  if (!(await isAdmin())) redirect("/admin");
  const orders = await listOrders();

  return (
    <main className="adm">
      <header className="adm-head">
        <div>
          <p className="adm-kicker">Arcubed</p>
          <h1 className="adm-title">Orders</h1>
        </div>
        <form action={signOut}>
          <button type="submit" className="adm-signout">Sign out</button>
        </form>
      </header>

      {orders.length === 0 ? (
        <p className="adm-note">No orders yet. New orders appear here as soon as a customer places one.</p>
      ) : (
        <ul className="adm-list">
          {orders.map((o) => (
            <li key={o.id} className="adm-order">
              <div className="adm-order-top">
                <div>
                  <p className="adm-num">{o.orderNumber}</p>
                  <p className="adm-when">{new Date(o.createdAt).toLocaleString("en-GB")}</p>
                </div>
                <div className="adm-badges">
                  <span className={`adm-badge adm-s-${o.status}`}>{o.status.replace(/_/g, " ")}</span>
                  <span className={`adm-badge adm-p-${o.paymentStatus}`}>{o.paymentStatus}</span>
                </div>
                <p className="adm-total">{formatMoney(o.total, o.currency)}</p>
              </div>

              <div className="adm-order-body">
                <div className="adm-cust">
                  <p className="adm-h">Customer</p>
                  <p>{o.customerName}</p>
                  <p>{o.customerEmail}</p>
                  {o.customerPhone ? <p>{o.customerPhone}</p> : null}
                  {address(o.shippingAddress) ? <p className="adm-addr">{address(o.shippingAddress)}</p> : null}
                  {o.shippingQuoteRequired ? <p className="adm-flag">Shipping quote required</p> : null}
                </div>

                <div className="adm-items">
                  <p className="adm-h">Items</p>
                  {o.lines.map((l, i) => (
                    <div key={i} className="adm-item">
                      <span className="adm-item-name">
                        {l.quantity > 1 ? `${l.quantity} × ` : ""}{l.name}
                        <em className="adm-kind">{l.kind === "ready_for_delivery" ? "Ready" : "Made to order"}</em>
                      </span>
                      {l.configuration.length ? <span className="adm-cfg">{l.configuration.join(" · ")}</span> : null}
                      <span className="adm-item-price">{formatMoney(l.unitPrice * l.quantity, o.currency)}</span>
                    </div>
                  ))}
                  <div className="adm-sums">
                    <span>Subtotal {formatMoney(o.subtotal, o.currency)}</span>
                    <span>Shipping {formatMoney(o.shippingAmount, o.currency)}</span>
                  </div>
                </div>

                <form action={setStatus} className="adm-update">
                  <p className="adm-h">Update</p>
                  <input type="hidden" name="orderId" value={o.id} />
                  <label htmlFor={`st-${o.id}`}>Order status</label>
                  <select id={`st-${o.id}`} name="status" defaultValue={o.status}>
                    {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </select>
                  <label htmlFor={`pa-${o.id}`}>Payment</label>
                  <select id={`pa-${o.id}`} name="paymentStatus" defaultValue={o.paymentStatus}>
                    {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
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
