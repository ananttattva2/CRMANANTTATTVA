# Client portal

The public navbar provides Client Login at `/client-login`. Existing staff login stays at `/login`.

A client signs in using the exact email saved in Lead Generation > Contact (contacts.emails, contacts.email, or the legacy lead emails field). Email matching is case insensitive. It never creates staff accounts or accepts a password. The same registered email can see all leads explicitly linked to that email.

The sidebar provides Dashboard, Client Info, Purchase Orders, Quotations and Proforma Invoices. Client Info shows company/contact/address/service details, selected Client Master fields and service-level handling users. The dashboard counts uploaded PO files separately from recorded PO rows. PO rows come from lead assignments and issued invoices, with duplicate file/FY records consolidated. Only shared quotations (sent, admin_approved, approved) and issued PI documents are shown. Internal drafts, approval history, notes and portal passwords are not returned. PI view/download uses the existing reference invoice PDF generator.

## Runtime requirements

Uses the existing MongoDB connection, JWT_SECRET, and existing mailer configuration (SMTP or Microsoft Graph). No new external service is required. JWT_SECRET must be configured; client login fails closed when absent. No development OTP is exposed in responses or logs. The production mailer must be configured to deliver OTP emails.

MongoDB creates ClientLoginChallenge and ClientLoginRate collections with unique identity and TTL indexes through Mongoose. OTP codes expire in 10 minutes, have at most five verification attempts, are hashed with an HMAC, and are atomically consumed. Resends require 60 seconds. Request limits are persisted in MongoDB and shared across workers. Client tokens expire in two hours and are separate from staff sessions. Every overview request re-resolves the registered email so removed contact access is not retained. Responses use Cache-Control: no-store.

## Verification

Run from the repository root:

```
node --test backend/test/clientPortal.test.js backend/test/crmCacheInvalidation.test.js backend/test/proformaInvoice.test.js
npm run build --prefix frontend
```

Tests cover exact email matching, record-ID document scoping, credential filtering, client/staff token separation, OTP expiry/attempt filters/replay, resend throttling, mail-failure cleanup, PO counts and deduplication, nested Client Master details and service allocations. OTP delivery is mocked; no email is sent during tests.

For a live acceptance check after deployment, use a contact email controlled by the tester, request its OTP, verify the received code, inspect all five sidebar sections, open an uploaded PO and PI PDF, then sign out. Unknown email addresses receive the same generic request response. A staff token must not open the client overview and a client token must not open staff CRM endpoints.
