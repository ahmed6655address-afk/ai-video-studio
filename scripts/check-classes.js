// Dev utility: lists CSS class names used by JSX files but not defined in src/styles.css.
// Usage: node scripts/check-classes.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (/\.jsx?$/.test(entry)) files.push(full);
  }
})(path.join(root, 'src'));

const used = new Set();
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/className=("([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    const raw = match[2] || match[3] || match[4] || '';
    raw
      .replace(/\$\{[^}]*\}/g, ' ')
      .split(/\s+/)
      .filter((name) => Boolean(name) && !name.endsWith('-'))
      .forEach((name) => used.add(name));
  }
}

const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const missing = [...used].filter((name) => !defined.has(name)).sort();

console.log(`used=${used.size} defined=${defined.size} missing=${missing.length}`);
console.log(missing.join(' '));