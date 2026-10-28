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
  { message: 'ganti kategorinya jadi parkir motor', expect: { intent: 'correct', transactions: [], correction: { category: 'Parkir motor' } } },
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
  { message: 'ganti nama akun bca jadi bca utama', expect: { intent: 'account', transactions: [], account_setup: { name: 'BCA', rename_to: 'BCA Utama' } } },
  { message: 'saldo awal bca 10jt', expect: { intent: 'account', transactions: [], account_setup: { name: 'BCA', opening: 10000000 } } },
  { message: 'budget makan 1,5jt', expect: { intent: 'budget', transactions: [], budget_setup: { category: 'Makan', limit: 1500000 } } },
  { message: 'status budget bulan ini?', expect: { intent: 'budget', transactions: [], budget_setup: { limit: null } } },
  { message: 'tambah kategori hobi', expect: { intent: 'category', transactions: [], category_setup: { name: 'Hobi' } } },
  { message: 'kategori apa aja?', expect: { intent: 'category', transactions: [], category_setup: { name: null } } },
  { message: 'bisa apa aja?', expect: { intent: 'help', transactions: [] } },
  { message: 'hapus transaksi a1b2c3d4', expect: { intent: 'delete', transactions: [], delete_id: 'a1b2c3d4' } },
  { message: 'saldo per akun', expect: { intent: 'query', transactions: [], query: { metric: 'account_balance' } } },
  { message: 'sisa uang bulan ini?', expect: { intent: 'query', transactions: [], query: { metric: 'balance', period: 'month' } } },
  { message: 'saldo semua akun?', expect: { intent: 'query', transactions: [], query: { metric: 'account_balance' } } },
  { message: 'total pengeluaran selama ini', expect: { intent: 'query', transactions: [], query: { metric: 'spending', period: 'all' } } },
  { message: 'berapa total gofood bulan ini?', expect: { intent: 'query', transactions: [], query: { metric: 'spending', period: 'month', merchant: 'Gofood' } } },
  { message: 'pengeluaran pake gopay minggu ini?', expect: { intent: 'query', transactions: [], query: { metric: 'spending', period: 'week', account: 'GoPay' } } },
  { message: 'ubah a1b2c3d4 jadi 40rb', expect: { intent: 'correct', transactions: [], correction: { id: 'a1b2c3d4', amount: 40000 } } },
  { message: 'transaksi a1b2c3d4 harusnya transport', expect: { intent: 'correct', transactions: [], correction: { id: 'a1b2c3d4', category: 'Transport' } } },
  { message: 'transfer bca ke bni 1jt admin 2,5rb', expect: { intent: 'log', transactions: [{ amount: 1000000, type: 'transfer', account: 'BCA', to_account: 'BNI' }, { amount: 2500, type: 'expense', account: 'BCA' }] } },
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

// ---- Email parsers: text copied from real notifications, with the name replaced and numbers masked ----------

const EMAIL_FIXTURES = {
  bniQris: [
    'Transaksi berhasil! ', ' Hai, TEST USER',
    ' Terima kasih udah bertransaksi dengan wondr by BNI! Kamu baru aja bayar pakai QRIS dengan detail sebagai berikut:',
    ' Penerima ', ' Apfin ', ' Kota Jakarta Ti, 13860, ID ', ' Sumber dana ', ' TEST USER ', ' TAPLUS • *******002 ',
    ' Tanggal & waktu transaksi ', ' Tanggal 28 Okt 2026 ', ' Waktu 19:41:38 WIB ', ' Detail pembayaran ',
    ' Nominal Rp17.000 ', ' Total Rp17.000 ', ' Jenis transaksi QRIS ',
  ].join('\n'),
  bniTopup: [
    'Top-up berhasil! ', ' Hai, TEST USER',
    ' Terima kasih udah memilih wondr by BNI untuk transaksi kamu! Kamu baru aja top-up e-Wallet dengan detail sebagai berikut:',
    ' Penerima ', ' TEST USER ', ' GoPay • 62*******1169 ', ' Sumber dana ', ' TEST USER ', ' TAPLUS • *******002 ',
    ' Tanggal & waktu top-up ', ' Tanggal 28 Oktober 2026 ', ' Waktu 15:22:41 WIB ', ' Detail top-up ',
    ' Nominal Rp200.000 ', ' Biaya transaksi Rp1.000 ', ' Total Rp201.000 ',
  ].join('\n'),
  bniTopupShopee: [
    'Top-up berhasil! ', ' Hai, TEST USER',
    ' Terima kasih udah memilih wondr by BNI untuk transaksi kamu! Kamu baru aja top-up e-Wallet dengan detail sebagai berikut:',
    ' Penerima ', ' TEST USER ', ' ShopeePay • 62*******1169 ', ' Sumber dana ', ' TEST USER ', ' TAPLUS • *******002 ',
    ' Tanggal & waktu top-up ', ' Tanggal 28 Oktober 2026 ', ' Waktu 15:22:41 WIB ', ' Detail top-up ',
    ' Nominal Rp10.000 ', ' Total Rp10.000 ',
  ].join('\n'),
  bniPln: [
    'Transaksi berhasil! ', 'Hai TEST USER,',
    ' Terima kasih udah memilih wondr by BNI untuk transaksi kamu! Kamu baru aja transaksi dengan detail sebagai berikut:',
    ' Tujuan ', ' Listrik ', ' PLN Token Listrik • 53********80 ', ' Sumber dana ', ' TEST USER ', ' TAPLUS • *******002 ',
    ' Tanggal 23 Oktober 2026 ', ' Waktu 03:38:05 WIB ', ' Detail transaksi ', ' No meter 56*******26 ',
    ' Rp Bayar Rp203.500 ', ' PPN Rp 0,00 ', ' Admin bank Rp3.500 ', ' Total Rp203.500,00 ',
  ].join('\n'),
  bniVa: [
    'Transaksi berhasil! ', 'Hai, TEST USER',
    ' Terima kasih sudah bertransaksi dengan wondr by BNI! Kamu baru aja melakukan pembayaran pakai Virtual Account dengan detail sebagai berikut:',
    ' Tujuan ', ' SHOPEE-r123456789/Dxx ', ' 88************69 ', ' Sumber dana ', ' TEST USER ', ' TAPLUS • *******002 ',
    ' Tanggal 09-Okt-2026 ', ' Waktu 07:55 WIB ', ' Detail transaksi ', ' Nominal Rp408.028 ', ' Biaya admin Rp0 ',
    ' Total Rp408.028 ',
  ].join('\n'),
  bniTransferOwn: [
    'Transfer berhasil! ', 'Hai, TEST USER',
    ' Terima kasih sudah bertransaksi dengan wondr by BNI! Kamu baru aja transfer uang dengan detail sebagai berikut:',
    ' Penerima ', ' TEST USER ', ' BCA • 12*****89 ', ' Sumber dana ', ' TEST USER ', ' TAPLUS • *******002 ',
    ' Tanggal 27-Okt-2026 ', ' Waktu 16:53:40 WIB ', ' Nominal Rp700.000 ', ' Biaya admin Rp0 ', ' Total Rp700.000 ',
  ].join('\n'),
  bniTransferOther: [
    'Transfer berhasil! ', 'Hai, TEST USER',
    ' Terima kasih sudah bertransaksi dengan wondr by BNI! Kamu baru aja transfer uang dengan detail sebagai berikut:',
    ' Penerima ', ' ANDI TEST - ', ' Mandiri • 25*****79 ', ' Sumber dana ', ' TEST USER ', ' TAPLUS • *******002 ',
    ' Tanggal 27-Okt-2026 ', ' Waktu 16:53:40 WIB ', ' Nominal Rp50.000 ', ' Biaya admin Rp2.500 ', ' Total Rp52.500 ',
  ].join('\n'),
  bcaTransferOwn: [
    'Hello TEST USER,', ' You just made a transaction through myBCA.', ' Status ', ' : ', ' Successful ',
    ' Transaction Date ', ' : ', ' 08 Oct 2026 10:06:03 ', ' Transfer Type ', ' : ', ' Transfer to BNI ',
    ' Source of Fund ', ' : ', ' 8780xxxx16 ', ' Beneficiary Account ', ' Beneficiary Name ', ' : ', ' TEST USER ',
    ' Beneficiary Bank ', ' : ', ' BNI ', ' Amount ', ' : ', ' IDR 900,000.00 ', ' Fee ', ' : ', ' IDR 2,500.00 ',
    ' Transfer Method ', ' : ', ' BI FAST ',
  ].join('\n'),
  bcaTransferOther: [
    'Hello TEST USER,', ' Status ', ' : ', ' Successful ', ' Transaction Date ', ' : ', ' 08 Oct 2026 10:06:03 ',
    ' Transfer Type ', ' : ', ' Transfer to BNI ', ' Beneficiary Name ', ' : ', ' ANDI TEST ',
    ' Beneficiary Bank ', ' : ', ' BNI ', ' Amount ', ' : ', ' IDR 50,000.00 ', ' Fee ', ' : ', ' IDR 0.00 ',
  ].join('\n'),
  bniOther: [
    'Transaksi berhasil! ', ' Hai, TEST USER',
    ' Terima kasih! Kamu baru aja transfer ke rekening lain dengan detail sebagai berikut:',
    ' Penerima ', ' SOMEONE ', ' Tanggal 28 Okt 2026 ', ' Nominal Rp50.000 ', ' Total Rp56.500 ',
  ].join('\n'),
  bcaQris: [
    'Hello TEST USER,', ' You just made a transaction through myBCA.', ' Status ', ' : ', ' Successful ',
    ' Transaction Date ', ' : ', ' 23 Oct 2026 16:16:29 ', ' Transaction Type ', ' : ', ' QRIS Payment ',
    ' Payment to ', ' : ', ' Social Brew Coffee ', ' Source of Fund ', ' : ', ' TAHAPAN - 8780****16 ',
    ' Total Payment ', ' : ', ' IDR 330,000.00 ',
  ].join('\n'),
  bcaTransfer: [
    'Hello TEST USER,', ' Status ', ' : ', ' Successful ', ' Transaction Date ', ' : ', ' 23 Oct 2026 16:16:29 ',
    ' Transaction Type ', ' : ', ' Transfer to BCA Account ', ' Total Payment ', ' : ', ' IDR 100,000.00 ',
  ].join('\n'),
};

function runEmailTests() {
  const cases = [
    ['BNI', 'bniQris', { txs: [{ date: '2026-10-28', amount: 17000, type: 'expense', account: 'BNI', merchant: 'Apfin' }] }],
    ['BNI', 'bniTopup', { txs: [
      { date: '2026-10-28', amount: 200000, type: 'transfer', account: 'BNI', to_account: 'GoPay' },
      { date: '2026-10-28', amount: 1000, type: 'expense', account: 'BNI', category: 'Biaya Admin' },
    ] }],
    ['BNI', 'bniTopupShopee', { txs: [
      { date: '2026-10-28', amount: 10000, type: 'transfer', account: 'BNI', to_account: 'ShopeePay' },
      { date: '2026-10-28', amount: 500, type: 'expense', account: 'ShopeePay', category: 'Biaya Admin' },
    ] }],
    ['BNI', 'bniPln', { txs: [{ date: '2026-10-23', amount: 203500, type: 'expense', account: 'BNI', merchant: 'PLN Token Listrik', category: 'Tagihan' }] }],
    ['BNI', 'bniVa', { txs: [{ date: '2026-10-09', amount: 408028, type: 'expense', account: 'BNI', merchant: 'Shopee' }] }],
    ['BNI', 'bniTransferOwn', { txs: [{ date: '2026-10-27', amount: 700000, type: 'transfer', account: 'BNI', to_account: 'BCA' }] }],
    ['BNI', 'bniTransferOther', { txs: [
      { date: '2026-10-27', amount: 50000, type: 'expense', account: 'BNI', merchant: 'ANDI TEST', person: true },
      { date: '2026-10-27', amount: 2500, type: 'expense', account: 'BNI', category: 'Biaya Admin' },
    ] }],
    ['BCA', 'bcaTransferOwn', { txs: [
      { date: '2026-10-08', amount: 900000, type: 'transfer', account: 'BCA', to_account: 'BNI' },
      { date: '2026-10-08', amount: 2500, type: 'expense', account: 'BCA', category: 'Biaya Admin' },
    ] }],
    ['BCA', 'bcaTransferOther', { txs: [{ date: '2026-10-08', amount: 50000, type: 'expense', account: 'BCA', merchant: 'ANDI TEST', person: true }] }],
    ['BNI', 'bniOther', { error: 'belum didukung (transfer ke rekening lain)' }],
    ['BCA', 'bcaQris', { txs: [{ date: '2026-10-23', amount: 330000, type: 'expense', account: 'BCA', merchant: 'Social Brew Coffee' }] }],
    ['BCA', 'bcaTransfer', { error: 'belum didukung (Transfer to BCA Account)' }],
  ];
  let pass = 0;
  cases.forEach(function (c) {
    const got = parseBankEmail_(c[0], EMAIL_FIXTURES[c[1]]);
    const want = c[2];
    const problems = [];
    if (want.error || got.error) {
      if (want.error !== got.error) problems.push('error ' + got.error + ' != ' + want.error);
    } else if (got.txs.length !== want.txs.length) {
      problems.push('txs ' + got.txs.length + ' != ' + want.txs.length);
    } else {
      want.txs.forEach(function (w, i) {
        Object.keys(w).forEach(function (k) {
          if (got.txs[i][k] !== w[k]) problems.push('tx' + i + '.' + k + ' ' + got.txs[i][k] + ' != ' + w[k]);
        });
      });
    }
    console.log((problems.length ? 'FAIL ' : 'PASS ') + c[1] + (problems.length ? ': ' + problems.join('; ') : ''));
    if (!problems.length) pass++;
  });
  console.log(pass + '/' + cases.length + ' passed');
}

// ---- Email import: duplicate check and merchant category lookup ------------------------------------------

function runEmailImportTests() {
  const rows = [
    { type: 'expense', amount: 17000, account: 'BNI', to_account: '', date: '2026-10-28', merchant: 'Apfin', category: 'Makan' },
    { type: 'expense', amount: 17000, account: 'BNI', to_account: '', date: '2026-10-20', merchant: 'Apfin', category: 'Makan' },
    { type: 'expense', amount: 9000, account: 'BNI', to_account: '', date: '2026-10-21', merchant: 'apfin', category: 'Lainnya' },
    { type: 'expense', amount: 5000, account: 'BNI', to_account: '', date: '2026-10-22', merchant: 'Parkir', category: 'Transport' },
    { type: 'transfer', amount: 200000, account: 'BNI', to_account: 'GoPay', date: '2026-10-28', merchant: '', category: 'Transfer' },
  ];
  const tx = function (o) { return Object.assign({ type: 'expense', account: 'BNI', to_account: '', date: '2026-10-28' }, o); };
  const checks = [
    ['same row is a duplicate', isDuplicateTx_(tx({ amount: 17000 }), rows) === true],
    ['one day later is a duplicate', isDuplicateTx_(tx({ amount: 17000, date: '2026-10-29' }), rows) === true],
    ['two days later is new', isDuplicateTx_(tx({ amount: 17000, date: '2026-10-31' }), rows) === false],
    ['other amount is new', isDuplicateTx_(tx({ amount: 18000 }), rows) === false],
    ['other account is new', isDuplicateTx_(tx({ amount: 17000, account: 'BCA' }), rows) === false],
    ['account compare ignores case', isDuplicateTx_(tx({ amount: 17000, account: 'bni' }), rows) === true],
    ['transfer needs the same destination', isDuplicateTx_(tx({ type: 'transfer', amount: 200000, to_account: 'OVO' }), rows) === false],
    ['transfer with same destination', isDuplicateTx_(tx({ type: 'transfer', amount: 200000, to_account: 'gopay' }), rows) === true],
    ['merchant category by most used, ignoring Lainnya and case', lookupMerchantCategory_('APFIN', rows) === 'Makan'],
    ['unknown merchant', lookupMerchantCategory_('Social Brew', rows) === null],
  ];
  let pass = 0;
  checks.forEach(function (c) {
    console.log((c[1] ? 'PASS ' : 'FAIL ') + c[0]);
    if (c[1]) pass++;
  });
  console.log(pass + '/' + checks.length + ' passed');
}
