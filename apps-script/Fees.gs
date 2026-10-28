// Admin-fee reminder: after a single transfer is saved, the result message asks for the fee with one-tap buttons.
// A tap logs the fee as an expense on the source account right away (the tap itself is the confirmation), with the
// transfer's created_at, so "hapus yang tadi" removes the transfer and its fee together.

const FEE_PRESETS = [1000, 2500, 6500]; // e-wallet top up, BI-FAST, online transfer (RTOL)
const FEE_CATEGORY = 'Biaya Admin';     // falls back to Lainnya until this category is added
const FEE_QUESTION = '🏧 Ada biaya admin?';

// Buttons for a log action with exactly one transfer and no expense already logged with it (a fee typed in the
// same message, "admin 2,5rb", arrives as such an expense). Null otherwise.
function feeButtons_(action) {
  if (action.kind !== 'log') return null;
  const transfers = action.txs.filter(function (t) { return t.type === 'transfer'; });
  const expenses = action.txs.filter(function (t) { return t.type === 'expense'; });
  if (transfers.length !== 1 || expenses.length) return null;
  const id = transfers[0].id;
  return [
    FEE_PRESETS.map(function (fee) {
      return { text: '+ ' + compactRp_(fee).replace('Rp ', ''), callback_data: 'fee:' + id + ':' + fee };
    }),
    [{ text: '🆓 Gratis', callback_data: 'fee:' + id + ':0' }],
  ];
}

function handleFeeCallback_(cb, to, parts) {
  const id = parts[1];
  const fee = Number(parts[2]);
  const text = cb.message.text.replace('\n\n' + FEE_QUESTION, '');
  if (!fee) {
    answerCallback_(cb.id, 'Oke, gratis 🎉');
    editMessage_(to.chatId, cb.message.message_id, text);
    return;
  }

  const sh = sheet_('transactions');
  const r = findRowById_(sh, id);
  if (r < 0) {
    answerCallback_(cb.id, 'Transfernya sudah tidak ada');
    editMessage_(to.chatId, cb.message.message_id, text);
    return;
  }
  const row = sh.getRange(r, 1, 1, SHEET_HEADERS.length).getValues()[0];
  // A double tap delivers two callbacks; the fee row sits right after the transfer with the same created_at.
  const next = r < sh.getLastRow() ? sh.getRange(r + 1, 1, 1, SHEET_HEADERS.length).getValues()[0] : null;
  if (next && next[3] === 'expense' && next[9] instanceof Date && next[9].getTime() === row[9].getTime()) {
    answerCallback_(cb.id, 'Sudah dicatat');
    return;
  }
  const transfer = rowToTx_(row);
  const cats = getCategories_().expense;
  const tx = {
    date: transfer.date, amount: fee, type: 'expense',
    category: cats.indexOf(FEE_CATEGORY) >= 0 ? FEE_CATEGORY : 'Lainnya',
    account: transfer.account, merchant: '', note: 'admin transfer ke ' + transfer.to_account, to_account: '',
  };
  sh.appendRow([Utilities.getUuid().slice(0, 8), row[1], tx.amount, tx.type, tx.category, tx.account, tx.merchant,
    tx.note, row[8], row[9], tx.to_account]);

  answerCallback_(cb.id, 'Biaya admin dicatat');
  editMessage_(to.chatId, cb.message.message_id, text + '\n\n➕ ' + describe_(tx) + budgetWarnings_([tx]));
  refreshDashboardAfterChange_();
}
