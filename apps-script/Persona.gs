// Bot personality for replies that do not come from Gemini: emoji per category and short robot lines.
// Gemini adds its own one-line `quip` to parsed messages (see Prompt.gs). Amounts always come from code.

const CATEGORY_EMOJI = {
  makan: '🍜', transport: '🚗', belanja: '🛍️', tagihan: '🧾', hiburan: '🎬', kesehatan: '💊',
  pendidikan: '📚', gaji: '💰', bonus: '🎁', freelance: '💻', tabungan: '🏦', 'dana darurat': '🛟',
  investasi: '📈', transfer: '🔁', 'biaya admin': '🏧',
};
const TYPE_EMOJI = { expense: '💸', income: '💰', saving: '🏦', transfer: '🔁' };

const ROBOT_LINES = {
  saved: [
    'Data masuk ke memori. Bip bip ✅',
    'Tercatat rapi, bos 🫡',
    'Done! Dompetmu makin transparan 🔍',
    'Disimpan. Satu langkah lebih dekat ke financial freedom 🚀',
  ],
  deleted: [
    'Dihapus dari memori. Bersih! 🧹',
    'Poof! Hilang tanpa jejak 💨',
    'Terhapus. Anggap tidak pernah terjadi 🤐',
  ],
  cancelled: [
    'Oke, dibatalkan. Tidak ada yang berubah 👌',
    'Batal! Data aman, tidak disentuh 🛡️',
    'Siap, tidak jadi. Bip bop 🤖',
  ],
  confused: [
    'Bip... sirkuit saya bingung 🤖❓ Coba tulis jumlahnya, mis. "makan 35rb".',
    'Hmm, saya belum nangkep. Contoh: "kopi 25rb pake gopay" ☕',
    'Error 404: nominal tidak ditemukan 😅 Coba sebut jumlahnya ya.',
  ],
};

function emojiFor_(tx) {
  const key = String(tx.category).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(CATEGORY_EMOJI, key)) return CATEGORY_EMOJI[key];
  return TYPE_EMOJI[tx.type] || '💸';
}

function line_(kind) {
  const lines = ROBOT_LINES[kind];
  return lines[Math.floor(Math.random() * lines.length)];
}
