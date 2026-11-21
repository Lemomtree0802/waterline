import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const directory of ['src', 'scripts', 'tests']) {
  for (const filename of await readdir(new URL(`../${directory}/`, import.meta.url))) {
    if (!/\.m?js$/.test(filename)) continue;
    const result = spawnSync(process.execPath, ['--check', `${directory}/${filename}`], { stdio: 'inherit' });
    if (result.status) process.exit(result.status);
  }
}
console.log('JavaScript syntax checks passed.');
