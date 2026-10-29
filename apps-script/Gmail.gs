// Bank notification emails (Gmail API v1, read-only scope).
// Import: scheduledEmailImport() (09, 12, 15, 18 and 21 WIB) and /email read emails received since EMAIL_SINCE that are not in the
// `email_log` tab yet, parse them (EmailParse.gs) and ask for approval with one numbered batch (action kind 'emails').
// Nothing is written to `transactions` before the ✅. A batch that is replaced or expires leaves its emails unmarked,
// so the next run offers them again.
// previewEmails() is the parse-only dry run; dumpEmailSamples() logs the newest email of each kind with long digit
// runs masked, for writing parsers against real text.

const EMAIL_SOURCES = [
  { bank: 'BNI', from: 'wondr@bni.co.id', subject: 'Transaksi berhasil!' },
  { bank: 'BNI', from: 'wondr@bni.co.id', subject: 'Top-up berhasil!' },
  { bank: 'BNI', from: 'wondr@bni.co.id', subject: 'Transfer berhasil!' },
  { bank: 'BCA', from: 'bca@bca.co.id', subject: 'Internet Transaction Journal' },
];
const SAMPLE_LOOKBACK_DAYS = 60;
const EMAIL_HOURS = [9, 12, 15, 18, 21]; // WIB; each trigger fires at some point within its hour
const EMAIL_BATCH_MAX = 12; // the PENDING script property holds the whole batch and is limited to 9 KB

function emailQuery_(source, days) {
  return 'from:' + source.from + ' subject:"' + source.subject + '" newer_than:' + days + 'd';
}

function emailQuerySince_(source, sinceSeconds) {
  return 'from:' + source.from + ' subject:"' + source.subject + '" after:' + sinceSeconds;
}

// First part with the given MIME type, searching nested multiparts.
function findPart_(part, mime) {
  if (part.mimeType === mime && part.body && part.body.data) return part;
  const children = part.parts || [];
  for (let i = 0; i < children.length; i++) {
    const hit = findPart_(children[i], mime);
    if (hit) return hit;
  }
  return null;
}

// The advanced Gmail service already decodes body.data into a byte array.
function decodePart_(part) {
  return Utilities.newBlob(part.body.data).getDataAsString('UTF-8');
}

// Plain text of a message; HTML-only emails are stripped of tags and collapsed to one space per run.
function emailText_(message) {
  const plain = findPart_(message.payload, 'text/plain');
  if (plain) return decodePart_(plain).trim();
  const html = findPart_(message.payload, 'text/html');
  if (!html) return '';
  return decodePart_(html)
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

// Account and reference numbers are long digit runs; amounts carry separators and stay readable. The greeting line
// ("Hai, NAME" / "Hello NAME,") is replaced too; other names (a transfer's recipient) are not, so read before sharing.
function maskDigits_(text) {
  return text
    .replace(/\d{6,}/g, function (m) { return m.slice(0, 2) + '*'.repeat(m.length - 4) + m.slice(-2); })
    .replace(/^\s*(Hai,|Hello)\s+.*$/gm, '$1 [NAMA]');
}

// Run once from the editor (it asks for Gmail read access), then read the log. Names are not masked: check the
// text before pasting it anywhere.
function dumpEmailSamples() {
  EMAIL_SOURCES.forEach(function (source) {
    const list = Gmail.Users.Messages.list('me', { q: emailQuery_(source, SAMPLE_LOOKBACK_DAYS), maxResults: 1 });
    const label = source.bank + ' | ' + source.subject;
    if (!list.messages || !list.messages.length) {
      console.log('=== ' + label + ': no email in the last ' + SAMPLE_LOOKBACK_DAYS + ' days');
      return;
    }
    const message = Gmail.Users.Messages.get('me', list.messages[0].id, { format: 'full' });
    console.log('=== ' + label + ' | ' + new Date(Number(message.internalDate)).toISOString() + '\n' +
      maskDigits_(emailText_(message)).slice(0, 3000));
  });
}

const PREVIEW_DAYS = 7;
const AUDIT_DAYS = 90;
const AUDIT_MAX_PER_SOURCE = 60;

function listEmailIds_(query) {
  let ids = [];
  let token;
  do {
    const res = Gmail.Users.Messages.list('me', { q: query, maxResults: 100, pageToken: token });
    ids = ids.concat((res.messages || []).map(function (m) { return m.id; }));
    token = res.nextPageToken;
  } while (token);
  return ids;
}

function emailTxLine_(tx) {
  const what = tx.type === 'transfer' ? tx.account + ' ➜ ' + tx.to_account : (tx.merchant || tx.category || tx.type);
  return '• ' + tx.date + ' · ' + tx.account + ' · ' + (tx.type === 'expense' ? '-' : '') + rupiah_(tx.amount) + ' · ' + what;
}

// Parse-only dry run. The reply lists only parsed fields and failure reasons, never email text.
function previewEmails() {
  const parsed = [];
  const failed = [];
  EMAIL_SOURCES.forEach(function (source) {
    listEmailIds_(emailQuery_(source, PREVIEW_DAYS)).forEach(function (id) {
      const message = getEmail_(id, { format: 'full' });
      const r = parseBankEmail_(source.bank, emailText_(message));
      if (r.error) failed.push('• ' + source.bank + ' "' + source.subject + '": ' + r.error);
      else r.txs.forEach(function (tx) { parsed.push(tx); });
    });
  });
  parsed.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

  const lines = ['📧 Email bank, ' + PREVIEW_DAYS + ' hari terakhir (belum disimpan)', ''];
  lines.push(parsed.length ? 'Terbaca (' + parsed.length + '):' : 'Tidak ada email yang terbaca.');
  parsed.slice(0, 40).forEach(function (tx) { lines.push(emailTxLine_(tx)); });
  if (parsed.length > 40) lines.push('… dan ' + (parsed.length - 40) + ' lainnya');
  if (failed.length) lines.push('', '⚠️ Tidak terbaca (' + failed.length + '):', failed.slice(0, 10).join('\n'));
  sendMessage_(reportTarget_(), lines.join('\n'));
}

// ---- Import ----------------------------------------------------------------------------------------------

function emailLogSheet_() {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName('email_log');
  if (!sh) {
    sh = ss.insertSheet('email_log');
    sh.getRange(1, 1, 1, 4).setValues([['message_id', 'bank', 'status', 'updated_at']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

// Set of Gmail message ids that were settled before: saved, skipped, duplicate or unsupported.
function loggedEmailIds_() {
  const sh = emailLogSheet_();
  const known = {};
  if (sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { known[String(r[0])] = true; });
  }
  return known;
}

// emails = [{ id, bank }].
function markEmails_(emails, status) {
  if (!emails || !emails.length) return;
  const now = new Date();
  const rows = emails.map(function (e) { return [e.id, e.bank, status, now]; });
  const sh = emailLogSheet_();
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
}

// Settles every email of a batch: the approved or skipped ones, the duplicates and the unsupported ones.
function settleEmails_(a, status) {
  markEmails_(a.emailIds, status);
  markEmails_(a.duplicateIds, 'duplicate');
  markEmails_(a.unsupportedIds, 'unsupported');
}

// Run once from the editor: remembers "now" as the start (older emails are never imported) and installs the triggers.
function installEmailImport() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('EMAIL_SINCE')) props.setProperty('EMAIL_SINCE', String(Math.floor(Date.now() / 1000)));
  installSchedules();
}

// Fetches and parses the new emails since EMAIL_SINCE. Returns items sorted by arrival, plus the ones that failed.
function fetchNewEmails_() {
  const since = Number(prop_('EMAIL_SINCE'));
  const logged = loggedEmailIds_();
  const items = [];
  const unsupported = [];
  EMAIL_SOURCES.forEach(function (source) {
    listEmailIds_(emailQuerySince_(source, since)).forEach(function (id) {
      if (logged[id]) return;
      const message = getEmail_(id, { format: 'full' });
      const at = Number(message.internalDate);
      if (at / 1000 < since) return;
      const r = parseBankEmail_(source.bank, emailText_(message));
      if (r.error) unsupported.push({ id: id, bank: source.bank, label: source.bank + ' "' + source.subject + '": ' + r.error });
      else items.push({ id: id, bank: source.bank, at: at, txs: r.txs });
    });
  });
  items.sort(function (a, b) { return a.at - b.at; });
  return { items: items, unsupported: unsupported };
}

// Expenses without a category: the merchant's earlier category, else one Gemini call for all new merchants.
// Returns true when Gemini failed (those expenses became Lainnya).
function fillEmailCategories_(items, rows, ctx) {
  const unknown = {};
  items.forEach(function (it) {
    it.txs.forEach(function (tx) {
      if (tx.type !== 'expense' || tx.category) return;
      const known = tx.merchant ? lookupMerchantCategory_(tx.merchant, rows) : null;
      if (known) tx.category = known;
      else if (tx.merchant && !tx.person) unknown[tx.merchant.toLowerCase()] = tx.merchant;
      else tx.category = 'Lainnya';
    });
  });
  const merchants = Object.keys(unknown).map(function (k) { return unknown[k]; });
  if (!merchants.length) return false;

  let guessed = {};
  let failed = false;
  try {
    guessed = categorizeMerchants_(merchants, ctx.cats.expense);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    failed = true;
  }
  items.forEach(function (it) {
    it.txs.forEach(function (tx) {
      if (tx.type === 'expense' && !tx.category) tx.category = guessed[tx.merchant.toLowerCase()] || 'Lainnya';
    });
  });
  return failed;
}

function emailDupLine_(tx) {
  return rupiah_(tx.amount) + ' ' + (tx.merchant || tx.to_account || tx.type) + ' ' + tx.date;
}

// Shared by the daily trigger, /email and chat. Returns { reply, quiet } (quiet = stay silent when scheduled) or
// { action, preview } for the confirmation step.
function prepareEmailImport_(ctx) {
  const pending = getPending_();
  if (pending && pending.action.kind !== 'emails') {
    return { reply: '⏳ Ada konfirmasi lain yang menunggu, selesaikan dulu ya. Email dicek lagi nanti.', quiet: true };
  }
  const fetched = fetchNewEmails_();
  const rows = readTransactions_();
  const fresh = [];
  const duplicates = [];
  fetched.items.forEach(function (it) { (isDuplicateTx_(it.txs[0], rows) ? duplicates : fresh).push(it); });
  const batch = fresh.slice(0, EMAIL_BATCH_MAX);

  const idOf = function (it) { return { id: it.id, bank: it.bank }; };
  const unsupported = fetched.unsupported;
  if (!batch.length) {
    markEmails_(duplicates.map(idOf), 'duplicate');
    markEmails_(unsupported.map(idOf), 'unsupported');
    if (!duplicates.length && !unsupported.length) return { reply: 'Tidak ada email bank baru 📭', quiet: true, idle: true };
    return { reply: '📧 Tidak ada transaksi baru untuk dicatat.' + emailNotes_(duplicates, unsupported, 0, false) };
  }

  const geminiFailed = fillEmailCategories_(batch, rows, ctx);
  const txs = [];
  const newAccounts = [];
  const usable = [];
  batch.forEach(function (it) {
    const clean = [];
    for (let i = 0; i < it.txs.length; i++) {
      const n = normalizeTx_(it.txs[i], ctx);
      if (n.error) {
        unsupported.push({ id: it.id, bank: it.bank, label: it.bank + ': ' + n.error });
        return;
      }
      clean.push(n);
    }
    usable.push(it);
    clean.forEach(function (n) {
      txs.push(n.tx);
      collectNewAccounts_(n.newAccounts, ctx, newAccounts);
    });
  });
  const action = {
    kind: 'emails', txs: txs, emailIds: usable.map(idOf), duplicateIds: duplicates.map(idOf),
    unsupportedIds: unsupported.map(idOf), newAccounts: newAccounts, newCategories: [],
    notes: emailNotes_(duplicates, unsupported, fresh.length - batch.length, geminiFailed).replace(/^\n\n/, ''),
  };
  return { action: action, preview: emailBatchPreview_(action) };
}

function emailNotes_(duplicates, unsupported, leftover, geminiFailed) {
  const lines = [];
  if (geminiFailed) lines.push('⚠️ Gemini gagal menebak kategori, diisi Lainnya.');
  if (duplicates.length) {
    lines.push('⏭️ Dilewati, sudah tercatat: ' + duplicates.map(function (it) { return emailDupLine_(it.txs[0]); }).join('; '));
  }
  if (unsupported.length) {
    lines.push('⚠️ Belum didukung (' + unsupported.length + '): ' +
      unsupported.slice(0, 3).map(function (u) { return u.label; }).join('; '));
  }
  if (leftover > 0) lines.push('📬 ' + leftover + ' email lagi menunggu, ketik /email setelah ini.');
  return lines.length ? '\n\n' + lines.join('\n') : '';
}

// A failed run tells the topic once per day (a persistent failure would otherwise repeat at every run).
function alertEmailFailure_(err) {
  const props = PropertiesService.getScriptProperties();
  const today = todayStr_();
  if (props.getProperty('EMAIL_ALERT_DATE') === today) return;
  props.setProperty('EMAIL_ALERT_DATE', today);
  sendMessage_(reportTarget_(), '⚠️ Cek email gagal: ' + String(err && err.message).slice(0, 200) +
    '\nSaya coba lagi di jadwal berikutnya. Detail: Apps Script > Executions.');
}

// Time trigger. Takes the same lock as the webhook so it cannot interleave with a chat message. Silent when nothing
// is new, except that the last run of the day says so once; a failure is reported and then rethrown so the
// Executions page shows it as failed.
function scheduledEmailImport() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const r = prepareEmailImport_({ cats: getCategories_(), accounts: getAccounts_() });
    const to = reportTarget_();
    const lastRun = Number(Utilities.formatDate(new Date(), TZ, 'H')) === EMAIL_HOURS[EMAIL_HOURS.length - 1];
    if (r.action) askConfirm_(to, r.action, r.preview);
    else if (!r.quiet || (r.idle && lastRun)) sendMessage_(to, r.reply);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    alertEmailFailure_(err);
    throw err;
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}
