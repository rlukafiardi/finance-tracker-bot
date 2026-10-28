// Slash commands. Handled in code, so they never call Gemini and cost no quota.
// Commands that change data return { action, preview } and wait for ✅/❌ (see Confirm.gs).

const HELP_TEXT = [
  '🤖 BEEP BOOP. Finance Bot v1.1 online.',
  'Ketik bebas, saya yang mencatat. 💸',
  '',
  '📝 CATAT',
  '› makan siang 35rb gofood',
  '› gaji 15jt masuk bca',
  '› nabung 2jt',
  '› tap lrt 17k pake gopay',
  '› top up gopay pake bni 200k',
  '',
  '🛠 PERBAIKI',
  '› ubah yang tadi jadi 40rb',
  '› hapus yang tadi',
  '',
  '📊 TANYA',
  '› pengeluaran minggu ini?',
  '› savings rate bulan ini?',
  '› saldo gopay?',
  '› 5 transaksi terakhir',
  '',
  '⚙️ PERINTAH',
  '/saldo  saldo semua akun',
  '/akun BNI 1,5jt  tambah akun / saldo awal',
  '/budget makan 1,5jt  budget bulanan (0 = hapus)',
  '/budget  status budget',
  '/kategori  daftar kategori',
  '/kategori expense Hobi  tambah kategori',
  '/terakhir 10  riwayat + id',
  '/hapus a1b2c3d4  hapus berdasarkan id',
  '',
  '🛡️ Semua yang mengubah data minta konfirmasi ✅/❌ dulu (atau ketik "ya"/"batal").',
  '🔋 Status: siap menghitung setiap rupiah.',
].join('\n');

const TYPE_ALIASES = {
  expense: 'expense', pengeluaran: 'expense', keluar: 'expense',
  income: 'income', pemasukan: 'income', masuk: 'income',
  saving: 'saving', tabungan: 'saving', nabung: 'saving',
};

// "35rb"/"35k" -> 35000, "1,5jt" -> 1500000, "2.500.000" -> 2500000. Returns null if not an amount.
function parseAmount_(s) {
  const m = String(s).trim().toLowerCase().match(/^(\d+(?:[.,]\d+)*)(rb|k|jt)?$/);
  if (!m) return null;
  if (m[2]) {
    const mult = m[2] === 'jt' ? 1000000 : 1000;
    return Math.round(parseFloat(m[1].replace(',', '.')) * mult);
  }
  return parseInt(m[1].replace(/[.,]/g, ''), 10);
}

// Splits "<name words> <amount>" into { name, amount }; amount is null when the last word is not one.
function splitNameAmount_(args) {
  if (args.length >= 2) {
    const value = parseAmount_(args[args.length - 1]);
    if (value !== null) return { name: args.slice(0, -1).join(' ').trim(), amount: value };
  }
  return { name: args.join(' ').trim(), amount: null };
}

function handleCommand_(text, ctx) {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase().replace(/@.*$/, '');
  const args = parts.slice(1);
  switch (cmd) {
    case '/start':
    case '/help':
      return HELP_TEXT;
    case '/saldo':
      return balanceReply_(ctx);
    case '/akun':
      return accountCommand_(args, ctx);
    case '/kategori':
      return categoryCommand_(args, ctx);
    case '/budget':
      return budgetCommand_(args, ctx);
    case '/terakhir':
      return recentReply_(args[0]);
    case '/hapus':
      return args.length ? prepareDeleteById_(args[0].replace(/^#/, '')) : prepareDeleteLast_();
    default:
      return 'Perintah tidak dikenal 🤖 Ketik /help.';
  }
}

// /budget -> status; /budget makan 1,5jt -> set the monthly limit; /budget makan 0 -> remove it
function budgetCommand_(args, ctx) {
  if (!args.length) return '📊 ' + budgetOverview_();
  const parsed = splitNameAmount_(args);
  if (parsed.amount === null) return 'Format: /budget <kategori> <jumlah per bulan>, mis. /budget makan 1,5jt';

  const category = ctx.cats.expense.find(function (c) { return c.toLowerCase() === parsed.name.toLowerCase(); });
  if (!category) return 'Kategori "' + parsed.name + '" tidak ada di expense. Lihat /kategori.';
  return {
    action: { kind: 'budget', category: category, limit: parsed.amount },
    preview: parsed.amount === 0
      ? '🎯 Hapus budget ' + category + '?'
      : '🎯 Atur budget ' + category + ' jadi ' + rupiah_(parsed.amount) + ' per bulan?',
  };
}

function commitBudget_(a) {
  setBudget_(a.category, a.limit);
  return a.limit === 0
    ? '✅ Budget ' + a.category + ' dihapus.'
    : '✅ Budget ' + a.category + ': ' + rupiah_(a.limit) + ' per bulan. Saya awasi ya 👀';
}

function categoryCommand_(args, ctx) {
  if (!args.length) {
    return '🏷️ Kategori:\n\n' + TYPES.map(function (t) { return t + ': ' + (ctx.cats[t].join(', ') || '-'); }).join('\n');
  }
  const key = args[0].toLowerCase();
  const type = Object.prototype.hasOwnProperty.call(TYPE_ALIASES, key) ? TYPE_ALIASES[key] : null;
  const name = args.slice(1).join(' ').trim();
  if (!type || !name) return 'Format: /kategori <expense|income|saving> <nama>, mis. /kategori expense Hobi';
  if (name.length > 30) return 'Nama kategori terlalu panjang (maks 30 karakter).';
  if (/^[=+\-@]/.test(name)) return 'Nama kategori tidak boleh diawali = + - atau @.';

  const label = name.charAt(0).toUpperCase() + name.slice(1);
  const exists = ctx.cats[type].some(function (c) { return c.toLowerCase() === label.toLowerCase(); });
  if (exists) return 'Kategori ' + label + ' sudah ada untuk ' + type + ' 👍';
  return {
    action: { kind: 'category', type: type, label: label },
    preview: '🏷️ Tambah kategori ' + label + ' (' + type + ')?',
  };
}

function commitCategory_(a) {
  const exists = getCategories_()[a.type].some(function (c) { return c.toLowerCase() === a.label.toLowerCase(); });
  if (!exists) sheet_('categories').appendRow([a.type, a.label]);
  return '✅ Kategori ' + a.label + ' (' + a.type + ') siap dipakai!';
}

// /akun BNI 1,5jt  -> add the account, or set its opening balance if it exists
// /akun Bank Jago  -> add the account with opening balance 0
function accountCommand_(args, ctx) {
  if (!args.length) return 'Format: /akun <nama> [saldo awal], mis. /akun BNI 1,5jt';
  const parsed = splitNameAmount_(args);
  if (parsed.name.length > 30) return 'Nama akun terlalu panjang (maks 30 karakter).';
  if (/^[=+\-@]/.test(parsed.name)) return 'Nama akun tidak boleh diawali = + - atau @.';

  const known = matchAccount_(parsed.name, ctx.accounts);
  if (known && parsed.amount === null) return 'Akun ' + known + ' sudah ada. Atur saldo awal: /akun ' + known + ' <saldo>';
  const opening = parsed.amount || 0;
  return {
    action: { kind: 'account', name: known || parsed.name, opening: opening },
    preview: known
      ? '🏦 Atur saldo awal ' + known + ' jadi ' + rupiah_(opening) + '?'
      : '🆕 Tambah akun ' + parsed.name + ' dengan saldo awal ' + rupiah_(opening) + '?',
  };
}

function commitAccount_(a) {
  const known = matchAccount_(a.name, getAccounts_());
  if (known) setOpening_(known, a.opening);
  else addAccount_(a.name, a.opening);
  return '✅ Akun ' + (known || a.name) + ' siap, saldo awal ' + rupiah_(a.opening) + ' 🏦';
}
