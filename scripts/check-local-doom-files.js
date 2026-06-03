#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'third_party/doomgeneric/doomgeneric/doomgeneric.c',
  'third_party/doomgeneric/doomgeneric/doomgeneric.h',
  'assets/doom/DOOM1.WAD',
];

const missing = requiredFiles.filter(
  relativePath => !fs.existsSync(path.join(root, relativePath)),
);

if (missing.length === 0) {
  console.log('Local Doom files are present.');
  process.exit(0);
}

console.error('Missing local Doom files:');
for (const relativePath of missing) {
  console.error(`- ${relativePath}`);
}

console.error(`
These files are intentionally not committed.

Add a Doom-compatible portable engine source tree at:
  third_party/doomgeneric/

Add a legally obtained IWAD at:
  assets/doom/DOOM1.WAD

Keep both paths out of git.
`);

process.exit(1);
