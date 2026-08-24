<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project decisions

## Tax posting: no separate approval queue

Tax (VAT/TDS/VDS) computed via `TaxApplication` auto-posts as part of the
parent `JournalEntry`'s normal Draft → Posted flow — there is no separate
manual-review/approval state for tax, and never re-add one. `TaxApplication`
has no `status` field; a `TaxApplication` attached to a still-DRAFT entry is
either posted alongside the entry's own lines when someone posts it, or
removed outright (`DELETE /api/tax-applications/[id]`, DRAFT-only) if it was
added by mistake.

This was a deliberate removal (2026-08-24) of an earlier `TaxApplicationStatus`
(`PENDING_REVIEW`/`APPROVED`/`REJECTED`) approval-queue design: it duplicated
the Draft→Posted state machine `JournalEntry` already enforces (posting is
itself the human approval step), and was inconsistent with how Invoice/Vendor
Bill posting already works — auto-post immediately, no separate hold step.
`Invoice.taxTotal`/`grandTotal` (see `postInvoice` in `invoice.service.ts`)
sum every `TaxApplication` on the linked entry, not a status-filtered subset.
