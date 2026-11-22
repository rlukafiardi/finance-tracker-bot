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
- Live, deployed @48 (2026-11-16; rollback = redeploy @47 from Deploy > Manage deployments). Bot, checked by me end to end: logging with ✅/❌, corrections, delete/undo, accounts with kinds and live balances, budgets with warnings, summaries and `/rekap`, admin-fee buttons, recurring entries (first real due batch seen by me, 2026-11-22), Gmail import (BNI and BCA; the 90-day audit parsed 130 of 130 emails; `Kode tarik tunai` is not imported on purpose).
- Live and checked by me on my phone: the amount check (amounts in words, e.g. "tiga puluh lima ribu", are refused on purpose, my call); the app read-only (numbers, month switch from the icon, Transaksi list and filters, Telegram button, timing, light only, hero = Tabungan); the Telegram test messages (plain-text format, amount check). `runExamples()` on @40: 41/47, 0 amount-check refusals; the 6 misses (3 query fields missing, 2 stale expectations, "halo" gives help) are listed in the decisions log and left as they are (my call).
- Built and tested locally, not live: recording from the app. Open live checks, after setting `APP_WRITE=on`: `google.script.run` from the home-screen icon, `=1+1` stored as text via the app, save time with the dashboard refresh (over 5 s: move the refresh to a one-shot trigger), two quick taps = one row, a Rp1.000 test entry seen in Sheet + `/terakhir` + dashboard and removed with the bot's delete by id. Stop: the page cannot call the server -> the app stays read-only.
- Tooling: pre-commit via `.githooks/` (after a fresh clone: `git config core.hooksPath .githooks`): gitleaks, large-file and merge-conflict checks; Dependabot monthly (npm, pre-commit). No GitHub Actions CI while the account has a billing lock. Architecture diagram: `docs/architecture.py` (updated 2026-11-14).
- Live @43 (my reply after deploy: "nice"; no separate check list given): tap-to-see-numbers on the week bars, hero bars and donut slices (a phone has no hover; a tap outside the chart clears the selection), and the weekly chart as whole Monday-to-Sunday weeks like the Telegram recaps (W1.. from the week of the 1st to the week of the last day; the first and last week can hold days of the neighbouring month, so the weeks do not add up to the month total, the caption shows the month total). Pushed. Outside-tap reset checked by me on the phone for the donut and hero bars too (browser test covers the week bars only).
- Live @44, checked by me on the phone (2026-11-16): the **✏️ Lain** button on the admin-fee keyboards (type any amount, e.g. `3rb`, `Rp 3.500`; only a message that is just an amount counts, so "makan 35rb" is never read as a fee; 15-minute wait; cap `FEE_MAX` Rp 100.000 is my assumption), and the **Tren kategori** panel on the Kategori tab (top 5 expense categories, 6 months, tap a bar for the amount, % vs the month before over the same days, own scale per row). The wallet fee buttons for ShopeePay/OVO (fee on the wallet account) were already live since bb98186. Not done: a browser test for the trend bars.
- Live @47 (2026-11-16): the Telegram trend. `/tren [word]` and any message starting with "tren" are answered in code (`parseTrendWord_`, no Gemini); a word that is an expense category gives that category, any other word searches merchant and note of all expenses ("tren ngopi"), no word gives the top 5. "baru" = no spending on the same days last month (explained in the footer and the app hint). Other phrasings ("pengeluaran per kategori 6 bulan") go through Gemini as query metric `category_trend` (not tested live). Why code: a first version let Gemini pick the word and "tren makan" fell back to all categories. @48: the footer (bot) and hint (app) explain the percent and "baru" only when a row shows them. Checked by me on the phone: /tren, "tren makan", "tren ngopi" and the app panel work.
- Next, only when wanted: turn on `APP_WRITE` and run the Rp1.000 test (Sonnet, no plan mode).
- Ideas (state):
  - done: admin-fee buttons incl. wallet fee and free-text fee (Lain); category trend over months in the app and in Telegram (`/tren`); recurring entries (monthly only); monthly recap for a chosen month; month picker and transaction list with filters in the app; Telegram button in the app; amount check in the bot path
  - open, my pick: receipt photos and voice notes via Gemini multimodal; savings goals
  - open, low priority: top merchants, daily allowance (budget left / days left), CSV export of a filtered list
  - open, not needed yet: weekly and yearly recurrences, changing a rule's amount without removing it
  - open, liked less: runway and forecast, net worth, debts and split bills, bill reminders, large-expense warnings, streaks, monthly PDF
  - parked: WhatsApp Cloud API as a second channel; chat-style entry inside the app (Telegram already does it; costs a public function, Gemini quota and an amount check; revisit only if I keep switching to Telegram to type a message)
  - dropped: cash-withdrawal code emails (I type withdrawals); bank sync, multi-currency and shared wallets (no free bank API in Indonesia, Gmail import covers it, single user); Indonesian number words in the amount check (I type digits); fixed-category golden set, fixing the 2 stale `runExamples` expectations and required `query.account`/`account_kind` (misses #20, #25, #26)
