"""long: 将同构建AOT常量与DEX注册候选关联，保留静态证据边界。"""
import hashlib
import json
import re
import sys
from pathlib import Path
from zipfile import ZipFile

MAX_FILE = 16 * 1024 * 1024
MAX_TOTAL = 128 * 1024 * 1024
MAX_ROWS = 10000


def append(rows, row):
    if len(rows) >= MAX_ROWS:
        raise ValueError("候选结果超过10000项预算")
    rows.append(row)


def files_under(root, suffix, limit):
    files, pending, examined = [], [root], 0
    while pending:
        folder = pending.pop()
        if folder.is_symlink():
            raise ValueError("分析目录中不接受符号链接")
        for file in folder.iterdir():
            examined += 1
            if examined > 100000:
                raise ValueError("分析目录遍历超过100000项预算")
            if file.is_symlink():
                raise ValueError("分析目录中不接受符号链接")
            if file.is_dir():
                pending.append(file)
            elif file.name.endswith(suffix):
                if len(files) >= limit:
                    raise ValueError("分析文件数量超过预算")
                files.append(file)
    return sorted(files)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def literal(value):
    # long: smali允许JSON之外的转义；未知格式不参与关联，避免错误解码生成伪匹配。
    try:
        return json.loads(value)
    except ValueError:
        return None


def read(file, budget, root=None):
    if root:
        relative = file.relative_to(root)
        current = root
        for part in relative.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError("分析目录中不接受符号链接")
    if file.is_symlink() or file.stat().st_size > MAX_FILE:
        raise ValueError("分析文件为符号链接或超过16MiB预算")
    with file.open("rb") as stream:
        data = stream.read(MAX_FILE + 1)
    if len(data) > MAX_FILE:
        raise ValueError("分析文件读取超过16MiB预算")
    budget[0] += len(data)
    if budget[0] > MAX_TOTAL:
        raise ValueError("分析文本超过128MiB累计预算")
    return data.decode("utf-8", errors="strict").splitlines()


def apk_identity(file):
    libraries = []
    if file.stat().st_size > 1024 * 1024 * 1024:
        raise ValueError("APK超过1GiB预算")
    with ZipFile(file) as archive:
        if len(archive.infolist()) > 20000 or sum(i.file_size for i in archive.infolist()) > 1024 * 1024 * 1024:
            raise ValueError("APK目录超过20000项或展开大小超过1GiB")
        total = 0
        def member_identity(info):
            nonlocal total
            total += info.file_size
            if info.file_size > 256 * 1024 * 1024 or total > 512 * 1024 * 1024:
                raise ValueError("APK库/DEX超过单项256MiB或累计512MiB预算")
            h = hashlib.sha256()
            with archive.open(info) as stream:
                while block := stream.read(1024 * 1024):
                    h.update(block)
            return {"name": info.filename, "sha256": h.hexdigest(), "bytes": info.file_size}
        for name in ("libapp.so", "libflutter.so"):
            member = "lib/arm64-v8a/" + name
            matches = [i for i in archive.infolist() if i.filename == member]
            if len(matches) != 1 or matches[0].file_size > 256 * 1024 * 1024:
                raise ValueError("APK缺少唯一ARM64配对库或库超过256MiB")
            libraries.append({**member_identity(matches[0]), "name": name})
        members = [i for i in archive.infolist() if re.fullmatch(r"classes\d*\.dex", i.filename)]
        if len(members) > 100 or len({i.filename for i in members}) != len(members):
            raise ValueError("APK重复DEX或DEX超过100项")
        dex = [member_identity(i) for i in members]
    return {"libraries": libraries, "dex": dex}


def analyze(aot, decoded, mapping):
    budget = [0]
    pool = read(aot / "pp.txt", budget, aot)
    channels = {}
    for i, line in enumerate(pool):
        found = re.match(r"\[pp\+(0x[0-9a-f]+)\] Obj!(MethodChannel|EventChannel)@", line)
        if not found:
            continue
        for offset, child in enumerate(pool[i + 1:i + 6], 1):
            name = re.search(r'off_8:\s*("(?:[^"\\]|\\.)*")', child)
            if name:
                if literal(name[1]) is None:
                    continue
                channels[found[1]] = {"channel": literal(name[1]), "channelType": found[2],
                                      "source": {"file": "pp.txt", "line": i + offset + 1}}
                break
    callsites = []
    asm_files = files_under(aot / "asm", ".dart", 4000)
    for file in asm_files:
        lines = read(file, budget, aot)
        for i, line in enumerate(lines):
            if "MethodChannel::invokeMethod" not in line:
                continue
            window = lines[max(0, i - 18):i]
            # long: 仅接受已知ARM64实参入栈模板，邻近字符串本身不能证明调用实参。
            text = "\n".join(window)
            if not re.search(r"stp\s+lr, x16, \[SP, #8\]", text) or not re.search(r"str\s+x16, \[SP\]", text):
                continue
            refs = re.findall(r"\[pp\+(0x[0-9a-f]+)\] Obj!MethodChannel@", text)
            names = re.findall(r'r16 = ("(?:[^"\\]|\\.)*")', text)
            if len(refs) == 1 and len(names) == 1 and refs[0] in channels and literal(names[0]) is not None:
                append(callsites, {**channels[refs[0]], "poolSource": channels[refs[0]]["source"], "method": literal(names[0]),
                                  "source": {"file": str(file.relative_to(aot)), "line": i + 1},
                                  "strength": "arm64-blutter-stack-template-candidate"})
    setters = {("Lio/flutter/plugin/common/MethodChannel;", "setMethodCallHandler")}
    mapping_identity = None
    if mapping:
        raw = read(mapping, budget)
        owner, original_owner = None, None
        for line in raw:
            declaration = re.match(r"(\S+) -> (\S+):$", line)
            if declaration:
                original_owner = declaration[1]
                owner = "L" + declaration[2].replace(".", "/") + ";"
            if owner and ("io.flutter.plugin.common.MethodChannel.setMethodCallHandler(" in line or original_owner == "io.flutter.plugin.common.MethodChannel" and "setMethodCallHandler(" in line) and " -> " in line:
                setters.add((owner, line.rsplit(" -> ", 1)[1].strip()))
        mapping_identity = {"sha256": sha(mapping.read_bytes()),
                            "association": "caller-supplied-build-match-unverified"}
    registrations, handlers = [], []
    files = []
    for folder in decoded.iterdir():
        if folder.name.startswith("smali") and folder.is_dir():
            files.extend(files_under(folder, ".smali", 20000 - len(files)))
    channel_names = {c["channel"] for c in channels.values()}
    method_names = {c["method"] for c in callsites}
    for file in files:
        lines = read(file, budget, decoded)
        owner, method, state = None, None, {}
        for i, line in enumerate(lines):
            value = line.strip()
            if value.startswith(".class "):
                owner = value.split()[-1]
            if value.startswith(".method "):
                method, state = value.split()[-1], {}
            if value.startswith((":", "if-", "goto", "sparse-switch", "packed-switch", "return", ".end method")):
                state = {}
            new = re.match(r"new-instance ([vp]\d+), (L[^;]+;)", value)
            constant = re.match(r'const-string(?:/jumbo)? ([vp]\d+), ("(?:[^"\\]|\\.)*")', value)
            if new:
                state[new[1]] = {"type": new[2]}
            elif constant:
                state[constant[1]] = {"string": literal(constant[2])}
            else:
                invoke = re.match(r"invoke-\S+ \{([^}]+)\}, (L[^;]+;)->([^ (]+)\((.*)\)(\S+)", value)
                if invoke and " .. " not in invoke[1]:
                    regs = [s.strip() for s in invoke[1].split(",")]
                    receiver = state.get(regs[0], {})
                    if invoke[3] == "<init>" and "Ljava/lang/String;" in invoke[4]:
                        names = [state.get(r, {}).get("string") for r in regs[1:]]
                        names = [n for n in names if n in channel_names]
                        if len(names) == 1 and receiver.get("type") == invoke[2]:
                            state[regs[0]] = {**receiver, "channel": names[0], "constructorLine": i + 1}
                    elif (invoke[2], invoke[3]) in setters and len(regs) == 2 and receiver.get("type") == invoke[2] and receiver.get("channel") and state.get(regs[1], {}).get("type"):
                        append(registrations, {"channel": receiver["channel"], "channelClass": invoke[2],
                                              "handlerClass": state[regs[1]]["type"], "setter": invoke[3],
                                              "owner": owner, "ownerMethod": method,
                                              "source": {"file": str(file.relative_to(decoded)), "line": i + 1},
                                              "constructorLine": receiver["constructorLine"],
                                              "strength": "linear-register-registration-candidate"})
                # long: 未建模的寄存器写入会失效旧值，不能沿用被覆盖的字符串或对象。
                if not invoke and not value.startswith((".", "#", ":")):
                    dest = re.match(r"\S+\s+([vp]\d+)(?:,|$)", value)
                    if dest:
                        state.pop(dest[1], None)
            if constant and state.get(constant[1], {}).get("string") in method_names:
                following = [s.strip() for s in lines[i + 1:i + 8] if s.strip() and not s.strip().startswith((".", "#"))]
                if following and re.match(r"invoke-virtual \{[^}]*\b" + constant[1] + r"\b[^}]*\}, Ljava/lang/String;->equals\(Ljava/lang/Object;\)Z", following[0]):
                    append(handlers, {"handlerClass": owner, "handlerMethod": method,
                                     "method": state[constant[1]]["string"],
                                     "source": {"file": str(file.relative_to(decoded)), "line": i + 1},
                                     "strength": "handler-method-string-comparison-candidate"})
    matches, registrations_by_channel, handlers_by_key = [], {}, {}
    for r in registrations:
        registrations_by_channel.setdefault(r["channel"], []).append(r)
    for h in handlers:
        handlers_by_key.setdefault((h["handlerClass"], h["method"]), []).append(h)
    for c in callsites:
        for r in registrations_by_channel.get(c["channel"], []):
            for h in handlers_by_key.get((r["handlerClass"], c["method"]), []):
                append(matches, {"channel": c["channel"], "method": c["method"], "dart": c,
                                 "registration": r, "android": h, "status": "static-protocol-candidate"})
    return {"kind": "flutter-channel-candidates", "channels": list(channels.values()),
            "dartCallsites": callsites, "androidRegistrations": registrations,
            "androidHandlers": handlers, "matches": matches, "mapping": mapping_identity,
            "partial": True, "coverage": "bounded-static-arm64-template-and-smali",
            "limitation": "仅静态协议候选；不证明运行到达、完整数据流、R8合并类分支选择、返回值或EventChannel运行关系"}


if __name__ == "__main__":
    if sys.argv[1] == "identity":
        result = apk_identity(Path(sys.argv[2]))
    else:
        result = analyze(Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]) if len(sys.argv) > 4 else None)
    print(json.dumps(result, ensure_ascii=False))
