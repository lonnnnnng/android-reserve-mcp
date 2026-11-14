export function aborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('任务已取消');
}

export function waitWithSignal(promise, signal) {
  if (!signal) return promise;
  aborted(signal);
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason instanceof Error ? signal.reason : new Error('任务已取消'));
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}

export async function withDeadline(operation, { signal, timeoutMs = 10000, label = '操作' } = {}) {
  aborted(signal);
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason instanceof Error ? signal.reason : new Error('任务已取消'));
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    const error = new Error(`${label}超时（${timeoutMs}ms）`);
    error.code = 'deadline_exceeded';
    controller.abort(error);
  }, timeoutMs);
  try {
    // long: 启动和退出也必须有总期限；只向支持取消的操作传信号，同时阻止不响应信号的调用卡住客户端。
    return await waitWithSignal(Promise.resolve().then(() => operation(controller.signal)), controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
