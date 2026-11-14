# Decisions log: Finance Tracker Bot

Every dated decision, finding and incident of the project, newest last (moved out of `CLAUDE.md` on 2026-11-01 to keep the always-loaded notes short).
Search it with grep for the term in question; never load it whole. New entries are appended here; `CLAUDE.md` keeps only the key decisions that still shape the work.

- 2026-10-27: Project created. Telegram (not WhatsApp: no ban risk, no business verification), Gemini free tier
  for parsing, Google Sheets for storage, Looker Studio for the dashboard.
- 2026-10-27: Hosting is Google Apps Script (not n8n on an Oracle VPS): no credit card for Oracle, and Apps Script
  is free, always on and needs no server. Code is copy-pasted into the editor (no clasp), lives in `apps-script/`.
- 2026-10-27: Lean layout, no Python environment. Secrets only in Script Properties, never in code or git.
- 2026-10-27: Webhook is protected by a secret in the URL (Apps Script cannot read headers) plus an allowlist
  of my Telegram chat id. Duplicate Telegram deliveries are skipped via the last `update_id`.
- 2026-10-27: Gemini returns structured JSON with an `intent` (log / correct / query / other) and a list of
  transactions, so one message can log several rows. Code validates before writing. Model name is the
  `GEMINI_MODEL` script property because free-tier quotas can change.
- 2026-10-27: "Correct" always edits the last row of `transactions`.
- 2026-10-28: Model is `gemini-3.5-flash-lite` (free: 15 RPM, 500 RPD on my project). Full `gemini-3.8-flash` only
  gets 20 RPD, and `gemini-2.5-flash` returns 404 for new accounts. Prompt passed 15/15 examples on it.
- 2026-10-28: Account balances: new `transfer` type (account -> to_account, category "Transfer", excluded from
  spending/income/savings-rate) and an `accounts` tab (opening balance). Saving deducts from its source account.
  Unknown accounts are auto-created with opening balance 0. `to_account` is the last column so old sheets only need that header.
- 2026-10-28: Slash commands (/help, /saldo, /akun, /kategori, /budget, /terakhir, /hapus) are handled in code,
  not by Gemini, so they cost no quota.
- 2026-10-28: Telegram -> Cloudflare Worker relay (`relay/worker.js`, free, no card) -> Apps Script. Confirmed live:
  Apps Script's 302 made Telegram resend the first update forever (dedupe ignored it) and newer messages queued
  behind it. The relay answers 200 and checks Telegram's secret_token header (so WEBHOOK_SECRET must be [A-Za-z0-9_-]).
- 2026-10-28: Chose polling instead (`Poll.gs`, time trigger every minute, getUpdates): no Cloudflare account,
  all inside Google, replies within ~1 min. Relay kept in the repo as the option for instant replies.
- 2026-10-28: Every write (log, correct, delete, /akun, /kategori, /budget) waits for confirmation: preview with
  ✅/❌ inline buttons, or typed "ya"/"batal". One pending action in the PENDING script property, 15-min expiry.
  Code split into prepare*_ (validate + preview) and commit*_ (write); runAction_ in Confirm.gs dispatches.
- 2026-10-28: Personality: Gemini returns a `quip` (playful, no numbers) in the same call; amounts always come from
  code. Category emoji and canned robot lines in Persona.gs for non-Gemini replies.
- 2026-10-28: Polling burst mode: after a message, pollUpdates long-polls for BURST_SECONDS (default 120) so
  confirmations and follow-ups are instant. Free trigger runtime is ~90 min/day (unverified), keep bursts short.
- 2026-10-28: `accounts.current_balance` is a per-row SUMIFS formula (same rule as balanceReply_), not a value
  written by code, so it stays right after corrections and deletes. Per-row, not one array formula, because a
  spilled array would make appendRow/getLastRow see the whole column as used.
- 2026-10-28: Switched from copy-paste to clasp 3.x, installed as a devDependency (Node via Homebrew). Auth file in
  `.clasp-auth/` via `--auth` (keeps the token out of ~ on a Mac also used for work). `npm run push` = syntax check
  (all .gs concatenated, so duplicate globals are caught) + `clasp push --force`. The repo is the source of truth.
- 2026-10-28: `npm run deploy` = push + `clasp deploy -i <web app deployment id>`, so webhook mode gets new code
  without the manual "New version" step and the /exec URL never changes. Use it instead of push in webhook mode.
- 2026-10-28: Savings are accounts now. `accounts.kind` (bank, ewallet, cash, tabungan, investasi, lainnya),
  guessed from known names (Accounts.gs), set with `/akun <nama> <jenis>`. Tabungan and investasi are separate
  (my choice); dana darurat is just a tabungan account. "berapa tabunganku" = balance of tabungan accounts.
  "nabung X dari A ke B" is a transfer; the `saving` type remains only when no destination is named.
  The saving metric = saving rows + net transfers into tabungan accounts. Queries: period "all" added
  ("sekarang", "total"); no period defaults to this month.
- 2026-10-28: Bot moves to a Telegram group with Topics, one topic per feature.
  Access: ALLOWED_USER_ID (sender must be me), ALLOWED_CHAT_ID list (group + private), FINANCE_TOPIC_ID.
  Replies carry message_thread_id. /whereami answers only me, anywhere, for setup. 12 access cases simulated in Node.
- 2026-10-28: Delete ("hapus yang tadi", /hapus) removes all rows of the latest message (same created_at), so a
  multi-item message undoes as one unit; /hapus <id> removes one row. Budgets are monthly per expense category
  (`budgets` tab); replies warn at >= 80% on every expense in that category, not only when crossing.

- 2026-10-28: Back to webhook mode: Cloudflare relay set up and live, replies instant.
- 2026-10-28: Anti-slop audit applied: removed polling mode (Poll.gs, BURST_SECONDS; restore from git history
  if the relay is ever unavailable), the direct-webhook path (broken by the 302), migration shims in setup(),
  the ownerId_ fallback (ALLOWED_USER_ID is now required), old PENDING-format compat, swallowed JSON errors,
  webhookInfo() (checkConfig covers it) and DEFAULT_ACCOUNT (never used).
- 2026-10-28: Scheduled reports (Reports.gs, installSchedules()), both 09:00 WIB about the period that just ended
  (my choice; no daily recap): Monday = last week, alert ±20% vs up to 4 earlier weeks; 1st = last month with
  savings rate, budget results, alert vs up to 3 earlier months, plus the backup. Periods before tracking started
  are skipped, not counted as zero. Backup is a values-only new spreadsheet, because copying the file would also
  copy the bound Apps Script project. Reports go to the first ALLOWED_CHAT_ID inside FINANCE_TOPIC_ID. Totals
  come from sumRows_, shared with the chat questions.
- 2026-10-28: Dashboard in the Sheet (my choice, instead of Looker Studio): generated `dashboard` tab (Dashboard.gs)
  with stat tiles, 12-month trend, categories vs budget, 12 weeks, balances; native charts next to each table.
  Values computed by the bot's functions, not Sheet formulas, so the tabungan-transfer rule lives in one place;
  trade-off: rebuilt after every confirmed change and daily 06:00 instead of live. Colors: dataviz palette slots
  1-3 (validated), spending always orange.
- 2026-10-28: "Ditabung" redefined as income − expense (sumRows_.kept), my choice: it showed 0 because my money sits
  in bank-kind accounts and I don't log "nabung". The old measure (saving rows + net transfers into tabungan
  accounts) stays as "dipindah ke tabungan", shown only when non-zero.
- 2026-10-28: Renamed that number "Sisa" (⚖️), because "Ditabung" read as a savings balance and confused me
  (opening balances are not income, so sisa can be negative early in a month). "Tabungan" (🪙, no pig icon) is
  the current balance of tabungan-kind accounts, shown on the dashboard and in the recaps. The old "sisa kas"
  (income − expense − saving) was merged into Sisa so only one number has that name.
- 2026-10-28: Tabungan redefined again (my request, I never set money aside from income): Tabungan = balance of all
  accounts except investasi and e-wallet (NOT_TABUNGAN in Sheet.gs). The tabungan-kind special cases and the
  "dipindah ke tabungan" line are removed; sumRows_ no longer needs ctx and ignores transfers and saving rows. The
  `tabungan` kind stays only as a label. Known gap: my October salary (25 Oct) predates the bot, so October shows
  no income and a negative Sisa; November onward is complete.
- 2026-10-28: Dashboard redesigned BI-style (my request, pastel): fixed 16-column grid, KPI cards with month-to-date
  deltas and sparklines, charts fed from a visible `dashboard_data` tab, in-cell SPARKLINE bars for balances and
  budgets. True pastel series failed the dataviz validator (too light, read as gray), so pastel is in the surfaces
  and the series are #6da7ec / #ee9468 / #55c29b (pass, contrast WARN → numbers printed everywhere). Charts start
  at the first transaction. accountBalances_/tabunganTotal_ take an optional rows argument so the dashboard reads
  the Sheet once.
- 2026-10-28: Accounts can be set up by chat: Gemini intent "account" with account_setup {name, opening, kind};
  /akun and chat share prepareAccount_ (same validation and ✅/❌ preview).
- 2026-10-28: Every slash command except /whereami also works by chat (my request): intents budget, category,
  help, and delete_id for delete-by-id; each shares a prepare*_ function with its command. Slash commands stay as
  optional shortcuts (no Gemini call).
- 2026-10-28: Spending lookups by merchant (substring, case-insensitive) or account: query.merchant / query.account
  filter the rows, reply shows the count. Older entries are corrected by id (correction.id, ids from /terakhir);
  without an id, correct still edits the last row.
- 2026-10-28: Admin-fee reminder (Fees.gs, my request): after a single transfer is saved (no expense in the same
  message), the reply has buttons + 1rb / 2,5rb / 6,5rb / Gratis. A tap logs the fee at once (the tap is the
  confirmation) as an expense on the source account, category Biaya Admin (fallback Lainnya), with the transfer's
  created_at so "hapus yang tadi" removes both; a double tap is ignored. 6,5rb (online transfer) is confirmed by a BNI
  email of 15 Aug 2026 (Rp6.500 fee on a Rp100.000 transfer). Dashboard card sparklines show only from the second month.

- 2026-10-28: Account rename (my request): chat intent account with account_setup.rename_to, or `/akun <lama> jadi <baru>`.
  Shares prepareRename_ (✅/❌ preview with the number of affected transactions); the commit rewrites the accounts row
  and `account`/`to_account` of all transactions, so balances follow without touching the formulas.
- 2026-10-28: Category fixes without cancelling (my request): while a log preview waits, "ganti kategori jadi X" edits
  the last transaction of that preview (prepareEditPending_), and a saved row can be corrected the same way. A category
  that does not exist yet is created when I confirm (action.newCategory), instead of falling back to Lainnya.
- 2026-10-28: Gmail POC passed (my call, "satisfied enough"): `Gmail.gs` (advanced Gmail service, explicit
  `gmail.readonly` scope in the manifest instead of GmailApp's full-mail scope) and `EmailParse.gs` (one regex parser
  per template, no Gemini, unknown types reported as "belum didukung", never guessed). Covered: BNI QRIS, BNI e-wallet
  top-up (transfer + Biaya Admin fee row from the email), BCA QRIS. `previewEmails()` is parse-only (Telegram message,
  no Sheet writes). Gotchas: `Gmail.Users.Messages.get` returns `body.data` as bytes, not base64; scheduled triggers run
  HEAD code, so a new scope must be authorized before the next trigger fires. Parser tests use sanitized fixtures
  (`runEmailTests`).
- 2026-10-28: Gmail import built (my picks): approval always first; merchant category = earlier category of the same
  merchant, else one Gemini call (`categorizeMerchants_`) for the new ones, Lainnya plus a visible warning if Gemini
  fails; starts from the day `installEmailImport()` ran (`EMAIL_SINCE`, no backfill). Stateless queue: only settled
  emails go to the `email_log` tab, so a batch replaced by chat is rebuilt at the next run; the import never replaces
  another pending preview. Batch cap 12 because the PENDING script property is limited to 9 KB. Duplicate = same
  type, account(s) and amount within ±1 day of an existing row. Edit before approving by number (`correction.item`).
  Email text is never stored (`raw_message` = "email").
- 2026-10-28: Audit of 90 days of mail (105 checked): 90 parsed, the rest were other templates, all reported and none
  wrongly parsed. Added parsers for BNI Virtual Account, PLN token, `Transfer berhasil!` and BCA
  transfers. `Kode tarik tunai` emails are not imported (my call: the code may go unused, I type withdrawals myself). A transfer is "mine" when the recipient name equals the account holder's name; otherwise an expense with
  category Lainnya set by the parser, so third-party names never reach Gemini. DANA top-ups have no fee; ShopeePay
  (500) and OVO (1.000) deduct it inside the wallet, so `WALLET_DEDUCTED_FEES` adds it on the wallet account.
  `auditEmails()` / `dumpFailedSamples()` in Gmail.gs re-check parsers against old mail.
- 2026-10-29: Email import runs 5x a day (09, 12, 15, 18, 21 WIB; `EMAIL_HOURS`, trigger `scheduledEmailImport`),
  silent when nothing is new. Dashboard stays: rebuilt after every confirmed change (an email batch ✅ included) and
  daily 06:00 as a safety net. All time triggers fire at a random point within their hour.
- 2026-10-29: Email runs are silent when nothing is new, except the 21:00 run (one "tidak ada email" line a day, my
  pick). A failed run alerts the topic once a day (`EMAIL_ALERT_DATE`) and is rethrown, so Executions shows it failed.
- 2026-10-31: Lessons from two incidents. (1) A deleted helper (`getEmail_`) passed `node --check` and broke the 21:00
  import at run time: `npm run check` now also runs `scripts/check-refs.js` (undefined helper or trigger function
  fails). (2) A revoked Gemini key surfaced only as the generic "sirkuit" reply while Executions showed "Completed"
  (the handler catches errors): the reply now carries the first 120 characters of the error. A "Gemini 400, API key
  not valid" means replace `GEMINI_API_KEY` in Script Properties.
- 2026-10-31: The GitHub repo is public by my choice. Scan the whole history for secrets and real names before each push.
- 2026-11-01: Monthly recap on demand (my request): `/rekap [bulan] [tahun]` and chat intent `recap` (`recap_month`
  YYYY-MM, null = last month). Same builder as the scheduled one (`monthRecapLines_`), read-only (no backup). The
  recap now lists every category, one per line with its share; the weekly one keeps the top 3 plus a rest line.
- 2026-11-01: Recurring monthly entries (my request, from the backlog): chat "tiap tanggal 25 biaya admin bca 12,5rb"
  (intent `recurring`, rule in the `recurring` tab, ✅/❌ to add or remove). My picks: approve each month with the same
  ✅/❌ batch as emails (not auto-posted), monthly only. `scheduledRecurring` runs daily 08:00 WIB, silent when nothing
  is due; a rule created after its day starts next month; a missed month is not made up; an entry already in the sheet
  is skipped as a duplicate (`isDuplicateTx_`), so an imported bank email and a rule never double. Failure alerts
  generalized into `alertJobFailure_`. Run `installSchedules()` once after deploy to add the trigger.
- 2026-11-02: Public-repo history rewritten (owner's go): all 61 commits now carry the GitHub noreply address as author and committer, and 3 old README lines that named the owner's Google account email were reworded (`git filter-branch` in a fresh clone, force-push with a lease; final files, messages and dates unchanged; 0 forks and 0 stars, so nothing else broke). Verified on GitHub (all authors and committers noreply, README clean). Limits: old commits stay fetchable by SHA until GitHub garbage-collects them, and earlier clones keep them; a mirror backup of the old history sits only in the session scratchpad. Same done for the showcase repo of the house-price project. New commits in both use the noreply address (local `git config user.email`).

- 2026-11-02: Incident, bot silent 20:06-20:12 WIB (recovered by itself, no change made). `checkConfig()` was clean (webhook on the relay, 0 pending at Telegram). Executions showed one `doPost` (the message "Hapus 2 transaksi terakhir") running 360.8 s until Timed Out while holding the script lock; the next three `doPost` runs (~21 s each) hit `lock.waitLock(20000)` and were dropped, because `doPost` only logs that error and the relay already answered 200, so nothing is retried and no reply is sent. The bot answered again once the hung run died. Cause of the 6-minute hang NOT found: the delete path (`prepareDeleteLast_`, `deleteAction_`, `askConfirm_`) has no unbounded loop; suspects are the Gemini fetch (up to 3 tries with sleeps), sheet reads or a Telegram call, a one-off slow Google call being the likeliest (unverified). Earlier slow runs: 107 s at 20:00, 18-21 s at 20:03-20:08. Executions shows no log lines because the Apps Script project has no GCP project linked ("Cloud logs" greyed, `clasp logs` fails). Open, only if it recurs: run a `timeSteps()` check in the editor (time `getCategories_`, `getAccounts_`, `parseMessage_`); proposed mitigations: reply "bot sibuk, kirim ulang" on lock timeout, and a time budget around the Gemini call.
- 2026-11-02: Correcting a waiting confirmation by chat ("pake bni ya" while a log waits for ✅/❌) was answered "Mau catat transaksi apa pakai BNI?". Cause: Gemini was never told a confirmation was pending, and every `correct` example in the prompt starts with a cue ("salah", "ubah"), so a bare fragment parsed as an incomplete log. Fix: `handleMessage_` puts `getPending_()` in `ctx.pending` and `pendingPromptLines_` (Prompt.gs) adds the pending entries (amount, type, category, account, date; no merchants, they can be third-party names) and a rule that a fragment giving only account, category, amount or date is `correct`. Deployed @37; guidance only, so if Gemini still misreads a fragment, add prompt examples. Not covered by `runExamples()` (no pending in its ctx).
- 2026-11-02: Public history rewritten again (owner's request): the Telegram group name and chat id (old Status lines), the owner's real name (LICENSE copyright and commit author/committer name) and the workspace name (`docs/architecture.py` docstring) removed from all 65 commits. Author and committer are now `rlukafiardi` with the noreply address; the LICENSE reads "Copyright (c) 2026 rlukafiardi". Done with `git filter-branch` (tree filter + env filter) in a fresh clone, verified (0 matches in messages and diffs, final tree differs only in LICENSE and the docstring), force-pushed with a lease on the old head (`3bea9d9` -> `45ac21d`). Local `user.name` is `rlukafiardi`. Limits as before: old commits stay fetchable by SHA until GitHub garbage-collects them, earlier clones keep them. The mirror backup of the old history made for this rewrite was deleted afterwards.
- 2026-11-07: Incident, the "⏭️ Dilewati, sudah tercatat" recurring note came every day for a rule already settled. Cause: Sheets turned the typed `last_month` string "2026-11" into a date cell, `getValues()` returned a Date and `String(Date) !== "2026-11"`, so the rule was due again daily (confirmed from a screenshot of the cell: right-aligned, i.e. a date). Fix: `monthCell_` reads a Date back as yyyy-MM, `recurringSheet_()` sets the column to plain text, two tests added. Deployed @38; to be confirmed by the 08:00 run on 2026-11-08.
- 2026-11-07: Public history rewritten once more (owner's request, all six repos in the workspace): the `Co-Authored-By: Claude` trailer removed from every commit message (69 commits here, 429 across the repos). Only the message lines changed, the trees are identical, author and committer stay `rlukafiardi` with the noreply address. Done with `git filter-branch --msg-filter` after mirror backups, history scanned first (0 secret hits, noreply emails only), force-pushed with a lease on the old head (`9c702a1` -> `5f082f8`). Future commits carry no attribution line (workspace CLAUDE.md rule plus the `attribution` setting). Limits as before: old commits stay fetchable by SHA until GitHub garbage-collects them, so the cached contributor graph may still count the trailer for a while. Lesson: verify with `--branches --tags`, because `filter-branch --all` also rewrites remote-tracking refs and `refs/original` doubles the counts until deleted.

- 2026-11-14: Phone page POC: a `doGet` on the existing web app deployment (access stays ANYONE_ANONYMOUS because of the Telegram webhook), guarded by its own `APP_TOKEN` (not WEBHOOK_SECRET, which the relay sees). Reuses `dashboardData_`. Google-login allowlist untested (unsure whether `Session.getActiveUser()` returns the email for personal accounts).

- 2026-11-14: Feature research (Money Lover, Firefly III, Monarch/Copilot reviews; mostly review blogs, Firefly site unreadable): the app lacked month navigation and a filterable transaction list. Decision: POC 2 builds both read-only in the phone app (not in the dashboard tab, which cannot filter by month without extra trigger code); other ideas listed under Ideas in CLAUDE.md.
- 2026-11-14: POC 2 built: month picker, Transaksi tab with collapsible filters (list capped at 100 rows with a note), as-of balances for past months. Unit tests caught two seeded bugs (exclusive amount bound, balances from all rows). `npm audit` shows 10 findings, all in clasp's dependency tree, same with and without puppeteer-core; not fixed (the only offered fix is a breaking clasp downgrade).
- 2026-11-14: App write design reviewed (docs/app-write-design.md). Finding: any public (no trailing underscore) function is callable via google.script.run from a page this project serves, the read-only app included; checked: none returns data, exposure is nuisance only. Decisions: single project plus an allowlist check of public functions in `npm run check`; one new public function `appSave` with flag, token, PIN (>= 6 digits, lockout after 5), daily cap 30, request ids, strict `appValidate_` before `normalizeTx_` (no Lainnya fallback, no account creation, strict dates); same script lock as doPost; shared `sheetText_` against formula-like text in commitLog_/commitCorrect_ (bot path too).
- 2026-11-14: POC 3 built. Deviations from the design file (it is updated): plain-text cell format instead of an apostrophe prefix; duplicate check on the server inside appSave; Enter submits from the amount and PIN fields. Tests: 12 planted bugs in the write path and 8 in the form were each caught after two gaps were closed (a dead pending-guard test, a main-swap assertion that passed without the swap). Not verified: anything that needs Apps Script itself (see CLAUDE.md Status, live checks).
- 2026-11-14: App design refresh (owner found it plain): hero card with savings-rate ring and 6-month sisa bars, pastel icon tiles matching the Sheet dashboard cards, category donut with one blue ramp by rank (5 ranked + grey, per chart-design: ordered shades, direct labels in the list), transactions grouped by day with category emoji, account share bars, rise/grow animations only when the phone allows motion. Tests updated; screenshots read at 390 px in light and dark.
- 2026-11-14: Correction: the notes said amounts never come from Gemini, but the schema asks Gemini for an integer and only the owner reading the preview guarded it. Built `findAmounts_`/`amountProblem_`: every amount Gemini returns (transactions, correction, opening, limit) must be written in the message or nothing is prepared (bot path, also `runExamples`). Tests: 31 phrasings, the 47 golden examples as model output, bot handler spy, 8 planted bugs caught. Known cost: amounts spelled in words are refused. Chat entry inside the app parked (reasons in Ideas). Telegram link added to the app, built from existing config; the t.me topic link format is unverified on a real phone.
- 2026-11-14: Deployed @39 (npm run deploy). Ships the app (read-only: no APP_WRITE), the plain-text cell format in the bot writers, the amount check in the bot path and the public-function allowlist. Live: 4 refusal checks and the webhook path pass. Open: phone checks (month switch, Telegram button, timing with the token) and one Telegram test message. Rollback: redeploy @37 from Deploy > Manage deployments.
- 2026-11-14: Deployed @40: removed theme-color and apple-mobile-web-app-status-bar-style from doGet (HtmlOutput.addMetaTag allows only viewport, mobile-web-app-capable, apple-mobile-web-app-capable, google-site-verification); the first live render failed with "the meta tag you specified is not allowed". The test stub now enforces that list. Unverified live: Function.toString() source for the two client functions, ScriptApp.getService().getUrl() for month links.
- 2026-11-14: Owner checked the app live (numbers, month switch from the icon, Transaksi list and filters, Telegram button): fine. Live amount check seen on "makan tiga puluh lima ribu": Gemini read Rp35.000, the check refused it. Decision: leave it, no number-word parser (owner types digits).
- 2026-11-14: Owner confirmed the timing check and the Telegram test messages (kopi 25rb with undo, two-amount message, correction, =1+1 note) pass on @40. runExamples() cannot be run from here (clasp run answers NOT_FOUND: no API-executable setup), the owner runs it in the editor.
- 2026-11-14: App: light only (no dark palette; color-scheme light, owner dislikes dark mode here) and the hero is Tabungan sekarang with its change since the start of the month and month-end Tabungan bars, instead of "Sisa bulan ini" and the savings-rate ring. Reason (owner): salary on 25 Oct makes November sisa negative. The Sheet dashboard and the Telegram recaps still show sisa and savings rate; asked the owner whether to change them (that touches the Sisa definition in Key decisions).
- 2026-11-14: Owner decision: sisa and savings rate no longer lead anywhere. Sheet dashboard: 3 cards (Tabungan wide over the left block, Pengeluaran and Pemasukan over the right), trend chart with income and spending only, dashboard_data columns Bulan/Pemasukan/Pengeluaran/Tabungan. Recaps: no Sisa line, no Savings rate line. Explicit questions ("sisa bulan ini?", "savings rate bulan ini?") still answered, prompt unchanged (no golden-set re-run needed). Tests: scripts/test-dashboard.js uses a recording fake Sheet (cell ranges, chart ranges, recap text), 7 planted bugs caught. The look of the tab cannot be tested offline: owner runs refreshDashboard() and looks.
- 2026-11-14: Deployed @41. runExamples() on @40 (owner ran it in the editor): 41/47 passed and 0 lines said "amount not written in the message", so the amount check wrongly refused none of the 47 messages. The 6 misses, none caused by the amount check (prompt unchanged): #6 "kopi 25rb, parkir 5rb" Kopi (Cafe)/Parkir Motor vs expected Makan/Transport (runExamples reads the live categories tab, which has these categories: expectation drifted); #36 "rekap bulan lalu" recap_month null vs 2026-09 (the prompt says null for last month, code handles null: expectation stale); #16 "halo" intent help vs other (shows the help text, harmless); #20 "saldo gopay berapa?" query.account missing, #25 "berapa tabunganku sekarang" and #26 "investasiku berapa?" query.account_kind missing (real: the bot then answers with all accounts instead of the one or the kind). Open: make the golden set use fixed default categories, fix stale expectations (state each change), and try making query.account/account_kind required in the schema with a before/after run.
- 2026-11-14: Owner declined the follow-ups from the runExamples review (fixed-category golden set, stale expectations, required query fields). The 6 misses stay as they are; nothing changed in the prompt or schema.
- 2026-11-14: Pushed 75207d4 and be35bed to origin/main on the owner's go. Before the push: gitleaks over all 75 commits found nothing, all authors and committers use the noreply address, no deleted files in the unpushed commits (no squash needed), the terms Radikal, gmail.com, IOH, indosat and tfe_ioh appear nowhere in history, and "lukafiardi" appears only as the public GitHub handle (LICENSE, package.json URLs). Architecture diagram updated (checks: 0 problems).

## 2026-11-14: Status section of CLAUDE.md before it was restructured (moved here verbatim, nothing cut)

- Tooling (2026-11-14): pre-commit via `.githooks/` (after a fresh clone: `git config core.hooksPath .githooks`): gitleaks, large-file and merge-conflict checks; Dependabot monthly (npm, pre-commit). No GitHub Actions CI while the account has a billing lock. Check: `npm run check`.
- Works (2026-10-28, tested by me end to end): live in my private Telegram group,
  topic 💰 Finance (id 2), group only (ALLOWED_CHAT_ID has just the group; private chat answers /whereami only).
  Scheduled weekly/monthly recaps installed and confirmed working. Webhook through the Cloudflare relay; `npm run deploy` ships
  changes (web app deployment @6+). Logging with ✅/❌ confirmation, corrections, delete/undo, accounts with kinds
  and live balances (`current_balance` formula), budgets with warnings, summaries, robot persona.
  README documents usage, schema, config, setup and troubleshooting.
- 2026-10-28: chat intents (account, budget, category, help, delete by id), the dashboard tab and the daily
  refresh schedule checked by me in live use.
- 2026-10-28: merchant/account lookups, correct by id and admin-fee buttons live (deployment @18), checked by me
  in Telegram along with the dashboard fixes.
- 2026-10-31: Gmail import live: BNI and BCA notification emails (QRIS, Virtual Account, PLN token, e-wallet top-ups,
  transfers, BCA transfers) become one numbered batch to approve with ✅/❌, at 09, 12, 15, 18 and 21 WIB and on
  `/email`; silent when nothing is new except one line at 21:00; a failed run alerts once a day. Audit of 90 days:
  130 of 130 emails parsed. Not imported on purpose: `Kode tarik tunai` (I type withdrawals). Re-check parsers
  against old mail with `auditEmails()` / `dumpFailedSamples()`. The batch flow was checked by me in Telegram (2026-11-01).
- 2026-11-01: Monthly recap on demand (`/rekap`, "rekap bulan lalu", "rekap september") checked by me in Telegram.
  The recaps list every category, one line each (weekly: top 3 plus a rest line).
- 2026-11-01: Recurring monthly entries live (`Recurring.gs`, tab `recurring`, trigger `scheduledRecurring` daily
  08:00, installed by me). Added and removed by chat or `/rutin`, due items approved as a batch like emails. The first
  real due batch has not been seen yet. Current deployment: @37. `runExamples()` was not re-run after the newest
  intents (my call: not needed).
- 2026-11-02: While a ✅/❌ confirmation waits, a bare fragment ("pake bni ya", "kategorinya transport") corrects it by chat:
  the pending entry is passed to Gemini (`pendingPromptLines_`). Deployed @37, not yet checked by me in Telegram.
- 2026-11-14: POC phone page (`App.gs`, `doGet`, token in Script Property `APP_TOKEN`, read-only, same numbers as the dashboard tab). Built and tested locally (`node scripts/test-app.js`), NOT deployed yet. Pass checks: (1) wrong/missing/unset token shows no figures, (2) page matches the dashboard tab and `/rekap`, (3) warm median <= 3 s and cold <= 6 s over 10 `curl` requests, (4) opens from the phone home-screen icon with no horizontal scroll at 390 px. Out of scope: writes, trends, Mini App, Google-login allowlist.
- 2026-11-14: POC 2 built and tested locally (`npm run test:app`: unit tests on a made-up ledger plus a real-Chrome test at 390 px; live checks 6-7 still open), still not deployed: month picker + "Transaksi" tab with filters in the app. Month change = reload with `?month=YYYY-MM` (`ScriptApp.getService().getUrl()`, `target="_top"`); filters run client-side on that month's rows (`id, date, amount, type, category, account, to_account, merchant, note`, never `raw_message`). Past months show as-of balances and today's budget limits (no limit history). Pass checks: totals and as-of balances equal hand-computed ledger values, filter unit tests, bad `month` falls back, browser test at 390 px, live: warm median <= 3 s, cold <= 6 s, payload <= 300 KB for the busiest month, month switch works from the home-screen icon. Stop: slow or heavy => cached month JSON; switch fails => `google.script.run` (unverified for anonymous web apps). Out of scope: edit/delete, all-time search, trends, top merchants, allowance, CSV.
- 2026-11-14: PUSHED to the public repo (be35bed): history scan clean (gitleaks 75 commits, noreply authors only, no real name, personal email or employer term; only the public handle). Architecture diagram updated with the phone app lane and the amount check (`docs/architecture.py`). DEPLOYED @41 (app light only, hero = Tabungan; Sheet dashboard and recaps without sisa and savings rate; refusal and webhook checks pass). `runExamples()` on @40: 41/47, 0 amount-check refusals; the 6 misses are listed in the decisions log. Earlier: DEPLOYED @40 (@39 failed its first render on two disallowed meta tags; read-only: `APP_WRITE` unset, `APP_TOKEN` and `APP_PIN` set by me). Live refusal checks done (no token, wrong token, month without token, hostile month: all `Tidak diizinkan.`, 16 B, ~1.6 s; webhook still 302 then `ok`). Checked by me on my phone (2026-11-14): the whole app part works (numbers, month switch, Transaksi, Telegram button). Amount check seen live: "makan tiga puluh lima ribu" was refused on purpose. Also confirmed by me: timing is fine (numbers not noted) and the Telegram test messages pass (plain-text format, amount check on normal messages). Not yet done: `runExamples()` after the amount check. POC 3 built: (`docs/app-write-design.md`, `npm run test:app`: unit, write-path and two real-Chrome tests; 20+ seeded bugs caught). "+" form -> preview -> `appSave` (flag `APP_WRITE=on`, token, `APP_PIN` >= 6 digits, 5 wrong = 1 h lock, 30 writes/day, request id, server-side duplicate warning, strict `appValidate_`, same script lock as `doPost`). With the flag off the page has no form and no server call. Typed-text columns get a plain-text format in every writer (bot path too). `check-refs.js` now fails on a public function outside its allowlist. Design refreshed 2026-11-14 (also: the Sheet dashboard has 3 cards, Tabungan wide on the left, and the trend chart has income and spending only; the recaps lost their sisa and savings-rate lines; not yet looked at in the Sheet) (hero, donut, day-grouped list, icons, reduced motion); then light only and the hero is Tabungan instead of sisa (sisa goes negative when the salary lands in the previous month). Live checks still open: `google.script.run` from the home-screen icon, `=1+1` stored as text, save time with the dashboard refresh (> 5 s: move it to a one-shot trigger), two quick taps = one row, Rp1.000 test entry seen in Sheet + `/terakhir` + dashboard, removed with the bot's delete by id. Stop: page cannot call the server -> app stays read-only.
- 2026-11-14: CLAUDE.md restructured (12.4 KB to about 9 KB): Status split into live, checked by me, built-not-live and next; the old dated Status entries were moved verbatim to the section above in this log; stale "not deployed yet" wording removed; Ideas regrouped by state with every item kept.
