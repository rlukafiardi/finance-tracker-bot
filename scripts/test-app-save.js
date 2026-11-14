// Write path of the app (appSave): validation, PIN and token, lockout, cap, request ids, duplicates, text columns.
// A fake Sheet records every call; the ledger is made up. Usage: node scripts/test-app-save.js
const assert = require('assert');
const { loadApp, ledger, accounts, budgets, today } = require('./app-fixture');

const NOW = Date.parse(today + 'T03:00:00Z');
const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';

function world(opts = {}) {
  const ctx = loadApp();
  ctx.console = { log() {}, error: (e) => { if (!String(e).includes('sheet down')) console.error('vm console.error:', e); } };
  const store = Object.assign({ APP_WRITE: 'on', APP_TOKEN: 'tok', APP_PIN: '123456' }, opts.props);
  Object.keys(store).forEach((k) => { if (store[k] === null) delete store[k]; });
  const calls = [];
  const rows = ledger.map((t) => [t.id, new ctx.VMDate(t.date + 'T00:00:00Z'), t.amount, t.type, t.category, t.account, t.merchant,
    t.note, '', new ctx.VMDate(0), t.to_account]);
  const sheet = {
    getLastRow: () => rows.length + 1,
    getRange: (r, c, nr = 1, nc = 1) => ({
      setNumberFormat: (f) => calls.push({ op: 'format', r, c, nr, nc, f }),
      setValues: (vals) => {
        if (opts.sheetFails) throw new Error('sheet down');
        calls.push({ op: 'values', r, c, nr, nc });
        vals.forEach((v, i) => { rows[r - 2 + i] = v.slice(); });
      },
    }),
  };
  const lock = { acquired: 0, released: 0 };
  ctx.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); },
    deleteProperty: (k) => { delete store[k]; } }) };
  ctx.LockService = { getScriptLock: () => ({
    waitLock: () => { if (opts.lockBusy) throw new Error('timeout'); lock.acquired++; },
    releaseLock: () => { lock.released++; }, hasLock: () => lock.acquired > lock.released }) };
  ctx.sheet_ = () => sheet;
  ctx.readTransactions_ = () => rows.map((r) => ctx.rowToTx_(r));
  ctx.getAccounts_ = () => accounts;
  ctx.getCategories_ = () => ({ expense: ['Makan', 'Transport', 'Belanja', 'Hiburan', 'Lainnya'], income: ['Gaji', 'Lainnya'],
    saving: ['Tabungan', 'Lainnya'] });
  ctx.getBudgets_ = () => budgets;
  ctx.todayStr_ = () => today;
  let refreshed = 0;
  ctx.refreshDashboardAfterChange_ = () => { refreshed++; };

  const entry = (over) => Object.assign({ type: 'expense', amount: '35000', date: '2026-11-14', category: 'Makan', account: 'BNI',
    merchant: 'Warung D', note: 'siang' }, over);
  let n = 0;
  const req = (over = {}, entryOver) => Object.assign({ token: 'tok', pin: '123456', rid: 'rid-' + String(++n).padStart(6, '0'),
    month: '2026-11', dupOk: true, entry: entry(entryOver) }, over);
  const save = (r, at) => ctx.appSaveRun_(r, { flag: store.APP_WRITE, token: store.APP_TOKEN, pin: store.APP_PIN,
    now: at || NOW, today: (at && opts.today) || today });
  const state = () => (store.APP_STATE ? JSON.parse(store.APP_STATE) : null);
  return { ctx, store, rows, calls, lock, entry, req, save, state, refreshed: () => refreshed };
}

// 1. a valid expense writes exactly one row with these values, text columns formatted as text first
{
  const w = world();
  const before = w.rows.length;
  const res = w.save(w.req());
  assert.strictEqual(res.ok, true, res.error);
  assert.strictEqual(w.rows.length, before + 1);
  const row = w.rows[before];
  assert.strictEqual(row[0], res.id);
  assert.ok(isDate(row[1]) && row[1].toISOString().slice(0, 10) === '2026-11-14');
  assert.deepStrictEqual([row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[10]],
    [35000, 'expense', 'Makan', 'BNI', 'Warung D', 'siang', 'app', '']);
  const f = w.calls.findIndex((c) => c.op === 'format'), v = w.calls.findIndex((c) => c.op === 'values');
  assert.ok(f >= 0 && f < v, 'text format is applied before the values');
  assert.deepStrictEqual(w.calls[f], { op: 'format', r: before + 2, c: 7, nr: 1, nc: 3, f: '@' }, 'columns 7-9 (merchant, note, raw)');
  assert.strictEqual(w.refreshed(), 1);
  assert.deepStrictEqual(w.state().recent, [{ rid: w.state().recent[0].rid, id: res.id }]);
  assert.strictEqual(w.state().writes, 1);
  assert.strictEqual(res.rows[0].id, res.id, 'response rows carry the new entry, newest first');
  assert.ok(res.main.includes('data-tab="transaksi"') && res.text.includes('Warung D'));
  assert.strictEqual(w.lock.acquired, w.lock.released, 'lock released');
}

// 2. every invalid entry writes nothing
{
  const bad = [
    ['amount 0', { amount: 0 }], ['amount "0"', { amount: '0' }], ['amount -5', { amount: -5 }], ['amount "-5"', { amount: '-5' }],
    ['amount 1.5', { amount: 1.5 }], ['amount "1.5"', { amount: '1.5' }], ['amount abc', { amount: 'abc' }],
    ['amount NaN', { amount: NaN }], ['amount 1e21', { amount: 1e21 }], ['amount "1e21"', { amount: '1e21' }],
    ['amount 11 digits', { amount: '10000000000' }], ['amount over cap', { amount: 1000000001 }], ['amount array', { amount: [5] }],
    ['amount object', { amount: { a: 1 } }], ['amount null', { amount: null }], ['amount missing', { amount: undefined }],
    ['amount empty', { amount: '' }], ['amount spaced', { amount: ' 5 ' }],
    ['type unknown', { type: 'delete' }], ['type case', { type: 'Expense' }], ['type missing', { type: undefined }],
    ['category unknown', { category: 'Pizza' }], ['category case', { category: 'makan' }], ['category empty', { category: '' }],
    ['category of other type', { type: 'income', category: 'Makan' }], ['category number', { category: 5 }],
    ['account unknown', { account: 'Dana' }], ['account empty', { account: '' }], ['account missing', { account: undefined }],
    ['transfer same account', { type: 'transfer', account: 'BNI', to_account: 'bni', category: '' }],
    ['transfer no target', { type: 'transfer', to_account: '', category: '' }],
    ['transfer unknown target', { type: 'transfer', to_account: 'Dana', category: '' }],
    ['date 30 Feb', { date: '2026-02-30' }], ['date month 13', { date: '2026-13-01' }], ['date text', { date: 'abc' }],
    ['date future', { date: '2026-11-15' }], ['date too old', { date: '2025-11-13' }], ['date with time', { date: '2026-11-14T00:00' }],
    ['date number', { date: 20261114 }], ['date missing', { date: undefined }],
    ['merchant 81 chars', { merchant: 'x'.repeat(81) }], ['merchant object', { merchant: { a: 1 } }],
    ['note 201 chars', { note: 'y'.repeat(201) }], ['note 5000 chars', { note: 'y'.repeat(5000) }], ['note array', { note: ['a'] }],
  ];
  bad.forEach(([name, over]) => {
    const w = world();
    const res = w.save(w.req({}, over));
    assert.strictEqual(res.ok, false, name + ' must be refused');
    assert.ok(typeof res.error === 'string' && res.error.length > 0, name + ' gives a message');
    assert.strictEqual(w.rows.length, ledger.length, name + ' wrote a row');
    assert.strictEqual(w.calls.length, 0, name + ' touched the sheet');
    assert.strictEqual(w.refreshed(), 0, name);
    assert.strictEqual(w.state().writes, 0, name + ' counted as a write');
    assert.deepStrictEqual(w.state().recent, [], name + ' remembered a request id');
  });
  ['entry missing', 'entry string', 'entry array'].forEach((name, i) => {
    const w = world();
    const r = w.req();
    r.entry = [undefined, 'x', [1]][i];
    assert.strictEqual(w.save(r).ok, false, name);
    assert.strictEqual(w.rows.length, ledger.length, name);
  });
  // edges that must still work
  const edge = (over) => { const w = world(); const r = w.save(w.req({}, over)); assert.strictEqual(r.ok, true, JSON.stringify(over) + ' ' + r.error); return w; };
  edge({ date: '2025-11-14' });
  edge({ amount: '1000000000' });
  edge({ amount: 1 });
  edge({ amount: '0007' });
  assert.strictEqual(edge({ account: 'bni' }).rows.at(-1)[5], 'BNI', 'account is stored with its canonical name');
  assert.strictEqual(edge({ merchant: 'x'.repeat(80), note: 'y'.repeat(200) }).rows.length, ledger.length + 1);
  const t = edge({ type: 'transfer', category: '', to_account: 'BCA', amount: '50000' });
  assert.deepStrictEqual([t.rows.at(-1)[3], t.rows.at(-1)[4], t.rows.at(-1)[10]], ['transfer', 'Transfer', 'BCA']);
}

// 3. formula-like and control-character text
{
  const w = world();
  const res = w.save(w.req({}, { note: '=1+1', merchant: '@SUM(A1)' }));
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual([w.rows.at(-1)[6], w.rows.at(-1)[7]], ['@SUM(A1)', '=1+1'], 'stored as typed');
  assert.ok(w.calls.some((c) => c.op === 'format' && c.f === '@' && c.c === 7 && c.nc === 3), 'plain-text format on columns 7-9');
  const w2 = world();
  w2.save(w2.req({}, { note: 'a\u0000b\nc ', merchant: ' Toko\t' }));
  assert.deepStrictEqual([w2.rows.at(-1)[6], w2.rows.at(-1)[7]], ['Toko', 'a b c']);
}

// 4. flag, token and request shape: nothing is read or written, no state is touched
{
  const refused = (name, props, over) => {
    const w = world({ props });
    const res = w.save(w.req(over || {}));
    assert.strictEqual(res.ok, false, name);
    assert.strictEqual(w.rows.length, ledger.length, name);
    assert.strictEqual(w.calls.length, 0, name);
    assert.strictEqual(w.state(), null, name + ' must not touch APP_STATE');
    assert.strictEqual(w.lock.acquired, 0, name + ' must not even take the lock');
    return res.error;
  };
  assert.ok(refused('flag unset', { APP_WRITE: null }).includes('belum aktif'));
  assert.ok(refused('flag off', { APP_WRITE: 'off' }).includes('belum aktif'));
  assert.ok(refused('flag ON', { APP_WRITE: 'ON' }).includes('belum aktif'), 'only the exact value on');
  assert.strictEqual(refused('wrong token', {}, { token: 'nope' }), 'Tidak diizinkan.');
  assert.strictEqual(refused('missing token', {}, { token: undefined }), 'Tidak diizinkan.');
  assert.strictEqual(refused('token number', {}, { token: 5 }), 'Tidak diizinkan.');
  assert.strictEqual(refused('token unset', { APP_TOKEN: null }, { token: '' }), 'Tidak diizinkan.');
  assert.strictEqual(refused('token unset, undefined', { APP_TOKEN: null }, { token: undefined }), 'Tidak diizinkan.');
  assert.strictEqual(refused('bad rid', {}, { rid: 'A_B' }), 'Permintaan tidak valid.');
  assert.strictEqual(refused('short rid', {}, { rid: 'abc' }), 'Permintaan tidak valid.');
  assert.strictEqual(refused('missing rid', {}, { rid: undefined }), 'Permintaan tidak valid.');
  assert.strictEqual(refused('pin number', {}, { pin: 123456 }), 'Permintaan tidak valid.');
  const w = world();
  assert.strictEqual(w.ctx.appSaveRun_(null, { flag: 'on', token: 'tok', pin: '123456', now: NOW, today }).ok, false, 'null request');
  assert.strictEqual(w.ctx.appSaveRun_('x', { flag: 'on', token: 'tok', pin: '123456', now: NOW, today }).ok, false, 'string request');
}

// 5. PIN, lockout, short or unset PIN
{
  const w = world();
  let res = w.save(w.req({ pin: '000000' }));
  assert.ok(res.error.includes('Sisa percobaan: 4'), res.error);
  assert.strictEqual(w.state().fails, 1);
  assert.strictEqual(w.save(w.req()).ok, true, 'right PIN resets the count');
  assert.strictEqual(w.state().fails, 0);
  for (let i = 0; i < 4; i++) assert.ok(w.save(w.req({ pin: '000000' }), NOW).error.includes('Sisa percobaan'));
  res = w.save(w.req({ pin: '000000' }), NOW);
  assert.ok(res.error.includes('terkunci 1 jam'), res.error);
  const rowsBefore = w.rows.length;
  res = w.save(w.req(), NOW + 10 * 60000);
  assert.ok(res.error.startsWith('Terkunci sampai 11:00 WIB'), 'locked even with the right PIN: ' + res.error); // NOW 10:00 WIB + 1 h
  assert.strictEqual(w.rows.length, rowsBefore);
  assert.strictEqual(w.save(w.req(), NOW + 61 * 60000).ok, true, 'works again after the hour');

  ['12345', '', 'abcdef', '12345a'].forEach((pin) => {
    const x = world({ props: { APP_PIN: pin } });
    const r = x.save(x.req({ pin }));
    assert.ok(r.ok === false && r.error === 'PIN belum diatur.', 'env PIN "' + pin + '" must refuse: ' + JSON.stringify(r));
    assert.strictEqual(x.rows.length, ledger.length);
  });
  const none = world({ props: { APP_PIN: null } });
  assert.strictEqual(none.save(none.req({ pin: '' })).error, 'PIN belum diatur.');
  const longPin = world({ props: { APP_PIN: '1234567890' } });
  assert.strictEqual(longPin.save(longPin.req({ pin: '1234567890' })).ok, true, 'longer PINs are fine');
}

// 6. daily cap and the day rollover
{
  const w = world();
  for (let i = 0; i < 30; i++) assert.strictEqual(w.save(w.req()).ok, true, 'write ' + (i + 1));
  const res = w.save(w.req());
  assert.ok(res.ok === false && res.error.includes('Batas 30'), JSON.stringify(res));
  assert.strictEqual(w.rows.length, ledger.length + 30);
  const next = w.ctx.appGuard_(w.state(), w.req(), { today: '2026-11-15', now: NOW + 86400000, pin: '123456' });
  assert.strictEqual(next.error, undefined, 'a new day resets the count');
  assert.strictEqual(next.state.writes, 0);
}

// 7. same request id twice: one row, the second reply says so and still carries fresh data
{
  const w = world();
  const r = w.req();
  const first = w.save(r);
  const again = w.save(r);
  assert.strictEqual(w.rows.length, ledger.length + 1);
  assert.strictEqual(again.ok, true);
  assert.strictEqual(again.replay, true);
  assert.strictEqual(again.id, first.id);
  assert.ok(again.main && again.rows.length === first.rows.length);
  assert.strictEqual(w.state().writes, 1);
  assert.strictEqual(w.refreshed(), 1);
  const wrongPinReplay = w.save(Object.assign({}, r, { pin: '000000' }));
  assert.strictEqual(wrongPinReplay.ok, false, 'a replay still needs the PIN');
  for (let i = 0; i < 40; i++) w.save(w.req());
  assert.ok(w.state().recent.length <= 30, 'remembered ids are capped');
}

// 8. duplicate warning: nothing is written until dupOk
{
  const w = world();
  const twin = { date: '2026-10-15', amount: '200000', category: 'Transport', account: 'BNI' }; // same as ledger row 3
  const warned = w.save(w.req({ dupOk: false }, twin));
  assert.ok(warned.ok === false && warned.duplicate === true && warned.existing.includes('Transport'), JSON.stringify(warned));
  assert.strictEqual(w.rows.length, ledger.length);
  assert.strictEqual(w.state().recent.length, 0, 'a warning does not use up the request id');
  const r = w.req({ dupOk: undefined }, twin);
  assert.strictEqual(w.save(r).duplicate, true, 'dupOk must be exactly true');
  assert.strictEqual(w.save(w.req({ dupOk: 'yes' }, twin)).duplicate, true, 'a truthy string is not dupOk');
  assert.strictEqual(w.save(Object.assign({}, r, { dupOk: true })).ok, true, 'same entry saves with dupOk');
  assert.strictEqual(w.save(w.req({ dupOk: false }, { amount: '36000' })).ok, true, 'a different amount is no duplicate');
  const tr = { type: 'transfer', category: '', account: 'BNI', to_account: 'ShopeePay', amount: '300000', date: '2026-10-20' };
  const w2 = world();
  const dupTransfer = w2.save(w2.req({ dupOk: false }, tr)); // same as ledger row 4
  assert.ok(dupTransfer.ok === false && dupTransfer.duplicate === true, 'same transfer is warned about');
  const other = world();
  assert.strictEqual(other.save(other.req({ dupOk: false }, Object.assign({}, tr, { to_account: 'BCA' }))).ok, true,
    'same amount to another account is no duplicate');
}

// 9. the model numbers move by exactly the amount; a transfer moves both balances and nothing else
{
  const w = world();
  const model = () => w.ctx.appModel_(w.ctx.readTransactions_(), accounts, budgets, '2026-11', today);
  const bal = (m) => Object.fromEntries(m.d.accounts.map((a) => [a.name.replace(/^\S+ /, ''), a.balance]));
  const catOf = (m, c) => (m.d.cats.rows.find((r) => r[0] === c) || [0, 0])[1];
  const b0 = bal(model());
  const makan0 = catOf(model(), 'Makan');
  assert.strictEqual(w.save(w.req({}, { account: 'ShopeePay', amount: '35000' })).ok, true);
  const b1 = bal(model());
  assert.strictEqual(b1.ShopeePay, b0.ShopeePay - 35000);
  assert.strictEqual(b1.BNI, b0.BNI);
  assert.strictEqual(catOf(model(), 'Makan'), makan0 + 35);
  assert.strictEqual(w.save(w.req({}, { type: 'transfer', category: '', account: 'BNI', to_account: 'BCA', amount: '50000' })).ok, true);
  const b2 = bal(model());
  assert.strictEqual(b2.BNI, b1.BNI - 50000);
  assert.strictEqual(b2.BCA, b1.BCA + 50000);
  assert.strictEqual(b2.ShopeePay, b1.ShopeePay);
  assert.strictEqual(catOf(model(), 'Makan'), makan0 + 35, 'a transfer is not spending');
  assert.strictEqual(w.save(w.req({}, { type: 'income', category: 'Gaji', account: 'BCA', amount: '1000000' })).ok, true);
  assert.strictEqual(bal(model()).BCA, b2.BCA + 1000000);
}

// 10. busy lock, failing sheet, corrupt state, waiting Telegram confirmation
{
  const busy = world({ lockBusy: true });
  const res = busy.save(busy.req());
  assert.ok(res.ok === false && res.error.includes('sibuk'));
  assert.strictEqual(busy.state(), null);
  assert.strictEqual(busy.rows.length, ledger.length);

  const down = world({ sheetFails: true });
  const r = down.req();
  const failed = down.save(r);
  assert.ok(failed.ok === false && failed.error.includes('/terakhir'), failed.error);
  assert.ok(!JSON.stringify(failed).includes('sheet down'), 'internal error text stays on the server');
  assert.strictEqual(down.state().recent.length, 0, 'a failed write does not use up the request id');
  assert.strictEqual(down.lock.acquired, down.lock.released, 'lock released after a failure');

  const corrupt = world({ props: { APP_STATE: '{bad json' } });
  assert.strictEqual(corrupt.save(corrupt.req()).ok, true, 'corrupt state is treated as fresh');

  const pending = world({ props: { PENDING: '{"id":"x"}' } });
  pending.save(pending.req());
  assert.strictEqual(pending.store.PENDING, '{"id":"x"}', 'a confirmation waiting in Telegram is left alone');
}

console.log('App save tests OK');
