// Real-browser check of the phone page on the installed Chrome: month picker, tabs, filters, phone width, dark mode,
// and that no request leaves the page except the two month changes it asks for (mocked and counted).
// Usage: node scripts/e2e-app.js [screenshot-dir]
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const puppeteer = require('puppeteer-core');
const { loadApp, sample, sampleRows, nav, viewOf } = require('./app-fixture');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const shots = process.argv[2];
const app = loadApp();

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-e2e-'));
  const small = path.join(dir, 'small.html');
  const big = path.join(dir, 'big.html');
  fs.writeFileSync(small, app.appPage_(sample, '14/11 10:30', viewOf(sampleRows(12)), nav));
  const tgPage = path.join(dir, 'tg.html');
  fs.writeFileSync(tgPage, app.appPage_(sample, '14/11 10:30', Object.assign(viewOf(sampleRows(12)), { telegram: 'https://t.me/c/1234567890/2' }), nav));
  fs.writeFileSync(big, app.appPage_(sample, '14/11 10:30', viewOf(sampleRows(130)), nav));

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage();
    const asked = [];
    const outside = [];
    const errors = [];
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const url = r.url();
      if (url.endsWith('/favicon.ico')) { r.respond({ status: 204, body: '' }); return; } // Chrome's own, on the mocked page
      if (url.startsWith(nav.base)) { asked.push(url); r.respond({ status: 200, contentType: 'text/html', body: '<p>ok</p>' }); return; }
      if (!url.startsWith('file://') && !url.startsWith('data:')) outside.push(url);
      r.continue();
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const open = async (file) => {
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.goto('file://' + file);
      await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
      await page.reload();
    };
    await open(small);
    assert.strictEqual(await page.evaluate(() => window.innerWidth), 390, 'layout width is the phone width');

    const visible = () => page.$$eval('main section[data-tab]', (s) => s.filter((x) => !x.hidden).map((x) => x.dataset.tab));
    const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    const text = (sel) => page.$eval(sel, (n) => n.textContent);
    const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };

    assert.deepStrictEqual(await visible(), ['ringkasan'], 'starts on Ringkasan');
    assert.ok((await text('.hero')).includes('Rp 21,5 jt') && (await text('.hero')).includes('Tabungan sekarang'), 'hero shows the money held');

    for (const tab of ['kategori', 'transaksi', 'akun', 'ringkasan']) {
      await page.click(`nav button[data-tab=${tab}]`);
      assert.deepStrictEqual(await visible(), [tab], 'tab ' + tab);
      assert.strictEqual(await page.$eval(`nav button[data-tab=${tab}]`, (b) => b.getAttribute('aria-selected')), 'true');
      assert.ok(await noScroll(), 'no horizontal scroll on ' + tab);
      await shot('phone-' + tab);
    }

    // transaction list and filters
    await page.click('nav button[data-tab=transaksi]');
    const listed = () => page.$$eval('#list .tx', (r) => r.length);
    assert.strictEqual(await text('#count'), '14 dari 14 transaksi · Pengeluaran Rp 186.000 · Pemasukan Rp 5.000.000');
    assert.strictEqual(await listed(), 14);
    assert.ok((await text('#list')).includes('BNI → ShopeePay'), 'transfer row shows both accounts');
    assert.strictEqual(await page.$eval('#more', (n) => n.hidden), true, 'extra filters start collapsed');
    await page.click('#toggle');
    assert.strictEqual(await page.$eval('#toggle', (n) => n.getAttribute('aria-expanded')), 'true');
    await page.type('#q', 'toko 1');
    assert.ok((await text('#count')).startsWith('3 dari 14'), 'Toko 1, Toko 10 and Toko 11 match: ' + await text('#count'));
    await shot('phone-filter');
    await page.click('#reset');
    assert.strictEqual(await listed(), 14, 'reset clears the filters');
    await page.select('#ftype', 'income');
    assert.strictEqual(await listed(), 1);
    assert.strictEqual(await text('#toggle'), 'Filter \u00b7 1', 'button shows the active filter count');
    await page.click('#reset');
    await page.select('#fcat', 'Makan');
    await page.select('#facc', 'BCA');
    const both = await listed();
    assert.ok(both > 0 && both < 14, 'category and account combine');
    await page.click('#reset');
    await page.type('#fmin', '1a2e3');
    assert.strictEqual(await page.$eval('#fmin', (i) => i.value), '123', 'only digits stay in the amount field');
    await page.click('#reset');
    await page.type('#q', 'zzzz');
    assert.ok((await text('#list')).includes('Tidak ada transaksi yang cocok'), 'empty result explains itself');
    await page.click('#reset');
    assert.ok(await noScroll(), 'no horizontal scroll with the long merchant name');

    // month picker: arrows and select ask for the right URLs, token intact
    assert.strictEqual(asked.length, 0, 'nothing requested yet');
    await page.click('a.arrow[aria-label="Bulan sebelumnya"]');
    await page.waitForFunction(() => document.body.textContent.trim() === 'ok');
    await open(small);
    await page.select('#month', '2026-09');
    await page.waitForFunction(() => document.body.textContent.trim() === 'ok');
    assert.deepStrictEqual(asked, [
      'https://example.test/exec?token=tok%20en%261&month=2026-10',
      'https://example.test/exec?token=tok%20en%261&month=2026-09',
    ], 'month changes request the right URLs');
    assert.strictEqual(await (async () => { await open(small); return page.$eval('span.arrow.off', (n) => n.textContent); })(), '›', 'no next month after the current one');

    // remembered tab, always light
    await page.click('nav button[data-tab=akun]');
    await page.reload();
    assert.deepStrictEqual(await visible(), ['akun'], 'last tab is remembered');
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
    assert.strictEqual(await page.$eval('body', (b) => getComputedStyle(b).backgroundColor), 'rgb(242, 244, 248)', 'light background on a phone in dark mode');
    assert.strictEqual(await page.$eval('html', (h) => getComputedStyle(h).colorScheme), 'light', 'native controls stay light');
    assert.strictEqual(await page.$eval('nav', (n) => getComputedStyle(n).backgroundColor), 'rgb(255, 255, 255)');
    await page.click('nav button[data-tab=transaksi]');
    await shot('phone-transaksi-on-dark-phone');

    // a long month: the list is capped and says so
    await open(big);
    await page.click('nav button[data-tab=transaksi]');
    assert.strictEqual(await listed(), 100, 'list shows at most 100 rows');
    assert.ok((await text('#list')).includes('Menampilkan 100 teratas'), 'cap is explained');
    assert.ok((await text('#count')).startsWith('132 dari 132'));

    // Telegram button (writes off): bottom right, above the nav, opens the topic in the top window
    await open(tgPage);
    const tg = await page.$('a.fab');
    await shot('phone-telegram');
    assert.strictEqual(await page.$eval('a.fab', (a) => [a.href, a.target, a.getAttribute('aria-label')].join('|')),
      'https://t.me/c/1234567890/2|_top|Catat lewat Telegram');
    const box = await tg.boundingBox();
    const navBox = await (await page.$('nav')).boundingBox();
    assert.ok(box.y + box.height <= navBox.y && box.x + box.width <= 390, 'button sits above the nav inside the screen');
    await open(small);
    assert.strictEqual(await page.$('a.fab'), null, 'no link configured, no button');

    await page.setViewport({ width: 1280, height: 800 });
    assert.ok(await noScroll(), 'no horizontal scroll at desktop width');

    assert.deepStrictEqual(outside, [], 'no request leaves the page');
    assert.deepStrictEqual(errors, [], 'no console or page errors');
    console.log('App e2e OK');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
