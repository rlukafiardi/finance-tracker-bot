// Every write waits for a confirmation: the bot sends a preview with ✅/❌ buttons (typing "ya"/"batal" also works).
// One pending action at a time, kept in the PENDING script property; it expires after 15 minutes.
// An action is plain JSON ({ kind, ... }) produced by a prepare*_ function and executed by runAction_.
// `to` = { chatId, threadId } is where replies go (see Telegram.gs).

const PENDING_TTL_MS = 15 * 60 * 1000;
const YES_WORDS = ['ya', 'y', 'iya', 'yes', 'ok', 'oke', 'okay', 'simpan', 'gas', 'lanjut', 'betul', 'benar'];
const NO_WORDS = ['batal', 'tidak', 'gak', 'ga', 'nggak', 'enggak', 'no', 'cancel', 'jangan'];

function getPending_() {
  const raw = optionalProp_('PENDING');
  if (!raw) return null;
  const p = JSON.parse(raw);
  return Date.now() - p.createdAt > PENDING_TTL_MS ? null : p;
}

function clearPending_() {
  PropertiesService.getScriptProperties().deleteProperty('PENDING');
}

// A new preview replaces the old one; the old message loses its buttons so it cannot be tapped later.
function closeOldPending_() {
  const raw = optionalProp_('PENDING');
  if (!raw) return;
  const p = JSON.parse(raw);
  if (p.messageId) editMessage_(p.chatId, p.messageId, p.preview + '\n\n⏭️ Dilewati (ada pesan baru).');
  clearPending_();
}

function askConfirm_(to, action, preview) {
  closeOldPending_();
  const id = Utilities.getUuid().slice(0, 8);
  const messageId = sendMessage_(to, preview, [
    { text: '✅ Simpan', callback_data: 'ok:' + id },
    { text: '❌ Batal', callback_data: 'no:' + id },
  ]);
  PropertiesService.getScriptProperties().setProperty('PENDING', JSON.stringify({
    id: id, action: action, preview: preview, chatId: to.chatId, messageId: messageId, createdAt: Date.now(),
  }));
}

// Returns true if the text was a yes/no answer (handled here), false if it is a normal message.
function handleConfirmText_(to, text) {
  const word = text.trim().toLowerCase().replace(/[!.]+$/, '');
  const yes = YES_WORDS.indexOf(word) >= 0;
  const no = NO_WORDS.indexOf(word) >= 0;
  if (!yes && !no) return false;
  const p = getPending_();
  if (!p) {
    sendMessage_(to, 'Tidak ada yang menunggu konfirmasi 🤖');
    return true;
  }
  resolvePending_(to, p, yes, false);
  return true;
}

function handleCallback_(cb) {
  const to = { chatId: cb.message.chat.id, threadId: cb.message.message_thread_id || null };
  const parts = String(cb.data || '').split(':');
  const p = getPending_();
  if (!p || p.id !== parts[1]) {
    answerCallback_(cb.id, 'Sudah kedaluwarsa ⌛');
    editMessage_(to.chatId, cb.message.message_id, cb.message.text + '\n\n⌛ Kedaluwarsa, kirim ulang ya.');
    return;
  }
  const confirmed = parts[0] === 'ok';
  answerCallback_(cb.id, confirmed ? 'Diproses ⚙️' : 'Dibatalkan');
  resolvePending_(to, p, confirmed, true);
}

// Button taps turn the preview message into the result; typed answers get a new message.
function resolvePending_(to, p, confirmed, viaButton) {
  clearPending_();
  let result;
  if (confirmed) {
    try {
      result = runAction_(p.action);
    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
      result = '⚠️ Gagal menyimpan: ' + err.message;
    }
  } else {
    result = '❌ ' + line_('cancelled');
  }

  if (viaButton && p.messageId) {
    editMessage_(p.chatId, p.messageId, result);
  } else {
    if (p.messageId) editMessage_(p.chatId, p.messageId, p.preview + '\n\n' + (confirmed ? '✅ Dikonfirmasi' : '❌ Dibatalkan'));
    sendMessage_(to, result);
  }
  if (confirmed) refreshDashboardAfterChange_();
}

function runAction_(action) {
  switch (action.kind) {
    case 'log': return commitLog_(action);
    case 'correct': return commitCorrect_(action);
    case 'delete': return commitDelete_(action);
    case 'account': return commitAccount_(action);
    case 'category': return commitCategory_(action);
    case 'budget': return commitBudget_(action);
    default: throw new Error('unknown action ' + action.kind);
  }
}
