// long: 跨脚本只传数据selector，不复用失效句柄；类型与有序Dex路径无法唯一匹配时拒绝猜选。
export function scanJavaLoaders(Java, traceId, complete, failed) {
  const records = []; let partial = false;
  const Base = Java.use('dalvik.system.BaseDexClassLoader');
  try {
    Java.enumerateClassLoaders({
      onMatch(wrapper) {
        if (records.length >= 128) { partial = true; wrapper.$dispose(); return; }
        const record = { wrapper, loaderId: `${traceId}:loader:${records.length + 1}`, type: wrapper.$className, dexPaths: [], error: null };
        try {
          const typed = Java.cast(wrapper, Base);
          try {
            const elements = typed.pathList.value.dexElements.value;
            if (elements.length > 64) throw new Error('Dex元素超过64项');
            for (const element of elements) {
              const dex = element.dexFile.value;
              if (dex !== null) { const file = dex.mFileName.value; if (file !== null) record.dexPaths.push(String(file)); }
            }
            if (record.dexPaths.some(p => p.length > 4096)) throw new Error('Dex路径超过预算');
          } finally { typed.$dispose(); }
        } catch (error) { record.error = String(error.message || error).slice(0, 300); }
        record.selector = record.error ? null : { type: record.type, dexPaths: record.dexPaths };
        records.push(record);
      },
      onComplete() { complete(records, partial); },
    });
  } catch (error) { records.forEach(r => r.wrapper.$dispose()); failed(error); }
}

export function withJavaFactory(Java, config, ready, failed, stopped = () => false) {
  const publicRecord = ({ loaderId, type, dexPaths, selector, error }) => ({ loaderId, type, dexPaths, selector, error });
  if (!config.loaderSelector && config.action !== 'java-loaders') { ready(Java.classFactory || { use: name => Java.use(name) }, { kind: 'default-app-classloader' }, () => {}); return; }
  scanJavaLoaders(Java, config.traceId, (records, partial) => {
    let retained = null; const disposed = new Set();
    const dispose = record => { if (!disposed.has(record)) { disposed.add(record); record.wrapper.$dispose(); } };
    const release = () => { if (retained) { dispose(retained); retained = null; } };
    try {
      if (stopped()) return;
      if (config.action === 'java-loaders') { ready(null, { kind: 'enumeration', records: records.map(publicRecord), partial }, () => {}); return; }
      if (partial) throw new Error('ClassLoader枚举超预算，不能证明唯一选择');
      if (records.some(r => r.type === config.loaderSelector.type && r.error)) throw new Error('同类型ClassLoader存在读取失败，不能证明selector唯一');
      const matches = records.filter(r => r.selector && r.type === config.loaderSelector.type && JSON.stringify(r.dexPaths) === JSON.stringify(config.loaderSelector.dexPaths));
      if (matches.length !== 1) throw new Error(`ClassLoader selector必须唯一匹配，当前${matches.length}`);
      retained = matches[0];
      // long: ClassFactory.get会把父loader缓存到子factory；独立factory避免选中父对象却使用子对象加载。
      const factory = new Java.ClassFactory(); factory.loader = retained.wrapper;
      ready(factory, { kind: 'selected-classloader', ...publicRecord(retained) }, release);
    } catch (error) { release(); failed(error); }
    finally { records.filter(r => r !== retained).forEach(dispose); }
  }, failed);
}
