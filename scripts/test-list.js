// Transaction lists (Sheet.gs listReply_, Commands.gs parseListArgs_) on made-up rows. Today in the tests is 2026-11-14.
// Usage: node scripts/test-list.js
const assert = require('assert');
const { loadApp, tx } = require('./app-fixture');

const app = loadApp();
const plain = (v) => JSON.parse(JSON.stringify(v));
const ctx = {
  cats: { expense: ['Makan', 'Transport', 'Belanja', 'Kopi (Cafe)'], income: ['Gaji'], saving: [] },
  accounts: [{ name: 'BNI', opening: 0 }, { name: 'GoPay', opening: 0 }],
};
// saved in this order; row 3 has an older date than row 2 (an email imported late)
let rows = [
  tx('aaaa0001', '2026-11-10', 30000, 'expense', 'Makan', 'BNI', 'Warung A'),
  tx('aaaa0002', '2026-11-12', 25000, 'expense', 'Transport', 'GoPay', 'Gojek'),
  tx('aaaa0003', '2026-11-07', 20000, 'expense', 'Makan', 'BNI', 'Warung B'),
  tx('aaaa0004', '2026-11-12', 200000, 'transfer', 'Transfer', 'BNI', '', '', 'GoPay'),
  tx('aaaa0005', '2026-11-12', 15000, 'expense', 'Kopi (Cafe)', 'GoPay', 'Kopi C'),
  tx('aaaa0006', '2026-11-13', 5000, 'expense', 'Transport', 'BNI', 'Parkir'),
];
app.readTransactions_ = () => rows;
app.todayStr_ = () => '2026-11-14';
const ids = (reply) => (reply.match(/#aaaa\d{4}|#bbbb\d{4}/g) || []).map((s) => s.slice(1));
const list = (f) => app.listReply_(f, ctx);

// newest date first, same date: saved later first; default 5
assert.deepStrictEqual(ids(list({})), ['aaaa0006', 'aaaa0005', 'aaaa0004', 'aaaa0002', 'aaaa0001']);
assert.ok(list({}).startsWith('🧾 5 transaksi terakhir:'), list({}));
assert.deepStrictEqual(ids(list({ limit: 2 })), ['aaaa0006', 'aaaa0005']);
assert.strictEqual(rows[0].id, 'aaaa0001', 'the ledger itself is not reordered');

// a date alone lists the whole day, and says which
const day = list({ date: '2026-11-12' });
assert.deepStrictEqual(ids(day), ['aaaa0005', 'aaaa0004', 'aaaa0002']);
assert.ok(day.startsWith('🧾 3 transaksi (tgl 12 Nov):'), day);
assert.ok(list({ date: '2026-11-11' }).startsWith('Tidak ada transaksi (tgl 11 Nov)'), 'empty day says so');
assert.ok(list({ date: 'kemarin' }).includes('Tanggal tidak dikenali'), 'a date that is not YYYY-MM-DD is refused');

// account: its own rows plus transfers into it; any case
assert.deepStrictEqual(ids(list({ account: 'gopay', limit: 10 })), ['aaaa0005', 'aaaa0004', 'aaaa0002']);
assert.ok(list({ account: 'Jago' }).includes('Akun "Jago" tidak ada. Akun: BNI, GoPay'));

// category: exact, partial either way, ambiguous, unknown
assert.deepStrictEqual(ids(list({ category: 'Transport', limit: 10 })), ['aaaa0006', 'aaaa0002']);
assert.deepStrictEqual(ids(list({ category: 'Transportasi', limit: 10 })), ['aaaa0006', 'aaaa0002'], 'Transportasi finds Transport');
assert.deepStrictEqual(ids(list({ category: 'kopi' })), ['aaaa0005']);
assert.ok(list({ category: 'a' }).includes('cocok dengan beberapa'), 'one letter matches several categories');
assert.ok(list({ category: 'Hobi' }).includes('tidak ada'), 'unknown category');

// filters combine; merchant is a substring; period
assert.deepStrictEqual(ids(list({ account: 'BNI', category: 'Makan', limit: 10 })), ['aaaa0001', 'aaaa0003']);
assert.deepStrictEqual(ids(list({ merchant: 'warung' })), ['aaaa0001', 'aaaa0003']);
assert.deepStrictEqual(ids(list({ period: 'week' })), ['aaaa0006', 'aaaa0005', 'aaaa0004', 'aaaa0002', 'aaaa0001'], 'week = Mon 9 Nov to today');
assert.deepStrictEqual(ids(list({ period: 'all' })), ['aaaa0006', 'aaaa0005', 'aaaa0004', 'aaaa0002', 'aaaa0001'], 'period all keeps the default 5');

// a long day: cap of 30, and the reply stays under Telegram's limit
rows = Array.from({ length: 45 }, (_, i) => tx('bbbb' + String(i).padStart(4, '0'), '2026-11-12', 1000 + i, 'expense', 'Makan', 'BNI', 'Warung dengan nama yang cukup panjang ' + i));
const long = list({ date: '2026-11-12' });
assert.ok(ids(long).length <= 30 && ids(long).length >= 20, 'capped, got ' + ids(long).length);
assert.ok(long.length < 4096, 'under the Telegram limit: ' + long.length);
assert.ok(long.includes('…dan ' + (45 - ids(long).length) + ' lainnya'), 'says how many were left out');
assert.ok(!list({ limit: 3 }).includes('lainnya'), 'an asked-for count is not followed by a "more" note');
rows = [];
assert.ok(list({}).startsWith('Tidak ada transaksi'), 'empty ledger');

// slash arguments
const parse = (...args) => plain(app.parseListArgs_(args, ctx));
assert.deepStrictEqual(parse(), {});
assert.deepStrictEqual(parse('10'), { limit: 10 });
assert.deepStrictEqual(parse('gopay', '10'), { limit: 10, account: 'gopay' });
assert.deepStrictEqual(parse('10', 'GoPay'), { limit: 10, account: 'GoPay' });
assert.deepStrictEqual(parse('transport', '10'), { limit: 10, category: 'transport' });
assert.deepStrictEqual(parse('17', 'nov'), { date: '2025-11-17' }, '17 Nov has not started yet today, so last year');
assert.deepStrictEqual(parse('12', 'november'), { date: '2026-11-12' });
assert.deepStrictEqual(parse('12/11'), { date: '2026-11-12' });
assert.deepStrictEqual(parse('2026-11-12'), { date: '2026-11-12' });
assert.deepStrictEqual(parse('kemarin'), { date: '2026-11-13' });
assert.deepStrictEqual(parse('hari', 'ini'), { date: '2026-11-14' });
assert.deepStrictEqual(parse('31', 'nov'), { date: 'invalid' }, '31 Nov does not exist');
assert.deepStrictEqual(parse('gopay', '12', 'nov', '5'), { account: 'gopay', date: '2026-11-12', limit: 5 });
assert.deepStrictEqual(parse('warung'), { merchant: 'warung' }, 'neither account nor category: merchant');
assert.deepStrictEqual(parse('a'), { merchant: 'a' }, 'an ambiguous category word falls to merchant');

// list requests typed in chat are read in code
const chat = (text) => { const a = app.parseListMessage_(text); return a === null ? null : parse(...a); };
assert.deepStrictEqual(chat('List 10 transaksi terakhir pake gopay'), { limit: 10, account: 'gopay' });
assert.deepStrictEqual(chat('List transaksi tgl 12 november'), { date: '2026-11-12' });
assert.deepStrictEqual(chat('list 10 transaksi kategori Transportasi'), { limit: 10, category: 'transportasi' });
assert.deepStrictEqual(chat('5 transaksi terakhir'), { limit: 5 });
assert.deepStrictEqual(chat('transaksi kemarin apa aja?'), { date: '2026-11-13' });
assert.deepStrictEqual(chat('list transaksi'), {});
assert.deepStrictEqual(chat('daftar transaksi hari ini dong'), { date: '2026-11-14' });
['transaksi a1b2c3d4 harusnya transport', 'hapus transaksi a1b2c3d4', 'makan 35rb transaksi', 'tren makan', 'saldo gopay?', 'pengeluaran minggu ini?',
  '5 kopi', 'list', 'transaksi'].forEach((text) => assert.strictEqual(app.parseListMessage_(text), null, text));

// the command and the chat metric go through the same function
rows = [tx('aaaa0001', '2026-11-12', 30000, 'expense', 'Makan', 'BNI', 'Warung A')];
assert.strictEqual(app.handleCommand_('/terakhir 12 nov', ctx), list({ date: '2026-11-12' }));
assert.strictEqual(app.answerQuery_({ metric: 'recent', limit: null, date: '2026-11-12' }, ctx), list({ date: '2026-11-12' }));

console.log('List tests OK');
