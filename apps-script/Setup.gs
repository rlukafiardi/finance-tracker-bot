// One-off helpers, run manually from the Apps Script editor.

const DEFAULT_CATEGORIES = [
  ['expense', 'Makan'], ['expense', 'Transport'], ['expense', 'Belanja'], ['expense', 'Tagihan'],
  ['expense', 'Hiburan'], ['expense', 'Kesehatan'], ['expense', 'Pendidikan'], ['expense', 'Lainnya'],
  ['income', 'Gaji'], ['income', 'Bonus'], ['income', 'Freelance'], ['income', 'Lainnya'],
  ['saving', 'Tabungan'], ['saving', 'Dana Darurat'], ['saving', 'Investasi'], ['saving', 'Lainnya'],
];

// Creates or upgrades the tabs. Safe to re-run: it never overwrites existing rows.
//   transactions: headers (adds the to_account header if an older sheet lacks it)
//   categories:   default categories, plus `saving | Lainnya` if missing
//   accounts:     header only; accounts are added by /akun or when you mention a new account
function setup() {
  const ss = spreadsheet_();

  const tx = ss.getSheetByName('transactions') || ss.insertSheet('transactions');
  if (tx.getLastRow() === 0) {
    tx.getRange(1, 1, 1, SHEET_HEADERS.length).setValues([SHEET_HEADERS]);
    tx.setFrozenRows(1);
    tx.getRange('B:B').setNumberFormat('yyyy-mm-dd');
    tx.getRange('C:C').setNumberFormat('#,##0');
    tx.getRange('J:J').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  } else if (!tx.getRange(1, 11).getValue()) {
    tx.getRange(1, 11).setValue('to_account');
  }

  const cat = ss.getSheetByName('categories') || ss.insertSheet('categories');
  if (cat.getLastRow() === 0) {
    cat.getRange(1, 1, 1, 2).setValues([['type', 'category']]);
    cat.getRange(2, 1, DEFAULT_CATEGORIES.length, 2).setValues(DEFAULT_CATEGORIES);
    cat.setFrozenRows(1);
  } else if (getCategories_().saving.indexOf('Lainnya') < 0) {
    cat.appendRow(['saving', 'Lainnya']);
  }

  // accounts: add the current_balance column (a live formula) to any row that does not have it yet.
  const acc = accountsSheet_();
  if (!acc.getRange(1, 3).getValue()) acc.getRange(1, 3).setValue('current_balance');
  for (let r = 2; r <= acc.getLastRow(); r++) {
    if (acc.getRange(r, 1).getValue() && !acc.getRange(r, 3).getFormula()) acc.getRange(r, 3).setFormula(balanceFormula_(r));
  }
  acc.getRange('B:C').setNumberFormat('#,##0');

  budgetsSheet_();
  console.log('Setup done.');
}

// Telegram should call the relay (RELAY_URL, see relay/worker.js); without it, the web app directly.
function webhookTarget_() {
  const relay = optionalProp_('RELAY_URL');
  return relay || prop_('WEBAPP_URL') + '?secret=' + encodeURIComponent(prop_('WEBHOOK_SECRET'));
}

// Points the Telegram bot at the relay or web app and drops any queued updates.
function setWebhook() {
  const payload = { url: webhookTarget_(), allowed_updates: ['message', 'callback_query'], drop_pending_updates: true };
  if (optionalProp_('RELAY_URL')) payload.secret_token = prop_('WEBHOOK_SECRET'); // checked by the relay
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + prop_('TELEGRAM_BOT_TOKEN') + '/setWebhook', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  console.log(res.getContentText());
}

// Diagnoses "the bot does not reply" without printing secrets: compares the properties with what Telegram has.
function checkConfig() {
  const props = PropertiesService.getScriptProperties();
  const chatId = props.getProperty('ALLOWED_CHAT_ID') || '';
  const secret = props.getProperty('WEBHOOK_SECRET') || '';
  const webapp = props.getProperty('WEBAPP_URL') || '';
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + prop_('TELEGRAM_BOT_TOKEN') + '/getWebhookInfo');
  const info = JSON.parse(res.getContentText()).result || {};
  const polling = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'pollUpdates'; });
  const lines = [
    'ALLOWED_CHAT_ID is digits only (no spaces or quotes): ' + /^\d+$/.test(chatId),
    'Mode: ' + (polling ? 'polling (every minute)' : 'webhook'),
  ];
  if (polling) {
    lines.push('Webhook removed (required for polling): ' + !info.url);
  } else {
    lines.push(
      'WEBHOOK_SECRET is letters/digits only: ' + /^[A-Za-z0-9]+$/.test(secret),
      'WEBAPP_URL ends with /exec: ' + /\/exec$/.test(webapp),
      'Using relay (RELAY_URL set): ' + Boolean(props.getProperty('RELAY_URL')),
      'Telegram webhook points at the expected target: ' + (info.url === webhookTarget_()),
      'Last Telegram error: ' + (info.last_error_message || 'none'));
  }
  lines.push(
    'LAST_UPDATE_ID: ' + (props.getProperty('LAST_UPDATE_ID') || 'none'),
    'Pending updates at Telegram: ' + info.pending_update_count);
  console.log(lines.join('\n'));
}

// Shows delivery status. The webhook URL contains the secret, so it is removed from the log.
function webhookInfo() {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + prop_('TELEGRAM_BOT_TOKEN') + '/getWebhookInfo');
  const info = JSON.parse(res.getContentText());
  if (info.result) delete info.result.url;
  console.log(JSON.stringify(info, null, 2));
}
