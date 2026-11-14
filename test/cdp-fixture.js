import http from 'node:http';
import { createHash } from 'node:crypto';

export async function cdpFixture(){
  const sockets=new Set(), received=[];let epoch='100',forward=false,failRemove=false;
  const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/json/version'?{'Android-Package':'dev.owned.app',Browser:'OwnedFixture'}:[{id:'owned',type:'page',url:'https://owned.invalid/',webSocketDebuggerUrl:'ws://localhost/devtools/page/owned'}]));});
  function frame(socket,value){const data=Buffer.from(JSON.stringify(value)),header=Buffer.alloc(data.length<126?2:4);header[0]=0x81;if(data.length<126)header[1]=data.length;else{header[1]=126;header.writeUInt16BE(data.length,2);}socket.write(Buffer.concat([header,data]));}
  server.on('upgrade',(req,socket)=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    let buffer=Buffer.alloc(0);socket.on('data',part=>{buffer=Buffer.concat([buffer,part]);while(buffer.length>=2){const opcode=buffer[0]&15;let length=buffer[1]&127,offset=2;if(length===126){if(buffer.length<4)return;length=buffer.readUInt16BE(2);offset=4;}if(length===127){socket.destroy();return;}if(buffer.length<offset+4+length)return;const mask=buffer.subarray(offset,offset+4);offset+=4;const body=Buffer.from(buffer.subarray(offset,offset+length));for(let i=0;i<body.length;i++)body[i]^=mask[i%4];buffer=buffer.subarray(offset+length);if(opcode===8){socket.destroy();return;}if(opcode!==1)continue;const message=JSON.parse(body.toString());received.push(message.method);let result={};
      if(message.method==='Debugger.enable')frame(socket,{method:'Debugger.scriptParsed',params:{scriptId:'1',url:'https://owned.invalid/main.js',hash:'owned'}});
      if(message.method==='Network.enable')for(const event of [{method:'Network.requestWillBeSent',params:{requestId:'r',request:{url:'https://owned.invalid/api',method:'GET',headers:{Authorization:'SECRET'}}}},{method:'Network.responseReceived',params:{requestId:'r',response:{status:200,mimeType:'application/json',headers:{'set-cookie':'SECRET'}}}},{method:'Network.loadingFinished',params:{requestId:'r',encodedDataLength:10}}])frame(socket,event);
      if(message.method==='DOM.getDocument')result={root:{nodeId:1}};
      if(message.method==='DOM.getOuterHTML')result={outerHTML:'<html>OWNED_DOM</html>'};
      if(message.method==='Debugger.getScriptSource')result={scriptSource:'const OWNED_SCRIPT=37;'};
      if(message.method==='Network.getResponseBody')result={body:Buffer.from('OWNED_BODY').toString('base64'),base64Encoded:true};
      if(message.method==='Owned.neverReply')continue;
      frame(socket,{id:message.id,result});
    }});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  const adb=async(serial,args)=>{const text=args.join(' ');let stdout='';
    if(args[0]==='forward'&&args.includes('--no-rebind')){forward=true;stdout=String(port);}
    else if(text==='forward --list')stdout=forward?`owned-device tcp:${port} localabstract:webview_devtools_remote_42\n`:'';
    else if(args.includes('--remove')){if(failRemove)throw new Error('owned cleanup failure');forward=false;}
    else if(text.includes('pidof'))stdout='42';
    else if(text.includes('/proc/net/unix'))stdout='0000: @webview_devtools_remote_42\n';
    else if(text.includes('/cmdline'))stdout='dev.owned.app\0';
    else if(text.includes('/stat'))stdout='42 (owned) '+['S',...Array(18).fill('0'),epoch].join(' ');
    else if(text.includes('boot_id'))stdout='00000000-0000-0000-0000-000000000001';
    return{stdout};};
  return{adb,port,received,get forward(){return forward;},restart(){epoch='200';},failRemove(value){failRemove=value;},async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
