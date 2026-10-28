// Generated `dashboard` tab: five KPI cards, monthly trend, spending by category, weekly spending, account balances
// and budget bars on a fixed ~1100px grid. Chart data lives in the `dashboard_data` tab, which stays visible as the
// table view behind the charts. Values come from the same functions the bot answers with (sumRows_,
// accountBalances_), so the tab and the chat agree. Rebuilt after every confirmed change and daily at 06:00;
// manual edits to the tab are overwritten.

const DASH = 'dashboard';
const DATA_TAB = 'dashboard_data';
const FONT = 'Inter';

// Soft palette. True pastels fail the dataviz palette check (too light and gray to tell apart), so the pastel
// lives in the surfaces and the series are the softest colors that pass; their contrast on white is below 3:1,
// which is why every number is also printed in the cards and tables.
const COLOR_INCOME = '#6da7ec';
const COLOR_EXPENSE = '#ee9468';
const COLOR_SISA = '#55c29b';
const COLOR_NEUTRAL = '#8b87b8';
const INK = '#0b0b0b';
const INK2 = '#52514e';
const GRID = '#e5e5e2';
const HEADER_BG = '#dfe7f8';
const GOOD = '#0ca30c';
const WARN = '#fab219';
const CRIT = '#d03b3b';
const CARD_BG = { expense: '#fdeee5', income: '#e5f0fd', sisa: '#e3f6ee', rate: '#eeeaf9', tabungan: '#fdf4d9' };

// Columns A..P: margin, five two-column cards separated by narrow gaps, margin.
const GRID_COLS = [16, 105, 105, 12, 105, 105, 12, 105, 105, 12, 105, 105, 12, 105, 105, 16];
const CARD_COLS = [2, 5, 8, 11, 14];
const LEFT_COL = 2;  // chart blocks: B..I (654px) on the left, K..O (432px) on the right
const RIGHT_COL = 11;
const LEFT_W = 654;
const RIGHT_W = 432;
const BLOCK_ROWS = 16;
const CHART_H = 330;

function clamp_(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function pad2_(n) {
  return n < 10 ? '0' + n : String(n);
}

function colLetter_(n) {
  return String.fromCharCode(64 + n);
}

// 15738102 -> "Rp 15,7 jt", 74343 -> "Rp 74,3 rb", with a minus sign for negatives.
function compactRp_(n) {
  const abs = Math.abs(n);
  const fmt = function (v) { return String(Math.round(v * 10) / 10).replace('.', ','); };
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return sign + 'Rp ' + fmt(abs / 1e9) + ' M';
  if (abs >= 1e6) return sign + 'Rp ' + fmt(abs / 1e6) + ' jt';
  if (abs >= 1e3) return sign + 'Rp ' + fmt(abs / 1e3) + ' rb';
  return sign + 'Rp ' + Math.round(abs);
}

// Axis unit for a chart: juta once values reach a million, otherwise ribu.
function unitFor_(maxAbs) {
  return maxAbs >= 1e6 ? { div: 1e6, label: 'juta' } : { div: 1e3, label: 'ribu' };
}

function scaled_(v, unit) {
  return Math.round(v / unit.div * 100) / 100;
}

function monthLabel_(dateStr) {
  return MONTHS_ID[Number(dateStr.slice(5, 7)) - 1].slice(0, 3) + ' ' + dateStr.slice(0, 4);
}

function weekLabel_(dateStr) {
  return Number(dateStr.slice(8)) + ' ' + MONTHS_ID[Number(dateStr.slice(5, 7)) - 1].slice(0, 3);
}

// A change as { arrow, text, good }. good: true/false colors the arrow, null leaves it neutral.
function trend_(change, text, upIsGood) {
  if (change === 0) return { arrow: '•', text: text, good: null };
  return { arrow: change > 0 ? '▲' : '▼', text: text, good: (change > 0) === upIsGood };
}

function pctDelta_(cur, prev, upIsGood) {
  if (!prev) return { arrow: '', text: 'belum ada pembanding', good: null };
  const pct = Math.round((cur - prev) / Math.abs(prev) * 100);
  return trend_(pct, Math.abs(pct) + '% vs bulan lalu', upIsGood);
}

// Pure data assembly (no Sheet calls), so it can be checked outside Apps Script.
// Charts start at the first transaction (up to 12 months and 12 weeks) instead of showing months of zeros.
function dashboardData_(all, ctx, today, weekStart, budgets) {
  const month = { from: today.slice(0, 8) + '01', to: today };
  const first = all.reduce(function (m, r) { return r.date < m ? r.date : m; }, today);

  const monthsSince = (Number(today.slice(0, 4)) - Number(first.slice(0, 4))) * 12 +
    Number(today.slice(5, 7)) - Number(first.slice(5, 7)) + 1;
  const months = [month];
  while (months.length < clamp_(monthsSince, 1, 12)) months.unshift(prevMonth_(months[0]));
  const sums = months.map(function (m) { return sumRows_(between_(all, m)); });
  const tabunganAt = function (end) {
    return tabunganTotal_(ctx, all.filter(function (r) { return r.date <= end; }));
  };

  const unit = unitFor_(Math.max.apply(null, sums.map(function (s) {
    return Math.max(s.income, s.expense, Math.abs(s.kept));
  })));
  const trend = months.map(function (m, i) {
    const s = sums[i];
    const t = tabunganAt(m.to);
    return [monthLabel_(m.from), scaled_(s.income, unit), scaled_(s.expense, unit), scaled_(s.kept, unit),
      s.income > 0 ? s.kept / s.income : '', t === null ? '' : scaled_(t, unit)];
  });

  // KPI cards compare month-to-date with the same days of last month.
  const cur = sums[sums.length - 1];
  const lastMonth = prevMonth_(month);
  const prevTo = lastMonth.from.slice(0, 8) +
    pad2_(Math.min(Number(today.slice(8, 10)), Number(lastMonth.to.slice(8, 10))));
  const prev = sumRows_(between_(all, { from: lastMonth.from, to: prevTo }));
  const rate = function (s) { return s.income > 0 ? s.kept / s.income : null; };
  const nowBal = tabunganAt(today);
  const startBal = tabunganAt(addDays_(month.from, -1));

  const rateNow = rate(cur);
  const ratePrev = rate(prev);
  const kpis = [
    { label: 'PENGELUARAN', value: compactRp_(cur.expense), bg: CARD_BG.expense, spark: [3, COLOR_EXPENSE],
      delta: pctDelta_(cur.expense, prev.expense, false) },
    { label: 'PEMASUKAN', value: compactRp_(cur.income), bg: CARD_BG.income, spark: [2, COLOR_INCOME],
      delta: pctDelta_(cur.income, prev.income, true) },
    { label: 'SISA BULAN INI', value: compactRp_(cur.kept), bg: CARD_BG.sisa, spark: [4, COLOR_SISA],
      delta: pctDelta_(cur.kept, prev.kept, true) },
    { label: 'SAVINGS RATE', value: rateNow === null ? '–' : Math.round(rateNow * 100) + '%', bg: CARD_BG.rate,
      spark: [5, COLOR_NEUTRAL],
      delta: rateNow === null || ratePrev === null
        ? { arrow: '', text: 'belum ada pembanding', good: null }
        : trend_(Math.round((rateNow - ratePrev) * 100), Math.abs(Math.round((rateNow - ratePrev) * 100)) + ' poin vs bulan lalu', true) },
    { label: 'TABUNGAN SEKARANG', value: nowBal === null ? '–' : compactRp_(nowBal), bg: CARD_BG.tabungan,
      spark: [6, COLOR_NEUTRAL],
      delta: nowBal === null
        ? { arrow: '', text: 'belum ada akun bank atau cash', good: null }
        : trend_(nowBal - startBal, compactRp_(Math.abs(nowBal - startBal)) + ' sejak awal bulan', true) },
  ];

  // Categories: top 8, the rest folded into "Lain-lain".
  const names = Object.keys(cur.byCat).sort(function (a, b) { return cur.byCat[b] - cur.byCat[a]; });
  const catRaw = names.slice(0, 8).map(function (n) { return [n, cur.byCat[n]]; });
  const rest = names.slice(8).reduce(function (t, n) { return t + cur.byCat[n]; }, 0);
  if (rest) catRaw.push(['Lain-lain', rest]);
  const catUnit = unitFor_(Math.max.apply(null, catRaw.map(function (c) { return c[1]; }).concat([0])));
  const cats = catRaw.map(function (c) { return [c[0], scaled_(c[1], catUnit)]; });

  const budgetRows = budgets.map(function (b) {
    const spent = cur.byCat[b.category] || 0;
    return { category: b.category, spent: spent, limit: b.limit, pct: Math.round(spent / b.limit * 100) };
  }).sort(function (a, b) { return b.pct - a.pct; });

  const weekDays = (Utilities.parseDate(weekStart, TZ, 'yyyy-MM-dd') - Utilities.parseDate(first, TZ, 'yyyy-MM-dd')) / 86400000;
  const weeks = [{ from: weekStart, to: today }];
  while (weeks.length < clamp_(Math.ceil(weekDays / 7) + 1, 1, 12)) weeks.unshift(prevWeek_(weeks[0]));
  const weekSpend = weeks.map(function (w) { return sumRows_(between_(all, w)).expense; });
  const weekUnit = unitFor_(Math.max.apply(null, weekSpend));
  const weekly = weeks.map(function (w, i) { return [weekLabel_(w.from), scaled_(weekSpend[i], weekUnit)]; });

  const bal = accountBalances_(ctx, all);
  const accounts = ctx.accounts.slice().sort(function (a, b) {
    return ACCOUNT_KINDS.indexOf(a.kind) - ACCOUNT_KINDS.indexOf(b.kind) || a.name.localeCompare(b.name);
  }).map(function (a) {
    return { name: (KIND_LABEL[a.kind] || '').split(' ')[0] + ' ' + a.name, balance: bal[a.name] };
  });

  return {
    title: MONTHS_ID[Number(month.from.slice(5, 7)) - 1] + ' ' + month.from.slice(0, 4),
    kpis: kpis, trend: { unit: unit, rows: trend }, cats: { unit: catUnit, rows: cats },
    budgets: budgetRows, weekly: { unit: weekUnit, rows: weekly }, accounts: accounts,
    total: accounts.reduce(function (t, a) { return t + a.balance; }, 0),
  };
}

function writeData_(ds, d) {
  ds.clear();
  const put = function (col, header, rows) {
    ds.getRange(1, col, 1, header.length).setValues([header]).setFontWeight('bold');
    if (rows.length) ds.getRange(2, col, rows.length, header.length).setValues(rows);
  };
  put(1, ['Bulan', 'Pemasukan (' + d.trend.unit.label + ')', 'Pengeluaran (' + d.trend.unit.label + ')',
    'Sisa (' + d.trend.unit.label + ')', 'Savings rate', 'Tabungan (' + d.trend.unit.label + ')'], d.trend.rows);
  put(8, ['Kategori', 'Pengeluaran (' + d.cats.unit.label + ')'], d.cats.rows);
  put(11, ['Minggu', 'Pengeluaran (' + d.weekly.unit.label + ')'], d.weekly.rows);
  ds.getRange('E:E').setNumberFormat('0%');
  ds.setTabColor('#c3c2b7');
}

function sparkColumn_(col, rows, color) {
  const L = colLetter_(col);
  return '=SPARKLINE(' + DATA_TAB + '!' + L + '2:' + L + (rows + 1) + ',{"charttype","column";"color","' + color +
    '";"negcolor","' + COLOR_EXPENSE + '"})';
}

function setDelta_(cell, delta) {
  const text = (delta.arrow ? delta.arrow + ' ' : '') + delta.text;
  const color = delta.good === true ? GOOD : delta.good === false ? CRIT : INK2;
  const body = SpreadsheetApp.newTextStyle().setForegroundColor(INK2).setFontSize(10).build();
  const arrow = SpreadsheetApp.newTextStyle().setForegroundColor(color).setFontSize(10).setBold(true).build();
  const rich = SpreadsheetApp.newRichTextValue().setText(text).setTextStyle(0, text.length, body);
  if (delta.arrow) rich.setTextStyle(0, 1, arrow);
  cell.setRichTextValue(rich.build());
}

// One native chart. valueAxis is the axis that carries the numbers ('vAxis' for columns, 'hAxis' for bars).
function addChart_(sh, type, range, row, col, width, colors, valueAxis, unit, legend) {
  const text = { color: INK2, fontSize: 10 };
  return sh.insertChart(sh.newChart().setChartType(type).addRange(range).setNumHeaders(1)
    .setPosition(row, col, 0, 0)
    .setOption('width', width).setOption('height', CHART_H)
    .setOption('colors', colors).setOption('fontName', FONT)
    .setOption('legend', legend ? { position: 'top', textStyle: { color: INK2, fontSize: 11 } } : { position: 'none' })
    .setOption('hAxis.textStyle', text).setOption('vAxis.textStyle', text)
    .setOption(valueAxis + '.gridlines.color', GRID)
    .setOption(valueAxis + '.format', '#,##0.#')
    .setOption(valueAxis + '.title', 'Rp ' + unit.label)
    .setOption(valueAxis + '.titleTextStyle', { color: INK2, fontSize: 10, italic: false })
    .setOption('bar.groupWidth', '60%')
    .build());
}

function sectionTitle_(sh, row, col, width, text) {
  sh.getRange(row, col).setValue(text).setFontSize(12).setFontWeight('bold').setFontColor(INK);
  sh.getRange(row, col, 1, width).setBorder(null, null, true, null, null, null, GRID, SpreadsheetApp.BorderStyle.SOLID);
}

function renderDashboard_(sh, ds, d, updated) {
  sh.getCharts().forEach(function (c) { sh.removeChart(c); });
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  sh.clear();
  sh.setHiddenGridlines(true);
  sh.setFrozenRows(2);
  sh.setTabColor(HEADER_BG);
  GRID_COLS.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  if (sh.getMaxColumns() > GRID_COLS.length) sh.hideColumns(GRID_COLS.length + 1, sh.getMaxColumns() - GRID_COLS.length);
  sh.getRange(1, 1, sh.getMaxRows(), GRID_COLS.length).setFontFamily(FONT).setFontColor(INK).setVerticalAlignment('middle');
  sh.setRowHeights(9, 70, 24);
  [[1, 56], [2, 26], [3, 12], [4, 24], [5, 44], [6, 22], [7, 38], [8, 18]].forEach(function (h) { sh.setRowHeight(h[0], h[1]); });

  sh.getRange(1, 1, 2, GRID_COLS.length).setBackground(HEADER_BG);
  sh.getRange(1, 2).setValue('💰 Finance Dashboard').setFontSize(20).setFontWeight('bold');
  sh.getRange(2, 2).setValue(d.title + ' · diperbarui ' + updated).setFontSize(10).setFontColor(INK2);

  const trendRows = d.trend.rows.length;
  d.kpis.forEach(function (k, i) {
    const c = CARD_COLS[i];
    sh.getRange(4, c, 4, 2).setBackground(k.bg).setHorizontalAlignment('left');
    for (let r = 4; r <= 7; r++) sh.getRange(r, c, 1, 2).merge();
    sh.getRange(4, c).setValue(k.label).setFontSize(9).setFontWeight('bold').setFontColor(INK2);
    sh.getRange(5, c).setValue(k.value).setFontSize(22).setFontWeight('bold');
    setDelta_(sh.getRange(6, c), k.delta);
    sh.getRange(7, c).setFormula(sparkColumn_(k.spark[0], trendRows, k.spark[1]));
  });

  // Block A: monthly trend (left) and this month's categories (right).
  const rowA = 9;
  sectionTitle_(sh, rowA, LEFT_COL, 8, 'Tren bulanan');
  sectionTitle_(sh, rowA, RIGHT_COL, 5, 'Pengeluaran per kategori · bulan ini');
  addChart_(sh, Charts.ChartType.COLUMN, ds.getRange(1, 1, trendRows + 1, 4), rowA + 1, LEFT_COL, LEFT_W,
    [COLOR_INCOME, COLOR_EXPENSE, COLOR_SISA], 'vAxis', d.trend.unit, true);
  if (d.cats.rows.length) {
    addChart_(sh, Charts.ChartType.BAR, ds.getRange(1, 8, d.cats.rows.length + 1, 2), rowA + 1, RIGHT_COL, RIGHT_W,
      [COLOR_EXPENSE], 'hAxis', d.cats.unit, false);
  } else {
    sh.getRange(rowA + 1, RIGHT_COL).setValue('Belum ada pengeluaran bulan ini').setFontColor(INK2);
  }

  // Block B: weekly spending (left) and account balances with in-cell bars (right).
  const rowB = rowA + BLOCK_ROWS + 2;
  sectionTitle_(sh, rowB, LEFT_COL, 8, 'Pengeluaran per minggu');
  sectionTitle_(sh, rowB, RIGHT_COL, 5, 'Saldo akun');
  addChart_(sh, Charts.ChartType.COLUMN, ds.getRange(1, 11, d.weekly.rows.length + 1, 2), rowB + 1, LEFT_COL, LEFT_W,
    [COLOR_EXPENSE], 'vAxis', d.weekly.unit, false);

  const first = rowB + 1;
  const last = first + d.accounts.length - 1;
  d.accounts.forEach(function (a, i) {
    const r = first + i;
    sh.getRange(r, RIGHT_COL, 1, 2).merge().setValue(a.name);
    sh.getRange(r, 14).setValue(a.balance).setNumberFormat('"Rp "#,##0;-"Rp "#,##0').setHorizontalAlignment('right');
    sh.getRange(r, 15).setFormula('=SPARKLINE(MAX(0,N' + r + '),{"charttype","bar";"max",MAX(1,MAX($N$' + first + ':$N$' +
      last + '));"color1","' + COLOR_INCOME + '"})');
  });
  const totalRow = last + 1;
  sh.getRange(totalRow, RIGHT_COL, 1, 2).merge().setValue('Total').setFontWeight('bold');
  sh.getRange(totalRow, 14).setValue(d.total).setNumberFormat('"Rp "#,##0;-"Rp "#,##0').setFontWeight('bold')
    .setHorizontalAlignment('right');
  sh.getRange(totalRow, RIGHT_COL, 1, 5).setBorder(true, null, null, null, null, null, GRID, SpreadsheetApp.BorderStyle.SOLID);

  // Block C: budgets with progress bars (full width), below whichever side of block B is taller.
  const rowC = Math.max(rowB + BLOCK_ROWS + 2, totalRow + 3);
  sectionTitle_(sh, rowC, LEFT_COL, 14, 'Budget bulan ini');
  if (!d.budgets.length) {
    sh.getRange(rowC + 1, LEFT_COL).setValue('Belum ada budget. Ketik "budget makan 1,5jt" di chat.').setFontColor(INK2);
  }
  d.budgets.forEach(function (b, i) {
    const r = rowC + 1 + i;
    const color = b.pct >= 100 ? CRIT : b.pct >= 80 ? WARN : COLOR_INCOME;
    sh.getRange(r, 2, 1, 2).merge().setValue(b.category);
    sh.getRange(r, 5, 1, 2).merge().setValue(compactRp_(b.spent) + ' / ' + compactRp_(b.limit)).setFontColor(INK2);
    sh.getRange(r, 8, 1, 5).merge().setFormula('=SPARKLINE(' + b.spent + ',{"charttype","bar";"max",' + b.limit +
      ';"color1","' + color + '"})');
    sh.getRange(r, 14, 1, 2).merge().setValue(b.pct + '%' + (b.pct >= 100 ? ' 🚨' : b.pct >= 80 ? ' ⚠️' : ''))
      .setHorizontalAlignment('right').setFontWeight('bold');
  });
}

function refreshDashboard() {
  const ss = spreadsheet_();
  const ctx = { accounts: getAccounts_() };
  const d = dashboardData_(readTransactions_(), ctx, todayStr_(), periodRange_('week').from, getBudgets_());
  const ds = ss.getSheetByName(DATA_TAB) || ss.insertSheet(DATA_TAB, ss.getNumSheets());
  const sh = ss.getSheetByName(DASH) || ss.insertSheet(DASH, 0);
  writeData_(ds, d);
  renderDashboard_(sh, ds, d, Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'));
}

// Called after each confirmed change. The change is already saved and answered, so a failed refresh only leaves
// the tab stale until the next refresh: it is logged, not reported in the chat.
function refreshDashboardAfterChange_() {
  try {
    refreshDashboard();
  } catch (err) {
    console.error('Dashboard refresh failed: ' + (err && err.stack ? err.stack : err));
  }
}
