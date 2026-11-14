export function runtimeScript() {
  return "send({event:'runtime',fridaVersion:Frida.version,architecture:Process.arch,pid:Process.id,javaBridge:typeof Java,modules:Process.enumerateModules().slice(0,150).map(m=>({name:m.name,base:m.base.toString(),size:m.size}))});";
}
export function nativeTraceScript({ moduleName, symbolName, rva, argumentOffset = 0, argumentCount = 4, maxEvents = 50, captureStack = false }) {
  validateNativeHook({ moduleName, symbolName, rva });
  const config = JSON.stringify({ moduleName, symbolName, rva, argumentOffset, argumentCount, maxEvents, captureStack });
  // long: 只读寄存器参数/返回值，不解引用未知指针也不改返回值；符号通过JSON编码，不能注入生成的脚本。
  return `const config=${config}; const resolveNativeAddress=${resolveNativeAddress.toString()};let listener=null;let events=0;
function install(module){
 if(listener||module.name!==config.moduleName)return;
 const address=resolveNativeAddress(module,config);
 listener=Interceptor.attach(address,{
  onEnter(args){
   this.capture=events<config.maxEvents;
   if(!this.capture)return;
   this.values=Array.from({length:config.argumentCount},(_,i)=>({registerIndex:i+config.argumentOffset,raw:args[i+config.argumentOffset].toString(),int32:args[i+config.argumentOffset].toInt32()}));
   // long: 未知RVA的叶函数可能没有可靠帧链，候选采样不冒充精确调用栈。
   this.stackKind=config.captureStack?(config.rva?'frida-fuzzy-candidates':'frida-accurate'):null;
   this.stack=config.captureStack?Thread.backtrace(this.context,config.rva?Backtracer.FUZZY:Backtracer.ACCURATE).slice(0,24).map(p=>p.toString()):[];
  },
  onLeave(value){if(this.capture&&events++<config.maxEvents)send({event:'native-call',module:module.name,symbol:config.symbolName,base:module.base.toString(),address:address.toString(),rva:address.sub(module.base).toString(),threadId:this.threadId,arguments:this.values,returnValue:{raw:value.toString(),int32:value.toInt32()},stack:this.stack,stackKind:this.stackKind});}
 });
 send({event:'hook-installed',module:module.name,symbol:config.symbolName,base:module.base.toString(),address:address.toString(),rva:address.sub(module.base).toString(),maxEvents:config.maxEvents});
}
const current=Process.findModuleByName(config.moduleName);
if(current)install(current);else{
 send({event:'waiting-module',module:config.moduleName});
 // long: 延迟到加载器回调之外安装hook，避免在模块初始化期间重入链接器；等待有明确上限。
 let attempts=0;const timer=setInterval(()=>{const module=Process.findModuleByName(config.moduleName);if(module){clearInterval(timer);install(module);}else if(++attempts>=300){clearInterval(timer);send({event:'module-wait-timeout',module:config.moduleName});}},100);
}`;
}
import { resolveNativeAddress } from '../../helpers/native-location.js';

export function validateNativeHook({ moduleName, symbolName, rva }) {
  if (!/^[A-Za-z0-9_.+-]+$/.test(moduleName || '')) throw new Error('Native观测要求有效moduleName');
  if (!!symbolName === !!rva) throw new Error('symbolName与rva必须二选一');
  if (rva && !/^0x[0-9a-fA-F]{1,16}$/.test(rva)) throw new Error('rva必须为0x开头的十六进制相对地址');
}
