"""作者：long。封装自有IL为格式夹具，不把它称为真实MAUI APK或可安装runtime。"""
import struct
import sys
import zlib
from pathlib import Path
import lz4.block
import zstandard

root, dll = Path(sys.argv[1]), Path(sys.argv[2]).read_bytes()
root.mkdir(exist_ok=True)


def compressed(codec):
    if codec == 'none':
        return dll
    data = lz4.block.compress(dll, store_size=False) if codec == 'lz4' else zstandard.ZstdCompressor().compress(dll)
    return (b'XALZ' if codec == 'lz4' else b'XAZS') + struct.pack('<II', 0, len(dll)) + data


def store(version, codec, wide=True):
    image = compressed(codec)
    if version == 1:
        return struct.pack('<IIIII', 0x41424158, 1, 1, 0, 1) + struct.pack('<IIIIII', 44, len(image), 0, 0, 0, 0) + image
    name = b'ReserveManagedFixture.dll'
    names = struct.pack('<I', len(name)) + name
    if version == 3:
        hashes = sorted((zlib.crc32(name), zlib.crc32(name[:-4])))
        index = b''.join(struct.pack('<IIB', h, 0, 0) for h in hashes)
    else:
        # long: v2只测试布局与提取；未构造runtime的xxhash索引，不宣称该夹具可供Android runtime加载。
        index = b''.join(struct.pack('<QI' if wide else '<II', h, 0) for h in (0, 1))
    offset = 20 + len(index) + 28 + len(names)
    encoded = version | (0x80010000 if wide else 0x00020000)
    return struct.pack('<IIIII', 0x41424158, encoded, 1, 2, len(index)) + index + struct.pack('<IIIIIII', 0, offset, len(image), 0, 0, 0, 0) + names + image


for version, codec, wide in [(1, 'none', True), (1, 'lz4', True), (2, 'lz4', True), (2, 'none', False), (3, 'zstd', True)]:
    (root / ('v%d-%s-%d.blob' % (version, codec, wide))).write_bytes(store(version, codec, wide))
for codec in ('lz4', 'zstd'):
    (root / (codec + '.blob')).write_bytes(compressed(codec))
raw = store(3, 'zstd')
(root / 'store.c').write_text('__attribute__((visibility("default"))) const unsigned char _assembly_store[]={' + ','.join(map(str, raw)) + '};\n')
(root / 'bad-version.blob').write_bytes(b'XABA' + struct.pack('<IIII', 99, 1, 0, 0))
(root / 'bad-length.blob').write_bytes(b'XAZS' + struct.pack('<II', 0, 129 * 1024 * 1024) + b'bad')
