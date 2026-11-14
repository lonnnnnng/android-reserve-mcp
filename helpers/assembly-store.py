"""作者：long。按已核验store布局离线提取，不执行目标ELF或dlopen。"""
import hashlib
import io
import json
import mmap
import struct
import sys
from pathlib import Path
from artifact import safe_name

MAX_IMAGE = 128 * 1024 * 1024


def checked_span(offset, size, limit):
    if offset < 0 or size < 0 or offset + size > limit:
        raise ValueError('store/ELF区间越界')


def elf_payload(data):
    if len(data) < 64 or data[:4] != b'\x7fELF' or data[5] != 1 or data[4] not in (1, 2):
        raise ValueError('只支持可定位程序集载荷的小端ELF32/64')
    wide = data[4] == 2
    offset = struct.unpack_from('<Q' if wide else '<I', data, 40 if wide else 32)[0]
    stride, count = struct.unpack_from('<HH', data, 58 if wide else 46)
    if not 0 < count <= 4096 or stride < (64 if wide else 40):
        raise ValueError('ELF无受支持的节表，拒绝扫描magic猜载荷')
    checked_span(offset, count * stride, len(data))
    sections = [struct.unpack_from('<IIQQQQIIQQ' if wide else '<IIIIIIIIII', data, offset + i * stride) for i in range(count)]
    matches, seen_tables, symbol_total = set(), set(), 0
    for section in sections:
        if section[1] not in (2, 11):
            continue
        if section[9] < (24 if wide else 16) or section[5] % section[9] or section[6] >= len(sections):
            raise ValueError('ELF符号表不受支持')
        table = (section[4], section[5], section[9], section[6])
        if table in seen_tables:
            continue
        seen_tables.add(table)
        symbol_total += section[5] // section[9]
        if symbol_total > 200000:
            raise ValueError('ELF累计符号数超过200000')
        strings = sections[section[6]]
        checked_span(section[4], section[5], len(data)); checked_span(strings[4], strings[5], len(data))
        for pos in range(section[4], section[4] + section[5], section[9]):
            symbol = struct.unpack_from('<IBBHQQ' if wide else '<IIIBBH', data, pos)
            name, shndx, value, size = (symbol[0], symbol[3], symbol[4], symbol[5]) if wide else (symbol[0], symbol[5], symbol[1], symbol[2])
            if name + 16 > strings[5] or data[strings[4] + name:strings[4] + name + 16] != b'_assembly_store\0':
                continue
            if not 0 < shndx < count:
                raise ValueError('_assembly_store不是已定义节符号')
            target = sections[shndx]
            delta = value - target[3]
            if target[1] == 8 or not target[2] & 2 or delta < 0 or delta >= target[5]:
                raise ValueError('store符号不是有文件内容的已分配节')
            span = size or target[5] - delta
            if span > target[5] - delta:
                raise ValueError('store符号超出节')
            checked_span(target[4] + delta, span, len(data)); matches.add((target[4] + delta, span))
    if not matches:
        # long: .NET Android真实Release包使用名为payload的非加载节；仅按节表定位，绝不扫magic猜偏移。
        name_index = struct.unpack_from('<H', data, 62 if wide else 50)[0]
        if name_index >= count or sections[name_index][1] != 3:
            raise ValueError('ELF节名表无效')
        names = sections[name_index]
        checked_span(names[4], names[5], len(data))
        payloads = []
        for section in sections:
            start = names[4] + section[0]
            if section[0] >= names[5]:
                raise ValueError('ELF节名称偏移越界')
            if section[0] + 8 <= names[5] and data[start:start + 8] == b'payload\0':
                if section[1] != 1 or section[2] & 4 or not 0 < section[5] <= 512 * 1024 * 1024:
                    raise ValueError('ELF payload节类型/大小无效')
                checked_span(section[4], section[5], len(data))
                payloads.append((section[4], section[5]))
        if len(payloads) != 1:
            raise ValueError('必须有唯一_assembly_store符号或payload节')
        return payloads[0]
    if len(matches) != 1:
        raise ValueError('必须有唯一_assembly_store有效符号')
    return next(iter(matches))


def decode_image(raw):
    codec, declared = 'none', len(raw)
    if raw[:4] in (b'XALZ', b'XAZS'):
        if len(raw) < 12:
            raise ValueError('压缩程序集头不完整')
        declared = struct.unpack_from('<I', raw, 8)[0]
        if not 0 < declared <= MAX_IMAGE:
            raise ValueError('程序集声明解压长度超过128MiB或无效')
        if raw[:4] == b'XALZ':
            import lz4.block
            codec = 'lz4-block'; raw = lz4.block.decompress(raw[12:], uncompressed_size=declared)
        else:
            import zstandard
            codec = 'zstd'
            # long: 已知帧长度也先核对预算，避免解码器按大帧声明分配；未知长度受max_output_size约束。
            length = zstandard.frame_content_size(raw[12:])
            if length not in (zstandard.CONTENTSIZE_UNKNOWN, zstandard.CONTENTSIZE_ERROR) and length != declared:
                raise ValueError('Zstd帧长度与程序集头不一致')
            raw = zstandard.ZstdDecompressor(max_window_size=MAX_IMAGE // 1024).decompress(raw[12:], max_output_size=declared, allow_extra_data=False)
        if len(raw) != declared:
            raise ValueError('程序集解压长度不一致')
    if len(raw) > MAX_IMAGE:
        raise ValueError('单程序集超过128MiB')
    return raw, codec


def parse_store(data, base, span):
    checked_span(base, span, len(data)); checked_span(0, 20, span)
    magic, version, count, indexes, extra = struct.unpack_from('<IIIII', data, base)
    if magic != 0x41424158 or count > 4096:
        raise ValueError('store magic或条目数不受支持')
    rows, names, ignored = [], [], set()
    if version == 1:
        store_id = extra; cursor = 20 + count * 24
        checked_span(0, cursor, span)
        if store_id == 0:
            checked_span(cursor, indexes * 40, span); cursor += indexes * 40
        for i in range(count):
            rows.append((i, *struct.unpack_from('<IIIIII', data, base + 20 + i * 24)))
            names.append(None)
    elif version & 0xffff in (2, 3):
        if version & ~0x800fffff or (version & 0x000f0000) not in (0x10000, 0x20000, 0x30000, 0x40000):
            raise ValueError('未知store ABI或版本标志')
        format_version = version & 0xffff
        # long: v3真实产物既有9字节CRC32索引也有13字节64位索引，按头部声明选择已知尺寸，不能只看ABI推断。
        if indexes > 32768 or not indexes or extra % indexes:
            raise ValueError('store索引大小不一致或超预算')
        index_stride = extra // indexes
        allowed = (8, 12) if format_version == 2 else (9, 13)
        if index_stride not in allowed:
            raise ValueError('未核验的store索引条目大小')
        hash_bytes = index_stride - 4 - (1 if format_version == 3 else 0)
        checked_span(20, extra + count * 28, span)
        active, seen = set(), set()
        for i in range(indexes):
            index = struct.unpack_from('<I', data, base + 20 + i * index_stride + hash_bytes)[0]
            ignore = data[base + 20 + i * index_stride + hash_bytes + 4] if format_version == 3 else 0
            if index >= count:
                raise ValueError('store索引引用不存在的descriptor')
            seen.add(index)
            if not ignore:
                active.add(index)
        ignored = seen - active
        cursor = 20 + extra + count * 28
        rows = [struct.unpack_from('<IIIIIII', data, base + 20 + extra + i * 28) for i in range(count)]
        for _ in range(count):
            checked_span(cursor, 4, span); length = struct.unpack_from('<I', data, base + cursor)[0]; cursor += 4
            if length > 4096:
                raise ValueError('程序集名称超过4096字节')
            checked_span(cursor, length, span); name = data[base + cursor:base + cursor + length].decode('utf8'); cursor += length
            if not safe_name(name):
                raise ValueError('程序集名称不安全')
            names.append(name)
    else:
        raise ValueError('未核验的store版本，拒绝套用其他布局：' + str(version))
    ranges = []
    result = []
    for i, row in enumerate(rows):
        mapping, offset, size, debug_offset, debug_size, config_offset, config_size = row
        if i in ignored and offset == size == 0:
            result.append({'index': i, 'name': names[i], 'ignored': True}); continue
        if not offset or not size:
            raise ValueError('程序集缺少数据')
        for start, length in [(offset, size), (debug_offset, debug_size), (config_offset, config_size)]:
            if bool(start) != bool(length) or (length and start < cursor):
                raise ValueError('程序集数据与元数据重叠或区间不完整')
            if length:
                checked_span(start, length, span); ranges.append((start, start + length))
        result.append({'index': i, 'name': names[i], 'mappingIndex': mapping, 'offset': offset, 'size': size, 'debug': [debug_offset, debug_size], 'config': [config_offset, config_size]})
    prior = None
    for region in sorted(ranges):
        if prior and region[0] < prior[1] and region != prior:
            raise ValueError('store数据区存在非相同重叠')
        prior = region
    return version, result


def analyze(file, output, extract):
    if not 0 < file.stat().st_size <= 512 * 1024 * 1024:
        raise ValueError('输入为空或超过512MiB')
    output.mkdir()
    with file.open('rb') as stream, mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as data:
        base, span = elf_payload(data) if data[:4] == b'\x7fELF' else (0, len(data))
        if data[base:base + 4] == b'XABA':
            version, entries = parse_store(data, base, span)
        elif data[base:base + 4] in (b'XALZ', b'XAZS') or data[base:base + 2] == b'MZ':
            version, entries = None, [{'index': 0, 'name': None, 'offset': 0, 'size': span}]
        else:
            raise ValueError('未识别的程序集/store载荷')
        total, processed, hashes = 0, 0, {}
        for entry in entries:
            if entry.get('ignored'):
                continue
            region = (entry['offset'], entry['size'])
            if region not in hashes:
                processed += entry['size']
                if processed > 512 * 1024 * 1024:
                    raise ValueError('累计读取程序集超过512MiB')
                hashes[region] = hashlib.sha256(memoryview(data)[base + region[0]:base + region[0] + region[1]]).hexdigest()
            entry['storedSha256'] = hashes[region]
            if extract:
                head = data[base + region[0]:base + region[0] + min(region[1], 12)]
                declared = struct.unpack_from('<I', head, 8)[0] if len(head) == 12 and head[:4] in (b'XALZ', b'XAZS') else region[1]
                # long: 解压前预留累计预算，重复descriptor不能反复申请大块解压内存。
                if total + declared > 512 * 1024 * 1024:
                    raise ValueError('累计解压超过512MiB')
                total += declared
                raw, codec = decode_image(data[base + region[0]:base + region[0] + region[1]])
                target = 'assembly-%04d.%s' % (entry['index'], 'dll' if raw[:2] == b'MZ' else 'bin')
                (output / target).write_bytes(raw)
                entry.update({'artifact': target, 'codec': codec, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'kind': 'pe-candidate' if raw[:2] == b'MZ' else 'non-pe-payload'})
        return {'version': version, 'payloadFileOffset': base, 'payloadSpan': span, 'entries': entries, 'inputSha256': hashlib.sha256(data).hexdigest(), 'limitation': '固定store布局/压缩提取，不证明完整MAUI App或NativeAOT能按IL恢复'}


if __name__ == '__main__':
    report = analyze(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3] == 'extract')
    Path(sys.argv[4]).write_text(json.dumps(report, ensure_ascii=False, indent=2))
