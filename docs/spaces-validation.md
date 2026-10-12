# Storage migration validation

Latest main was pulled into a clean worktree before implementing the storage changes. Friend updates through `f24d6d8` were subsequently merged and the frontend rebuilt successfully. The original checkout's unrelated unfinished rebase was preserved.

## Automated checks

- Focused migration, backup, storage, email proof, annual-return resolver and support ticket checks: **60 passed, 0 failed**.
- Frontend locked install and production build: passed, including after merging friend changes.
- Local HTTP integration: actual frontend helper → authenticated CRM routes → S3-compatible fixture → confirmation → same-origin PDF preview/download bytes. Streamed copy, full-read checksum verification, identical-target reuse, repair of this run's target, and refusal to overwrite an unrelated target passed.
- BSON ObjectId and exact 64-bit identifiers survive journal serialization. Append-only journal recovery includes pending/applied updates and incomplete-tail handling.
- Full backend suite compared against clean main: the same **37 baseline failure names**, with no new failure names. The general CI backend job still has those existing failures; do not treat this report as a green full-suite result.
- `git diff --check` and backend syntax checks passed.

## Approved production execution

The user separately approved file copying, verified MongoDB updates, and live deployment. Cloudinary deletion was not approved and was not executed.

- Initial library: **5,633 originals plus 9 referenced variants**, **5,642 successful**, zero failed/missing/pending; **2,513,273,802 bytes** verified by size and full SHA-256 destination reads.
- Final main apply: **1,861 applied journal operations**, zero conflicts. A document may have more than one journal operation because verification and updates were resumed in multiple passes.
- A verified targeted BSON/EJSON backup covered **1,802 planned-reference documents in 11 collections**, including index metadata. It is not a full database snapshot. Rollback journals remain private on the server.
- Live deployment at `3eb71cc` succeeded. Actual private PDF, PNG and JPG links returned HTTP 200 with matching SHA-256. Live authenticated upload endpoints returned HTTP 200 and save files in Spaces.
- The bucket-scoped key cannot configure CORS. Browser uploads use the authenticated same-origin fallback when necessary, still writing only to Spaces. Fallback size limit is 25 MiB, subject to ingress limits.
- Post-cutover capture reconciled **5,647 originals plus the original 9 reference variants: 5,656 unique verified files, 2,517,000,777 bytes**, zero failed/missing/pending. Its separate recent-reference backup covered 3 documents, followed by **3 successful Mongo journal operations**, zero conflicts. Combined applied journal operations: **1,864**. Full original persisted-reference verification checked 1,802 unique records with zero changed/missing.
- Active production CRM confirmed by the user: **https://crmananttattva.com**. The old Vercel alias is outside the connected account and still serves an old backend. The repository proxy now points to the DigitalOcean CRM; the native Vercel workflow reachability check does not prove deployment of a particular commit. No live Vercel cutover is claimed.
- The shared Cloudinary library continues receiving files from other/legacy callers. The report covers the successfully reconciled inventory snapshot; files added after that snapshot require another original inventory/copy pass. The active DigitalOcean CRM uploads only to Spaces.
- A redundant read-only delta scan was intentionally stopped after the original full scan and verification were complete; its failed Actions result is an interrupted inventory, not a failed transfer. Its private checkpoint is preserved.

Private URLs use the stable CRM `/api/assets/file` capability route; MongoDB stores Spaces identifiers and those CRM links rather than publicly exposing objects. Holding a signed link grants access; these are shareable capability URLs, not record-scoped authorization.

Full per-file JSON/CSV reports, inventories, backups and rollback values remain under the production app's private `.storage-migration` directory and are not public GitHub artifacts.
