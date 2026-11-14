# Page loading performance

Measured on production on 14 November 2026 using authenticated, read-only requests.

| API | Before (cold / repeat) | Uncompressed response |
| --- | --- | --- |
| Summary | 1.13 s / 0.21 s | 575 KB |
| Overall | 11.62 s / 11.33 s | 285 KB |
| Application portfolio | 10.99 s / 8.85 s | 1.74 MB |
| Quotations (full documents) | 21.19 s / 20.78 s | 1.97 MB |
| Pending approvals (full documents) | 7.65 s / 10.34 s | 1.35 MB |

Mongo execution statistics for the compact client aggregation were 14 ms, whereas transferring 298 compact clients took about 6.6 seconds. Large document transport, repeated full reads, and CRM writes invalidating warm caches contribute to the delay; page shell load and data readiness are different timings.

Changes: explicit slim quotation directory/MIS projections; full quotation hydration before edit/preview/draft reuse; editor-only reference reads deferred until opening the editor; slim PO-status leads for MIS; slim indexed approval reads and reconciliation; independent MIS panels load in parallel; concurrent identical GETs share work within the same authenticated scope and revision; dashboards carry only proof presence/service names; export library deferred; short-lived page snapshots reuse recent data only for the same token/revision and still revalidate.

Cache invalidation, authorization and full detail endpoints remain authoritative. A cold request over a slow database connection cannot be guaranteed to finish within one second. Browser total network finish includes recurring notification/revision/heartbeat polling and is not the page-data readiness measurement.
