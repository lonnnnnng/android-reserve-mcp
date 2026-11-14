import test from 'node:test';
import assert from 'node:assert/strict';
import { run, tool } from '../src/core/process.js';

test('真实MAUI所用v3索引支持9/13字节，ELF唯一payload节定位且拒绝越界', async () => {
  const code = [
    'import sys,struct',
    'sys.path.insert(0,"helpers")',
    'import runpy',
    'module=runpy.run_path("helpers/assembly-store.py");parse_store=module["parse_store"];elf_payload=module["elf_payload"]',
    'for width in (4,8):',
    ' name=b"Owned.dll";size=width+5',
    ' index=struct.pack("<I" if width==4 else "<Q",0)+struct.pack("<IB",0,0)',
    ' offset=20+size+28+4+len(name)',
    ' blob=struct.pack("<IIIII",0x41424158,0x80010003,1,1,size)+index+struct.pack("<IIIIIII",0,offset,2,0,0,0,0)+struct.pack("<I",len(name))+name+b"MZ"',
    ' version,rows=parse_store(blob,0,len(blob));assert rows[0]["name"]=="Owned.dll"',
    'names=b"\\0.shstrtab\\0payload\\0"',
    'data=bytearray(512);data[:6]=b"\\x7fELF\\x02\\x01";struct.pack_into("<Q",data,40,64);struct.pack_into("<HHH",data,58,64,3,1)',
    'struct.pack_into("<IIQQQQIIQQ",data,128,1,3,0,0,300,len(names),0,0,1,0)',
    'struct.pack_into("<IIQQQQIIQQ",data,192,11,1,0,0,400,2,0,0,1,0)',
    'data[300:300+len(names)]=names;data[400:402]=b"MZ";assert elf_payload(data)==(400,2)',
    'struct.pack_into("<Q",data,192+32,200)',
    'try:elf_payload(data);raise AssertionError("越界未拒绝")',
    'except ValueError:pass',
  ].join('\n');
  const result = await run(await tool('python3'), ['-c', code], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }); assert.equal(result.code, 0, result.stderr);
});
