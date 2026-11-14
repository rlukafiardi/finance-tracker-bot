// Sheet dashboard wiring and Telegram recap text, on the made-up ledger, with a recording fake of the Sheet.
// It checks which cells and ranges get written, not how the sheet looks: look at the tab after a deploy.
// Usage: node scripts/test-dashboard.js
const assert = require('assert');
const { loadApp, ledger, accounts, budgets, today } = require('./app-fixture');

function recorder(log, name) {
  return new Proxy(function () {}, {
    get(t, prop) {
      if (prop === '__name') return name;
      if (prop === 'then' || prop === Symbol.toPrimitive) return undefined;
      return (...args) => {
        log.push({ target: name, method: String(prop), args });
        if (['getMaxRows', 'getMaxColumns', 'getLastRow'].includes(prop)) return 100;
        if (prop === 'getCharts') return [];
        return recorder(log, name + '.' + String(prop) + '(' + args.map((a) => (a && a.__name) || JSON.stringify(a)).join(',') + ')');
      };
    },
  });
}

const app = loadApp();
const model = app.appModel_(ledger, accounts, budgets, '2026-11', today);
const plain = (v) => JSON.parse(JSON.stringify(v));

// the data tab
{
  const log = [];
  app.writeData_(recorder(log, 'ds'), model.d);
  const header = log.find((c) => c.method === 'setValues' && c.target === 'ds.getRange(1,1,1,4)');
  assert.deepStrictEqual(plain(header.args[0]), [['Bulan', 'Pemasukan (juta)', 'Pengeluaran (juta)', 'Tabungan (juta)']]);
  assert.ok(!log.some((c) => c.method === 'getRange' && c.args[0] === 'E:E'), 'no savings-rate column to format');
}

// the dashboard tab
{
  const log = [];
  const ctx = app;
  ctx.SpreadsheetApp = recorder(log, 'SpreadsheetApp');
  ctx.Charts = recorder(log, 'Charts');
  app.renderDashboard_(recorder(log, 'sh'), recorder(log, 'ds'), model.d, '14/11 10:30');
  const rangeCalls = log.filter((c) => c.target === 'sh' && c.method === 'getRange').map((c) => c.args.join(','));
  ['4,2,4,8', '4,11,4,2', '4,14,4,2'].forEach((r) => assert.ok(rangeCalls.includes(r), 'card block ' + r));
  ['4,5,4,2', '4,8,4,2'].forEach((r) => assert.ok(!rangeCalls.includes(r), 'old card slot ' + r + ' is not used'));
  [4, 5, 6, 7].forEach((row) => assert.ok(rangeCalls.includes(row + ',2,1,8'), 'wide card merged on row ' + row));
  const merged = log.filter((c) => c.method === 'merge').length;
  assert.ok(merged >= 12, 'three cards, four rows each');

  const labels = log.filter((c) => c.method === 'setValue' && c.target.startsWith('sh.getRange(4,')).map((c) => c.args[0]);
  assert.deepStrictEqual(labels, ['TABUNGAN SEKARANG', 'PENGELUARAN', 'PEMASUKAN']);
  const spark = (col) => log.find((c) => c.method === 'setFormula' && c.target === 'sh.getRange(7,' + col + ')').args[0];
  assert.ok(spark(2).includes('dashboard_data!D2:D'), 'Tabungan card draws column D');
  assert.ok(spark(11).includes('dashboard_data!C2:C'), 'Pengeluaran card draws column C');
  assert.ok(spark(14).includes('dashboard_data!B2:B'), 'Pemasukan card draws column B');

  const trendChart = log.find((c) => c.method === 'addRange' && /ds\.getRange\(1,1,\d+,3\)$/.test(c.args[0].__name));
  assert.ok(trendChart, 'trend chart reads Bulan, Pemasukan, Pengeluaran only');
  const colors = log.find((c) => c.method === 'setOption' && c.args[0] === 'colors' && c.args[1].length === 2);
  assert.ok(colors, 'two series colours in the trend chart');
  assert.ok(!log.some((c) => c.method === 'setOption' && c.args[0] === 'colors' && c.args[1].length === 3), 'no third (sisa) series');
}

// Telegram recaps: no sisa line, no savings rate
{
  const s = app.sumRows_(ledger.filter((r) => r.date >= '2026-10-01' && r.date <= '2026-10-31'));
  const totals = app.totalsLines_(s, 3).join('\n');
  assert.ok(totals.includes('Pengeluaran: Rp370.000') && totals.includes('Pemasukan: Rp10.000.000'), totals);
  assert.ok(!/Sisa|⚖️/.test(totals), 'weekly and monthly totals have no sisa line');

  app.readTransactions_ = () => ledger;
  app.getBudgets_ = () => [];
  app.todayStr_ = () => today;
  const lines = app.monthRecapLines_({ from: '2026-10-01', to: '2026-10-31' }, { accounts: accounts }, ledger).join('\n');
  assert.ok(lines.includes('Tabungan sekarang'), 'recap still ends with the money held');
  assert.ok(!/Sisa|Savings rate|📈/.test(lines), 'monthly recap has no sisa or savings rate: ' + lines);
}

// explicit questions are still answered (they are asked for)
{
  app.readTransactions_ = () => ledger;
  app.todayStr_ = () => today;
  const out = app.answerQuery_({ metric: 'balance', period: 'month' }, { accounts: accounts });
  assert.ok(out.startsWith('Sisa '), 'an explicit "sisa bulan ini?" is still answered: ' + out);
}

console.log('Dashboard tests OK');
