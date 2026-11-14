import fs from 'node:fs/promises';
import path from 'node:path';

export function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export class Paths {
  constructor(roots, workspace) { this.roots = roots; this.workspace = workspace; }
  static async create(roots, workspace) {
    await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
    return new Paths(await Promise.all(roots.map(r => fs.realpath(path.resolve(r)))), await fs.realpath(workspace));
  }
  async input(value, { directory = false } = {}) {
    if (!value || typeof value !== 'string') throw new Error('必须提供目标路径');
    const resolved = await fs.realpath(path.resolve(value));
    // long: 先解析符号链接再验证根目录，避免允许目录内的链接指向其他私人文件。
    if (![...this.roots, this.workspace].some(root => within(root, resolved))) throw new Error('目标不在 allowedRoots 内');
    const stat = await fs.stat(resolved);
    if (directory === null ? !(stat.isFile() || stat.isDirectory()) : directory ? !stat.isDirectory() : !stat.isFile()) throw new Error(directory ? '目标不是目录' : '目标不是文件');
    return resolved;
  }
  async artifact(jobDir, relative) {
    if (!relative || path.isAbsolute(relative)) throw new Error('产物路径必须相对于任务目录');
    const resolved = await fs.realpath(path.resolve(jobDir, relative));
    if (!within(jobDir, resolved)) throw new Error('产物路径越界');
    if (!(await fs.stat(resolved)).isFile()) throw new Error('产物不是文件');
    return resolved;
  }
}
