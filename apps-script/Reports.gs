// Scheduled messages to the Finance topic, set up once with installSchedules(): a recap of last week every Monday
// and of last month (plus a Sheet backup) on the 1st, both at 09:00 WIB (script time zone Asia/Jakarta).

const ALERT_PCT = 20; // spending this far above or below the recent average gets called out
const BACKUP_FOLDER = 'finance-tracker backups';
const MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September',
  'Oktober', 'November', 'Desember'];

// Safe to re-run. This project has no other triggers, so all of them are replaced.
function installSchedules() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('weeklySummary').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
  ScriptApp.newTrigger('monthlySummary').timeBased().onMonthDay(1).atHour(9).create();
  ScriptApp.newTrigger('refreshDashboard').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('scheduledRecurring').timeBased().everyDays(1).atHour(RECURRING_HOUR).create();
  if (optionalProp_('EMAIL_SINCE')) {
    EMAIL_HOURS.forEach(function (h) { ScriptApp.newTrigger('scheduledEmailImport').timeBased().everyDays(1).atHour(h).create(); });
  }
  console.log('Scheduled (WIB): weekly recap Monday 09-10h, monthly recap and backup on the 1st 09-10h, ' +
    'dashboard refresh daily 06-07h, recurring entries daily ' + RECURRING_HOUR + '-' + (RECURRING_HOUR + 1) + 'h' + (optionalProp_('EMAIL_SINCE') ? ', bank email import at ' + EMAIL_HOURS.join(', ') + 'h.' : '.'));
}

// Reports go to the first ALLOWED_CHAT_ID (the group), inside FINANCE_TOPIC_ID.
function reportTarget_() {
  const topic = optionalProp_('FINANCE_TOPIC_ID');
  return { chatId: idList_(prop_('ALLOWED_CHAT_ID'))[0], threadId: topic ? Number(topic) : null };
}

function addDays_(dateStr, n) {
  const d = Utilities.parseDate(dateStr, TZ, 'yyyy-MM-dd');
  return Utilities.formatDate(new Date(d.getTime() + n * 86400000), TZ, 'yyyy-MM-dd');
}

function between_(rows, range) {
  return rows.filter(function (r) { return r.date >= range.from && r.date <= range.to; });
}

function prevWeek_(range) {
  return { from: addDays_(range.from, -7), to: addDays_(range.from, -1) };
}

function prevMonth_(range) {
  const to = addDays_(range.from, -1);
  return { from: to.slice(0, 8) + '01', to: to };
}

// Sums for up to n periods before `range`. Periods that ended before tracking started are skipped, so they do not
// count as zero spending and drag the average down.
function pastPeriods_(rows, range, n, previous) {
  const first = rows.reduce(function (m, r) { return r.date < m ? r.date : m; }, range.from);
  const past = [];
  let r = range;
  for (let i = 0; i < n; i++) {
    r = previous(r);
    if (r.to < first) break;
    past.push(sumRows_(between_(rows, r)));
  }
  return past;
}

// One line per expense category, biggest first, with its share of the total. Only the first n are listed; the rest
// is summed in one last line, so nothing silently disappears.
function categoryLines_(byCat, total, n) {
  const names = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
  const entries = names.slice(0, n).map(function (c) {
    return emojiFor_({ category: c, type: 'expense' }) + ' ' + c + ' ' + rupiah_(byCat[c]) +
      ' (' + Math.round(byCat[c] / total * 100) + '%)';
  });
  const rest = names.slice(n);
  if (rest.length) {
    entries.push('… ' + rest.length + ' kategori lain ' + rupiah_(rest.reduce(function (t, c) { return t + byCat[c]; }, 0)));
  }
  return entries.map(function (e, i) { return (i === entries.length - 1 ? '   └ ' : '   ├ ') + e; });
}

function totalsLines_(s, topN) {
  const lines = ['💸 Pengeluaran: ' + rupiah_(s.expense)];
  if (s.expense) lines.push.apply(lines, categoryLines_(s.byCat, s.expense, topN));
  lines.push('💰 Pemasukan: ' + rupiah_(s.income), '⚖️ Sisa: ' + rupiah_(s.kept));
  return lines;
}

// The current tabungan balance as a one-line array, empty when there are no tabungan accounts.
function tabunganLine_(ctx) {
  const total = tabunganTotal_(ctx);
  return total === null ? [] : ['🪙 Tabungan sekarang: ' + rupiah_(total)];
}

function weeklySummary() {
  const ctx = { cats: getCategories_(), accounts: getAccounts_() };
  const all = readTransactions_();
  const week = prevWeek_(periodRange_('week'));
  const s = sumRows_(between_(all, week));

  const lines = ['📅 Rekap minggu lalu (' + week.from + ' s/d ' + week.to + ')', '']
    .concat(totalsLines_(s, 3), tabunganLine_(ctx), ['', spendingAlert_(s, pastPeriods_(all, week, 4, prevWeek_), 'minggu')]);
  if (getBudgets_().length) lines.push('', '🎯 ' + budgetOverview_());
  sendMessage_(reportTarget_(), lines.join('\n'));
}

// First and last day of a month given as "YYYY-MM".
function monthRange_(ym) {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7));
  const next = month === 12 ? (year + 1) + '-01-01' : ym.slice(0, 5) + ('0' + (month + 1)).slice(-2) + '-01';
  return { from: ym + '-01', to: addDays_(next, -1) };
}

// The recap of one month. A month that is still running is labelled "(berjalan)" and has no comparison, because it
// would be set against full months.
function monthRecapLines_(month, ctx, all) {
  const s = sumRows_(between_(all, month));
  const running = month.to >= todayStr_();
  const title = MONTHS_ID[Number(month.from.slice(5, 7)) - 1] + ' ' + month.from.slice(0, 4) + (running ? ' (berjalan)' : '');

  const lines = ['📆 Rekap bulan ' + title, ''].concat(totalsLines_(s, Infinity), tabunganLine_(ctx));
  if (s.income > 0) lines.push('📈 Savings rate: ' + ((s.income - s.expense) / s.income * 100).toFixed(1) + '%');
  if (!running) lines.push('', spendingAlert_(s, pastPeriods_(all, month, 3, prevMonth_), 'bulan'));

  const budgets = getBudgets_();
  if (budgets.length) {
    lines.push('', '🎯 Budget ' + title + ':');
    budgets.forEach(function (b) {
      const used = s.byCat[b.category] || 0;
      lines.push('└ ' + b.category + ': ' + rupiah_(used) + ' / ' + rupiah_(b.limit) + ' (' +
        Math.round(used / b.limit * 100) + '%)' + (used > b.limit ? ' 🚨' : ''));
    });
  }
  return lines;
}

function monthlySummary() {
  const backupName = backupSheet_();
  const ctx = { cats: getCategories_(), accounts: getAccounts_() };
  const month = prevMonth_({ from: todayStr_().slice(0, 8) + '01' });
  const lines = monthRecapLines_(month, ctx, readTransactions_());
  lines.push('', '🗄️ Backup tersimpan: Google Drive > ' + BACKUP_FOLDER + ' > ' + backupName);
  sendMessage_(reportTarget_(), lines.join('\n'));
}

// On demand (/rekap and chat): the recap of "YYYY-MM", last month when empty. Read-only, no backup.
function monthRecapReply_(ym, ctx) {
  const thisMonth = todayStr_().slice(0, 7);
  const target = ym ? String(ym) : prevMonth_({ from: thisMonth + '-01' }).from.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(target)) return 'Bulan yang mana? Contoh: /rekap september, /rekap 2026-08 atau "rekap bulan lalu".';
  if (target > thisMonth) return 'Bulan itu belum terjadi 🤖';
  const all = readTransactions_();
  const month = monthRange_(target);
  if (!between_(all, month).length) return 'Belum ada transaksi di ' + MONTHS_ID[Number(target.slice(5, 7)) - 1] + ' ' + target.slice(0, 4) + '.';
  return monthRecapLines_(month, ctx, all).join('\n');
}

// unit: "minggu" or "bulan", for the message text.
function spendingAlert_(current, past, unit) {
  if (!past.length) return '📊 Belum ada ' + unit + ' sebelumnya untuk dibandingkan.';
  const avg = past.reduce(function (t, p) { return t + p.expense; }, 0) / past.length;
  if (avg <= 0) return '📊 ' + unit.charAt(0).toUpperCase() + unit.slice(1) + ' sebelumnya belum ada pengeluaran untuk dibandingkan.';

  const pct = Math.round((current.expense - avg) / avg * 100);
  const base = 'rata-rata ' + past.length + ' ' + unit + ' sebelumnya (' + rupiah_(avg) + ')';
  if (pct >= ALERT_PCT) {
    let top = null;
    let topDelta = 0;
    Object.keys(current.byCat).forEach(function (c) {
      const prev = past.reduce(function (t, p) { return t + (p.byCat[c] || 0); }, 0) / past.length;
      if (current.byCat[c] - prev > topDelta) {
        top = c;
        topDelta = current.byCat[c] - prev;
      }
    });
    return '⚠️ Pengeluaran ' + pct + '% di atas ' + base + '.' +
      (top ? '\nPenyumbang terbesar: ' + top + ' (+' + rupiah_(topDelta) + ')' : '');
  }
  if (pct <= -ALERT_PCT) return '👏 Pengeluaran ' + (-pct) + '% di bawah ' + base + '. Mantap!';
  return '📊 Pengeluaran normal (' + (pct >= 0 ? '+' : '') + pct + '% dari ' + base + ').';
}

// Values-only snapshot into its own spreadsheet, returns its name. Copying the file itself would also copy the
// bound Apps Script project (code and settings), which a backup does not need.
function backupSheet_() {
  const name = 'finance-tracker backup ' + todayStr_();
  const backup = SpreadsheetApp.create(name);
  const blank = backup.getSheets()[0];
  spreadsheet_().getSheets().forEach(function (sh) {
    const values = sh.getDataRange().getValues();
    backup.insertSheet(sh.getName()).getRange(1, 1, values.length, values[0].length).setValues(values);
  });
  backup.deleteSheet(blank);

  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER);
  DriveApp.getFileById(backup.getId()).moveTo(folder);
  return name;
}
