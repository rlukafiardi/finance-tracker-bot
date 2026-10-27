// One-off helpers, run manually from the Apps Script editor.

const DEFAULT_CATEGORIES = [
  ['expense', 'Makan'], ['expense', 'Transport'], ['expense', 'Belanja'], ['expense', 'Tagihan'],
  ['expense', 'Hiburan'], ['expense', 'Kesehatan'], ['expense', 'Pendidikan'], ['expense', 'Lainnya'],
  ['income', 'Gaji'], ['income', 'Bonus'], ['income', 'Freelance'], ['income', 'Lainnya'],
  ['saving', 'Tabungan'], ['saving', 'Dana Darurat'], ['saving', 'Investasi'],
];

// Creates the two tabs with headers and default categories. Skips anything that already has content.
function setup() {
  const ss = SpreadsheetApp.openById(prop_('SHEET_ID'));

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
  console.log('Setup done.');
}

// Points the Telegram bot at the deployed web app. Needs WEBAPP_URL (the /exec URL) and WEBHOOK_SECRET.
function setWebhook() {
  const url = prop_('WEBAPP_URL') + '?secret=' + encodeURIComponent(prop_('WEBHOOK_SECRET'));
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + prop_('TELEGRAM_BOT_TOKEN') + '/setWebhook', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ url: url, allowed_updates: ['message'], drop_pending_updates: true }),
    muteHttpExceptions: true,
  });
  console.log(res.getContentText());
}

// Shows delivery status. The webhook URL contains the secret, so it is removed from the log.
function webhookInfo() {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + prop_('TELEGRAM_BOT_TOKEN') + '/getWebhookInfo');
  const info = JSON.parse(res.getContentText());
  if (info.result) delete info.result.url;
  console.log(JSON.stringify(info, null, 2));
}
