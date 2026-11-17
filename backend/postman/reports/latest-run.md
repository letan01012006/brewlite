# BrewLite Postman full run

Result: **PASS**

- Runner: Postman CLI
- Collection: 44 Swagger endpoints, 57 scenario requests, 1 iteration
- Requests executed: 59; failures: 0
- Assertions executed: 83; failures: 0
- Timestamp (UTC): 2026-11-16T08:08:00.948Z
- Database: brewlite_postman_20261116080636442_9194

The HTTP request count includes helper requests to the local VNPAY bank simulator and the deleted-staff token check in addition to the scenario requests.

OTP delivery and the external VNPAY bank were simulated locally. Real BrewLite HTTP endpoints, PostgreSQL, authorization, payment signatures, invalid/successful/duplicate IPN callbacks and signed refunds were exercised. This is not evidence of a real eSMS delivery or a real VNPAY sandbox/bank settlement.

Verified simulator events: {"paymentUrlsVerified":1,"invalidIpnsRejected":1,"successfulIpns":1,"duplicateIpnsRejected":1,"refundsVerified":1}

Full runner output: `C:\Users\letro\OneDrive\Desktop\doanreal\brewlite\.local-backups\postman-runs\20261116080636442_9194\postman.log`.

Repeat from the repository root: `node backend/postman/run-full.mjs`.
