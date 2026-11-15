// long: Compose链路必须同时满足点击、状态写入、重组读取和渲染回调，避免只凭单个方法事件下结论。
export function composeChainMatches(events, { requireDerived = false } = {}) {
  const click = events.find(row => row.event === 'java-enter' && row.hookId === 'click' && row.correlation?.state === 'request');
  if (!click) return false;
  const write = events.find(row => row.event === 'java-enter' && row.hookId === 'write' && row.parentInvocationId === click.invocationId && row.arguments[0]?.value === 1);
  const content = events.find(row => row.event === 'java-enter' && row.hookId === 'content' && row.receiverIdentity?.objectId === click.receiverIdentity?.objectId);
  if (!write || !content) return false;
  const read = events.find(row => row.event === 'java-exit' && row.hookId === 'read' && row.parentInvocationId === content.invocationId && row.returnValue?.value === 1 && row.correlation?.state === 'reply-returned' && row.correlation.requestId === write.invocationId);
  const render = events.find(row => row.event === 'java-enter' && row.hookId === 'render' && row.arguments[0]?.value === 1 && row.correlation?.requestId === click.invocationId);
  const derived = !requireDerived || events.some(row => row.event === 'java-enter' && row.hookId === 'renderDerived' && row.arguments[0]?.value === 2 && row.receiverIdentity?.objectId === click.receiverIdentity?.objectId);
  return !!(read && render && derived && events.some(row => row.event === 'java-exit' && row.invocationId === render.invocationId && row.correlation?.state === 'reply-returned') && events.some(row => row.event === 'java-exit' && row.invocationId === write.invocationId && row.outcome === 'return'));
}

// long: 扩展 fixture 用显式业务入口、状态写入和渲染值组成多条有界链；不按时间单独认定重组因果。
export function composeExtendedChainMatches(events, {
  requireNavigation = true,
  requireMultiState = true,
  requireCoroutine = true,
  expectedRoute = 'detail',
} = {}) {
  const enters = (hookId) => events.filter(row => row.event === 'java-enter' && row.hookId === hookId);
  const sameTrace = (left, right) => !left.traceId || !right.traceId || left.traceId === right.traceId;
  const returned = (row) => events.some(candidate => candidate.event === 'java-exit' && candidate.invocationId === row.invocationId && candidate.outcome === 'return');
  const linkedAfter = (rows, sequence, anchor) => rows.find(row => row.sequence > sequence && sameTrace(row, anchor));
  const click = enters('click').find(row => row.correlation?.state === 'request');
  if (!click || !returned(click)) return false;
  const clickWrite = enters('write').find(row => row.sequence > click.sequence && row.parentInvocationId === click.invocationId && row.arguments?.[0]?.value === 1 && sameTrace(row, click) && returned(row));
  const firstRender = linkedAfter(enters('render').filter(row => row.arguments?.[0]?.value === 1 && returned(row)), click.sequence, click);
  const firstDerived = linkedAfter(enters('renderDerived').filter(row => row.arguments?.[0]?.value === 2 && returned(row)), firstRender?.sequence || click.sequence, click);
  if (!clickWrite || !firstRender || !firstDerived) return false;
  const multi = enters('multi').find(row => row.sequence > firstRender.sequence);
  if (requireMultiState) {
    if (!multi || !sameTrace(multi, click) || !returned(multi)) return false;
    const nestedClick = enters('click').find(row => row.sequence > multi.sequence && row.parentInvocationId === multi.invocationId && sameTrace(row, multi) && returned(row));
    const multiWrites = enters('write').filter(row => row.sequence > multi.sequence && sameTrace(row, multi) && (row.parentInvocationId === multi.invocationId || row.parentInvocationId === nestedClick?.invocationId) && returned(row));
    if (multiWrites.length < 2 || !multiWrites.some(row => row.arguments?.[0]?.value === 2) || !multiWrites.some(row => row.arguments?.[0]?.value === 15)) return false;
    if (!linkedAfter(enters('render').filter(row => row.arguments?.[0]?.value === 2 && returned(row)), multi.sequence, multi)) return false;
    if (!linkedAfter(enters('renderDerived').filter(row => row.arguments?.[0]?.value === 4 && returned(row)), multi.sequence, multi)) return false;
  }
  if (requireNavigation) {
    const navigate = enters('navigate').find(row => row.sequence > (multi?.sequence || firstRender.sequence));
    if (!navigate || !sameTrace(navigate, click) || !returned(navigate)) return false;
    const routeWrite = enters('routeWrite').find(row => row.sequence > navigate.sequence && row.parentInvocationId === navigate.invocationId && sameTrace(row, navigate) && row.arguments?.[0]?.value === expectedRoute && returned(row));
    if (!routeWrite || !linkedAfter(enters('render').filter(row => row.sequence > navigate.sequence && row.arguments?.[0]?.value === 2 && returned(row)), navigate.sequence, navigate)) return false;
  }
  if (requireCoroutine && !events.some(row => row.event === 'java-enter' && row.hookId === 'coroutine' && row.arguments?.[0]?.value >= 1 && row.sequence > firstRender.sequence && sameTrace(row, click) && returned(row))) return false;
  return true;
}
