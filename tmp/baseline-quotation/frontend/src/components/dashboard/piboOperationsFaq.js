const entries = [
  ['General', 'Access Operations module', ['how is operations module accessed', 'open operations module', 'access procurement sales annual return'], 'Log in to the Common EPR Portal with the SSO ID, open Plastic Waste Management, choose the applicable Applicant Type and Sub-Applicant Type, click Select Unit, choose the required unit, then open Operations and select Procurement Details, Sales Details, or Annual Return.'],
  ['General', 'No units in Select Unit', ['why are no units displayed', 'select unit empty', 'unit popup blank', 'no application in select unit'], 'Select Unit shows only applications mapped to the logged-in account. If it is empty, verify that the application is approved and that the approved unit is mapped to this account.'],
  ['General', 'Meaning of unit', ['what is a unit', 'why select unit first', 'wrong unit'], 'A unit is one approved application or registration. Every Operations entry is saved against its unit ID, so select the correct unit before adding or reviewing data.'],
  ['General', 'Single Entry versus Bulk Entry', ['difference between single entry and bulk entry', 'single or bulk entry', 'when to use bulk'], 'Single Entry adds one record through a form and is best for small volumes. Bulk Entry uploads multiple records using the latest Excel template and, where applicable, a matching invoice ZIP; use it for larger volumes.'],
  ['General', 'Importer Procurement Single Entry', ['single entry unavailable under procurement', 'importer single procurement unavailable', 'why importer cannot single entry'], 'Procurement Single Entry is not available for Importers. Importers must record procurement using the other methods supported for their applicant type.'],

  ['Registered Procurement', 'Automatic registered-supplier procurement', ['registered supplier sale automatic procurement', 'must registered purchase be entered manually', 'supplier registered portal purchase'], 'No manual entry is required when a registered supplier records the sale. The portal automatically creates the buyer-side entry with invoice details under Procurement from Registered Entity.'],
  ['Registered Procurement', 'Link a pre-registration purchase', ['purchase before registration link', 'link past registered supplier sale', 'registration type registered entity type link'], 'Open Single Entry, set Registration Type to Registered, choose the Entity Type purchased from, locate the supplier sale recorded against the buyer GST details, and click Link. Use the EPR Invoice Number to narrow the list.'],
  ['Registered Procurement', 'Unlink an incorrect purchase', ['incorrectly linked purchase reverse', 'unlink procurement', 'remove linked purchase'], 'In Single Entry, choose Registration Type Registered, locate the entry and click Unlink. This removes only the buyer-side procurement link; it does not delete the seller’s original sale.'],
  ['Registered Procurement', 'Past link or unlink locked', ['past sale cannot link unlink', 'linking locked annual return', 'why unlink unavailable'], 'Linking and unlinking are allowed only while neither party has submitted the Annual Return for that financial year and the AR window remains open. Submission by either party, or closure of the window, locks the sale.'],

  ['Procurement Single Entry', 'Start a procurement entry', ['first step single procurement', 'add single procurement entry', 'upload procurement invoice first'], 'Upload the invoice first. A readable GST QR invoice auto-populates GSTIN, IRN, HSN, invoice value and date; without a readable QR, enter every mandatory field manually.'],
  ['Procurement Single Entry', 'Supported invoice files and size', ['procurement invoice file types', 'invoice size limit', 'pdf jpg png 1 mb 80 mb'], 'Supported invoice formats are PDF, JPG and PNG. A single-entry file must not exceed 1 MB; a bulk upload must not exceed 80 MB.'],
  ['Procurement Single Entry', 'Invoice without QR', ['invoice has no qr code', 'no qr procurement', 'qr not available manual entry'], 'Yes, an invoice without a readable QR can be used, but no fields are auto-populated. Enter all mandatory invoice and procurement details manually.'],
  ['Procurement Single Entry', 'Supplier without GST', ['supplier does not have gst', 'supplier gst unavailable', 'unregistered supplier mobile recycled percent'], 'Set “Is Supplier GST Available?” to No. Supplier Mobile Number becomes mandatory, and Recycled Plastic % must be 0 for an unregistered supplier.'],
  ['Procurement Single Entry', 'Container Capacity requirement', ['when is container capacity required procurement', 'brand owner cat i container capacity'], 'Container Capacity is required only when the applicant is a Brand Owner and the plastic category is Cat-I. Leave it blank for every other combination.'],
  ['Procurement Single Entry', 'Future invoice date', ['future procurement date', 'future invoice date allowed'], 'No. The procurement or invoice date cannot be a future date.'],
  ['Procurement Single Entry', 'Duplicate procurement error', ['duplicate record procurement', 'same invoice maximum four times', 'same invoice fifth time reject', 'fifth invoice rejected'], 'A duplicate occurs when plastic type, invoice number, quantity, category and procurement date match an existing record. The same invoice number can be used at most four times; the fifth use is rejected.'],
  ['Procurement Single Entry', 'Preview and submit', ['what happens after clicking preview procurement', 'confirm and submit procurement'], 'Preview shows a summary for review. Confirm & Submit then validates mandatory data, performs duplicate checks and saves the entry to the Procurement Dashboard.'],

  ['Procurement Bulk Entry', 'Start bulk procurement', ['how start bulk procurement upload', 'procurement bulk upload steps'], 'Open Procurement Details → Bulk Upload, download the latest template, complete it, prepare the invoice ZIP, upload both, correct preview errors, confirm the Excel, then finish the process from Invoice Validation.'],
  ['Procurement Bulk Entry', 'Use latest template', ['where get bulk excel template', 'reuse older template', 'modify template headers'], 'Always download the latest template from the Bulk Upload screen for the correct applicant type. Do not reuse an older template or change its headers, columns, sheet name or structure.'],
  ['Procurement Bulk Entry', 'Bulk date format', ['bulk template date format', 'yyyy mm dd bulk', 'blank rows excel'], 'Enter dates as YYYY-MM-DD, for example 2025-06-15, and do not leave blank rows between data rows.'],
  ['Procurement Bulk Entry', 'Match invoices to Excel', ['invoice document name match excel', 'invoice zip filename mismatch', 'how invoice matched to row'], 'The Invoice Document Name in each Excel row must exactly match the ZIP filename including its extension, such as INV-2024-001.pdf. Matching is case-insensitive but otherwise exact.'],
  ['Procurement Bulk Entry', 'Prepare invoice ZIP', ['prepare invoice zip', 'zip subfolders allowed', 'compress invoice folder'], 'Put all PDF/JPG/PNG invoices in one folder with no subfolders, ensure every filename matches its Excel Invoice Document Name, then compress that folder into a ZIP.'],
  ['Procurement Bulk Entry', 'Bulk range and volume', ['bulk upload date range limit', '31 days bulk', '1000 entries bulk'], 'A single From Date–To Date range can cover at most one month or 31 days. For reliable performance, keep a session to a reasonable size, approximately 1,000 entries.'],
  ['Procurement Bulk Entry', 'Correct highlighted cells', ['highlighted error cells bulk preview', 'correct bulk validation error'], 'Click the error icon, correct the value directly in preview and click Validate. Repeat until every error is cleared; Confirm & Submit appears only after successful validation.'],
  ['Procurement Bulk Entry', 'Upload missing invoices', ['invoice missing must reupload zip', 'upload missing invoices', 'up to 200 missing invoices'], 'Do not re-upload the whole ZIP. Use Upload Missing Invoices for only the flagged files, up to 200 at once, or correct the Excel filename to match the ZIP and validate again.'],
  ['Procurement Bulk Entry', 'Excel confirmation is not final', ['does confirm submit excel complete upload', 'confirm submit bulk incomplete', 'bulk upload still incomplete', 'invoice validation final submit'], 'No. Confirming the Excel confirms only the data. QR verification continues in the background; open Invoice Validation and click Submit to finalize the session and place records on the dashboard.'],
  ['Procurement Bulk Entry', 'Cancel an in-progress upload', ['discard bulk upload', 'cancel bulk session'], 'Click Cancel on the bulk upload screen and confirm. Temporary session data is removed and no records are saved.'],
  ['Procurement Bulk Entry', 'Download validated Excel', ['download validated excel', 'download normalized data before submit'], 'Yes. When validation shows zero errors, use Download Validated Excel to save the final normalized data before submission.'],

  ['Invoice Validation', 'Validation session list', ['what invoice validation page displays', 'data retrieved data not retrieved'], 'Invoice Validation lists bulk sessions with Data Retrieved and Data Not Retrieved counts, upload date and status. Click the eye icon to open a session.'],
  ['Invoice Validation', 'Actions inside validation', ['actions validation session', 'excel versus qr comparison', 'reupload corrected invoice'], 'The session maps QR-extracted data against each Excel row and shows field-by-field Excel-versus-QR comparisons. Edit a value or re-upload a corrected invoice, then click Submit to finalize.'],
  ['Invoice Validation', 'QR invoice date precedence', ['invoice date procurement date differ', 'qr date overwrites procurement date'], 'QR data takes precedence. If the QR invoice date differs from the procurement date, the system overwrites the procurement date with the verified QR invoice date.'],
  ['Invoice Validation', 'Unreadable QR fields', ['fields blank invoice without qr', 'data not retrieved qr'], 'For an invoice without a readable QR, extracted fields remain blank and the system relies on the values provided in the Excel row.'],

  ['Procurement Dashboard', 'Dashboard filters', ['how procurement dashboard filtered', 'interval type registration category filter'], 'Filter by Interval Type (day/month/year), From and To dates in DD-MM-YYYY, Registration Type, and Category I–IV or all. The graph and summary update with the selected filters.'],
  ['Procurement Dashboard', 'Open summary details', ['open records behind procurement summary', 'click highlighted summary value'], 'Click the highlighted or underlined summary value. A searchable, paginated detail table opens with supplier, invoice, quantity, date, category, invoice file and delete action.'],
  ['Procurement Dashboard', 'Export procurement data', ['export procurement data', 'download procurement excel'], 'Click Download Excel to export the summary and all procurement fields for reporting, verification and record-keeping.'],
  ['Procurement Dashboard', 'Delete procurement record', ['delete procurement record', 'procurement delete icon'], 'Locate the record in the detail table, click Delete and confirm the action.'],
  ['Procurement Dashboard', 'Procurement deletion blocked', ['why procurement cannot delete', 'annual return blocks procurement delete'], 'A procurement record cannot be deleted after the Annual Return for that financial year has been submitted. A record consumed by a road-construction declaration is also protected.'],
  ['Legacy Data', 'Historical data filter', ['which filter historical legacy data', 'verify legacy procurement sales', 'financial year filter only'], 'Use only the Financial Year filter to verify migrated legacy data. CEPR uses procurement or sale date, while the legacy portal listed records by entry date, so date-based filters can produce different results.'],

  ['Road Construction', 'Two-part road EoL workflow', ['two parts road construction eol', 'road construction plastic workflow'], 'First record procurement of Category I/II/III plastic waste through Single Entry. Then submit the road Self-Declaration through Submit Self-Declaration.'],
  ['Road Construction', 'No road bulk entry', ['road construction bulk entry', 'bulk upload road construction'], 'Road Construction does not support Bulk Entry. Use Single Entry.'],
  ['Road Construction', 'Bitumen replacement cap', ['maximum bitumen plastic replace', 'plastic bitumen replace', 'bitumen replacement percentage'], 'Plastic cannot replace more than 8% of the bitumen.'],
  ['Road Construction', 'Declared plastic quantity cap', ['cap plastic declared road', 'maximum allowed road plastic', 'declared quantity exceeds procurement'], 'Declared plastic cannot exceed the calculated maximum from road dimensions, bitumen quantity and replacement percentage, or the quantity procured in each category. A category with no procurement must have declared quantity 0.'],
  ['Road Construction', 'Declaration attachments', ['documents road self declaration', 'picture certificate video road'], 'Attach two different files: a Picture document and a Certificate document. A video link is optional.'],
  ['Road Construction', 'Consumed procurement cannot be deleted', ['procurement used declaration cannot delete', 'road declaration consumed quantity'], 'The declaration has consumed that procurement quantity. Deleting it would make the category balance insufficient, so the portal blocks deletion.'],

  ['Sales Single Entry', 'Record a single sale', ['how single sale recorded', 'sales single entry steps', 'generate epr invoice number'], 'Open Sales Dashboard → Single Entry, enter buyer and sale details, upload the invoice, complete mandatory fields, generate the EPR Invoice Number, review the preview and click Submit.'],
  ['Sales Single Entry', 'Registered buyer details', ['registered buyer additional detail', 'buyer application number national dashboard'], 'Select the registered company and provide its Application Number when available from the National Dashboard. Otherwise capture entity name, address, state and mobile directly.'],
  ['Sales Single Entry', 'Sales invoice QR', ['sales invoice qr auto populate', 'qr seller buyer gstin irn hsn'], 'Yes. A verified GST QR invoice can populate Seller GSTIN, Buyer GSTIN, IRN, HSN, Document Number and Invoice Value.'],
  ['Sales Single Entry', 'Buyer GSTIN requirement', ['when buyer gstin mandatory', 'export buyer gst optional'], 'Buyer GSTIN is mandatory for a non-export sale and optional for an export sale.'],
  ['Sales Single Entry', 'Export sale requirement', ['export sale additional detail', 'is export yes country'], 'Set Is Export to Yes and select the destination Country.'],
  ['Sales Single Entry', 'Sales Container Capacity', ['container capacity sale', 'brand owner selling cat i'], 'Container Capacity is required only for a Brand Owner selling Cat-I plastic.'],
  ['Sales Single Entry', 'E-Invoice or IRN reuse', ['same e invoice irn reused', 'irn maximum four times', 'fifth irn duplicate'], 'The same E-Invoice Number or IRN can be used at most four times across Producer and Importer sales combined. The fifth use is treated as a duplicate.'],
  ['Sales Single Entry', 'Generate EPR Invoice Number', ['purpose generate epr invoice number', 'what generate epr invoice does'], 'It creates the sale’s unique EPR Invoice Number and opens a preview. Submit after reviewing the details to save the sale.'],

  ['Sales Bulk Entry', 'Bulk sales workflow', ['how sales uploaded bulk', 'sales bulk upload steps', 'application id bulk sales'], 'Download the latest Sales template, complete it, map rows to invoice filenames, ZIP the invoices, upload both, preview, correct errors, validate and finish Invoice Validation. Application ID is required for the sales bulk preview.'],
  ['Sales Bulk Entry', 'Same invoice across rows', ['multiple rows same invoice duplicate sales', 'one invoice multiple inventory rows'], 'No duplicate sale is created merely because several rows reference the same invoice filename. One invoice may legitimately map to multiple inventory rows and is treated as one sale.'],
  ['Sales Bulk Entry', 'Sales bulk date limit', ['sales bulk date limit', 'sales bulk one month'], 'Keep the sales bulk date range within the permitted window, typically no more than one month.'],
  ['Sales Bulk Entry', 'Registered buyer in Excel', ['sales excel registered entity application number'], 'Provide the registered entity’s Application Number from the National Dashboard in the Excel file.'],
  ['Sales Bulk Entry', 'Invoice value mismatch', ['invoice value does not match excel', 'sales validation value mismatch'], 'Upload the correct invoice from the invoice-filename column and click Validate again. Repeat until the Excel and verified invoice values match.'],

  ['Potential and Wallet', 'Producer potential formula', ['producer sale potential calculated', 'recycled potential formula'], 'Producer potential equals total plastic quantity sold × recycled percentage ÷ 100.'],
  ['Potential and Wallet', 'Wallet credit', ['where generated potential credited', 'potential wallet certificate'], 'Generated potential is transferred automatically to the entity wallet for certificate generation and transfer, recorded against the applicable EPR certificate type and category.'],
  ['Potential and Wallet', 'Importer potential', ['importer sale potential', 'importer sales recycled potential', 'does importer generate potential'], 'No. Importer sales record plastic quantity and invoice data but do not calculate recycled-content potential in the same way as Producer sales.'],

  ['Sales Dashboard', 'Sales filters', ['how sales dashboard filtered', 'sales registered unregistered summary'], 'Filter by year, month or day and a From–To date range. Sales summaries are shown separately for registered and unregistered buyers.'],
  ['Sales Dashboard', 'View and export sales', ['view sales records export', 'sales category excel'], 'Click a summary value to open invoice details and available actions. Export records to Excel by category.'],
  ['Sales Dashboard', 'Sales deletion blocked', ['sales delete wallet', 'why sales entry cannot delete', 'wallet balance below zero delete'], 'Deletion is blocked after the Annual Return is submitted or its window closes, and when deletion would reduce an approved wallet balance below zero.'],

  ['Troubleshooting', 'Past-year entry locked', ['cannot add procurement sales past year', 'new entry past year blocked'], 'The Annual Return for that financial year has likely been submitted or its filing window is closed, which locks new procurement and sales entries.'],
  ['Troubleshooting', 'Bulk error persists', ['bulk preview error persists after correction', 'validate error still showing'], 'The replacement value is still invalid. Read the cell error, enter a value allowed by the latest template and click Validate again.'],
  ['Troubleshooting', 'QR does not read', ['qr code does not read invoice', 'blurry cropped qr'], 'Use a valid GST invoice in PDF/JPG/PNG with a clear, uncropped QR. Blurry, cropped or non-GST invoices do not auto-populate; enter details manually or upload a clearer invoice.'],
  ['Troubleshooting', 'Unregistered recycled percentage', ['unregistered supplier recycled percent reject', 'recycled percent rejected unregistered supplier'], 'Recycled Plastic % must be 0 for an unregistered supplier. Any other value is rejected.'],
  ['Troubleshooting', 'Seller and Buyer GSTIN same', ['seller and buyer gstin cannot be same', 'same gstin both sides'], 'The seller and buyer cannot use the same GSTIN on one invoice. Verify that the supplier GSTIN is in the seller field and the applicant or buyer GSTIN is in the buyer field.']
].map(([section, title, questions, answer]) => ({ section, title, questions, answer }))

const stopWords = new Set(['a', 'an', 'and', 'are', 'be', 'can', 'does', 'for', 'from', 'how', 'i', 'if', 'in', 'is', 'it', 'of', 'on', 'or', 'the', 'to', 'what', 'when', 'where', 'which', 'why', 'with'])

export function normalizePiboQuestion(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function tokens(value) {
  return normalizePiboQuestion(value).split(' ').filter((token) => token.length > 1 && !stopWords.has(token))
}

function editDistance(left = '', right = '') {
  const a = String(left); const b = String(right)
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]; row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]; const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + cost)
      diagonal = above
    }
  }
  return row[b.length]
}

function tokenMatches(questionToken, aliasToken) {
  if (questionToken === aliasToken) return true
  if (Math.min(questionToken.length, aliasToken.length) >= 4 && (questionToken.startsWith(aliasToken) || aliasToken.startsWith(questionToken))) return true
  return Math.min(questionToken.length, aliasToken.length) >= 5 && editDistance(questionToken, aliasToken) <= 1
}

export function findPiboOperationsAnswer(question) {
  const normalized = normalizePiboQuestion(question)
  if (!normalized) return null
  const questionTokens = tokens(normalized)
  let best = null
  let bestScore = 0
  entries.forEach((entry) => {
    entry.questions.forEach((alias) => {
      const normalizedAlias = normalizePiboQuestion(alias)
      const aliasTokens = tokens(normalizedAlias)
      const overlap = aliasTokens.filter((aliasToken) => questionTokens.some((questionToken) => tokenMatches(questionToken, aliasToken))).length
      const coverage = aliasTokens.length ? overlap / aliasTokens.length : 0
      const queryCoverage = questionTokens.length ? overlap / questionTokens.length : 0
      const phraseBonus = normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized) ? 6 : 0
      const score = phraseBonus + overlap + coverage * 4 + queryCoverage * 3
      if (score > bestScore) { best = entry; bestScore = score }
    })
  })
  return bestScore >= 5 ? { ...best, score: bestScore } : null
}

export const piboOperationsFaq = entries
