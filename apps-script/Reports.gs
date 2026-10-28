// Scheduled messages to the Finance topic, set up once with installSchedules(): a nightly recap, a Sunday
// recap with a spending alert, and a monthly backup. Triggers run in the script time zone (Asia/Jakarta).

const ALERT_PCT = 20; // weekly spending this far above or below the recent average gets called out
const BACKUP_FOLDER = 'finance-tracker backups';

// Safe to re-run: replaces the existing schedule instead of adding a second one.
function installSchedules() {
  const handlers = ['dailySummary', 'weeklySummary', 'monthlyBackup'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailySummary').timeBased().everyDays(1).atHour(21).create();
  ScriptApp.newTrigger('weeklySummary').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(20).create();
  ScriptApp.newTrigger('monthlyBackup').timeBased().onMonthDay(1).atHour(2).create();
  console.log('Scheduled (WIB): daily 21-22h, Sunday 20-21h, backup on the 1st 02-03h.');
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

function topCats_(byCat, n) {
  return Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).slice(0, n)
    .map(function (c) { return emojiFor_({ category: c, type: 'expense' }) + ' ' + c + ' ' + rupiah_(byCat[c]); })
    .join(' · ');
}

function dailySummary() {
  const ctx = { cats: getCategories_(), accounts: getAccounts_() };
  const today = todayStr_();
  const rows = readTransactions_().filter(function (r) { return r.date === today; });
  if (!rows.length) {
    sendMessage_(reportTarget_(), '🌙 Hari ini belum ada catatan. Ada yang kelewat? 📝');
    return;
  }
  const s = sumRows_(rows, ctx);
  const lines = ['🌙 Rekap hari ini (' + today + ', ' + rows.length + ' catatan)', ''];
  lines.push('💸 Pengeluaran: ' + rupiah_(s.expense));
  if (s.expense) lines.push('   ' + topCats_(s.byCat, 3));
  if (s.income) lines.push('💰 Pemasukan: ' + rupiah_(s.income));
  if (s.saving) lines.push('🐷 Ditabung: ' + rupiah_(s.saving));
  sendMessage_(reportTarget_(), lines.join('\n') + budgetWarnings_(rows));
}

function weeklySummary() {
  const ctx = { cats: getCategories_(), accounts: getAccounts_() };
  const all = readTransactions_();
  const between = function (from, to) { return all.filter(function (r) { return r.date >= from && r.date <= to; }); };
  const week = periodRange_('week');
  const s = sumRows_(between(week.from, week.to), ctx);

  // Up to 4 earlier weeks, skipping weeks that ended before tracking started so they do not count as zero.
  const first = all.reduce(function (m, r) { return r.date < m ? r.date : m; }, week.from);
  const past = [];
  for (let i = 1; i <= 4; i++) {
    const from = addDays_(week.from, -7 * i);
    if (addDays_(from, 6) < first) break;
    past.push(sumRows_(between(from, addDays_(from, 6)), ctx));
  }

  const lines = ['📅 Rekap minggu ini (' + week.from + ' s/d ' + week.to + ')', ''];
  lines.push('💸 Pengeluaran: ' + rupiah_(s.expense));
  if (s.expense) lines.push('   ' + topCats_(s.byCat, 3));
  lines.push('💰 Pemasukan: ' + rupiah_(s.income) + ' · 🐷 Ditabung: ' + rupiah_(s.saving));
  lines.push('', spendingAlert_(s, past));
  if (getBudgets_().length) lines.push('', '🎯 ' + budgetOverview_());
  sendMessage_(reportTarget_(), lines.join('\n'));
}

function spendingAlert_(week, past) {
  if (!past.length) return '📊 Belum ada minggu sebelumnya untuk dibandingkan.';
  const avg = past.reduce(function (t, p) { return t + p.expense; }, 0) / past.length;
  if (avg <= 0) return '📊 Minggu-minggu sebelumnya belum ada pengeluaran untuk dibandingkan.';

  const pct = Math.round((week.expense - avg) / avg * 100);
  const base = 'rata-rata ' + past.length + ' minggu sebelumnya (' + rupiah_(avg) + ')';
  if (pct >= ALERT_PCT) {
    let top = null;
    let topDelta = 0;
    Object.keys(week.byCat).forEach(function (c) {
      const prev = past.reduce(function (t, p) { return t + (p.byCat[c] || 0); }, 0) / past.length;
      if (week.byCat[c] - prev > topDelta) {
        top = c;
        topDelta = week.byCat[c] - prev;
      }
    });
    return '⚠️ Pengeluaran ' + pct + '% di atas ' + base + '.' +
      (top ? '\nPenyumbang terbesar: ' + top + ' (+' + rupiah_(topDelta) + ')' : '');
  }
  if (pct <= -ALERT_PCT) return '👏 Pengeluaran ' + (-pct) + '% di bawah ' + base + '. Mantap!';
  return '📊 Pengeluaran normal (' + (pct >= 0 ? '+' : '') + pct + '% dari ' + base + ').';
}

// Values-only snapshot into its own spreadsheet. Copying the file itself would also copy the bound Apps Script
// project (code and settings), which a backup does not need.
function monthlyBackup() {
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
  sendMessage_(reportTarget_(), '🗄️ Backup bulanan tersimpan: Google Drive > ' + BACKUP_FOLDER + ' > ' + name);
}
