// Read-only process/route/auth checks. No DB rows, uploads, jobs or paid calls.
const base = new URL(process.argv[2]);
if(base.protocol!=='https:' && !['localhost','127.0.0.1'].includes(base.hostname)) throw Error('Use HTTPS for remote deployments');
const origin=process.argv[3];
async function request(path,options) {
 const response=await fetch(new URL(path,base),{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
 return response;
}
const health=await request('/api/health');
if(!health.ok) throw Error(`Health returned ${health.status}`);
const payload=await health.json();
if(payload.service!=='postalk-backend'||payload.status!=='ok') throw Error('Unexpected service');
const upload=await request('/api/exhibition/uploads');
if(![401,404,503].includes(upload.status)||!upload.headers.get('content-type')?.includes('application/json')) throw Error('Exhibition route is missing or exposed without demo identity');
const recovery=await request('/api/internal/generation-jobs/recover',{method:'POST'});
if(![401,503].includes(recovery.status)) throw Error('Worker authentication is not enforced');
if(origin) {
 const cors=await request('/api/exhibition/uploads',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-user-id'}});
 if(cors.status!==204||cors.headers.get('access-control-allow-origin')!==origin) throw Error('Frontend CORS mismatch');
}
console.log(JSON.stringify({process:'PASS',revision:payload.revision??null,exhibitionRouteStatus:upload.status,workerAuthenticationStatus:recovery.status,cors:origin?'PASS':'not requested',scope:'No DB, AI, Storage or Instagram calls'},null,2));
