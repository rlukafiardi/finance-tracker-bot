// Read-only phone app (doGet): tabs Ringkasan, Kategori, Transaksi and Akun for any month, same numbers as the dashboard.
// Open https://script.google.com/macros/s/<deployment>/exec?token=<APP_TOKEN>[&month=YYYY-MM]. APP_TOKEN is its own
// Script Property, not WEBHOOK_SECRET (the relay and Telegram see that one). Without a matching token the page shows no data.

const APP_LIST_MAX = 100;
const APP_MONTHS_MAX = 36;
const APP_PIN_PATTERN = /^[0-9]{6,}$/;
const APP_FAIL_LIMIT = 5;
const APP_LOCK_MS = 60 * 60 * 1000;
const APP_DAILY_CAP = 30;
const APP_RECENT_MAX = 30;
const APP_AMOUNT_MAX = 1000000000;
const APP_BACK_DAYS = 365;
const APP_MERCHANT_MAX = 80;
const APP_NOTE_MAX = 200;

function appAuthorized_(given, expected) {
  return Boolean(expected) && given === expected;
}

function doGet(e) {
  const param = e && e.parameter ? e.parameter : {};
  if (!appAuthorized_(param.token, optionalProp_('APP_TOKEN'))) {
    return ContentService.createTextOutput('Tidak diizinkan.');
  }
  const accounts = getAccounts_();
  const today = todayStr_();
  const model = appModel_(readTransactions_(), accounts, getBudgets_(), param.month, today);
  model.view.telegram = appTelegramLink_(optionalProp_('ALLOWED_CHAT_ID'), optionalProp_('FINANCE_TOPIC_ID'));
  if (optionalProp_('APP_WRITE') === 'on') {
    // with writes off the page has no form, no "+" button and no appSave call at all
    model.view.form = { cats: getCategories_(), accounts: accounts.map(function (a) { return a.name; }), today: today,
      oldest: appOldest_(today) };
  }
  const stamp = Utilities.formatDate(new Date(), TZ, 'dd/MM HH:mm');
  const nav = { base: ScriptApp.getService().getUrl(), token: param.token };
  // addMetaTag accepts only viewport, mobile-web-app-capable, apple-mobile-web-app-capable and google-site-verification
  return HtmlService.createHtmlOutput(appPage_(model.d, stamp, model.view, nav))
    .setTitle('Keuangan')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}

// ---- month and data model (pure: no Sheet calls) ----

// Anything that is not a past or current YYYY-MM becomes the current month.
function appMonthParam_(param, today) {
  const cur = today.slice(0, 7);
  const text = String(param || '');
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) && text <= cur ? text : cur;
}

// Last day of a past month; the current month ends today.
function appMonthLast_(month) {
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return month + '-' + (last < 10 ? '0' : '') + last;
}

function appMonthEnd_(month, today) {
  return month === today.slice(0, 7) ? today : appMonthLast_(month);
}

function appWeekStart_(date) {
  const d = new Date(date + 'T00:00:00Z');
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
}

// Months from the current one back to the first transaction's month, newest first.
function appMonths_(rows, today) {
  const first = rows.reduce(function (m, r) { return r.date < m ? r.date : m; }, today).slice(0, 7);
  const out = [];
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  while (out.length < APP_MONTHS_MAX) {
    const key = y + '-' + (m < 10 ? '0' : '') + m;
    if (key < first) break;
    out.push(key);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

// The finance topic of a private group (id -100<number>) opens at t.me/c/<number>/<topic>. No group or no topic: no link.
function appTelegramLink_(chatIds, topicId) {
  const group = String(chatIds || '').split(',').map(function (s) { return s.trim(); })
    .filter(function (s) { return /^-100\d+$/.test(s); })[0];
  const topic = String(topicId || '').trim();
  return group && /^\d+$/.test(topic) ? 'https://t.me/c/' + group.slice(4) + '/' + topic : '';
}

// Only fields the list shows: raw_message and created_at never leave the server.
function appRow_(t) {
  return { id: t.id, date: t.date, amount: t.amount, type: t.type, category: t.category, account: t.account,
    to_account: t.to_account, merchant: t.merchant, note: t.note, icon: emojiFor_(t) };
}

// Balances and charts are as of the end of the chosen month; budget limits are today's (no limit history).
function appModel_(all, accounts, budgets, monthParam, today) {
  const months = appMonths_(all, today);
  const wanted = appMonthParam_(monthParam, today);
  const month = months.indexOf(wanted) >= 0 ? wanted : today.slice(0, 7);
  const end = appMonthEnd_(month, today);
  const upTo = all.filter(function (r) { return r.date <= end; });
  const d = dashboardData_(upTo, { accounts: accounts }, end, appWeekStart_(end), budgets);
  const rows = between_(all, { from: month + '-01', to: end }).map(appRow_).sort(function (a, b) {
    return b.date.localeCompare(a.date) || Number(b.id) - Number(a.id);
  });
  const weekRows = between_(all, { from: appWeekStart_(month + '-01'), to: new Date(Date.parse(appWeekStart_(appMonthLast_(month)) + 'T00:00:00Z') + 6 * 86400000).toISOString().slice(0, 10) })
    .filter(function (r) { return r.type === 'expense' || r.type === 'income'; })
    .map(function (r) { return { date: r.date, type: r.type, amount: r.amount }; });
  return { d: d, view: { month: month, months: months, current: month === today.slice(0, 7), rows: rows, weekRows: weekRows, today: today,
    catTrend: appCatTrend_(all, month, today) } };
}

// Spending per category over the 6 months ending at `month`, for the top APP_RAMP_N categories of those months (expense
// only, transfers and savings excluded like everywhere else; `only` = one row by name instead of the top; with `match` the row holds every expense that `match` accepts). The delta compares the chosen month with the month before over
// the same days, so a month in progress is not set against a whole one. Null until there are 2 months of data.
const APP_TREND_MONTHS = 6;

function appCatTrend_(all, month, today, only, match) {
  const keys = [];
  let y = Number(month.slice(0, 4));
  let m = Number(month.slice(5, 7));
  for (let i = 0; i < APP_TREND_MONTHS; i++) {
    keys.unshift(y + '-' + (m < 10 ? '0' : '') + m);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  const end = appMonthEnd_(month, today);
  const upto = Number(end.slice(8, 10));
  const prevKey = keys[APP_TREND_MONTHS - 2];
  const prevUpto = Math.min(upto, Number(appMonthLast_(prevKey).slice(8, 10)));
  const by = {};
  all.forEach(function (r) {
    if (r.type !== 'expense' || r.date > end || (match && !match(r))) return;
    const at = keys.indexOf(r.date.slice(0, 7));
    if (at < 0) return;
    const name = match ? only : r.category; // a keyword search is one row named after the keyword
    const c = by[name] || (by[name] = { category: name, vals: keys.map(function () { return 0; }), cur: 0, prev: 0 });
    c.vals[at] += r.amount;
    const day = Number(r.date.slice(8, 10));
    if (at === APP_TREND_MONTHS - 1 && day <= upto) c.cur += r.amount;
    if (at === APP_TREND_MONTHS - 2 && day <= prevUpto) c.prev += r.amount;
  });
  const first = all.reduce(function (min, r) { return r.date < min ? r.date : min; }, today).slice(0, 7);
  if (first >= month) return null;
  const ranked = Object.keys(by).map(function (k) { return by[k]; }).map(function (c) {
    c.total = c.vals.reduce(function (t, v) { return t + v; }, 0);
    return c;
  }).sort(function (a, b) { return b.total - a.total; });
  const rows = only
    ? ranked.filter(function (c) { return c.category.toLowerCase() === String(only).toLowerCase(); })
    : ranked.slice(0, APP_RAMP_N);
  return { keys: keys, rows: rows, partial: month === today.slice(0, 7), upto: upto };
}

function appTrendDelta_(c) {
  if (!c.prev && !c.cur) return null;
  if (!c.prev) return { arrow: '', text: 'baru', good: null };
  const pct = Math.round((c.cur - c.prev) / c.prev * 100);
  if (Math.abs(pct) < 5) return { arrow: '≈', text: 'sama', good: null };
  return { arrow: pct > 0 ? '▲' : '▼', text: Math.abs(pct) + '%', good: pct < 0 };
}

// One row per top category: six bars (own scale per row, so the shape shows), a tap shows the month's amount.
function appTrend_(t, month) {
  if (!t || !t.rows.length) return '';
  const mon = function (k) { return MONTHS_ID[Number(k.slice(5, 7)) - 1].slice(0, 3); };
  const head = t.keys.map(function (k) { return '<span>' + htmlEsc_(mon(k)) + '</span>'; }).join('');
  const rows = t.rows.map(function (c) {
    const peak = Math.max.apply(null, c.vals.concat([1]));
    const delta = appTrendDelta_(c);
    const bars = c.vals.map(function (v, i) {
      const last = i === t.keys.length - 1;
      const tip = [c.category + ' · ' + mon(t.keys[i]) + ' ' + t.keys[i].slice(0, 4), compactRp_(v)].concat(last && t.partial ? ['sampai tgl ' + t.upto] : []);
      return '<button type="button" class="tb' + (last ? ' cur' : '') + '" data-tip="' + appTip_(tip) + '" title="' + htmlEsc_(tip.join(' · ')) +
        '" aria-pressed="false"><span style="height:' + (v > 0 ? Math.max(6, Math.round(v / peak * 100)) : 2) + '%"></span></button>';
    }).join('');
    return '<div class="trow">' + appTile_(appEmoji_(c.category, 'expense')) + '<div class="tname"><div class="name">' + htmlEsc_(c.category) +
      '</div>' + (delta ? appPill_(delta) : '') + '</div><div class="tbars">' + bars + '</div></div>';
  }).join('');
  return '<section class="panel"><h2>Tren kategori</h2><p class="cap" data-cap>' + htmlEsc_('6 bulan sampai ' + appMonthName_(month)) + '</p>' +
    '<div class="thead"><span></span><span></span><div class="tmon">' + head + '</div></div><div data-tips>' + rows + '</div>' +
    '<p class="tiphint">' + htmlEsc_('Ketuk batang untuk melihat angkanya. Tiap kategori punya skala sendiri, jadi lihat bentuknya, bukan tinggi antar kategori. ' +
    (t.rows.some(function (c) { const d = appTrendDelta_(c); return d && d.arrow; })
      ? 'Persen = bulan ini dibanding bulan sebelumnya pada tanggal yang sama' + (t.partial ? ' (sampai tgl ' + t.upto + ')' : '') + '. ' : '') +
    (t.rows.some(function (c) { return c.cur && !c.prev; }) ? '"Baru" = belum ada pengeluaran di bulan sebelumnya pada tanggal itu.' : '')) + '</p></section>';
}

// Filters and totals also run in the browser: they are written without outside references and sent as source text.
function appFilter_(rows, f) {
  const q = String(f.q || '').trim().toLowerCase();
  const has = function (v) { return v !== '' && v !== null && v !== undefined; };
  return rows.filter(function (r) {
    if (q && (r.merchant + ' ' + r.note).toLowerCase().indexOf(q) < 0) return false;
    if (f.type && r.type !== f.type) return false;
    if (f.category && r.category !== f.category) return false;
    if (f.account && r.account !== f.account && r.to_account !== f.account) return false;
    if (has(f.min) && r.amount < Number(f.min)) return false;
    if (has(f.max) && r.amount > Number(f.max)) return false;
    return true;
  });
}

function appTotals_(rows) {
  const t = { expense: 0, income: 0 };
  rows.forEach(function (r) { if (r.type === 'expense' || r.type === 'income') t[r.type] += r.amount; });
  return t;
}

// ---- write path: appSave is the only public function that changes data ----
// Every public function can be called with google.script.run from this page, so appSave checks the flag, token and PIN
// itself before anything else. Design: docs/app-write-design.md.

function appOldest_(today) {
  return new Date(Date.parse(today + 'T00:00:00Z') - APP_BACK_DAYS * 86400000).toISOString().slice(0, 10);
}

// Strict where normalizeTx_ falls back: no Lainnya, no new accounts, no rolled-over dates.
function appValidate_(entry, ctx, today) {
  if (!entry || typeof entry !== 'object') return { error: 'Data belum lengkap.' };
  const text = function (v, max, label) {
    if (v === undefined || v === null) return { value: '' };
    if (typeof v !== 'string') return { error: label + ' tidak valid.' };
    const clean = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return clean.length > max ? { error: label + ' maksimal ' + max + ' karakter.' } : { value: clean };
  };
  if (typeof entry.type !== 'string' || ALL_TYPES.indexOf(entry.type) < 0) return { error: 'Jenis transaksi tidak dikenal.' };

  if (typeof entry.amount !== 'string' && typeof entry.amount !== 'number') return { error: 'Jumlah tidak valid.' };
  const digits = String(entry.amount);
  if (!/^[0-9]{1,10}$/.test(digits)) return { error: 'Jumlah harus berupa angka bulat.' };
  const amount = Number(digits);
  if (amount < 1 || amount > APP_AMOUNT_MAX) return { error: 'Jumlah harus antara Rp 1 dan Rp 1.000.000.000.' };

  const date = entry.date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T00:00:00Z').getTime()) ||
      new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) return { error: 'Tanggal tidak valid.' };
  if (date > today) return { error: 'Tanggal tidak boleh di masa depan.' };
  if (date < appOldest_(today)) return { error: 'Tanggal terlalu lama (maksimal ' + APP_BACK_DAYS + ' hari ke belakang).' };

  const merchant = text(entry.merchant, APP_MERCHANT_MAX, 'Toko');
  if (merchant.error) return merchant;
  const note = text(entry.note, APP_NOTE_MAX, 'Catatan');
  if (note.error) return note;

  const account = typeof entry.account === 'string' ? matchAccount_(entry.account, ctx.accounts) : null;
  if (!account) return { error: 'Pilih akun yang sudah ada.' };
  let toAccount = '';
  let category = '';
  if (entry.type === 'transfer') {
    toAccount = typeof entry.to_account === 'string' ? matchAccount_(entry.to_account, ctx.accounts) : null;
    if (!toAccount) return { error: 'Pilih akun tujuan yang sudah ada.' };
    if (toAccount === account) return { error: 'Akun asal dan tujuan tidak boleh sama.' };
  } else {
    const list = ctx.cats[entry.type] || [];
    if (typeof entry.category !== 'string' || list.indexOf(entry.category) < 0) return { error: 'Pilih kategori yang sudah ada.' };
    category = entry.category;
  }

  const n = normalizeTx_({ date: date, amount: amount, type: entry.type, category: category, account: account,
    to_account: toAccount, merchant: merchant.value, note: note.value }, ctx);
  if (n.error) return { error: 'Data tidak valid (' + n.error + ').' };
  if (n.newAccounts.length) return { error: 'Pilih akun yang sudah ada.' };
  return { tx: n.tx };
}

// Pure: state in, { state, error | replay } out. PIN failures and the day rollover must be saved even on a refusal.
function appGuard_(state, req, env) {
  const st = { fails: 0, lockedUntil: 0, day: '', writes: 0, recent: [] };
  Object.keys(st).forEach(function (k) { if (state && state[k] !== undefined) st[k] = state[k]; });
  if (!Array.isArray(st.recent)) st.recent = [];
  if (st.day !== env.today) { st.day = env.today; st.writes = 0; }

  if (st.lockedUntil > env.now) {
    const wib = new Date(st.lockedUntil + 7 * 3600000).toISOString().slice(11, 16);
    return { state: st, error: 'Terkunci sampai ' + wib + ' WIB.' };
  }
  if (!APP_PIN_PATTERN.test(env.pin || '')) return { state: st, error: 'PIN belum diatur.' };
  if (req.pin !== env.pin) {
    st.fails += 1;
    if (st.fails >= APP_FAIL_LIMIT) {
      st.fails = 0;
      st.lockedUntil = env.now + APP_LOCK_MS;
      return { state: st, error: 'PIN salah. Pencatatan terkunci 1 jam.' };
    }
    return { state: st, error: 'PIN salah. Sisa percobaan: ' + (APP_FAIL_LIMIT - st.fails) + '.' };
  }
  st.fails = 0;
  const seen = st.recent.filter(function (r) { return r.rid === req.rid; })[0];
  if (seen) return { state: st, replay: seen };
  if (st.writes >= APP_DAILY_CAP) return { state: st, error: 'Batas ' + APP_DAILY_CAP + ' transaksi per hari dari aplikasi.' };
  return { state: st };
}

function appFail_(error, extra) {
  return Object.assign({ ok: false, error: error }, extra || {});
}

// The save response carries the fresh sections and rows, so the page can swap them in without a reload.
function appReply_(base, month) {
  // the row is already saved when this runs: a failed rebuild must not turn into an error reply that invites a second save
  try {
    const m = appModel_(readTransactions_(), getAccounts_(), getBudgets_(), month, todayStr_());
    base.main = appSections_(m.d, m.view);
    base.rows = m.view.rows;
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
  }
  return base;
}

function appSave(req) {
  const env = { flag: optionalProp_('APP_WRITE'), token: optionalProp_('APP_TOKEN'), pin: optionalProp_('APP_PIN'),
    now: Date.now(), today: todayStr_() };
  return appSaveRun_(req, env);
}

function appSaveRun_(req, env) {
  if (env.flag !== 'on') return appFail_('Pencatatan dari aplikasi belum aktif.');
  if (!req || typeof req !== 'object' || typeof req.token !== 'string' || !appAuthorized_(req.token, env.token)) {
    return appFail_('Tidak diizinkan.');
  }
  if (typeof req.pin !== 'string' || typeof req.rid !== 'string' || !/^[a-z0-9-]{8,40}$/.test(req.rid) ||
      !req.entry || typeof req.entry !== 'object') return appFail_('Permintaan tidak valid.');

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return appFail_('Lagi sibuk, coba lagi sebentar.');
  }
  try {
    const props = PropertiesService.getScriptProperties();
    let saved = {};
    // only the owner can edit script properties, so unreadable state counts as fresh
    try { saved = JSON.parse(props.getProperty('APP_STATE') || '{}'); } catch (err) { saved = {}; }
    const guard = appGuard_(saved, req, env);
    props.setProperty('APP_STATE', JSON.stringify(guard.state));
    if (guard.error) return appFail_(guard.error);
    if (guard.replay) return appReply_({ ok: true, id: guard.replay.id, replay: true, text: 'Sudah tersimpan tadi.' }, req.month);

    const ctx = { cats: getCategories_(), accounts: getAccounts_() };
    const v = appValidate_(req.entry, ctx, env.today);
    if (v.error) return appFail_(v.error);
    if (req.dupOk !== true) {
      const twin = readTransactions_().filter(function (r) { return isDuplicateTx_(v.tx, [r]); })[0];
      if (twin) return appFail_('Mirip dengan transaksi yang sudah ada.', { duplicate: true, existing: describe_(twin) });
    }

    const text = commitLog_({ txs: [v.tx], newAccounts: [], raw: 'app' });
    guard.state.writes += 1;
    guard.state.recent.push({ rid: req.rid, id: v.tx.id });
    guard.state.recent = guard.state.recent.slice(-APP_RECENT_MAX);
    props.setProperty('APP_STATE', JSON.stringify(guard.state));
    refreshDashboardAfterChange_();
    return appReply_({ ok: true, id: v.tx.id, text: text }, req.month);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return appFail_('Gagal menyimpan. Cek di Telegram dengan /terakhir sebelum mencoba lagi.');
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

// ---- page ----

function htmlEsc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// JSON for an inline script: "<" and the line separators cannot end the script or the string early.
function appJson_(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

// 1234567 -> "Rp 1.234.567"
function rpFull_(n) {
  const digits = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 ? '-' : '') + 'Rp ' + digits;
}

function appDelta_(delta) {
  const tone = delta.good === true ? 'good' : delta.good === false ? 'bad' : '';
  return '<div class="delta ' + tone + '">' + htmlEsc_((delta.arrow ? delta.arrow + ' ' : '') + delta.text) + '</div>';
}

function appLabel_(label, current) {
  if (label === 'TABUNGAN SEKARANG' && !current) return 'Tabungan akhir bulan';
  return label.charAt(0) + label.slice(1).toLowerCase();
}

function appMonthName_(month) {
  return MONTHS_ID[Number(month.slice(5, 7)) - 1] + ' ' + month.slice(0, 4);
}

const APP_ICONS_ = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h14v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14.5" r="1.2"/>',
};

function appIcon_(name) {
  return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' + APP_ICONS_[name] + '</svg>';
}

const APP_TYPE_LABEL_ = { expense: 'Pengeluaran', income: 'Pemasukan', saving: 'Tabungan', transfer: 'Transfer' };

function appOptions_(all, items, value) {
  return '<option value="">' + htmlEsc_(all) + '</option>' + items.map(function (i) {
    return '<option value="' + htmlEsc_(i[0]) + '"' + (i[0] === value ? ' selected' : '') + '>' + htmlEsc_(i[1]) + '</option>';
  }).join('');
}

function appUnique_(rows, key) {
  const seen = {};
  rows.forEach(function (r) { if (r[key]) seen[r[key]] = true; });
  return Object.keys(seen).sort();
}

// ---- tiles and small charts (pure HTML strings) ----

const APP_RAMP_N = 5; // ranked categories get one blue ramp, the rest share grey

function appEmoji_(category, type) {
  return category === 'Lain-lain' ? '📦' : emojiFor_({ category: category, type: type });
}

function appTile_(emoji, cls) {
  return '<span class="tile ' + (cls || '') + '" aria-hidden="true">' + emoji + '</span>';
}

// "🏦 BNI" -> { icon: "🏦", name: "BNI" }; a name without a leading symbol keeps its text.
function appSplitAccount_(label) {
  const m = String(label).match(/^(\S+)\s+(.+)$/);
  return m && /[^\x00-\x7F]/.test(m[1]) ? { icon: m[1], name: m[2] } : { icon: '💳', name: String(label).trim() };
}

function appPill_(delta) {
  const tone = delta.good === true ? 'good' : delta.good === false ? 'bad' : '';
  return '<span class="pill ' + tone + '">' + htmlEsc_((delta.arrow ? delta.arrow + ' ' : '') + delta.text) + '</span>';
}

// Tabungan at the end of each month, newest last. Bars start at zero; a negative balance hangs below the line.
function appSpark_(trend) {
  const pts = trend.rows.slice(-6).filter(function (p) { return typeof p[3] === 'number'; });
  if (pts.length < 2) return '';
  const vals = pts.map(function (p) { return p[3]; });
  const peak = Math.max.apply(null, vals.map(Math.abs).concat([0.0001]));
  const hasNeg = vals.some(function (v) { return v < 0; });
  return '<div class="spark" data-tips><div class="sprow">' + pts.map(function (p, i) {
    const v = vals[i];
    const h = Math.max(4, Math.round(Math.abs(v) / peak * (hasNeg ? 46 : 92)));
    const at = hasNeg ? (v >= 0 ? 'bottom:50%' : 'top:50%') : 'bottom:0';
    const tip = [p[0], 'Tabungan ' + compactRp_(v * trend.unit.div)];
    return '<button type="button" class="sp" data-tip="' + appTip_(tip) + '" title="' + htmlEsc_(tip.join(' · ')) + '" aria-pressed="false">' +
      '<div class="spcol"><i class="' + (v < 0 ? 'neg' : '') + '" style="height:' + h + '%;' + at + '"></i></div><span>' +
      htmlEsc_(String(p[0]).slice(0, 3)) + '</span></button>';
  }).join('') + '</div><div class="spcap" data-cap>Ketuk batang untuk melihat Tabungan tiap bulan</div></div>';
}

// Weeks of one month, whole Monday-to-Sunday weeks like the Telegram recaps: from the week of the 1st to the week of the last
// day, so the first and last week can hold days of the neighbouring month and the weeks do not add up to the month total.
// `rows` are the income and expense rows of those whole weeks. A week that starts after `today` is `future`.
function appWeeks_(rows, month, today) {
  const day = function (iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); };
  const last = appMonthLast_(month);
  const weeks = [];
  for (let from = appWeekStart_(month + '-01'); from <= last; from = day(from, 7)) {
    weeks.push({ n: weeks.length + 1, from: from, to: day(from, 6), expense: 0, income: 0, future: from > today });
  }
  rows.forEach(function (r) {
    if (r.type !== 'expense' && r.type !== 'income') return;
    weeks.forEach(function (w) { if (r.date >= w.from && r.date <= w.to) w[r.type] += r.amount; });
  });
  return weeks;
}

// There is no hover on a phone: charts carry their numbers in data-tip ("title|line|line") and a tap shows them.
function appTip_(parts) {
  return htmlEsc_(parts.map(function (p) { return String(p).replace(/\|/g, '/'); }).join('|'));
}

function appDonut_(cats) {
  const slices = cats.rows.slice(0, APP_RAMP_N).map(function (c, i) { return { v: c[1], cls: 's' + (i + 1), name: c[0] }; });
  const rest = cats.rows.slice(APP_RAMP_N).reduce(function (t, c) { return t + c[1]; }, 0);
  if (rest > 0) slices.push({ v: rest, cls: 'sg', name: 'Lainnya' });
  const total = slices.reduce(function (t, x) { return t + x.v; }, 0);
  if (total <= 0) return '';
  const circ = 2 * Math.PI * 40;
  let from = 0;
  const arcs = slices.map(function (x) {
    const len = x.v / total * circ;
    const draw = Math.max(len - 1.5, 0.5);
    const tip = [x.name, compactRp_(x.v * cats.unit.div), Math.round(x.v / total * 100) + '%'];
    const arc = '<circle class="sl ' + x.cls + '" cx="60" cy="60" r="40" stroke-dasharray="' + draw.toFixed(2) + ' ' +
      (circ - draw).toFixed(2) + '" stroke-dashoffset="' + (-from).toFixed(2) + '" data-tip="' + appTip_(tip) + '" tabindex="0" role="button" ' +
      'aria-label="' + htmlEsc_(tip.join(', ')) + '"><title>' + htmlEsc_(tip.join(' · ')) + '</title></circle>';
    from += len;
    return arc;
  }).join('');
  const all = compactRp_(total * cats.unit.div);
  return '<div class="donut" data-tips data-b="' + htmlEsc_(all) + '" data-s="pengeluaran"><svg viewBox="0 0 120 120"><circle class="dt" cx="60" cy="60" r="40"/>' +
    '<g transform="rotate(-90 60 60)">' + arcs + '</g></svg><div class="dc"><b>' + htmlEsc_(all) + '</b><small>pengeluaran</small></div></div>';
}

// The four tab sections: also returned by appSave so the page can swap them without a reload.
function appSections_(d, view) {
  const byLabel = {};
  d.kpis.forEach(function (k) { byLabel[k.label] = k; });
  const hero = byLabel['TABUNGAN SEKARANG'];
  const heroHtml = hero ? '<section class="hero"><div class="label">' + htmlEsc_(appLabel_(hero.label, view.current)) +
    '</div><div class="big">' + htmlEsc_(hero.value) + '</div>' + appPill_(hero.delta) + appSpark_(d.trend) + '</section>' : '';

  const stat = function (k, icon, cls) {
    return k ? '<div class="stat"><div class="sthead">' + appTile_(icon, cls) + '<div class="label">' +
      htmlEsc_(appLabel_(k.label, view.current)) + '</div></div><div class="value">' + htmlEsc_(k.value) + '</div>' + appPill_(k.delta) + '</div>' : '';
  };
  const cards = '<div class="cards">' + stat(byLabel['PENGELUARAN'], '💸', 't-exp') + stat(byLabel['PEMASUKAN'], '💰', 't-inc') + '</div>';

  const weeks = appWeeks_(view.weekRows, view.month, view.today);
  const peak = Math.max.apply(null, weeks.map(function (w) { return w.expense; }).concat([0]));
  const monthSum = appTotals_(view.rows);
  const dm = function (iso) { return Number(iso.slice(8, 10)) + ' ' + MONTHS_ID[Number(iso.slice(5, 7)) - 1].slice(0, 3); };
  const span = function (w) { return w.from.slice(0, 7) === w.to.slice(0, 7) ? Number(w.from.slice(8, 10)) + '–' + Number(w.to.slice(8, 10)) : dm(w.from) + '–' + dm(w.to); };
  const spanHtml = function (w) { return span(w).split('–').map(htmlEsc_).join(w.from.slice(0, 7) === w.to.slice(0, 7) ? '–' : '–<br>'); };
  const tipOf = function (w) {
    return ['W' + w.n + ' · ' + span(w) + (w.from.slice(0, 7) === w.to.slice(0, 7) ? ' ' + dm(w.to).split(' ')[1] : ''), w.future ? 'belum berjalan' : 'Pengeluaran ' + compactRp_(w.expense),
      w.future ? '' : 'Pemasukan ' + compactRp_(w.income)].filter(Boolean);
  };
  const weekHtml = '<section class="panel"><h2>Pengeluaran per minggu</h2><p class="cap" data-cap>' + htmlEsc_(appMonthName_(view.month) + ' · Pengeluaran ' +
    compactRp_(monthSum.expense) + ' · Pemasukan ' + compactRp_(monthSum.income)) + '</p><div class="weeks" data-tips>' + weeks.map(function (w) {
      const tip = tipOf(w);
      const h = w.future ? 3 : peak > 0 ? Math.max(3, Math.round(w.expense / peak * 100)) : 3;
      return '<button type="button" class="wk' + (w.future ? ' future' : '') + '" data-tip="' + appTip_(tip) + '" title="' + htmlEsc_(tip.join(' · ')) +
        '" aria-pressed="false"><div class="col"><span style="height:' + h + '%"></span></div><div class="wl"><b>W' + w.n + '</b>' + spanHtml(w) + '</div></button>';
    }).join('') + '</div><p class="tiphint">Ketuk batang untuk melihat angkanya. Satu minggu penuh Senin–Minggu seperti rekap Telegram, jadi minggu pertama dan terakhir bisa memuat hari dari bulan lain.</p></section>';

  const catTotal = d.cats.rows.reduce(function (t, c) { return t + c[1]; }, 0);
  const top = Math.max.apply(null, d.cats.rows.map(function (c) { return c[1]; }).concat([0]));
  const catRows = d.cats.rows.map(function (c, i) {
    const w = top > 0 ? Math.round(c[1] / top * 100) : 0;
    const share = catTotal > 0 ? Math.round(c[1] / catTotal * 100) : 0;
    const cls = i < APP_RAMP_N && c[0] !== 'Lain-lain' ? 's' + (i + 1) : 'sg';
    return '<div class="crow">' + appTile_(appEmoji_(c[0], 'expense')) + '<div class="cmain"><div class="name"><i class="dot ' + cls + '"></i>' +
      htmlEsc_(c[0]) + '<small>' + share + '%</small></div><div class="bar"><span class="' + cls + '" style="width:' + w + '%"></span></div></div>' +
      '<div class="camt">' + htmlEsc_(compactRp_(c[1] * d.cats.unit.div)) + '</div></div>';
  }).join('');
  const catHtml = d.cats.rows.length ? appDonut_(d.cats) + catRows : '<p class="muted empty">🌱 Belum ada pengeluaran bulan ini.</p>';

  const budgetHtml = d.budgets.length ? '<section class="panel"><h2>Anggaran</h2>' + d.budgets.map(function (b) {
    const tone = b.pct >= 100 ? 'over' : b.pct >= 80 ? 'warn' : '';
    return '<div class="crow">' + appTile_(appEmoji_(b.category, 'expense')) + '<div class="cmain"><div class="name">' + htmlEsc_(b.category) +
      '<small>' + b.pct + '% terpakai</small></div><div class="bar ' + tone + '"><span style="width:' + Math.min(b.pct, 100) + '%"></span></div></div>' +
      '<div class="camt sm">' + htmlEsc_(compactRp_(b.spent)) + ' / ' + htmlEsc_(compactRp_(b.limit)) + '</div></div>';
  }).join('') + '</section>' : '';

  const accountRows = d.accounts.map(function (a) {
    const parts = appSplitAccount_(a.name);
    const share = d.total > 0 && a.balance > 0 ? Math.round(a.balance / d.total * 100) : 0;
    return '<div class="crow">' + appTile_(parts.icon) + '<div class="cmain"><div class="name">' + htmlEsc_(parts.name) +
      '</div><div class="bar"><span style="width:' + share + '%"></span></div></div><div class="camt">' + htmlEsc_(rpFull_(a.balance)) + '</div></div>';
  }).join('');
  const accountTitle = view.current ? 'Saldo akun' : 'Saldo akun di akhir ' + appMonthName_(view.month);
  const accountHtml = d.accounts.length ? '<div class="total"><div class="label">Total semua akun</div><div class="big">' +
    htmlEsc_(rpFull_(d.total)) + '</div></div><div class="panel"><h2>' + htmlEsc_(accountTitle) + '</h2>' + accountRows + '</div>'
    : '<div class="panel"><h2>' + htmlEsc_(accountTitle) + '</h2><p class="muted empty">🏦 Belum ada akun.</p></div>';

  const listHtml = '<section class="panel filters"><div class="srow"><input type="search" id="q" placeholder="Cari toko atau catatan" ' +
    'autocomplete="off" aria-label="Cari toko atau catatan"><button type="button" id="toggle" aria-expanded="false" ' +
    'aria-controls="more">Filter</button></div><div id="more" hidden><div class="frow"><select id="ftype" aria-label="Jenis">' +
    appOptions_('Semua jenis', Object.keys(APP_TYPE_LABEL_).map(function (k) { return [k, APP_TYPE_LABEL_[k]]; }), '') +
    '</select><select id="fcat" aria-label="Kategori">' +
    appOptions_('Semua kategori', appUnique_(view.rows, 'category').map(function (c) { return [c, c]; }), '') +
    '</select></div><div class="frow"><select id="facc" aria-label="Akun">' +
    appOptions_('Semua akun', appUnique_(view.rows, 'account').map(function (c) { return [c, c]; }), '') +
    '</select><button type="button" id="reset">Hapus filter</button></div><div class="frow">' +
    '<input id="fmin" inputmode="numeric" placeholder="Min (Rp)" aria-label="Jumlah minimal">' +
    '<input id="fmax" inputmode="numeric" placeholder="Maks (Rp)" aria-label="Jumlah maksimal"></div></div></section>' +
    '<p id="count" class="count"></p><div id="list" class="listwrap"></div>';

  return '<section data-tab="ringkasan">' + heroHtml + cards + weekHtml + '</section>' +
    '<section data-tab="kategori" hidden><div class="panel"><h2>Pengeluaran per kategori</h2>' + catHtml + '</div>' + appTrend_(view.catTrend, view.month) + budgetHtml + '</section>' +
    '<section data-tab="transaksi" hidden>' + listHtml + '</section>' +
    '<section data-tab="akun" hidden>' + accountHtml + '</section>';
}

// The "+" button and its bottom sheet. Only built when view.form exists (APP_WRITE is on).
function appTelegramFab_(link) {
  return link ? '<a class="fab" target="_top" href="' + htmlEsc_(link) + '" aria-label="Catat lewat Telegram">' + appIcon_('send') + '</a>' : '';
}

function appFormHtml_(form, telegram) {
  const types = ['expense', 'income', 'saving', 'transfer'].map(function (t, i) {
    return '<button type="button" data-type="' + t + '" aria-pressed="' + (i === 0) + '">' + APP_TYPE_LABEL_[t] + '</button>';
  }).join('');
  const accountOptions = appOptions_('Pilih akun', form.accounts.map(function (a) { return [a, a]; }), '');
  return '<button type="button" id="n_add" class="fab" aria-label="Catat transaksi">+</button>' +
    '<div id="n_sheet" class="sheet" hidden role="dialog" aria-modal="true" aria-labelledby="n_title"><div class="sheet-body">' +
    '<div class="shead"><h2 id="n_title">Catat transaksi</h2><button type="button" id="n_close" class="x" aria-label="Tutup">×</button></div>' +
    '<div id="n_step1">' + (telegram ? '<a class="tglink" target="_top" href="' + htmlEsc_(telegram) + '">Atau catat lewat Telegram ›</a>' : '') +
    '<div id="n_types" class="seg">' + types + '</div>' +
    '<label>Jumlah (Rp)<input id="n_amount" inputmode="numeric" autocomplete="off" placeholder="35000"></label>' +
    '<div id="n_amountshow" class="hint">Rp 0</div>' +
    '<label>Tanggal<input id="n_date" type="date" min="' + htmlEsc_(form.oldest) + '" max="' + htmlEsc_(form.today) + '"></label>' +
    '<label id="n_catwrap">Kategori<select id="n_category"></select></label>' +
    '<label><span id="n_acclabel">Akun</span><select id="n_account">' + accountOptions + '</select></label>' +
    '<label id="n_towrap" hidden>Ke akun<select id="n_to">' + accountOptions + '</select></label>' +
    '<label>Toko (boleh kosong)<input id="n_merchant" maxlength="' + APP_MERCHANT_MAX + '" autocomplete="off"></label>' +
    '<label>Catatan (boleh kosong)<input id="n_note" maxlength="' + APP_NOTE_MAX + '" autocomplete="off"></label>' +
    '<p id="n_err" class="err" role="alert"></p><button type="button" id="n_next" class="primary">Lanjut</button></div>' +
    '<div id="n_step2" hidden><div id="n_preview" class="preview"></div>' +
    '<div id="n_dup" class="dup" hidden>Mirip dengan transaksi ini:<div id="n_duptext"></div>Tetap disimpan?</div>' +
    '<label id="n_pinwrap">PIN pencatatan (diminta sekali setiap halaman dibuka)' +
    '<input id="n_pin" type="password" inputmode="numeric" autocomplete="off" maxlength="20"></label>' +
    '<p id="n_err2" class="err" role="alert"></p>' +
    '<div class="btnrow"><button type="button" id="n_back">Ubah</button><button type="button" id="n_save" class="primary">Simpan</button></div></div>' +
    '<div id="n_step3" hidden><div id="n_result" class="result"></div>' +
    '<div class="btnrow"><button type="button" id="n_again">Catat lagi</button><button type="button" id="n_done" class="primary">Selesai</button></div></div>' +
    '</div></div>';
}

// The PIN lives in a variable only (never storage or the URL). One request id per opened form, so a retry is not saved twice.
function appFormJs_(form, month) {
  return String.raw`
var FORM = ${appJson_({ cats: form.cats, today: form.today, oldest: form.oldest })};
var MONTH = ${appJson_(month)};
var pin = '', rid = '', dupOk = false, pending = false, draft = null, kind = 'expense';
function uid() {
  try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}
function step(n) { ['1', '2', '3'].forEach(function (k) { $('n_step' + k).hidden = k !== String(n); }); }
function setKind(t) {
  kind = t;
  document.querySelectorAll('#n_types button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.type === t)); });
  var transfer = t === 'transfer';
  $('n_catwrap').hidden = transfer;
  $('n_towrap').hidden = !transfer;
  $('n_acclabel').textContent = transfer ? 'Dari akun' : 'Akun';
  var sel = $('n_category');
  sel.textContent = '';
  var first = document.createElement('option');
  first.value = '';
  first.textContent = 'Pilih kategori';
  sel.appendChild(first);
  (FORM.cats[t] || []).forEach(function (c) {
    var o = document.createElement('option');
    o.value = c;
    o.textContent = c;
    sel.appendChild(o);
  });
}
function openSheet() {
  rid = uid();
  dupOk = false;
  ['n_amount', 'n_merchant', 'n_note', 'n_pin'].forEach(function (id) { $(id).value = ''; });
  $('n_date').value = FORM.today;
  $('n_account').value = '';
  $('n_to').value = '';
  $('n_amountshow').textContent = 'Rp 0';
  $('n_err').textContent = '';
  setKind('expense');
  step(1);
  $('n_sheet').hidden = false;
  $('n_add').hidden = true;
  $('n_amount').focus();
}
function closeSheet() {
  if (pending) return;
  $('n_sheet').hidden = true;
  $('n_add').hidden = false;
}
function readEntry() {
  var transfer = kind === 'transfer';
  return { type: kind, amount: $('n_amount').value, date: $('n_date').value, category: transfer ? '' : $('n_category').value,
    account: $('n_account').value, to_account: transfer ? $('n_to').value : '', merchant: $('n_merchant').value, note: $('n_note').value };
}
function problem(e) {
  if (!/^[0-9]{1,10}$/.test(e.amount) || Number(e.amount) < 1) return 'Isi jumlah dulu (angka saja, minimal Rp 1).';
  if (Number(e.amount) > 1000000000) return 'Jumlah maksimal Rp 1.000.000.000.';
  if (!e.date || e.date > FORM.today || e.date < FORM.oldest) return 'Tanggal harus dalam 365 hari terakhir dan tidak boleh di masa depan.';
  if (kind !== 'transfer' && !e.category) return 'Pilih kategori dulu.';
  if (!e.account) return kind === 'transfer' ? 'Pilih akun asal dulu.' : 'Pilih akun dulu.';
  if (kind === 'transfer' && !e.to_account) return 'Pilih akun tujuan dulu.';
  if (kind === 'transfer' && e.to_account === e.account) return 'Akun asal dan tujuan tidak boleh sama.';
  return '';
}
function preview(e) {
  var box = $('n_preview');
  box.textContent = '';
  box.appendChild(el('div', 'pv-type', TYPES[e.type]));
  box.appendChild(el('div', 'pv-amount', rpFull_(Number(e.amount))));
  var rows = [['Tanggal', Number(e.date.slice(8, 10)) + ' ' + MONTHS[Number(e.date.slice(5, 7)) - 1] + ' ' + e.date.slice(0, 4)]];
  if (e.type === 'transfer') rows.push(['Akun', e.account + ' → ' + e.to_account]);
  else rows.push(['Kategori', e.category], ['Akun', e.account]);
  if (e.merchant.trim()) rows.push(['Toko', e.merchant.trim()]);
  if (e.note.trim()) rows.push(['Catatan', e.note.trim()]);
  rows.forEach(function (r) {
    var line = el('div', 'pv-row');
    line.appendChild(el('span', '', r[0]));
    line.appendChild(el('b', '', r[1]));
    box.appendChild(line);
  });
}
function release() {
  pending = false;
  $('n_save').disabled = false;
  $('n_back').disabled = false;
  $('n_save').textContent = dupOk ? 'Tetap simpan' : 'Simpan';
}
function done(res, used) {
  release();
  if (res && res.ok) {
    pin = used;
    if (res.main) {
      document.querySelector('main').innerHTML = res.main;
      ROWS = res.rows || ROWS;
      show(tab);
      render();
    }
    $('n_result').textContent = res.text;
    step(3);
    return;
  }
  if (res && res.duplicate) {
    dupOk = true;
    $('n_dup').hidden = false;
    $('n_duptext').textContent = res.existing;
    $('n_save').textContent = 'Tetap simpan';
    return;
  }
  if (res && /PIN/.test(res.error || '')) { pin = ''; $('n_pin').value = ''; }
  $('n_err2').textContent = (res && res.error) || 'Gagal menyimpan.';
}
function save() {
  if (pending) return;
  var used = pin || $('n_pin').value;
  if (!/^[0-9]{6,}$/.test(used)) { $('n_err2').textContent = 'Isi PIN pencatatan (minimal 6 angka).'; return; }
  pending = true;
  $('n_save').disabled = true;
  $('n_back').disabled = true;
  $('n_save').textContent = 'Menyimpan...';
  $('n_err2').textContent = '';
  google.script.run
    .withSuccessHandler(function (res) { done(res, used); })
    .withFailureHandler(function () {
      release();
      $('n_err2').textContent = 'Tidak tersambung. Coba simpan lagi, aman dari catatan ganda.';
    })
    .appSave({ token: NAV.token, pin: used, rid: rid, month: MONTH, dupOk: dupOk, entry: draft });
}
$('n_add').addEventListener('click', openSheet);
$('n_close').addEventListener('click', closeSheet);
$('n_done').addEventListener('click', closeSheet);
$('n_again').addEventListener('click', openSheet);
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('n_sheet').hidden) closeSheet(); });
$('n_types').addEventListener('click', function (e) {
  var b = e.target.closest('button');
  if (b) setKind(b.dataset.type);
});
$('n_amount').addEventListener('input', function () {
  $('n_amount').value = $('n_amount').value.replace(/[^0-9]/g, '');
  $('n_amountshow').textContent = rpFull_(Number($('n_amount').value || 0));
});
$('n_next').addEventListener('click', function () {
  var e = readEntry();
  var why = problem(e);
  $('n_err').textContent = why;
  if (why) return;
  draft = e;
  dupOk = false;
  preview(e);
  $('n_pinwrap').hidden = Boolean(pin);
  $('n_dup').hidden = true;
  $('n_err2').textContent = '';
  $('n_save').textContent = 'Simpan';
  step(2);
});
$('n_back').addEventListener('click', function () { dupOk = false; step(1); });
$('n_step1').addEventListener('input', function () { $('n_err').textContent = ''; });
$('n_save').addEventListener('click', save);
$('n_pin').addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
['n_amount', 'n_merchant', 'n_note'].forEach(function (id) {
  $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') $('n_next').click(); });
});
`;
}

// Pure: dashboardData_ result, an "updated" stamp, the month view and the link base in, HTML string out.
function appPage_(d, stamp, view, nav) {

  const link = function (month) { return nav.base + '?token=' + encodeURIComponent(nav.token) + '&month=' + month; };
  const at = view.months.indexOf(view.month);
  const arrow = function (target, symbol, label) {
    return target ? '<a class="arrow" target="_top" href="' + htmlEsc_(link(target)) + '" aria-label="' + label + '">' + symbol + '</a>'
      : '<span class="arrow off" aria-hidden="true">' + symbol + '</span>';
  };
  const monthOptions = view.months.map(function (m) {
    return '<option value="' + m + '"' + (m === view.month ? ' selected' : '') + '>' + htmlEsc_(appMonthName_(m)) + '</option>';
  }).join('');


  const tabs = [['ringkasan', 'Ringkasan', 'home'], ['kategori', 'Kategori', 'tag'], ['transaksi', 'Transaksi', 'list'],
    ['akun', 'Akun', 'wallet']];
  const navHtml = tabs.map(function (t, i) {
    return '<button role="tab" data-tab="' + t[0] + '" aria-selected="' + (i === 0) + '"><span class="nico">' + appIcon_(t[2]) +
      '</span><span>' + t[1] + '</span></button>';
  }).join('');

  const css = [
    ':root{color-scheme:light;--bg:#f2f4f8;--card:#fff;--ink:#14181f;--ink2:#667085;--line:#e6e9ef;--accent:#1f4e79;--tint:#e3edf8;--track:#e8ecf2;',
    '--good:#17794a;--bad:#b42318;--warn:#b54708;--bar:#4f7cac;--hero1:#14395c;--hero2:#2f6ba3;--t-exp:#fdeee5;--t-inc:#e5f0fd;',
    '--tile:#eef2f7;--sh:0 1px 2px rgba(16,24,40,.04),0 6px 16px rgba(16,24,40,.05);--c1:#084594;--c2:#2171b5;--c3:#4292c6;--c4:#6baed6;--c5:#9ecae1;--cg:#c9ced6}',
    '*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--ink);font:15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;',
    'font-variant-numeric:tabular-nums;-webkit-tap-highlight-color:transparent}',
    'header{position:sticky;top:0;z-index:2;background:var(--bg);padding:max(14px,env(safe-area-inset-top)) 16px 8px}',
    '.mrow{display:flex;align-items:center;gap:8px}.msel{position:relative;flex:1;min-width:0}',
    '.msel:after{content:"\\25BE";position:absolute;right:4px;top:50%;transform:translateY(-50%);color:var(--ink2);pointer-events:none}',
    '.msel select{appearance:none;-webkit-appearance:none;width:100%;border:0;background:transparent;color:var(--ink);font:800 24px system-ui,-apple-system,sans-serif;',
    'letter-spacing:-.02em;padding:4px 22px 4px 0;cursor:pointer}',
    '.arrow{width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:var(--card);color:var(--ink);',
    'text-decoration:none;font-size:24px;line-height:1;box-shadow:var(--sh)}.arrow.off{opacity:.35}header p{margin:2px 0 0;font-size:12px;color:var(--ink2)}',
    'main{padding:6px 16px calc(92px + env(safe-area-inset-bottom));max-width:640px;margin:0 auto}section[hidden]{display:none}',
    '.hero{position:relative;overflow:hidden;background:linear-gradient(135deg,var(--hero1),var(--hero2));color:#fff;border-radius:22px;padding:18px;margin-bottom:12px;',
    'box-shadow:0 10px 24px rgba(20,57,92,.25)}.hero:before,.hero:after{content:"";position:absolute;border-radius:50%;background:rgba(255,255,255,.07)}',
    '.hero:before{width:180px;height:180px;right:-50px;top:-70px}.hero:after{width:120px;height:120px;left:-40px;bottom:-60px}.hero>*{position:relative}',
    '.hero .label{color:rgba(255,255,255,.78)}.hero .big{font-size:34px;font-weight:800;letter-spacing:-.02em;margin:2px 0 8px}',
    '.spark{margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.15)}.sprow{display:flex;gap:8px}',
    'button.sp{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;border:0;background:none;padding:0;color:inherit;font:inherit;cursor:pointer}.spcol{position:relative;width:100%;height:46px}',
    '.spcol i{position:absolute;left:18%;width:64%;border-radius:4px;background:rgba(255,255,255,.85)}.spcol i.neg{background:rgba(255,190,180,.9)}',
    '.sp span{font-size:10px;color:rgba(255,255,255,.7)}.spcap{margin-top:8px;font-size:12px;color:rgba(255,255,255,.85);min-height:16px;text-align:center}',
    '.sp.on .spcol i{background:#fff}.spark.picked .sp:not(.on) i{opacity:.5}',
    '.pill{display:inline-block;font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;background:var(--tile);color:var(--ink2)}',
    '.pill.good{background:rgba(23,121,74,.12);color:var(--good)}.pill.bad{background:rgba(180,35,24,.1);color:var(--bad)}',
    '.hero .pill,.hero .pill.good,.hero .pill.bad{background:rgba(255,255,255,.18);color:#fff}',
    '.cards{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}',
    '.stat,.panel,.total{background:var(--card);border-radius:18px;padding:14px;box-shadow:var(--sh)}',
    '.sthead{display:flex;align-items:center;gap:8px;margin-bottom:8px}.value{font-size:21px;font-weight:800;letter-spacing:-.01em;margin-bottom:6px}',
    '.tile{flex:none;width:36px;height:36px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px;background:var(--tile)}',
    '.t-exp{background:var(--t-exp)}.t-inc{background:var(--t-inc)}',
    '.panel{margin-bottom:12px}h2{font-size:14px;margin:0 0 12px;letter-spacing:.01em}.label{font-size:12px;color:var(--ink2)}',
    '.weeks{display:flex;gap:8px;align-items:flex-end;height:150px}',
    'button.wk{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;align-items:center;border:0;background:none;padding:0;color:inherit;font:inherit;cursor:pointer}',
    '.col{flex:1;width:100%;display:flex;align-items:flex-end}.col span{display:block;width:100%;border-radius:7px 7px 3px 3px;transform-origin:bottom}',
    '.col span{background:var(--bar)}.wk.on .col span{background:var(--accent)}.wk.future .col span{background:var(--track)}',
    '.wl{font-size:10px;line-height:12px;min-height:36px;color:var(--ink2);margin-top:4px;white-space:nowrap;text-align:center}.wl b{display:block;font-size:11px;color:var(--ink)}',
    '.thead,.trow{display:grid;grid-template-columns:auto 1fr 132px;gap:10px;align-items:center}.thead{margin-bottom:6px}.thead span:first-child{width:36px}',
    '.tmon{display:flex;gap:4px}.tmon span{flex:1;text-align:center;font-size:10px;color:var(--ink2)}.trow{margin-bottom:12px}.trow:last-child{margin-bottom:0}',
    '.tname{display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:0}.tbars{display:flex;gap:4px;height:40px;align-items:flex-end}',
    'button.tb{flex:1;min-width:0;height:100%;display:flex;align-items:flex-end;border:0;background:none;padding:0;cursor:pointer}',
    '.tb span{display:block;width:100%;border-radius:3px 3px 1px 1px;background:var(--bar)}.tb.cur span{background:var(--accent)}.tb.on span{background:var(--ink2)}',
    '.cap{font-size:13px;font-weight:700;margin:0 0 10px;min-height:19px}.tiphint{font-size:11px;color:var(--ink2);margin:8px 0 0}',
    '.donut{position:relative;width:176px;height:176px;margin:4px auto 14px}.donut svg{width:100%;height:100%}',
    '.donut circle{fill:none;stroke-width:15}.dt{stroke:var(--track)}.sl{stroke-linecap:butt;cursor:pointer;outline:none}.donut circle.sl.on,.donut circle.sl:focus-visible{stroke-width:19}',
    '.s1{stroke:var(--c1)}.s2{stroke:var(--c2)}.s3{stroke:var(--c3)}.s4{stroke:var(--c4)}.s5{stroke:var(--c5)}.sg{stroke:var(--cg)}',
    '.dc{position:absolute;inset:0;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center}.dc b{font-size:20px;font-weight:800}',
    '.dc small{font-size:11px;color:var(--ink2)}',
    '.crow{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;margin-bottom:14px}.crow:last-child{margin-bottom:0}',
    '.name{font-weight:600;display:flex;align-items:center;gap:6px}.name small{color:var(--ink2);font-weight:400;font-size:12px;white-space:nowrap}.camt.sm{font-size:12px}',
    '.dot{width:9px;height:9px;border-radius:50%;flex:none}.dot.s1{background:var(--c1)}.dot.s2{background:var(--c2)}.dot.s3{background:var(--c3)}',
    '.dot.s4{background:var(--c4)}.dot.s5{background:var(--c5)}.dot.sg{background:var(--cg)}',
    '.camt{text-align:right;font-weight:700;font-size:14px;white-space:nowrap}',
    '.bar{margin-top:5px;background:var(--track);border-radius:6px;height:7px;overflow:hidden}.bar span{display:block;height:7px;border-radius:6px;background:var(--bar);transform-origin:left}',
    '.bar span.s1{background:var(--c1)}.bar span.s2{background:var(--c2)}.bar span.s3{background:var(--c3)}.bar span.s4{background:var(--c4)}',
    '.bar span.s5{background:var(--c5)}.bar span.sg{background:var(--cg)}.bar.warn span{background:var(--warn)}.bar.over span{background:var(--bad)}',
    '.total{margin-bottom:12px;background:linear-gradient(135deg,var(--hero1),var(--hero2));color:#fff;box-shadow:0 10px 24px rgba(20,57,92,.2)}',
    '.total .label{color:rgba(255,255,255,.78)}.total .big{font-size:30px;font-weight:800;letter-spacing:-.02em}',
    '.muted{color:var(--ink2)}.empty{text-align:center;padding:18px 0;margin:0}',
    '.filters input,.filters select,.filters button{width:100%;min-width:0;padding:11px;border:1px solid var(--line);border-radius:12px;background:var(--card);',
    'color:var(--ink);font:inherit;font-size:16px}.filters button{color:var(--accent);font-weight:600;cursor:pointer}',
    '.frow{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.srow{display:grid;grid-template-columns:1fr auto;gap:8px}',
    '#more[hidden]{display:none}.filters #toggle{width:auto;padding:11px 16px}.count{margin:0 2px 10px;font-size:13px;color:var(--ink2)}',
    '.group{background:var(--card);border-radius:18px;padding:4px 14px 6px;margin-bottom:12px;box-shadow:var(--sh)}',
    '.day{display:flex;justify-content:space-between;gap:8px;padding:10px 0 4px;font-size:12px;font-weight:700;color:var(--ink2)}',
    '.tx{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)}.tx:last-child{border:0}',
    '.ico{flex:none;width:36px;height:36px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px;background:var(--tile)}',
    '.tx .l{flex:1;min-width:0}.tx .t{font-weight:600;overflow-wrap:anywhere}.tx .s{font-size:12px;color:var(--ink2)}',
    '.tx .a{white-space:nowrap;font-weight:700}.tx .a.in{color:var(--good)}.tx .a.mv{color:var(--ink2)}',
    'nav{position:fixed;left:0;right:0;bottom:0;display:flex;background:var(--card);border-top:1px solid var(--line);padding:6px 4px env(safe-area-inset-bottom);z-index:3}',
    'nav button{flex:1;border:0;background:none;color:var(--ink2);padding:4px 0;font:inherit;font-size:11px;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer}',
    '.nico{display:flex;align-items:center;justify-content:center;width:52px;height:30px;border-radius:15px}',
    'nav button[aria-selected=true]{color:var(--accent);font-weight:700}nav button[aria-selected=true] .nico{background:var(--tint)}',
    'nav button:focus-visible{outline:2px solid var(--accent);outline-offset:-3px}',
    '.fab{position:fixed;right:16px;bottom:calc(78px + env(safe-area-inset-bottom));width:56px;height:56px;border-radius:50%;border:0;background:var(--accent);',
    'color:var(--card);font-size:30px;line-height:1;box-shadow:0 6px 16px rgba(16,24,40,.3);cursor:pointer;z-index:4}.fab[hidden]{display:none}.fab{display:flex;align-items:center;justify-content:center;text-decoration:none}',
    '.tglink{display:block;margin:0 0 10px;font-size:13px;color:var(--accent);text-decoration:none}',
    '.sheet{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10;display:flex;align-items:flex-end;justify-content:center}.sheet[hidden]{display:none}',
    '.sheet-body{background:var(--card);width:100%;max-width:640px;max-height:92vh;overflow:auto;border-radius:22px 22px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom))}',
    '.shead{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.shead h2{margin:0;font-size:17px}',
    '.x{border:0;background:none;color:var(--ink2);font-size:28px;line-height:1;cursor:pointer;padding:0 6px}',
    '.sheet label{display:block;font-size:13px;color:var(--ink2);margin-top:10px}.sheet label[hidden]{display:none}',
    '.sheet input,.sheet select{display:block;width:100%;margin-top:4px;padding:11px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);font:inherit;font-size:16px}',
    '.seg{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.seg button{padding:9px 2px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);font:inherit;font-size:12px;cursor:pointer}',
    '.seg button[aria-pressed=true]{background:var(--accent);color:var(--card);border-color:var(--accent);font-weight:700}',
    '.hint{font-size:12px;color:var(--ink2);margin-top:2px}.err{color:var(--bad);font-size:13px;min-height:18px;margin:8px 0 4px}',
    '.primary{width:100%;padding:13px;border:0;border-radius:14px;background:var(--accent);color:var(--card);font:inherit;font-weight:700;font-size:16px;cursor:pointer}',
    '.sheet button:disabled{opacity:.5}.btnrow{display:grid;grid-template-columns:1fr 2fr;gap:8px}',
    '.btnrow button{padding:13px;border:1px solid var(--line);border-radius:14px;background:var(--card);color:var(--ink);font:inherit;font-size:16px;cursor:pointer}',
    '.btnrow .primary{border:0;background:var(--accent);color:var(--card);font-weight:700}',
    '.preview{background:var(--bg);border-radius:14px;padding:12px;margin-bottom:6px}.pv-type{font-size:12px;color:var(--ink2)}',
    '.pv-amount{font-size:26px;font-weight:800;margin:2px 0 8px}.pv-row{display:flex;justify-content:space-between;gap:10px;padding:4px 0;font-size:14px}',
    '.pv-row b{text-align:right;overflow-wrap:anywhere}.dup{background:var(--bg);border-left:3px solid var(--warn);padding:8px 10px;margin:8px 0;font-size:13px;border-radius:6px}',
    '.dup div{white-space:pre-wrap;font-weight:600;margin:4px 0}.result{white-space:pre-wrap;margin:6px 0 12px}',
    '@media(prefers-reduced-motion:no-preference){.nico{transition:background .2s}',
    'section[data-tab]:not([hidden]){animation:rise .3s ease both}@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}',
    '.bar span{animation:growx .7s .1s ease both}@keyframes growx{from{transform:scaleX(0)}}',
    '.col span{animation:growy .6s .1s ease both}@keyframes growy{from{transform:scaleY(0)}}',
    '.spcol i{animation:growy .6s .15s ease both}',
    '.sl{animation:fade .8s ease both}@keyframes fade{from{opacity:0}}.fab:active,.arrow:active{transform:scale(.94)}}',
  ].join('');

  const writable = Boolean(view.form);
  const js = String.raw`
var NAV = ${appJson_({ base: nav.base, token: nav.token })};
var ROWS = ${appJson_(view.rows)};
var MAX = ${APP_LIST_MAX};
var TODAY = ${appJson_(view.today)};
var MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
var TYPES = ${appJson_(APP_TYPE_LABEL_)};
${appFilter_.toString()}
${appTotals_.toString()}
${rpFull_.toString()}
var $ = function (id) { return document.getElementById(id); };
var tab = 'ringkasan';
function show(n) {
  tab = n;
  document.querySelectorAll('nav button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === n)); });
  document.querySelectorAll('main section[data-tab]').forEach(function (s) { s.hidden = s.dataset.tab !== n; });
  window.scrollTo(0, 0);
  try { localStorage.setItem('tab', n); } catch (e) {}
}
document.querySelectorAll('nav button').forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.tab); }); });
var saved = 'ringkasan';
try { saved = localStorage.getItem('tab') || saved; } catch (e) {}
show(['ringkasan', 'kategori', 'transaksi', 'akun'].indexOf(saved) < 0 ? 'ringkasan' : saved);

$('month').addEventListener('change', function () {
  window.top.location.href = NAV.base + '?token=' + encodeURIComponent(NAV.token) + '&month=' + $('month').value;
});

function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
var DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
function dayLabel(date) {
  if (date === TODAY) return 'Hari ini';
  var y = new Date(TODAY + 'T00:00:00Z');
  y.setUTCDate(y.getUTCDate() - 1);
  if (date === y.toISOString().slice(0, 10)) return 'Kemarin';
  return DAYS[new Date(date + 'T00:00:00Z').getUTCDay()] + ', ' + Number(date.slice(8, 10)) + ' ' + MONTHS[Number(date.slice(5, 7)) - 1];
}
function render() {
  var f = { q: $('q').value, type: $('ftype').value, category: $('fcat').value, account: $('facc').value,
    min: $('fmin').value, max: $('fmax').value };
  var hit = appFilter_(ROWS, f);
  var active = [f.type, f.category, f.account, f.min, f.max].filter(Boolean).length;
  $('toggle').textContent = active ? 'Filter · ' + active : 'Filter';
  var t = appTotals_(hit);
  var count = $('count');
  var list = $('list');
  list.textContent = '';
  if (!ROWS.length) {
    count.textContent = 'Belum ada transaksi di bulan ini.';
    return;
  }
  var line = hit.length + ' dari ' + ROWS.length + ' transaksi';
  if (t.expense) line += ' · Pengeluaran ' + rpFull_(t.expense);
  if (t.income) line += ' · Pemasukan ' + rpFull_(t.income);
  count.textContent = line;
  if (!hit.length) {
    list.appendChild(el('p', 'muted empty', 'Tidak ada transaksi yang cocok. Coba hapus sebagian filter.'));
    return;
  }
  var group = null;
  var lastDate = '';
  hit.slice(0, MAX).forEach(function (r) {
    if (r.date !== lastDate) {
      lastDate = r.date;
      group = el('div', 'group');
      var head = el('div', 'day');
      head.appendChild(el('span', '', dayLabel(r.date)));
      var out = appTotals_(hit.filter(function (x) { return x.date === r.date; })).expense;
      if (out) head.appendChild(el('span', '', 'Keluar ' + rpFull_(out)));
      group.appendChild(head);
      list.appendChild(group);
    }
    var row = el('div', 'tx');
    var icon = el('span', 'ico', r.icon || '💸');
    icon.setAttribute('aria-hidden', 'true');
    var left = el('div', 'l');
    var title = r.type === 'transfer' ? r.account + ' → ' + r.to_account : (r.merchant || r.note || r.category);
    var parts = [];
    if (r.type !== 'transfer') parts.push(r.category);
    if (r.type !== 'transfer' && r.account) parts.push(r.account);
    left.appendChild(el('div', 't', title));
    left.appendChild(el('div', 's', parts.join(' · ')));
    var sign = r.type === 'income' ? '+' : r.type === 'expense' || r.type === 'saving' ? '-' : '';
    row.appendChild(icon);
    row.appendChild(left);
    row.appendChild(el('div', 'a ' + (r.type === 'income' ? 'in' : r.type === 'transfer' ? 'mv' : ''), sign + rpFull_(r.amount)));
    group.appendChild(row);
  });
  if (hit.length > MAX) {
    list.appendChild(el('p', 'muted empty', 'Menampilkan ' + MAX + ' teratas. Persempit filter untuk melihat sisanya.'));
  }
}
function showTip(t) {
  var box = t.closest('[data-tips]');
  if (!box) return;
  var parts = t.dataset.tip.split('|');
  var donut = box.classList.contains('donut');
  var again = donut && t.classList.contains('on');
  box.querySelectorAll('[data-tip]').forEach(function (x) {
    var on = x === t && !again;
    x.classList.toggle('on', on);
    if (x.tagName === 'BUTTON') x.setAttribute('aria-pressed', String(on));
  });
  box.classList.add('picked');
  var capEl = donut ? null : box.parentNode.querySelector('[data-cap]') || box.querySelector('[data-cap]');
  if (capEl && capEl.dataset.orig === undefined) capEl.dataset.orig = capEl.textContent;
  if (donut) {
    box.querySelector('.dc b').textContent = again ? box.dataset.b : parts[1];
    box.querySelector('.dc small').textContent = again ? box.dataset.s : parts[0] + ' \u00b7 ' + parts[2];
  } else {
    capEl.textContent = parts.join(' \u00b7 ');
  }
}
function clearTips() {
  document.querySelectorAll('[data-tips].picked').forEach(function (box) {
    box.classList.remove('picked');
    box.querySelectorAll('[data-tip].on').forEach(function (x) {
      x.classList.remove('on');
      if (x.tagName === 'BUTTON') x.setAttribute('aria-pressed', 'false');
    });
    if (box.classList.contains('donut')) {
      box.querySelector('.dc b').textContent = box.dataset.b;
      box.querySelector('.dc small').textContent = box.dataset.s;
    } else {
      var cap = box.parentNode.querySelector('[data-cap]') || box.querySelector('[data-cap]');
      cap.textContent = cap.dataset.orig;
    }
  });
}
document.addEventListener('click', function (e) {
  if (!e.target.closest('[data-tip]')) clearTips();
});
var main = document.querySelector('main');
main.addEventListener('click', function (e) {
  var tip = e.target.closest('[data-tip]');
  if (tip) { showTip(tip); return; }
  if (e.target.closest('#toggle')) {
    var open = $('more').hidden;
    $('more').hidden = !open;
    $('toggle').setAttribute('aria-expanded', String(open));
  } else if (e.target.closest('#reset')) {
    ['q', 'fmin', 'fmax', 'ftype', 'fcat', 'facc'].forEach(function (id) { $(id).value = ''; });
    render();
  }
});
main.addEventListener('input', function (e) {
  var id = e.target.id;
  if (id === 'fmin' || id === 'fmax') e.target.value = e.target.value.replace(/[^0-9]/g, '');
  if (['q', 'ftype', 'fcat', 'facc', 'fmin', 'fmax'].indexOf(id) >= 0) render();
});
render();
`;
  const script = js + (writable ? appFormJs_(view.form, view.month) : '');

  return '<!doctype html><html lang="id"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>' + css + '</style></head><body>' +
    '<header><div class="mrow">' + arrow(view.months[at + 1], '‹', 'Bulan sebelumnya') +
    '<label class="msel"><select id="month" aria-label="Pilih bulan">' + monthOptions + '</select></label>' +
    arrow(at > 0 ? view.months[at - 1] : null, '›', 'Bulan berikutnya') + '</div>' +
    '<p>Data per ' + htmlEsc_(stamp) + '</p></header><main>' +
    appSections_(d, view) + '</main>' +
    '<nav role="tablist">' + navHtml + '</nav>' + (writable ? appFormHtml_(view.form, view.telegram) : appTelegramFab_(view.telegram)) +
    '<script>' + script + '</script></body></html>';
}
