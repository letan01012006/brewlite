# BrewLite Postman full run

Result: **PASS**

- Runner: Postman CLI
- Collection: 65 requests, 1 iteration
- Requests executed: 66; failures: 0
- Assertions executed: 91; failures: 0
- Timestamp (UTC): 2026-11-15T14:00:11.144Z
- Database: brewlite_postman_20261115135852295_8854

The HTTP request count includes one helper request to the local VNPAY bank simulator in addition to the 65 collection requests.

OTP delivery and the external VNPAY bank were simulated locally. Real BrewLite HTTP endpoints, PostgreSQL, authorization, payment signatures, invalid/successful/duplicate IPN callbacks and signed refunds were exercised. This is not evidence of a real eSMS delivery or a real VNPAY sandbox/bank settlement.

Verified simulator events: {"paymentUrlsVerified":1,"invalidIpnsRejected":1,"successfulIpns":1,"duplicateIpnsRejected":1,"refundsVerified":1}

Full runner output: `C:\Users\letro\OneDrive\Desktop\doanreal\brewlite\.local-backups\postman-runs\20261115135852295_8854\postman.log`.

Repeat from the repository root: `node backend/postman/run-full.mjs`.
