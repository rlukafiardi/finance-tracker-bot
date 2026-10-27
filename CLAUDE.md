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
- `type` is `expense | income | saving`. Savings are not expenses: savings rate = (income - expense) / income.
- Known quirks: none yet. Amount shorthand to handle: "35rb", "15jt", "1,5jt".

## Decisions
- 2026-10-27: Project created. Telegram (not WhatsApp: no ban risk, no business verification), n8n Community
  self-hosted on Oracle Always Free VPS, Gemini free tier for parsing, Google Sheets for storage,
  Looker Studio for the dashboard.
- 2026-10-27: Lean layout with no Python environment: logic lives in n8n. Folders: `workflows/`, `prompts/`, `deploy/`.
  Add `evals/` or Python only when actually needed.
- 2026-10-27: Gemini model name goes in one n8n variable, since free-tier quotas can change.

## Status
- Works: scaffold only.
- Next: decide HTTPS for the Telegram webhook (Cloudflare Tunnel if I have a domain, else Caddy + DuckDNS),
  create the Oracle VPS, create the Sheet with its two tabs, then build the n8n workflow.
