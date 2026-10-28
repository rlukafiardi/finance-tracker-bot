// Generated `dashboard` tab: this month's numbers, a 12-month trend, this month's categories vs budget, 12 weeks of
// spending and account balances, each table with a native chart. Numbers come from the functions the bot answers
// with (sumRows_, accountBalances_), so the tab and the chat always agree. Rebuilt after every confirmed change and
// daily at 06:00 (month rollover, manual Sheet edits); manual edits to the tab itself are overwritten.

const DASH = 'dashboard';
// Validated categorical slots 1-3 (dataviz palette check). Spending is always orange, in every chart.
const COLOR_INCOME = '#2a78d6';
const COLOR_EXPENSE = '#eb6834';
const COLOR_SISA = '#1baf7a';
const MUTED = '#898781';
const SECTION_ROWS = 18; // a chart is ~16 rows tall; sections never start closer than this

function monthLabel_(dateStr) {
  return MONTHS_ID[Number(dateStr.slice(5, 7)) - 1].slice(0, 3) + ' ' + dateStr.slice(0, 4);
}

// Pure data assembly (no Sheet calls), so it can be checked outside Apps Script.
function dashboardData_(all, ctx, today, weekStart, budgets) {
  const month = { from: today.slice(0, 8) + '01', to: today };
  const cur = sumRows_(between_(all, month), ctx);

  const months = [month];
  while (months.length < 12) months.unshift(prevMonth_(months[0]));
  const trend = months.map(function (m) {
    const s = sumRows_(between_(all, m), ctx);
    return [monthLabel_(m.from), s.income, s.expense, s.kept, s.income > 0 ? (s.income - s.expense) / s.income : ''];
  });

  const limit = {};
  budgets.forEach(function (b) { limit[b.category] = b.limit; });
  const catNames = Object.keys(cur.byCat).sort(function (a, b) { return cur.byCat[b] - cur.byCat[a]; });
  budgets.forEach(function (b) { if (catNames.indexOf(b.category) < 0) catNames.push(b.category); });
  const cats = catNames.map(function (c) {
    const spent = cur.byCat[c] || 0;
    return [c, spent, limit[c] || '', limit[c] ? spent / limit[c] : ''];
  });

  const weeks = [{ from: weekStart, to: today }];
  while (weeks.length < 12) weeks.unshift(prevWeek_(weeks[0]));
  const weekly = weeks.map(function (w) { return [w.from, sumRows_(between_(all, w), ctx).expense]; });

  const bal = accountBalances_(ctx);
  const accounts = ctx.accounts.slice().sort(function (a, b) {
    return ACCOUNT_KINDS.indexOf(a.kind) - ACCOUNT_KINDS.indexOf(b.kind) || a.name.localeCompare(b.name);
  }).map(function (a) { return [a.name, KIND_LABEL[a.kind] || a.kind, bal[a.name]]; });
  const total = accounts.reduce(function (t, r) { return t + r[2]; }, 0);
  const tabungan = tabunganTotal_(ctx);

  return {
    kpis: [
      ['Pengeluaran bulan ini', cur.expense, '#,##0'],
      ['Pemasukan bulan ini', cur.income, '#,##0'],
      ['Sisa bulan ini', cur.kept, '#,##0'],
      ['Savings rate bulan ini', cur.income > 0 ? (cur.income - cur.expense) / cur.income : '-', '0.0%'],
      ['Tabungan (akun tabungan)', tabungan === null ? '-' : tabungan, '#,##0'],
      ['Total saldo akun', total, '#,##0'],
    ],
    trend: trend, cats: cats, weekly: weekly, accounts: accounts, total: total,
  };
}

function refreshDashboard() {
  const ss = spreadsheet_();
  const sh = ss.getSheetByName(DASH) || ss.insertSheet(DASH, 0);
  sh.getCharts().forEach(function (c) { sh.removeChart(c); });
  sh.clear();

  const ctx = { cats: getCategories_(), accounts: getAccounts_() };
  const d = dashboardData_(readTransactions_(), ctx, todayStr_(), periodRange_('week').from, getBudgets_());

  sh.getRange('A1').setValue('💰 Finance Dashboard').setFontSize(16).setFontWeight('bold');
  sh.getRange('A2').setValue('Diperbarui ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm') +
    ' · dibuat otomatis oleh bot, jangan diedit').setFontColor(MUTED);

  // Stat tiles: label above, big value below.
  d.kpis.forEach(function (k, i) {
    sh.getRange(4, i + 1).setValue(k[0]).setFontColor(MUTED);
    sh.getRange(5, i + 1).setValue(k[1]).setNumberFormat(k[2]).setFontSize(14).setFontWeight('bold');
  });

  let row = 7;
  row = section_(sh, row, 'Tren 12 bulan', ['Bulan', 'Pemasukan', 'Pengeluaran', 'Sisa', 'Savings rate'],
    d.trend, ['@', '#,##0', '#,##0', '#,##0', '0.0%'], function (range) {
      return chart_(sh, Charts.ChartType.COLUMN, range.offset(0, 0, range.getNumRows(), 4),
        'Pemasukan, pengeluaran dan sisa per bulan', [COLOR_INCOME, COLOR_EXPENSE, COLOR_SISA], true);
    });
  row = section_(sh, row, 'Pengeluaran per kategori, bulan ini', ['Kategori', 'Pengeluaran', 'Budget', '% budget'],
    d.cats, ['@', '#,##0', '#,##0', '0%'], function (range) {
      return chart_(sh, Charts.ChartType.BAR, range.offset(0, 0, range.getNumRows(), 2),
        'Pengeluaran per kategori, bulan ini', [COLOR_EXPENSE], false);
    });
  row = section_(sh, row, 'Pengeluaran 12 minggu (minggu mulai Senin)', ['Minggu', 'Pengeluaran'],
    d.weekly, ['@', '#,##0'], function (range) {
      return chart_(sh, Charts.ChartType.COLUMN, range, 'Pengeluaran per minggu', [COLOR_EXPENSE], false);
    });
  row = section_(sh, row, 'Saldo akun', ['Akun', 'Jenis', 'Saldo'],
    d.accounts.concat([['Total', '', d.total]]), ['@', '@', '#,##0'], null);

  sh.setColumnWidth(1, 170);
  sh.setColumnWidths(2, 4, 130);
}

// Title row, header row and data rows; with a chart to the right when makeChart is given and there is data.
// Returns the row where the next section starts.
function section_(sh, row, title, header, rows, formats, makeChart) {
  sh.getRange(row, 1).setValue(title).setFontWeight('bold').setFontSize(12);
  sh.getRange(row + 1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (!rows.length) {
    sh.getRange(row + 2, 1).setValue('Belum ada data').setFontColor(MUTED);
    return row + 4;
  }
  sh.getRange(row + 2, 1, rows.length, header.length).setValues(rows);
  formats.forEach(function (f, i) { sh.getRange(row + 2, i + 1, rows.length, 1).setNumberFormat(f); });
  if (!makeChart) return row + rows.length + 4;

  sh.insertChart(makeChart(sh.getRange(row + 1, 1, rows.length + 1, header.length)).setPosition(row, 7, 0, 0).build());
  return row + Math.max(rows.length + 4, SECTION_ROWS);
}

// One y-axis, thin recessive grid; a legend only when there is more than one series.
function chart_(sh, type, range, title, colors, legend) {
  const valueAxis = type === Charts.ChartType.BAR ? 'hAxis' : 'vAxis';
  return sh.newChart().setChartType(type).addRange(range).setNumHeaders(1)
    .setOption('title', title)
    .setOption('colors', colors)
    .setOption('legend', legend ? { position: 'top' } : { position: 'none' })
    .setOption(valueAxis + '.format', '#,##0')
    .setOption(valueAxis + '.gridlines.color', '#e5e5e2')
    .setOption('width', 640)
    .setOption('height', 320);
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
