"""有界读取解码布局XML中的android:onClick声明。作者：long。"""
import json
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ANDROID = '{http://schemas.android.com/apk/res/android}'
TOOLS = '{http://schemas.android.com/tools}'
MAX_FILES = 5000
MAX_FILE = 2 * 1024 * 1024
MAX_TOTAL = 32 * 1024 * 1024
MAX_EVENTS = 10000


def inspect(root, requested_class=None):
    if not root.is_dir():
        raise ValueError('输入必须是apktool解码目录或res目录')
    base = root / 'res' if (root / 'res').is_dir() else root
    rows, warnings, scanned, total = [], [], 0, 0
    partial = False
    for directory, dirs, files in os.walk(base, followlinks=False):
        current = Path(directory)
        dirs[:] = sorted(name for name in dirs if not (current / name).is_symlink())
        if current != base and not current.name.startswith('layout'):
            dirs[:] = []
            continue
        for name in sorted(files):
            file = current / name
            if file.is_symlink() or file.suffix.lower() != '.xml':
                continue
            scanned += 1
            size = file.stat().st_size
            total += size
            if scanned > MAX_FILES or size > MAX_FILE or total > MAX_TOTAL:
                warnings.append({'file': file.relative_to(base).as_posix(), 'reason': 'budget-exceeded'})
                partial = True
                continue
            try:
                data = file.read_bytes()
                # long: APK内的恶意DTD/实体不用于布局扫描，限制XML解析器只处理普通资源节点。
                if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
                    raise ValueError('doctype-or-entity-blocked')
                document = ET.fromstring(data)
            except (OSError, ET.ParseError, ValueError) as error:
                warnings.append({'file': file.relative_to(base).as_posix(), 'reason': str(error)[:180]})
                partial = True
                continue
            declared_context = document.attrib.get(TOOLS + 'context')
            for element in document.iter():
                handler = element.attrib.get(ANDROID + 'onClick')
                if not handler:
                    continue
                if len(rows) >= MAX_EVENTS:
                    partial = True
                    break
                rows.append({
                    'layout': file.relative_to(base).as_posix(),
                    'viewClass': element.tag,
                    'viewId': element.attrib.get(ANDROID + 'id'),
                    'handler': handler,
                    'declaredContext': declared_context,
                    'candidateClass': requested_class or declared_context,
                    'candidateSignature': (requested_class or declared_context or '<activity-not-specified>') + '#' + handler + '(android.view.View)',
                    'resolution': 'declaration-only-not-verified-in-dex',
                })
    return {
        'kind': 'android-view-onclick-declarations',
        'events': rows,
        'filesScanned': min(scanned, MAX_FILES),
        'bytesScanned': min(total, MAX_TOTAL),
        'partial': partial,
        'warnings': warnings[:200],
        'limitation': '只识别已解码XML中的android:onClick声明；不证明所属Activity、DEX方法可见性或运行时点击行为。Compose与listener动态绑定不在此扫描范围。',
    }


if __name__ == '__main__':
    report = inspect(Path(sys.argv[1]), sys.argv[2] if len(sys.argv) > 2 else None)
    print(json.dumps(report, ensure_ascii=False))
