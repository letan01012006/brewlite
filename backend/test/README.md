# Backend regression tests

Run from `backend` after installing dependencies and generating the Prisma client.

```powershell
npm test
```

The business rules and authorization suite uses real PostgreSQL connections and real
JWT guards. Set `TEST_DATABASE_URL` explicitly, then run:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://brewlite:brewlite@localhost:5432/brewlite_test'
npm run test:e2e
```

Create/use a dedicated test database first; replace the example URL with its
actual credentials. Do not point this variable at a production database.
The suite creates a unique
`brewlite_test_<uuid>` schema, applies the project's migrations there, and removes
only that schema after the tests. It does not reset or seed existing application
tables. The database user needs permission to create schemas. Application config
(including `JWT_SECRET`) is loaded from `.env`, as in the existing e2e test.

Without `TEST_DATABASE_URL`, this PostgreSQL regression suite is skipped; the
existing Hello World e2e test still runs.

Coverage includes menu write permissions, authenticated promotion validation,
payment replay ownership for SUCCESS/FAILED/PROCESSING, duplicate cancellations,
payment versus cancellation, barista status versus cancellation, duplicate status
updates, and payment retries. It also tests stock contention (10 customers with
stock 5 and 10), basket rollback and repricing on a version conflict, promotion
usage contention, discount caps including zero, expired promotions, and rounding
and reversal of loyalty points.

Payment tests cover five concurrent requests with one key, different keys for one
order, a global key collision across different orders, changed request bodies,
the three-second PROCESSING wait, mock gateway exceptions, and exact success and
failure snapshot replay (including HTTP status and `Idempotent-Replayed`).

Concurrency tests queue HTTP requests behind real PostgreSQL locks and observe
blocked connections before releasing them. E2E apps use the same `configureApp`
function as the server for the `/api` prefix, validation, error filter, and CORS.
State-machine unit tests run with `npm test` and do not need a database.

Task 10 ingredient holds use optimistic `Ingredient.version` checks rather than
`SELECT ... FOR UPDATE` on ingredients. A failed conditional update rolls back
the complete transaction before rereading stock; partial holds and ledger writes
cannot survive a retry. The same retry boundary covers payments made with points.
External gateway calls remain outside the retried transaction.

Run the deterministic PostgreSQL version-race tests with:

```powershell
npm.cmd run test:e2e -- test/inventory-optimistic.e2e-spec.ts
```

The tests pause two real transactions after both read version 0, verify that one
conditional update fails and rereads version 1, and cover both an exhausted last
portion and sufficient remaining stock. They also force a conflict on the second
ingredient after the first has been reserved, verifying that reservation rows,
movements and the first ingredient's quantity/version roll back. A points-payment
race verifies the losing customer's points and ledger remain unchanged. Tests use
only the dedicated test database and their own temporary schema.

Verified for this change: targeted OCC tests 4/4 passed, full integration suite
97/97 passed, unit suite 51/51 passed, and `npm.cmd run build` / `npm.cmd run lint`
both exited 0 (lint retains existing payment/VNPAY warnings). Raw logs are in
`../../.brewlite-verification/inventory-optimistic-{targeted,e2e,unit,build,lint}.log`
relative to `backend`. No migration or reset of the application database is needed.

The kitchen regression verifies `GET /api/orders/active` requires BARISTA and
returns all active orders (63 in the fixture), even behind 65 newer inactive
orders. History pages use a deterministic ID tie-breaker for equal timestamps.

Product/topping regressions use the same isolated PostgreSQL schema. Before the
new relation migration, the fixture creates an existing demo product, toppings
with non-contiguous IDs, an account and an order snapshot. It verifies one-time
backfill and repeated catalog seeding without overriding later manager edits.
Tests cover linked active toppings in list/detail, A+X versus A+Y, topping-free
products, duplicate/invalid/inactive IDs, the per-cup maximum of 3 versus more
than 3 configured options, atomic create/replace/clear, canonical topping creation,
the legacy read alias, removal of `POST /toppings` (404/no writes), and BARISTA guards.
Swagger exposes just the canonical topping creation endpoint. Rejected orders preserve stock/version, promotion usage and
points; subsequent catalog edits preserve order snapshots and payment amounts.
The PricingService unit suite also runs without a database using `npm test`.

## Product creation and per-size recipe setup in the inventory UI

The Kho page has `+ Thêm món` in Sản phẩm & Công thức. Step 1 posts name,
base price, image URL, category and permitted topping IDs to `/api/products`;
the form and payload omit legacy `stock`. Step 2 saves each desired S/M/L recipe
with `PUT /api/products/{id}/recipes/{size}`. Availability comes from ingredient
stock and the recipe. Unconfigured sizes show `Chưa có công thức`. Closing the
editor keeps the created product and all saved sizes so the card can be reopened.

Frontend form/API regressions run with `npm.cmd test` from `frontend` (118 tests
passed). They cover creation payloads without stock, more than three permitted
toppings, invalid inputs, duplicate submission prevention and failure/retry.

For the real-browser suite, run the updated frontend on http://localhost:3000,
configure a separate TEST_DATABASE_URL as above, install Chrome, then from backend:

```powershell
npm.cmd run test:browser:product
```

This suite is separate from the default backend tests. It launches a fresh Chrome
profile and redirects only that browser's API calls to a NestJS test fixture with
an isolated PostgreSQL schema. It leaves the application database untouched.
It verifies creating exactly one product, selecting four toppings, closing before
configuration, reopening, saving S, reloading, injecting one failed M save then
retrying, leaving L unconfigured, and showing 20/10 cups from 1000g with 50g/100g
recipes. It also checks the stored product, topping links, recipes and unchanged
ingredient stock in PostgreSQL. The test passed with desktop and mobile screenshots.

Set CHROME_PATH if Chrome is not at the default Windows installation path.
Set PRODUCT_SETUP_OUTPUT to keep the JSON report and screenshots at a chosen path;
otherwise they are written to a new temporary directory. The verification run's
artifacts are at `../../.brewlite-verification/product-setup/`, with the log at
`../../.brewlite-verification/product-setup-e2e.log` (paths relative to backend).
