// Google Sheet access: categories, accounts, append, correct last row, balances, summary queries.
// Tabs: `transactions` (SHEET_HEADERS), `categories` (type, category), `accounts` (account, opening_balance).
// `to_account` is the last column so sheets created before transfers existed only need that one header added.

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

// The accounts tab is created on first use, so older sheets keep working without re-running setup().
function accountsSheet_() {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName('accounts');
  if (!sh) {
    sh = ss.insertSheet('accounts');
    sh.getRange(1, 1, 1, 2).setValues([['account', 'opening_balance']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getAccounts_() {
  const sh = spreadsheet_().getSheetByName('accounts');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) { return { name: String(r[0]).trim(), opening: Number(r[1]) || 0 }; });
}

function matchAccount_(name, accounts) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  const hit = accounts.find(function (a) { return a.name.toLowerCase() === key; });
  return hit ? hit.name : null;
}

function addAccount_(name, opening) {
  accountsSheet_().appendRow([name, opening]);
}

function setOpening_(name, opening) {
  const sh = accountsSheet_();
  const names = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < names.length; i++) {
    if (String(names[i][0]).trim().toLowerCase() === name.toLowerCase()) {
      sh.getRange(i + 2, 2).setValue(opening);
      return;
    }
  }
}

// Returns { tx, newAccounts } with a cleaned transaction, or { error } with a reason.
// newAccounts lists account names that are not in ctx.accounts yet (created by the caller after validation).
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

  let account = pickAccount(tx.account || (tx.type === 'transfer' ? '' : optionalProp_('DEFAULT_ACCOUNT')));
  let toAccount = '';
  let category;

  if (tx.type === 'transfer') {
    toAccount = pickAccount(tx.to_account);
    if (!account || !toAccount) return { error: 'transfer butuh akun asal dan tujuan' };
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
    return 'Transfer ' + rupiah_(tx.amount) + ' ' + tx.account + ' -> ' + tx.to_account + ' | ' + tx.date;
  }
  return tx.category + ' ' + rupiah_(tx.amount) + (tx.merchant ? ' (' + tx.merchant + ')' : '') +
    (tx.account ? ' [' + tx.account + ']' : '') + ' | ' + tx.type + ' | ' + tx.date;
}

function newAccountsNote_(created) {
  if (!created.length) return '';
  return '\nAkun baru: ' + created.map(function (n) {
    return n + ' (saldo awal Rp0, atur dengan /akun ' + n + ' <saldo>)';
  }).join(', ');
}

function logTransactions_(txs, raw, ctx, hint) {
  if (!txs.length) return hint || 'Tidak ada transaksi yang terbaca. Coba tulis jumlahnya, mis. "makan 35rb".';

  const clean = [];
  const created = [];
  for (let i = 0; i < txs.length; i++) {
    const n = normalizeTx_(txs[i], ctx);
    if (n.error) return 'Tidak dicatat (' + n.error + '). Coba tulis ulang.';
    clean.push(n.tx);
    n.newAccounts.forEach(function (name) {
      if (!matchAccount_(name, ctx.accounts)) {
        ctx.accounts.push({ name: name, opening: 0 });
        created.push(name);
      }
    });
  }

  created.forEach(function (name) { addAccount_(name, 0); });

  const now = new Date();
  const rows = clean.map(function (t) {
    return [
      Utilities.getUuid().slice(0, 8),
      Utilities.parseDate(t.date, TZ, 'yyyy-MM-dd'),
      t.amount, t.type, t.category, t.account, t.merchant, t.note, raw, now, t.to_account,
    ];
  });
  const sh = sheet_('transactions');
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, SHEET_HEADERS.length).setValues(rows);
  return 'Dicatat:\n' + clean.map(describe_).join('\n') + newAccountsNote_(created);
}

// "Yang tadi" always means the last row of the transactions tab.
function correctLast_(corr, ctx) {
  const sh = sheet_('transactions');
  const last = sh.getLastRow();
  if (last < 2) return 'Belum ada transaksi untuk dikoreksi.';

  const row = sh.getRange(last, 1, 1, SHEET_HEADERS.length).getValues()[0];
  const next = {
    date: fmtDate_(row[1]), amount: row[2], type: row[3], category: row[4],
    account: row[5], merchant: row[6], note: row[7], to_account: row[10],
  };
  let changed = false;
  ['amount', 'category', 'type', 'date', 'account'].forEach(function (k) {
    if (corr && corr[k] !== null && corr[k] !== undefined && corr[k] !== '') {
      next[k] = corr[k];
      changed = true;
    }
  });
  if (!changed) return 'Tidak ada yang diubah. Contoh: "ubah yang tadi jadi 40rb".';

  const n = normalizeTx_(next, ctx);
  if (n.error) return 'Koreksi gagal (' + n.error + ').';
  const t = n.tx;

  const created = [];
  n.newAccounts.forEach(function (name) {
    if (!matchAccount_(name, ctx.accounts)) {
      ctx.accounts.push({ name: name, opening: 0 });
      created.push(name);
    }
  });
  created.forEach(function (name) { addAccount_(name, 0); });

  sh.getRange(last, 2, 1, 7).setValues([[
    Utilities.parseDate(t.date, TZ, 'yyyy-MM-dd'), t.amount, t.type, t.category, t.account, t.merchant, t.note,
  ]]);
  sh.getRange(last, 11).setValue(t.to_account);
  return 'Dikoreksi:\n' + describe_(t) + newAccountsNote_(created);
}

function readTransactions_() {
  const sh = sheet_('transactions');
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, SHEET_HEADERS.length).getValues().map(function (r) {
    return {
      date: fmtDate_(r[1]), amount: Number(r[2]), type: r[3], category: String(r[4]),
      account: String(r[5]), to_account: String(r[10]),
    };
  });
}

// Balance = opening balance + income - expense - saving, with transfers moving money between accounts.
// Only accounts listed in the accounts tab are tracked; rows without an account do not affect any balance.
function balanceReply_(ctx, onlyAccount) {
  if (!ctx.accounts.length) {
    return 'Belum ada akun. Tambah dengan /akun BNI 1,5jt, atau sebut akun saat mencatat.';
  }
  const bal = {};
  ctx.accounts.forEach(function (a) { bal[a.name] = a.opening; });
  const move = function (name, delta) {
    const key = matchAccount_(name, ctx.accounts);
    if (key) bal[key] += delta;
  };
  readTransactions_().forEach(function (r) {
    if (r.type === 'income') {
      move(r.account, r.amount);
    } else if (r.type === 'expense' || r.type === 'saving') {
      move(r.account, -r.amount);
    } else if (r.type === 'transfer') {
      move(r.account, -r.amount);
      move(r.to_account, r.amount);
    }
  });

  if (onlyAccount) {
    const key = matchAccount_(onlyAccount, ctx.accounts);
    if (!key) return 'Akun "' + onlyAccount + '" belum ada. Tambah dengan /akun ' + onlyAccount + ' <saldo awal>.';
    return 'Saldo ' + key + ': ' + rupiah_(bal[key]);
  }
  const names = Object.keys(bal).sort();
  const total = names.reduce(function (s, n) { return s + bal[n]; }, 0);
  return 'Saldo akun:\n' + names.map(function (n) { return n + ': ' + rupiah_(bal[n]); }).join('\n') +
    '\nTotal: ' + rupiah_(total) + '\n(saldo awal + transaksi yang tercatat)';
}

// Weeks run Monday to Sunday.
function periodRange_(period) {
  const to = todayStr_();
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

// Savings rate = (income - expense) / income. Balance (sisa kas) = income - expense - saving.
// Transfers are ignored here: they only move money between accounts.
function answerQuery_(q, ctx) {
  if (!q) return 'Pertanyaan tidak jelas. Contoh: "pengeluaran minggu ini?".';
  if (q.metric === 'account_balance') return balanceReply_(ctx, q.account);

  const range = periodRange_(q.period);
  if (!range) return 'Periode custom belum didukung. Coba: hari ini, minggu ini, atau bulan ini.';

  let rows = readTransactions_().filter(function (r) { return r.date >= range.from && r.date <= range.to; });
  if (q.category) {
    rows = rows.filter(function (r) { return r.category.toLowerCase() === String(q.category).toLowerCase(); });
  }

  const sum = { expense: 0, income: 0, saving: 0 };
  const byCat = {};
  rows.forEach(function (r) {
    if (sum[r.type] === undefined) return;
    sum[r.type] += r.amount;
    if (r.type === 'expense') byCat[r.category] = (byCat[r.category] || 0) + r.amount;
  });

  const label = range.label + (q.category ? ' (' + q.category + ')' : '');
  switch (q.metric) {
    case 'income':
      return 'Pemasukan ' + label + ': ' + rupiah_(sum.income);
    case 'saving':
      return 'Tabungan ' + label + ': ' + rupiah_(sum.saving);
    case 'balance':
      return 'Sisa kas ' + label + ': ' + rupiah_(sum.income - sum.expense - sum.saving) +
        '\n(pemasukan ' + rupiah_(sum.income) + ', pengeluaran ' + rupiah_(sum.expense) +
        ', tabungan ' + rupiah_(sum.saving) + ')';
    case 'savings_rate':
      if (sum.income <= 0) return 'Belum ada pemasukan ' + label + ', savings rate belum bisa dihitung.';
      return 'Savings rate ' + label + ': ' + ((sum.income - sum.expense) / sum.income * 100).toFixed(1) + '%' +
        '\n(pemasukan ' + rupiah_(sum.income) + ', pengeluaran ' + rupiah_(sum.expense) + ')';
    default: {
      let out = 'Pengeluaran ' + label + ': ' + rupiah_(sum.expense);
      const top = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).slice(0, 3);
      if (!q.category && top.length) {
        out += '\nTerbesar: ' + top.map(function (c) { return c + ' ' + rupiah_(byCat[c]); }).join(', ');
      }
      return out;
    }
  }
}
