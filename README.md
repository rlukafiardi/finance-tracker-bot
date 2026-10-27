# Finance Tracker Bot

Personal finance tracker: send a chat message to a Telegram bot ("makan siang 35rb gofood", "gaji 15jt masuk",
"nabung 2jt"), Gemini parses it into a structured row, n8n writes it to Google Sheets, and a Looker Studio
dashboard shows spending, income and savings. Target cost: $0.

## Flow

1. Telegram message -> n8n webhook (self-hosted on Oracle Always Free VPS)
2. Gemini (free tier) extracts JSON: date, amount, type (expense/income/saving), category, account, merchant, note
3. n8n validates the JSON and appends a row to the `transactions` tab (categories come from the `categories` tab)
4. Bot replies with a confirmation; corrections update the row by `id`
5. Looker Studio reads the Sheet: weekly/monthly spending, by category, income vs expense, savings rate

## Data sources

- Google Sheet (`GOOGLE_SHEET_ID`): `transactions` and `categories` tabs. Columns:
  `id, date, amount, type, category, account, merchant, note, raw_message, created_at`.

## Layout

- `workflows/`: exported n8n workflow JSON (no credentials)
- `prompts/`: Gemini prompt templates, versioned as files
- `evals/`: sample messages and expected parses, to test prompt changes
- `deploy/`: Docker Compose and VPS setup notes
- `finance_tracker_bot/`: Python helpers (eval scripts), if needed

## How to run

1. Copy `.env.example` to `.env` and fill in the secrets (never commit it).
2. On the VPS: `docker compose -f deploy/docker-compose.yml up -d` (to be added).
3. Import the workflow from `workflows/` into n8n and attach credentials.
4. Local Python helpers: `uv sync`.
