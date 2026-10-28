// Polling mode: a time trigger asks Telegram for new messages every minute. No webhook and no relay, so
// Apps Script's webhook 302 does not matter. Triggers run the latest saved code: no new deployment needed.
//
// Burst mode: after a message arrives, the run stays awake and long-polls Telegram for BURST_SECONDS
// (script property, default 120), so follow-ups and ✅/❌ taps are answered within a second or two.
// Quiet periods cost one quick check per minute. Free accounts get about 90 min/day of trigger runtime;
// quick checks use ~15 min/day and each burst adds up to BURST_SECONDS.

const MAX_RUN_MS = 4.5 * 60 * 1000; // stay well under Apps Script's 6-minute limit

function pollUpdates() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // the previous run is still bursting
  try {
    const started = Date.now();
    const burstMs = Number(optionalProp_('BURST_SECONDS') || 120) * 1000;
    let burstUntil = 0;
    let timeout = 0; // the first check returns immediately
    do {
      if (fetchUpdates_(timeout) > 0) burstUntil = Date.now() + burstMs;
      const left = Math.min(burstUntil, started + MAX_RUN_MS) - Date.now();
      timeout = Math.min(25, Math.floor(left / 1000));
    } while (timeout > 0);
  } finally {
    lock.releaseLock();
  }
}

// Long-polls Telegram for up to `timeout` seconds and handles what arrives. Returns the number of updates.
function fetchUpdates_(timeout) {
  const props = PropertiesService.getScriptProperties();
  const offset = Number(props.getProperty('LAST_UPDATE_ID') || 0) + 1;
  const url = 'https://api.telegram.org/bot' + prop_('TELEGRAM_BOT_TOKEN') + '/getUpdates?timeout=' + timeout +
    '&offset=' + offset + '&allowed_updates=' + encodeURIComponent('["message","callback_query"]');
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    console.error('getUpdates ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    return 0;
  }
  const updates = JSON.parse(res.getContentText()).result || [];
  updates.forEach(function (update) {
    // Advance first, so one failing message is not retried every minute forever.
    props.setProperty('LAST_UPDATE_ID', String(update.update_id));
    try {
      handleUpdate_(update);
    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
    }
  });
  return updates.length;
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
