// Admin-fee reminder: after a single transfer is saved, the result message asks for the fee with one-tap buttons.
// A tap logs the fee as an expense on the source account right away (the tap itself is the confirmation), with the
// transfer's created_at, so "hapus yang tadi" removes the transfer and its fee together.

const FEE_PRESETS = [1000, 2500, 6500]; // e-wallet top up, BI-FAST, online transfer (RTOL)
const FEE_CATEGORY = 'Biaya Admin';     // falls back to Lainnya until this category is added
const FEE_QUESTION = '🏧 Ada biaya admin?';
const FEE_ASK_TYPED = '✏️ Ketik jumlah biayanya saja, mis. 3rb.';
const FEE_MAX = 100000; // a typed fee above this is refused as a likely typo
const FEE_WAIT_TTL_MS = 15 * 60 * 1000;

// Buttons for a log action with exactly one transfer and no expense already logged with it (a fee typed in the
// same message, "admin 2,5rb", arrives as such an expense). Null otherwise. A transfer into a wallet that takes the
// fee itself (WALLET_DEDUCTED_FEES: ShopeePay, OVO) gets one button with that fee, booked on the wallet account.
function feeButtons_(action) {
  if (action.kind !== 'log') return null;
  const transfers = action.txs.filter(function (t) { return t.type === 'transfer'; });
  const expenses = action.txs.filter(function (t) { return t.type === 'expense'; });
  if (transfers.length !== 1 || expenses.length) return null;
  const id = transfers[0].id;
  const walletFee = walletDeductedFee_(transfers[0].to_account);
  if (walletFee > 0) {
    return [
      [{ text: '+ ' + compactRp_(walletFee).replace('Rp ', '') + ' di ' + transfers[0].to_account, callback_data: 'fee:' + id + ':' + walletFee + ':w' }],
      [{ text: '✏️ Lain', callback_data: 'fee:' + id + ':x:w' }, { text: '🆓 Gratis', callback_data: 'fee:' + id + ':0' }],
    ];
  }
  return [
    FEE_PRESETS.map(function (fee) {
      return { text: '+ ' + compactRp_(fee).replace('Rp ', ''), callback_data: 'fee:' + id + ':' + fee };
    }),
    [{ text: '✏️ Lain', callback_data: 'fee:' + id + ':x' }, { text: '🆓 Gratis', callback_data: 'fee:' + id + ':0' }],
  ];
}

function handleFeeCallback_(cb, to, parts) {
  const id = parts[1];
  const text = cb.message.text.replace('\n\n' + FEE_QUESTION, '');
  const onWallet = parts[3] === 'w'; // the wallet takes the fee from the money it received
  if (parts[2] === 'x') { // "Lain": the next message that is only an amount is the fee
    PropertiesService.getScriptProperties().setProperty('FEE_WAIT', JSON.stringify({
      id: id, onWallet: onWallet, chatId: to.chatId, messageId: cb.message.message_id, text: text, createdAt: Date.now(),
    }));
    answerCallback_(cb.id, 'Ketik jumlahnya');
    editMessage_(to.chatId, cb.message.message_id, text + '\n\n' + FEE_ASK_TYPED,
      [[{ text: '🆓 Gratis', callback_data: 'fee:' + id + ':0' }]]);
    return;
  }
  const fee = Number(parts[2]);
  if (!fee) {
    clearFeeWait_();
    answerCallback_(cb.id, 'Oke, gratis 🎉');
    editMessage_(to.chatId, cb.message.message_id, text.replace('\n\n' + FEE_ASK_TYPED, ''));
    return;
  }
  const res = logFee_(id, fee, onWallet);
  if (res.status === 'missing') {
    answerCallback_(cb.id, 'Transfernya sudah tidak ada');
    editMessage_(to.chatId, cb.message.message_id, text);
  } else if (res.status === 'duplicate') {
    answerCallback_(cb.id, 'Sudah dicatat');
  } else {
    answerCallback_(cb.id, 'Biaya admin dicatat');
    editMessage_(to.chatId, cb.message.message_id, text + '\n\n➕ ' + describe_(res.tx) + budgetWarnings_([res.tx]));
  }
}

function clearFeeWait_() {
  PropertiesService.getScriptProperties().deleteProperty('FEE_WAIT');
}

// The whole message must be one amount: "3rb", "3,5rb", "Rp 3.500", "3500". Null for anything else.
function parseTypedFee_(text) {
  const m = String(text).trim().toLowerCase().match(/^(?:rp\.?\s*)?(\d+(?:[.,]\d+)*)(?:\s*(rb|ribu|k|jt|juta))?$/);
  if (!m) return null;
  const unit = m[2] === 'ribu' ? 'rb' : m[2] === 'juta' ? 'jt' : (m[2] || '');
  const fee = parseAmount_(m[1] + unit);
  return Number.isInteger(fee) ? fee : null;
}

// Called before the message goes to Gemini. A message that is only an amount ("3rb", "Rp 3.500") answers a pending
// "Lain" tap; any other message drops the wait and is handled as usual. Returns true when the message was consumed.
function handleFeeTyped_(to, text) {
  const raw = optionalProp_('FEE_WAIT');
  if (!raw) return false;
  const wait = JSON.parse(raw);
  clearFeeWait_();
  if (Date.now() - wait.createdAt > FEE_WAIT_TTL_MS) return false;
  const fee = parseTypedFee_(text);
  if (fee === null) return false;
  if (fee <= 0 || fee > FEE_MAX) {
    sendMessage_(to, '🤖 Biaya admin ' + rupiah_(fee) + ' tidak masuk akal (maks ' + rupiah_(FEE_MAX) +
      '), tidak dicatat. Tap ✏️ Lain lagi kalau mau coba lagi.');
    editMessage_(wait.chatId, wait.messageId, wait.text);
    return true;
  }
  const res = logFee_(wait.id, fee, wait.onWallet);
  if (res.status === 'ok') {
    editMessage_(wait.chatId, wait.messageId, wait.text + '\n\n➕ ' + describe_(res.tx) + budgetWarnings_([res.tx]));
  } else {
    editMessage_(wait.chatId, wait.messageId, wait.text);
    sendMessage_(to, res.status === 'missing' ? 'Transfernya sudah tidak ada, biaya tidak dicatat.' : 'Sudah dicatat.');
  }
  return true;
}

// Books the fee row right after the transfer with its created_at. Status: ok (with tx), missing, duplicate.
function logFee_(id, fee, onWallet) {
  const sh = sheet_('transactions');
  const r = findRowById_(sh, id);
  if (r < 0) return { status: 'missing' };
  const row = sh.getRange(r, 1, 1, SHEET_HEADERS.length).getValues()[0];
  // A double tap delivers two callbacks; the fee row sits right after the transfer with the same created_at.
  const next = r < sh.getLastRow() ? sh.getRange(r + 1, 1, 1, SHEET_HEADERS.length).getValues()[0] : null;
  if (next && next[3] === 'expense' && next[9] instanceof Date && next[9].getTime() === row[9].getTime()) {
    return { status: 'duplicate' };
  }
  const transfer = rowToTx_(row);
  const cats = getCategories_().expense;
  const tx = {
    date: transfer.date, amount: fee, type: 'expense',
    category: cats.indexOf(FEE_CATEGORY) >= 0 ? FEE_CATEGORY : 'Lainnya',
    account: onWallet ? transfer.to_account : transfer.account, merchant: '',
    note: onWallet ? 'biaya top-up, dipotong dompet' : 'admin transfer ke ' + transfer.to_account, to_account: '',
  };
  const at = sh.getLastRow() + 1;
  sh.getRange(at, 7, 1, 3).setNumberFormat('@'); // merchant, note, raw_message stay text, never formulas
  sh.getRange(at, 1, 1, SHEET_HEADERS.length).setValues([[Utilities.getUuid().slice(0, 8), row[1], tx.amount, tx.type,
    tx.category, tx.account, tx.merchant, tx.note, row[8], row[9], tx.to_account]]);
  refreshDashboardAfterChange_();
  return { status: 'ok', tx: tx };
}
