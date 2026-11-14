// Local checks of App.gs on a made-up ledger: token rule, month model, as-of balances, filters, bad input, escaping, wording.
// Usage: node scripts/test-app.js
const assert = require('assert');
const { loadApp, sample, sampleRows, nav, viewOf, ledger, accounts, budgets, today } = require('./app-fixture');

const app = loadApp();
// values made inside the vm have another Array prototype, so compare them as plain JSON
const deq = (a, b, ...msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), ...msg);
const kpi = (m, label) => m.d.kpis.find((k) => k.label === label);

// token rule
assert.strictEqual(app.appAuthorized_('abc', 'abc'), true);
assert.strictEqual(app.appAuthorized_('abc', 'xyz'), false);
assert.strictEqual(app.appAuthorized_('', ''), false, 'unset APP_TOKEN must refuse an empty token');
assert.strictEqual(app.appAuthorized_(undefined, ''), false, 'unset APP_TOKEN must refuse a missing token');
assert.strictEqual(app.appAuthorized_(undefined, 'abc'), false);

// month helpers
assert.strictEqual(app.appMonthEnd_('2026-10', today), '2026-10-31');
assert.strictEqual(app.appMonthEnd_('2024-02', today), '2024-02-29');
assert.strictEqual(app.appMonthEnd_('2026-11', today), today, 'current month ends today');
assert.strictEqual(app.appWeekStart_('2026-11-14'), '2026-11-09', 'Saturday -> Monday');
assert.strictEqual(app.appWeekStart_('2026-11-09'), '2026-11-09');
assert.strictEqual(app.appWeekStart_('2026-11-15'), '2026-11-09', 'Sunday -> Monday');
deq(app.appMonths_(ledger, today), ['2026-11', '2026-10', '2026-09']);
deq(app.appMonths_([], today), ['2026-11']);
assert.strictEqual(app.appMonths_([{ date: '2020-01-01' }], today).length, 36, 'month list is capped');
deq(app.appMonths_([{ date: '2026-01-05' }], '2027-01-10').slice(-1), ['2026-01'], 'crosses a year');

// check 1: October totals equal the hand-computed ledger values; the 1 Nov row stays out, the 31 Oct row stays in
const oct = app.appModel_(ledger, accounts, budgets, '2026-10', today);
assert.strictEqual(oct.view.month, '2026-10');
assert.strictEqual(oct.view.current, false);
assert.strictEqual(kpi(oct, 'PENGELUARAN').value, 'Rp 370 rb'); // 50k + 200k + 120k
assert.strictEqual(kpi(oct, 'PEMASUKAN').value, 'Rp 10 jt');
deq(oct.d.kpis.map((k) => k.label), ['TABUNGAN SEKARANG', 'PENGELUARAN', 'PEMASUKAN'], 'no sisa and no savings rate cards');
assert.strictEqual(kpi(oct, 'TABUNGAN SEKARANG').value, 'Rp 19,8 jt'); // BNI 19,330k + BCA 500k as of 31 Oct
deq(oct.d.trend.rows.at(-1), ['Okt 2026', 10, 0.37, 19.83], 'trend rows: month, income, expense, Tabungan (juta)');assert.strictEqual(kpi(oct, 'PEMASUKAN').delta.text, '11% vs bulan lalu'); // 10 jt vs 9 jt in September
deq(oct.d.cats.rows, [['Transport', 200], ['Makan', 170]], 'the transfer is not spending');
deq(oct.view.rows.map((r) => r.id), ['6', '5', '4', '3', '2'], 'newest first, October only');
assert.ok(oct.view.rows.every((r) => !('raw_message' in r) && !('created_at' in r)), 'private fields are not sent');
const nov = app.appModel_(ledger, accounts, budgets, '2026-11', today);
assert.strictEqual(kpi(nov, 'PENGELUARAN').value, 'Rp 1 jt'); // 999k + 40k = 1,039k

// check 2: balances are as of the end of the month (BNI = 19,330,000 on 31 Oct, 18,331,000 today)
const bal = (m) => Object.fromEntries(m.d.accounts.map((a) => [a.name.replace(/^\S+ /, ''), a.balance]));
deq(bal(oct), { BNI: 19330000, BCA: 500000, ShopeePay: 400000 });
assert.strictEqual(oct.d.total, 20230000);
assert.strictEqual(bal(nov).BNI, 18331000);
assert.strictEqual(bal(nov).ShopeePay, 360000); // 100k + 300k transfer - 40k

// empty month: no rows, no throw
const gap = app.appModel_(ledger.filter((r) => !r.date.startsWith('2026-10')), accounts, budgets, '2026-10', today);
deq(gap.view.rows, []);
assert.strictEqual(kpi(gap, 'PENGELUARAN').value, 'Rp 0');
assert.ok(app.appPage_(gap.d, '14/11 10:30', gap.view, nav).includes('Belum ada transaksi di bulan ini'));

// check 4: bad month values fall back to the current month
['2026-13', '2026-00', 'abc', "'; DROP", '2099-01', '2020-01', '2026-10-01', '', undefined, null, '<script>'].forEach((bad) => {
  assert.strictEqual(app.appModel_(ledger, accounts, budgets, bad, today).view.month, '2026-11', 'month ' + bad);
});

// check 3: filters on the October rows
const rows = oct.view.rows;
const ids = (f) => app.appFilter_(rows, f).map((r) => r.id).join(',');
assert.strictEqual(ids({}), '6,5,4,3,2');
assert.strictEqual(ids({ q: 'KOPI' }), '6', 'text is case-insensitive');
assert.strictEqual(ids({ q: 'gaji okt' }), '5', 'text also searches the note');
assert.strictEqual(ids({ type: 'expense' }), '6,3,2');
assert.strictEqual(ids({ type: 'expense', category: 'Makan' }), '6,2', 'filters combine with AND');
assert.strictEqual(ids({ account: 'ShopeePay' }), '4', 'a transfer matches its target account');
assert.strictEqual(ids({ min: 100000, max: 200000 }), '6,3', 'amount range is inclusive');
assert.strictEqual(ids({ min: '120000', max: '120000' }), '6');
assert.strictEqual(ids({ q: 'warung', category: 'Transport' }), '', 'no match gives an empty list');
assert.strictEqual(ids({ min: '', max: '' }), '6,5,4,3,2', 'empty amount fields are ignored');
deq(app.appTotals_(rows), { expense: 370000, income: 10000000 });
deq(app.appTotals_(app.appFilter_(rows, { category: 'Makan' })), { expense: 170000, income: 0 });

// page text: escaping, one script block, links, wording
const page = app.appPage_(oct.d, '14/11 10:30', oct.view, nav);
assert.strictEqual(page.split('</script>').length - 1, 1, 'a note with </script> cannot close the script early');
assert.ok(!page.includes('<b>X</b>') && !page.includes('<i>') , 'row text never reaches the HTML unescaped');
assert.ok(page.includes('u003c/script'), 'row JSON is escaped');
assert.ok(page.includes('href="https://example.test/exec?token=tok%20en%261&amp;month=2026-09"'), 'previous-month link keeps the token');
assert.ok(page.includes('href="https://example.test/exec?token=tok%20en%261&amp;month=2026-11"'), 'next-month link');
assert.ok(page.includes('Saldo akun di akhir Oktober 2026'));
assert.ok(page.includes('Tabungan akhir bulan'));
const first = app.appPage_(nov.d, '14/11 10:30', nov.view, nav);
assert.ok(first.includes('<span class="arrow off"'), 'no next month after the current one');
const banned = /\b(anda|saya|kami|kita|kamu|silakan|mohon|median|interval|percentile|variance)\b/i;
const text = page.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
assert.ok(!banned.test(text), 'banned word on the page: ' + (text.match(banned) || [])[0]);

const evil = app.appPage_(Object.assign({}, sample, { cats: { unit: sample.cats.unit, rows: [['<b>Makan</b>', 500]] },
  accounts: [{ name: '<img src=x>', balance: 1 }] }), '14/11 10:30', viewOf([]), nav);
assert.ok(!evil.includes('<b>Makan</b>') && !evil.includes('<img src=x>'), 'names are escaped');

assert.strictEqual(app.rpFull_(12345678), 'Rp 12.345.678');
assert.strictEqual(app.rpFull_(-1500), '-Rp 1.500');
assert.strictEqual(app.rpFull_(0), 'Rp 0');

// doGet: refusals read no data; a valid token with a bad month still renders the current month
function stubs(props, onRead) {
  const ctx = loadApp();
  ctx.optionalProp_ = (name) => props[name] || '';
  ctx.getCategories_ = () => ({ expense: ['Makan', 'Transport'], income: ['Gaji'], saving: ['Tabungan'] });
  ctx.ContentService = { createTextOutput: (t) => t };
  ctx.readTransactions_ = () => { onRead(); return ledger; };
  ctx.getAccounts_ = () => { onRead(); return accounts; };
  ctx.getBudgets_ = () => { onRead(); return budgets; };
  ctx.todayStr_ = () => today;
  ctx.ScriptApp = { getService: () => ({ getUrl: () => nav.base }) };
  const out = { html: '' };
  // the real HtmlOutput.addMetaTag throws on any other name (developers.google.com/apps-script/reference/html/html-output)
  const allowedMeta = ['apple-mobile-web-app-capable', 'google-site-verification', 'mobile-web-app-capable', 'viewport'];
  const chain = { setTitle: () => chain, addMetaTag: (name) => {
    if (allowedMeta.indexOf(name) < 0) throw new Error('The meta tag you specified is not allowed in this context: ' + name);
    return chain;
  } };
  ctx.HtmlService = { createHtmlOutput: (h) => { out.html = h; return chain; } };
  return { ctx, out };
}
[['wrong', { parameter: { token: 'nope' } }, 'secret'], ['missing', { parameter: {} }, 'secret'],
  ['no params', undefined, 'secret'], ['unset property', { parameter: { token: '' } }, ''],
  ['month without token', { parameter: { month: '2026-10' } }, 'secret']].forEach(([name, e, prop]) => {
  const { ctx } = stubs({ APP_TOKEN: prop, APP_WRITE: 'on' }, () => { throw new Error('read data on refusal: ' + name); });
  assert.strictEqual(ctx.doGet(e), 'Tidak diizinkan.', name);
});
const ok = stubs({ APP_TOKEN: 'secret' }, () => {});
ok.ctx.doGet({ parameter: { token: 'secret', month: '2026-13' } });
assert.ok(ok.out.html.includes('<option value="2026-11" selected>November 2026</option>'), 'bad month renders the current month');
ok.ctx.doGet({ parameter: { token: 'secret', month: '2026-10' } });
assert.ok(ok.out.html.includes('<option value="2026-10" selected>Oktober 2026</option>'));
assert.ok(!ok.out.html.includes('raw_message'));


// writes off (the first deploy): the page has no "+" button, no form and no server call at all
ok.ctx.doGet({ parameter: { token: 'secret' } });
assert.ok(!/n_add|n_sheet|appSave|google\.script/.test(ok.out.html), 'read-only page contains no write UI');
// writes on: the form is there, with categories and accounts for the pickers
const on = stubs({ APP_TOKEN: 'secret', APP_WRITE: 'on' }, () => {});
on.ctx.doGet({ parameter: { token: 'secret' } });
assert.ok(on.out.html.includes('id="n_add"') && on.out.html.includes('.appSave('), 'write page has the form');
assert.ok(on.out.html.includes('<option value="BCA">BCA</option>'));
const bannedForm = on.out.html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
assert.ok(!banned.test(bannedForm), 'banned word in the form: ' + (bannedForm.match(banned) || [])[0]);
assert.strictEqual(app.appOldest_('2026-11-14'), '2025-11-14');
assert.strictEqual(on.out.html.split('</script>').length - 1, 1);
assert.ok(!/token=secret/.test(on.out.html.replace(/https:\/\/example\.test\/exec\?token=secret/g, '')), 'token only appears inside links and NAV');

// Telegram link: only a private group (-100...) with a topic gives one; ids are digits only
[['-1001234567890', '2', 'https://t.me/c/1234567890/2'], ['123456,-1001234567890', '2', 'https://t.me/c/1234567890/2'],
  [' 99 , -1009876543210 ', ' 7 ', 'https://t.me/c/9876543210/7'], ['123456', '2', ''], ['-1001234567890', '', ''],
  ['-1001234567890', 'abc', ''], ['-1001234567890', '2x', ''], ['-123456789', '2', ''], ['', '2', ''], [undefined, undefined, ''],
  ['-1001234567890"><script>', '2', ''], ['-100', '2', '']].forEach(([chats, topic, want]) =>
  assert.strictEqual(app.appTelegramLink_(chats, topic), want, JSON.stringify([chats, topic])));
const link = 'https://t.me/c/1234567890/2';
const withLink = Object.assign({}, nov.view, { telegram: link });
const readOnlyPage = app.appPage_(nov.d, '14/11 10:30', withLink, nav);
assert.ok(readOnlyPage.includes('<a class="fab" target="_top" href="' + link + '" aria-label="Catat lewat Telegram">'), 'read-only page has the Telegram button');
assert.ok(!app.appPage_(nov.d, '14/11 10:30', nov.view, nav).includes('aria-label="Catat lewat Telegram"'), 'no link, no button');
const form = { cats: { expense: ['Makan'], income: [], saving: [] }, accounts: ['BNI'], today, oldest: app.appOldest_(today) };
const writePage = app.appPage_(nov.d, '14/11 10:30', Object.assign({}, withLink, { form }), nav);
assert.ok(writePage.includes('class="tglink" target="_top" href="' + link + '"') && !writePage.includes('<a class="fab"'),
  'with writes on the link sits inside the sheet and the + button stays');
const hostile = app.appPage_(nov.d, '14/11 10:30', Object.assign({}, nov.view, { telegram: 'https://x.test/"><img src=x onerror=alert(1)>' }), nav);
assert.ok(!hostile.includes('"><img') && hostile.includes('&quot;&gt;&lt;img'), 'the link is escaped even if a bad value reached the page');
const linked = stubs({ APP_TOKEN: 'secret', ALLOWED_CHAT_ID: '5,-1001234567890', FINANCE_TOPIC_ID: '2' }, () => {});
linked.ctx.doGet({ parameter: { token: 'secret' } });
assert.ok(linked.out.html.includes(link), 'doGet builds the link from ALLOWED_CHAT_ID and FINANCE_TOPIC_ID');
assert.ok(!ok.out.html.includes('t.me'), 'no chat id in the page when the topic is not configured');

// light only: no dark palette, and native controls are told to stay light
assert.ok(!page.includes('prefers-color-scheme') && page.includes('color-scheme:light'), 'the page has no dark mode');
// hero is the money held, not sisa: a month that starts before the salary does not turn it negative
assert.ok(!/Sisa bulan ini|ditabung/.test(page), 'no sisa or savings-rate wording on the page');
assert.ok(page.includes('Tabungan akhir bulan') && /<section class="hero"><div class="label">Tabungan akhir bulan/.test(page), 'hero is Tabungan');
assert.ok(first.includes('<section class="hero"><div class="label">Tabungan sekarang'), 'hero is Tabungan sekarang for the current month');
const noMoney = app.appPage_(Object.assign({}, nov.d, { kpis: nov.d.kpis.filter((k) => k.label !== 'TABUNGAN SEKARANG') }), '14/11 10:30', nov.view, nav);
assert.ok(!noMoney.includes('class="hero"'), 'no hero when there is nothing to show');

console.log('App tests OK');
