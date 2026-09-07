# Order management

## What Rand can do today

`/admin` — sign in with a passphrase. `/admin/orders` — every order, newest
first, with:

- order number, date, order status, payment status, total
- customer name, email, phone, delivery address, and a flag when the order
  needs a shipping quote (worldwide destinations)
- every line: product, full configuration, quantity, unit price, and whether
  the line is made to order or Ready for Delivery
- a control to change **order status** (pending, confirmed, in production,
  ready, shipped, completed, cancelled) and **payment status** (unpaid, paid,
  refunded)

Before this existed there was no interface at all; orders could only be read
as raw Supabase rows.

## How access is protected

- The passphrase lives only in `ARCUBED_ADMIN_PASSPHRASE` on the server. It is
  never sent to the browser and never inlined into client JavaScript.
- The browser holds an HMAC-signed, httpOnly, sameSite=lax cookie that
  contains no secret and cannot be forged without the server key.
- `src/proxy.ts` refuses `/admin/*` before any render when no valid session is
  present. Every admin page and every Server Action re-checks independently,
  so nothing relies on the proxy alone.
- Comparisons are constant time. Status values are whitelisted, so a crafted
  form post cannot write an arbitrary status.
- Admin pages are Server Components. The service-role Supabase client never
  reaches the browser, exactly as everywhere else in this codebase.
- `/admin` is `noindex` and excluded from `robots.txt` and the sitemap.

## To switch it on

Set `ARCUBED_ADMIN_PASSPHRASE` to a long random value in the deployment
environment and redeploy. Until it is set, `/admin` says so plainly instead of
showing a dead login.

## The known limitation

This is a **shared passphrase, not per-user accounts**. It is the right size
for one owner-operator today, and it is honest about what it is. If Arcubed
ever needs more than one person with access, or an audit trail of who changed
what, the next step is Supabase Auth with a `staff` table and RLS policies on
`orders`. That is a deliberate scope decision, written down rather than
implied.
