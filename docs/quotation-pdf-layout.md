# Quotation preview, email attachment and download

`frontend/src/utils/quotationDocument.mjs` is the canonical quotation document. The CRM preview uses its HTML inside an isolated iframe, and the authenticated backend renders the same HTML into PDF. Keep document changes in this module so the orange pricing tables, registration/year mapping, terms and scope pages stay consistent across all three paths.

The shared pagination pass measures actual scope-row heights, caps a scope sheet at 22 rows, and repeats its heading and footer. The backend renders each designed sheet independently and assembles the resulting PDF pages, avoiding Chromium's grid fragmentation at continuation-page boundaries. The PDF remains searchable text.

The filename comes from the saved client/company name, with unsafe filename characters removed and one `.pdf` extension. Email and admin download use the same filename function. Current approval and role restrictions are checked before rendering. The server accepts quotation IDs, never client-supplied PDF or HTML content, and its renderer blocks network requests and page scripts.

The backend uses pinned-major Puppeteer with its matching Chrome browser, cached in `backend/.cache/puppeteer` (ignored by Git). The DigitalOcean deployment installs browser/system dependencies when backend dependencies change and runs `npm run pdf:check --prefix backend` before switching releases. The check generates a synthetic three-page quotation in memory without sending email or accessing client data. Changes to either shared document/date module also trigger backend verification and restart.

For local verification, install the matching browser using the Puppeteer CLI. `QUOTATION_CHROME_PATH` can point to a compatible installed Chromium browser when local browser downloads are restricted. The document integration tests verify client filenames, screen/print pagination, fixed date-column bounds, A4 PDF sheets and the delivery/approval checks.
