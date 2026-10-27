// Slash commands. Handled in code, so they never call Gemini and cost no quota.

const HELP_TEXT = [
  'Catat: "makan siang 35rb gofood", "gaji 15jt masuk bca", "nabung 2jt"',
  'Pakai akun: "tap lrt 17k pake gopay"',
  'Transfer antar akun: "top up gopay pake bni 200k"',
  'Koreksi yang terakhir: "ubah yang tadi jadi 40rb", "salah, pakai bca"',
  'Tanya: "pengeluaran minggu ini?", "savings rate bulan ini?", "saldo gopay?"',
  '',
  'Perintah:',
  '/saldo : saldo semua akun',
  '/akun <nama> [saldo awal] : tambah akun atau atur saldo awal, mis. /akun BNI 1,5jt',
  '/kategori : daftar kategori',
  '/kategori <expense|income|saving> <nama> : tambah kategori, mis. /kategori expense Hobi',
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
    default:
      return 'Perintah tidak dikenal. Ketik /help.';
  }
}

function categoryCommand_(args, ctx) {
  if (!args.length) {
    return TYPES.map(function (t) { return t + ': ' + (ctx.cats[t].join(', ') || '-'); }).join('\n');
  }
  const key = args[0].toLowerCase();
  const type = Object.prototype.hasOwnProperty.call(TYPE_ALIASES, key) ? TYPE_ALIASES[key] : null;
  const name = args.slice(1).join(' ').trim();
  if (!type || !name) return 'Format: /kategori <expense|income|saving> <nama>, mis. /kategori expense Hobi';
  if (name.length > 30) return 'Nama kategori terlalu panjang (maks 30 karakter).';
  if (/^[=+\-@]/.test(name)) return 'Nama kategori tidak boleh diawali = + - atau @.';

  const label = name.charAt(0).toUpperCase() + name.slice(1);
  const exists = ctx.cats[type].some(function (c) { return c.toLowerCase() === label.toLowerCase(); });
  if (exists) return 'Kategori ' + label + ' sudah ada untuk ' + type + '.';

  sheet_('categories').appendRow([type, label]);
  return 'Kategori ditambah: ' + label + ' (' + type + ')';
}

// /akun BNI 1,5jt  -> add account (or set opening balance if it exists)
// /akun Bank Jago  -> add account with opening balance 0
function accountCommand_(args, ctx) {
  if (!args.length) return 'Format: /akun <nama> [saldo awal], mis. /akun BNI 1,5jt';

  let opening = null;
  let nameParts = args;
  if (args.length >= 2) {
    const value = parseAmount_(args[args.length - 1]);
    if (value !== null) {
      opening = value;
      nameParts = args.slice(0, -1);
    }
  }
  const name = nameParts.join(' ').trim();
  if (name.length > 30) return 'Nama akun terlalu panjang (maks 30 karakter).';
  if (/^[=+\-@]/.test(name)) return 'Nama akun tidak boleh diawali = + - atau @.';

  const known = matchAccount_(name, ctx.accounts);
  if (known) {
    if (opening === null) return 'Akun ' + known + ' sudah ada. Atur saldo awal: /akun ' + known + ' <saldo>';
    setOpening_(known, opening);
    return 'Saldo awal ' + known + ' diatur ke ' + rupiah_(opening);
  }
  addAccount_(name, opening || 0);
  return 'Akun ditambah: ' + name + ' (saldo awal ' + rupiah_(opening || 0) + ')';
}
