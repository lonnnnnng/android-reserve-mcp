#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createContext } from './actions.js';
import { createServer } from './server.js';
import { VERSION } from './version.js';
import { withDeadline } from './core/deadline.js';

const { values } = parseArgs({ options: { allowedRoots: { type: 'string', multiple: true }, workspace: { type: 'string' }, skillRoot: { type: 'string', multiple: true }, 'no-rea': { type: 'boolean', default: false }, version: { type: 'boolean' }, help: { type: 'boolean' } } });
if (values.version) { console.log('android-reserve-mcp ' + VERSION); process.exit(0); }
if (values.help) {
  console.log('android-reserve-mcp [--allowedRoots /project] [--workspace /analysis-data] [--skillRoot /skills] [--no-rea]\n默认stdio；DEX/JNI/资源/Native/Frida按需启动rea-agents@6.9.0。artifact/JS/可选框架CLI可独立使用。'); process.exit(0);
}
const context = await createContext({ allowedRoots: values.allowedRoots?.map(p => path.resolve(p)), workspace: values.workspace, skillRoots: values.skillRoot, disabled: values['no-rea'] });
const server = createServer(context);
let closing;
function close() {
  if (closing) return closing;
  // long: EOF与SIGTERM可能重复到达；它们必须等待同一份清理，不能因第二次close立刻返回而提前退出。
  closing = withDeadline(async () => {
    await context.close().catch(error => console.error(error.message)); await server.close();
  }, { timeoutMs: 35000, label: 'MCP整体退出' }).catch(error => console.error(error.message));
  return closing;
}
process.on('SIGINT', () => { close().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { close().finally(() => process.exit(0)); });
// long: stdio客户端正常结束输入时不会触发信号；先走同一份幂等清理，确保shutdown账本和后端资源都有终态。
process.stdin.on('end', () => { close().finally(() => process.exit(0)); });
const transport = new StdioServerTransport();
await server.connect(transport);
transport.onclose = () => { close().finally(() => process.exit(0)); };
