function sendMessage_(chatId, text) {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + prop_('TELEGRAM_BOT_TOKEN') + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text: text }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    console.error('Telegram sendMessage ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  }
}
