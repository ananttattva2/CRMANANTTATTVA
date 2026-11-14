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

Validated read snapshots recheck current MongoDB fingerprints before reuse and reload only changed/new documents; removed documents disappear immediately. Decimal PO amounts are explicitly fingerprinted as strings. Cache TTL is only retention, never the freshness check. Real Mongo verification covered a decimal-only change without updatedAt and deletion using isolated test records. Measured client snapshots fell from 7.6 s to 0.44 s on revalidation; lead snapshots from 15.4 s to 0.75 s. Initial cache population still needs the original source read. MIS now excludes unrelated Annual Return and full selected-lead workflow trees while preserving completion calculations.

MIS audit telemetry is grouped on the server after the existing 10,000-event bound. It preserves action counts, India daily timelines and the latest 12 actual events per user, rather than transferring every event. Production read measured 42 KB in 0.42 s for 2,103 actions. Sales MIS aggregation snapshots validate Lead and all joined User/Quotation/PO-approval collections; clock-derived overdue/stalled calculations use minute resolution.

Final MIS correction: project only the exact completion fields as presence flags while retaining applicant/service identity and branching choices. A read-only comparison against all 298 production forms found zero completion mismatches. Cold form projection fell from 3.42 MB / 37.3 s to 0.76 MB / 7.36 s. Compact session telemetry fell from 0.75 MB / 6.9 s to approximately 0.22 MB / 1.15 s, preserving presence, device, active/away totals and daily history. Stable records are cached even if another record changes during initial population, preventing repeated full rebuilds. Validated source projections are retained for 24 hours; every reuse still checks current Mongo fingerprints.

Browser verification found an additional first-load waterfall: revision polling caused three copies of the same MIS request before displaying any rows. First-load refresh subscriptions now wait until the initial request settles, then revalidate in the background. Only actual local/cross-tab writes trigger blocking stale-response retries; external polls/focus do not hide successful responses. Sales MIS fetches Operations/Quotation datasets on tab demand and prevents older completions from overwriting newer data. Financial aggregation dependencies include only semantic lookup fields, so OTP/avatar/reminder timestamps do not invalidate unchanged financial totals.
