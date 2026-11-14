import fs from 'node:fs/promises';
import path from 'node:path';
import { run, checked, tool } from '../src/core/process.js';

// long: 覆盖新增helper和引擎模块，避免只检查CLI三个入口而漏掉按需加载的语法错误。
async function check(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await check(file);
    else if (/\.(?:m?js)$/.test(entry.name)) checked(await run(process.execPath, ['--check', file]), file);
    else if (entry.name.endsWith('.py')) checked(await run(await tool('python3'), ['-c', 'import ast,sys;ast.parse(open(sys.argv[1]).read())', file]), file);
  }
}
for (const directory of ['src', 'helpers', 'scripts', 'test']) await check(directory);
console.log('全部JS/Python源码语法检查通过');
