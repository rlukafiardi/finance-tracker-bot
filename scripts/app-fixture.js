// Loads every .gs file into one vm (Apps Script services stubbed, dates in UTC) plus made-up sample data.
// No real transactions are used anywhere in the tests.
const fs = require('fs');
const vm = require('vm');

function loadApp() {
  let VMDate; // dates made by the stubs must come from the vm's own Date, or `instanceof Date` in the .gs code is false
  const iso = (d) => d.toISOString().slice(0, 10);
  const ctx = {
    Utilities: {
      parseDate: (s) => new VMDate(s + 'T00:00:00Z'),
      getUuid: (() => { let n = 0; return () => (++n).toString(16).padStart(8, '0') + '-0000-4000-8000-000000000000'; })(),
      formatDate: (d, tz, fmt) => (fmt === 'yyyy-MM-dd' ? iso(d) : fmt === 'u' ? String((d.getUTCDay() + 6) % 7 + 1) : iso(d)),
    },
  };
  vm.createContext(ctx);
  VMDate = vm.runInContext('Date', ctx);
  ctx.VMDate = VMDate;
  const src = fs.readdirSync('apps-script').filter((f) => f.endsWith('.gs')).sort()
    .map((f) => fs.readFileSync('apps-script/' + f, 'utf8')).join('\n');
  vm.runInContext(src, ctx);
  return ctx;
}

const tx = (id, date, amount, type, category, account, merchant = '', note = '', to_account = '') =>
  ({ id: String(id), date, amount, type, category, account, merchant, note, to_account });

// Today in the tests is 2026-11-14. October is the month with boundary rows (31 Oct, 1 Nov) and a transfer.
const accounts = [
  { name: 'BNI', opening: 1000000, kind: 'bank' },
  { name: 'BCA', opening: 500000, kind: 'bank' },
  { name: 'ShopeePay', opening: 100000, kind: 'ewallet' },
];
const ledger = [
  tx(1, '2026-09-28', 9000000, 'income', 'Gaji', 'BNI', 'Kantor', 'gaji september'),
  tx(2, '2026-10-01', 50000, 'expense', 'Makan', 'BNI', 'Warung A'),
  tx(3, '2026-10-15', 200000, 'expense', 'Transport', 'BNI', 'Grab'),
  tx(4, '2026-10-20', 300000, 'transfer', '', 'BNI', '', '', 'ShopeePay'),
  tx(5, '2026-10-25', 10000000, 'income', 'Gaji', 'BNI', 'Kantor', 'gaji oktober'),
  tx(6, '2026-10-31', 120000, 'expense', 'Makan', 'BNI', 'Kopi <b>X</b>', '</script><i>'),
  tx(7, '2026-11-01', 999000, 'expense', 'Belanja', 'BNI', 'Toko B'),
  tx(8, '2026-11-10', 40000, 'expense', 'Makan', 'ShopeePay', 'Warung C'),
];
const budgets = [{ category: 'Makan', limit: 150000 }];
const today = '2026-11-14';

const kpi = (label, value, arrow, text, good) => ({ label, value, delta: { arrow, text, good } });

// Page-level sample for the layout tests (shape of dashboardData_ + view).
const sample = {
  title: 'November 2026',
  kpis: [
    kpi('PENGELUARAN', 'Rp 4,2 jt', '▲', '12% vs bulan lalu', false),
    kpi('PEMASUKAN', 'Rp 9 jt', '▲', '3% vs bulan lalu', true),
    kpi('TABUNGAN SEKARANG', 'Rp 21,5 jt', '▲', 'Rp 2,1 jt sejak awal bulan', true),
  ],
  cats: { unit: { div: 1e3, label: 'ribu' },
    rows: [['Makan', 1650], ['Transport', 820], ['Belanja', 640], ['Tagihan', 480], ['Hiburan', 310], ['Lain-lain', 300]] },
  trend: { unit: { div: 1e6, label: 'juta' }, rows: [['Jun 2026', 8, 5, 18], ['Jul 2026', 8, 6.5, 19.5], ['Agu 2026', 9, 4, 24],
    ['Sep 2026', 9, 7, 26], ['Okt 2026', 10, 6, 30], ['Nov 2026', 9, 4.2, 21.5]] },
  weekly: { unit: { div: 1e3, label: 'ribu' },
    rows: [['6 Okt', 900], ['13 Okt', 1100], ['20 Okt', 760], ['27 Okt', 1300], ['3 Nov', 980], ['10 Nov', 1450]] },
  budgets: [{ category: 'Makan', spent: 1650000, limit: 2000000, pct: 83 },
    { category: 'Hiburan', spent: 310000, limit: 300000, pct: 103 },
    { category: 'Transport', spent: 820000, limit: 1500000, pct: 55 }],
  accounts: [{ name: '🏦 BNI', balance: 12345678 }, { name: '🏦 BCA', balance: 8200000 }, { name: '👛 ShopeePay', balance: 154000 }],
  total: 20699678,
};

function sampleRows(n) {
  const cats = ['Makan', 'Transport', 'Belanja', 'Hiburan'];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const day = String(1 + (i % 14)).padStart(2, '0');
    rows.push(tx(100 + i, `2026-11-${day}`, 10000 + i * 1000, 'expense', cats[i % 4], i % 2 ? 'BNI' : 'BCA',
      i === 0 ? 'Warung dengan nama toko yang sangat panjang sekali sampai harus pindah baris di layar kecil' : 'Toko ' + i));
  }
  rows.push(tx(900, '2026-11-12', 5000000, 'income', 'Gaji', 'BNI', 'Kantor'));
  rows.push(tx(901, '2026-11-13', 300000, 'transfer', '', 'BNI', '', '', 'ShopeePay'));
  return rows;
}

const nav = { base: 'https://example.test/exec', token: 'tok en&1' };
const viewOf = (rows) => ({ month: '2026-11', months: ['2026-11', '2026-10', '2026-09'], current: true, rows, today: '2026-11-14' });

module.exports = { loadApp, sample, sampleRows, nav, viewOf, ledger, accounts, budgets, today, tx };
