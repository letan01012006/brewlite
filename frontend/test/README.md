# Frontend regression checks

Run `npm test` from `frontend` (Node 20+ and installed dependencies).
The tests transpile the actual TypeScript modules in isolated contexts using
the existing TypeScript dependency. No browser, real API, database, or payment
gateway is used. Run `npx tsc --noEmit --incremental false` and `npm run build`
separately for type checking and Next.js prerendering.

Coverage:
- Preserve the order and exact payment request across network errors, 5xx,
  PROCESSING conflicts and reloads; new keys only after confirmed failure.
- Reconcile a lost success response without paying again; safely retry cancel.
- Block duplicate/ambiguous creation and mutations when storage cannot persist.
- Checkout handler integration: changed totals require a second confirmation,
  double-click protection, recovery with an empty cart, pending promotion lock.
- Promotion validation against the latest basket, including menu additions,
  removals, clearing, and responses arriving out of order.
- Server-verified authentication, session expiration, account changes, late 401s,
  and stale profile requests; loyalty refresh after payment and cancellation.
- Cart limits (20 per line, 30 lines, shared product stock across variants),
  persisted selections, account isolation, guest merging, corrupt/full storage,
  and refreshing prices, toppings and stock without overwriting later edits.
- Complete catalog pagination and history navigation with stale-response protection.

The page tests use a small hook/element harness to exercise handlers;
they do not validate visual layout or browser accessibility.

Checkout recovery is per account in the current tab's sessionStorage. A pending
order stays fixed until paid or explicitly cancelled. If the POST /orders
response is lost, the UI blocks automatic creation retries and lets the user
recover an order from history. Order creation has no backend idempotency API;
it is deliberately not retried automatically.

The cart is stored separately in localStorage per account (and for guests).
Discount amounts and derived totals are not trusted when restoring. Catalog
data is refreshed on the cart page and before creating a new order. Refreshing
an already reserved checkout uses the order snapshot, not the live cart. Guest
items are merged on login within cart limits; leftovers remain in the guest cart.
Authentication loads the profile from /auth/me, never from the cached user JSON.
The navbar refreshes the profile on focus and every 30 seconds while visible.
Menu search operates on the complete paginated catalog, displayed 12 at a time;
customer history requests the corresponding API page, 20 orders at a time.

The barista API regression lives in backend/test/security-concurrency.e2e-spec.ts
and uses its isolated PostgreSQL schema. It covers role guards, more than 50
active orders hidden behind newer history, and deterministic history pagination.
It also verifies that customer history includes older orders with equal timestamps
across page boundaries without returning another customer's orders.
