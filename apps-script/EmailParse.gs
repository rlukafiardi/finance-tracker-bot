// Parsers for bank notification emails (text from emailText_). Each returns { txs } or { error } and never guesses:
// an email type that is not understood is reported, not turned into a transaction.
// A tx has the transactions-tab fields; category is null when the parser cannot tell (decided later).
// person: true marks a payment to a private person: its category comes from earlier rows or Lainnya, never from Gemini.

const EMAIL_MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, aug: 8, agt: 8, sep: 9, okt: 10, oct: 10,
  nov: 11, des: 12, dec: 12,
};

// Wallets that take their top-up fee from the balance they receive: the BNI email shows no fee, so it is added as an
// expense on the wallet account. Keys are the wallet name in lowercase without spaces. Check the amounts in the app.
const WALLET_DEDUCTED_FEES = { shopeepay: 500, ovo: 1000 };

function walletDeductedFee_(wallet) {
  const fee = WALLET_DEDUCTED_FEES[wallet.toLowerCase().replace(/\s+/g, '')];
  return Number.isInteger(fee) ? fee : 0;
}

// Some recipient names arrive with a trailing " -".
function cleanName_(name) {
  return name.replace(/\s*-\s*$/, '').trim();
}

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

// Amount on a line like "Nominal Rp17.000", "Total Rp203.500,00" or "Biaya admin Rp0"; null when the label is absent.
function bniAmount_(lines, label) {
  const m = matchLine_(lines, new RegExp('^' + label + ' Rp\\s?([\\d.]+)(?:,\\d+)?$'));
  return m ? parseInt(m[1].replace(/\./g, ''), 10) : null;
}

function lineAfter_(lines, label) {
  const i = lines.indexOf(label);
  return i >= 0 && i + 1 < lines.length ? lines[i + 1] : '';
}

// BNI (wondr) emails; the first line says which kind. Dates come as "23 Oktober 2026" or "09-Okt-2026".
//   Top-up berhasil!                   e-wallet top-up: transfer to the wallet, plus its fee
//   Transaksi berhasil!                QRIS, Virtual Account and PLN token payments
//   Transfer berhasil!                 to my own account (transfer) or to someone else (expense)
function parseBniEmail_(text) {
  const lines = emailLines_(text);
  const date = matchLine_(lines, /^Tanggal (\d{1,2})[ -](\S+?)[ -](\d{4})$/);
  if (!date) return { error: 'tanggal tidak ditemukan' };
  const day = emailDate_(date[1], date[2], date[3]);
  if (!day) return { error: 'bulan "' + date[2] + '" tidak dikenal' };

  const intro = matchLine_(lines, /Kamu baru aja (.+?) dengan detail/);
  const what = (intro ? intro[1] : 'jenis tidak dikenal') + (lineAfter_(lines, 'Tujuan') ? ' / ' + lineAfter_(lines, 'Tujuan') : '');
  const nominal = bniAmount_(lines, 'Nominal');
  const total = bniAmount_(lines, 'Total');
  const recipientAt = lines.indexOf('Penerima');
  const unsupported = { error: 'belum didukung (' + what + ')' };

  if (/^Top-up berhasil/.test(lines[0])) {
    if (!/top-up e-Wallet/i.test(what) || recipientAt < 0 || nominal === null) return unsupported;
    const wallet = (lines[recipientAt + 2] || '').split('•')[0].trim();
    if (!wallet) return { error: 'e-wallet tujuan tidak ditemukan' };
    const txs = [emailTx_(day, nominal, 'transfer', 'BNI', { to_account: wallet, category: 'Transfer', note: 'top-up e-wallet' })];
    const fee = bniAmount_(lines, 'Biaya transaksi');
    if (fee > 0) {
      txs.push(emailTx_(day, fee, 'expense', 'BNI', { category: 'Biaya Admin', note: 'biaya top-up ' + wallet }));
    } else if (walletDeductedFee_(wallet) > 0) {
      txs.push(emailTx_(day, walletDeductedFee_(wallet), 'expense', wallet,
        { category: 'Biaya Admin', note: 'biaya top-up, dipotong dompet' }));
    }
    return { txs: txs };
  }

  if (/^Transaksi berhasil/.test(lines[0])) {
    if (/QRIS/.test(what) && recipientAt >= 0 && total !== null) {
      return { txs: [emailTx_(day, total, 'expense', 'BNI', { merchant: lines[recipientAt + 1] || '', note: 'QRIS' })] };
    }
    // The payee is the biller or shop; order ids and customer numbers after the dash are never kept.
    if (/Virtual Account/.test(what) && total !== null) {
      const payee = lineAfter_(lines, 'Tujuan');
      const brand = payee.match(/^([A-Za-z]+)[-_ ]/);
      const merchant = brand ? brand[1].charAt(0).toUpperCase() + brand[1].slice(1).toLowerCase() : payee;
      return { txs: [emailTx_(day, total, 'expense', 'BNI', { merchant: merchant, note: 'virtual account' })] };
    }
    const pln = matchLine_(lines, /^(PLN Token Listrik) •/);
    if (pln && total !== null) {
      return { txs: [emailTx_(day, total, 'expense', 'BNI', { merchant: pln[1], category: 'Tagihan', note: 'token listrik' })] };
    }
    return unsupported;
  }

  if (/^Transfer berhasil/.test(lines[0])) {
    if (recipientAt < 0 || nominal === null) return unsupported;
    const name = cleanName_(lines[recipientAt + 1] || '');
    const bank = (lines[recipientAt + 2] || '').split('•')[0].trim();
    const mine = lineAfter_(lines, 'Sumber dana');
    const own = name && sameName_(name, mine);
    if (own && !bank) return { error: 'bank tujuan tidak ditemukan' };
    const txs = [own
      ? emailTx_(day, nominal, 'transfer', 'BNI', { to_account: bank, category: 'Transfer', note: 'transfer ke rekening sendiri' })
      : emailTx_(day, nominal, 'expense', 'BNI', { merchant: name, person: true, note: 'transfer' })];
    const fee = bniAmount_(lines, 'Biaya admin');
    if (fee > 0) txs.push(emailTx_(day, fee, 'expense', 'BNI', { category: 'Biaya Admin', note: 'biaya transfer' }));
    return { txs: txs };
  }

  return unsupported;
}

// "Internet Transaction Journal" (myBCA): fields come as "label", ":", "value" lines. QRIS payments, and transfers
// ("Transfer Type: Transfer to <bank>") to my own account (transfer) or to someone else (expense).
function parseBcaEmail_(text) {
  const lines = emailLines_(text);
  const f = {};
  for (let i = 1; i + 1 < lines.length; i++) {
    if (lines[i] === ':') f[lines[i - 1]] = lines[i + 1];
  }
  if (f['Status'] !== 'Successful') return { error: 'status ' + (f['Status'] || 'tidak ditemukan') };

  const isQris = /QRIS/i.test(f['Transaction Type'] || '');
  const isTransfer = /^Transfer to /i.test(f['Transfer Type'] || '');
  if (!isQris && !isTransfer) {
    return { error: 'belum didukung (' + (f['Transaction Type'] || f['Transfer Type'] || 'jenis tidak ditemukan') + ')' };
  }
  const date = String(f['Transaction Date'] || '').match(/^(\d{1,2}) (\S+) (\d{4})/);
  const money = function (label) {
    const m = String(f[label] || '').match(/^IDR ([\d,]+)(?:\.\d+)?$/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  };
  const amount = money(isQris ? 'Total Payment' : 'Amount');
  if (!date || amount === null) return { error: 'tanggal atau jumlah tidak ditemukan' };
  const day = emailDate_(date[1], date[2], date[3]);
  if (!day) return { error: 'bulan "' + date[2] + '" tidak dikenal' };

  if (isQris) {
    return { txs: [emailTx_(day, amount, 'expense', 'BCA', { merchant: f['Payment to'] || '', note: 'QRIS' })] };
  }
  const name = cleanName_(f['Beneficiary Name'] || '');
  const bank = f['Beneficiary Bank'] || '';
  const hello = matchLine_(lines, /^Hello\s+(.+?),?$/);
  const own = name && hello && sameName_(name, hello[1]);
  if (own && !bank) return { error: 'bank tujuan tidak ditemukan' };
  const txs = [own
    ? emailTx_(day, amount, 'transfer', 'BCA', { to_account: bank, category: 'Transfer', note: 'transfer ke rekening sendiri' })
    : emailTx_(day, amount, 'expense', 'BCA', { merchant: name, person: true, note: 'transfer' })];
  const fee = money('Fee');
  if (fee > 0) txs.push(emailTx_(day, fee, 'expense', 'BCA', { category: 'Biaya Admin', note: 'biaya transfer' }));
  return { txs: txs };
}

function parseBankEmail_(bank, text) {
  if (bank === 'BNI') return parseBniEmail_(text);
  if (bank === 'BCA') return parseBcaEmail_(text);
  return { error: 'bank ' + bank + ' belum didukung' };
}
