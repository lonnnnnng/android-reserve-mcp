// long: 动态注册的方法可能没有导出名；RVA只在当前模块的可执行区间内解析，避免把文件偏移或数据段误当函数。
export function resolveNativeAddress(module, selection, env = globalThis) {
  if (!selection.rva) return module.getExportByName(selection.symbolName);
  const offset = Number(selection.rva);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= module.size) throw new Error('RVA超出当前模块范围');
  const address = module.base.add(offset);
  if (address.compare(module.base) < 0 || address.compare(module.base.add(module.size)) >= 0) throw new Error('RVA超出当前模块范围');
  const range = env.Process.findRangeByAddress(address);
  if (!range?.protection.includes('x')) throw new Error('RVA不在可执行内存，不能作为函数入口');
  return address;
}
