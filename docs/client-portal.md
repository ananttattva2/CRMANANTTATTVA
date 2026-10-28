> Temporary email-only login is active: `/api/client-portal/login` accepts a registered Contact email and creates a client session without sending or verifying an OTP. This does not prove ownership of the email address. OTP routes are unmounted; the original OTP handlers are retained for restoring OTP login later. Staff login is unchanged. The dashboard still resolves records from the registered contact email on every request.

# Client portal

The public navbar provides Client Login at `/client-login`. Existing staff login stays at `/login`.

A client signs in using the exact email saved in Lead Generation > Contact (contacts.emails, contacts.email, or the legacy lead emails field). Email matching is case insensitive. It never creates staff accounts or accepts a password. The same registered email can see all leads explicitly linked to that email.

The sidebar provides Dashboard, Client Info, Purchase Orders, Quotations and Proforma Invoices. Client Info shows company/contact/address/service details, selected Client Master fields and service-level handling users. The dashboard counts uploaded PO files separately from recorded PO rows. PO rows come from lead assignments and issued invoices, with duplicate file/FY records consolidated. Only shared quotations (sent, admin_approved, approved) and issued PI documents are shown. Internal drafts, approval history, notes and portal passwords are not returned. PI view/download uses the existing reference invoice PDF generator.

## Runtime requirements (current temporary mode)

Uses the existing MongoDB connection, JWT_SECRET, and existing mailer configuration (SMTP or Microsoft Graph). No new external service is required. JWT_SECRET must be configured; client login fails closed when absent. No email is sent in the current temporary mode. Mail configuration will be needed when OTP login is restored.

The retained OTP implementation creates ClientLoginChallenge and ClientLoginRate collections with unique identity and TTL indexes through Mongoose. OTP codes expire in 10 minutes, have at most five verification attempts, are hashed with an HMAC, and are atomically consumed. Resends require 60 seconds. Request limits are persisted in MongoDB and shared across workers. Client tokens expire in two hours and are separate from staff sessions. Every overview request re-resolves the registered email so removed contact access is not retained. The temporary email-only endpoint issues the same client-scoped token without checking a code. Responses use Cache-Control: no-store.

## Verification

Run from the repository root:

```
node --test backend/test/clientPortal.test.js backend/test/crmCacheInvalidation.test.js backend/test/proformaInvoice.test.js
npm run build --prefix frontend
```

Tests cover exact email matching, record-ID document scoping, credential filtering, client/staff token separation, OTP expiry/attempt filters/replay, resend throttling, mail-failure cleanup, PO counts and deduplication, nested Client Master details and service allocations. OTP delivery is mocked; no email is sent during tests.

For a live acceptance check after deployment, enter a registered contact email, inspect all five sidebar sections, open an uploaded PO and PI PDF, then sign out. Unregistered emails are rejected. Both OTP endpoints are disabled in temporary mode. A staff token must not open the client overview and a client token must not open staff CRM endpoints.
