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
- Flow: every write waits for ✅/❌ confirmation (one pending action, 15-minute expiry); amounts always come from code, never from Gemini; slash commands are handled in code (no quota) and all of them also work by chat.
- Data model: types `expense | income | saving | transfer`; accounts with kinds and a per-row SUMIFS balance formula; "Sisa" = income − expense; "Tabungan" = balance of all accounts except investasi and e-wallet; transfers are excluded from spending and income.
- Gmail import: `gmail.readonly` scope, one regex parser per email template (no Gemini, unknown templates reported, never guessed), approval first, duplicates = same type, account and amount within ±1 day, email text never stored, third-party names never reach Gemini; runs 5 times a day.
- Dashboard: a generated tab in the Sheet (not Looker Studio) with values computed by the bot's own functions; rebuilt after every confirmed change and daily 06:00.
- Schedules: weekly recap (Monday 09:00) and monthly recap (1st, 09:00 WIB), recurring monthly entries approved as a batch (daily 08:00 check), failure alerts once a day; run `installSchedules()` once after a deploy that adds a trigger.

## Status
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
  real due batch has not been seen yet. Current deployment: @35. `runExamples()` was not re-run after the newest
  intents (my call: not needed).
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
