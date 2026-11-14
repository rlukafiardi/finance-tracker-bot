// Two checks on the Apps Script sources. `node --check` only catches syntax errors. Usage: node scripts/check-refs.js [dir]
//  1. Fails when code calls a private helper (name ending in "_") or names a trigger function that no .gs file defines.
//  2. Fails on a public function (no trailing "_") that is not in PUBLIC below. Any public function can be called with
//     google.script.run from a page this project serves, so each one must be listed on purpose.
//     Rule: a public function never returns data unless it checks the token itself (only appSave does).
const fs = require('fs');
const path = require('path');

const PUBLIC = {
  doGet: 'web app entry: read-only app, checks APP_TOKEN first',
  doPost: 'web app entry: Telegram webhook, checks the webhook secret first',
  appSave: 'app write: checks flag, token and PIN before anything else',
  setup: 'owner tool (Run menu): creates the tabs',
  setWebhook: 'owner tool: points Telegram at the relay',
  checkConfig: 'owner tool: logs webhook info',
  refreshDashboard: 'owner tool and called by triggers: rebuilds the dashboard tab, returns nothing',
  installSchedules: 'owner tool: creates the time triggers',
  installEmailImport: 'owner tool: starts the Gmail import',
  weeklySummary: 'trigger: sends the weekly recap to Telegram, returns nothing',
  monthlySummary: 'trigger: sends the monthly recap to Telegram, returns nothing',
  scheduledRecurring: 'trigger: due recurring entries to Telegram, returns nothing',
  scheduledEmailImport: 'trigger: email batch to Telegram, returns nothing',
  previewEmails: 'owner tool: sends a preview to Telegram',
  dumpEmailSamples: 'owner tool: logs email samples',
  dumpFailedSamples: 'owner tool: logs unreadable emails',
  auditEmails: 'owner tool: logs parser audit',
  runExamples: 'owner test run: logs results',
  runEmailTests: 'owner test run: logs results',
  runEmailImportTests: 'owner test run: logs results',
  runRecurringTests: 'owner test run: logs results',
  runFeeTests: 'owner test run: logs results',
};

const dir = process.argv[2] || 'apps-script';
const raw = fs.readdirSync(dir).filter((f) => f.endsWith('.gs'))
  .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
// Browser code inside String.raw templates is not Apps Script code.
const src = raw.replace(/String\.raw`[\s\S]*?\n`;/g, '');

const defined = new Set([...src.matchAll(/^function\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]));
const called = new Set([...src.matchAll(/(?<![.\w])([A-Za-z][A-Za-z0-9]*_)\(/g)].map((m) => m[1]));
const triggers = new Set([...src.matchAll(/newTrigger\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]));

const missing = [...called, ...triggers].filter((name) => !defined.has(name));
if (missing.length) {
  console.error('Undefined functions: ' + [...new Set(missing)].join(', '));
  process.exit(1);
}

const unlisted = [...defined].filter((n) => !n.endsWith('_') && !(n in PUBLIC));
if (unlisted.length) {
  console.error('Public functions not in the allowlist (callable from the page; add a trailing "_" or list them in PUBLIC with a reason): ' +
    unlisted.join(', '));
  process.exit(1);
}
const gone = Object.keys(PUBLIC).filter((n) => !defined.has(n));
if (gone.length) {
  console.error('PUBLIC lists functions that no longer exist: ' + gone.join(', '));
  process.exit(1);
}
console.log('References OK (' + defined.size + ' functions, ' + [...defined].filter((n) => !n.endsWith('_')).length + ' public)');
