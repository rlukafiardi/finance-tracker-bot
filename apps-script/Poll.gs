// Polling mode: a time trigger asks Telegram for new messages every minute. No webhook and no relay, so
// Apps Script's webhook 302 does not matter. Replies arrive within about a minute.
// Triggers run the latest saved code, so code changes need no new deployment in this mode.

function pollUpdates() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // the previous run is still busy
  try {
    const props = PropertiesService.getScriptProperties();
    const offset = Number(props.getProperty('LAST_UPDATE_ID') || 0) + 1;
    const url = 'https://api.telegram.org/bot' + prop_('TELEGRAM_BOT_TOKEN') + '/getUpdates?timeout=0&offset=' + offset +
      '&allowed_updates=' + encodeURIComponent('["message"]');
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      console.error('getUpdates ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
      return;
    }
    const allowed = prop_('ALLOWED_CHAT_ID').trim();
    (JSON.parse(res.getContentText()).result || []).forEach(function (update) {
      // Advance first, so one failing message is not retried every minute forever.
      props.setProperty('LAST_UPDATE_ID', String(update.update_id));
      const msg = update.message;
      if (!msg || !msg.text || String(msg.chat.id) !== allowed) return;
      console.log('Handling update ' + update.update_id);
      handleMessage_(msg);
    });
  } finally {
    lock.releaseLock();
  }
}

// Removes the webhook (getUpdates refuses to work while one is set), drops queued updates, starts the timer.
function startPolling() {
  UrlFetchApp.fetch('https://api.telegram.org/bot' + prop_('TELEGRAM_BOT_TOKEN') + '/deleteWebhook?drop_pending_updates=true');
  stopPolling();
  ScriptApp.newTrigger('pollUpdates').timeBased().everyMinutes(1).create();
  console.log('Polling every minute. Send the bot a message and wait up to a minute.');
}

function stopPolling() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pollUpdates') ScriptApp.deleteTrigger(t);
  });
}
