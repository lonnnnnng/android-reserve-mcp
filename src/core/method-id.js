const primitive = { V: 'void', Z: 'boolean', B: 'byte', S: 'short', C: 'char', I: 'int', J: 'long', F: 'float', D: 'double' };

export function normalizeClassName(value) {
  if (typeof value !== 'string') throw new Error('必须明确类名');
  const name = (value.startsWith('L') && value.endsWith(';') ? value.slice(1, -1) : value).replaceAll('/', '.');
  if (!name || name.length > 512 || name.split('.').some(part => !part) || /[\s\u0000-\u001f;()[\]<>]/.test(name)) throw new Error('类名格式无效');
  return name;
}

export function parseDescriptor(descriptor) {
  if (typeof descriptor !== 'string' || descriptor.length > 4096 || descriptor[0] !== '(') throw new Error('方法descriptor必须包含完整参数和返回类型');
  let offset = 1;
  function type(allowVoid) {
    const start = offset; let dimensions = 0;
    while (descriptor[offset] === '[') { dimensions++; offset++; }
    if (dimensions > 255) throw new Error('数组维度超出DEX范围');
    let java;
    const code = descriptor[offset++];
    if (code === 'L') {
      const end = descriptor.indexOf(';', offset); if (end < 0) throw new Error('对象类型descriptor未闭合');
      const internal = descriptor.slice(offset, end);
      // long: DEX prototype中的对象名必须使用斜线内部名；点号别名会产生不同methodId却选中相同Frida重载。
      if (internal.includes('.') || internal.split('/').some(part => !part)) throw new Error('descriptor对象类型必须使用合法内部名称');
      java = normalizeClassName(internal); offset = end + 1;
    } else {
      java = primitive[code]; if (!java || (code === 'V' && (!allowVoid || dimensions))) throw new Error('非法参数或返回类型');
    }
    const raw = descriptor.slice(start, offset);
    return { descriptor: raw, java: java + '[]'.repeat(dimensions), frida: dimensions ? raw.replaceAll('/', '.') : java };
  }
  const parameters = [];
  while (offset < descriptor.length && descriptor[offset] !== ')') {
    if (parameters.length >= 255) throw new Error('方法参数超过DEX预算');
    parameters.push(type(false));
  }
  if (descriptor[offset++] !== ')') throw new Error('方法参数descriptor未闭合');
  const result = type(true); if (offset !== descriptor.length) throw new Error('方法descriptor包含额外内容');
  return { parameters, result, argumentTypes: parameters.map(value => value.frida), returnType: result.frida };
}

export function methodIdentity(className, methodName, descriptor) {
  className = normalizeClassName(className); parseDescriptor(descriptor);
  if (typeof methodName !== 'string' || !methodName || methodName.length > 200 || /[\s\u0000-\u001f.;()[\]/]/.test(methodName)) throw new Error('方法名格式无效');
  return { className, methodName, descriptor, methodId: 'L' + className.replaceAll('.', '/') + ';->' + methodName + descriptor };
}

export function parseMethodId(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('完整methodId无效');
  let owner, name, descriptor;
  if (value.startsWith('L') && value.includes(';->')) {
    const separator = value.indexOf(';->'), parameters = value.indexOf('(', separator + 3);
    owner = value.slice(1, separator); name = value.slice(separator + 3, parameters); descriptor = value.slice(parameters);
  } else {
    const parameters = value.indexOf('('), separator = value.lastIndexOf('.', parameters);
    if (parameters < 0 || separator < 1) throw new Error('methodId需要owner、方法名及完整descriptor');
    owner = value.slice(0, separator); name = value.slice(separator + 1, parameters); descriptor = value.slice(parameters);
  }
  return methodIdentity(owner, name, descriptor);
}

export function runtimeSelector(identity) {
  const decoded = parseDescriptor(identity.descriptor);
  // long: 数组的Frida重载名使用JVM数组类名；直接传Java源码的String[]会选错或找不到重载。
  return { className: identity.className, methodName: identity.methodName, argumentTypes: decoded.argumentTypes, returnType: decoded.returnType };
}
