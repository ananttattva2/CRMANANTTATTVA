# Cloudinary → DigitalOcean Spaces migration

Target: `ananttattva-crm-files`, region `sgp1`, endpoint `https://sgp1.digitaloceanspaces.com`.

### Remote operations through GitHub Actions

The existing **Production Diagnostics** workflow now supports `inventory`, `copy`, `apply` and `rollback` on the migration branch. It uses the existing DigitalOcean SSH secrets plus `SPACES_ACCESS_KEY_ID` and `SPACES_SECRET_ACCESS_KEY`; no secret values are printed. Migration code/dependencies are staged separately from the live application. Backend storage environment values are installed securely, preserving a stable signing secret. Persistent state/reports live under the server app directory's `.storage-migration/state/crm-full`; full reports are not published to public Actions artifacts.

Mutating operations require confirmation `COPY_AND_UPDATE_APPROVED`. Apply checks the live `/api/assets/file` route before introducing new links. Unless an existing Atlas backup is explicitly confirmed, it first backs up complete BSON/EJSON documents selected by the reference inventory, using bounded snapshot sessions, records index metadata, and verifies every backup file's count/checksum on the server. This targeted backup complements the per-record rollback journal; it is not a whole-database backup. SSH keep-alives prevent idle disconnects, and stale local locks are removed only after verifying that the recorded process is no longer running.

For files added during cutover, run `delta-inventory`, then `delta-copy`, `delta-backup`, and `delta-apply`. The isolated `crm-delta` directory retains its own inventory, backup and rollback journal. Existing identical destination objects are fully hashed before reuse. Resume each operation against the same directory. Rollback of a delta run must also use that directory.

After a completed full inventory, `delta-inventory-originals` refreshes the shared library in `crm-delta-originals`; `delta-copy-originals` imports unchanged verified originals and copies new assets. `delta-inventory-recent` seeds a separate reference pass from that inventory and scans all collections for documents created/updated in the preceding 24 hours, plus documents with neither timestamp. This incremental mode assumes timestamped CRM writes maintain their timestamps; the default full inventory has no date filter. Follow with `delta-copy`, `delta-backup`, and `delta-apply`. `delta-stop-inventory` stops only the matching redundant read-only delta inventory and preserves its checkpoint. It cannot stop a copy/apply or unrelated process. `quick-diagnostics` reports aggregate progress and live sample checks without reading every migrated Mongo document.

Future uploads prefer direct browser-to-Spaces PUTs. If browser CORS/network access is unavailable, the authenticated same-origin upload endpoint verifies the file SHA-256 and uploads server-to-Spaces, never Cloudinary. The fallback limit is 25 MiB and still depends on the deployed ingress's body limit. Migration copy uses at most four workers by default (configurable to eight) and publishes aggregate progress only. Copy checkpoints are batched; a crash may replay a few transfers, which re-hash existing targets before reuse. Mongo write-ahead journal entries are fsynced before every update; periodic state snapshots replay that journal on resume.

**This implementation does not run migration on deploy/startup. No Cloudinary deletion command exists. Production copy, MongoDB updates and rollback are separate, explicitly approved operator actions.**

## What is migrated

The read-only Cloudinary Search API is paginated without an expression/type filter, so inventory includes all current original library assets: image (including PDFs), raw (documents, EML/MSG, spreadsheets), video/audio, and public/private/authenticated/other delivery types. It includes files with no MongoDB references. Discovery must finish and its unique original count must match Cloudinary `total_count` before copy can start. API errors, a changing total or truncated results block completeness. If your account's Search API result limit prevents a complete inventory, do not proceed: export an unrestricted inventory with Cloudinary support first.

MongoDB discovery scans all non-system collections in the configured CRM database by default, including nested arrays, snapshots, URL strings embedded in email HTML/text and JSON strings. `STORAGE_MIGRATION_COLLECTIONS` optionally restricts the scan; use the default for ALL CRM references. Views are skipped because they cannot be updated directly. Other databases require their own run. Cloudinary custom-domain/vanity URLs and non-Cloudinary inline/base64 files are not automatically matched; audit those separately before retirement.

Current originals download by immutable `asset_id` through signed Cloudinary `/asset/download`, without transformations or format conversion, including private/authenticated originals. Exact Cloudinary URLs in MongoDB that differ from the canonical originals are additional reference entries: this preserves saved transformed or old-version bytes where accessible. Unavailable URLs become `missing` (404/410) or `failed` (e.g. 401/403), and their references stay unchanged. This covers **existing current originals and referenced accessible versions**, not every historical backup/deleted asset or every unused generated derivative. Cloudinary cannot supply a deleted/inaccessible original merely because its old URL exists in MongoDB.

Fixed folder mode uses public ID path; dynamic mode uses `asset_folder`. Raw file extensions are retained. Normal images/video get their actual extension appended. Existing `crm/...` and other folder prefixes are preserved directly in the Space, with no `spaces/` parent. Colliding paths receive deterministic suffixes within the same folder; unsafe paths fail visibly. Empty Cloudinary folders are metadata, not binary files, and are not recreated.

## Setup before inventory

1. Configure values in [the backend template](../backend/.env.spaces.example) on the actual backend host. Copy the CRM's Mongo settings unchanged. Use a bucket-scoped Spaces object key; never expose it to frontend code. Use read-only Cloudinary Admin credentials where available. Regional Cloudinary accounts can set `CLOUDINARY_API_PREFIX` to `https://api-eu.cloudinary.com` or `https://api-ap.cloudinary.com`.
2. Set `STORAGE_PUBLIC_API_ORIGIN` to the real CRM origin which serves/proxies `/api/assets`; no `/api` suffix. Set and retain the same random `SPACES_LINK_SECRET` (at least 32 characters) on all instances. Losing/rotating it breaks saved capability URLs. The journal binds cloud, destination, database configuration, origin and secret fingerprint to prevent accidental cross-environment resume.
3. Keep bucket listing restricted and objects private. Configure the bucket CORS using [spaces-cors.xml](spaces-cors.xml), replacing/adding exact production and local testing origins. Browser PUTs require `Content-Type`, `Content-Disposition`, and `x-amz-checksum-sha256`; don't omit signed headers. This file is a template, not a configuration already applied to your account.
4. Run `npm ci` in backend and frontend. Use Node 22 (same as CI). Store the migration directory on persistent encrypted storage with restricted access and adequate space for the largest file. It contains URLs, Mongo IDs and rollback journal values; never commit or publicly upload it. Back it up independently before applying references. Copy is streamed to disk; multipart uploads support large assets with bounded memory.
5. Freeze legacy Cloudinary uploads/edits while taking inventory/copy, or switch future uploads to Spaces first, then inventory. Current asset originals can change on Cloudinary; inventory byte counts detect size drift, but a same-size edit needs the operational freeze. Create a fresh inventory after legacy writes stop to reconcile any new assets.

## Operator commands

All commands run from `backend`. Use a named persistent directory per inventory, and keep it for retry/resume/rollback. **Do not run production writes until the owner approves the reviewed report.**

```powershell
# Read-only remote discovery; writes only local state/report files.
npm run migrate:storage -- inventory --dry-run --run-dir storage-migration-output/crm-full

# Resume interrupted inventory, including its saved Cloudinary page cursor.
npm run migrate:storage -- inventory --resume --run-dir storage-migration-output/crm-full

# Report only: no cloud/database requests or writes.
npm run migrate:storage -- report --run-dir storage-migration-output/crm-full
```

Review `report.json`, `report.csv`, `state.json`, total count, folders, collisions and reference coverage. Inventory shows pending files; checksums are computed during copy, not invented during dry-run. Reports include total/successful/failed/missing/pending, original vs reference entries, byte counts, per-file SHA-256, attempts and database conflicts. A nonzero exit status signals incomplete discovery/failures/missing/conflicts; do not treat it as success.

Only **after approval**:

```powershell
# Copy or resume pending assets; verified files are skipped. No MongoDB writes.
npm run migrate:storage -- copy --approve-production --resume --run-dir storage-migration-output/crm-full

# Explicitly retry failed/missing assets as well as pending assets.
npm run migrate:storage -- copy --approve-production --retry --run-dir storage-migration-output/crm-full

# Read-only destination re-verification, including full download hashing.
npm run migrate:storage -- verify --run-dir storage-migration-output/crm-full

# Take/verify an Atlas backup and back up state.json before approving this step.
npm run migrate:storage -- apply --approve-production --backup-confirmed --run-dir storage-migration-output/crm-full

# Resume pending write-ahead entries and retry Mongo compare-and-set conflicts.
npm run migrate:storage -- apply --approve-production --backup-confirmed --retry --run-dir storage-migration-output/crm-full
```

Every file is downloaded, SHA-256 hashed, uploaded privately, then downloaded from Spaces and hashed again. Source/download length, library byte count (when present), destination HEAD length and SHA-256 must agree. ETags are not used as checksums. If a destination key already has identical bytes, it is reused; unrelated differing objects are never overwritten. Only differing objects explicitly tagged as this run's own previous attempt may be repaired. Coordinate operators so another process never writes to the same destination keys between HEAD and PUT; local locks protect only one run directory, not the entire bucket.

Apply re-verifies all successful destination objects before any Mongo writes, updates only successfully verified URLs and matching existing `publicId`/`storageKey` siblings, and leaves failed/missing references alone. It can make partial progress; inspect the report, don't assume all files were migrated. BSON identifiers retain their types. Each document's old/new leaf values are durably checkpointed before update. Exact compare-and-set conditions protect newer edits. Resume recognizes a Mongo update that completed just before a crash. No collections/documents are dropped and no source files are deleted.

Automatic HTTP retries use bounded exponential backoff for transient errors/429. A mid-stream failure is reported and retried via the explicit `--retry` command. After an interruption, retain the directory and run the same command with `--resume`. If an abrupt kill leaves `run.lock`, verify that its PID is no longer running, then remove only that local lock; never run two operators on the same run. `--resume` on copy/apply is descriptive; those commands always honor saved state. New inventory requires a different directory.

## Rollback (separate approval)

```powershell
npm run migrate:storage -- rollback --approve-production --run-dir storage-migration-output/crm-full
```

Rollback restores each journaled URL/storage identifier using exact compare-and-set conditions, in reverse order. It includes pending entries from crash recovery. If someone changed a field since migration, rollback reports a conflict and preserves the edit. Resolve that record manually from the journal/Atlas backup. Repeated rollback is safe. It **does not delete files from Spaces or Cloudinary**. To return future uploads to Cloudinary, redeploy the previous release separately; the new release deliberately has no Cloudinary fallback/signing route. Keep old sources intact throughout acceptance and the rollback window. Source retirement is a later, separately approved task.

## Future uploads and access behavior

The shared frontend `uploadMedia` covers avatars, client master/lifecycle, annual returns, leads/POs/approvals, purchase/sales Excel and proofs, quotations, proforma invoices, notifications and support/internal-ticket attachments. It computes SHA-256 in the browser, obtains an authenticated presigned PUT, uploads **directly to Spaces**, and saves metadata only after the backend checks object length, content type and signed checksum metadata. Spaces validates the checksum against the PUT body. The presigned request expires after 10 minutes; confirmation is tied to uploader and a 15-minute receipt. Private objects use stable signed CRM capability links; the CRM route streams object bytes through the same origin for previews and downloads. PNG/JPEG/GIF/WebP/PDF permit inline previews; other content downloads as an attachment. Missing configuration fails uploads, with no Cloudinary fallback.

EML/MSG proofs already require backend parsing, so originals and extracted attachments are uploaded server-to-Spaces, also with no Cloudinary fallback. Existing permission checks on purchase proof/internal ticket APIs stay in place, and those endpoints now fetch Spaces directly after authorization. Legacy Cloudinary cleanup in email deletion is disabled so user actions cannot destroy protected source assets during the migration window. Ordinary deletion of newly uploaded Spaces email proofs still works.

**Capability links are shareable:** anyone possessing a saved link can open that file. They preserve the CRM's existing URL-based preview behavior; they are not record-scoped authorization. A stricter privacy model requires changing the UI/records to resolve keys through per-record authorized API calls. Do not make the bucket public. Generated browser PDF/report downloads remain local exports; this migration changes stored uploads, not every file generated for download.

## Acceptance checklist

Automated tests exercise pagination/all resource and delivery types, orphan library assets, missing URLs, folder/collision handling, checksum failures, retry/resume, write-ahead crash recovery, exact BSON IDs, concurrent-edit protection, rollback, direct frontend PUT/confirmation, signed-header completeness, private/inline file settings, legacy source protection, email attachments and nested PO resolution. Tests use local fixtures/mock storage; they do not prove production credentials/CORS/browser previews.

After deploying an approved release to a staging environment and configuring its Space/CORS, test:

| CRM flow | Verify |
| --- | --- |
| Avatar/business card/notification images | Upload, inline image preview, reload, old/new links |
| Lead PO and approval proof; annual return/client-master documents | Old migrated and new PDF/image preview; nested approval snapshot resolution |
| Quotation/proforma invoice | Existing attachment, new attachment, download filename/type |
| Purchase/sales workbook and proofs | Upload/import, reload, downloaded workbook readable |
| Internal/support tickets | Screenshot preview, download, unauthorized ticket access denied |
| EML/MSG proof | Original download, parsed preview, extracted attachment download, existing client/year scope |
| Failure cases | Wrong checksum, expired/tampered receipt, wrong user, oversized upload, missing credentials, CORS failure |
| Rollback fixture | Migrate fixture, restore old references, verify both copies remain |

During production acceptance compare total originals to the Cloudinary inventory; require failed/missing/pending/conflicts to be zero or explicitly reviewed exceptions. Review custom-domain references and remaining Cloudinary strings before retirement. Open/read downloaded files, not just their HTTP status. Do not delete Cloudinary until the owner approves the resulting report and previews/downloads.

References: [Cloudinary Search API](https://cloudinary.com/documentation/search_api), [original download by asset ID](https://cloudinary.com/documentation/image_upload_api_reference#download_by_asset_id), [Spaces S3 SDK setup](https://docs.digitalocean.com/products/spaces/reference/aws-sdks/), [Spaces API/checksum headers](https://docs.digitalocean.com/reference/api/spaces/).
