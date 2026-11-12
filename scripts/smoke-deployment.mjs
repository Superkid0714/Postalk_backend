// Read-only deployment checks. No writes, uploads, jobs or paid calls.
const base = new URL(process.argv[2]);
if(base.protocol!=='https:' && !['localhost','127.0.0.1'].includes(base.hostname)) throw Error('Use HTTPS for remote deployments');
const args = process.argv.slice(3);
const origin = args.find(arg => !arg.startsWith('--'));
async function request(path,options) {
 const response=await fetch(new URL(path,base),{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
 return response;
}
const health=await request('/api/health');
if(!health.ok) throw Error(`Health returned ${health.status}`);
const payload=await health.json();
if(payload.service!=='postalk-backend'||payload.status!=='ok') throw Error('Unexpected service');
if (args.includes('--ready')) {
 const ready = await request('/api/health/ready');
 const dependencies = (await ready.json()).dependencies;
 if (!ready.ok || dependencies?.database !== 'ok' || dependencies?.storage !== 'ok' || dependencies?.mediaProvider !== 'supabase') {
  throw Error(`Supabase readiness failed (HTTP ${ready.status})`);
 }
}
if (args.includes('--guest')) {
 const guest = await request('/api/guest-session', { method: 'POST' });
 if (guest.status !== 400 || (await guest.json()).error?.code !== 'VALIDATION_ERROR') {
  throw Error(`Guest session endpoint is missing or disabled (HTTP ${guest.status})`);
 }
}
const upload=await request('/api/exhibition/uploads');
if(![401,404,503].includes(upload.status)||!upload.headers.get('content-type')?.includes('application/json')) throw Error('Exhibition route is missing or exposed without demo identity');
const recovery=await request('/api/internal/generation-jobs/recover',{method:'POST'});
if(![401,503].includes(recovery.status)) throw Error('Worker authentication is not enforced');
if(origin) {
 const header = args.includes('--guest') ? 'x-guest-session' : 'x-user-id';
 const path = args.includes('--guest') ? '/api/guest-session' : '/api/exhibition/uploads';
 const cors=await request(path,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':`content-type,${header}`}});
 const allowedHeaders = cors.headers.get('access-control-allow-headers')?.toLowerCase().split(',').map(value => value.trim());
 if(cors.status!==204||cors.headers.get('access-control-allow-origin')!==origin || !allowedHeaders?.includes(header)) throw Error('Frontend CORS mismatch');
}
console.log(JSON.stringify({
 process: 'PASS',
 revision: payload.revision ?? null,
 readiness: args.includes('--ready') ? 'PASS' : 'not requested',
 guestRoute: args.includes('--guest') ? 'PASS' : 'not requested',
 exhibitionRouteStatus: upload.status,
 workerAuthenticationStatus: recovery.status,
 cors: origin ? 'PASS' : 'not requested',
}, null, 2));
