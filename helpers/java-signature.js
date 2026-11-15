// long: DEX允许同参数、不同返回类型的方法；Frida的overload只选第一个参数匹配，必须自行核实完整签名的唯一性。
export function selectJavaOverload(member, argumentTypes, returnType) {
  if (!Array.isArray(member?.overloads)) throw new Error('所选成员不是可观察的Java方法');
  const matches = member.overloads.filter(method => method.argumentTypes.length === argumentTypes.length &&
    method.argumentTypes.every((type, index) => type.className === argumentTypes[index]) && (!returnType || method.returnType.className === returnType));
  if (matches.length !== 1) throw new Error('完整Java重载选择必须唯一，当前' + matches.length + '项');
  return matches[0];
}
