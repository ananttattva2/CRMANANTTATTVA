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

## Applicant Type and upload receipt emails

Excel submissions require one Applicant Type selected from the portal catalog. Options are restricted to closed services belonging to the authenticated contact and selected company record. Open services and other companies are excluded on both read and upload validation. The selected type is validated on the server and retained with the upload and submission history.

After the file and metadata are saved, the portal sends an English receipt email to the company's assigned SPOCs and the recorded lead closing user (including on-behalf-of closure references). Recipients are resolved server-side and deduplicated. The email contains the company, lead reference, Applicant Type, submitting contact and file link. Existing SMTP/Microsoft Graph configuration is used. Delivery status is recorded as sent, partial or failed. Email failures do not remove the saved file or prompt the client to upload it again; the client sees a delivery warning. There is no automatic email retry in this version.


## Closed-service popup, support messages and staff upload desk

Clicking the Excel file chooser opens an Applicant Type dialog before the operating system file picker. Dragging a file opens the same dialog. The upload row has no permanent Applicant Type dropdown. Types are resolved using closed service/assignment evidence and stable service IDs; top-level closure applies only to a single-service legacy record.

Client sidebar > Chat & Support lets a client select their company and a closing salesperson, assigned SPOC, IT Support (`it_support@ananttattva.com`) or IT Admin (`it_admin@ananttattva.com`). Contacts are resolved on the server from company relationships. Messages are stored in ClientPortalMessage, and only the selected recipient receives the email. Message content is escaped in email. The client sees history and delivery status; replies are followed up by email rather than a live chat connection. There is a limit of 30 submissions per contact per hour. Failed email delivery does not remove the message.

Staff sidebar > Customer Hub > Client Data Uploads opens `/client-data-uploads`. The paginated table lists Excel submissions with company, Applicant Type, file, submitting contact, upload date and download link. Admins see all records; other staff are scoped by company lead ownership, closure and assignments using the existing visible team scope. `/api/client-portal/staff/uploads` requires a staff token and rejects client sessions.


## Submission stage visibility and Super Admin receipts

Upload receipt emails use a responsive inline-styled layout with labelled submission details and an Excel download button. Active Super Admins are included in the deduplicated upload email recipients alongside the assigned team and closing salesperson. This does not add extra recipients to support messages, which continue to go only to the contact selected by the client.

Client Data Uploads now displays saved Purchase/Sales workflow stages and a View stages dialog. Workflows are matched to the upload's lead and Applicant Type and retain their financial year and unit. Receiving a file does not automatically mark a checklist, review or import as complete. When no matching processing record exists, the page explicitly shows Awaiting workflow setup. Super Admin visibility continues to include all submissions.

Dashboard Client Data & Upload Tracker counts now open client lists for allocated totals, SLA received/not received and Purchase/Sales completed, in-progress and review-pending counts. User rows and grand totals use the same visible data and exact stage state as the displayed count. The client list includes company, Applicant Type/unit and assigned user, with search and keyboard dismissal.


## Assignment display and saved-year tracker progress

The Client Master directory, details and annual Current SPOC display prefer the permanent staff assignment for the selected service (`assignedStaff` and its display/email fields). Service IDs are matched first; positional fallback is limited to legacy assignments without an ID. Sibling-service staff are not borrowed. This is separate from `adminControls.assignedTo` and imported coordinator metadata, now labelled Admin / Record Coordinator in the editor. Historical imported coordinator values are retained rather than overwritten.

The Annual Return tracker continues to enforce closed services and manager/permanent staff allocation. Actual, non-empty Purchase/Sales workflow progress saved for the selected financial year also keeps an allocated service visible if current-PO/CPCB eligibility is no longer satisfied. Blank auto-created workflow records and other-year records do not bypass eligibility. Each checklist stage is still counted from saved state, and saving preliminary data does not mark Upload Complete, Manager Review or Compliance Review as complete.
