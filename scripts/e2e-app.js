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

    // tap shows the numbers (no hover on a phone): week bars, hero bars, donut slice
    await page.click('nav button[data-tab=ringkasan]');
    assert.strictEqual(await page.$$eval('.weeks .wk', (b) => b.length), 6, 'November 2026 has six whole Monday-to-Sunday weeks');
    assert.strictEqual(await page.$$eval('.weeks .wk.future', (b) => b.length), 3, 'W4-W6 have not started on the 14th');
    assert.deepStrictEqual(await page.$$eval('.weeks .wl', (l) => l.map((x) => x.textContent)), ['W126 Okt–1 Nov', 'W22–8', 'W39–15', 'W416–22', 'W523–29', 'W630 Nov–6 Des']);
    assert.ok(await page.$$eval('.weeks .wk', (b) => b.every((x) => x.querySelector('.wl').scrollWidth <= x.clientWidth + 1)), 'week labels fit their column at 390 px');
    const capOf = (sel) => page.$eval(sel, (n) => n.textContent);
    assert.ok((await capOf('.panel .cap')).startsWith('November 2026 · Pengeluaran'), 'caption starts with the month total');
    await page.tap('.weeks .wk:nth-child(1)');
    assert.strictEqual(await capOf('.panel .cap'), await page.$eval('.weeks .wk:nth-child(1)', (b) => b.dataset.tip.split('|').join(' · ')));
    assert.ok((await capOf('.panel .cap')).startsWith('W1 · 26 Okt–1 Nov · Pengeluaran Rp 10 rb'), await capOf('.panel .cap'));
    assert.deepStrictEqual(await page.$$eval('.weeks .wk', (b) => b.map((x) => x.getAttribute('aria-pressed'))), ['true', 'false', 'false', 'false', 'false', 'false']);
    await page.tap('.weeks .wk:nth-child(4)');
    assert.strictEqual(await capOf('.panel .cap'), 'W4 · 16–22 Nov · belum berjalan');
    assert.deepStrictEqual(await page.$$eval('.weeks .wk', (b) => b.map((x) => x.getAttribute('aria-pressed'))), ['false', 'false', 'false', 'true', 'false', 'false'], 'one bar selected at a time');
    assert.strictEqual(await capOf('.spcap'), 'Ketuk batang untuk melihat Tabungan tiap bulan');
    await page.tap('.sprow .sp:nth-child(3)');
    assert.strictEqual(await capOf('.spcap'), 'Agu 2026 · Tabungan Rp 24 jt');
    assert.ok(await page.$eval('.spark', (n) => n.classList.contains('picked')) && await page.$eval('.sp:nth-child(3)', (n) => n.classList.contains('on')));
    await shot('phone-tap');
    await page.click('nav button[data-tab=kategori]');
    const donut = await (await page.$('.donut svg')).boundingBox();
    const tapSlice = async () => { // a real touch on the first slice's stroke (60 degrees clockwise from the top), not a dispatched event
      const r = donut.width * 40 / 120, a = Math.PI / 3;
      await page.touchscreen.tap(donut.x + donut.width / 2 + r * Math.sin(a), donut.y + donut.height / 2 - r * Math.cos(a));
    };
    assert.strictEqual(await capOf('.dc b'), 'Rp 4,2 jt');
    await tapSlice();
    assert.strictEqual(await capOf('.dc b'), 'Rp 1,7 jt');
    assert.strictEqual(await capOf('.dc small'), 'Makan · 39%');
    await shot('phone-donut-tap');
    await tapSlice();
    assert.deepStrictEqual([await capOf('.dc b'), await capOf('.dc small')], ['Rp 4,2 jt', 'pengeluaran'], 'tapping the slice again goes back to the total');
    await page.click('nav button[data-tab=ringkasan]');

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
