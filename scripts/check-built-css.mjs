#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const distDir = path.resolve('dist', 'assets');
const files = await fs.readdir(distDir);
const cssFiles = files.filter((file) => file.endsWith('.css'));

if (cssFiles.length === 0) {
  throw new Error(`no built CSS assets found in ${distDir}`);
}

for (const file of cssFiles) {
  const fullPath = path.join(distDir, file);
  const css = await fs.readFile(fullPath, 'utf8');
  if (css.includes('@tailwind') || css.includes('@apply')) {
    throw new Error(`built CSS asset still contains raw Tailwind directives: ${fullPath}`);
  }
}

console.log(`checked ${cssFiles.length} CSS asset(s); no raw Tailwind directives found`);
