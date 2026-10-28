// Google Sheet access: categories, accounts, transactions, balances, summary queries.
// Tabs: `transactions` (SHEET_HEADERS), `categories` (type, category), `accounts` (account, opening_balance).
// Writes are split in two: prepare*_ validates and returns { action, preview } for the confirmation step
// (or { reply } when there is nothing to confirm); commit*_ performs the write after the user confirms.

const SHEET_HEADERS = ['id', 'date', 'amount', 'type', 'category', 'account', 'merchant', 'note', 'raw_message', 'created_at', 'to_account'];
const TYPES = ['expense', 'income', 'saving']; // types that have categories
const ALL_TYPES = TYPES.concat(['transfer']);

function spreadsheet_() {
  return SpreadsheetApp.openById(prop_('SHEET_ID'));
}

function sheet_(name) {
  const sh = spreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet tab: ' + name + ' (run setup())');
  return sh;
}

function todayStr_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function fmtDate_(value) {
  return value instanceof Date ? Utilities.formatDate(value, TZ, 'yyyy-MM-dd') : String(value);
}

function rupiah_(n) {
  const abs = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 ? '-' : '') + 'Rp' + abs;
}

function getCategories_() {
  const cats = { expense: [], income: [], saving: [] };
  const sh = sheet_('categories');
  const last = sh.getLastRow();
  if (last < 2) return cats;
  sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
    const type = String(r[0]).trim();
    const category = String(r[1]).trim();
    if (TYPES.indexOf(type) >= 0 && category) cats[type].push(category);
  });
  return cats;
}

function accountsSheet_() {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName('accounts');
  if (!sh) {
    sh = ss.insertSheet('accounts');
    sh.getRange(1, 1, 1, 4).setValues([['account', 'opening_balance', 'current_balance', 'kind']]);
    sh.setFrozenRows(1);
    sh.getRange('B:C').setNumberFormat('#,##0');
  }
  return sh;
}

// current_balance for accounts row r, the same rule as balanceReply_: opening + income - expense - saving
// - transfers out (account) + transfers in (to_account). SUMIFS is case-insensitive, like matchAccount_.
// Apps Script formulas always use English function names and comma separators, whatever the sheet locale.
function balanceFormula_(r) {
  const sum = function (col, type) {
    return 'SUMIFS(transactions!C:C,transactions!' + col + ':' + col + ',$A' + r + ',transactions!D:D,"' + type + '")';
  };
  return '=$B' + r + '+' + sum('F', 'income') + '-' + sum('F', 'expense') + '-' + sum('F', 'saving') +
    '-' + sum('F', 'transfer') + '+' + sum('K', 'transfer');
}

function getAccounts_() {
  const sh = spreadsheet_().getSheetByName('accounts');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) {
      const name = String(r[0]).trim();
      return { name: name, opening: Number(r[1]) || 0, kind: parseKind_(r[3]) || guessKind_(name) };
    });
}

function matchAccount_(name, accounts) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  const hit = accounts.find(function (a) { return a.name.toLowerCase() === key; });
  return hit ? hit.name : null;
}

function addAccount_(name, opening, kind) {
  const sh = accountsSheet_();
  const r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, 4).setValues([[name, opening, balanceFormula_(r), kind || guessKind_(name)]]);
}

// Writes one cell (column col) of the accounts row for `name`.
function setAccountCell_(name, col, value) {
  const sh = accountsSheet_();
  const names = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < names.length; i++) {
    if (String(names[i][0]).trim().toLowerCase() === name.toLowerCase()) {
      sh.getRange(i + 2, col).setValue(value);
      return;
    }
  }
}

function setOpening_(name, opening) {
  setAccountCell_(name, 2, opening);
}

function setAccountKind_(name, kind) {
  setAccountCell_(name, 4, kind);
}

// Returns { tx, newAccounts } with a cleaned transaction, or { error } with a reason.
// newAccounts lists account names that are not in ctx.accounts yet.
function normalizeTx_(tx, ctx) {
  const amount = Number(tx.amount);
  if (!Number.isInteger(amount) || amount <= 0) return { error: 'jumlah tidak valid' };
  if (ALL_TYPES.indexOf(tx.type) < 0) return { error: 'tipe tidak valid' };

  const newAccounts = [];
  const pickAccount = function (name) {
    const raw = String(name || '').trim();
    if (!raw) return '';
    const known = matchAccount_(raw, ctx.accounts);
    if (known) return known;
    newAccounts.push(raw);
    return raw;
  };

  let account = pickAccount(tx.account);
  let toAccount = '';
  let category;

  if (tx.type === 'transfer') {
    toAccount = pickAccount(tx.to_account);
    if (!account || !toAccount) return { error: 'transfer butuh akun asal dan tujuan, mis. "nabung 2jt dari bca ke bibit"' };
    if (account.toLowerCase() === toAccount.toLowerCase()) return { error: 'akun asal dan tujuan sama' };
    category = 'Transfer';
  } else {
    const list = ctx.cats[tx.type];
    category = list.find(function (c) { return c.toLowerCase() === String(tx.category).toLowerCase(); });
    if (!category) category = list.find(function (c) { return c === 'Lainnya'; });
    if (!category) return { error: 'kategori "' + tx.category + '" tidak ada untuk ' + tx.type };
  }

  let date = todayStr_();
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(tx.date))) {
    try {
      Utilities.parseDate(tx.date, TZ, 'yyyy-MM-dd');
      date = tx.date;
    } catch (err) { /* keep today */ }
  }
  return {
    tx: {
      date: date,
      amount: amount,
      type: tx.type,
      category: category,
      account: account,
      to_account: toAccount,
      merchant: tx.merchant || '',
      note: tx.note || '',
    },
    newAccounts: newAccounts,
  };
}

function describe_(tx) {
  if (tx.type === 'transfer') {
    return '🔁 Transfer ' + rupiah_(tx.amount) + '\n└ ' + tx.account + ' ➜ ' + tx.to_account + ' · ' + tx.date;
  }
  const details = [tx.merchant, tx.account, tx.date].filter(Boolean).join(' · ');
  return emojiFor_(tx) + ' ' + tx.category + ' ' + rupiah_(tx.amount) + '\n└ ' + details;
}

function newAccountsNote_(names) {
  if (!names.length) return '';
  return '\n\n🆕 Akun baru: ' + names.join(', ') + ' (saldo awal Rp0, atur nanti dengan /akun <nama> <saldo>)';
}

// Remembers accounts seen for the first time, so a later row in the same message matches them.
function collectNewAccounts_(names, ctx, created) {
  names.forEach(function (name) {
    if (!matchAccount_(name, ctx.accounts)) {
      ctx.accounts.push({ name: name, opening: 0 });
      created.push(name);
    }
  });
}

function createAccounts_(names) {
  const existing = getAccounts_();
  names.forEach(function (name) {
    if (!matchAccount_(name, existing)) {
      addAccount_(name, 0);
      existing.push({ name: name, opening: 0 });
    }
  });
}

function rowToTx_(r) {
  return {
    id: String(r[0]), date: fmtDate_(r[1]), amount: Number(r[2]), type: r[3], category: String(r[4]),
    account: String(r[5]), merchant: String(r[6]), note: String(r[7]), to_account: String(r[10]),
  };
}

// Sheet row number of a transaction id (searching from the bottom), or -1.
function findRowById_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === id) return i + 2;
  }
  return -1;
}

// ---- Log -------------------------------------------------------------------------------------------------

function prepareLog_(txs, raw, ctx, hint) {
  if (!txs.length) return { reply: '🤖 ' + (hint || line_('confused')) };

  const clean = [];
  const created = [];
  for (let i = 0; i < txs.length; i++) {
    const n = normalizeTx_(txs[i], ctx);
    if (n.error) return { reply: '🤖 Bip... tidak bisa dicatat (' + n.error + '). Coba tulis ulang ya.' };
    clean.push(n.tx);
    collectNewAccounts_(n.newAccounts, ctx, created);
  }
  return {
    action: { kind: 'log', txs: clean, raw: raw, newAccounts: created },
    preview: '📝 Catat ' + (clean.length > 1 ? clean.length + ' transaksi' : 'ini') + '?\n\n' +
      clean.map(describe_).join('\n') + newAccountsNote_(created) + savingTip_(clean),
  };
}

// A plain "nabung 2jt" leaves the tracked accounts; naming the savings account keeps the money visible.
function savingTip_(txs) {
  const plain = txs.some(function (t) { return t.type === 'saving'; });
  return plain ? '\n\n💡 Tip: sebut akun tujuannya (mis. "nabung 2jt dari bca ke Tabungan BCA") biar saldonya ikut kelihatan.' : '';
}

function commitLog_(a) {
  createAccounts_(a.newAccounts);
  const now = new Date();
  const rows = a.txs.map(function (t) {
    t.id = Utilities.getUuid().slice(0, 8); // kept on the action so feeButtons_ can point at the saved transfer
    return [
      t.id,
      Utilities.parseDate(t.date, TZ, 'yyyy-MM-dd'),
      t.amount, t.type, t.category, t.account, t.merchant, t.note, a.raw, now, t.to_account,
    ];
  });
  const sh = sheet_('transactions');
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, SHEET_HEADERS.length).setValues(rows);
  return '✅ ' + line_('saved') + '\n\n' + a.txs.map(describe_).join('\n') + budgetWarnings_(a.txs);
}

// ---- Correct (the last row, "yang tadi", or a row by id from /terakhir) ----------------------------------

function prepareCorrect_(corr, ctx) {
  const sh = sheet_('transactions');
  const id = corr && corr.id ? String(corr.id).replace(/^#/, '') : '';
  const r = id ? findRowById_(sh, id) : sh.getLastRow();
  if (id && r < 0) return { reply: 'ID ' + id + ' tidak ditemukan 🔍 Lihat /terakhir.' };
  if (r < 2) return { reply: 'Belum ada transaksi untuk dikoreksi 🤖' };

  const before = rowToTx_(sh.getRange(r, 1, 1, SHEET_HEADERS.length).getValues()[0]);
  const next = Object.assign({}, before);
  let changed = false;
  ['amount', 'category', 'type', 'date', 'account'].forEach(function (k) {
    if (corr && corr[k] !== null && corr[k] !== undefined && corr[k] !== '') {
      next[k] = corr[k];
      changed = true;
    }
  });
  if (!changed) return { reply: 'Tidak ada yang diubah 🤔 Contoh: "ubah yang tadi jadi 40rb".' };

  const n = normalizeTx_(next, ctx);
  if (n.error) return { reply: '🤖 Koreksi gagal (' + n.error + ').' };
  const created = [];
  collectNewAccounts_(n.newAccounts, ctx, created);
  return {
    action: { kind: 'correct', id: before.id, tx: n.tx, newAccounts: created },
    preview: '✏️ Ubah ' + (id ? 'transaksi #' + id : 'transaksi terakhir') + '?\n\nSebelum:\n' + describe_(before) +
      '\n\nSesudah:\n' + describe_(n.tx) + newAccountsNote_(created),
  };
}

function commitCorrect_(a) {
  const sh = sheet_('transactions');
  const r = findRowById_(sh, a.id);
  if (r < 0) return '⚠️ Transaksinya sudah tidak ada, tidak ada yang diubah.';
  createAccounts_(a.newAccounts);
  const t = a.tx;
  sh.getRange(r, 2, 1, 7).setValues([[
    Utilities.parseDate(t.date, TZ, 'yyyy-MM-dd'), t.amount, t.type, t.category, t.account, t.merchant, t.note,
  ]]);
  sh.getRange(r, 11).setValue(t.to_account);
  return '✅ Diubah!\n\n' + describe_(t) + budgetWarnings_([t]);
}

// ---- Delete ----------------------------------------------------------------------------------------------

// "Hapus yang tadi" removes everything the latest message logged: trailing rows that share the same created_at.
function prepareDeleteLast_() {
  const sh = sheet_('transactions');
  const last = sh.getLastRow();
  if (last < 2) return { reply: 'Belum ada transaksi untuk dihapus 🤖' };

  const rows = sh.getRange(2, 1, last - 1, SHEET_HEADERS.length).getValues();
  const stamp = rows[rows.length - 1][9];
  let first = rows.length - 1;
  if (stamp instanceof Date) {
    while (first > 0 && rows[first - 1][9] instanceof Date && rows[first - 1][9].getTime() === stamp.getTime()) first--;
  }
  return deleteAction_(rows.slice(first).map(rowToTx_));
}

// Ids are shown by /terakhir.
function prepareDeleteById_(id) {
  const sh = sheet_('transactions');
  const r = findRowById_(sh, id);
  if (r < 0) return { reply: 'ID ' + id + ' tidak ditemukan 🔍 Lihat /terakhir.' };
  return deleteAction_([rowToTx_(sh.getRange(r, 1, 1, SHEET_HEADERS.length).getValues()[0])]);
}

function deleteAction_(txs) {
  return {
    action: { kind: 'delete', ids: txs.map(function (t) { return t.id; }), txs: txs },
    preview: '🗑️ Hapus ' + (txs.length > 1 ? txs.length + ' transaksi' : 'ini') + '?\n\n' + txs.map(describe_).join('\n'),
  };
}

// Balances and summaries are computed from the rows, so they follow automatically.
function commitDelete_(a) {
  const sh = sheet_('transactions');
  let removed = 0;
  a.ids.forEach(function (id) {
    const r = findRowById_(sh, id);
    if (r > 0) {
      sh.deleteRow(r);
      removed++;
    }
  });
  if (!removed) return '⚠️ Transaksinya sudah tidak ada.';
  return '🗑️ ' + line_('deleted') + '\n\n' + a.txs.map(describe_).join('\n');
}

// ---- Read-only -------------------------------------------------------------------------------------------

function readTransactions_() {
  const sh = sheet_('transactions');
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, SHEET_HEADERS.length).getValues().map(rowToTx_);
}

function recentReply_(n) {
  const count = Math.min(Math.max(Number(n) || 5, 1), 20);
  const sh = sheet_('transactions');
  const last = sh.getLastRow();
  if (last < 2) return 'Belum ada transaksi 🤖';
  const start = Math.max(2, last - count + 1);
  const rows = sh.getRange(start, 1, last - start + 1, SHEET_HEADERS.length).getValues();
  return '🧾 ' + (last - start + 1) + ' transaksi terakhir:\n\n' + rows.reverse().map(function (r) {
    const t = rowToTx_(r);
    return describe_(t) + ' · #' + t.id;
  }).join('\n');
}

// Balance = opening balance + income - expense - saving, with transfers moving money between accounts.
// Only accounts listed in the accounts tab are tracked; rows without an account do not affect any balance.
function accountBalances_(ctx, rows) {
  const bal = {};
  ctx.accounts.forEach(function (a) { bal[a.name] = a.opening; });
  const move = function (name, delta) {
    const key = matchAccount_(name, ctx.accounts);
    if (key) bal[key] += delta;
  };
  (rows || readTransactions_()).forEach(function (r) {
    if (r.type === 'income') {
      move(r.account, r.amount);
    } else if (r.type === 'expense' || r.type === 'saving') {
      move(r.account, -r.amount);
    } else if (r.type === 'transfer') {
      move(r.account, -r.amount);
      move(r.to_account, r.amount);
    }
  });
  return bal;
}

// All accounts grouped by kind, one account, one kind, or Tabungan ("berapa tabunganku": see tabunganAccounts_).
function balanceReply_(ctx, onlyAccount, onlyKind) {
  if (!ctx.accounts.length) {
    return 'Belum ada akun 🏦 Tambah dengan /akun BNI 1,5jt, atau sebut akun saat mencatat.';
  }
  const bal = accountBalances_(ctx);

  if (onlyAccount) {
    const key = matchAccount_(onlyAccount, ctx.accounts);
    if (!key) return 'Akun "' + onlyAccount + '" belum ada. Tambah dengan /akun ' + onlyAccount + ' <saldo awal>.';
    return '🏦 Saldo ' + key + ': ' + rupiah_(bal[key]);
  }

  const tabungan = onlyKind === 'tabungan';
  const groups = {};
  (tabungan ? tabunganAccounts_(ctx) : ctx.accounts).forEach(function (a) {
    const k = ACCOUNT_KINDS.indexOf(a.kind) >= 0 ? a.kind : 'lainnya';
    (groups[k] = groups[k] || []).push(a.name);
  });
  if (tabungan && !Object.keys(groups).length) {
    return 'Belum ada akun bank atau cash 🪙 Tambah dengan /akun BCA 5jt.';
  }
  if (onlyKind && !tabungan && !groups[onlyKind]) {
    return 'Belum ada akun jenis ' + onlyKind + ' 🏷️ Tandai dengan /akun <nama> ' + onlyKind + ', mis. /akun Bibit investasi';
  }
  const kinds = onlyKind && !tabungan ? [onlyKind] : ACCOUNT_KINDS.filter(function (k) { return groups[k]; });

  let total = 0;
  const blocks = kinds.map(function (k) {
    const names = groups[k].sort();
    const sub = names.reduce(function (s, n) { return s + bal[n]; }, 0);
    total += sub;
    return KIND_LABEL[k] + ': ' + rupiah_(sub) + '\n' +
      names.map(function (n) { return '└ ' + n + ' ' + rupiah_(bal[n]); }).join('\n');
  });
  const title = tabungan ? '🪙 Tabungan kamu sekarang' : onlyKind ? KIND_LABEL[onlyKind] + ' kamu sekarang' : '💰 Saldo akun';
  return title + ':\n\n' + blocks.join('\n\n') + (kinds.length > 1 ? '\n\n💰 Total: ' + rupiah_(total) : '') +
    '\n(saldo awal + transaksi yang tercatat' + (tabungan ? ', tanpa investasi dan e-wallet' : '') + ')';
}

// Weeks run Monday to Sunday.
function periodRange_(period) {
  const to = todayStr_();
  if (period === 'all') return { from: '0000-01-01', to: to, label: 'sampai sekarang' };
  if (period === 'today') return { from: to, to: to, label: 'hari ini' };
  if (period === 'month') return { from: to.slice(0, 8) + '01', to: to, label: 'bulan ini' };
  if (period === 'week') {
    const d = Utilities.parseDate(to, TZ, 'yyyy-MM-dd');
    const dow = Number(Utilities.formatDate(d, TZ, 'u')); // 1 = Monday
    const from = Utilities.formatDate(new Date(d.getTime() - (dow - 1) * 86400000), TZ, 'yyyy-MM-dd');
    return { from: from, to: to, label: 'minggu ini' };
  }
  return null;
}

// Totals for a set of rows, shared by questions and scheduled reports so both always agree.
// kept ("sisa") = income - expense: what was kept (or overspent) in the period. Only income and expense rows count;
// transfers and saving-type rows just move money around.
function sumRows_(rows) {
  const sum = { expense: 0, income: 0, byCat: {} };
  rows.forEach(function (r) {
    if (r.type !== 'expense' && r.type !== 'income') return;
    sum[r.type] += r.amount;
    if (r.type === 'expense') sum.byCat[r.category] = (sum.byCat[r.category] || 0) + r.amount;
  });
  sum.kept = sum.income - sum.expense;
  return sum;
}

// "Tabungan" = the money I hold: every account except investasi and e-wallets.
const NOT_TABUNGAN = ['investasi', 'ewallet'];

function tabunganAccounts_(ctx) {
  return ctx.accounts.filter(function (a) { return NOT_TABUNGAN.indexOf(a.kind) < 0; });
}

// Tabungan total (as of the given rows, default all), or null when there are no such accounts.
function tabunganTotal_(ctx, rows) {
  const accounts = tabunganAccounts_(ctx);
  if (!accounts.length) return null;
  const bal = accountBalances_(ctx, rows);
  return accounts.reduce(function (t, a) { return t + bal[a.name]; }, 0);
}

// Savings rate = (income - expense) / income. "Saving" and "balance" questions both answer with sisa
// (income - expense), so there is only one number called sisa.
// No period means this month; "sekarang"/"total"/"selama ini" arrive as period "all".
function answerQuery_(q, ctx) {
  if (!q) return 'Pertanyaan tidak jelas. Contoh: "pengeluaran minggu ini?".';
  if (q.metric === 'account_balance') return balanceReply_(ctx, q.account, q.account_kind);
  if (q.metric === 'recent') return recentReply_(q.limit);

  const range = periodRange_(q.period || 'month');
  if (!range) return 'Periode itu belum didukung 🤖 Coba: hari ini, minggu ini, bulan ini, atau sampai sekarang.';

  // Filters: category exact, account by name (any case), merchant as a substring ("gofood" matches "GoFood Sate").
  const filters = [];
  let rows = readTransactions_().filter(function (r) { return r.date >= range.from && r.date <= range.to; });
  if (q.category) {
    rows = rows.filter(function (r) { return r.category.toLowerCase() === String(q.category).toLowerCase(); });
    filters.push(q.category);
  }
  if (q.account) {
    const account = matchAccount_(q.account, ctx.accounts) || q.account;
    rows = rows.filter(function (r) { return r.account.toLowerCase() === account.toLowerCase(); });
    filters.push('pakai ' + account);
  }
  if (q.merchant) {
    const merchant = String(q.merchant).toLowerCase();
    rows = rows.filter(function (r) { return r.merchant.toLowerCase().indexOf(merchant) >= 0; });
    filters.push('di ' + q.merchant);
  }

  const sum = sumRows_(rows);
  const byCat = sum.byCat;

  const label = range.label + (filters.length ? ' (' + filters.join(', ') + ')' : '');
  switch (q.metric) {
    case 'income':
      return 'Pemasukan ' + label + ': ' + rupiah_(sum.income);
    case 'saving':
    case 'balance':
      return 'Sisa ' + label + ': ' + rupiah_(sum.kept) +
        '\n(pemasukan ' + rupiah_(sum.income) + ' − pengeluaran ' + rupiah_(sum.expense) + ')';
    case 'savings_rate':
      if (sum.income <= 0) return 'Belum ada pemasukan ' + label + ', savings rate belum bisa dihitung.';
      return 'Savings rate ' + label + ': ' + ((sum.income - sum.expense) / sum.income * 100).toFixed(1) + '%' +
        '\n(pemasukan ' + rupiah_(sum.income) + ', pengeluaran ' + rupiah_(sum.expense) + ')';
    default: {
      let out = 'Pengeluaran ' + label + ': ' + rupiah_(sum.expense);
      if (filters.length) {
        const n = rows.filter(function (r) { return r.type === 'expense'; }).length;
        out += ' (' + n + ' transaksi)';
      }
      const top = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).slice(0, 3);
      if (!q.category && !q.merchant && top.length) {
        out += '\nTerbesar: ' + top.map(function (c) { return c + ' ' + rupiah_(byCat[c]); }).join(', ');
      }
      return out;
    }
  }
}
