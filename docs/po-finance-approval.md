# PO Finance approval workflow

New PO submissions follow Admin initial approval, Accounts/Finance referral, Super Admin Management Go Ahead, and Accounts/Finance final decision. Initial approval sets PARTIALLY_APPROVED and assignment FINANCE_PENDING; it does not finally approve the PO. Historical final approvals remain unchanged.

After Admin initial approval, the lead owner may complete the lead closure and assign the responsible Manager while Finance review continues. Permanent staff assignment remains locked in both the UI and API until Finance records the final APPROVED decision. Saved, already-approved POs reopen with their existing details in the closure dialog and do not create a duplicate Admin review when the PO itself is unchanged.

| Stage | Action | Role |
| --- | --- | --- |
| FINANCE_READY | Submit Finance remarks to Management | Accounts |
| MANAGEMENT_PENDING | Give Management Go Ahead | Super Admin only |
| FINANCE_RELEASED | Final Approve, Reject or Revise | Accounts |
| FINALIZED | Read history; user changes require resubmission | Admin/Super Admin may approve their own PO edits |

The Finance Approval sidebar page includes Finance and Management tabs. Admin can inspect the queue but cannot perform an Accounts decision or Super Admin Go Ahead merely by having the Admin role. Backend checks independently enforce all transitions.

Transitions record actor, server timestamp, remarks and version. Initial review verifies the PO snapshot timestamp. Later actions reject stale/repeated versions. PO and approval writes commit in one MongoDB transaction, with cache invalidation and notifications after commit.

Selected payment terms and linked quotation custom terms are saved as a reviewed snapshot. PO/commercial and service edits are blocked during active review. Proof repair, reassignment, deletion and generic approval endpoints cannot bypass the workflow. Revision resubmission archives the completed review. Regular user PO edits restart Admin review. Existing received PO edits through Modify PO Details by Admin/Super Admin are approved directly, with the administrator and action time recorded; active Finance review remains locked.

Purchase/Sales receipt checkboxes can be selected before uploading documents. Selection time is recorded immediately; readiness remains pending until each selected receipt stage has supporting documents.
