# Legal SLA register

`/legal` shows client allocations with Client Name, User Name and SLA Status grouped under Yes and No. Search and status filters apply to the visible register. It uses the same permanent Operations/Manager ownership and company grouping as the Purchase/Sales tracker. Admin and Super Admin see all rows; staff and managers retain their existing user/team scope. No user email directory is exposed by the API.

Receipt uses the saved Client Master SLA status. Missing receipt is No; any Yes on a sibling service for the same company and user makes the company Yes. SLA is read directly from MongoDB so cached dashboard snapshots do not delay receipt updates. This is a receipt register, not an SLA expiration report.

The backend scheduler scans every five minutes on Monday from 10:00 AM IST. Each active assigned user gets their pending clients; active Admin and Super Admin plus legal@ananttattva.com get all pending clients. Addresses are deduplicated. Completed clients are rechecked before sending and excluded. Empty digests are not sent. The existing ReminderDelivery collection leases each recipient/week to prevent concurrent or repeated sends. Mail failures are retried on the next scan that Monday; server downtime for the entire Monday means that week's digest is missed. As with existing reminders, a crash after provider acceptance but before saving delivery can replay a message.

The scheduler starts after database startup and uses the existing production mail transport. It does not send a test email during deployment. Verify tests with `node --test backend/test/legalSla.test.js backend/test/legalSlaBrowser.test.js`.
