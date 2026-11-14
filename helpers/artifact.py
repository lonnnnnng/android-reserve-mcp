"""有预算的产物识别和定向提取；不执行目标代码。作者：long。"""
import hashlib
import io
import json
import os
import re
import stat
import struct
import sys
import zipfile
from pathlib import Path, PurePosixPath

MAX_ENTRIES = 12000
MAX_BYTES = 512 * 1024 * 1024
MAX_MEMBER = 128 * 1024 * 1024
MAX_NESTED = 64 * 1024 * 1024
MAX_DEPTH = 3
HBC_MAGIC = 0x1F1903C103BC1FC6


def safe_name(name):
    p = PurePosixPath(name)
    return bool(name and '\x00' not in name and '\\' not in name and not p.is_absolute()
                and '..' not in p.parts and not re.match(r'^[A-Za-z]:', name))


def kind(header, name):
    result = {'kind': 'unknown'}
    if header.startswith(b'\x7fELF') and len(header) >= 20:
        machine = int.from_bytes(header[18:20], 'little' if header[5] == 1 else 'big')
        result = {'kind': 'elf', 'machine': machine, 'architecture': {183: 'arm64', 40: 'arm', 62: 'x64', 3: 'x86'}.get(machine, 'unknown')}
    elif header.startswith((b'dex\n', b'cdex')):
        result = {'kind': 'dex', 'version': header[4:7].decode('ascii', errors='replace')}
    elif len(header) >= 12 and int.from_bytes(header[:8], 'little') in (HBC_MAGIC, HBC_MAGIC ^ ((1 << 64) - 1)):
        result = {'kind': 'hermes-hbc' if int.from_bytes(header[:8], 'little') == HBC_MAGIC else 'hermes-delta', 'bytecodeVersion': int.from_bytes(header[8:12], 'little'), 'validation': 'header-only'}
    elif header.startswith(b'\x00asm'):
        result = {'kind': 'wasm'}
    elif header.startswith(b'\xca\xfe\xba\xbe'):
        result = {'kind': 'java-class'}
    elif header.startswith(b'GDPC'):
        result = {'kind': 'godot-pck'}
    elif header.startswith(b'MZ'):
        result = {'kind': 'pe-candidate', 'validation': 'magic-only-not-managed-proof'}
    elif header.startswith(b'\xfa\xb1\x1b\xaf'):
        result = {'kind': 'il2cpp-metadata', 'version': int.from_bytes(header[4:8], 'little') if len(header) >= 8 else None}
    elif header.startswith(b'PANDA\0'):
        result = {'kind': 'ark-bytecode-candidate', 'validation': 'magic-only-sdk-version-unverified'}
    elif header.startswith((b'PK\x03\x04', b'PK\x05\x06')):
        result = {'kind': 'zip'}
    elif name.lower().endswith(('.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.xml', '.map', '.bundle')) and b'\0' not in header:
        try:
            header.decode('utf8')
            result = {'kind': 'text-candidate', 'validation': 'prefix-only'}
        except UnicodeDecodeError:
            pass
    return result


def zip_kind(names):
    if 'BundleConfig.pb' in names or 'base/manifest/AndroidManifest.xml' in names:
        return 'aab'
    if 'toc.pb' in names and any(n.endswith('.apk') for n in names):
        return 'apks'
    if 'AndroidManifest.xml' in names:
        return 'aar' if 'classes.jar' in names else 'apk'
    if 'module.json' in names and any(n.endswith('.abc') for n in names):
        return 'hap-or-hsp'
    if any(n.endswith('.hap') for n in names):
        return 'harmony-app-candidate'
    if any(n.endswith('.class') for n in names):
        return 'jar'
    return 'zip'


class Inventory:
    def __init__(self):
        self.entries = []
        self.containers = []
        self.warnings = []
        self.bytes_read = 0
        self.partial = False

    def warning(self, value):
        self.partial = True
        if len(self.warnings) < 200:
            self.warnings.append(value)

    def consume(self, stream, expected):
        if expected > MAX_MEMBER or self.bytes_read + expected > MAX_BYTES:
            raise ValueError('read-budget-exceeded')
        digest = hashlib.sha256()
        prefix = b''
        total = 0
        while True:
            chunk = stream.read(65536)
            if not chunk:
                break
            total += len(chunk)
            self.bytes_read += len(chunk)
            if total > MAX_MEMBER or self.bytes_read > MAX_BYTES:
                raise ValueError('read-budget-exceeded')
            digest.update(chunk)
            if len(prefix) < 4096:
                prefix += chunk[:4096 - len(prefix)]
        if total != expected:
            raise ValueError('size-mismatch')
        return prefix, digest.hexdigest()

    def archive(self, archive, chain, depth):
        infos = archive.infolist()
        if len(infos) > MAX_ENTRIES:
            self.warning({'chain': chain, 'reason': 'entry-budget-exceeded'})
            infos = infos[:MAX_ENTRIES]
        names = [i.filename for i in infos]
        self.containers.append({'chain': chain, 'kind': zip_kind(names), 'entries': len(archive.infolist()), 'coverage': 'directory-only-not-package-verification'})
        seen = set()
        for info in infos:
            if info.is_dir():
                continue
            if len(self.entries) >= MAX_ENTRIES:
                self.warning({'chain': chain, 'reason': 'entry-budget-exceeded'})
                break
            member_chain = chain + [info.filename]
            row = {'chain': member_chain, 'bytes': info.file_size, 'compressedBytes': info.compress_size}
            self.entries.append(row)
            mode = info.external_attr >> 16
            if not safe_name(info.filename) or stat.S_ISLNK(mode) or info.filename in seen:
                row['status'] = 'blocked-path-or-duplicate'
                self.warning({'chain': member_chain, 'reason': row['status']})
                continue
            seen.add(info.filename)
            if info.flag_bits & 1 or info.file_size / max(info.compress_size, 1) > 200:
                row['status'] = 'encrypted-or-compression-budget'
                self.warning({'chain': member_chain, 'reason': row['status']})
                continue
            try:
                with archive.open(info) as stream:
                    prefix, digest = self.consume(stream, info.file_size)
                row.update(kind(prefix, info.filename), sha256=digest, status='indexed')
                match = re.search(r'(?:^|/)lib/([^/]+)/', info.filename)
                if match:
                    row['abi'] = match[1]
                if row['kind'] == 'zip':
                    if depth >= MAX_DEPTH or info.file_size > MAX_NESTED or self.bytes_read + info.file_size > MAX_BYTES:
                        self.warning({'chain': member_chain, 'reason': 'nested-container-budget'})
                    else:
                        self.bytes_read += info.file_size
                        with zipfile.ZipFile(io.BytesIO(archive.read(info))) as nested:
                            self.archive(nested, member_chain, depth + 1)
            except (ValueError, OSError, RuntimeError, zipfile.BadZipFile) as error:
                row['status'] = str(error)[:180]
                self.warning({'chain': member_chain, 'reason': row['status']})

    def file(self, file, chain):
        row = {'chain': chain, 'name': file.name, 'bytes': file.stat().st_size}
        self.entries.append(row)
        try:
            with file.open('rb') as stream:
                prefix, digest = self.consume(stream, row['bytes'])
            row.update(kind(prefix, file.name), sha256=digest, status='indexed')
            if row['kind'] == 'zip':
                with zipfile.ZipFile(file) as archive:
                    self.archive(archive, chain, 0)
        except (ValueError, OSError, zipfile.BadZipFile) as error:
            row['status'] = str(error)[:180]
            self.warning({'chain': chain, 'reason': row['status']})


def frameworks(entries):
    paths = [('/'.join(e['chain']) or e.get('name', '')).lower() for e in entries if e.get('status') == 'indexed']
    rules = {
        'flutter': [r'libflutter\.so$', r'libapp\.so$', r'flutter_assets/'],
        'react-native': [r'index\.android\.bundle$', r'libhermes\.so$', r'libreactnative'],
        'unity': [r'libunity\.so$', r'libil2cpp\.so$', r'global-metadata\.dat$'],
        'unreal': [r'lib(?:ue4|unreal)\.so$', r'\.(?:pak|utoc|ucas)$'],
        'godot': [r'libgodot', r'\.pck$', r'project\.binary$'],
        'dotnet': [r'libmonodroid\.so$', r'libmonosgen', r'libcoreclr\.so$', r'libassembl(?:y|ies)'],
        'lynx': [r'\.lynx\.bundle$', r'liblynx'],
        'nativescript': [r'libnativescript'],
        'cordova': [r'cordova\.js$', r'cordova_plugins\.js$'],
        'capacitor': [r'capacitor\.config\.json$', r'capacitor\.js$'],
        'uni-app': [r'__uniapp', r'app-service\.js$'],
    }
    result = []
    for name, patterns in rules.items():
        evidence = [p for p in paths if any(re.search(rule, p) for rule in patterns)]
        if evidence:
            result.append({'name': name, 'status': 'candidate', 'basis': 'file-layout-not-runtime-proof', 'evidence': evidence[:30]})
    return result


def inspect(file):
    index = Inventory()
    if file.is_dir():
        for base, dirs, files in os.walk(file, followlinks=False):
            dirs[:] = sorted(d for d in dirs if not (Path(base) / d).is_symlink())
            for name in sorted(files):
                target = Path(base) / name
                if target.is_symlink():
                    index.warning({'chain': [str(target.relative_to(file))], 'reason': 'symlink-skipped'})
                    continue
                if len(index.entries) >= MAX_ENTRIES:
                    index.warning({'reason': 'entry-budget-exceeded'})
                    dirs[:] = []
                    break
                index.file(target, [target.relative_to(file).as_posix()])
    else:
        index.file(file, [])
    return {'schemaVersion': 1, 'input': str(file), 'entries': index.entries, 'containers': index.containers,
            'frameworks': frameworks(index.entries), 'partial': index.partial, 'warnings': index.warnings,
            'bytesRead': index.bytes_read, 'limits': {'entries': MAX_ENTRIES, 'bytesRead': MAX_BYTES, 'memberBytes': MAX_MEMBER, 'nestedDepth': MAX_DEPTH},
            'limitations': ['目录和指纹不是包完整性/签名验证', '分包尚需显式提供完整集合；未验证包名/版本/签名一致性', '框架候选不代表专用反编译器已经可用']}


def extract(file, chain, output):
    if not chain or len(chain) > MAX_DEPTH + 1 or not all(safe_name(n) for n in chain):
        raise ValueError('invalid-member-chain')
    current = file
    opened = []
    try:
        for i, name in enumerate(chain):
            archive = zipfile.ZipFile(current)
            opened.append(archive)
            matches = [x for x in archive.infolist() if x.filename == name]
            if len(matches) != 1:
                raise ValueError('member-missing-or-duplicate')
            info = matches[0]
            if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1 or info.file_size > MAX_MEMBER or info.file_size / max(info.compress_size, 1) > 200:
                raise ValueError('blocked-member')
            if i < len(chain) - 1:
                if info.file_size > MAX_NESTED:
                    raise ValueError('nested-container-budget')
                current = io.BytesIO(archive.read(info))
            else:
                # long: 输出名由服务决定，归档中的路径仅用于选取，不能决定宿主机目录或覆盖已有文件。
                digest = hashlib.sha256()
                size = 0
                with archive.open(info) as source, output.open('xb') as dest:
                    while True:
                        chunk = source.read(65536)
                        if not chunk:
                            break
                        size += len(chunk)
                        if size > MAX_MEMBER:
                            raise ValueError('member-budget-exceeded')
                        digest.update(chunk)
                        dest.write(chunk)
                if size != info.file_size:
                    raise ValueError('size-mismatch')
                return {'chain': chain, 'output': output.name, 'bytes': size, 'sha256': digest.hexdigest()}
    finally:
        for archive in reversed(opened):
            archive.close()


if __name__ == '__main__':
    action, input_path, report = sys.argv[1:4]
    file = Path(input_path)
    if action == 'inspect':
        result = inspect(file)
    elif action == 'extract':
        result = extract(file, json.loads(sys.argv[4]), Path(sys.argv[5]))
    else:
        raise ValueError('unknown action')
    Path(report).write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps({'report': Path(report).name, 'entries': len(result.get('entries', [])), 'frameworks': result.get('frameworks', []), 'partial': result.get('partial', False), 'output': result.get('output')}))
