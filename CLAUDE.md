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

## Key decisions (the full dated log is `docs/decisions-log.md`: grep it, never load it whole; append new entries there)
- Stack: Telegram bot on Google Apps Script (clasp 3.x as a devDependency; `npm run check` = syntax + `scripts/check-refs.js` for undefined helpers, `npm run deploy` ships to the fixed web app deployment), Google Sheet as the store, Gemini free tier for parsing (model name in the `GEMINI_MODEL` script property), Cloudflare Worker relay in front of the webhook (Apps Script always answers 302). Total cost $0.
- Security: secrets only in Script Properties, never in code or git; webhook secret plus allowlist (`ALLOWED_USER_ID`, `ALLOWED_CHAT_ID`, `FINANCE_TOPIC_ID`); the repo is public by choice: scan the whole history for secrets and real names before each push.
- Flow: every write waits for ✅/❌ confirmation (one pending action, 15-minute expiry); Gemini returns amounts as integers, so code refuses any amount that is not written in the message (`amountProblem_`, Commands.gs; before 2026-11-14 this line wrongly said amounts never come from Gemini); slash commands are handled in code (no quota) and all of them also work by chat.
- Data model: types `expense | income | saving | transfer`; accounts with kinds and a per-row SUMIFS balance formula; "Tabungan" = balance of all accounts except investasi and e-wallet and it leads the dashboard, the recaps and the app; "sisa" (income − expense) and savings rate are only answered when asked, because they go negative when the salary lands in the previous month (changed 2026-11-14); transfers are excluded from spending and income.
- Gmail import: `gmail.readonly` scope, one regex parser per email template (no Gemini, unknown templates reported, never guessed), approval first, duplicates = same type, account and amount within ±1 day, email text never stored, third-party names never reach Gemini; runs 5 times a day.
- Dashboard: a generated tab in the Sheet (not Looker Studio) with values computed by the bot's own functions; rebuilt after every confirmed change and daily 06:00.
- Schedules: weekly recap (Monday 09:00) and monthly recap (1st, 09:00 WIB), recurring monthly entries approved as a batch (daily 08:00 check), failure alerts once a day; run `installSchedules()` once after a deploy that adds a trigger.

## Status
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
- Ideas (state, newest decisions last):
  - recurring entries: done (monthly only)
  - monthly recap for a chosen month: done
  - receipt photos and voice notes via Gemini multimodal: open (my pick)
  - savings goals: open (my pick)
  - admin-fee buttons put the fee on the wallet account for ShopeePay / OVO top-ups typed by hand: open, waiting for my answer
  - weekly and yearly recurrences, changing a rule's amount without removing it: open, not needed yet
  - runway and forecast, net worth, debts and split bills, bill reminders, large-expense warnings, streaks, monthly PDF: open, liked less
  - cash-withdrawal code emails: dropped (I type withdrawals)
  - WhatsApp Cloud API as a second channel: parked
  - 2026-11-14 follow-ups:
    - chat-style entry inside the app (Gemini parse in `appParse`): parked. Telegram already does it; costs a public function, quota and an amount check; revisit only if I keep switching to Telegram to type a message
    - Telegram button/link in the app (derived from `ALLOWED_CHAT_ID` + `FINANCE_TOPIC_ID`): done, deep-link format `t.me/c/<id>/<topic>` not yet tried on a phone
    - Indonesian number words in the amount check ("tiga puluh lima ribu"): dropped by me, I type digits; such messages are refused with a reply
  - golden set with fixed categories, fixing 2 stale `runExamples` expectations, and required `query.account`/`account_kind` in the schema (misses #20, #25, #26): dropped by me 2026-11-14, not needed
  - amount check in the bot path (`findAmounts_`, `amountProblem_`): done, 47 golden examples pass it without Gemini; `runExamples()` now reports refusals against the real model, not yet run
  - 2026-11-14 feature research (finance apps), app and dashboard gaps:
    - month picker (previous/next, any month) in the app: open, proposed first
    - transaction list with filters (text, category, account, type, amount range) in the app: open, proposed first
    - category trend over months and this month vs last month per category: open
    - top merchants / most frequent spends: open
    - daily allowance (budget left / days left): open
    - CSV export of a filtered list: open, low priority
    - savings goals, receipt/voice entry: already listed above (my pick)
    - bank sync, multi-currency, shared wallets: dropped (no free bank API in Indonesia, Gmail import covers it; single user)
