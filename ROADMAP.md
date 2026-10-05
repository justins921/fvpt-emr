# EMR OS Feature Roadmap

Living document — updated 2026-10-05. Lives in the repo root as ROADMAP.md.

## Shipped to staging

- App routing (/app), self-deactivation guard
- Note templates (clinic-scoped CRUD) + copy-forward from prior notes
- Outcome auto-scoring (11 measures with MCID)
- SMS: Twilio webhook auth, daily-reminder cron, templates, bulk send, graceful no-Twilio handling
- Exercise library (100) + HEP clinic overrides + 198 exercise images + program builder + printing
- Billing core: patient ledger, claims, claim scrubber, 837p export, ERA import/posting, AR aging reports
- 8-minute rule calculator (timed/untimed CPTs)
- Authorization tracking (CRUD, visit usage, expiry)
- Tasks (assignment, my-tasks, cancel)
- Patient messaging (SMS conversations per patient)

## In QA (migration 013, pushed 2026-10-05)

- Payer auth requirement profiles (seeded: Medicare, UHC, BCBS, Aetna, Cigna)
- Auth packet generator (printable)
- Auth status workflow (draft → submitted → pending → approved/denied) + follow-up alerts
- Note-to-claim (signed note → scrubbed draft claim, 8-min rule applied)
- Eligibility adapter interface (manual-entry fallback; no live clearinghouse yet)
- Auth-aware scheduling (warn, don't block)
- ERA exception queue (auto-post clean, queue underpaid/denied/adjusted)

## Built 2026-10-05 evening (pushed to staging)

- [x] Internal patient notes (staff-only, pinned to chart, categories, soft-delete, out of legal record, audited) — migration 014
- [x] Communication preferences (per-patient SMS/email opt in/out; STOP/START/HELP keyword handling in webhook; consent gate on send, bulk send, and daily-reminder cron with skip logging; staff UI + consent history + audit log; opt-in checkboxes on intake form) — migration 015

## QA rounds (2026-10-05)

- Rounds 1-6: auth form, payer list, note signing, note-to-claim crash, auth edit schema, Create Appointment silent-fail, Tasks cancel, appointment timezone (−5h, ECMA-262 UTC parse), follow-up alerts (dual-status mismatch), visits-used persistence (triple field-name fault), packet blank fields (stale bundle, was already fixed)
- Final: ALL GREEN — auth form, payer library, sign & finalize, note-to-claim, auth edit, packet, tasks cancel, appointment create (correct times), auth-aware warnings (distinct exhausted message), follow-up alerts, visits tracking, packet fields

## Approved — build after the above

## Approved — build after the above

AI billing features (the differentiator):
- [ ] Phase 1: Underpayment detection (fee schedules + ERA line-item parsing → flag shortfalls)
- [ ] Phase 2: Denial pattern mining (learn from ERA history → pre-submission risk scoring)
- [ ] Phase 3: Documentation-to-code matching (LLM reads note → flags missing/unsupported codes)
- [ ] Phase 4: Denial appeal drafts (auto-draft from denial + note content)

## Discussed — not yet approved

- [ ] AI scribe (scoped in ~/workspace/fvpt-emr-ai-scribe-scope.md, not built)
- [ ] Twilio account + TWILIO_* / CRON_SECRET env vars (unlocks SMS reminders)
- [ ] Pool booking page (separate: foxvalleyphysicaltherapy.com pool scheduling)

## Pre-go-live requirements

- [ ] Live payer/clearinghouse integrations (eligibility + auth submission)
- [ ] HIPAA compliance review (staging is NOT HIPAA compliant — no real PHI)
- [ ] Security audit (auth, RBAC, audit logging already in place — needs review)
- [ ] Data migration plan from current system
- [ ] Staff training materials

## Ideas parking lot

- Electronic prior auth submission (beyond packet generation — needs payer APIs)
- Real-time claim status tracking
- Patient portal (paperwork, scheduling, payments, records access)
- (Add new ideas here)
