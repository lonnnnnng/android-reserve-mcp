import test from 'node:test';
import assert from 'node:assert/strict';
import { composeChainMatches, composeExtendedChainMatches } from '../src/core/compose-correlation.js';

function fixture({ derived = true } = {}) {
  const receiver = { objectId: 'counter' }, state = { objectId: 'state' };
  const click = { event: 'java-enter', hookId: 'click', invocationId: 'click-1', receiverIdentity: receiver, correlation: { state: 'request' } };
  const write = { event: 'java-enter', hookId: 'write', invocationId: 'write-1', parentInvocationId: 'click-1', arguments: [{ value: 1 }], receiverIdentity: state };
  const content = { event: 'java-enter', hookId: 'content', invocationId: 'content-1', receiverIdentity: receiver };
  const read = { event: 'java-exit', hookId: 'read', invocationId: 'read-1', parentInvocationId: 'content-1', returnValue: { value: 1 }, correlation: { state: 'reply-returned', requestId: 'write-1' } };
  const render = { event: 'java-enter', hookId: 'render', invocationId: 'render-1', arguments: [{ value: 1 }], receiverIdentity: receiver, correlation: { requestId: 'click-1' } };
  const renderExit = { event: 'java-exit', hookId: 'render', invocationId: 'render-1', correlation: { state: 'reply-returned' } };
  const writeExit = { event: 'java-exit', hookId: 'write', invocationId: 'write-1', outcome: 'return' };
  const renderDerived = { event: 'java-enter', hookId: 'renderDerived', arguments: [{ value: 2 }], receiverIdentity: receiver };
  return [click, write, content, read, render, renderExit, writeExit, ...(derived ? [renderDerived] : [])];
}

test('Compose基础链在没有derived配置时保持兼容', () => {
  assert.equal(composeChainMatches(fixture({ derived: false })), true);
});

test('Compose派生链要求同一receiver上的derived值', () => {
  assert.equal(composeChainMatches(fixture(), { requireDerived: true }), true);
  assert.equal(composeChainMatches(fixture({ derived: false }), { requireDerived: true }), false);
});

test('Compose扩展链闭合多状态、导航和coroutine序列', () => {
  const rows = [
    { sequence: 1, event: 'java-enter', hookId: 'click', invocationId: 'click-1', correlation: { state: 'request' } },
    { sequence: 2, event: 'java-enter', hookId: 'write', invocationId: 'write-1', parentInvocationId: 'click-1', arguments: [{ value: 1 }] },
    { sequence: 3, event: 'java-enter', hookId: 'render', invocationId: 'render-1', arguments: [{ value: 1 }] },
    { sequence: 4, event: 'java-enter', hookId: 'renderDerived', invocationId: 'derived-1', arguments: [{ value: 2 }] },
    { sequence: 5, event: 'java-enter', hookId: 'multi', invocationId: 'multi-1' },
    { sequence: 6, event: 'java-enter', hookId: 'click', invocationId: 'click-2', parentInvocationId: 'multi-1' },
    { sequence: 7, event: 'java-enter', hookId: 'write', invocationId: 'write-2', parentInvocationId: 'click-2', arguments: [{ value: 2 }] },
    { sequence: 8, event: 'java-enter', hookId: 'write', invocationId: 'write-3', parentInvocationId: 'multi-1', arguments: [{ value: 15 }] },
    { sequence: 9, event: 'java-enter', hookId: 'render', invocationId: 'render-2', arguments: [{ value: 2 }] },
    { sequence: 10, event: 'java-enter', hookId: 'renderDerived', invocationId: 'derived-2', arguments: [{ value: 4 }] },
    { sequence: 11, event: 'java-enter', hookId: 'navigate', invocationId: 'navigate-1' },
    { sequence: 12, event: 'java-enter', hookId: 'routeWrite', invocationId: 'route-1', parentInvocationId: 'navigate-1', arguments: [{ value: 'detail' }] },
    { sequence: 13, event: 'java-enter', hookId: 'render', invocationId: 'render-3', arguments: [{ value: 2 }] },
    { sequence: 14, event: 'java-enter', hookId: 'coroutine', invocationId: 'coroutine-1', arguments: [{ value: 2 }] },
  ];
  for (const row of rows.filter(row => row.event === 'java-enter' && row.invocationId)) {
    rows.push({ sequence: rows.length + 1, event: 'java-exit', hookId: row.hookId, invocationId: row.invocationId, outcome: 'return' });
  }
  assert.equal(composeExtendedChainMatches(rows), true);
});

test('Compose扩展链缺少返回事件时保持未完成', () => {
  const rows = [
    { sequence: 1, event: 'java-enter', hookId: 'click', invocationId: 'click-1', correlation: { state: 'request' } },
    { sequence: 2, event: 'java-enter', hookId: 'write', invocationId: 'write-1', parentInvocationId: 'click-1', arguments: [{ value: 1 }] },
    { sequence: 3, event: 'java-enter', hookId: 'render', invocationId: 'render-1', arguments: [{ value: 1 }] },
    { sequence: 4, event: 'java-enter', hookId: 'renderDerived', invocationId: 'derived-1', arguments: [{ value: 2 }] },
  ];
  assert.equal(composeExtendedChainMatches(rows, { requireNavigation: false, requireMultiState: false, requireCoroutine: false }), false);
});

test('Compose扩展链拒绝错误导航目标', () => {
  const rows = [
    { sequence: 1, event: 'java-enter', hookId: 'click', invocationId: 'click-1', correlation: { state: 'request' } },
    { sequence: 2, event: 'java-enter', hookId: 'write', invocationId: 'write-1', parentInvocationId: 'click-1', arguments: [{ value: 1 }] },
    { sequence: 3, event: 'java-enter', hookId: 'render', invocationId: 'render-1', arguments: [{ value: 1 }] },
    { sequence: 4, event: 'java-enter', hookId: 'renderDerived', invocationId: 'derived-1', arguments: [{ value: 2 }] },
    { sequence: 5, event: 'java-enter', hookId: 'navigate', invocationId: 'navigate-1' },
    { sequence: 6, event: 'java-enter', hookId: 'routeWrite', invocationId: 'route-1', parentInvocationId: 'navigate-1', arguments: [{ value: 'settings' }] },
    { sequence: 7, event: 'java-enter', hookId: 'render', invocationId: 'render-2', arguments: [{ value: 2 }] },
  ];
  for (const row of rows.filter(row => row.event === 'java-enter')) {
    rows.push({ sequence: rows.length + 1, event: 'java-exit', hookId: row.hookId, invocationId: row.invocationId, outcome: 'return' });
  }
  assert.equal(composeExtendedChainMatches(rows, { requireMultiState: false, requireCoroutine: false }), false);
});
