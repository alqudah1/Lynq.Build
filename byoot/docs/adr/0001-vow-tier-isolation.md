# 0001 — VOW-tier isolation: Postgres role separation, not session-scoped RLS

**Status:** Accepted

## Context

`listings_vow` (sold price, sold date, price history, historical DOM) may
only be read by an authenticated user who has completed the bona-fide-
consumer acknowledgment (`BYOOT_DATA_CONSTRAINTS.md` Section 3,
`BYOOT_TRANSFORMATION_PLAN.md` Section C). The requirement was explicit:
this boundary must hold **even if the application-layer service function
(`getVowData()`) is bypassed or called incorrectly** — RLS as a second,
independent enforcement layer, not a backstop that trusts the same
application code it's meant to be independent of.

Two ways to express that in Postgres RLS were considered.

### Option considered and rejected: session-scoped RLS via a GUC

The common pattern: the application sets a session variable per request
(`SET app.bona_fide_consumer = 'true'` or similar), and the RLS policy's
`USING` clause reads it back via `current_setting()`. Rejected, for a
reason specific to this stack rather than a general objection to the
pattern:

**Neon's connection pooling (transaction mode) makes this fragile in a way
that fails open, not closed.** `drizzle-orm/neon-http` issues each query as
an independent HTTP request against Neon's serverless driver; when pooled,
the underlying physical Postgres connection is reused across logically
unrelated transactions. A `SET` (without `LOCAL`) persists on that physical
connection past the end of the transaction that issued it — the next,
unrelated request that happens to reuse the same pooled backend connection
can inherit a GUC value it never set itself. Getting this right requires
every single code path that touches the database to wrap the `SET LOCAL`
and the query in the same explicit transaction, every time, with no
exceptions — one call site written as a plain `db.select()` instead of a
transaction silently reintroduces the leak. That's an application-layer
discipline problem again, which is exactly what a second, *independent*
enforcement layer is supposed not to depend on.

### Decision: two Postgres roles, RLS policy scoped to one of them

- `listings_vow` has RLS enabled with exactly one policy, `TO vow_reader`.
- The app's normal connection (`DATABASE_URL`) authenticates as a
  different role with no grant on `listings_vow` at all.
- `getVowData()` is the only code path that ever constructs a client using
  the `vow_reader` role's connection string (`DATABASE_URL_VOW_READER`),
  and only after the application-layer bona-fide-consumer check has
  already passed.

This fails closed at the Postgres **grant** level: whether a given
connection can read `listings_vow` is decided by which role authenticated
it, a fact fixed for the lifetime of that connection, not by a value that
has to be correctly re-asserted on every transaction. A connection pooled,
reused, or reached via a code path that forgot to do something extra still
either has the grant or doesn't — there is no "forgot to set the variable
this time" failure mode.

Verified in `src/lib/listings/vow-gate.integration.test.ts`: the
adversarial case is a raw query against `listings_vow` using the *normal*
role's connection, bypassing `getVowData()` entirely.

## Known limitation — record this plainly, don't let it get discovered later

**Role separation is coarse. It gives tier isolation (VOW vs. not-VOW)
only.** It has no concept of *which* authenticated user is asking — every
session using the `vow_reader` credential can read every row in
`listings_vow`, which is correct for this table (VOW eligibility is a
property of the user's tier, not of which specific listings they're
allowed to see) but is not a pattern that extends to anything requiring
*per-user* filtering.

BYOOT will need per-user filtering soon — saved searches, favourites, and
similar features are inherently "this user's own rows." That requires
session context (an authenticated user ID, scoped in the query's own
`WHERE` clause — the `requireTenantScopedResource` pattern already copied
from `platform/` in `src/lib/authz/helpers.ts`), which is a legitimate,
different mechanism for a different problem.

**The rule going forward:**

- **Roles** are the mechanism for the VOW tier boundary. Nothing else.
- **Session/user context** is the mechanism for per-user rules (saved
  searches, favourites, "my" anything).
- **Per-user logic must never become the thing that guards the VOW
  boundary.** It is tempting, once session-scoped filtering exists
  elsewhere in the codebase for an unrelated feature, to reach for the
  same tool for VOW too — "we already have a pattern for scoping by
  session, let's just add a `bonaFideConsumerAckAt` check to the `WHERE`
  clause instead of maintaining a second role." Doing that would
  reintroduce exactly the fragility this ADR chose against (an
  application-asserted condition instead of a Postgres grant), silently,
  under the appearance of simplification.

**Flag this specifically in review: if a future PR adds a `WHERE`-clause-
based VOW check to a query running under the normal (non-`vow_reader`)
role — anywhere, for any reason, including "just for this one admin
screen" — treat it as a regression of this decision, not a new feature.**
