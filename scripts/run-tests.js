const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const testDir = path.join(__dirname, '..', 'test');

const testFiles = fs
  .readdirSync(testDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

if (testFiles.length === 0) {
  console.error('[run-tests] no test files found in test/');
  process.exit(1);
}

for (const name of testFiles) {
  const filePath = path.join(testDir, name);
  const result = spawnSync(process.execPath, [filePath], { stdio: 'inherit' });

  if (result.error) {
    console.error(`[run-tests] failed to run ${name}:`, result.error);
    process.exit(1);
  }

  if (result.signal) {
    console.error(`[run-tests] ${name} terminated by signal ${result.signal}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status);
  }
}

process.exit(0);
