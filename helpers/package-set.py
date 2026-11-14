"""作者：long。只收集显式选择的安装集合，APKS中的设备变体不能自动混成一套。"""
import hashlib
import json
import os
import shutil
import sys
import zipfile
from pathlib import Path
from artifact import safe_name

MAX_FILE = 512 * 1024 * 1024
MAX_TOTAL = 1024 * 1024 * 1024


def preflight(source, target):
    # long: 外部JVM开始前先固定输入并检查整个容器，避免先解压再发现预算超限。
    with source.open('rb') as src, target.open('xb') as dst:
        total, digest = 0, hashlib.sha256()
        while chunk := src.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_FILE:
                raise ValueError('容器文件超过512MiB')
            digest.update(chunk)
            dst.write(chunk)
    with zipfile.ZipFile(target) as archive:
        entries = archive.infolist()
        if len(entries) > 12000 or len({e.filename for e in entries}) != len(entries):
            raise ValueError('容器目录超预算或包含重复项')
        expanded = 0
        for entry in entries:
            if entry.is_dir():
                continue
            if not safe_name(entry.filename) or entry.flag_bits & 1 or (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('容器存在不安全路径、加密或链接')
            expanded += entry.file_size
            if entry.file_size > MAX_FILE or expanded > MAX_TOTAL or entry.file_size / max(entry.compress_size, 1) > 200:
                raise ValueError('容器展开量或压缩比超过预算')
    return {'snapshot': str(target), 'bytes': total, 'sha256': digest.hexdigest(), 'expandedBytes': expanded}


def collect(source, output, members):
    output.mkdir()
    records, total = [], 0

    def save(name, stream, size):
        nonlocal total
        if len(records) >= 128 or size > MAX_FILE or total + size > MAX_TOTAL:
            raise ValueError('分包集合超过128项/单项512MiB/总计1GiB预算')
        target = output / ('package-%03d.apk' % len(records))
        digest, count = hashlib.sha256(), 0
        with target.open('xb') as dest:
            while chunk := stream.read(1024 * 1024):
                count += len(chunk)
                if count > size or count > MAX_FILE:
                    raise ValueError('分包实际展开量超过声明或预算')
                digest.update(chunk)
                dest.write(chunk)
        if count != size:
            raise ValueError('分包展开长度与声明不符')
        total += count
        records.append({'source': name, 'path': str(target), 'sha256': digest.hexdigest(), 'bytes': count})

    if source.is_dir():
        scanned = 0
        for directory, dirs, files in os.walk(source, followlinks=False):
            for name in dirs + files:
                p = Path(directory) / name
                scanned += 1
                if scanned > 12000 or p.is_symlink():
                    raise ValueError('目录包含符号链接或超过12000项预算')
            for name in sorted(files):
                p = Path(directory) / name
                if p.suffix.lower() == '.apk':
                    with p.open('rb') as stream:
                        save(str(p.relative_to(source)), stream, p.stat().st_size)
    elif source.suffix.lower() == '.apk':
        with source.open('rb') as stream:
            save(source.name, stream, source.stat().st_size)
    else:
        with zipfile.ZipFile(source) as archive:
            entries = archive.infolist()
            if len(entries) > 12000:
                raise ValueError('归档目录超过12000项')
            names = [e.filename for e in entries]
            candidates = [n for n in names if n.lower().endswith('.apk')]
            if not members:
                return {'requiresSelection': True, 'members': candidates[:512], 'partial': len(candidates) > 512}
            if len(set(members)) != len(members):
                raise ValueError('members包含重复项')
            for name in members:
                if not safe_name(name):
                    raise ValueError('分包成员路径不安全')
                if names.count(name) != 1 or not name.lower().endswith('.apk'):
                    raise ValueError('分包成员不存在、重复或不是APK')
                entry = archive.getinfo(name)
                if entry.flag_bits & 1 or (entry.external_attr >> 16) & 0o170000 == 0o120000 or entry.file_size / max(entry.compress_size, 1) > 200:
                    raise ValueError('分包成员加密、是链接或压缩比超预算')
                with archive.open(entry) as stream:
                    save(name, stream, entry.file_size)
    if not records:
        raise ValueError('未找到APK；AAB请使用packages.aab-manifests，不把proto manifest当APK')
    return {'records': records, 'totalBytes': total, 'snapshot': True}


def aab_modules(source, output):
    output.mkdir()
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if len(entries) > 12000 or len({e.filename for e in entries}) != len(entries):
            raise ValueError('AAB目录超预算或含重复成员')
        modules = sorted({e.filename.split('/')[0] for e in entries if e.filename.endswith('/manifest/AndroidManifest.xml') and e.filename.count('/') == 2})
        if not modules or len(modules) > 64:
            raise ValueError('AAB模块数无效')
        records, total = [], 0
        for index, module in enumerate(modules):
            target = output / ('module-%03d.proto.apk' % index)
            with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as dest:
                for entry in entries:
                    if not entry.filename.startswith(module + '/') or entry.is_dir():
                        continue
                    relative = entry.filename[len(module) + 1:]
                    if relative == 'manifest/AndroidManifest.xml':
                        name = 'AndroidManifest.xml'
                    elif relative.startswith('dex/'):
                        name = relative[4:]
                    elif relative == 'resources.pb' or relative.startswith(('res/', 'assets/', 'lib/')):
                        name = relative
                    else:
                        continue
                    if not safe_name(entry.filename) or not safe_name(name) or entry.flag_bits & 1 or (entry.external_attr >> 16) & 0o170000 == 0o120000:
                        raise ValueError('AAB成员路径、链接或加密不受支持')
                    if entry.file_size > MAX_FILE or total + entry.file_size > MAX_TOTAL or entry.file_size / max(entry.compress_size, 1) > 200:
                        raise ValueError('AAB成员展开超过预算')
                    total += entry.file_size
                    with archive.open(entry) as src, dest.open(name, 'w') as dst:
                        shutil.copyfileobj(src, dst, 1024 * 1024)
            records.append({'module': module, 'path': str(target), 'signing': 'unsigned-analysis-derivative'})
        return records


if __name__ == '__main__':
    mode = sys.argv[3]
    result = preflight(Path(sys.argv[1]), Path(sys.argv[2])) if mode == 'preflight' else aab_modules(Path(sys.argv[1]), Path(sys.argv[2])) if mode == 'aab-modules' else collect(Path(sys.argv[1]), Path(sys.argv[2]), json.loads(mode))
    print(json.dumps(result, ensure_ascii=False))
