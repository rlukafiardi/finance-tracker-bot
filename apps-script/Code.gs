// Telegram webhook entry point. Flow: auth check -> dedupe -> Gemini parse -> route by intent -> reply.

const TZ = 'Asia/Jakarta';

function prop_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error('Missing script property: ' + name);
  return value;
}

function ok_() {
  return ContentService.createTextOutput('ok');
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    // Apps Script cannot read headers, so the secret travels in the webhook URL.
    if (!e || !e.postData || !e.parameter || e.parameter.secret !== prop_('WEBHOOK_SECRET')) return ok_();

    const update = JSON.parse(e.postData.contents);
    const msg = update.message;
    if (!msg || !msg.text) return ok_();
    if (String(msg.chat.id) !== prop_('ALLOWED_CHAT_ID')) return ok_();

    lock.waitLock(20000);
    if (isDuplicate_(update.update_id)) return ok_();
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
    const cats = getCategories_();
    const parsed = parseMessage_(msg.text, null, cats);
    let reply;
    if (parsed.intent === 'log') {
      reply = logTransactions_(parsed.transactions || [], msg.text, cats, parsed.reply_hint);
    } else if (parsed.intent === 'correct') {
      reply = correctLast_(parsed.correction, cats);
    } else if (parsed.intent === 'query') {
      reply = answerQuery_(parsed.query);
    } else {
      reply = parsed.reply_hint || 'Maaf, tidak paham. Contoh: "makan siang 35rb gofood", "gaji 15jt", "nabung 2jt".';
    }
    sendMessage_(chatId, reply);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    sendMessage_(chatId, 'Gagal memproses pesan, coba lagi nanti.');
  }
}
