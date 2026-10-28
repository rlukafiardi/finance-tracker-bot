// Parsers for bank notification emails (text from emailText_). Each returns { txs } or { error } and never guesses:
// an email type that is not understood is reported, not turned into a transaction.
// A tx has the transactions-tab fields; category is null when the parser cannot tell (decided later).

const EMAIL_MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, aug: 8, agt: 8, sep: 9, okt: 10, oct: 10,
  nov: 11, des: 12, dec: 12,
};

function emailLines_(text) {
  return text.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
}

// Regex match of the first line that matches, or null.
function matchLine_(lines, re) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m) return m;
  }
  return null;
}

function emailDate_(day, monthName, year) {
  const month = EMAIL_MONTHS[String(monthName).slice(0, 3).toLowerCase()];
  if (!month) return null;
  return year + '-' + ('0' + month).slice(-2) + '-' + ('0' + day).slice(-2);
}

function emailTx_(date, amount, type, account, fields) {
  return Object.assign({
    date: date, amount: amount, type: type, account: account, to_account: '', merchant: '', note: '', category: null,
  }, fields);
}

// "Transaksi berhasil!" (QRIS payment) and "Top-up berhasil!" (e-wallet top up, with its fee as a second row).
function parseBniEmail_(text) {
  const lines = emailLines_(text);
  const date = matchLine_(lines, /^Tanggal (\d{1,2}) (\S+) (\d{4})$/);
  const nominal = matchLine_(lines, /^Nominal Rp([\d.]+)$/);
  if (!date || !nominal) return { error: 'tanggal atau nominal tidak ditemukan' };
  const day = emailDate_(date[1], date[2], date[3]);
  if (!day) return { error: 'bulan "' + date[2] + '" tidak dikenal' };
  const amount = parseInt(nominal[1].replace(/\./g, ''), 10);

  const recipientAt = lines.indexOf('Penerima');
  const intro = matchLine_(lines, /Kamu baru aja (.+?) dengan detail/);
  const what = intro ? intro[1] : 'jenis tidak dikenal';

  if (/^Top-up berhasil/.test(lines[0]) && /top-up e-Wallet/i.test(what) && recipientAt >= 0) {
    const wallet = (lines[recipientAt + 2] || '').split('•')[0].trim();
    if (!wallet) return { error: 'e-wallet tujuan tidak ditemukan' };
    const txs = [emailTx_(day, amount, 'transfer', 'BNI', { to_account: wallet, category: 'Transfer', note: 'top-up e-wallet' })];
    const fee = matchLine_(lines, /^Biaya transaksi Rp([\d.]+)$/);
    const feeAmount = fee ? parseInt(fee[1].replace(/\./g, ''), 10) : 0;
    if (feeAmount > 0) {
      txs.push(emailTx_(day, feeAmount, 'expense', 'BNI', { category: 'Biaya Admin', note: 'biaya top-up ' + wallet }));
    }
    return { txs: txs };
  }
  if (/^Transaksi berhasil/.test(lines[0]) && matchLine_(lines, /^Jenis transaksi QRIS$/) && recipientAt >= 0) {
    const total = matchLine_(lines, /^Total Rp([\d.]+)$/);
    const paid = total ? parseInt(total[1].replace(/\./g, ''), 10) : amount;
    return { txs: [emailTx_(day, paid, 'expense', 'BNI', { merchant: lines[recipientAt + 1] || '', note: 'QRIS' })] };
  }
  return { error: 'belum didukung (' + what + ')' };
}

// "Internet Transaction Journal" (myBCA): fields come as "label", ":", "value" lines. Only QRIS payments so far.
function parseBcaEmail_(text) {
  const lines = emailLines_(text);
  const f = {};
  for (let i = 1; i + 1 < lines.length; i++) {
    if (lines[i] === ':') f[lines[i - 1]] = lines[i + 1];
  }
  if (f['Status'] !== 'Successful') return { error: 'status ' + (f['Status'] || 'tidak ditemukan') };
  if (!/QRIS/i.test(f['Transaction Type'] || '')) {
    return { error: 'belum didukung (' + (f['Transaction Type'] || 'jenis tidak ditemukan') + ')' };
  }
  const date = String(f['Transaction Date'] || '').match(/^(\d{1,2}) (\S+) (\d{4})/);
  const total = String(f['Total Payment'] || '').match(/^IDR ([\d,]+)(?:\.\d+)?$/);
  if (!date || !total) return { error: 'tanggal atau total tidak ditemukan' };
  const day = emailDate_(date[1], date[2], date[3]);
  if (!day) return { error: 'bulan "' + date[2] + '" tidak dikenal' };
  const amount = parseInt(total[1].replace(/,/g, ''), 10);
  return { txs: [emailTx_(day, amount, 'expense', 'BCA', { merchant: f['Payment to'] || '', note: 'QRIS' })] };
}

function parseBankEmail_(bank, text) {
  if (bank === 'BNI') return parseBniEmail_(text);
  if (bank === 'BCA') return parseBcaEmail_(text);
  return { error: 'bank ' + bank + ' belum didukung' };
}
