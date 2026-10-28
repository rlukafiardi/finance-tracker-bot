// Checks the Gemini prompt against known messages. Run runExamples() from the editor and read the log.
// Calls Gemini once per example (paced to stay under free-tier rate limits). Writes nothing to the Sheet.

const EXAMPLES_TODAY = '2026-10-27 (Tuesday)';

const EXAMPLES = [
  { message: 'makan siang 35rb gofood', expect: { intent: 'log', transactions: [{ date: '2026-10-27', amount: 35000, type: 'expense', category: 'Makan', merchant: 'Gofood' }] } },
  { message: 'gaji 15jt masuk bca', expect: { intent: 'log', transactions: [{ date: '2026-10-27', amount: 15000000, type: 'income', category: 'Gaji', account: 'BCA' }] } },
  { message: 'nabung 2jt', expect: { intent: 'log', transactions: [{ date: '2026-10-27', amount: 2000000, type: 'saving', category: 'Tabungan' }] } },
  { message: 'kemarin grab 28k', expect: { intent: 'log', transactions: [{ date: '2026-10-26', amount: 28000, type: 'expense', category: 'Transport', merchant: 'Grab' }] } },
  { message: 'bayar listrik 1,5jt', expect: { intent: 'log', transactions: [{ date: '2026-10-27', amount: 1500000, type: 'expense', category: 'Tagihan' }] } },
  { message: 'kopi 25rb, parkir 5rb', expect: { intent: 'log', transactions: [{ amount: 25000, type: 'expense', category: 'Makan' }, { amount: 5000, type: 'expense', category: 'Transport' }] } },
  { message: 'beli reksadana 500rb', expect: { intent: 'log', transactions: [{ amount: 500000, type: 'saving', category: 'Investasi' }] } },
  { message: 'dapat bonus 3.000.000', expect: { intent: 'log', transactions: [{ amount: 3000000, type: 'income', category: 'Bonus' }] } },
  { message: 'nonton bioskop 60rb pakai gopay', expect: { intent: 'log', transactions: [{ amount: 60000, type: 'expense', category: 'Hiburan', account: 'Gopay' }] } },
  { message: 'ubah yang tadi jadi 40rb', expect: { intent: 'correct', transactions: [], correction: { amount: 40000 } } },
  { message: 'salah, harusnya transport', expect: { intent: 'correct', transactions: [], correction: { category: 'Transport' } } },
  { message: 'pengeluaran minggu ini berapa?', expect: { intent: 'query', transactions: [], query: { metric: 'spending', period: 'week' } } },
  { message: 'savings rate bulan ini?', expect: { intent: 'query', transactions: [], query: { metric: 'savings_rate', period: 'month' } } },
  { message: 'makan di warteg', expect: { intent: 'other', transactions: [] } },
  { message: 'halo', expect: { intent: 'other', transactions: [] } },
  { message: 'top up gopay pake bni 200k', expect: { intent: 'log', transactions: [{ amount: 200000, type: 'transfer', category: 'Transfer', account: 'BNI', to_account: 'GoPay' }] } },
  { message: 'tap lrt 17k pake gopay', expect: { intent: 'log', transactions: [{ amount: 17000, type: 'expense', category: 'Transport', account: 'GoPay', merchant: 'LRT' }] } },
  { message: 'tarik tunai 500rb dari bca', expect: { intent: 'log', transactions: [{ amount: 500000, type: 'transfer', account: 'BCA', to_account: 'Cash' }] } },
  { message: 'saldo gopay berapa?', expect: { intent: 'query', transactions: [], query: { metric: 'account_balance', account: 'GoPay' } } },
  { message: 'salah, pakai bca', expect: { intent: 'correct', transactions: [], correction: { account: 'BCA' } } },
  { message: 'hapus yang tadi', expect: { intent: 'delete', transactions: [] } },
  { message: '5 transaksi terakhir', expect: { intent: 'query', transactions: [], query: { metric: 'recent', limit: 5 } } },
  { message: 'nabung 2jt dari bca ke bibit', expect: { intent: 'log', transactions: [{ amount: 2000000, type: 'transfer', account: 'BCA', to_account: 'Bibit' }] } },
  { message: 'berapa tabunganku sekarang', expect: { intent: 'query', transactions: [], query: { metric: 'account_balance', account_kind: 'tabungan' } } },
  { message: 'investasiku berapa?', expect: { intent: 'query', transactions: [], query: { metric: 'account_balance', account_kind: 'investasi' } } },
  { message: 'tambah akun bibit 5jt investasi', expect: { intent: 'account', transactions: [], account_setup: { name: 'Bibit', opening: 5000000, kind: 'investasi' } } },
  { message: 'saldo awal bca 10jt', expect: { intent: 'account', transactions: [], account_setup: { name: 'BCA', opening: 10000000 } } },
  { message: 'budget makan 1,5jt', expect: { intent: 'budget', transactions: [], budget_setup: { category: 'Makan', limit: 1500000 } } },
  { message: 'status budget bulan ini?', expect: { intent: 'budget', transactions: [], budget_setup: { limit: null } } },
  { message: 'tambah kategori hobi', expect: { intent: 'category', transactions: [], category_setup: { name: 'Hobi' } } },
  { message: 'kategori apa aja?', expect: { intent: 'category', transactions: [], category_setup: { name: null } } },
  { message: 'bisa apa aja?', expect: { intent: 'help', transactions: [] } },
  { message: 'hapus transaksi a1b2c3d4', expect: { intent: 'delete', transactions: [], delete_id: 'a1b2c3d4' } },
  { message: 'saldo semua akun?', expect: { intent: 'query', transactions: [], query: { metric: 'account_balance' } } },
  { message: 'total pengeluaran selama ini', expect: { intent: 'query', transactions: [], query: { metric: 'spending', period: 'all' } } },
];

// Fixed accounts keep the tests independent of what is in the real accounts tab.
const EXAMPLES_ACCOUNTS = [
  { name: 'BNI', opening: 0, kind: 'bank' }, { name: 'GoPay', opening: 0, kind: 'ewallet' },
  { name: 'BCA', opening: 0, kind: 'bank' }, { name: 'Cash', opening: 0, kind: 'cash' },
  { name: 'Bibit', opening: 0, kind: 'investasi' }, { name: 'Tabungan BCA', opening: 0, kind: 'tabungan' },
];

// A missing field and null both mean "not given".
function same_(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

// Compares only the fields listed in `expect`; extra fields in the model output are ignored.
function diff_(expect, got) {
  const problems = [];
  if (!same_(expect.intent, got.intent)) problems.push('intent ' + got.intent + ' != ' + expect.intent);

  const gotTx = got.transactions || [];
  if (gotTx.length !== expect.transactions.length) {
    problems.push('transactions ' + gotTx.length + ' != ' + expect.transactions.length);
  } else {
    expect.transactions.forEach(function (want, i) {
      Object.keys(want).forEach(function (k) {
        if (!same_(want[k], gotTx[i][k])) problems.push('tx' + i + '.' + k + ' ' + gotTx[i][k] + ' != ' + want[k]);
      });
    });
  }
  Object.keys(expect).forEach(function (key) {
    if (key === 'intent' || key === 'transactions') return;
    if (typeof expect[key] !== 'object' || expect[key] === null) {
      if (!same_(expect[key], got[key])) problems.push(key + ' ' + got[key] + ' != ' + expect[key]);
      return;
    }
    Object.keys(expect[key]).forEach(function (k) {
      const value = got[key] ? got[key][k] : undefined;
      if (!same_(expect[key][k], value)) problems.push(key + '.' + k + ' ' + value + ' != ' + expect[key][k]);
    });
  });
  return problems;
}

function runExamples() {
  const ctx = { cats: getCategories_(), accounts: EXAMPLES_ACCOUNTS };
  let pass = 0;
  EXAMPLES.forEach(function (ex, i) {
    let problems;
    try {
      problems = diff_(ex.expect, parseMessage_(ex.message, EXAMPLES_TODAY, ctx));
    } catch (err) {
      problems = ['error: ' + err.message];
    }
    if (problems.length) {
      console.log('FAIL #' + (i + 1) + ' "' + ex.message + '": ' + problems.join('; '));
    } else {
      pass++;
      console.log('PASS #' + (i + 1) + ' "' + ex.message + '"');
    }
    Utilities.sleep(4000);
  });
  console.log(pass + '/' + EXAMPLES.length + ' passed');
}
