// Account kinds (accounts.kind column). Known names get a kind automatically; /akun <nama> <jenis> overrides it.
// "Tabungan" and "investasi" are separate kinds: "berapa tabunganku" only sums tabungan accounts.

const ACCOUNT_KINDS = ['bank', 'ewallet', 'cash', 'tabungan', 'investasi', 'lainnya'];

const KIND_LABEL = {
  bank: '🏦 Bank', ewallet: '📱 E-wallet', cash: '💵 Cash',
  tabungan: '🐷 Tabungan', investasi: '📈 Investasi', lainnya: '📦 Lainnya',
};

const KIND_ALIASES = {
  bank: 'bank', rekening: 'bank',
  ewallet: 'ewallet', 'e-wallet': 'ewallet', dompetdigital: 'ewallet',
  cash: 'cash', tunai: 'cash',
  tabungan: 'tabungan', saving: 'tabungan', savings: 'tabungan',
  investasi: 'investasi', invest: 'investasi', investment: 'investasi', saham: 'investasi', reksadana: 'investasi',
  crypto: 'investasi', kripto: 'investasi',
  lainnya: 'lainnya', other: 'lainnya',
};

const KNOWN_ACCOUNTS = {
  gopay: 'ewallet', ovo: 'ewallet', dana: 'ewallet', shopeepay: 'ewallet', linkaja: 'ewallet', isaku: 'ewallet',
  bca: 'bank', bni: 'bank', bri: 'bank', mandiri: 'bank', jago: 'bank', seabank: 'bank', cimb: 'bank',
  permata: 'bank', danamon: 'bank', btn: 'bank', bsi: 'bank', blu: 'bank', jenius: 'bank',
  bibit: 'investasi', ajaib: 'investasi', stockbit: 'investasi', pluang: 'investasi', bareksa: 'investasi',
  ipot: 'investasi', pintu: 'investasi', indodax: 'investasi',
  cash: 'cash', tunai: 'cash',
};

function hasKey_(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// "investasi", "saham", "e-wallet", ... -> canonical kind, or null.
function parseKind_(word) {
  const key = String(word || '').trim().toLowerCase();
  return hasKey_(KIND_ALIASES, key) ? KIND_ALIASES[key] : null;
}

// "Dana Darurat" -> tabungan (checked before the "dana" e-wallet token), "Bank Jago" -> bank, unknown -> lainnya.
function guessKind_(name) {
  const lower = String(name).toLowerCase();
  if (/tabungan|darurat|celengan|saving/.test(lower)) return 'tabungan';
  const tokens = lower.split(/[\s_-]+/);
  for (let i = 0; i < tokens.length; i++) {
    if (hasKey_(KNOWN_ACCOUNTS, tokens[i])) return KNOWN_ACCOUNTS[tokens[i]];
  }
  return 'lainnya';
}
