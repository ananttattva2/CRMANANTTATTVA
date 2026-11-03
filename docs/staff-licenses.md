# Staff access licenses

Staff sign in starts at `/license`. Keys follow `NAME-XXXX-XXXX-XXXX-USR`,
`NAME-XXXX-XXXX-XXXX-ADM` or `NAME-XXXX-XXXX-XXXX-SADM`. The four-character
prefix comes from the account name; three cryptographically random groups
make each key unique. Super Admin takes precedence over secondary roles.

The server validates the complete key, active account, current email and current
roles. A short-lived, account-bound license session permits password and OTP
verification; it cannot be used as a signed-in bearer token. The UI shows one
login type and the account's registered email. Normal authorization still
checks database roles on every authenticated request.

The `stafflicenses` collection stores a SHA-256 lookup hash and an AES-GCM
encrypted copy for email retries, with unique account and hash indexes. Neither
keys nor ciphertext are included in user DTOs or logs. Preserve `JWT_SECRET`
with the existing production secrets: it also derives the encryption key.

Deployment runs `node backend/src/scripts/syncStaffLicenses.js` before switching
the frontend. It creates keys for existing accounts, emails every account, and
stops the rollout if any account remains pending or provisioning fails.
Inactive accounts also receive their key by email, with an inactive-account
notice. Their key cannot be validated until the account is reactivated. Email status records mail-provider acceptance, not inbox
delivery or a read receipt.

New accounts are provisioned immediately. Role-family or email changes rotate
the key and invalidate the previous key/session. Every minute the persistent
backend reconciles accounts and retries pending delivery with exponential
backoff. Atomic delivery leases prevent simultaneous workers from sending the
same pending message. Unexpired, unchanged accounts retain their keys and are not emailed
again on each deployment. A crash after provider acceptance can cause one retry,
as email providers do not supply a shared transaction with MongoDB.

To reconcile manually, run the same script from the repository root using the
existing backend production environment. It prints only aggregate counts and
exits nonzero for pending/failed work. Never print or export personal keys.

## Automatic renewal after 180 days

Each key has `issuedAt` and `expiresAt`, separated by exactly 180 × 24 hours.
Existing keys are migrated from their original `createdAt` without changing the
key or resending its email. The validity check also handles legacy records before
the migration finishes, so a missing expiry field cannot bypass expiration.

At expiry the old key and any outstanding license-gate session are rejected
immediately, even before the scheduler runs. Signed-in sessions issued through
the gate are capped at the same deadline. The startup scan and one-minute
scheduler atomically replace an expired key, set a fresh 180-day period, and
queue its email. Renewal generally runs within one minute of expiry while the
backend is online; downtime is recovered at startup. Email provider delays and
retries can delay receipt. There is no grace period for the expired key.

A replacement clears the prior delivery/retry state and increments
`renewalCount`. Compare-and-swap prevents simultaneous scans from producing
multiple replacements. Failed delivery retries the same key; retries and
subsequent deployments never move its issuance or expiration dates. Renewal
emails include the expiration date in IST and state that the old key is invalid.
Inactive accounts renew and receive the notice but remain unable to sign in.
