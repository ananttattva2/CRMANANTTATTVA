# CTE and CTO/CCA renewal reminders

The DigitalOcean backend starts an hourly scan after MongoDB initialization (first scan after 30 seconds). Serverless installations can call the existing-secret-protected `GET /api/internal/consent-expiry-reminders` endpoint with the configured `CRON_SECRET` bearer token.

Each saved CTE Valid Upto and CTO/CCA Valid Upto date enters its reminder window two calendar months before expiry, clamped to the final day of the month. Calendar days follow Asia/Kolkata. A date entered during the window receives one catch-up reminder. Expired and invalid dates are skipped; CTE marked Not Applicable is skipped.

Email is sent separately to the client's saved authorised/coordinating contact addresses (with linked lead email as a fallback source), active CTE & CTO role-family users, and active Super Admin users, including secondary roles. Missing client email is counted in the scan result while staff still receive their reminder. Recipients never see one another's addresses.

ConsentReminderDelivery stores a unique per-consent-validity-date/per-recipient delivery key. Atomic leases prevent parallel delivery; failed sends are retried on the next scan, and successful sends are not repeated. Changing the expiry date creates a new renewal cycle. Duplicate Client Master records use the newest saved plant consent. As with standard SMTP delivery, an abrupt process failure after provider acceptance but before saving the delivery receipt can result in a retry.

The CTE/CTO directory shows remaining days and renewal-window / expired badges. These badges describe validity dates and do not claim an email was delivered.

Verification: `node --test backend/test/consentExpiryReminders.test.js frontend/test/consentValidity.test.mjs`.
