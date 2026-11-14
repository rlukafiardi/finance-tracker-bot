// Real-browser check of the "+" form on the installed Chrome at 390 px, with google.script.run replaced by a fake that
// records every call. Covers validation, preview, PIN once per load, pending state, retries with the same request id,
// duplicate warning, refusal text, main swapped after a save, and no sideways scroll.
// Usage: node scripts/e2e-form.js [screenshot-dir]
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const puppeteer = require('puppeteer-core');
const { loadApp, sample, sampleRows, nav, viewOf, tx } = require('./app-fixture');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const shots = process.argv[2];
const app = loadApp();

const form = { cats: { expense: ['Makan', 'Transport', 'Belanja'], income: ['Gaji'], saving: ['Tabungan'] },
  accounts: ['BNI', 'BCA', 'ShopeePay'], today: '2026-11-14', oldest: '2025-11-14' };
const rows = sampleRows(12);
const newRows = [tx(999, '2026-11-14', 35000, 'expense', 'Makan', 'BNI', 'Kedai Zeta')].concat(rows);
const writeView = Object.assign(viewOf(rows), { form, telegram: 'https://t.me/c/1234567890/2' });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'form-e2e-'));
  const file = path.join(dir, 'index.html');
  const readOnly = path.join(dir, 'readonly.html');
  fs.writeFileSync(file, app.appPage_(sample, '14/11 10:30', writeView, nav));
  fs.writeFileSync(readOnly, app.appPage_(sample, '14/11 10:30', viewOf(rows), nav));

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage();
    const outside = [];
    const errors = [];
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const url = r.url();
      if (!url.startsWith('file://') && !url.startsWith('data:')) outside.push(url);
      r.continue();
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.evaluateOnNewDocument(() => {
      window.__calls = [];
      window.__delay = 0;
      window.__reply = () => ({ ok: false, error: 'unset' });
      const make = (ok, fail) => ({
        withSuccessHandler: (f) => make(f, fail),
        withFailureHandler: (f) => make(ok, f),
        appSave: (req) => {
          window.__calls.push(JSON.parse(JSON.stringify(req)));
          setTimeout(() => {
            const r = window.__reply(req);
            if (r === 'FAIL') fail(new Error('network')); else ok(r);
          }, window.__delay);
        },
      });
      window.google = { script: { run: make(() => {}, () => {}) } };
    });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);

    const text = (sel) => page.$eval(sel, (n) => n.textContent);
    const shown = (sel) => page.$eval(sel, (n) => !n.hidden);
    const calls = () => page.evaluate(() => window.__calls);
    const reply = (fn) => page.evaluate((src) => { window.__reply = new Function('req', 'return (' + src + ')(req)'); }, fn.toString());
    const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
    const step = () => page.evaluate(() => ['1', '2', '3'].filter((k) => !document.getElementById('n_step' + k).hidden).join(''));

    // read-only page: no write UI
    await page.goto('file://' + readOnly);
    assert.strictEqual(await page.$('#n_add'), null, 'no + button when writes are off');
    assert.strictEqual(await page.evaluate(() => typeof window.google.script.run.appSave), 'function', 'fake is installed');
    assert.ok(!(await page.content()).includes('appSave('), 'no server call in the read-only page');

    await page.goto('file://' + file);
    assert.strictEqual(await page.evaluate(() => window.innerWidth), 390);
    assert.ok(await shown('#n_add') && !(await shown('#n_sheet')), 'button visible, sheet closed');

    // open, validation, live amount
    assert.strictEqual(await page.$('a.fab'), null, 'with writes on the + button stays the only button');
    await page.click('#n_add');
    assert.strictEqual(await page.$eval('#n_step1 a.tglink', (a) => [a.textContent, a.href, a.target].join('|')),
      'Atau catat lewat Telegram ›|https://t.me/c/1234567890/2|_top');
    assert.ok(await shown('#n_sheet') && !(await shown('#n_add')), 'sheet open hides the + button');
    assert.strictEqual(await page.$eval('#n_date', (i) => i.value), '2026-11-14', 'date defaults to today');
    assert.deepStrictEqual(await page.$$eval('#n_category option', (o) => o.map((x) => x.textContent)),
      ['Pilih kategori', 'Makan', 'Transport', 'Belanja']);
    await page.click('#n_next');
    assert.ok((await text('#n_err')).startsWith('Isi jumlah dulu'), await text('#n_err'));
    assert.strictEqual(await step(), '1');
    await page.type('#n_amount', '35a000');
    assert.strictEqual(await page.$eval('#n_amount', (i) => i.value), '35000', 'only digits stay');
    assert.strictEqual(await text('#n_amountshow'), 'Rp 35.000');
    await page.click('#n_next');
    assert.strictEqual(await text('#n_err'), 'Pilih kategori dulu.');
    await page.select('#n_category', 'Makan');
    await page.click('#n_next');
    assert.strictEqual(await text('#n_err'), 'Pilih akun dulu.');
    await page.select('#n_account', 'BNI');
    await page.$eval('#n_date', (i) => { i.value = '2026-11-15'; });
    await page.click('#n_next');
    assert.ok((await text('#n_err')).startsWith('Tanggal harus'), await text('#n_err'));
    await page.$eval('#n_date', (i) => { i.value = '2026-11-14'; });
    await page.type('#n_merchant', 'Kedai Zeta');
    assert.strictEqual(await text('#n_err'), '', 'the error clears as soon as the form is edited');
    assert.ok(await noScroll(), 'no sideways scroll with the sheet open');
    await shot('form-step1');

    // transfer layout
    await page.click('#n_types button[data-type=transfer]');
    assert.ok(!(await shown('#n_catwrap')) && await shown('#n_towrap'));
    assert.strictEqual(await text('#n_acclabel'), 'Dari akun');
    await page.select('#n_to', 'BNI');
    await page.click('#n_next');
    assert.strictEqual(await text('#n_err'), 'Akun asal dan tujuan tidak boleh sama.');
    await page.click('#n_types button[data-type=expense]');
    assert.ok(await shown('#n_catwrap') && !(await shown('#n_towrap')));
    assert.strictEqual(await page.$eval('#n_account', (s) => s.value), 'BNI', 'choices survive a type switch');

    // preview, PIN rules
    await page.select('#n_category', 'Makan');
    await page.click('#n_next');
    assert.strictEqual(await step(), '2');
    const pv = await text('#n_preview');
    assert.ok(['Pengeluaran', 'Rp 35.000', 'Makan', 'BNI', 'Kedai Zeta', '14 Nov 2026'].every((x) => pv.includes(x)), pv);
    assert.ok(await shown('#n_pinwrap'), 'PIN asked on the first save of this page load');
    await shot('form-step2');
    await page.click('#n_save');
    assert.ok((await text('#n_err2')).startsWith('Isi PIN'));
    await page.type('#n_pin', '123');
    await page.click('#n_save');
    assert.ok((await text('#n_err2')).startsWith('Isi PIN'));
    assert.strictEqual((await calls()).length, 0, 'no server call with a short PIN');

    // server refuses the PIN: message shown, PIN cleared, still on the preview
    await page.$eval('#n_pin', (i) => { i.value = ''; });
    await page.type('#n_pin', '000000');
    await reply((req) => ({ ok: false, error: 'PIN salah. Sisa percobaan: 4.' }));
    await page.keyboard.press('Enter'); // Enter in the PIN field saves
    await page.waitForFunction(() => document.getElementById('n_err2').textContent.includes('PIN salah'));
    assert.strictEqual(await page.$eval('#n_pin', (i) => i.value), '', 'wrong PIN is cleared');
    assert.strictEqual(await step(), '2');
    const first = (await calls())[0];
    assert.deepStrictEqual([first.token, first.pin, first.month, first.dupOk], ['tok en&1', '000000', '2026-11', false]);
    assert.deepStrictEqual(first.entry, { type: 'expense', amount: '35000', date: '2026-11-14', category: 'Makan', account: 'BNI',
      to_account: '', merchant: 'Kedai Zeta', note: '' });
    assert.ok(/^[a-z0-9-]{8,40}$/.test(first.rid), 'request id fits the server pattern: ' + first.rid);

    // network failure: retry keeps the same request id; the button is disabled while the call runs
    await page.type('#n_pin', '123456');
    await page.evaluate(() => { window.__delay = 400; });
    await reply(() => 'FAIL');
    await page.click('#n_save');
    assert.strictEqual(await page.$eval('#n_save', (b) => b.disabled), true, 'save disabled while pending');
    assert.strictEqual(await text('#n_save'), 'Menyimpan...');
    assert.strictEqual(await page.$eval('#n_back', (b) => b.disabled), true);
    await page.waitForFunction(() => document.getElementById('n_err2').textContent.includes('Tidak tersambung'));
    assert.strictEqual(await page.$eval('#n_save', (b) => b.disabled), false, 'save enabled again after a failure');
    assert.ok((await text('#n_err2')).includes('aman dari catatan ganda'));
    const failedCalls = await calls();
    assert.strictEqual(failedCalls.length, 2);

    // duplicate warning, then "Tetap simpan" with the same request id
    await page.evaluate(() => { window.__delay = 0; });
    await reply(() => ({ ok: false, duplicate: true, existing: '💸 Makan Rp35.000' }));
    await page.click('#n_save');
    await page.waitForFunction(() => !document.getElementById('n_dup').hidden);
    assert.strictEqual(await text('#n_save'), 'Tetap simpan');
    assert.ok((await text('#n_duptext')).includes('Rp35.000'));
    await shot('form-duplicate');

    // success: swap main, new row listed, PIN remembered for this page load
    const after = Object.assign({}, sample, { kpis: sample.kpis.map((k) => (k.label === 'TABUNGAN SEKARANG' ? Object.assign({}, k, { value: 'Rp 21,9 jt' }) : k)) });
    const mainHtml = app.appSections_(after, viewOf(newRows));
    await page.evaluate((m, r) => {
      window.__reply = () => ({ ok: true, id: 'abcd1234', text: '✅ Tersimpan!\n\n💸 Makan Rp35.000', main: m, rows: r });
    }, mainHtml, newRows);
    await page.click('#n_save');
    await page.waitForFunction(() => !document.getElementById('n_step3').hidden);
    assert.ok((await text('#n_result')).includes('Tersimpan'));
    const all = await calls();
    assert.strictEqual(all.length, 4);
    assert.strictEqual(all[3].dupOk, true, 'the confirmed duplicate is sent with dupOk');
    assert.ok(all.every((c) => c.rid === all[0].rid), 'one request id for the whole attempt');
    assert.strictEqual(all[3].pin, '123456');
    await shot('form-done');
    await page.click('#n_done');
    assert.ok(!(await shown('#n_sheet')) && await shown('#n_add'));
    await page.click('nav button[data-tab=ringkasan]');
    assert.ok((await text('main section[data-tab=ringkasan]')).includes('Rp 21,9 jt'), 'cards come from the response, no reload');
    await page.click('nav button[data-tab=transaksi]');
    assert.ok((await text('#count')).startsWith('15 dari 15'), await text('#count'));
    assert.ok((await text('#list')).includes('Kedai Zeta'), 'new row is listed without a reload');
    await page.type('#q', 'kedai zeta');
    assert.ok((await text('#count')).startsWith('1 dari 15'), 'filters still work after the swap: ' + await text('#count'));
    await page.click('#toggle');
    assert.strictEqual(await shown('#more'), true, 'filter toggle still works after the swap');
    await page.click('#reset');
    assert.ok((await text('#count')).startsWith('15 dari 15'));
    assert.ok(await noScroll());

    // Enter submits: from the amount field to the preview, and twice on the PIN field while the call runs sends one request
    await page.click('#n_add');
    await page.type('#n_amount', '10000');
    await page.select('#n_category', 'Belanja');
    await page.select('#n_account', 'BCA');
    await page.keyboard.press('Enter');
    assert.strictEqual(await step(), '2', 'Enter on the amount field goes to the preview');
    await page.click('#n_back');
    await page.click('#n_next');
    await page.evaluate(() => { window.__calls.length = 0; window.__delay = 400; window.__reply = () => ({ ok: false, error: 'Batas 30 transaksi per hari dari aplikasi.' }); });
    assert.strictEqual(await page.$eval('#n_pinwrap', (n) => n.hidden), true, 'PIN already known on this page load');
    await page.evaluate(() => { save(); save(); });
    await page.waitForFunction(() => document.getElementById('n_err2').textContent.includes('Batas 30'));
    assert.strictEqual((await calls()).length, 1, 'two saves while pending send one request');
    await page.evaluate(() => { window.__delay = 0; });
    await page.keyboard.press('Escape');
    assert.ok(!(await shown('#n_sheet')));

    // second entry: PIN is not asked again, a new request id is used
    await page.click('#n_add');
    await page.type('#n_amount', '20000');
    await page.select('#n_category', 'Transport');
    await page.select('#n_account', 'BCA');
    await page.click('#n_next');
    assert.ok(!(await shown('#n_pinwrap')), 'PIN is asked once per page load');
    await page.evaluate(() => { window.__reply = () => ({ ok: false, error: 'Batas 30 transaksi per hari dari aplikasi.' }); });
    await page.click('#n_save');
    await page.waitForFunction(() => document.getElementById('n_err2').textContent.includes('Batas 30'));
    const second = (await calls()).at(-1);
    assert.notStrictEqual(second.rid, all[0].rid, 'a new form opening gets a new request id');
    assert.strictEqual(second.pin, '123456');
    await page.click('#n_back');
    assert.strictEqual(await step(), '1');
    assert.strictEqual(await page.$eval('#n_amount', (i) => i.value), '20000', 'Ubah keeps the entered values');
    await page.keyboard.press('Escape');
    assert.ok(!(await shown('#n_sheet')), 'Escape closes the sheet');

    // dark mode and desktop width
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.click('#n_add');
    assert.strictEqual(await page.$eval('.sheet-body', (n) => getComputedStyle(n).backgroundColor), 'rgb(255, 255, 255)', 'the form stays light on a phone in dark mode');
    await shot('form-on-dark-phone');
    await page.setViewport({ width: 1280, height: 800 });
    assert.ok(await noScroll(), 'no sideways scroll at desktop width');

    assert.deepStrictEqual(outside, [], 'no request leaves the page');
    assert.deepStrictEqual(errors, [], 'no console or page errors');
    console.log('Form e2e OK');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
