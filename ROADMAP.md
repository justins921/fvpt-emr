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

- [x] Internal patient notes (staff-only, pinned to chart, categories, soft-delete, out of legal record, audited) — migration 014 — QA PASS 2026-10-05
- [x] Communication preferences (per-patient SMS/email opt in/out; STOP/START/HELP keyword handling in webhook; consent gate on send, bulk send, and daily-reminder cron with skip logging; staff UI + consent history + audit log; opt-in checkboxes on intake form) — migration 015 — QA PASS 2026-10-05
- [x] HEP program templates (built on existing exercise_programs.is_template — no duplicate tables; Templates tab with list/rename/delete/use-for-patient; "Start from template" in program builder; "Save as Template" from builder and from archived programs; template assign with name override; program status updates fixed) — migration 016 (is_active soft-delete on exercise_programs) — PENDING migration run + QA
- [x] Role management UI (no migration): edit-user dialog (role/name/credential/NPI/license/active) with two-click confirm on role change; self-role-change blocked; last owner/admin demotion blocked (client + server); only owners can grant owner/admin; new "Roles & Permissions" admin tab with per-role capability matrix derived live from ROLE_PERMISSIONS; role changes audit-logged — QA PASS 2026-10-05 (fixed null-vs-optional zod bug on user update)
- [x] Customizable dashboard (migration 017): per-user dashboard_preferences table; GET/PUT /api/users/me/dashboard (own data only); Customize panel on DashboardPage with show/hide checkboxes + up/down reorder for Stats overview / Today's schedule / Quick actions; sidebar accent color (6 presets, CSS-variable override scoped to sidebar); profile picture (client-side downscale to 256px JPEG, stored as data URL in prefs, remove/revert to initials; shown in sidebar + top bar); no new widgets — PENDING migration run + QA
- [x] User onboarding flow — STAFF INVITE ONLY, not SaaS signup (migration 019: user_invites table with SHA-256 token hashes, 7-day expiry, single-use): admin creates invite (email + role) from Users tab, gets a copyable /invite/:token link (email delivery later); public /invite/:token page shows clinic name + role, collects first/last name + 12-char-min password, creates the account (email as username) and signs them in immediately; invite list with status (pending/accepted/expired/revoked) + revoke; tokens hashed in DB, 10/hour/token rate limit on accept, expired/used tokens rejected with clear messages; role changes audit-logged — PENDING migration run + QA
- [ ] SaaS self-service clinic signup (separate business decision — not built)

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
- Patient portal expansion (paperwork, scheduling, payments, records access)
- Patient HEP check-off in portal — BUILT 2026-10-05 (migration 018: logged_by_type on hep_adherence_logs): patient portal login (/portal-login), "My Exercises" view with full exercise detail (images, instructions, sets/reps/hold), per-exercise tap-to-check-off, session log with pain 0-10 + difficulty 1-5 + notes → hep_adherence_logs marked logged_by_type='patient'; adherence history view; staff adherence endpoint now returns logged_by_type. PENDING migration run + QA
- (Add new ideas here)
