// Google Sheet access: categories, append, correct last row, summary queries.
// Tabs: `transactions` (SHEET_HEADERS) and `categories` (type, category).

const SHEET_HEADERS = ['id', 'date', 'amount', 'type', 'category', 'account', 'merchant', 'note', 'raw_message', 'created_at'];
const TYPES = ['expense', 'income', 'saving'];

function sheet_(name) {
  const sh = SpreadsheetApp.openById(prop_('SHEET_ID')).getSheetByName(name);
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
  return 'Rp' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
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

// Returns { tx } with a cleaned transaction, or { error } with a reason.
function normalizeTx_(tx, cats) {
  const amount = Number(tx.amount);
  if (!Number.isInteger(amount) || amount <= 0) return { error: 'jumlah tidak valid' };
  if (TYPES.indexOf(tx.type) < 0) return { error: 'tipe tidak valid' };

  const list = cats[tx.type];
  let category = list.find(function (c) { return c.toLowerCase() === String(tx.category).toLowerCase(); });
  if (!category) category = list.find(function (c) { return c === 'Lainnya'; });
  if (!category) return { error: 'kategori "' + tx.category + '" tidak ada untuk ' + tx.type };

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
      account: tx.account || '',
      merchant: tx.merchant || '',
      note: tx.note || '',
    },
  };
}

function describe_(tx) {
  return tx.category + ' ' + rupiah_(tx.amount) + (tx.merchant ? ' (' + tx.merchant + ')' : '') +
    ' | ' + tx.type + ' | ' + tx.date;
}

function logTransactions_(txs, raw, cats, hint) {
  if (!txs.length) return hint || 'Tidak ada transaksi yang terbaca. Coba tulis jumlahnya, mis. "makan 35rb".';

  const clean = [];
  for (let i = 0; i < txs.length; i++) {
    const n = normalizeTx_(txs[i], cats);
    if (n.error) return 'Tidak dicatat (' + n.error + '). Coba tulis ulang.';
    clean.push(n.tx);
  }

  const now = new Date();
  const rows = clean.map(function (t) {
    return [
      Utilities.getUuid().slice(0, 8),
      Utilities.parseDate(t.date, TZ, 'yyyy-MM-dd'),
      t.amount, t.type, t.category, t.account, t.merchant, t.note, raw, now,
    ];
  });
  const sh = sheet_('transactions');
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, SHEET_HEADERS.length).setValues(rows);
  return 'Dicatat:\n' + clean.map(describe_).join('\n');
}

// "Yang tadi" always means the last row of the transactions tab.
function correctLast_(corr, cats) {
  const sh = sheet_('transactions');
  const last = sh.getLastRow();
  if (last < 2) return 'Belum ada transaksi untuk dikoreksi.';

  const row = sh.getRange(last, 1, 1, SHEET_HEADERS.length).getValues()[0];
  const next = {
    date: fmtDate_(row[1]), amount: row[2], type: row[3], category: row[4],
    account: row[5], merchant: row[6], note: row[7],
  };
  let changed = false;
  ['amount', 'category', 'type', 'date'].forEach(function (k) {
    if (corr && corr[k] !== null && corr[k] !== undefined && corr[k] !== '') {
      next[k] = corr[k];
      changed = true;
    }
  });
  if (!changed) return 'Tidak ada yang diubah. Contoh: "ubah yang tadi jadi 40rb".';

  const n = normalizeTx_(next, cats);
  if (n.error) return 'Koreksi gagal (' + n.error + ').';
  const t = n.tx;
  sh.getRange(last, 2, 1, 7).setValues([[
    Utilities.parseDate(t.date, TZ, 'yyyy-MM-dd'), t.amount, t.type, t.category, t.account, t.merchant, t.note,
  ]]);
  return 'Dikoreksi:\n' + describe_(t);
}

function readTransactions_() {
  const sh = sheet_('transactions');
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, SHEET_HEADERS.length).getValues().map(function (r) {
    return { date: fmtDate_(r[1]), amount: Number(r[2]), type: r[3], category: String(r[4]) };
  });
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
function answerQuery_(q) {
  if (!q) return 'Pertanyaan tidak jelas. Contoh: "pengeluaran minggu ini?".';
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
