# Legal SLA register

`/legal` shows client allocations with Client Name, User Name and SLA Status grouped under Yes and No. Search and status filters apply to the visible register. It uses the same permanent Operations/Manager ownership and company grouping as the Purchase/Sales tracker. Admin and Super Admin see all rows; staff and managers retain their existing user/team scope. No user email directory is exposed by the API.

Receipt uses the saved Client Master SLA status. Missing receipt is No; any Yes on a sibling service for the same company and user makes the company Yes. SLA is read directly from MongoDB so cached dashboard snapshots do not delay receipt updates. This is a receipt register, not an SLA expiration report.

The backend scheduler scans every five minutes on Monday from 10:00 AM IST. Each active assigned user gets their pending clients; active Admin and Super Admin plus legal@ananttattva.com get all pending clients. Addresses are deduplicated. Completed clients are rechecked before sending and excluded. Empty digests are not sent. The existing ReminderDelivery collection leases each recipient/week to prevent concurrent or repeated sends. Mail failures are retried on the next scan that Monday; server downtime for the entire Monday means that week's digest is missed. As with existing reminders, a crash after provider acceptance but before saving delivery can replay a message.

The scheduler starts after database startup and uses the existing production mail transport. It does not send a test email during deployment. Verify tests with `node --test backend/test/legalSla.test.js backend/test/legalSlaBrowser.test.js`.

The register shows 10 rows per page; search and status changes return to page 1. Totals cover the complete filtered list. Emails contain the complete recipient-specific pending list, numbered for Outlook, independently of web pagination.

Admin/Super Admin can use Send SLA List Now outside Monday. Manual sending shares the current Monday week delivery keys, so retries do not resend already accepted lists that week. The Legal SLA Mail workflow provides an authorized preview/send operator against the live runtime; it logs aggregate results only. Existing CRM sender address is retained; Legal messages request the display name Krishna Yadav and include that name in the body/signature. Microsoft 365 can resolve the actual mailbox display name itself.
