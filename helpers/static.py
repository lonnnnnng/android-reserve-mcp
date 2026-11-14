"""Android 静态摘要，仅使用 Python 标准库。作者：long。"""
import hashlib
import json
import struct
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


def apk(file):
    with file.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    with zipfile.ZipFile(file) as archive:
        entries = archive.infolist()
        dex = [e.filename for e in entries if e.filename.endswith('.dex')]
        libs = [e for e in entries if e.filename.startswith('lib/') and e.filename.endswith('.so')]
        # long: 只读取 ZIP 目录而不自动展开条目，APK 中的路径不能决定宿主机输出位置。
        return {'path': str(file), 'sha256': digest, 'bytes': file.stat().st_size,
                'entries': len(entries), 'dex': dex[:200], 'abis': sorted({e.filename.split('/')[1] for e in libs}),
                'libraries': [{'path': e.filename, 'bytes': e.file_size} for e in libs[:200]],
                'libraries_truncated': len(libs) > 200,
                'has_manifest': 'AndroidManifest.xml' in archive.namelist()}


def manifest(file):
    namespace = '{http://schemas.android.com/apk/res/android}'
    root = ET.parse(file).getroot()
    attr = lambda element, name: element.get(namespace + name)
    uses = root.find('uses-sdk')
    components = []
    app = root.find('application')
    if app is not None:
        for element in app:
            if element.tag not in ['activity', 'activity-alias', 'service', 'receiver', 'provider']:
                continue
            filters = []
            for entry in element.findall('intent-filter'):
                filters.append({'actions': [attr(x, 'name') for x in entry.findall('action')],
                                'categories': [attr(x, 'name') for x in entry.findall('category')],
                                'data': [{k.removeprefix(namespace): v for k, v in x.attrib.items()} for x in entry.findall('data')]})
            components.append({'type': element.tag, 'name': attr(element, 'name'),
                               'declared_exported': attr(element, 'exported'),
                               'permission': attr(element, 'permission'), 'authorities': attr(element, 'authorities'),
                               'intent_filters': filters})
    # long: 未声明 exported 保留 null，实际默认值依赖组件和 SDK，不误报为 false。
    return {'package': root.get('package'), 'version_name': attr(root, 'versionName'), 'version_code': attr(root, 'versionCode'),
            'version_code_major': attr(root, 'versionCodeMajor'), 'split': root.get('split') or None,
            'is_feature_split': attr(root, 'isFeatureSplit') == 'true', 'config_for_split': root.get('configForSplit') or None,
            'uses_splits': [attr(x, 'name') for x in root.findall('uses-split')],
            'split_required': attr(root, 'isSplitRequired') == 'true' or (app is not None and attr(app, 'isSplitRequired') == 'true'),
            'sdk': None if uses is None else {'min': attr(uses, 'minSdkVersion'), 'target': attr(uses, 'targetSdkVersion')},
            'permissions': [attr(x, 'name') for x in root.findall('uses-permission')],
            'component_count': len(components), 'components': components[:500], 'truncated': len(components) > 500}


def elf(file):
    with file.open('rb') as stream:
        header = stream.read(64)
    if len(header) < 20 or header[:4] != b'\x7fELF':
        raise ValueError('目标不是 ELF 文件')
    if header[4] not in (1, 2) or header[5] not in (1, 2):
        raise ValueError('不支持的 ELF 编码')
    endian = '<' if header[5] == 1 else '>'
    machine = struct.unpack(endian + 'H', header[18:20])[0]
    return {'bits': 32 if header[4] == 1 else 64, 'endian': 'little' if header[5] == 1 else 'big',
            'machine': machine, 'architecture': {3: 'x86', 40: 'ARM', 62: 'x86_64', 183: 'AArch64'}.get(machine, 'unknown'),
            'bytes': file.stat().st_size}


if __name__ == '__main__':
    command, file = sys.argv[1], Path(sys.argv[2]).resolve()
    print(json.dumps({'apk': apk, 'manifest': manifest, 'elf': elf}[command](file), ensure_ascii=False))
