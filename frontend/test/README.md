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
- PWA retirement: exact worker URL/root scope matching (including waiting and
  installing workers), unrelated registrations/caches preserved, denied APIs,
  repeat cleanup, and account/cart/theme/checkout/cookie preservation without reload.
- Temporary retirement worker: immediate activation, only BrewLite cache removal,
  self-unregistration even after cache/claim failures, and no fetch interception.

The page tests use a small hook/element harness to exercise handlers;
they do not validate visual layout or browser accessibility.

## Browser checks for the website migration

Run all four commands from `frontend`: `npm.cmd run lint`, `npm.cmd test`,
`npx.cmd tsc --noEmit --incremental false`, `npm.cmd run build`.
Use `npm`/`npx` on other operating systems. Run the built website with
`npm.cmd run start -- --port 3000` and the existing backend/database.

Check 1440px, 1024px and about 390px in light and dark mode. Visit home, menu,
cart, login/register, checkout, orders and barista with the appropriate role.
Verify header links/cart remain reachable, no bottom navigation/floating cart/
install banner, no extra bottom padding or covered buttons. Open a product,
choose size/toppings, use Tab/Shift+Tab, Escape and verify focus returns to its
trigger. Check search, pagination, promotion, logout and theme/account/cart sync.
Only use a test account and the current test payment flow for order mutations.

Use both a fresh browser profile and an isolated profile that ran the old PWA.
Before updating the latter, record its registrations, `brewlite-pwa-*` caches,
account/cart/theme localStorage, checkout sessionStorage and cookies; keep a tab
open with a pending checkout. Include a test registration at another scope and
a cache without the BrewLite prefix. Visit the new website and verify only
the exact root `/sw.js` registration and BrewLite caches disappear, other app
data stays intact, the page does not reload and checkout remains recoverable.
Let the browser update the old worker URL as a separate check of the retirement
worker; it must not intercept API/navigation or navigate open tabs. Close/reopen
tabs naturally to release any old controller, rather than force-reloading payment.

The unit tests simulate these browser APIs; they do not prove real browser update
timing or profile migration. Document any unavailable browser/backend checks.

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
