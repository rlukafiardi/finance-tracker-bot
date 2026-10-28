# Finance Tracker Bot

## Goal
Log income, expenses and savings by chatting with a Telegram bot, and see weekly/monthly spending,
category breakdown, income vs expense and savings rate in a dashboard. Total cost $0.
Success measured by: a message is logged correctly (right amount, type, category) without manual fixes,
and the dashboard answers "how much did I spend / save this month".

## Data
- Sources: messages typed by me in Telegram (Bahasa Indonesia + English, e.g. "makan siang 35rb gofood").
- Store: Google Sheet, tabs `transactions`, `categories`, `accounts`, `budgets` (schema and definitions in README).
- Grain: one row per transaction; `type` is `expense | income | saving | transfer`.
- Known quirks: amount shorthand "35rb", "15jt", "1,5jt". clasp `--auth` must point at the .clasprc.json file, not
  the folder (EISDIR). After changing BotFather privacy the bot must be removed and re-added to the group.
  Apps Script webhooks always answer 302 (hence the relay). zsh in Bash: brace vars before ":" (`${c}:path`).

## Decisions
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
- 2026-10-28: Bot moves to a Telegram group with Topics, one topic per feature (plan: IDX technical analysis as
  a separate Python project, e.g. GitHub Actions, sharing this bot; the Cloudflare relay will route by topic).
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

## Status
- Works (2026-10-28, tested by me end to end): live in group "Radikal AI Assistant🗿" (chat -1004451166719),
  topic 💰 Finance (id 2), group only (ALLOWED_CHAT_ID has just the group; private chat answers /whereami only).
  Scheduled weekly/monthly recaps installed and confirmed working. Webhook through the Cloudflare relay; `npm run deploy` ships
  changes (web app deployment @6+). Logging with ✅/❌ confirmation, corrections, delete/undo, accounts with kinds
  and live balances (`current_balance` formula), budgets with warnings, summaries, robot persona.
  README documents usage, schema, config, setup and troubleshooting.
- `runExamples()` not re-run after the account-kinds prompt change (26 cases): skipped by my choice, live use works.
- Feature backlog, in priority order: receipt photos and voice notes via Gemini multimodal; recurring entries;
  savings goals. WhatsApp Cloud API is parked as a possible second channel.
- Next: IDX technical analysis as its own project in another topic, with topic routing added to `relay/worker.js`.
