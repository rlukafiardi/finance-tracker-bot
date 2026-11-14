# Finance Tracker Bot

## Goal
Log income, expenses and savings by chatting with a Telegram bot (or, optionally, a phone app form), and see weekly and
monthly spending, the category breakdown, income vs expense and the money I hold (Tabungan) in a Sheet dashboard, in
Telegram recaps and in a phone app. Total cost $0.
Success measured by: a message is logged correctly (right amount, type, category) without manual fixes, and the
dashboard or app answers "how much did I spend this month" and "how much money do I hold".

## Data
- Sources: messages typed by me in Telegram (Bahasa Indonesia + English, e.g. "makan siang 35rb gofood"), bank
  notification emails (Gmail import), and the app's form when `APP_WRITE=on`.
- Store: Google Sheet, tabs `transactions`, `categories`, `accounts`, `budgets`, `recurring`, `email_log` plus the generated
  `dashboard` and `dashboard_data` (schema and definitions in README).
- Grain: one row per transaction; `type` is `expense | income | saving | transfer`.
- Known quirks: amount shorthand "35rb", "15jt", "1,5jt". clasp `--auth` must point at the .clasprc.json file, not the
  folder (EISDIR). After changing BotFather privacy the bot must be removed and re-added to the group. Apps Script
  webhooks always answer 302 (hence the relay). `HtmlOutput.addMetaTag` accepts only `viewport`, `mobile-web-app-capable`,
  `apple-mobile-web-app-capable` and `google-site-verification`: any other name fails the page at run time. Every public
  function (no trailing `_`) can be called from the app page, so `scripts/check-refs.js` keeps an allowlist. zsh in Bash:
  brace vars before ":" (`${c}:path`).

## Key decisions (the full dated log is `docs/decisions-log.md`: grep it, never load it whole; append new entries there)
- Stack: Telegram bot and phone app on one Google Apps Script web app (clasp 3.x as a devDependency; `npm run check` = syntax + `scripts/check-refs.js`; `npm run test:app` = unit, write-path, dashboard and two real-Chrome tests; `npm run deploy` ships to the fixed deployment), Google Sheet as the store, Gemini free tier for parsing (model in the `GEMINI_MODEL` script property), Cloudflare Worker relay in front of the webhook. Total cost $0.
- Security: secrets only in Script Properties, never in code or git; webhook secret plus allowlist (`ALLOWED_USER_ID`, `ALLOWED_CHAT_ID`, `FINANCE_TOPIC_ID`); the repo is public by choice: scan the whole history for secrets and real names before each push (done 2026-11-14).
- Flow: every write waits for ✅/❌ confirmation (one pending action, 15-minute expiry); Gemini returns amounts as integers, so code refuses any amount that is not written in the message (`amountProblem_`, Commands.gs); slash commands are handled in code (no quota) and all of them also work by chat.
- Data model: types `expense | income | saving | transfer`; accounts with kinds and a per-row SUMIFS balance formula; "Tabungan" = balance of all accounts except investasi and e-wallet, and it leads the dashboard, the recaps and the app; "sisa" (income − expense) and savings rate are only answered when asked, because they go negative when the salary lands in the previous month; transfers are excluded from spending and income.
- Gmail import: `gmail.readonly` scope, one regex parser per email template (no Gemini, unknown templates reported, never guessed), approval first, duplicates = same type, account and amount within ±1 day, email text never stored, third-party names never reach Gemini; runs 5 times a day.
- Dashboard: a generated tab in the Sheet (not Looker Studio) with values computed by the bot's own functions: 3 cards (Tabungan wide, spending, income), income vs spending trend; rebuilt after every confirmed change and daily 06:00.
- Phone app (`App.gs`): `doGet` behind its own `APP_TOKEN` (not `WEBHOOK_SECRET`), light only, month picker, tabs Ringkasan / Kategori / Transaksi / Akun, past months show as-of balances and today's budget limits (no limit history). Recording is off unless `APP_WRITE=on`; then `appSave` needs the token and `APP_PIN` (>= 6 digits, 5 wrong = 1 h lock), 30 writes a day, a request id per form, a server-side duplicate warning and strict validation, under the same script lock as `doPost` (design: `docs/app-write-design.md`). With the flag off the page has no form and no server call.
- Typed-text columns (merchant, note, raw message) get a plain-text cell format in every writer, so `=1+1` stays text.
- Schedules: weekly recap (Monday 09:00) and monthly recap (1st, 09:00 WIB), recurring monthly entries approved as a batch (daily 08:00 check), failure alerts once a day; run `installSchedules()` once after a deploy that adds a trigger.

## Status
- Live, deployed @41 (2026-11-14; rollback = redeploy @37 from Deploy > Manage deployments). Bot, checked by me end to end: logging with ✅/❌, corrections, delete/undo, accounts with kinds and live balances, budgets with warnings, summaries and `/rekap`, admin-fee buttons, recurring entries (the first real due batch has not been seen yet), Gmail import (BNI and BCA; the 90-day audit parsed 130 of 130 emails; `Kode tarik tunai` is not imported on purpose). Not yet checked by me in Telegram: the bare-fragment correction while a confirmation waits ("pake bni ya").
- Live and checked by me on my phone: the amount check (amounts in words, e.g. "tiga puluh lima ribu", are refused on purpose, my call); the app read-only (numbers, month switch from the icon, Transaksi list and filters, Telegram button, timing, light only, hero = Tabungan); the Telegram test messages (plain-text format, amount check); the Sheet dashboard (I refreshed it and reported no problem). `runExamples()` on @40: 41/47, 0 amount-check refusals; the 6 misses (3 query fields missing, 2 stale expectations, "halo" gives help) are listed in the decisions log and left as they are (my call).
- Built and tested locally, not live: recording from the app. Open live checks, after setting `APP_WRITE=on`: `google.script.run` from the home-screen icon, `=1+1` stored as text via the app, save time with the dashboard refresh (over 5 s: move the refresh to a one-shot trigger), two quick taps = one row, a Rp1.000 test entry seen in Sheet + `/terakhir` + dashboard and removed with the bot's delete by id. Stop: the page cannot call the server -> the app stays read-only.
- Tooling: pre-commit via `.githooks/` (after a fresh clone: `git config core.hooksPath .githooks`): gitleaks, large-file and merge-conflict checks; Dependabot monthly (npm, pre-commit). No GitHub Actions CI while the account has a billing lock. Architecture diagram: `docs/architecture.py` (updated 2026-11-14).
- Next, only when wanted: turn on `APP_WRITE` and run the Rp1.000 test (Sonnet, no plan mode).
- Ideas (state):
  - done: recurring entries (monthly only); monthly recap for a chosen month; month picker and transaction list with filters in the app; Telegram button in the app; amount check in the bot path
  - open, my pick: receipt photos and voice notes via Gemini multimodal; savings goals
  - open, waiting for my answer: admin-fee buttons put the fee on the wallet account for ShopeePay / OVO top-ups typed by hand
  - open, low priority: category trend over months and this month vs last month per category, top merchants, daily allowance (budget left / days left), CSV export of a filtered list
  - open, not needed yet: weekly and yearly recurrences, changing a rule's amount without removing it
  - open, liked less: runway and forecast, net worth, debts and split bills, bill reminders, large-expense warnings, streaks, monthly PDF
  - parked: WhatsApp Cloud API as a second channel; chat-style entry inside the app (Telegram already does it; costs a public function, Gemini quota and an amount check; revisit only if I keep switching to Telegram to type a message)
  - dropped: cash-withdrawal code emails (I type withdrawals); bank sync, multi-currency and shared wallets (no free bank API in Indonesia, Gmail import covers it, single user); Indonesian number words in the amount check (I type digits); fixed-category golden set, fixing the 2 stale `runExamples` expectations and required `query.account`/`account_kind` (misses #20, #25, #26)
