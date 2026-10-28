// One-off helpers, run manually from the Apps Script editor.

const DEFAULT_CATEGORIES = [
  ['expense', 'Makan'], ['expense', 'Transport'], ['expense', 'Belanja'], ['expense', 'Tagihan'],
  ['expense', 'Hiburan'], ['expense', 'Kesehatan'], ['expense', 'Pendidikan'], ['expense', 'Biaya Admin'],
  ['expense', 'Lainnya'],
  ['income', 'Gaji'], ['income', 'Bonus'], ['income', 'Freelance'], ['income', 'Lainnya'],
  ['saving', 'Tabungan'], ['saving', 'Dana Darurat'], ['saving', 'Investasi'], ['saving', 'Lainnya'],
];

// Creates the tabs with headers and default categories. Safe to re-run: tabs that have content are left alone.
function setup() {
  const ss = spreadsheet_();

  const tx = ss.getSheetByName('transactions') || ss.insertSheet('transactions');
  if (tx.getLastRow() === 0) {
    tx.getRange(1, 1, 1, SHEET_HEADERS.length).setValues([SHEET_HEADERS]);
    tx.setFrozenRows(1);
    tx.getRange('B:B').setNumberFormat('yyyy-mm-dd');
    tx.getRange('C:C').setNumberFormat('#,##0');
    tx.getRange('J:J').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }

  const cat = ss.getSheetByName('categories') || ss.insertSheet('categories');
  if (cat.getLastRow() === 0) {
    cat.getRange(1, 1, 1, 2).setValues([['type', 'category']]);
    cat.getRange(2, 1, DEFAULT_CATEGORIES.length, 2).setValues(DEFAULT_CATEGORIES);
    cat.setFrozenRows(1);
  }

  accountsSheet_();
  budgetsSheet_();
  console.log('Setup done.');
}

// Telegram must call the relay (relay/worker.js), never the web app: Apps Script answers webhooks with a 302,
// which Telegram treats as a failed delivery and retries forever. The relay checks secret_token.
function setWebhook() {
  const payload = {
    url: prop_('RELAY_URL'),
    secret_token: prop_('WEBHOOK_SECRET'),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  };
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
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + prop_('TELEGRAM_BOT_TOKEN') + '/getWebhookInfo');
  const info = JSON.parse(res.getContentText()).result || {};
  console.log([
    'ALLOWED_CHAT_ID is valid (ids, comma-separated): ' + /^-?\d+(\s*,\s*-?\d+)*$/.test(chatId.trim()),
    'ALLOWED_USER_ID set: ' + Boolean(props.getProperty('ALLOWED_USER_ID')),
    'FINANCE_TOPIC_ID: ' + (props.getProperty('FINANCE_TOPIC_ID') || 'not set (every topic is answered)'),
    'WEBHOOK_SECRET uses only letters, digits, _ or -: ' + /^[A-Za-z0-9_-]+$/.test(props.getProperty('WEBHOOK_SECRET') || ''),
    'WEBAPP_URL ends with /exec: ' + /\/exec$/.test(props.getProperty('WEBAPP_URL') || ''),
    'Telegram webhook points at RELAY_URL: ' + (Boolean(info.url) && info.url === props.getProperty('RELAY_URL')),
    'Last Telegram error: ' + (info.last_error_message || 'none'),
    'LAST_UPDATE_ID: ' + (props.getProperty('LAST_UPDATE_ID') || 'none'),
    'Pending updates at Telegram: ' + info.pending_update_count,
  ].join('\n'));
}
