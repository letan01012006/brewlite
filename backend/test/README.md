# Backend regression tests

Run from `backend` after installing dependencies and generating the Prisma client.

```powershell
npm test
```

The business rules and authorization suite uses real PostgreSQL connections and real
JWT guards. Set `TEST_DATABASE_URL` explicitly, then run:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://brewlite:brewlite@localhost:5432/brewlite'
npm run test:e2e
```

Use a local development or dedicated test database. The suite creates a unique
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
