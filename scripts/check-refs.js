// Fails when code calls a private helper (name ending in "_") or names a trigger function that no .gs file defines.
// `node --check` only catches syntax errors, so a deleted function otherwise fails at run time. Usage: node scripts/check-refs.js [dir]
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || 'apps-script';
const src = fs.readdirSync(dir).filter((f) => f.endsWith('.gs'))
  .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');

const defined = new Set([...src.matchAll(/^function\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]));
const called = new Set([...src.matchAll(/(?<![.\w])([A-Za-z][A-Za-z0-9]*_)\(/g)].map((m) => m[1]));
const triggers = new Set([...src.matchAll(/newTrigger\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]));

const missing = [...called, ...triggers].filter((name) => !defined.has(name));
if (missing.length) {
  console.error('Undefined functions: ' + [...new Set(missing)].join(', '));
  process.exit(1);
}
console.log('References OK (' + defined.size + ' functions)');
