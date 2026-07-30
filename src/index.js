import { Hono } from 'hono';
import { ensureSchema } from './lib/db.js';
import { requireUser } from './lib/auth.js';
import { ok, fail } from './lib/http.js';
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

const app = new Hono();

app.use('/api/*', async (c,next)=>{
  try { await ensureSchema(c.env.DB); }
  catch (e) { return fail(c,e.message,503); }
  return next();
});
app.use('/api/*', requireUser);

app.get('/api/health', c=>ok(c,{service:'E88 FinSys',version:'8.1.0',time:new Date().toISOString()}));
app.route('/api/session',sessionRoutes);
app.route('/api/dashboard',dashboardRoutes);
app.route('/api/masters',masterRoutes);
app.route('/api/atlas',atlasRoutes);
app.route('/api/shipments',shipmentRoutes);
app.route('/api/receiving',receivingRoutes);
app.route('/api/inventory',inventoryRoutes);
app.route('/api/returns',returnRoutes);
app.route('/api/procurement',procurementRoutes);
app.route('/api/requisitions',requisitionRoutes);
app.route('/api/sales',salesRoutes);
app.route('/api/deliveries',deliveryRoutes);
app.route('/api/stations',stationRoutes);
app.route('/api/admin',adminRoutes);
app.route('/api/checklists',checklistRoutes);
app.route('/api/planning',planningRoutes);
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
    if(response.status!==404) return response;
    return env.ASSETS.fetch(new Request(new URL('/index.html',request.url),request));
  }
};
