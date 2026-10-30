# Hot / Cold Lead Pipeline and Estimated Revenue

Navigation: Customer Hub → Hot Leads / Cold Leads. Home → Pending Leads → Open & Closed Leads.

## Usage

- In a Hot Lead's Assign tab, enter a new revenue amount before saving the lead/services. The backend records a separate locked contribution against the author's currently unpriced saved services.
- If revenue already exists, choose a separate group or add the new contribution to a selected existing group. Existing contributions are never edited. ₹10,000 plus ₹5,000 in the same group displays ₹15,000; a separate group displays both ₹10,000 and ₹5,000.
- Opening a lead again does not permit changing a saved amount. Another service contributor can record revenue only against their own new services. Administrators can record unpriced services, but cannot overwrite recorded contributions.
- Cold Lead estimates can be recorded through the dashboard card → list → Revenue history. Closing a Cold Lead requires remarks. Closure locks the estimate and prevents conversion/new follow-ups.
- Click any total/category/status card for its lead list. Search and owner filters apply to the cards, list, and Excel download. Exports show group totals; lead totals occur once per lead to avoid duplicate sums.
- New estimates are optional. Historical records show zero / Not recorded until an authorized user records a value; quotation/PO totals are not silently substituted.

## Classification

Hot Leads are the existing permanent Lead records. Cold Leads are unconverted TemporaryLead records. Converted Cold Leads also appear in Cold Closed as conversion history. Their estimate follows the linked Hot Lead. Overall totals prefer that Hot record and count each business lead once; category counts overlap intentionally. Cold closure uses pipelineClosedAt rather than changing existing conversion status values. Hot Leads are closed when all services have closure evidence; partly closed leads remain open.

## Data and integrity

The new leadrevenues collection stores insert-only contributions in integer paise. Two unique indexes prevent duplicate request IDs and pricing the same saved service twice. Startup awaits their creation before allowing requests. No revenue update/delete endpoint exists. Permissions reuse the existing lead and temporary-lead visibility scopes. Revenue writes invalidate the shared CRM cache revision.

Lead save and revenue insert are separate operations: a revenue failure does not roll back or repeat a successful lead save. The UI reports the partial result and leaves the saved lead available for retry. Request IDs make successful insert retries idempotent.

No destructive migration, historical backfill, role changes, reseeding, or credential edits are required. Deployment creates the new collection/indexes. Existing temporary-lead documents need no rewrite for the optional closure fields.

## Validation

Targeted tests cover paise validation, append-only group totals, service ownership, denied access, duplicate requests, duplicate-index conflicts, service closure classification, existing Add Services behavior, Cold Lead labels, cache invalidation, and quotation revision compatibility. Production frontend build and backend syntax checks are required before deployment. Local browser automation was unavailable; visual browser acceptance remains a separate check.


## Conversion history, PO values, and services

Cold Closed includes converted records as well as manually closed Cold Leads. The Hot Closed card displays recorded PO value / estimated revenue separately, never as a combined amount. Received POs with the same number, date and financial year repeated across assignments count once (highest duplicate value); provisional and rejected assignment POs are excluded. Amounts come from saved PO records, not quotation estimates or assumed payments.

Click a company in the simplified list for a separate service popup. It loads authorized current service details and recorded PO summaries. Converted Cold records can show their linked Hot services only if the actor also has access to that Hot Lead. Category, service-count and revenue-group columns are removed from the lead list. Excel uses one row per displayed lead with separate PO and estimated-revenue amounts.
