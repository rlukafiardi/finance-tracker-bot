// Monthly category budgets. Tab `budgets`: category, monthly_limit (created on first use).
// After an expense is logged, the reply adds a line for each affected category that has used 80% or more.

function budgetsSheet_() {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName('budgets');
  if (!sh) {
    sh = ss.insertSheet('budgets');
    sh.getRange(1, 1, 1, 2).setValues([['category', 'monthly_limit']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getBudgets_() {
  const sh = spreadsheet_().getSheetByName('budgets');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    .map(function (r) { return { category: String(r[0]).trim(), limit: Number(r[1]) || 0 }; })
    .filter(function (b) { return b.category && b.limit > 0; });
}

// limit 0 removes the budget.
function setBudget_(category, limit) {
  const sh = budgetsSheet_();
  const last = sh.getLastRow();
  const names = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
  for (let i = 0; i < names.length; i++) {
    if (String(names[i][0]).trim().toLowerCase() === category.toLowerCase()) {
      if (limit > 0) sh.getRange(i + 2, 2).setValue(limit);
      else sh.deleteRow(i + 2);
      return;
    }
  }
  if (limit > 0) sh.appendRow([category, limit]);
}

// Expense total per category (lowercase key) for the current month.
function monthSpendByCategory_() {
  const to = todayStr_();
  const from = to.slice(0, 8) + '01';
  const out = {};
  readTransactions_().forEach(function (r) {
    if (r.type === 'expense' && r.date >= from && r.date <= to) {
      const key = r.category.toLowerCase();
      out[key] = (out[key] || 0) + r.amount;
    }
  });
  return out;
}

// Call after the rows are written, so the new amounts are included.
function budgetWarnings_(txs) {
  const budgets = getBudgets_();
  if (!budgets.length) return '';
  const touched = {};
  txs.forEach(function (t) {
    if (t.type === 'expense') touched[t.category.toLowerCase()] = true;
  });
  if (!Object.keys(touched).length) return '';

  const spent = monthSpendByCategory_();
  const lines = [];
  budgets.forEach(function (b) {
    const key = b.category.toLowerCase();
    if (!touched[key]) return;
    const used = spent[key] || 0;
    const pct = Math.round(used / b.limit * 100);
    if (pct >= 80) {
      lines.push((pct >= 100 ? '🚨 Melebihi budget: ' : '⚠️ Hampir habis: ') + b.category + ' ' + pct +
        '% dari budget bulan ini (' + rupiah_(used) + ' / ' + rupiah_(b.limit) + ')');
    }
  });
  return lines.length ? '\n\n' + lines.join('\n') : '';
}

function budgetOverview_() {
  const budgets = getBudgets_();
  if (!budgets.length) return 'Belum ada budget. Atur dengan /budget makan 1,5jt.';
  const spent = monthSpendByCategory_();
  return 'Budget bulan ini:\n' + budgets.map(function (b) {
    const used = spent[b.category.toLowerCase()] || 0;
    return b.category + ': ' + rupiah_(used) + ' / ' + rupiah_(b.limit) + ' (' + Math.round(used / b.limit * 100) + '%)';
  }).join('\n');
}
