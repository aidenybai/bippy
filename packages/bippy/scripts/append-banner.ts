import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const banner = `/**
 * @license bippy
 *
 * Copyright (c) Aiden Bai
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */`;

const distDir = path.join(__dirname, '..', 'dist');

const appendBannerToFile = (filePath: string) => {
  const content = fs.readFileSync(filePath, 'utf8');

  if (content.startsWith(banner)) {
    return;
  }

  const newContent = `${banner}\n${content}`;
  fs.writeFileSync(filePath, newContent, 'utf8');
};

const processDirectory = (dir: string) => {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      processDirectory(filePath);
    } else if (stat.isFile()) {
      if (file.endsWith('.js') || file.endsWith('.cjs')) {
        appendBannerToFile(filePath);
      }
    }
  }
};

processDirectory(distDir);
