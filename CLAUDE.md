# Finance Tracker Bot

## Goal
Log income, expenses and savings by chatting with a Telegram bot, and see weekly/monthly spending,
category breakdown, income vs expense and savings rate in a dashboard. Total cost $0.
Success measured by: a message is logged correctly (right amount, type, category) without manual fixes,
and the dashboard answers "how much did I spend / save this month".

## Data
- Sources: messages typed by me in Telegram (Bahasa Indonesia + English, e.g. "makan siang 35rb gofood").
- Store: Google Sheet, tabs `transactions` and `categories`.
- Grain: one row per transaction. Columns: `id, date, amount, type, category, account, merchant, note, raw_message, created_at`.
- `type` is `expense | income | saving`. Savings are not expenses: savings rate = (income - expense) / income;
  balance (sisa kas) = income - expense - saving.
- Known quirks: none yet. Amount shorthand to handle: "35rb", "15jt", "1,5jt".

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

## Status
- Works: repo (private, rlukafiardi/finance-tracker-bot), full Apps Script code written, NOT yet run or deployed.
  Telegram bot, Gemini API key and the blank Sheet exist (created by me).
- Known risk: Apps Script answers POSTs with a 302 redirect, which Telegram may log as a webhook error and retry.
  Dedupe makes retries harmless, but check `webhookInfo()` after `setWebhook()`. Fallback: a free Cloudflare Worker
  relay that forwards to Apps Script and returns 200 to Telegram.
- Next: paste code into the Sheet's Apps Script, set properties, `setup()`, `runExamples()`, deploy, `setWebhook()`,
  test with real messages. Then the Looker Studio dashboard.
