// Recurring monthly entries ("tiap tanggal 25 biaya admin bca 12,5rb"). Tab `recurring`: one row per rule, with the
// month it was last settled. scheduledRecurring() (daily) proposes the rules that are due as one numbered batch to
// approve (action kind 'recurring_due'), edited like an email batch. A rule is due from its day of the month on, once
// per month; a month that was missed is not made up. Rules are added and removed by chat or /rutin, each with ✅/❌.

const RECURRING_HOUR = 8;
const RECURRING_HEADERS = ['id', 'day', 'amount', 'type', 'category', 'account', 'to_account', 'merchant', 'note', 'last_month'];

function recurringSheet_() {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName('recurring');
  if (!sh) {
    sh = ss.insertSheet('recurring');
    sh.getRange(1, 1, 1, RECURRING_HEADERS.length).setValues([RECURRING_HEADERS]);
    sh.setFrozenRows(1);
  }
  sh.getRange(1, RECURRING_HEADERS.length, sh.getMaxRows(), 1).setNumberFormat('@');
  return sh;
}

// Sheets turns a typed "2026-11" into a date cell, and getValues() then returns a Date.
function monthCell_(v) {
  return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM') : String(v);
}

function getRecurring_() {
  const sh = spreadsheet_().getSheetByName('recurring');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, RECURRING_HEADERS.length).getValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) {
      return {
        id: String(r[0]), day: Number(r[1]), amount: Number(r[2]), type: String(r[3]), category: String(r[4]),
        account: String(r[5]), to_account: String(r[6]), merchant: String(r[7]), note: String(r[8]), lastMonth: monthCell_(r[9]),
      };
    });
}

// "YYYY-MM-DD" of a rule's day in month ym; day 29-31 falls on the last day of a shorter month.
function dueDate_(day, ym) {
  const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  return ym + '-' + ('0' + Math.min(day, last)).slice(-2);
}

function isRecurringDue_(item, today) {
  const ym = today.slice(0, 7);
  return item.lastMonth !== ym && dueDate_(item.day, ym) <= today;
}

function recurringTx_(item, ym) {
  return {
    date: dueDate_(item.day, ym), amount: item.amount, type: item.type, category: item.category, account: item.account,
    to_account: item.to_account, merchant: item.merchant, note: item.note || 'rutin',
  };
}

function setLastMonth_(ids, ym) {
  if (!ids || !ids.length) return;
  const sh = recurringSheet_();
  const last = sh.getLastRow();
  if (last < 2) return;
  const col = sh.getRange(2, 1, last - 1, 1).getValues();
  col.forEach(function (r, i) {
    if (ids.indexOf(String(r[0])) >= 0) sh.getRange(i + 2, RECURRING_HEADERS.length).setValue(ym);
  });
}

function recurringLine_(item) {
  const tx = recurringTx_(item, todayStr_().slice(0, 7));
  return item.id + ' · tgl ' + item.day + ' · ' + describe_(Object.assign({}, tx, { date: '' })).replace(/\n└ /, ' · ').replace(/ · $/, '');
}

function recurringList_() {
  const items = getRecurring_();
  if (!items.length) return 'Belum ada rutin. Contoh: "tiap tanggal 25 biaya admin bca 12,5rb".';
  return '🔁 Rutin bulanan (' + items.length + '):\n' + items.map(function (i) { return '• ' + recurringLine_(i); }).join('\n');
}

// /rutin -> list; /rutin hapus <id or words> -> remove
function recurringCommand_(args) {
  if (!args.length) return recurringList_();
  if (args[0].toLowerCase() === 'hapus' && args.length > 1) return prepareRecurringRemove_(args.slice(1).join(' '));
  return 'Format: /rutin (daftar) atau /rutin hapus <id>. Menambah lewat chat: "tiap tanggal 25 biaya admin bca 12,5rb".';
}

// Shared by chat (intent "recurring") and /rutin. rec = { action: add | list | remove, day, match }.
function prepareRecurring_(rec, txs, ctx) {
  const action = rec && rec.action;
  if (action === 'list') return recurringList_();
  if (action === 'remove') return prepareRecurringRemove_(rec.match);

  const day = rec && rec.day;
  if (!Number.isInteger(day) || day < 1 || day > 31) return 'Tiap tanggal berapa? Contoh: "tiap tanggal 25 biaya admin bca 12,5rb".';
  if (!txs || !txs.length) return 'Apa yang dicatat rutin? Contoh: "tiap tanggal 25 biaya admin bca 12,5rb".';
  const n = normalizeTx_(txs[0], ctx);
  if (n.error) return '🤖 Tidak bisa dibuat rutin (' + n.error + ').';
  const created = [];
  collectNewAccounts_(n.newAccounts, ctx, created);
  return {
    action: { kind: 'recurring_add', day: day, tx: n.tx, newAccounts: created },
    preview: '🔁 Catat rutin tiap tanggal ' + day + ' setiap bulan?\n\n' +
      describe_(Object.assign({}, n.tx, { date: 'tiap tgl ' + day })) + newAccountsNote_(created),
  };
}

// A rule is skipped for the month it is created in when its day has already passed.
function commitRecurringAdd_(a) {
  createAccounts_(a.newAccounts);
  const today = todayStr_();
  const ym = today.slice(0, 7);
  const id = Utilities.getUuid().slice(0, 8);
  const t = a.tx;
  recurringSheet_().appendRow([id, a.day, t.amount, t.type, t.category, t.account, t.to_account, t.merchant, t.note,
    dueDate_(a.day, ym) <= today ? ym : '']);
  return '✅ Rutin tiap tanggal ' + a.day + ' tersimpan (id ' + id + ').' +
    (dueDate_(a.day, ym) <= today ? '\nBulan ini dilewati karena tanggalnya sudah lewat.' : '');
}

function prepareRecurringRemove_(match) {
  const items = getRecurring_();
  if (!items.length) return 'Belum ada rutin yang bisa dihapus.';
  const words = String(match || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 'Rutin yang mana? Lihat /rutin lalu "hapus rutin <id>".';
  const hits = items.filter(function (i) {
    if (words.length === 1 && i.id === words[0]) return true;
    const text = [i.merchant, i.note, i.category, i.account].join(' ').toLowerCase();
    return words.every(function (w) { return text.indexOf(w) >= 0; });
  });
  if (!hits.length) return 'Tidak ada rutin yang cocok dengan "' + match + '". Lihat /rutin.';
  if (hits.length > 1) {
    return 'Ada ' + hits.length + ' yang cocok, sebut id-nya:\n' + hits.map(function (i) { return '• ' + recurringLine_(i); }).join('\n');
  }
  return { action: { kind: 'recurring_remove', id: hits[0].id }, preview: '🗑️ Hapus rutin ini?\n\n' + recurringLine_(hits[0]) };
}

function commitRecurringRemove_(a) {
  const sh = recurringSheet_();
  const last = sh.getLastRow();
  const ids = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === a.id) {
      sh.deleteRow(i + 2);
      return '✅ Rutin dihapus.';
    }
  }
  return '⚠️ Rutinnya sudah tidak ada.';
}

function recurringBatchPreview_(a) {
  return '🔁 ' + a.ids.length + ' rutin jatuh tempo, catat ' + a.txs.length + ' transaksi?\n\n' +
    a.txs.map(function (t, i) { return (i + 1) + '. ' + describe_(t); }).join('\n') +
    newAccountsNote_(a.newAccounts) + (a.newCategories || []).map(newCategoryNote_).join('') +
    (a.notes ? '\n\n' + a.notes : '') + '\n\n✏️ Ubah sebelum simpan, mis. "ubah no 1 jadi 15rb".';
}

// Marks the batch settled for its month, whether it was approved, cancelled or already in the sheet.
function settleRecurring_(a) {
  setLastMonth_(a.ids.concat(a.duplicateIds), a.month);
}

function commitRecurringDue_(a) {
  (a.newCategories || []).forEach(commitCategory_);
  const result = commitLog_({ txs: a.txs, raw: 'rutin', newAccounts: a.newAccounts });
  settleRecurring_(a);
  return result;
}

// Returns { reply, quiet } or { action, preview }. Never replaces another pending confirmation.
function prepareRecurringDue_(ctx) {
  const pending = getPending_();
  if (pending && pending.action.kind !== 'recurring_due') {
    return { reply: '⏳ Ada konfirmasi lain yang menunggu. Rutin dicek lagi nanti.', quiet: true };
  }
  const today = todayStr_();
  const ym = today.slice(0, 7);
  const due = getRecurring_().filter(function (i) { return isRecurringDue_(i, today); });
  if (!due.length) return { reply: 'Tidak ada rutin yang jatuh tempo.', quiet: true };

  const rows = readTransactions_();
  const fresh = [];
  const already = [];
  due.forEach(function (item) {
    const tx = recurringTx_(item, ym);
    (isDuplicateTx_(tx, rows) ? already : fresh).push({ item: item, tx: tx });
  });
  const alreadyNote = already.length
    ? '⏭️ Dilewati, sudah tercatat: ' + already.map(function (x) { return recurringLine_(x.item); }).join('; ') : '';
  if (!fresh.length) {
    setLastMonth_(already.map(function (x) { return x.item.id; }), ym);
    return { reply: '🔁 ' + alreadyNote };
  }

  const txs = [];
  const newAccounts = [];
  const ids = [];
  for (let i = 0; i < fresh.length; i++) {
    const n = normalizeTx_(fresh[i].tx, ctx);
    if (n.error) return { reply: '⚠️ Rutin ' + fresh[i].item.id + ' tidak bisa dicatat (' + n.error + '). Hapus atau buat ulang.' };
    txs.push(n.tx);
    ids.push(fresh[i].item.id);
    collectNewAccounts_(n.newAccounts, ctx, newAccounts);
  }
  const action = {
    kind: 'recurring_due', month: ym, txs: txs, ids: ids,
    duplicateIds: already.map(function (x) { return x.item.id; }), newAccounts: newAccounts, newCategories: [], notes: alreadyNote,
  };
  return { action: action, preview: recurringBatchPreview_(action) };
}

// Daily trigger. Silent when nothing is due; a failure is reported once a day and rethrown.
function scheduledRecurring() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const r = prepareRecurringDue_({ cats: getCategories_(), accounts: getAccounts_() });
    const to = reportTarget_();
    if (r.action) askConfirm_(to, r.action, r.preview);
    else if (!r.quiet) sendMessage_(to, r.reply);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    alertJobFailure_('RECURRING', 'Cek rutin', err);
    throw err;
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}
