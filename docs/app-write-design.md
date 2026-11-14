# App writes: design (POC 3)

Reviewed 2026-11-14. Build follows this file; checks are the POC 3 checks in `CLAUDE.md`.

## Finding that applies before any write exists

Any top-level server function whose name does not end in `_` can be called with `google.script.run` from a page this
project serves (Apps Script docs, "HTML Service: Communicate with Server Functions": private = trailing underscore;
library functions are not reachable). The read-only page (POC 1/2) is such a page, so a token holder can call:
`setup, setWebhook, checkConfig, refreshDashboard, installSchedules, installEmailImport, weeklySummary, monthlySummary,
scheduledRecurring, scheduledEmailImport, previewEmails, dumpEmailSamples, auditEmails, dumpFailedSamples, runExamples,
run*Tests, doPost, doGet`.

Checked 2026-11-14: none of them returns data to the caller (they log, message the owner's own Telegram, or rebuild
triggers), and Sheet writes still need the owner's ✅ in Telegram. Exposure today = nuisance (spam recaps, a new
import batch replacing a waiting confirmation, Gemini quota on test runs), not data access.

Decision: keep the single project, and make `npm run check` fail on any public function outside an allowlist
(`scripts/check-refs.js`), each listed with why it is public (entry point, trigger, owner tool from the editor's Run
menu). Rule: a public function never returns data unless it checks the token itself (only `appSave`). Fallback if
this is not enough: a separate Apps Script project for the app.

## Server: `appSave(req)` (the only new public function)

`req = { token, pin, rid, month, entry: { type, amount, date, category, account, to_account, merchant, note } }`

Order (each refusal returns `{ ok: false, error }` in plain Indonesian, writes nothing):
1. `APP_WRITE` is `on`, else "Pencatatan dari aplikasi belum aktif."
2. `appAuthorized_(req.token, APP_TOKEN)`.
3. Shape: `req` is an object, strings only, `rid` matches `^[a-z0-9-]{8,40}$`.
4. `LockService.getScriptLock().waitLock(25000)` (the same lock as `doPost`, which holds it during Gemini calls);
   timeout: "Lagi sibuk, coba lagi sebentar."
5. App state in one Script Property `APP_STATE` = `{ fails, lockedUntil, day, writes, recent: [{ rid, id }] }`.
   - Locked: "Terkunci sampai HH:mm."
   - PIN: `APP_PIN` must be at least 6 digits (shorter or unset = writes refused). Wrong PIN: `fails + 1`; the 5th
     wrong PIN sets `lockedUntil = now + 1 h`. Right PIN: `fails = 0`. A token holder can lock writes for an hour on
     purpose; Telegram still works.
   - `rid` already in `recent` (last 50): return the earlier result, no write (double tap, retry).
   - `day` is today in WIB; `writes >= 30`: "Batas 30 transaksi per hari dari aplikasi."
6. `appValidate_(entry, ctx, today)`, pure and strict, because `normalizeTx_` falls back where a form must refuse:
   - type in `expense | income | saving | transfer`;
   - amount matches `^[0-9]{1,10}$`, 1 to 1.000.000.000;
   - date `YYYY-MM-DD` that round-trips through `Date.UTC` (refuses 2026-02-30), not after today, not more than
     365 days back;
   - category: an exact existing category of that type (no `Lainnya` fallback), none for transfer;
   - account (and `to_account` for transfer, different from account): an existing account (no account creation);
   - merchant at most 80 characters, note at most 200, control characters removed.
   Then `normalizeTx_` for the shared cleaning; refuse if it reports `newAccounts`.
7. `commitLog_({ txs: [tx], newAccounts: [], raw: 'app' })`, record `{ rid, id }`, `writes + 1`, save `APP_STATE`.
8. `refreshDashboardAfterChange_()` inside the lock, as the bot does (two refreshes must not interleave). Its duration
   is unmeasured: live check 8 times the whole save; if it is over 5 s, move the refresh to a debounced one-shot trigger.
9. Release the lock. Return `{ ok: true, id, text: describe_(tx), warnings: budgetWarnings_ text, main: <sections
   HTML for req.month>, rows: <rows for req.month> }`.

App writes never touch `PENDING`, so a confirmation waiting in Telegram is not replaced.

## Formula-like text

`setValues` turns a string starting with `=` into a formula (to verify live). Built as: the typed-text cells get a
plain-text number format (`setNumberFormat('@')`) before the values are written, in `commitLog_` (columns 7-9),
`commitCorrect_` (7-8), the fee row in `Fees.gs` (7-9) and `commitRecurringAdd_` (8-9). Chosen over a `'` prefix
because a prefix may be stored as data and corrupt merchant lookups; the format leaves the text untouched.
Live check: an entry with note `=1+1` reads back as the text `=1+1`.

## Client

- "+" button on every tab, opens a bottom sheet: type (segmented), amount (digits, live "Rp 35.000"), date (today),
  category (list for the type), account / from and to for transfer, merchant, note.
- "Lanjut" shows the preview card, then "Simpan" / "Ubah". Built as: the duplicate check runs on the server inside
  `appSave` (it sees every month, not just the one on screen): the first save without `dupOk: true` answers
  `{ ok: false, duplicate: true, existing }`, the page shows it and "Tetap simpan" resends with `dupOk: true`
  and the same request id. A warning, not a block.
- First save of a page load asks for the PIN (`type=password`, `inputmode=numeric`), kept in a variable only, never
  in storage or the URL; cleared after a wrong PIN.
- One `rid` per form opening (`crypto.randomUUID`), so a retry of the same entry is not saved twice. "Simpan" is
  disabled while the call runs.
- After a save, `<main>` is replaced with the returned sections and `ROWS` with the returned rows; listeners use event
  delegation on `main`, so nothing needs re-binding and the PIN stays in memory.
- `appPage_` is split into the shell and `appSections_(d, view)`, so the save response reuses the same HTML.

## Tests

- Unit (`scripts/test-app.js`, made-up ledger, `SpreadsheetApp`/`LockService`/`PropertiesService` stubbed in the vm):
  exact row values; every invalid entry above writes nothing; formula-like text; flag, token, PIN, lockout, cap and
  short-PIN refusals; the same `rid` twice gives one row; `appModel_` numbers move by exactly the amount; a transfer
  moves both balances; `APP_STATE` survives a refusal unchanged except `fails`.
- Browser (`scripts/e2e-app.js`): `google.script.run` replaced by a fake that records calls; form validation, preview,
  duplicate warning, PIN asked once per load, disabled button while pending, refusal text shown, main swapped after
  save, 390 px without sideways scroll.
- Live (check 8, writes on): Rp1.000 test entry with note `=1+1` from the home-screen icon, seen in the Sheet,
  `/terakhir` and the dashboard, save time measured, two quick taps give one row, removed with the bot's delete by id.

## Not changed by this design

- `normalizeTx_` keeps its bot-friendly fallbacks. Whether `Utilities.parseDate` rolls `2026-02-30` to 2 March on the
  bot path is unverified.
- New accounts and categories, edits and deletes stay in the bot.
