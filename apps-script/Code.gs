// Entry points: Telegram webhook (doPost) or polling (Poll.gs) -> handleUpdate_.
// Messages: yes/no to a pending action, slash command, or Gemini parse -> reply or confirmation preview.

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
    lock.waitLock(20000);
    if (isDuplicate_(update.update_id)) {
      console.log('Ignored: update ' + update.update_id + ' already handled');
      return ok_();
    }
    handleUpdate_(update);
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

// Shared by the webhook and polling. Only my own chat is answered.
function handleUpdate_(update) {
  const allowed = prop_('ALLOWED_CHAT_ID').trim();

  const cb = update.callback_query;
  if (cb) {
    if (!cb.message || String(cb.message.chat.id) !== allowed) {
      console.log('Ignored: button tap from another chat');
      return;
    }
    console.log('Handling button ' + update.update_id);
    try {
      handleCallback_(cb);
    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
    }
    return;
  }

  const msg = update.message;
  if (!msg || !msg.text) {
    console.log('Ignored: update ' + update.update_id + ' has no text message');
    return;
  }
  if (String(msg.chat.id) !== allowed) {
    console.log('Ignored: chat id does not match ALLOWED_CHAT_ID');
    return;
  }
  console.log('Handling update ' + update.update_id);
  handleMessage_(msg);
}

// Handlers return a string (sent as is), { reply }, or { action, preview } (sent with ✅/❌ buttons).
function handleMessage_(msg) {
  const chatId = msg.chat.id;
  try {
    if (handleConfirmText_(chatId, msg.text)) return;

    const ctx = { cats: getCategories_(), accounts: getAccounts_() };
    let r;
    if (msg.text.charAt(0) === '/') {
      r = handleCommand_(msg.text, ctx);
    } else {
      const parsed = parseMessage_(msg.text, null, ctx);
      const quip = parsed.quip ? '\n\n🤖 ' + parsed.quip : '';
      if (parsed.intent === 'log') {
        r = prepareLog_(parsed.transactions || [], msg.text, ctx, parsed.reply_hint);
      } else if (parsed.intent === 'delete') {
        r = prepareDeleteLast_();
      } else if (parsed.intent === 'correct') {
        r = prepareCorrect_(parsed.correction, ctx);
      } else if (parsed.intent === 'query') {
        r = '📊 ' + answerQuery_(parsed.query, ctx) + quip;
      } else {
        r = '🤖 ' + (parsed.reply_hint || line_('confused'));
      }
      if (r && r.preview) r.preview += quip;
    }

    if (typeof r === 'string') r = { reply: r };
    if (r.action) askConfirm_(chatId, r.action, r.preview);
    else sendMessage_(chatId, r.reply);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    sendMessage_(chatId, '⚠️ Bip... ada error di sirkuit saya. Coba lagi sebentar ya.');
  }
}
