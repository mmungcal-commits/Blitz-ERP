#!/usr/bin/env node
const base = (process.env.E88_URL || process.argv[2] || '').replace(/\/$/, '');
if (!base) {
  console.error('Usage: E88_URL=https://your-worker.workers.dev node scripts/smoke-test.mjs');
  process.exit(2);
}
const headers = { 'Cache-Control':'no-cache' };
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID;
  headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET;
}
const expectedBuild = 'E88-ROLLOUT-ERP-20260731-R13.1';
let failures = 0;
async function check(name,path,validate){
  try{
    const response=await fetch(`${base}${path}`,{headers,redirect:'follow'});
    const text=await response.text();
    const passed=validate({response,text});
    console.log(`${passed?'PASS':'FAIL'} ${name}: HTTP ${response.status}`);
    if(!passed)failures++;
  }catch(error){console.error(`FAIL ${name}: ${error.message}`);failures++;}
}
await check('Application shell','/',({response,text})=>response.ok&&text.includes('foundation.js?v=1310-rollout')&&text.includes(expectedBuild));
await check('Health and bindings','/api/health',({response,text})=>{
  if(!response.ok)return false;
  const data=JSON.parse(text);
  return data.build===expectedBuild&&data.d1Bound===true&&data.d1Ready===true&&data.r2Bound===true&&data.r2Ready===true;
});
if(failures)process.exit(1);
console.log('Live smoke test passed: application, D1, and R2 are connected.');
