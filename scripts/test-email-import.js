// Email import batches (Gmail.gs prepareEmailImport_) on made-up emails: a batch with nothing left to save must be settled
// at once, or the same emails are offered again at every run.
// Usage: node scripts/test-email-import.js
const assert = require('assert');
const { loadApp, tx } = require('./app-fixture');

const plain = (v) => JSON.parse(JSON.stringify(v));
const ctx = { cats: { expense: ['Makan'], income: [], saving: [] }, accounts: [{ name: 'BNI', opening: 0 }, { name: 'OVO', opening: 0 }] };

function run(items, unsupported, rows) {
  const app = loadApp();
  const marked = [];
  app.getPending_ = () => null;
  app.fetchNewEmails_ = () => ({ items, unsupported });
  app.readTransactions_ = () => rows;
  app.fillEmailCategories_ = () => false;
  app.markEmails_ = (emails, status) => emails.forEach((e) => marked.push(e.id + ':' + status));
  return { out: plain(app.prepareEmailImport_(ctx)), marked };
}
const email = (id, t) => ({ id, bank: 'BNI', txs: [Object.assign({ type: 'expense', account: 'BNI', to_account: '', date: '2026-11-26', merchant: '', note: '', category: 'Makan' }, t)] });
const ledger = [tx('r1', '2026-11-26', 24000, 'transfer', 'Transfer', 'BNI', '', '', 'OVO')];

// a transfer from BNI to BNI (own account) is rejected, and the email already in the sheet is a duplicate
const dup = email('dup1', { type: 'transfer', amount: 24000, to_account: 'OVO', category: 'Transfer' });
const self = email('self1', { type: 'transfer', amount: 50000, to_account: 'BNI', category: 'Transfer' });
let r = run([dup, self], [], ledger);
assert.strictEqual(r.out.action, undefined, 'no confirmation for a batch with nothing to save');
assert.ok(r.out.reply.includes('Tidak ada transaksi baru') && r.out.reply.includes('akun asal dan tujuan sama'), r.out.reply);
assert.deepStrictEqual(r.marked.sort(), ['dup1:duplicate', 'self1:unsupported'], 'both are settled now');

// a mixed batch still asks, and keeps the rejected email for the confirmation to settle
const good = email('good1', { amount: 17000 });
r = run([good, self], [], ledger);
assert.strictEqual(r.out.action.txs.length, 1);
assert.deepStrictEqual(r.out.action.unsupportedIds, [{ id: 'self1', bank: 'BNI' }]);
assert.deepStrictEqual(r.marked, [], 'nothing is settled before the answer');

// nothing new at all stays silent
r = run([], [], ledger);
assert.strictEqual(r.out.quiet, true);

console.log('Email import tests OK');
