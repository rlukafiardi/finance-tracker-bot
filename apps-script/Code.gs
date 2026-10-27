// Telegram webhook entry point. Flow: auth check -> dedupe -> slash command or Gemini parse -> route by intent -> reply.

const TZ = 'Asia/Jakarta';

function prop_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error('Missing script property: ' + name);
  return value;
}

function optionalProp_(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

function ok_() {
  return ContentService.createTextOutput('ok');
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    // Apps Script cannot read headers, so the secret travels in the webhook URL.
    if (!e || !e.postData || !e.parameter || e.parameter.secret !== prop_('WEBHOOK_SECRET')) {
      console.log('Ignored: missing or wrong secret in webhook URL');
      return ok_();
    }

    const update = JSON.parse(e.postData.contents);
    const msg = update.message;
    if (!msg || !msg.text) {
      console.log('Ignored: update ' + update.update_id + ' has no text message');
      return ok_();
    }
    if (String(msg.chat.id) !== prop_('ALLOWED_CHAT_ID').trim()) {
      console.log('Ignored: chat id does not match ALLOWED_CHAT_ID');
      return ok_();
    }

    lock.waitLock(20000);
    if (isDuplicate_(update.update_id)) {
      console.log('Ignored: update ' + update.update_id + ' already handled');
      return ok_();
    }
    console.log('Handling update ' + update.update_id);
    handleMessage_(msg);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
  return ok_();
}

// Telegram retries slow or failed deliveries; update_ids only increase, so skip anything already seen.
function isDuplicate_(updateId) {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('LAST_UPDATE_ID') || 0);
  if (updateId <= last) return true;
  props.setProperty('LAST_UPDATE_ID', String(updateId));
  return false;
}

function handleMessage_(msg) {
  const chatId = msg.chat.id;
  try {
    const ctx = { cats: getCategories_(), accounts: getAccounts_() };
    let reply;
    if (msg.text.charAt(0) === '/') {
      reply = handleCommand_(msg.text, ctx);
    } else {
      const parsed = parseMessage_(msg.text, null, ctx);
      if (parsed.intent === 'log') {
        reply = logTransactions_(parsed.transactions || [], msg.text, ctx, parsed.reply_hint);
      } else if (parsed.intent === 'delete') {
        reply = deleteLast_();
      } else if (parsed.intent === 'correct') {
        reply = correctLast_(parsed.correction, ctx);
      } else if (parsed.intent === 'query') {
        reply = answerQuery_(parsed.query, ctx);
      } else {
        reply = parsed.reply_hint || 'Maaf, tidak paham. Ketik /help untuk contoh.';
      }
    }
    sendMessage_(chatId, reply);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    sendMessage_(chatId, 'Gagal memproses pesan, coba lagi nanti.');
  }
}
