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
the frontend. It creates keys for existing accounts, emails active accounts, and
stops the rollout if any active account remains pending or provisioning fails.
Inactive accounts receive a key but cannot validate it or receive access emails
until reactivated. Email status records mail-provider acceptance, not inbox
delivery or a read receipt.

New accounts are provisioned immediately. Role-family or email changes rotate
the key and invalidate the previous key/session. Every five minutes the persistent
backend reconciles accounts and retries pending delivery with exponential
backoff. Atomic delivery leases prevent simultaneous workers from sending the
same pending message. Unchanged accounts retain their keys and are not emailed
again on each deployment. A crash after provider acceptance can cause one retry,
as email providers do not supply a shared transaction with MongoDB.

To reconcile manually, run the same script from the repository root using the
existing backend production environment. It prints only aggregate counts and
exits nonzero for pending/failed work. Never print or export personal keys.
