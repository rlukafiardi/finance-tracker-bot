# Finance Tracker Bot

Personal finance tracker: send a message to a Telegram bot ("makan siang 35rb gofood", "gaji 15jt masuk",
"nabung 2jt"), Gemini parses it, and a Google Apps Script web app writes it to a Google Sheet.
Looker Studio reads the Sheet for spending, income and savings. Runs entirely on free tiers, no card, no server.

## Flow

1. Telegram message -> webhook -> Apps Script web app (`doPost`)
2. Checks: secret in the URL, chat id equals mine, update not seen before
3. Gemini (free tier) returns JSON: intent (log / correct / query / other) and transactions
4. Validate against the `categories` tab, then append to `transactions`, correct the last row, or answer a summary query
5. Bot replies with what it did

## Data

Google Sheet with two tabs.

`transactions`: `id, date, amount, type, category, account, merchant, note, raw_message, created_at, to_account`
(`type` is expense, income, saving or transfer; `to_account` is only used by transfers).
`categories`: `type, category`. Seeded by `setup()` with the defaults in `apps-script/Setup.gs`.
`accounts`: `account, opening_balance`. Balance = opening balance + income - expense - saving, with transfers
moving money between accounts. Unknown accounts are created automatically with opening balance 0.
`budgets`: `category, monthly_limit` (expense categories only).

## Layout

- `apps-script/`: the code to paste into the Apps Script editor (one file per `.gs`)
- `CLAUDE.md`: project notes

## Setup (copy-paste, no tooling)

1. Telegram: create the bot with @BotFather and keep the token. Message the bot once, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` in your browser to read your numeric `chat.id`.
2. Sheet: open it, Extensions > Apps Script. Create one file per `.gs` in `apps-script/` and paste the contents.
   In Project Settings set the time zone to Asia/Jakarta (or paste `appsscript.json` via "Show appsscript.json").
3. Project Settings > Script Properties, add:

   | Property | Value |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | from BotFather |
   | `GEMINI_API_KEY` | from aistudio.google.com |
   | `GEMINI_MODEL` | optional, defaults to `gemini-3.5-flash-lite` (free: 15 RPM, 500 RPD on my project). Full Flash models only get 20 RPD, and `gemini-2.5-flash` returns 404 for new accounts. Check https://ai.dev/rate-limit for current limits |
   | `SHEET_ID` | the id in the Sheet URL |
   | `ALLOWED_CHAT_ID` | your `chat.id` |
   | `WEBHOOK_SECRET` | a random string of letters and digits only (e.g. `openssl rand -hex 16`); Telegram rejects symbols |

4. Run `setup()` once and authorize. It creates the two tabs, headers and default categories.
5. Run `runExamples()` and read the log: it tests the prompt against 15 sample messages without touching the Sheet.
6. Connect Telegram, pick one:
   - Polling (simplest, all Google): run `startPolling()`, then `checkConfig()`. Replies take up to a minute;
     code changes only need a save. Skip steps 7-9.
   - Webhook (replies in seconds): steps 7-9.
7. Deploy > New deployment > Web app: execute as Me, access Anyone. Copy the `/exec` URL into a new
   script property `WEBAPP_URL`. After later code changes use Deploy > Manage deployments > Edit > New version
   (the URL stays the same).
8. Relay (needed: Apps Script answers webhooks with a 302, so Telegram keeps resending the first update and
   newer messages get stuck). On a free Cloudflare account (no card): Workers & Pages > Create > Worker, paste
   `relay/worker.js`, Deploy. Under Settings > Variables and Secrets add two Secrets: `TELEGRAM_SECRET`
   (= `WEBHOOK_SECRET`) and `APPS_SCRIPT_URL` (= the `/exec` URL + `?secret=` + `WEBHOOK_SECRET`).
   Put the Worker URL (`https://<name>.<you>.workers.dev`) in the script property `RELAY_URL`.
9. Run `setWebhook()`, then `checkConfig()`: every line should be true and the last error "none". Then message the bot.

Never put tokens in the code or in git; they live only in Script Properties.

## Bot commands (just type them)

- Log: "makan siang 35rb gofood", "gaji 15jt", "nabung 2jt", "kemarin grab 28k", "kopi 25rb, parkir 5rb"
- With accounts: "tap lrt 17k pake gopay" (expense from GoPay), "top up gopay pake bni 200k" (transfer BNI -> GoPay)
- Fix the last entry: "ubah yang tadi jadi 40rb", "salah, harusnya transport", "salah, pakai bca"
- Ask: "pengeluaran minggu ini?", "savings rate bulan ini?", "sisa kas bulan ini?", "saldo gopay?"
- Delete and history: "hapus yang tadi" (removes everything the latest message logged), "5 transaksi terakhir"
- Slash commands (no Gemini call): `/help`, `/saldo`, `/akun BNI 1,5jt` (add account or set opening balance),
  `/kategori` (list), `/kategori expense Hobi` (add category), `/budget` (status), `/budget makan 1,5jt`
  (monthly limit, 0 removes it), `/terakhir [n]` (latest entries with id), `/hapus [id]` (latest message, or one row by id)
- Budgets: after an expense, the reply warns when its category has used 80% or more of this month's budget.
- Optional script property `DEFAULT_ACCOUNT`: used when a message names no account.
