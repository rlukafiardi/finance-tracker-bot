// Entry point: Telegram webhook via the relay (doPost) -> handleUpdate_.
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

function idList_(value) {
  return String(value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

// Only ALLOWED_USER_ID is answered, only in ALLOWED_CHAT_ID (comma-separated: private chat and/or group), and in
// a group only inside FINANCE_TOPIC_ID when it is set. /whereami answers that user anywhere.
function handleUpdate_(update) {
  const owner = prop_('ALLOWED_USER_ID').trim();
  const chats = idList_(prop_('ALLOWED_CHAT_ID'));
  const topic = optionalProp_('FINANCE_TOPIC_ID').trim();

  const cb = update.callback_query;
  if (cb) {
    if (!cb.message || String(cb.from.id) !== owner || chats.indexOf(String(cb.message.chat.id)) < 0) {
      console.log('Ignored: button tap from another user or chat');
      return;
    }
    console.log('Handling button ' + update.update_id);
    handleCallback_(cb);
    return;
  }

  const msg = update.message;
  if (!msg || !msg.text || !msg.from) {
    console.log('Ignored: update ' + update.update_id + ' has no text message');
    return;
  }
  if (String(msg.from.id) !== owner) {
    console.log('Ignored: sender is not ALLOWED_USER_ID');
    return;
  }
  const to = { chatId: msg.chat.id, threadId: msg.message_thread_id || null };
  if (/^\/whereami(@\S+)?$/i.test(msg.text.trim())) {
    sendMessage_(to, whereAmI_(msg));
    return;
  }
  if (chats.indexOf(String(msg.chat.id)) < 0) {
    console.log('Ignored: chat ' + msg.chat.type + ' is not in ALLOWED_CHAT_ID');
    return;
  }
  if (msg.chat.type !== 'private' && topic && String(msg.message_thread_id || '') !== topic) {
    console.log('Ignored: message is outside FINANCE_TOPIC_ID');
    return;
  }
  console.log('Handling update ' + update.update_id);
  handleMessage_(msg, to);
}

function whereAmI_(msg) {
  return [
    '📍 Lokasi ini',
    'chat id: ' + msg.chat.id + ' (' + msg.chat.type + (msg.chat.title ? ', ' + msg.chat.title : '') + ')',
    'topic id: ' + (msg.message_thread_id || '- (bukan di dalam topic)'),
    'user id kamu: ' + msg.from.id,
    '',
    'Script Properties: ALLOWED_USER_ID = user id, ALLOWED_CHAT_ID = chat id (pisahkan koma untuk lebih dari satu),',
    'FINANCE_TOPIC_ID = topic id.',
  ].join('\n');
}

// Handlers return a string (sent as is), { reply }, or { action, preview } (sent with ✅/❌ buttons).
function handleMessage_(msg, to) {
  try {
    if (handleConfirmText_(to, msg.text)) return;

    const ctx = { cats: getCategories_(), accounts: getAccounts_() };
    let r;
    if (msg.text.charAt(0) === '/') {
      r = handleCommand_(msg.text, ctx);
    } else {
      const parsed = parseMessage_(msg.text, null, ctx);
      const quip = parsed.quip ? '\n\n🤖 ' + parsed.quip : '';
      if (parsed.intent === 'log') {
        r = prepareLog_(parsed.transactions || [], msg.text, ctx, parsed.reply_hint);
      } else if (parsed.intent === 'account') {
        const a = parsed.account_setup || {};
        const opening = Number.isInteger(a.opening) && a.opening >= 0 ? a.opening : null;
        r = a.rename_to
          ? prepareRename_(String(a.name || '').trim(), String(a.rename_to).trim(), ctx)
          : prepareAccount_(String(a.name || '').trim(), opening, parseKind_(a.kind), ctx);
      } else if (parsed.intent === 'budget') {
        const b = parsed.budget_setup || {};
        r = b.category && Number.isInteger(b.limit) && b.limit >= 0
          ? prepareBudget_(String(b.category).trim(), b.limit, ctx)
          : '📊 ' + budgetOverview_();
      } else if (parsed.intent === 'category') {
        const c = parsed.category_setup || {};
        r = c.name ? prepareCategory_(TYPES.indexOf(c.type) >= 0 ? c.type : 'expense', String(c.name).trim(), ctx)
          : categoryList_(ctx);
      } else if (parsed.intent === 'email') {
        r = prepareEmailImport_(ctx);
      } else if (parsed.intent === 'help') {
        r = HELP_TEXT;
      } else if (parsed.intent === 'delete') {
        r = parsed.delete_id ? prepareDeleteById_(String(parsed.delete_id).replace(/^#/, '')) : prepareDeleteLast_();
      } else if (parsed.intent === 'correct') {
        const pending = getPending_();
        const byId = parsed.correction && parsed.correction.id;
        r = pending && (pending.action.kind === 'log' || pending.action.kind === 'emails') && !byId
          ? prepareEditPending_(pending, parsed.correction, ctx)
          : prepareCorrect_(parsed.correction, ctx);
      } else if (parsed.intent === 'query') {
        r = '📊 ' + answerQuery_(parsed.query, ctx) + quip;
      } else {
        r = '🤖 ' + (parsed.reply_hint || line_('confused'));
      }
      if (r && r.preview) r.preview += quip;
    }

    if (typeof r === 'string') r = { reply: r };
    if (r.action) askConfirm_(to, r.action, r.preview);
    else sendMessage_(to, r.reply);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    sendMessage_(to, '⚠️ Bip... ada error di sirkuit saya. Coba lagi sebentar ya.');
  }
}
