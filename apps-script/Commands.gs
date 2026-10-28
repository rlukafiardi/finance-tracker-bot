// Slash commands. Handled in code, so they never call Gemini and cost no quota.
// Commands that change data return { action, preview } and wait for ✅/❌ (see Confirm.gs).

const HELP_TEXT = [
  '🤖 BEEP BOOP. Finance Bot v1.2 online.',
  'Ketik bebas, saya yang mengerti. 💸',
  '',
  '📝 CATAT',
  '› makan siang 35rb gofood',
  '› gaji 15jt masuk bca',
  '› tap lrt 17k pake gopay',
  '› top up gopay pake bni 200k',
  '› nabung 2jt dari bca ke bibit',
  '',
  '🛠 PERBAIKI',
  '› ubah yang tadi jadi 40rb',
  '› hapus yang tadi',
  '› hapus transaksi a1b2c3d4',
  '',
  '📊 TANYA',
  '› pengeluaran minggu ini?',
  '› savings rate bulan ini?',
  '› saldo semua akun? · saldo gopay?',
  '› berapa tabunganku sekarang?',
  '› 5 transaksi terakhir',
  '',
  '⚙️ ATUR',
  '› tambah akun Bibit 5jt investasi',
  '› saldo awal BCA 10jt · BCA itu tabungan',
  '› budget makan 1,5jt · hapus budget makan · status budget?',
  '› kategori apa aja? · tambah kategori Hobi',
  '',
  '⌨️ Jalan pintas (opsional): /saldo /akun /budget /kategori /terakhir /hapus',
  '/whereami: id chat & topic (untuk setup)',
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
  return prepareBudget_(parsed.name, parsed.amount, ctx);
}

// Shared by /budget and chat ("budget makan 1,5jt", "hapus budget makan" = limit 0).
function prepareBudget_(name, limit, ctx) {
  const category = ctx.cats.expense.find(function (c) { return c.toLowerCase() === name.toLowerCase(); });
  if (!category) return 'Kategori "' + name + '" tidak ada di expense. Coba "kategori apa aja?".';
  return {
    action: { kind: 'budget', category: category, limit: limit },
    preview: limit === 0
      ? '🎯 Hapus budget ' + category + '?'
      : '🎯 Atur budget ' + category + ' jadi ' + rupiah_(limit) + ' per bulan?',
  };
}

function commitBudget_(a) {
  setBudget_(a.category, a.limit);
  return a.limit === 0
    ? '✅ Budget ' + a.category + ' dihapus.'
    : '✅ Budget ' + a.category + ': ' + rupiah_(a.limit) + ' per bulan. Saya awasi ya 👀';
}

function categoryCommand_(args, ctx) {
  if (!args.length) return categoryList_(ctx);
  const key = args[0].toLowerCase();
  const type = hasKey_(TYPE_ALIASES, key) ? TYPE_ALIASES[key] : null;
  const name = args.slice(1).join(' ').trim();
  if (!type || !name) return 'Format: /kategori <expense|income|saving> <nama>, mis. /kategori expense Hobi';
  return prepareCategory_(type, name, ctx);
}

function categoryList_(ctx) {
  return '🏷️ Kategori:\n\n' + TYPES.map(function (t) { return t + ': ' + (ctx.cats[t].join(', ') || '-'); }).join('\n');
}

// Shared by /kategori and chat ("tambah kategori Hobi"); chat without a type adds an expense category.
function prepareCategory_(type, name, ctx) {
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

// /akun BNI 1,5jt            -> add the account (kind guessed from the name), or set its opening balance
// /akun Bibit 5jt investasi  -> same, with an explicit kind
// /akun Bibit investasi      -> change only the kind of an existing account
function accountCommand_(args, ctx) {
  if (!args.length) {
    return 'Format: /akun <nama> [saldo awal] [jenis], mis. /akun Bibit 5jt investasi\nJenis: ' + ACCOUNT_KINDS.join(', ');
  }
  const rest = args.slice();
  const jenis = rest.length >= 2 ? parseKind_(rest[rest.length - 1]) : null;
  if (jenis) rest.pop();
  const parsed = splitNameAmount_(rest);
  return prepareAccount_(parsed.name, parsed.amount, jenis, ctx);
}

// Shared by /akun and chat ("tambah akun Bibit 5jt investasi"). opening/jenis null = keep, or 0 / guessed for a
// new account.
function prepareAccount_(name, opening, jenis, ctx) {
  if (!name) return 'Nama akunnya apa? Contoh: tambah akun Bibit 5jt investasi';
  if (name.length > 30) return 'Nama akun terlalu panjang (maks 30 karakter).';
  if (/^[=+\-@]/.test(name)) return 'Nama akun tidak boleh diawali = + - atau @.';

  const known = matchAccount_(name, ctx.accounts);
  if (known) {
    if (opening === null && !jenis) {
      return 'Akun ' + known + ' sudah ada. Sebutkan saldo awal atau jenisnya, mis. "saldo awal ' + known + ' 5jt".';
    }
    const changes = [];
    if (opening !== null) changes.push('saldo awal jadi ' + rupiah_(opening));
    if (jenis) changes.push('jenis jadi ' + KIND_LABEL[jenis]);
    return {
      action: { kind: 'account', name: known, opening: opening, jenis: jenis },
      preview: '🏦 Ubah akun ' + known + ': ' + changes.join(', ') + '?',
    };
  }
  const kind = jenis || guessKind_(name);
  return {
    action: { kind: 'account', name: name, opening: opening || 0, jenis: kind },
    preview: '🆕 Tambah akun ' + name + ' (' + KIND_LABEL[kind] + ') dengan saldo awal ' + rupiah_(opening || 0) + '?' +
      (jenis ? '' : '\nJenis salah? Batalkan lalu sebutkan jenisnya, mis. "tambah akun ' + name + ' tabungan".'),
  };
}

// opening/jenis null = keep the current value.
function commitAccount_(a) {
  const known = matchAccount_(a.name, getAccounts_());
  if (known) {
    if (a.opening !== null) setOpening_(known, a.opening);
    if (a.jenis) setAccountKind_(known, a.jenis);
    return '✅ Akun ' + known + ' diperbarui 🏦';
  }
  const kind = a.jenis || guessKind_(a.name);
  addAccount_(a.name, a.opening || 0, kind);
  return '✅ Akun ' + a.name + ' (' + KIND_LABEL[kind] + ') siap, saldo awal ' + rupiah_(a.opening || 0);
}
