import { Hono } from 'hono';
import { ensureSchema } from './lib/db.js';
import { requireUser } from './lib/auth.js';
import { ok, fail } from './lib/http.js';
import { authRoutes } from './routes/auth.js';
import { sessionRoutes } from './routes/session.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { masterRoutes } from './routes/masters.js';
import { atlasRoutes } from './routes/atlas.js';
import { shipmentRoutes } from './routes/shipments.js';
import { receivingRoutes } from './routes/receiving.js';
import { inventoryRoutes } from './routes/inventory.js';
import { returnRoutes } from './routes/returns.js';
import { procurementRoutes } from './routes/procurement.js';
import { requisitionRoutes } from './routes/requisitions.js';
import { salesRoutes } from './routes/sales.js';
import { deliveryRoutes } from './routes/deliveries.js';
import { stationRoutes } from './routes/stations.js';
import { adminRoutes } from './routes/admin.js';
import { checklistRoutes } from './routes/checklists.js';
import { planningRoutes } from './routes/planning.js';
import { workspaceRoutes } from './routes/workspace.js';
import { financeRoutes } from './routes/finance.js';
import { rfpAlignmentRoutes } from './routes/rfp-alignment.js';
import { enterpriseRoutes } from './routes/enterprise.js';
import { analyticsRoutes } from './routes/analytics.js';
import { poApprovalPublicRoutes } from './routes/po-approval-public.js';
import { assemblyRoutes } from './routes/assemblies.js';
import { mailRoutes } from './routes/mail.js';
import { serviceRoutes } from './routes/service.js';

const app = new Hono();

app.use('/api/*', async (c,next)=>{
try { await ensureSchema(c.env.DB); }
catch (e) { return fail(c,e.message,503); }
return next();
});

app.get('/api/health', async c=>{
let d1Ready=false;let r2Ready=false;let r2Error='';
try{await c.env.DB.prepare('SELECT 1 ready').first();d1Ready=true;}catch{}
if(c.env.DOCS){try{await c.env.DOCS.list({limit:1});r2Ready=true;}catch(error){r2Error=error?.message||'R2 access failed';}}
return ok(c,{service:'Blitz - ERP',version:'15.0.0-blitz-live',
build:'BLITZ-ERP-20260807-R18.0',d1Bound:!!c.env.DB,d1Ready,
r2Bound:!!c.env.DOCS,r2Ready,r2Error,
mailConfigured:!!(c.env.RESEND_API_KEY||(c.env.MAIL_WEBHOOK_URL&&c.env.MAIL_WEBHOOK_SECRET)),
mailTransport:c.env.RESEND_API_KEY?'resend':((c.env.MAIL_WEBHOOK_URL&&c.env.MAIL_WEBHOOK_SECRET)?'apps-script':'none'),
driveConfigured:!!(c.env.MAIL_WEBHOOK_URL&&c.env.MAIL_WEBHOOK_SECRET),
environment:c.env.ENVIRONMENT||'unknown',time:new Date().toISOString()});
});
app.route('/api/auth',authRoutes);
app.route('/api/po-approve',poApprovalPublicRoutes);
app.use('/api/*', requireUser);
app.route('/api/session',sessionRoutes);
app.route('/api/dashboard',dashboardRoutes);
app.route('/api/analytics',analyticsRoutes);
app.route('/api/masters',masterRoutes);
app.route('/api/atlas',atlasRoutes);
app.route('/api/shipments',shipmentRoutes);
app.route('/api/receiving',receivingRoutes);
app.route('/api/inventory',inventoryRoutes);
app.route('/api/returns',returnRoutes);
app.route('/api/procurement',procurementRoutes);
app.route('/api/assemblies',assemblyRoutes);
app.route('/api/requisitions',requisitionRoutes);
app.route('/api/sales',salesRoutes);
app.route('/api/deliveries',deliveryRoutes);
app.route('/api/stations',stationRoutes);
app.route('/api/admin',adminRoutes);
app.route('/api/checklists',checklistRoutes);
app.route('/api/planning',planningRoutes);
app.route('/api/finance',financeRoutes);
app.route('/api/finance',rfpAlignmentRoutes);
app.route('/api/enterprise',enterpriseRoutes);
app.route('/api/workspace',workspaceRoutes);
app.route('/api/service',serviceRoutes);
app.route('/api/mail',mailRoutes);
app.all('/api/*',c=>fail(c,'Unknown endpoint',404));

app.onError((err,c)=>{
console.error(err);
return fail(c,err?.message||'Unexpected server error',500);
});

export default {
async fetch(request,env,ctx){
const url=new URL(request.url);
if(url.pathname.startsWith('/api/')) return app.fetch(request,env,ctx);
if(!env.ASSETS) return new Response('Static asset binding is not configured.',{status:503});
const response=await env.ASSETS.fetch(request);
const asset=response.status!==404?response:await env.ASSETS.fetch(new Request(new URL('/index.html',request.url),request));
const headers=new Headers(asset.headers);
headers.set('Cache-Control','no-store, no-cache, must-revalidate');
headers.set('Pragma','no-cache');
headers.set('X-E88-Build','BLITZ-ERP-20260807-R18.0');
return new Response(asset.body,{status:asset.status,statusText:asset.statusText,headers});
}
};
