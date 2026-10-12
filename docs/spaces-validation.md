# Storage migration validation

Base: `ananttattva2/CRMANANTTATTVA` main at `a3e510a` (`Update CRM`). Latest main was fetched and pulled into a clean worktree before implementing the storage changes. The original `CRM_1` checkout has an unrelated unfinished rebase and was preserved.

- Frontend `npm ci` and `npm run build`: passed.
- Migration/storage plus existing email proof, annual-return PO resolver and support ticket tests: **56 passed, 0 failed**.
- Local HTTP integration: actual frontend helper → authenticated CRM routes → S3-compatible HTTP fixture → HEAD confirmation → signed file redirect → PDF bytes. Passed. Streamed migration copy, destination full-read verification, identical-target reuse, repair of this run's corrupted target, and rejection of an unrelated target overwrite also passed.
- Full backend suite: compared with a clean checkout of the same main commit. Both had the same **37 failure names**, with no new failure names introduced. These existing client-master/dashboard/quotation/lead/role UI and workflow failures were not modified as part of storage migration.
- Real Mongoose BSON ObjectId serialization and exact 64-bit journal identifiers were checked. Migration BSON dependency matches Mongoose's BSON major version.
- `git diff --check`: passed.

No production migration, source deletion, Cloudinary inventory request, Spaces write, Atlas reference update or deployment was executed. Cloud credentials and bucket CORS have not been verified. Production browser previews and real MSG/EML attachments still require the approval/configuration/acceptance steps in [spaces-storage.md](spaces-storage.md).

Run the focused checks from backend:

```powershell
node --test test/storageMigration.test.js test/spacesStorage.test.js test/spacesStorageFlow.test.js test/purchaseEmailProof.test.js test/annualReturnPoResolver.test.js test/supportTicket.test.js
```
