import { startMonoObserver } from '../../helpers/mono-observer.js';

export function monoTraceScript(args) {
  const target = args.monoTarget;
  if (!target || !/^[A-Za-z0-9_.-]{1,240}$/.test(target.assemblyName || '') || !/^[A-Za-z0-9_.]{0,240}$/.test(target.namespace ?? '') || !/^[A-Za-z0-9_]{1,200}$/.test(target.className || '') || !/^[A-Za-z0-9_]{1,200}$/.test(target.methodName || '')) throw new Error('Mono目标必须提供精确程序集、namespace、非泛型类和方法');
  if (!Array.isArray(target.argumentTypes) || target.argumentTypes.length > 4 || target.argumentTypes.some(t => !['int32', 'bool', 'long', 'float', 'string'].includes(t)) || !['int32', 'bool', 'long', 'float', 'string'].includes(target.returnType)) throw new Error('Mono目前只支持0–4个Int32/bool/long/float/string参数和对应返回值');
  if (target.instance !== undefined && typeof target.instance !== 'boolean') throw new Error('Mono instance必须是布尔值');
  if (target.captureReceiver !== undefined && typeof target.captureReceiver !== 'boolean') throw new Error('Mono captureReceiver必须是布尔值');
  if (target.allowRuntimeCompile !== true) throw new Error('必须显式allowRuntimeCompile=true，运行时解析可能准备JIT/AOT入口');
  const maxEvents = args.maxEvents ?? 50;
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 500) throw new Error('Mono maxEvents超预算');
  const config = { ...target, traceId: args.traceId, maxEvents };
  return `(${startMonoObserver.toString()})(${JSON.stringify(config)});`;
}
