import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '../../..');
const bippyDistDir = path.join(rootDir, 'packages/bippy/dist');
const nextKitchenSinkDir = path.join(
  rootDir,
  'packages/next-kitchen-sink/dist',
);
const nextDir = path.join(nextKitchenSinkDir, '.next');

function copyDirRecursive(src: string, dest: string) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function deleteDirRecursive(dir: string) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
}

console.log(`Copying from ${bippyDistDir} to ${nextKitchenSinkDir}...`);
copyDirRecursive(bippyDistDir, nextKitchenSinkDir);
console.log('Copy completed.');

// biome-ignore lint/suspicious/noConsoleLog: <explanation>
console.log(`Deleting ${nextDir}...`);
deleteDirRecursive(nextDir);
// biome-ignore lint/suspicious/noConsoleLog: <explanation>
console.log('All operations completed successfully.');

// delete packages/next-kitchen-sink/.next
fs.rmSync(path.join(nextKitchenSinkDir, '.next'), {
  force: true,
  recursive: true,
});
