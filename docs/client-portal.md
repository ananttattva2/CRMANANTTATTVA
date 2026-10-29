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

## Client portal presentation

The portal uses scoped compact styles and full-width workspace layout. Client Info separates Company overview, Contacts & locations, Services & SPOC, Registration & compliance, and Documents. Blank profile values are omitted, repeated handlers are grouped with their services, company documents are deduplicated, and file URLs/metadata are presented as document actions. Production/product arrays render as tables.

Presentation checks (without browser or computer access):

```
node --test frontend/test/clientPortalPresentation.test.mjs frontend/test/clientPortalRender.test.cjs
```

## Reference layout and staff contact numbers

Client login uses the welcome layout with CSS document illustrations and retains temporary email-only login. Portal lists include search, PO financial-year filtering and 10-row pagination. The dashboard PO value banner is removed; PO page summary cards remain. Help actions open Client Info > Services & SPOC.

Admin Add User and Edit User now support an optional Contact Number. It is persisted on User.contactNumber, returned in staff directory/edit responses and read from the assigned user for the client portal. The number appears beside the handling user's name on dashboard and service-team cards. Existing users have no invented number; edit their user record to populate it.

Client document actions (PO, compliance certificates and company documents) open in a shared in-page popup with PDF/image/text/media previews and a download option. Formats without native preview remain in the popup with a download action. The desktop sidebar is anchored from the header to the bottom of the viewport. Staff Login is hidden from the client login header; the staff login route is unchanged.

## Client file submissions

Client Info accepts Excel `.xlsx` and `.xls` files. Purchase Orders accepts PDF, PNG, JPEG and WebP. Both provide a company selector, drag-and-drop, upload progress and saved submission history. Each file is limited to 15 MB. Uploads are submissions; spreadsheets are not automatically imported into company records, and uploaded PO files do not create financial order rows or change order totals.

`GET /api/client-portal/uploads` lists submissions for leads currently linked to the registered contact email. `POST /api/client-portal/uploads/:lead/:kind` accepts a single multipart `file` (`kind`: `excel` or `po`). Both require a client bearer token. The server rechecks company ownership, file extension and file signatures. Files use the existing Spaces storage service, and metadata is saved in the ClientPortalUpload collection. Existing Spaces runtime configuration is required. Purchase order submissions open in the existing file preview.
