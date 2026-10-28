// Telegram Bot API helpers. Errors are logged, never thrown, so a failed reply does not lose the update.

function telegram_(method, payload) {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + prop_('TELEGRAM_BOT_TOKEN') + '/' + method, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  let body = {};
  try {
    body = JSON.parse(res.getContentText());
  } catch (err) { /* logged below */ }
  if (!body.ok) console.error('Telegram ' + method + ' ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  return body.result;
}

// to = { chatId, threadId }; threadId keeps the reply inside the forum topic the message came from.
// buttons: optional single row of inline buttons [{ text, callback_data }]. Returns the message id.
function sendMessage_(to, text, buttons) {
  const payload = { chat_id: to.chatId, text: text };
  if (to.threadId) payload.message_thread_id = to.threadId;
  if (buttons) payload.reply_markup = { inline_keyboard: [buttons] };
  const result = telegram_('sendMessage', payload);
  return result ? result.message_id : null;
}

// Replacing the text without reply_markup also removes the buttons.
function editMessage_(chatId, messageId, text) {
  telegram_('editMessageText', { chat_id: chatId, message_id: messageId, text: text });
}

function answerCallback_(callbackId, text) {
  telegram_('answerCallbackQuery', { callback_query_id: callbackId, text: text || '' });
}
