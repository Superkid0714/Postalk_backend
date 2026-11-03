import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

test('cloud worker uses the private hostport and authenticates its recovery request',async()=>{
 let calls=0;
 const server=createServer((request,response)=>{
  calls++;
  assert.equal(request.url,'/api/internal/generation-jobs/recover');
  assert.equal(request.method,'POST');
  assert.equal(request.headers['x-internal-worker-key'],'synthetic-worker-test-key');
  response.setHeader('content-type','application/json');
  response.end('{"data":{"results":[]}}');
 });
 server.listen(0,'127.0.0.1'); await once(server,'listening');
 const address=server.address(); assert.ok(address&&typeof address==='object');
 const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/generation-worker.mjs',import.meta.url))],{
  env:{...process.env,GENERATION_WORKER_BASE_URL:'',GENERATION_WORKER_HOSTPORT:`127.0.0.1:${address.port}`,GENERATION_WORKER_ENABLED:'true',INTERNAL_WORKER_API_KEY:'synthetic-worker-test-key'},stdio:'pipe',windowsHide:true,
 });
 try {
  await once(server,'request',{signal:AbortSignal.timeout(10000)});
  assert.equal(calls,1);
 } finally {child.kill(); await once(child,'exit');server.close();}
});

test('disabled deployment worker makes no recovery requests',async()=>{
 let calls=0;
 const server=createServer((_,response)=>{calls++;response.end('{}');});
 server.listen(0,'127.0.0.1'); await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address==='object');
 const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/generation-worker.mjs',import.meta.url))],{
  env:{...process.env,GENERATION_WORKER_BASE_URL:`http://127.0.0.1:${address.port}`,GENERATION_WORKER_ENABLED:'false',INTERNAL_WORKER_API_KEY:'synthetic-worker-test-key'},stdio:'pipe',windowsHide:true,
 });
 try {
  const [chunk]=await once(child.stdout!,'data',{signal:AbortSignal.timeout(10000)});
  assert.match(String(chunk),/disabled/);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(calls,0);
 }finally{child.kill();await once(child,'exit');server.close();}
});
