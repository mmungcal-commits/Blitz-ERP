import { VIZ, VIZ_CSS, vizTiles, vizDonut, vizBars, vizColumns, vizLine, vizMeter, vizRing, bindViz, compact }
  from './viz.js?v=20260808-r34';
const FOUNDATION_BUILD='BLITZ-ERP-20260808-R34.0';
const BRAND_NAME='Blitz - ERP';
const state={
  session:null,
  catalog:{groups:[],tools:[],addons:[]},
  workspaceAccess:[],
  module:null,
  definition:null,
  section:'center',
  mobileFull:false,
  mobileGroup:null,
  showModuleMap:false,
  homeRange:null,
  inbound:{preview:null,receiptLines:[],shipment:null,locationId:null},
  cycleCount:null,
  scannerStream:null,
  theme:localStorage.getItem('e88-theme')||'light',
  apiCache:new Map(),
  apiInflight:new Map(),
  expandedGroups:new Set(JSON.parse(localStorage.getItem('e88-expanded-groups')||'[]')),
  scope:(function(){try{return localStorage.getItem('blitz-scope')||'OPERATIONS';}catch(e){return 'OPERATIONS';}})(),
  movementStatuses:[],
};

const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const content=$('#content');
document.documentElement.dataset.theme=state.theme;

function esc(value){
  return String(value??'').replace(/[&<>'"]/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;',
  }[char]));
}
function date(value){
  if(!value)return'-';
  const parsed=new Date(value);
  return Number.isNaN(parsed.getTime())?esc(value):parsed.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
}
function money(value){
  const number=Number(value||0);
  return new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(number);
}
function statusBadge(value='DRAFT'){
  const status=String(value).toUpperCase();
  const tone=/APPROVED|POSTED|CLOSED|PAID|LIQUIDATED/.test(status)?'good':/CANCELLED|REJECTED/.test(status)?'bad':/FOR_APPROVAL|PENDING|RETURNED|FOR_LIQUIDATION/.test(status)?'warn':'info';
  return `<span class="status ${tone}">${esc(status.replaceAll('_',' '))}</span>`;
}
async function api(path,options={}){
  const method=String(options.method||'GET').toUpperCase();
  const cacheable=method==='GET'&&!options.noCache;
  const cacheKey=path;
  const now=Date.now();
  const cached=state.apiCache.get(cacheKey);
  if(cacheable&&cached&&now-cached.at<15000)return cached.data;
  if(cacheable&&state.apiInflight.has(cacheKey))return state.apiInflight.get(cacheKey);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),Number(options.timeout||30000));
  const request=(async()=>{
    try{
      const response=await fetch('/api'+path,{
        ...options,
        signal:controller.signal,
        credentials:'same-origin',
        headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(options.headers||{})},
      });
      const data=await response.json().catch(()=>({ok:false,error:`HTTP ${response.status}`}));
      if(!response.ok||!data.ok){
        const error=new Error(data.error||`Request failed (${response.status})`);
        error.status=response.status;
        throw error;
      }
      if(cacheable)state.apiCache.set(cacheKey,{at:Date.now(),data});
      else state.apiCache.clear();
      return data;
    }catch(error){
      if(error.name==='AbortError')throw new Error('The request took too long. Please retry or narrow the filters.');
      throw error;
    }finally{
      clearTimeout(timeout);
      if(cacheable)state.apiInflight.delete(cacheKey);
    }
  })();
  if(cacheable)state.apiInflight.set(cacheKey,request);
  return request;
}
function toast(message,type='success'){
  const element=document.createElement('div');
  element.className=`toast ${type}`;
  element.textContent=message;
  $('#toastHost').append(element);
  setTimeout(()=>element.remove(),4200);
}
function modal(title,body,subtitle=''){
  $('#modalTitle').textContent=title;
  $('#modalSubtitle').textContent=subtitle;
  $('#modalBody').innerHTML=body;
  $('#modal').classList.remove('hidden');
}
function closeModal(){
  state.scannerStream?.getTracks().forEach(track=>track.stop());
  state.scannerStream=null;
  $('#modal').classList.add('hidden');
}
function serialFromQrPayload(payload){
  const raw=String(payload||'').trim();
  if(!raw)return'';
  try{
    const parsed=JSON.parse(raw);
    return String(parsed.serialNo||parsed.serial||parsed.sn||parsed.code||raw).trim();
  }catch{}
  try{
    const url=new URL(raw);
    return String(url.searchParams.get('serial')||url.searchParams.get('sn')||raw).trim();
  }catch{}
  return raw;
}
function formDataObject(form){return Object.fromEntries(new FormData(form).entries());}
function authField(label,name,type,value='',extra=''){
  return `<label class="auth-field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function authMessage(message,type='error'){
  const element=$('#authMessage');
  if(!element)return;
  element.className=`auth-message ${type}`;
  element.textContent=message||'';
}
function moduleList(){
  return [
    ...state.catalog.groups.flatMap(group=>group.items.map(item=>({...item,groupCode:group.code,groupTitle:group.title,type:'module'}))),
    ...state.catalog.tools.map(item=>({...item,groupCode:'tools',groupTitle:'Tools',type:'tool'})),
    ...state.catalog.addons.map(item=>({...item,groupCode:'addons',groupTitle:'Add-ons',type:'addon'})),
  ];
}
function moduleByCode(code){return moduleList().find(module=>module.code===code);}
function isDemoMode(){try{return localStorage.getItem('e88-live')!=='1';}catch(e){return true;}}
function isAdminScope(){return state.scope==='ADMIN';}
function setScope(next){state.scope=next==='ADMIN'?'ADMIN':'OPERATIONS';try{localStorage.setItem('blitz-scope',state.scope);}catch(e){}document.body.classList.toggle('scope-admin',state.scope==='ADMIN');}
function can(permission,action='VIEW'){
  if(isAdminScope()&&(action==='APPROVE'||action==='POST'))return false;
  if(isDemoMode())return true;
  if(state.session?.user?.role==='ADMIN')return true;
  const row=(state.session?.permissions||[]).find(value=>value.module===permission);
  return !!row?.[`can_${action.toLowerCase()}`];
}
function canWorkspace(code){
  if(isDemoMode())return true;
  return state.session?.user?.role==='ADMIN'||state.workspaceAccess.includes(code);
}
function workspaceTabs(code=state.module?.code){
  if(code==='fa-general-accounting')return [
    ['center','Accounting Center'],['records','Journals'],['approvals','Approvals'],
    ['reports','Financial Reports'],['setup','Accounts & Periods'],
  ];
  if(code==='fa-receivables-payables')return [
    ['center','AP Center'],['records','Subledgers'],['approvals','RFP & Payments'],
    ['reports','Aging & Tax'],['setup','Controls'],
  ];
  if(code==='fa-fixed-assets')return [
    ['center','Asset Center'],['records','Asset Register'],['approvals','Depreciation'],
    ['reports','Asset Reports'],['setup','Asset Setup'],
  ];
  if(code==='fa-management-accounting')return [
    ['center','Performance Center'],['records','Source Events'],['approvals','Reconciliation'],
    ['reports','Budget vs Actual'],['setup','Dimensions'],
  ];
  if(code==='fa-consolidation-reporting')return [
    ['center','Consolidation Center'],['records','Entity Statements'],['approvals','Close & Adjustments'],
    ['reports','Consolidated Reports'],['setup','Entities'],
  ];
  if(code==='fa-financial-services')return [
    ['center','Treasury Center'],['records','Bank Accounts'],['approvals','Bank Reconciliation'],
    ['reports','Cash Reports'],['setup','Bank Setup'],
  ];
  if(code==='fa-planning-budgeting')return [
    ['center','Planning Center'],['records','Budget Workbench'],['approvals','Forecast Review'],
    ['reports','Planning Reports'],['setup','Planning Setup'],
  ];
  if(code==='fa-grants-funds')return [
    ['center','Funds Center'],['records','Funds Register'],['approvals','Fund Approvals'],
    ['reports','Fund Reports'],['setup','Fund Setup'],
  ];
  if(code==='ip-inbound-logistics')return [
    ['center','Overview'],['records','Purchase Orders'],['approvals','Expected Shipments'],
    ['reports','Goods Receipt'],['setup','Discrepancies'],
  ];
  if(code==='ip-warehouse-management')return [
    ['center','Overview'],['records','Unit Visibility'],['approvals','Stock Movement'],
    ['reports','QR Trace'],['setup','Locations'],
  ];
  if(code==='ip-cycle-counting')return [
    ['center','Overview'],['records','Count Plans'],['approvals','Physical Count'],
    ['reports','Variance Reports'],['setup','Setup'],
  ];
  if(code==='ip-inventory-analysis')return [
    ['center','Overview'],['records','Stock Analysis'],['approvals','Plans'],
    ['reports','Planning Reports'],['setup','Parameters'],
  ];
  if(code==='sd-outbound-logistics')return [
    ['center','Overview'],['records','Requisitions'],['approvals','Pre-release'],
    ['reports','Goods Issuance'],['setup','Delivery & Return'],
  ];
  const connectedTabs={
    'sd-crm':[['center','Sales Pipeline'],['records','Leads & Opportunities'],['approvals','Sales Review'],['reports','CRM Analytics'],['setup','CRM Controls']],
    'sd-demand-planning':[['center','Demand Center'],['records','Forecasts'],['approvals','Baseline & Approval'],['reports','Forecast Analytics'],['setup','Planning Controls']],
    // Order Approval and Order Controls are not used - sales approval lives in
    // the outbound requisition chain, so both tabs are off the rail.
    'sd-order-management':[['center','Order Center'],['records','Sales Orders'],['reports','Order Analytics']],
    'sd-lease-contract-management':[['center','Lease Center'],['records','Lease Contracts'],['approvals','Contract Approval'],['reports','Lease Analytics'],['setup','Lease Controls']],
    'sd-warranty-management':[['center','Warranty Center'],['records','Claims & Registrations'],['approvals','Claim Approval'],['reports','Warranty Analytics'],['setup','Warranty Rules']],
    'sd-service-management':[['center','Service Center'],['records','Service Jobs'],['approvals','Work Approval'],['reports','Service Analytics'],['setup','Service Controls']],
    'sd-pim':[['center','Product Center'],['records','Product Master'],['approvals','Publication Approval'],['reports','Catalog Analytics'],['setup','Product Controls']],
    'sd-customer-portal':[['center','Customer Center'],['records','Customer Requests'],['approvals','Request Worklist'],['reports','Customer Analytics'],['setup','Portal Controls']],
    'ip-sourcing-purchasing':[['center','Procurement Center'],['records','Sourcing & RFQ'],['approvals','Purchase Orders'],['reports','Procurement Analytics'],['setup','Procurement Controls']],
    'ip-subcontracting':[['center','Subcontract Center'],['records','Subcontract Orders'],['approvals','Issue & Receipt'],['reports','Vendor Analytics'],['setup','Subcontract Controls']],
    'ip-supplier-portal':[['center','Supplier Center'],['records','Supplier Submissions'],['approvals','Submission Review'],['reports','Supplier Analytics'],['setup','Supplier Controls']],
  };
  if(connectedTabs[code])return connectedTabs[code];
  return [
    ['center','Role Center'],['records','Transactions'],['approvals','Approvals'],
    ['reports','Reports'],['setup','Setup'],
  ];
}

function showAuth(mode='login'){
  state.session=null;
  state.module=null;
  document.body.classList.remove('launchpad-view','workbench-view');
  $('#loading').classList.add('hidden');
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  const query=new URLSearchParams(location.search);
  const email=query.get('email')||'';
  const activationToken=query.get('activate')||'';
  const resetToken=query.get('reset')||'';
  if(activationToken)mode='activate';
  if(resetToken)mode='reset';
  const host=$('#authContent');
  if(mode==='login'){
    const startScope=state.scope==='ADMIN'?'ADMIN':'OPERATIONS';
    host.innerHTML=`<div class="blitz-auth">
      <div class="blitz-auth-brand">
        <img class="blitz-mark" src="/logo-white.png?v=20260808-r34" alt="E88 Ventures Inc.">
        <div class="blitz-charge" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      </div>
      <div class="auth-heading"><h1>Welcome back</h1><p>Sign in to continue.</p></div>
      <form id="loginForm" class="auth-form">
        <input type="hidden" name="scope" id="loginScope" value="${esc(startScope)}">
        ${authField('Corporate email','email','email',email,'autocomplete="username" placeholder="name@nrdev.ph" required')}
        ${authField('Password','password','password','','autocomplete="current-password" required')}
        <button class="button auth-submit">Sign in</button>
      </form>
      <div id="authMessage" class="auth-message"></div>
      <div class="auth-links"><button type="button" data-auth="activate">Activate account</button><button type="button" data-auth="reset">Reset password</button></div>
      <!--
        Operations is what almost everybody signs in as, so it is simply the
        default rather than a choice to make every morning. Administration is
        the exception, and reads as one.
      -->
      <div class="blitz-scope-note">
        <button type="button" id="scopeAdminToggle" class="${startScope==='ADMIN'?'on':''}"
          aria-pressed="${startScope==='ADMIN'?'true':'false'}">
          <span class="dot" aria-hidden="true"></span>Sign in to System Administration</button>
      </div>
    </div>`;
    const scopeBtn=$('#scopeAdminToggle');
    if(scopeBtn)scopeBtn.onclick=()=>{
      const on=$('#loginScope').value!=='ADMIN';
      $('#loginScope').value=on?'ADMIN':'OPERATIONS';
      scopeBtn.classList.toggle('on',on);
      scopeBtn.setAttribute('aria-pressed',on?'true':'false');
      document.querySelector('.blitz-auth').classList.toggle('is-admin',on);
    };
    if(startScope==='ADMIN')document.querySelector('.blitz-auth').classList.add('is-admin');
    $('#loginForm').onsubmit=async event=>{
      event.preventDefault();
      const button=event.currentTarget.querySelector('button');
      button.disabled=true;
      authMessage('Signing in...','info');
      try{
        const payload=formDataObject(event.currentTarget);
        setScope(payload.scope);
        await api('/auth/login',{method:'POST',body:JSON.stringify(payload)});
        history.replaceState({},'',location.pathname);
        await init();
      }catch(error){authMessage(error.message);}
      finally{button.disabled=false;}
    };
  }else{
    const activation=mode==='activate';
    const token=activation?activationToken:resetToken;
    host.innerHTML=`<div class="auth-heading"><h1>${activation?'Activate account':'Reset password'}</h1><p>${activation?'Create your private password.':'Set a new private password.'}</p></div>
      <form id="credentialForm" class="auth-form">
        ${authField('Corporate email','email','email',email,'autocomplete="username" placeholder="name@nrdev.ph" required')}
        ${authField(activation?'Activation code':'Reset code','token','text',token,'autocomplete="one-time-code" required')}
        ${authField('New password','password','password','','autocomplete="new-password" minlength="12" required')}
        ${authField('Confirm password','confirmPassword','password','','autocomplete="new-password" minlength="12" required')}
        <small class="password-rule">At least 12 characters with uppercase, lowercase, and a number.</small>
        <button class="button auth-submit">${activation?'Activate and sign in':'Update password and sign in'}</button>
      </form>
      <div id="authMessage" class="auth-message"></div>
      <div class="auth-links"><button type="button" data-auth="login">Back to sign in</button></div>`;
    $('#credentialForm').onsubmit=async event=>{
      event.preventDefault();
      const button=event.currentTarget.querySelector('button');
      button.disabled=true;
      authMessage(activation?'Activating account…':'Updating password…','info');
      try{
        await api(activation?'/auth/activate':'/auth/reset-password',{method:'POST',body:JSON.stringify(formDataObject(event.currentTarget))});
        history.replaceState({},'',location.pathname);
        await init();
      }catch(error){authMessage(error.message);}
      finally{button.disabled=false;}
    };
  }
  $$('[data-auth]').forEach(button=>button.onclick=()=>showAuth(button.dataset.auth));
}

async function init(){
  $('#login').classList.add('hidden');
  $('#app').classList.add('hidden');
  $('#loading').classList.remove('hidden');
  try{
    state.session=await api('/session');
    // The server decides the scope at login (erp_sessions.session_scope); the
    // client only reflects it. Switching scope requires signing in again.
    state.scope=(state.session.user&&state.session.user.scope)||'OPERATIONS';
    try{localStorage.setItem('blitz-scope',state.scope);}catch(e){}
    document.body.classList.toggle('scope-admin',state.scope==='ADMIN');
    try{document.title='Blitz - ERP';}catch(e){}
    state.catalog=state.session.workspaceCatalog||{groups:[],tools:[],addons:[]};
    // 'ip-inventory-analysis' is the inventory Reports screen and belongs in the
    // group - it was hidden here, which is why Reports never appeared.
    var __hiddenModules=['sd-crm','sd-demand-planning','sd-warranty-management','sd-pim','sd-customer-portal','sd-lease-contract-management','ip-subcontracting'];
    if(state.catalog&&state.catalog.groups)state.catalog.groups.forEach(function(g){if(g.items)g.items=g.items.filter(function(it){return __hiddenModules.indexOf(it.code)<0;});});
    if(state.catalog&&state.catalog.groups)state.catalog.groups.forEach(function(g){if(g.items)g.items.forEach(function(it){if(it.code==='fa-receivables-payables')it.label='Payables Management';if(it.code==='ip-inventory-analysis')it.label='Reports';});});
    state.workspaceAccess=state.session.workspaceAccess||[];
    $('#userBadge').innerHTML=`<b>${esc(state.session.user.displayName||state.session.user.email)}</b><small>${esc(state.session.user.role)} · ${esc(state.session.user.email)}</small>`;
    $('#accessBtn').classList.toggle('hidden',state.session.user.role!=='ADMIN');
    $('#loading').classList.add('hidden');
    $('#app').classList.remove('hidden');
    renderLaunchpad();
  }catch(error){
    if(error.status===401)return showAuth();
    $('#loading').innerHTML=`<div><strong>Unable to open system</strong><span>${esc(error.message)}</span></div>`;
  }
}

function enterpriseButton(item,className='enterprise-module-button'){
  const allowed=canWorkspace(item.code);
  return `<button class="${className}" data-workspace="${esc(item.code)}" ${allowed?'':'disabled aria-disabled="true"'}>${esc(item.label)}</button>`;
}

/* ===================================================================
 * The landing cockpit.
 *
 * Signing in used to drop you straight onto a map of ninety modules. This
 * answers the two questions somebody actually has first - what is waiting on
 * me, and is anything on fire - and keeps the map one button away.
 * =================================================================== */
async function renderHomeDashboard(){
  state.module=null;state.definition=null;state.section='center';
  document.body.classList.remove('workbench-view');
  document.body.classList.add('launchpad-view');
  content.innerHTML='<div class="workspace-loading">Loading your dashboard\u2026</div>';
  const rng=state.homeRange||{};
  const qs=(rng.from&&rng.to)?('?from='+encodeURIComponent(rng.from)+'&to='+encodeURIComponent(rng.to)):'';
  let d;
  try{ d=await api('/dashboard/home'+qs); }
  catch(err){
    // Fall through to the module map - and set the flag first, or renderLaunchpad
    // routes straight back here and the loading message spins forever.
    state.showModuleMap=true;
    toast('Could not load the dashboard. Opening the modules instead.','error');
    return renderLaunchpad();
  }
  const sec=d.sections||{};
  const who=(d.user&&d.user.name)||'';
  const hour=new Date().getHours();
  const greet=hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';

  // What has this person's name on it, biggest queue first.
  const waiting=(d.waiting||[]).slice().sort((a,b)=>b.count-a.count);
  const waitingHtml=waiting.length
    ? '<div class="home-waiting">'+waiting.map(w=>
        '<button type="button" class="home-wait" data-home-go="'+esc(w.module)+'">'
        +'<b>'+esc(String(w.count))+'</b><span>'+esc(w.label)+'</span><i>&rsaquo;</i></button>').join('')+'</div>'
    : '<div class="home-clear">Nothing is waiting on you right now.</div>';

  // Tiles run the full width above the charts; they are a status row, not a card.
  const tr=d.trends||{};
  const sparkOf=k=>(tr[k]&&tr[k].series)||null;
  const deltaOf=(k,upIsGood)=>(tr[k]&&tr[k].delta!=null)
    ? {value:tr[k].delta,period:'vs the 3 days before',upIsGood:upIsGood!==false} : null;
  let tiles='';
  const cards=[];

  /*
   * Finance opens on the money. These are the six numbers asked for, plus the
   * period they cover, because a management figure without a period is not a
   * figure.
   */
  if(sec.management){
    const m=sec.management;
    tiles=vizTiles([
      {label:'Pending approvals',value:(d.waiting||[]).reduce((t,w)=>t+Number(w.count||0),0),
       tone:(d.waiting||[]).length?'warning':'good',sub:'awaiting your sign-off',module:'fa-receivables-payables#records'},
      {label:'Available units',value:m.availableUnits,tone:'good',sub:'ready to move',
       module:'ip-warehouse-management#records'},
      {label:'Leased units',value:m.leasedUnits,sub:'out on contract',module:'ip-warehouse-management#records'},
      {label:'Sold units',value:m.soldUnits,sub:'disposed',module:'ip-warehouse-management#records'},
      {label:'Collection',value:m.collectionPct==null?0:Math.round(m.collectionPct),suffix:'%',
       pct:null,tone:m.collectionPct==null?null:(m.collectionPct>=80?'good':m.collectionPct>=50?'warning':'critical'),
       sub:m.collectionPct==null?'nothing billed in this period':'of '+money(m.billed)+' billed',
       module:'fa-receivables-payables#records'},
      {label:'Receivables',value:m.receivablesPct==null?0:Math.round(m.receivablesPct),suffix:'%',
       tone:m.receivablesPct==null?null:(m.receivablesPct<=20?'good':m.receivablesPct<=50?'warning':'critical'),
       sub:m.receivablesPct==null?'nothing outstanding':money(m.outstanding)+' outstanding',
       module:'fa-receivables-payables#records'}
    ]);
    if(m.collectionPct!=null)
      cards.push(vizRing(m.collectionPct,{title:'Collection rate',
        subtitle:money(m.collected)+' of '+money(m.billed)+' billed',caption:'collected',
        tipLabel:'Collected against billed',open:'fa-receivables-payables#records',
        openLabel:'Open the payment requests',
        tone:m.collectionPct>=80?'good':m.collectionPct>=50?'warning':'critical'}));
    if((m.aging||[]).some(r=>Number(r.value)>0))
      cards.push(vizBars(m.aging.map(r=>({label:r.label,value:Number(r.value)||0})).filter(r=>r.value>0),
        {title:'Receivables ageing',money:true,color:VIZ.status.serious,
         keyLabel:'Bucket',valueLabel:'Outstanding',labelWidth:104,
         open:'fa-receivables-payables#records',openLabel:'Open the receivables'}));
    if(m.availableUnits+m.leasedUnits+m.soldUnits+m.deployedUnits>0)
      cards.push(vizDonut([
        {label:'Available',value:m.availableUnits},{label:'Leased',value:m.leasedUnits},
        {label:'Sold',value:m.soldUnits},{label:'Deployed',value:m.deployedUnits}],
        {title:'Where the fleet is',totalLabel:'Units',keyLabel:'State',valueLabel:'Units',
         open:'ip-warehouse-management#records',openLabel:'Open unit visibility'}));
  }

  if(sec.inventory){
    const i=sec.inventory;
    // Every tile goes somewhere. A number you cannot click is a dead end.
    const invTiles=vizTiles([
      {label:'Available',value:i.available,tone:'good',sub:'ready to move',module:'ip-warehouse-management#records',
       spark:sparkOf('inventory'),delta:deltaOf('inventory')},
      {label:'Quarantine',value:i.quarantine,tone:i.quarantine?'serious':'good',sub:'held back',
       module:'ip-warehouse-management#records'},
      {label:'Missing cost',value:i.unvalued,tone:i.unvalued?'critical':'good',sub:'unvalued units',
       module:'ip-warehouse-management#records'},
      {label:'Open counts',value:i.openCounts,tone:i.openCounts?'warning':'good',sub:'being counted',
       module:'ip-cycle-counting#records'},
      {label:'Variances',value:i.variances,tone:i.variances?'critical':'good',sub:'units in question',
       module:'ip-cycle-counting#reports'}
    ]);
    if(!tiles)tiles=invTiles;
    if((i.byClass||[]).length)
      cards.push(vizDonut(i.byClass.map(r=>({label:r.label||'Unclassified',value:Number(r.value)||0})),
        {title:'Inventory by class',totalLabel:'Units',keyLabel:'Class',valueLabel:'Units',
         open:'ip-warehouse-management#records',openLabel:'Open unit visibility'}));
    const pg=d.progress;
    if(pg&&pg.pct!=null)
      cards.push(vizRing(pg.pct,{title:'Counting progress',
        subtitle:compact(pg.counted)+' of '+compact(pg.expected)+' expected units',
        caption:'counted',tipLabel:'Counted against expected',
        open:'ip-cycle-counting#approvals',openLabel:'Open the physical count',
        tone:pg.pct>=100?'good':pg.pct>=50?'warning':'serious'}));
  }
  if(sec.procurement&&(sec.procurement.topVendors||[]).length)
    cards.push(vizBars(sec.procurement.topVendors.map(r=>({label:r.label||'-',value:Number(r.value)||0})),
      {title:'Committed spend by vendor',money:true,color:VIZ.series[1],
       keyLabel:'Vendor',valueLabel:'Amount',limit:6,labelWidth:120,
       open:'ip-inbound-logistics#records',openLabel:'Open purchase orders'}));
  if(sec.finance&&(sec.finance.byStage||[]).length)
    cards.push(vizDonut(sec.finance.byStage.map(r=>({label:String(r.label||'').replace(/_/g,' '),value:Number(r.value)||0})),
      {title:'Payment requests by stage',totalLabel:'Requests',keyLabel:'Stage',valueLabel:'Requests',
       open:'fa-receivables-payables#records',openLabel:'Open the payment requests'}));
  if(sec.service&&(sec.service.byStatus||[]).length)
    cards.push(vizDonut(sec.service.byStatus.map(r=>({label:String(r.label||'').replace(/_/g,' '),value:Number(r.value)||0})),
      {title:'Service jobs by stage',totalLabel:'Jobs',keyLabel:'Stage',valueLabel:'Jobs',
       open:'sd-service-management#records',openLabel:'Open the job orders'}));

  if(tr.all&&tr.all.series)
    cards.push(vizLine([{label:'Activity',points:tr.all.series.map(p=>(
      {label:new Date(p.label+'T00:00:00').toLocaleDateString('en-US',{weekday:'short'}),value:p.value}))}],
      {title:'Activity across the last 7 days',keyLabel:'Day',valueLabel:'Events'}));

  /*
   * The period control. A management figure without a period is not a figure,
   * so the range is always visible and always stated, not hidden behind a
   * filter somebody has to remember to open.
   */
  const per=d.period||{};
  const presets=[['This month','month'],['Last 30 days','30d'],['This quarter','quarter'],['This year','year']];
  const rangeHtml='<div class="home-range">'
    +'<div class="home-range-presets">'+presets.map(function(x){
      return '<button type="button" data-range="'+x[1]+'"'
        +((rng.preset===x[1]||(!rng.preset&&x[1]==='month'))?' class="on"':'')+'>'+esc(x[0])+'</button>';}).join('')
    +'</div><div class="home-range-dates"><input type="date" id="homeFrom" value="'+esc(per.from||'')+'">'
    +'<span>to</span><input type="date" id="homeTo" value="'+esc(per.to||'')+'">'
    +'<button type="button" class="command" id="homeApply">Apply</button></div></div>';

  content.innerHTML='<section class="home-shell">'
    +'<header class="home-top">'
      +'<div class="home-brand"><img src="/logo-navy.png" alt=""><div>'
        +'<b>Blitz <i>-</i> ERP</b><small>E88 Ventures Inc.</small></div></div>'
      +'<div class="home-actions">'
        +'<span class="home-scope">'+esc(state.scope==='ADMIN'?'Admin scope':'Operations scope')+'</span>'
        +'<button type="button" class="command primary home-open" id="homeModules">Open modules</button>'
        +'<button type="button" class="command" id="homeSignOut">Sign out</button></div>'
    +'</header>'
    +'<div class="home-hello"><div><h1>'+esc(greet)+', '+esc(String(who).split(' ')[0]||who)+'</h1>'
      +'<p>'+esc(new Date().toLocaleDateString('en-US',{weekday:'long',day:'numeric',month:'long',year:'numeric'}))
      +(d.department?' \u00b7 '+esc(String(d.department).toLowerCase().replace(/\b\w/g,function(ch){return ch.toUpperCase();})):'')
      +'</p></div>'+rangeHtml+'</div>'
    +waitingHtml
    +tiles
    +'<div class="viz-grid home-grid">'+cards.join('')+'</div>'
    +'<footer class="home-foot"><span>Blitz - ERP</span><span>&copy; 2026 E88 Ventures Inc.</span></footer>'
    +'</section>';

  /*
   * A card opens its source, not the module's front page. 'code#section' lands
   * on the register the number came from, so clicking Variances puts you on the
   * variance report rather than somewhere you have to navigate from.
   */
  const go=async dest=>{
    if(!dest)return;
    const [code,section]=String(dest).split('#');
    if(!canWorkspace(code))return toast('This module is not assigned to your account.','error');
    await openWorkspace(code);
    if(section&&state.module&&state.module.code===code)await openSection(section);
  };
  bindViz(content,null,go);
  $$('[data-home-go]').forEach(b=>b.onclick=()=>go(b.dataset.homeGo));
  // canWorkspace only knows module codes, so strip any section before the check.
  const setRange=(from,to,preset)=>{state.homeRange={from,to,preset};renderHomeDashboard();};
  const iso=dt=>dt.toISOString().slice(0,10);
  $$('[data-range]').forEach(b=>b.onclick=()=>{
    const now=new Date(), k=b.dataset.range;
    if(k==='month')  return setRange(iso(new Date(now.getFullYear(),now.getMonth(),1)),iso(now),'month');
    if(k==='30d')    return setRange(iso(new Date(now.getTime()-29*864e5)),iso(now),'30d');
    if(k==='quarter')return setRange(iso(new Date(now.getFullYear(),Math.floor(now.getMonth()/3)*3,1)),iso(now),'quarter');
    if(k==='year')   return setRange(iso(new Date(now.getFullYear(),0,1)),iso(now),'year');
  });
  if($('#homeApply'))$('#homeApply').onclick=()=>{
    const f=$('#homeFrom').value, t=$('#homeTo').value;
    if(!f||!t)return toast('Pick both dates.','error');
    if(f>t)return toast('The start date is after the end date.','error');
    setRange(f,t,null);
  };
  $('#homeModules').onclick=()=>{state.showModuleMap=true;renderLaunchpad();};
  $('#homeSignOut').onclick=logout;
  // Let the cards arrive rather than snap in.
  requestAnimationFrame(()=>content.querySelectorAll('.viz,.home-wait').forEach((el,i)=>{
    el.style.animation='homeRise .38s cubic-bezier(.2,.8,.25,1) both';
    el.style.animationDelay=(i*40)+'ms';
  }));
}

function renderLaunchpad(){
  // Home first; the module map is one button away.
  if(!state.showModuleMap)return renderHomeDashboard();
  if(isPhone()&&!state.mobileFull)return renderMobileLaunchpad();
  state.module=null;
  state.definition=null;
  state.section='center';
  if(localStorage.getItem('e88-expanded-groups')===null){state.catalog.groups.forEach(group=>state.expandedGroups.add(group.code));}
  document.body.classList.remove('workbench-view');
  document.body.classList.add('launchpad-view');
  content.innerHTML=`<section class="enterprise-launchpad">
    <div class="launchpad-controls">
      <div class="launchpad-brand"><img src="/logo-navy.png" alt="E88 Ventures Inc." class="brand-logo"><span class="brand-name">Blitz <i>-</i> ERP</span><small class="brand-sub">E88 Ventures Inc.</small></div>
      <div><span>${esc(state.session.user.displayName||state.session.user.email)}</span>${(state.scope==='ADMIN'||state.session.user.role==='ADMIN')?'<button id="launchAccess">User Access</button>':''}<button id="launchScope" class="scope-chip" title="Switch between Operations and System Administration">${state.scope==='ADMIN'?'Admin scope':'Operations scope'}</button><button id="launchRecords">Master Reference</button><button id="expandAllGroups">Expand all</button><button id="collapseAllGroups">Collapse all</button><button id="launchLogout">Sign out</button></div>
    </div>
    <div class="enterprise-map">
      <div class="enterprise-columns">${state.catalog.groups.map(group=>{
        const expanded=state.expandedGroups.has(group.code);
        return `<section class="enterprise-column ${expanded?'expanded':'collapsed'}" data-enterprise-group="${esc(group.code)}">
          <button class="enterprise-category" type="button" data-group-toggle="${esc(group.code)}" aria-expanded="${expanded}"><span>${esc(group.title)}</span><i>${expanded?'▾':'▸'}</i></button>
          <div class="enterprise-module-stack" ${expanded?'':'hidden'}>${group.items.map(item=>enterpriseButton(item)).join('')}</div>
        </section>`;
      }).join('')}</div>
      <div class="enterprise-tools">${state.catalog.tools.map(item=>enterpriseButton(item,'enterprise-tool-button')).join('')}</div>
      <div class="enterprise-addons-title"><span>Add-ons</span></div>
      <div class="enterprise-addons">${state.catalog.addons.map(item=>enterpriseButton(item,'enterprise-addon-button')).join('')}</div>
      <footer class="enterprise-brand-strip">
        <div class="enterprise-brand-primary">E88 Ventures Inc.</div>
        <div class="enterprise-brand-secondary">Blitz - ERP · © 2026 E88 Ventures Inc.</div>
      </footer>
    </div>
  </section>`;
  const persistGroups=()=>localStorage.setItem('e88-expanded-groups',JSON.stringify([...state.expandedGroups]));
  $$('[data-group-toggle]').forEach(button=>button.onclick=()=>{
    const code=button.dataset.groupToggle;
    if(state.expandedGroups.has(code))state.expandedGroups.delete(code);else state.expandedGroups.add(code);
    persistGroups();renderLaunchpad();
  });
  $('#expandAllGroups').onclick=()=>{state.catalog.groups.forEach(group=>state.expandedGroups.add(group.code));persistGroups();renderLaunchpad();};
  $('#collapseAllGroups').onclick=()=>{state.expandedGroups.clear();persistGroups();renderLaunchpad();};
  $$('[data-workspace]').forEach(button=>button.onclick=()=>{const __c=button.dataset.workspace;if(__c==='addon-analytics')return renderReportsHub();return openWorkspace(__c);});
  $('#launchLogout').onclick=logout;
  if($('#launchAccess'))$('#launchAccess').onclick=renderAccessAdmin;
  if($('#launchRecords'))$('#launchRecords').onclick=()=>renderRecordConsole();
  if($('#launchScope'))$('#launchScope').onclick=()=>{
    const admin=state.scope==='ADMIN';
    if(!state.session.user.canUseAdminScope&&!admin)return toast('This account is not enabled for System Administration.','error');
    modal(admin?'You are in System Administration':'You are in Operations',
      `<div class="operational-form"><p>${admin?'Setup, users and backup are available. Approvals are intentionally blocked in this scope.':'Transactions and approvals are available. System setup is blocked in this scope.'}</p>
       <p>The scope is fixed for the whole session. To switch, sign out and pick the other scope on the sign-in screen.</p>
       <div class="modal-actions"><button type="button" class="command primary" id="scopeSwitch">Sign out and switch</button><button type="button" class="command" id="scopeStay">Stay here</button></div></div>`);
    const mb=$('#modalBody');
    mb.querySelector('#scopeStay').onclick=()=>closeModal();
    mb.querySelector('#scopeSwitch').onclick=async()=>{setScope(admin?'OPERATIONS':'ADMIN');closeModal();await logout();};
  };
}

function renderSidebar(){
  const module=state.module;
  const icons={center:'▦',records:'☷',approvals:'✓',reports:'▥',setup:'⚙'};
  const items=workspaceTabs(module.code).map(([section,label])=>[section,label,icons[section]]);
  $('#nav').innerHTML=`<button class="nav-home" id="moduleHome">&larr; Blitz - ERP</button>
    <div class="nav-group">${esc(module.groupTitle)}</div>
    ${items.map(([section,label,icon])=>`<button class="nav-item ${state.section===section?'active':''}" data-section="${section}"><span class="nav-icon">${icon}</span>${label}</button>`).join('')}
    ${state.session.user.role==='ADMIN'?'<div class="nav-group">System</div><button class="nav-item" id="sidebarAccess"><span class="nav-icon">♙</span>User Access</button>':''}`;
  $('#moduleHome').onclick=()=>{state.showModuleMap=false;renderLaunchpad();};
  $$('[data-section]').forEach(button=>button.onclick=()=>openSection(button.dataset.section));
  if($('#sidebarAccess'))$('#sidebarAccess').onclick=renderAccessAdmin;
}
function setHeader(title,subtitle=''){
  $('#pageTitle').textContent=title;
  $('#pageSubtitle').textContent=subtitle;
}
/* ===================================================================
 * Mobile tile launcher.
 *
 * On a phone the eleven-column module rail is unusable, so a module opens as a
 * grid of large tap targets - the handful of things somebody actually does
 * standing in a warehouse, not the whole desktop navigation. Inventory first,
 * because that is where the phone gets used.
 * =================================================================== */
const MOBILE_TILES={
  // Physical Count lives in Inventory & Cycle Counting, not Warehouse Management.
  'ip-cycle-counting':{
    title:'Inventory Count',
    tiles:[
      {key:'count',label:'Physical Count',sub:'Scan and count units',tone:'orange',icon:'clipboard',section:'approvals'},
      {key:'plans',label:'Count Plans',sub:'Open or create a count sheet',tone:'green',icon:'clipboard',section:'records'},
      {key:'variance',label:'Variances',sub:'Review count differences',tone:'blue',icon:'check',section:'reports'},
      {key:'overview',label:'Overview',sub:'Counting status at a glance',tone:'slate',icon:'box',section:'center'}
    ]
  },
  'ip-warehouse-management':{
    title:'Warehouse',
    tiles:[
      {key:'stock',label:'Unit Visibility',sub:'Find a serial, see its status',tone:'slate',icon:'box',section:'records'},
      {key:'move',label:'Stock Movement',sub:'Receive, issue and transfer',tone:'orange',icon:'truck',section:'approvals'},
      {key:'qr',label:'QR Trace',sub:'Scan a unit and read its history',tone:'blue',icon:'check',section:'reports'},
      {key:'loc',label:'Locations',sub:'Warehouses and bins',tone:'green',icon:'box',section:'setup'}
    ]
  }
};
const TILE_ICONS={
  clipboard:'<path d="M9 3h6v3H9z"/><rect x="5" y="5" width="14" height="16" rx="2"/><path d="M8 12h8M8 16h5"/>',
  box:'<path d="M3 8l9-4 9 4-9 4-9-4z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/>',
  truck:'<rect x="2" y="7" width="12" height="9" rx="1"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  check:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l3 3 5-6"/>'
};
function isPhone(){return !!(window.matchMedia&&window.matchMedia('(max-width: 720px)').matches);}
function renderMobileTiles(module){
  const spec=MOBILE_TILES[module.code];
  if(!spec)return false;
  content.innerHTML='<div class="mtile-wrap"><div class="mtile-head"><h2>'+esc(spec.title)+'</h2>'
    +'<span>'+esc(module.groupTitle||'')+'</span></div><div class="mtile-grid">'
    +spec.tiles.map(function(t){
      return '<button type="button" class="mtile '+esc(t.tone)+'" data-mtile="'+esc(t.section)+'">'
        +'<svg viewBox="0 0 24 24" aria-hidden="true">'+(TILE_ICONS[t.icon]||'')+'</svg>'
        +'<b>'+esc(t.label)+'</b><small>'+esc(t.sub)+'</small><i class="mtile-go">&rsaquo;</i></button>';
    }).join('')
    +'</div><button type="button" class="command mtile-full" id="mtileFull">Open the full desktop view</button></div>';
  $$('[data-mtile]').forEach(function(b){b.onclick=function(){openSection(b.dataset.mtile);};});
  $('#mtileFull').onclick=function(){state.mobileFull=true;openSection('center');};
  return true;
}
/* A phone that has drilled into a section keeps one obvious way back to the
   tiles - the desktop rail is off-screen on a handset. */
function addMobileBackBar(){
  const spec=MOBILE_TILES[state.module&&state.module.code];
  if(!spec||!content||content.querySelector('.mtile-back'))return;
  const bar=document.createElement('button');
  bar.type='button';
  bar.className='mtile-back';
  bar.innerHTML='&lsaquo; '+esc(spec.title);
  bar.onclick=function(){state.mobileFull=false;renderMobileTiles(state.module);};
  content.insertBefore(bar,content.firstChild);
}
/* The eleven-column enterprise map is unreadable on a handset, so the phone
   home screen is a grid of group tiles, then a grid of module tiles. */
const MGROUP_TONES=['orange','slate','green','blue'];
function renderMobileLaunchpad(){
  state.module=null;state.definition=null;state.section='center';
  document.body.classList.remove('workbench-view');
  document.body.classList.add('launchpad-view');
  const groups=(state.catalog.groups||[]).filter(function(g){return (g.items||[]).length;});
  const open=state.mobileGroup&&groups.filter(function(g){return g.code===state.mobileGroup;})[0];
  const user=state.session&&state.session.user||{};
  let body='<div class="mtile-wrap"><div class="mtile-home-top">'
    +'<div class="mtile-brand"><img src="/logo-navy.png" alt=""><div><b>Blitz <i>-</i> ERP</b>'
    +'<small>'+esc(user.displayName||user.email||'')+'</small></div></div>'
    +'<button type="button" class="mtile-signout" id="mSignOut">Sign out</button></div>';
  if(open){
    body+='<button type="button" class="mtile-back" id="mGroupBack">&lsaquo; All modules</button>'
      +'<div class="mtile-head"><h2>'+esc(open.title)+'</h2><span>Modules</span></div><div class="mtile-grid">'
      +open.items.map(function(it,i){
        return '<button type="button" class="mtile '+MGROUP_TONES[i%MGROUP_TONES.length]+'" data-mmodule="'+esc(it.code)+'">'
          +'<svg viewBox="0 0 24 24" aria-hidden="true">'+TILE_ICONS.box+'</svg>'
          +'<b>'+esc(it.label)+'</b><small>'+esc(String(it.permission||'').replace(/_/g,' ').toLowerCase())+'</small><i class="mtile-go">&rsaquo;</i></button>';
      }).join('')+'</div>';
  }else{
    body+='<div class="mtile-head"><h2>Modules</h2><span>Pick an area</span></div><div class="mtile-grid">'
      +groups.map(function(g,i){
        return '<button type="button" class="mtile '+MGROUP_TONES[i%MGROUP_TONES.length]+'" data-mgroup="'+esc(g.code)+'">'
          +'<svg viewBox="0 0 24 24" aria-hidden="true">'+TILE_ICONS.clipboard+'</svg>'
          +'<b>'+esc(g.title)+'</b><small>'+g.items.length+' module'+(g.items.length===1?'':'s')+'</small>'
          +'<i class="mtile-go">&rsaquo;</i></button>';
      }).join('')+'</div>';
  }
  body+='<button type="button" class="command mtile-full" id="mDesktop">Open the full desktop view</button></div>';
  content.innerHTML=body;
  $$('[data-mgroup]').forEach(function(b){b.onclick=function(){state.mobileGroup=b.dataset.mgroup;renderMobileLaunchpad();};});
  $$('[data-mmodule]').forEach(function(b){b.onclick=function(){openWorkspace(b.dataset.mmodule);};});
  if($('#mGroupBack'))$('#mGroupBack').onclick=function(){state.mobileGroup=null;renderMobileLaunchpad();};
  if($('#mSignOut'))$('#mSignOut').onclick=logout;
  if($('#mDesktop'))$('#mDesktop').onclick=function(){state.mobileFull=true;renderLaunchpad();};
}

async function openWorkspace(code){
  const module=moduleByCode(code);
  if(!module||!canWorkspace(code))return toast('This module is not assigned to your account.','error');
  state.module=module;
  state.definition=(await api(`/workspace/modules/${code}/definition`)).definition;
  state.section='center';
  document.body.classList.remove('launchpad-view');
  document.body.classList.add('workbench-view');
  setHeader(module.label,module.groupTitle);
  renderSidebar();
  // A phone gets the tile launcher instead of the desktop rail.
  if(isPhone()&&!state.mobileFull&&renderMobileTiles(module))return;
  await openSection('center');
}
async function openSection(section){
  if(!state.module)return renderLaunchpad();
  state.section=section;
  renderSidebar();
  const out=await renderSectionBody(section);
  if(isPhone()&&!state.mobileFull&&MOBILE_TILES[state.module.code]){
    try{addMobileBackBar();}catch(e){}
  }
  return out;
}
async function renderSectionBody(section){
  if(state.module.code.startsWith('fa-'))return renderFinanceWorkspace(section);
  if(state.module.code==='ip-inbound-logistics')return renderInboundWorkspace(section);
  if(state.module.code==='ip-warehouse-management')return renderWarehouseWorkspace(section);
  if(state.module.code==='ip-cycle-counting')return renderCycleWorkspace(section);
  if(state.module.code==='ip-inventory-analysis')return renderInventoryAnalysisWorkspace(section);
  if(state.module.code==='sd-outbound-logistics')return renderOutboundWorkspace(section);
  if(state.module.code==='sd-order-management')return renderSalesOrderWorkspace(section);
  if(state.module.code==='ip-sourcing-purchasing')return renderSourcingWorkspace(section);
  if(state.module.code==='qm-inspection-sampling')return renderQualityWorkspace(section);
  if(state.module.code==='ip-supplier-portal')return renderSupplierPortal(section);
  if(state.module.code==='sd-service-management')return renderServiceWorkspace(section);
  return renderConnectedModuleWorkspace(section);
}
async function renderQualityWorkspace(section){
  content.innerHTML='<div class="workspace-loading">Loading quality inspections...</div>';
  try{
    let __all=[];for(let __p=1;__p<=8;__p++){const __rg=await api('/checklists?size=250&page='+__p);const __rr=(__rg.rows||[]);__all=__all.concat(__rr);if(__rr.length<250)break;}
    const rows=__all.map(r=>`<tr><td><b>${esc(r.checklist_no)}</b></td><td>${esc((r.serial_no||'').slice(0,48))}</td><td>${statusBadge(r.result)}</td><td>${esc(r.approved_by||'-')}</td><td>${esc((r.created_at||'').slice(0,10))}</td></tr>`);
    const body=`<section class="workspace-card"><header><div><h2>Inspection & Sampling - Pre-release Register</h2><span>All ${__all.length} inspection records (actuals).</span></div></header>${operationalTable(['Checklist #','Serial / Unit','Result','Approved By','Recorded'],rows)}</section>`;
    content.innerHTML=workbenchShell(body,section);
  }catch(error){showWorkspaceError(error);}
}

function kpi(label,value,opts){
  opts=opts||{};
  const go=opts.section?` data-kpi-go="${esc(opts.section)}"`:'';
  const term=opts.match?` data-kpi-match="${esc(opts.match)}"`:'';
  return `<article class="workspace-kpi is-clickable" role="button" tabindex="0" data-kpi-label="${esc(label)}" data-kpi-value="${esc(value)}"${go}${term}><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`;
}
function kpiKeyword(label){
  const map=[[/discrepan|variance/i,'VARIANCE'],[/draft/i,'DRAFT'],[/approved|approval/i,'APPROVED'],
    [/pending|awaiting|for approval/i,'PENDING'],[/open/i,'OPEN'],[/overdue/i,'OVERDUE'],[/paid/i,'PAID'],
    [/posted/i,'POSTED'],[/received/i,'RECEIVED'],[/submitted/i,'SUBMITTED'],[/missing/i,'MISSING'],[/matched/i,'MATCHED']];
  for(const [re,key] of map){if(re.test(label))return key;}
  return '';
}
function kpiDrill(card){
  const label=card.dataset.kpiLabel||'KPI';
  const go=card.dataset.kpiGo;
  if(go)return openSection(go);
  const term=(card.dataset.kpiMatch||kpiKeyword(label)).toUpperCase();
  const table=document.querySelector('.workbench-canvas table.record-table');
  if(!table){toast(label+': '+(card.dataset.kpiValue||''),'success');return;}
  const heads=[...table.querySelectorAll('thead th')].map(th=>th.textContent.replace(/\s+/g,' ').trim());
  let rows=[...table.querySelectorAll('tbody tr')];
  if(term)rows=rows.filter(tr=>tr.textContent.toUpperCase().includes(term));
  if(!rows.length){toast('No matching rows for '+label,'error');return;}
  const html='<div class="record-table-wrap"><table class="record-table"><thead><tr>'
    +heads.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'
    +rows.slice(0,300).map(tr=>'<tr>'+[...tr.children].map(td=>'<td>'+esc(td.textContent.replace(/\s+/g,' ').trim())+'</td>').join('')+'</tr>').join('')
    +'</tbody></table></div>';
  modal(label,html,rows.length+' matching record'+(rows.length===1?'':'s'));
}
function bindKpiCards(){
  $$('.workspace-kpi.is-clickable').forEach(card=>{
    if(card.dataset.kpiBound==='1')return;
    card.dataset.kpiBound='1';
    card.onclick=()=>{try{kpiDrill(card);}catch(e){}};
    card.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();card.click();}};
  });
}
function workbenchShell(body,active=state.section){
  const module=state.module;
  const user=state.session.user;
  const tabs=workspaceTabs(module.code);
  const submodules=state.definition?.submodules||[];
  return `<section class="erp-workbench">
    <div class="workbench-headwrap">
    <header class="workbench-systembar">
      <div><button class="workbench-home" title="Blitz - ERP">▦</button><span class="workbench-user-dot">●</span><b>${esc(user.displayName||user.email)}</b><small>${esc(user.role)}</small></div>
      <div><span>INTERNAL</span><button class="workbench-home">Modules</button><button class="workbench-logout">Sign out</button></div>
    </header>
    <div class="workbench-modulebar">
      <div><span class="workbench-star">★</span><div><h1>${esc(module.label)}</h1><small>${esc(module.groupTitle)}</small></div></div>
      <div class="workbench-module-chip">${esc(module.label)}</div>
    </div>
    <nav class="workbench-tabs">${tabs.map(([id,label])=>`<button data-workbench-section="${id}" class="${active===id?'active':''}">${esc(label)}</button>`).join('')}</nav>
    ${submodules.length?`<nav class="workbench-submodules"><span>Submodules</span>${submodules.map(sub=>`<button data-submodule-code="${esc(sub.submodule_code)}" data-submodule-type="${esc(sub.record_type||'')}" data-submodule-connected="${esc(sub.connected_module_code||'')}" title="${esc(sub.posting_event_type||'Operational submodule')}">${esc(sub.submodule_name)}</button>`).join('')}</nav>`:''}
    </div>
    <main class="workbench-canvas">${body}</main>
    <footer class="workbench-footer"><span>Blitz - ERP</span><span>Connected Workspace · © 2026 AL23</span></footer>
  </section>`;
}
function bindWorkbench(){
  bindKpiCards();
  $$('.workbench-home').forEach(button=>button.onclick=renderLaunchpad);
  $$('.workbench-logout').forEach(button=>button.onclick=logout);
  $$('[data-workbench-section]').forEach(button=>button.onclick=()=>openSection(button.dataset.workbenchSection));
  $$('[data-submodule-code]').forEach(button=>button.onclick=()=>{
    const connected=button.dataset.submoduleConnected;
    if(connected&&moduleByCode(connected)&&canWorkspace(connected))return openWorkspace(connected);
    state.submoduleType=button.dataset.submoduleType||'';
    state.submoduleLabel=button.textContent||'';
    return openSection('records');
  });
  $$('[data-go]').forEach(button=>button.onclick=()=>openSection(button.dataset.go));
  enhanceTables();
}
function miniBars(values){
  const max=Math.max(1,...values.map(value=>Number(value[1]||0)));
  return `<div class="mini-bars">${values.map(([label,value,tone='blue'])=>`<div><span class="${tone}" style="height:${Math.max(7,Math.round(Number(value||0)/max*78))}px"></span><small>${esc(label)}</small><b>${esc(value||0)}</b></div>`).join('')}</div>`;
}
function horizontalBars(values){
  const max=Math.max(1,...values.map(value=>Number(value[1]||0)));
  return `<div class="horizontal-bars">${values.map(([label,value,tone='blue'])=>`<div><small>${esc(label)}</small><span><i class="${tone}" style="width:${Math.round(Number(value||0)/max*100)}%"></i></span><b>${esc(value||0)}</b></div>`).join('')}</div>`;
}
function recordsTable(rows){
  if(!rows?.length)return'<div class="workspace-empty"><b>No records</b></div>';
  const listFields=(state.definition?.fields||[]).filter(field=>field.list).slice(0,3);
  const value=(row,field)=>{
    const raw=row.payload?.[field.key];
    if(raw===undefined||raw===null||raw==='')return'-';
    if(field.type==='date'||field.type==='datetime-local')return date(raw);
    if(field.type==='number'&&/amount|cost|price|rate|value|balance/i.test(field.key))return money(raw);
    if(field.type==='checkbox')return raw?'Yes':'No';
    return esc(raw);
  };
  return `<div class="record-table-wrap"><table class="record-table"><thead><tr><th>Reference</th><th>Date</th><th>Type</th>${listFields.map(field=>`<th>${esc(field.label)}</th>`).join('')}<th>Description</th><th>Owner</th><th class="num">${esc(state.definition?.amountLabel||'Amount')}</th><th>Status</th><th>Updated</th></tr></thead><tbody>
    ${rows.map(row=>`<tr data-record-id="${row.id}"><td><b>${esc(row.record_no)}</b></td><td>${date(row.transaction_date)}</td><td>${esc(row.record_type)}</td>
      ${listFields.map(field=>`<td>${value(row,field)}</td>`).join('')}<td>${esc(row.description||'-')}</td><td>${esc(row.owner_email||'-')}</td>
      <td class="num">${money(row.amount)}</td><td>${statusBadge(row.status)}</td><td>${date(row.updated_at)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function operationalEmpty(message){
  return `<div class="workspace-empty"><b>${esc(message)}</b></div>`;
}
function outboundEmptyHint(title,detail){
  return `<div class="outbound-empty"><p class="oe-title">${esc(title)}</p><p class="oe-detail">${esc(detail)}</p><button type="button" class="command primary" data-section-link="records">Go to Requisitions</button></div>`;
}
function operationalTable(headers,rows,options={}){
  if(!rows.length)return operationalEmpty(options.emptyMessage||'No records');
  const key=options.key||headers.join('|').replace(/[^a-z0-9]+/gi,'-').toLowerCase();
  return `<div class="record-table-wrap" data-table-key="${esc(key)}"><table class="record-table"><thead><tr>${headers.map((header,index)=>`<th data-column-index="${index}">${esc(header)}<span class="column-resizer" aria-hidden="true"></span></th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
function enhanceTables(){
  $$('.record-table-wrap').forEach(wrap=>{
    if(wrap.dataset.enhanced==='1')return;
    wrap.dataset.enhanced='1';
    const table=wrap.querySelector('table');
    const key=wrap.dataset.tableKey||'erp-table';
    let widths={};
    try{widths=JSON.parse(localStorage.getItem(`e88-table-widths:${key}`)||'{}');}catch{}
    table?.querySelectorAll('thead th').forEach((th,index)=>{
      const saved=Number(widths[index]||0);if(saved>0)th.style.width=`${saved}px`;
      const handle=th.querySelector('.column-resizer');if(!handle)return;
      handle.onpointerdown=event=>{
        event.preventDefault();event.stopPropagation();
        const startX=event.clientX;const startWidth=th.getBoundingClientRect().width;
        handle.setPointerCapture?.(event.pointerId);
        const move=moveEvent=>{const width=Math.max(70,startWidth+moveEvent.clientX-startX);th.style.width=`${width}px`;};
        const up=()=>{
          document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);
          widths[index]=Math.round(th.getBoundingClientRect().width);
          localStorage.setItem(`e88-table-widths:${key}`,JSON.stringify(widths));
        };
        document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);
      };
    });
  });
}
function workflowStrip(steps,active=0){
  return `<div class="process-strip">${steps.map((step,index)=>`<div class="${index===active?'active':index<active?'complete':''}"><span>${index+1}</span><b>${esc(step)}</b></div>`).join('')}</div>`;
}
function bindOperationalShell(){
  bindWorkbench();
  enhanceTables();
  $$('[data-section-link]').forEach(button=>button.onclick=()=>openSection(button.dataset.sectionLink));
}

function financeQuery(){
  const entity=$('#financeEntity')?.value||'E88';
  const dateFrom=$('#financeDateFrom')?.value||`${new Date().getFullYear()}-01-01`;
  const dateTo=$('#financeDateTo')?.value||new Date().toISOString().slice(0,10);
  return new URLSearchParams({entity,dateFrom,dateTo});
}
function financeFilters(extra=''){
  return `<div class="workspace-commandbar finance-filterbar">
    <label class="inline-control"><span>Entity</span><select id="financeEntity">
      <option value="E88">E88 Ventures</option><option value="NRD">NRD Motorcycle</option>
      <option value="RIDEBOX">RideBox</option><option value="SHARED">Shared Services</option>
    </select></label>
    <label class="inline-control"><span>From</span><input id="financeDateFrom" type="date" value="${new Date().getFullYear()}-01-01"></label>
    <label class="inline-control"><span>To</span><input id="financeDateTo" type="date" value="${new Date().toISOString().slice(0,10)}"></label>
    <button class="command primary" id="financeApply">Apply</button>${extra}
  </div>`;
}
function bindFinanceFilters(reload){
  if($('#financeApply'))$('#financeApply').onclick=reload;
}
function financeStatus(value){
  return statusBadge(value||'DRAFT');
}
function financeTable(headers,rows,empty='No finance records'){
  return operationalTable(headers,rows.length?rows:[`<tr><td colspan="${headers.length}"><div class="workspace-empty"><b>${esc(empty)}</b></div></td></tr>`]);
}
function financeActionLabel(status){
  if(status==='DRAFT')return['SUBMIT','Submit'];
  if(status==='SUBMITTED')return['APPROVE','Approve'];
  if(status==='APPROVED')return['POST','Post'];
  return null;
}

async function renderFinanceWorkspace(section){
  const code=state.module.code;
  if(code==='fa-general-accounting')return renderGeneralAccounting(section);
  if(code==='fa-receivables-payables')return renderReceivablesPayables(section);
  if(code==='fa-fixed-assets')return renderFixedAssetsFinance(section);
  if(code==='fa-management-accounting')return renderManagementAccounting(section);
  if(code==='fa-consolidation-reporting')return renderConsolidation(section);
  if(code==='fa-financial-services')return renderTreasury(section);
  if(code==='fa-planning-budgeting')return renderFinancePlanning(section);
  if(code==='fa-grants-funds'){
    if(section==='center')return renderRoleCenter();
    if(section==='records')return renderRecords();
    if(section==='approvals')return renderRecords('SUBMITTED');
    if(section==='reports')return renderModuleReports();
    return renderModuleSetup();
  }
}

async function renderFinanceCenter(title,subtitle,payablesMode){
  content.innerHTML='<div class="workspace-loading">Loading connected finance…</div>';
  try{
    const query=financeQuery();
    const calls=[api(`/finance/dashboard?${query}`),api('/finance/journals?entity=E88')];
    if(payablesMode){calls.push(api('/finance/aging/AP').catch(()=>({rows:[],totals:{}})));
      calls.push(api('/finance/payment-requests').catch(()=>({rows:[]})));}
    const results=await Promise.all(calls);
    const dashboard=results[0],journals=results[1];
    const balances=dashboard.balances||{};
    let kpiRow;
    if(payablesMode){
      const ap=results[2]||{rows:[],totals:{}};const rfp=results[3]||{rows:[]};
      const apRows=ap.rows||[];const apTotals=ap.totals||{};const rfpRows=rfp.rows||[];
      const today=new Date().toISOString().slice(0,10);
      const totalPayables=(apTotals.total!=null?apTotals.total:balances.payables)||0;
      const overdue=apRows.filter(r=>r.due_date&&r.due_date<today).reduce((s,r)=>s+(Number(r.open_balance)||0),0);
      const pendingRows=rfpRows.filter(r=>r.status!=='PAID');
      const pendingAmt=pendingRows.reduce((s,r)=>s+(Number(r.net_payable)||0),0);
      const paidAmt=rfpRows.filter(r=>r.status==='PAID').reduce((s,r)=>s+(Number(r.net_payable)||0),0);
      kpiRow=`${kpi('Total Payables',money(totalPayables),{section:'approvals'})}${kpi('Overdue Payables',money(overdue),{section:'reports'})}`
        +`${kpi('RFPs Awaiting Action',String(pendingRows.length),{section:'approvals'})}${kpi('RFP Pending Value',money(pendingAmt),{section:'approvals'})}`
        +`${kpi('RFP Paid to Date',money(paidAmt),{section:'reports'})}`;
    }else{
      kpiRow=`${kpi('Cash',money(balances.cash))}${kpi('Receivables',money(balances.receivables))}`
        +`${kpi('Payables',money(balances.payables))}${kpi('Revenue',money(balances.revenue))}`
        +`${kpi('Net Income',money(balances.profit))}`;
    }
    const body=`${financeFilters('<span class="command-spacer"></span><span class="workspace-mode">CONNECTED LEDGER</span>')}
      <div class="workspace-kpis">${kpiRow}</div>
      <div class="ramco-layout"><div class="ramco-main">
        <section class="workspace-card"><header><div><h2>${esc(title)}</h2><span>${esc(subtitle)}</span></div>
          <span>${journals.rows.length} journal entries</span></header>
          ${financeTable(['Journal','Date','Source','Description','Debit','Credit','Status'],
            journals.rows.slice(0,12).map(row=>`<tr data-finance-journal="${row.id}"><td><b>${esc(row.journal_no)}</b></td>
              <td>${date(row.journal_date)}</td><td>${esc(row.source_type||row.journal_type)}</td>
              <td>${esc(row.description)}</td><td class="num">${money(row.total_debit)}</td>
              <td class="num">${money(row.total_credit)}</td><td>${financeStatus(row.status)}</td></tr>`))}</section>
      </div><aside class="ramco-rail">
        <section><header>Posting Worklist</header><div class="definition-list">
          <div><b>Submitted</b><span>${dashboard.worklist?.submitted||0}</span></div>
          <div><b>Approved</b><span>${dashboard.worklist?.approved||0}</span></div>
          <div><b>Source Errors</b><span>${dashboard.events?.errors||0}</span></div></div></section>
        
      </aside></div>`;
    content.innerHTML=workbenchShell(body,'center');bindWorkbench();
    bindFinanceFilters(()=>renderFinanceCenter(title,subtitle,payablesMode));
    $$('[data-finance-journal]').forEach(row=>row.onclick=()=>openFinanceJournal(row.dataset.financeJournal));
  }catch(error){showWorkspaceError(error);}
}

async function renderGeneralAccounting(section){
  if(section==='center')return renderFinanceCenter('Accounting Work Summary','Source transactions, journals, period control and reporting');
  if(section==='records')return renderJournalRegister();
  if(section==='approvals')return renderJournalApprovals();
  if(section==='reports')return renderFinanceReports();
  return renderAccountingSetup();
}

async function renderJournalRegister(){
  content.innerHTML='<div class="workspace-loading">Loading journals…</div>';
  try{
    const data=await api('/finance/journals?entity=E88');
    const rows=data.rows.map(row=>`<tr data-finance-journal="${row.id}"><td><b>${esc(row.journal_no)}</b></td>
      <td>${date(row.journal_date)}</td><td>${esc(row.journal_type)}</td><td>${esc(row.source_no||'Manual')}</td>
      <td>${esc(row.description)}</td><td class="num">${money(row.total_debit)}</td><td>${financeStatus(row.status)}</td></tr>`);
    const body=`<div class="workspace-commandbar"><button class="command primary" id="newJournal" ${can('FINANCE','CREATE')?'':'disabled'}>New Journal</button>
      <button class="command" id="refreshJournals">Refresh</button><span class="command-spacer"></span>
      <span class="workspace-mode">${data.rows.length} JOURNALS</span></div>
      <section class="workspace-card"><header><h2>Journal Register</h2></header>
        ${financeTable(['Journal','Date','Type','Source','Description','Amount','Status'],rows)}</section>`;
    content.innerHTML=workbenchShell(body,'records');bindWorkbench();
    $('#newJournal').onclick=openNewJournal;
    $('#refreshJournals').onclick=renderJournalRegister;
    $$('[data-finance-journal]').forEach(row=>row.onclick=()=>openFinanceJournal(row.dataset.financeJournal));
  }catch(error){showWorkspaceError(error);}
}

async function openNewJournal(){
  const master=await api('/finance/master-data');
  const accounts=master.accounts.filter(account=>account.allow_manual_posting);
  const accountOptions=accounts.map(account=>`<option value="${esc(account.account_code)}">${esc(account.account_code)} · ${esc(account.account_name)}</option>`).join('');
  modal('New Journal Entry',`<form id="journalForm" class="operational-form grid finance-entry-form">
    <label><span>Entity</span><select name="entityCode">${master.entities.map(entity=>`<option value="${esc(entity.entity_code)}">${esc(entity.entity_name)}</option>`).join('')}</select></label>
    <label><span>Journal Date</span><input name="journalDate" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
    <label><span>Department</span><input name="department"></label><label><span>Cost Center</span><input name="costCenter"></label>
    <label><span>Business Line</span><select name="businessLine"><option value="">Select</option><option>MOTORCYCLE_LEASE</option>
      <option>MOTORCYCLE_SALE</option><option>RIDEBOX_BSS</option><option>AFTERSALES</option><option>SHARED_SERVICES</option></select></label>
    <label class="wide"><span>Description</span><input name="description" required></label>
    <div class="wide finance-lines"><table><thead><tr><th>Account</th><th>Description</th><th>Debit</th><th>Credit</th><th></th></tr></thead>
      <tbody id="journalLines"></tbody></table><button type="button" class="command" id="addJournalLine">Add Line</button></div>
    <div class="wide finance-balance"><span>Debit <b id="journalDebit">0.00</b></span><span>Credit <b id="journalCredit">0.00</b></span>
      <span>Difference <b id="journalDifference">0.00</b></span></div>
    <button class="command primary">Save Draft Journal</button>
  </form>`);
  const addLine=()=>{
    $('#journalLines').insertAdjacentHTML('beforeend',`<tr><td><select name="accountCode" required><option value="">Select account…</option>${accountOptions}</select></td>
      <td><input name="lineDescription"></td><td><input name="debit" type="number" min="0" step="0.01"></td>
      <td><input name="credit" type="number" min="0" step="0.01"></td><td><button type="button" class="line-remove">×</button></td></tr>`);
    $$('.line-remove').forEach(button=>button.onclick=()=>{button.closest('tr').remove();sumJournal();});
    $$('#journalLines input[type="number"]').forEach(input=>input.oninput=sumJournal);
  };
  const sumJournal=()=>{
    const rows=$$('#journalLines tr');let debit=0,credit=0;
    rows.forEach(row=>{debit+=Number(row.querySelector('[name="debit"]').value||0);credit+=Number(row.querySelector('[name="credit"]').value||0);});
    $('#journalDebit').textContent=money(debit);$('#journalCredit').textContent=money(credit);
    $('#journalDifference').textContent=money(debit-credit);
  };
  $('#addJournalLine').onclick=addLine;addLine();addLine();
  $('#journalForm').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget;const body=formDataObject(form);
    body.lines=$$('#journalLines tr').map(row=>({
      accountCode:row.querySelector('[name="accountCode"]').value,
      description:row.querySelector('[name="lineDescription"]').value,
      debit:Number(row.querySelector('[name="debit"]').value||0),
      credit:Number(row.querySelector('[name="credit"]').value||0),
    }));
    try{const result=await api('/finance/journals',{method:'POST',body:JSON.stringify(body)});
      closeModal();toast(`${result.journal.journal_no} saved`);await openFinanceJournal(result.journal.id);
    }catch(error){toast(error.message,'error');}
  };
}

async function openFinanceJournal(id){
  try{
    const data=await api(`/finance/journals/${id}`);const h=data.header;
    const action=financeActionLabel(h.status);
    const rows=data.lines.map(line=>`<tr><td>${line.line_no}</td><td><b>${esc(line.account_code)}</b></td>
      <td>${esc(line.account_name)}</td><td>${esc(line.partner_name||'-')}</td><td>${esc(line.department||'-')}</td>
      <td>${esc(line.cost_center||'-')}</td><td class="num">${money(line.base_debit)}</td>
      <td class="num">${money(line.base_credit)}</td></tr>`);
    const body=`<div class="record-actionbar">${action?`<button class="command primary" id="journalAction" data-action="${action[0]}">${action[1]}</button>`:''}
      ${h.status==='POSTED'?'<button class="command" id="journalReverse">Request Reversal</button>':''}
      ${['DRAFT','SUBMITTED','APPROVED'].includes(h.status)?'<button class="command" id="journalVoid">Request Void</button>':''}
      <button class="command" id="journalBack">Back</button><span class="command-spacer"></span>${financeStatus(h.status)}</div>
      <section class="record-page"><header><div><small>${esc(h.entity_name)} · ${esc(h.period_name)}</small><h2>${esc(h.journal_no)}</h2></div>
        <div class="record-number">${money(h.total_debit)}</div></header>
        <section class="record-body"><div class="ramco-detail-grid">
          <div><small>Date</small><b>${date(h.journal_date)}</b><small>Type</small><b>${esc(h.journal_type)}</b></div>
          <div><small>Source</small><b>${esc(h.source_no||'Manual')}</b><small>Description</small><b>${esc(h.description)}</b></div>
          <div><small>Prepared By</small><b>${esc(h.created_by)}</b><small>Approved By</small><b>${esc(h.approved_by||'-')}</b></div>
        </div></section><section class="record-sublist">${financeTable(['#','Account','Name','Partner','Department','Cost Center','Debit','Credit'],rows)}</section>
      </section>`;
    content.innerHTML=workbenchShell(body,'records');bindWorkbench();$('#journalBack').onclick=renderJournalRegister;
    if($('#journalAction'))$('#journalAction').onclick=async()=>{
      try{await api(`/finance/journals/${id}/action`,{method:'POST',body:JSON.stringify({action:$('#journalAction').dataset.action})});
        toast('Journal updated');await openFinanceJournal(id);
      }catch(error){toast(error.message,'error');}
    };
    const request=type=>modal(`${type} ${h.journal_no}`,`<form id="financeChangeForm" class="operational-form">
      
      <label><span>Reason</span><textarea name="reason" minlength="8" required></textarea></label>
      <button class="command primary">Submit Request</button></form>`);
    if($('#journalReverse'))$('#journalReverse').onclick=()=>{request('Reverse');bindFinanceChange(id,'REVERSE');};
    if($('#journalVoid'))$('#journalVoid').onclick=()=>{request('Void');bindFinanceChange(id,'VOID');};
  }catch(error){showWorkspaceError(error);}
}
function bindFinanceChange(id,type){
  $('#financeChangeForm').onsubmit=async event=>{
    event.preventDefault();const body=formDataObject(event.currentTarget);body.actionType=type;
    try{const result=await api(`/finance/journals/${id}/change-request`,{method:'POST',body:JSON.stringify(body)});
      closeModal();toast(`${result.requestNo} sent for approval`);await openFinanceJournal(id);
    }catch(error){toast(error.message,'error');}
  };
}

async function renderJournalApprovals(){
  content.innerHTML='<div class="workspace-loading">Loading finance approvals…</div>';
  try{
    const [submitted,approved,changes]=await Promise.all([
      api('/finance/journals?entity=E88&status=SUBMITTED'),api('/finance/journals?entity=E88&status=APPROVED'),
      api('/finance/change-requests?status=REQUESTED'),
    ]);
    const journalRows=[...submitted.rows,...approved.rows].map(row=>{
      const action=financeActionLabel(row.status);
      return `<tr><td><b>${esc(row.journal_no)}</b></td><td>${date(row.journal_date)}</td><td>${esc(row.description)}</td>
        <td class="num">${money(row.total_debit)}</td><td>${financeStatus(row.status)}</td>
        <td><button class="table-action" data-journal-work="${row.id}" data-action="${action?.[0]||''}">${esc(action?.[1]||'Open')}</button></td></tr>`;
    });
    const changeRows=changes.rows.map(row=>`<tr><td><b>${esc(row.request_no)}</b></td><td>${esc(row.target_no)}</td>
      <td>${esc(row.action_type)}</td><td>${esc(row.reason)}</td><td>${esc(row.requested_by)}</td>
      <td>${row.requested_by===state.session.user.email?'<small>Requester cannot approve</small>':
        `<button class="table-action" data-finance-decision="${row.id}" data-decision="APPROVE">Approve</button>
         <button class="table-action danger" data-finance-decision="${row.id}" data-decision="REJECT">Reject</button>`}</td></tr>`);
    const body=`<div class="workspace-kpis">${kpi('Submitted',submitted.rows.length)}${kpi('Approved to Post',approved.rows.length)}
      ${kpi('Change Requests',changes.rows.length)}</div>
      <section class="workspace-card"><header><h2>Journal Approval and Posting Worklist</h2></header>
        ${financeTable(['Journal','Date','Description','Amount','Status','Action'],journalRows)}</section>
      <section class="workspace-card"><header><h2>Void, Reversal and Period Requests</h2></header>
        ${financeTable(['Request','Target','Action','Reason','Requested By','Decision'],changeRows)}</section>`;
    content.innerHTML=workbenchShell(body,'approvals');bindWorkbench();
    $$('[data-journal-work]').forEach(button=>button.onclick=async()=>{
      if(!button.dataset.action)return openFinanceJournal(button.dataset.journalWork);
      try{await api(`/finance/journals/${button.dataset.journalWork}/action`,{method:'POST',
        body:JSON.stringify({action:button.dataset.action})});toast('Journal updated');await renderJournalApprovals();
      }catch(error){toast(error.message,'error');}
    });
    $$('[data-finance-decision]').forEach(button=>button.onclick=async()=>{
      try{await api(`/finance/change-requests/${button.dataset.financeDecision}/decision`,{method:'POST',
        body:JSON.stringify({decision:button.dataset.decision,notes:'Reviewed in Finance approval worklist'})});
        toast('Request decided');await renderJournalApprovals();
      }catch(error){toast(error.message,'error');}
    });
  }catch(error){showWorkspaceError(error);}
}

async function renderFinanceReports(){
  content.innerHTML='<div class="workspace-loading">Generating financial reports…</div>';
  try{
    const query=financeQuery();const [tb,fs,gl]=await Promise.all([
      api(`/finance/reports/trial-balance?${query}`),
      api(`/finance/reports/financial-statements?${query}`),
      api(`/finance/reports/general-ledger?${query}`),
    ]);
    const tbRows=tb.rows.filter(row=>Math.abs(Number(row.balance||0))>0.004).map(row=>`<tr><td><b>${esc(row.account_code)}</b></td>
      <td>${esc(row.account_name)}</td><td>${esc(row.account_type)}</td><td class="num">${money(row.debit)}</td>
      <td class="num">${money(row.credit)}</td><td class="num">${money(row.balance)}</td></tr>`);
    const body=`${financeFilters('<button class="command" onclick="window.print()">Print</button>')}
      <div class="workspace-kpis">${kpi('Revenue',money(fs.pnl.revenue))}${kpi('Gross Profit',money(fs.pnl.grossProfit))}
        ${kpi('Net Income',money(fs.pnl.netIncome))}${kpi('Assets',money(fs.balanceSheet.assets))}
        ${kpi('Balance Difference',money(fs.balanceSheet.difference))}</div>
      <div class="ramco-layout"><div class="ramco-main"><section class="workspace-card">
        <header><h2>Trial Balance</h2><span>${tb.balanced?'Balanced':'Out of balance'}</span></header>
        ${financeTable(['Account','Name','Type','Debit','Credit','Balance'],tbRows)}</section></div>
        <aside class="ramco-rail"><section><header>Profit and Loss</header><div class="definition-list">
          <div><b>Revenue</b><span>${money(fs.pnl.revenue)}</span></div><div><b>Cost of Sales</b><span>${money(fs.pnl.cogs)}</span></div>
          <div><b>Operating Expense</b><span>${money(fs.pnl.operatingExpenses)}</span></div><div><b>Net Income</b><span>${money(fs.pnl.netIncome)}</span></div>
        </div></section><section><header>Balance Sheet</header><div class="definition-list">
          <div><b>Assets</b><span>${money(fs.balanceSheet.assets)}</span></div><div><b>Liabilities</b><span>${money(fs.balanceSheet.liabilities)}</span></div>
          <div><b>Equity + Earnings</b><span>${money(fs.balanceSheet.equity+fs.balanceSheet.currentYearEarnings)}</span></div>
        </div></section></aside></div>
      <section class="workspace-card"><header><h2>General Ledger Detail</h2><span>${gl.rows.length} lines</span></header>
        ${financeTable(['Date','Journal','Account','Description','Department','Cost Center','Debit','Credit'],
          gl.rows.slice(0,500).map(row=>`<tr><td>${date(row.journal_date)}</td><td><b>${esc(row.journal_no)}</b></td>
          <td>${esc(row.account_code)} · ${esc(row.account_name)}</td><td>${esc(row.line_description)}</td>
          <td>${esc(row.department||'-')}</td><td>${esc(row.cost_center||'-')}</td>
          <td class="num">${money(row.debit)}</td><td class="num">${money(row.credit)}</td></tr>`))}</section>`;
    content.innerHTML=workbenchShell(body,'reports');bindWorkbench();bindFinanceFilters(renderFinanceReports);
  }catch(error){showWorkspaceError(error);}
}

async function renderAccountingSetup(){
  content.innerHTML='<div class="workspace-loading">Loading accounting setup…</div>';
  try{
    const [master,periods]=await Promise.all([api('/finance/master-data'),api(`/finance/periods?entity=E88&year=${new Date().getFullYear()}`)]);
    const accountRows=master.accounts.map(row=>`<tr><td><b>${esc(row.account_code)}</b></td><td>${esc(row.account_name)}</td>
      <td>${esc(row.account_type)}</td><td>${esc(row.control_type)}</td><td>${row.system_account?'System':'Manual'}</td><td>${financeStatus(row.active?'ACTIVE':'INACTIVE')}</td></tr>`);
    const periodRows=periods.rows.map(row=>`<tr><td><b>${esc(row.period_name)}</b></td><td>${date(row.start_date)}</td><td>${date(row.end_date)}</td>
      <td>${financeStatus(row.status)}</td><td>${row.status!=='CLOSED'?`<button class="table-action" data-close-period="${row.id}">Request Close</button>`:'Locked'}</td></tr>`);
    const body=`<div class="workspace-commandbar"><button class="command primary" id="newAccount">New Account</button>
      <button class="command" id="generatePeriods">Generate ${new Date().getFullYear()} Periods</button></div>
      <section class="workspace-card"><header><h2>Chart of Accounts</h2><span>${master.accounts.length} accounts</span></header>
        ${financeTable(['Code','Account Name','Type','Control','Posting','Status'],accountRows)}</section>
      <section class="workspace-card"><header><h2>Accounting Periods</h2></header>
        ${financeTable(['Period','Start','End','Status','Control'],periodRows)}</section>`;
    content.innerHTML=workbenchShell(body,'setup');bindWorkbench();
    $('#generatePeriods').onclick=async()=>{try{await api('/finance/periods/generate',{method:'POST',body:JSON.stringify({entityCode:'E88',year:new Date().getFullYear()})});
      toast('Accounting periods generated');await renderAccountingSetup();}catch(error){toast(error.message,'error');}};
    $$('[data-close-period]').forEach(button=>button.onclick=async()=>{const reason=prompt('Month-end close reason:','Month-end review completed');
      if(!reason)return;try{await api(`/finance/periods/${button.dataset.closePeriod}/close-request`,{method:'POST',body:JSON.stringify({reason})});
      toast('Period close sent for independent approval');}catch(error){toast(error.message,'error');}});
    $('#newAccount').onclick=()=>{modal('New Chart of Account',`<form id="accountForm" class="operational-form grid">
      <label><span>Account Code</span><input name="accountCode" required></label><label><span>Account Name</span><input name="accountName" required></label>
      <label><span>Account Type</span><select name="accountType"><option>ASSET</option><option>LIABILITY</option><option>EQUITY</option>
        <option>REVENUE</option><option>COGS</option><option>EXPENSE</option></select></label>
      <label><span>Control Type</span><select name="controlType"><option>NONE</option><option>BANK</option><option>AR</option><option>AP</option>
        <option>INVENTORY</option><option>FIXED_ASSET</option><option>TAX</option></select></label>
      <label><span>Cash Flow Group</span><select name="cashFlowGroup"><option>OPERATING</option><option>INVESTING</option><option>FINANCING</option></select></label>
      <button class="command primary">Create Account</button></form>`);
    $('#accountForm').onsubmit=async event=>{event.preventDefault();try{await api('/finance/accounts',{method:'POST',body:JSON.stringify(formDataObject(event.currentTarget))});
      closeModal();toast('Account created');await renderAccountingSetup();}catch(error){toast(error.message,'error');}};};
  }catch(error){showWorkspaceError(error);}
}

async function renderReceivablesPayables(section){
  if(section==='center')return renderFinanceCenter('Payables Work Summary','Supplier bills and controlled payments',true);
  if(section==='records')return renderSubledger();
  if(section==='approvals')return renderPaymentRequests();
  if(section==='reports')return renderAgingTax();
  return renderFinanceControlNotes('AP Controls',[
    ['Three-way match','Supplier bills should reference the approved PO and actual goods receipt.'],
    ['Payments','RFP follows requester, department approval, finance validation, final approval and payment.'],
  ]);
}

async function renderSubledger(){
  content.innerHTML='<div class="workspace-loading">Loading AR/AP subledgers…</div>';
  try{
    const [data,master,leases]=await Promise.all([api('/finance/subledger'),api('/finance/master-data'),api('/finance/lease-billing')]);
    const rows=data.rows.map(row=>`<tr><td><b>${esc(row.document_no)}</b></td><td>${date(row.document_date)}</td>
      <td>${esc(row.document_type.replaceAll('_',' '))}</td><td>${esc(row.partner_name)}</td>
      <td class="num">${money(row.gross_amount)}</td><td class="num">${money(row.open_balance)}</td>
      <td>${financeStatus(row.status)}</td><td>${row.status==='DRAFT'?`<button class="table-action" data-post-subledger="${row.id}" data-document-type="${esc(row.document_type)}">Prepare Journal</button>`:esc(row.journal_no||'-')}</td></tr>`);
    const body=`<div class="workspace-commandbar"><button class="command primary" id="newSubledger">New Supplier Bill / Payment</button>
      <span class="command-spacer"></span>
      <span class="workspace-mode">${data.rows.length} DOCUMENTS</span></div>
      <section class="workspace-card"><header><h2>AP Document Register</h2></header>
        ${financeTable(['Document','Date','Type','Supplier','Gross','Open','Status','Journal'],rows)}</section>`;
    content.innerHTML=workbenchShell(body,'records');bindWorkbench();
    $('#newSubledger').onclick=()=>openSubledgerForm(master);
    $$('[data-post-subledger]').forEach(button=>button.onclick=async()=>{
      const defaultAccount=button.dataset.documentType.includes('RECEIPT')||button.dataset.documentType.includes('PAYMENT')?'1010':
        button.dataset.documentType.includes('INVOICE')||button.dataset.documentType.includes('LEASE')?'4000':'6990';
      const accountCode=prompt('Expense, inventory, revenue or bank account code:',defaultAccount);
      if(!accountCode)return;try{await api(`/finance/subledger/${button.dataset.postSubledger}/post`,{method:'POST',body:JSON.stringify({accountCode,bankAccountCode:accountCode})});
      toast('Accounting journal prepared for approval');await renderSubledger();}catch(error){toast(error.message,'error');}});
  }catch(error){showWorkspaceError(error);}
}
function openSubledgerForm(master){
  modal('New AP Document',`<form id="subledgerForm" class="operational-form grid">
    <label><span>Type</span><select name="documentType"><option>SUPPLIER_BILL</option><option>SUPPLIER_PAYMENT</option></select></label>
    <label><span>Entity</span><select name="entityCode">${master.entities.map(x=>`<option>${esc(x.entity_code)}</option>`).join('')}</select></label>
    <label class="wide"><span>Supplier</span><select name="partnerId" required><option value="">Select…</option>
      ${master.partners.filter(x=>x.partner_type==='VENDOR').map(x=>`<option value="${x.id}">${esc(x.partner_code)} · ${esc(x.name)}</option>`).join('')}</select></label>
    <label><span>Document Date</span><input name="documentDate" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
    <label><span>Due Date</span><input name="dueDate" type="date"></label>
    <label><span>Gross Amount</span><input name="grossAmount" type="number" min="0" step="0.01" required></label>
    <label><span>VAT Amount</span><input name="taxAmount" type="number" min="0" step="0.01"></label>
    <label><span>Withholding</span><input name="withholdingAmount" type="number" min="0" step="0.01"></label>
    <label><span>Department</span><input name="department"></label><label><span>Cost Center</span><input name="costCenter"></label>
    <label><span>Business Line</span><select name="businessLine"><option value="">Select</option><option>SALE</option><option>LEASE</option>
      <option>ENERGY</option><option>AFTERSALES</option><option>SHARED_SERVICES</option></select></label>
    <button class="command primary">Save Document</button></form>`);
  $('#subledgerForm').onsubmit=async event=>{event.preventDefault();const body=formDataObject(event.currentTarget);
    body.netAmount=Number(body.grossAmount||0)-Number(body.taxAmount||0);
    try{await api('/finance/subledger',{method:'POST',body:JSON.stringify(body)});closeModal();toast('AR/AP document saved');await renderSubledger();}
    catch(error){toast(error.message,'error');}};
}
function openLeaseBillingForm(contracts){
  modal('Generate Lease Billing',`<form id="leaseBillingForm" class="operational-form grid">
    <label class="wide"><span>Lease Contract</span><select name="leaseContractId" required><option value="">Select…</option>
      ${contracts.map(x=>`<option value="${x.id}">${esc(x.lease_no)} · ${esc(x.customer_name)} · ${x.linked_units} units</option>`).join('')}</select></label>
    <label><span>Period Start</span><input name="periodStart" type="date" required></label>
    <label><span>Period End</span><input name="periodEnd" type="date" required></label>
    <label><span>Due Date</span><input name="dueDate" type="date"></label><button class="command primary">Generate Billing</button></form>`);
  $('#leaseBillingForm').onsubmit=async event=>{event.preventDefault();try{const result=await api('/finance/lease-billing/generate',
    {method:'POST',body:JSON.stringify(formDataObject(event.currentTarget))});closeModal();toast(`${result.documentNo} generated`);await renderSubledger();}
    catch(error){toast(error.message,'error');}};
}

async function renderPaymentRequests(){
  content.innerHTML='<div class="workspace-loading">Loading payment requests…</div>';
  try{
    const [data,master]=await Promise.all([api('/finance/payment-requests'),api('/finance/master-data')]);
    window.__rfpMancomMin=(data.mancomEnabled&&data.mancomMin)?Number(data.mancomMin):null;
    window.__rfpFinanceReview=data.financeReview!==false;
    const rows=data.rows.map(row=>{
      // MANCOM sits between Finance and the CEO, but only at or above the threshold.
      const needsMancom=Number(row.net_payable||0)>=rfpMancomMin();
      // Finance checks the request before the head of Finance approves it.
      const action=['DRAFT','RETURNED'].includes(row.status)?'SUBMIT':row.status==='SUBMITTED'?'DEPARTMENT_APPROVE':
        row.status==='DEPARTMENT_APPROVED'?(rfpFinanceReviewOn()?'FINANCE_REVIEW':'FINANCE_VALIDATE'):
          row.status==='FINANCE_REVIEWED'?'FINANCE_VALIDATE':
            row.status==='FINANCE_VALIDATED'?(needsMancom?'MANCOM_APPROVE':'FINAL_APPROVE'):
              row.status==='MANCOM_APPROVED'?'FINAL_APPROVE':
                row.status==='APPROVED'?'MARK_PAID':row.status==='PAYMENT_PREPARED'?'CONFIRM_PAID':'';
      return `<tr><td><b>${esc(row.request_no)}</b></td><td>${date(row.request_date)}</td><td>${esc(row.payee_name)}</td>
        <td>${esc(row.department)}</td><td>${esc(row.purchase_order_no||'-')}</td><td class="num">${money(row.net_payable)}</td>
        <td>${financeStatus(row.status)}</td><td><button class="table-action" data-print-rfp="${row.id}">Print RFP</button>${action?`<button class="table-action" data-rfp-action="${action}" data-rfp-id="${row.id}">${esc(rfpActionLabel(action))}</button>`:''}${!['PAID','REJECTED','CANCELLED','RETURNED','DRAFT'].includes(row.status)?`<button class="table-action" data-rfp-action="RETURN" data-rfp-id="${row.id}">Return</button>`:''}</td></tr>`;
    });
    const body=`<div class="workspace-commandbar"><button class="command primary" id="newRfp">New Request for Payment</button>
      <button class="command" id="openLiquidations">Cash Advance Liquidation</button>
      <span class="command-spacer"></span><span class="workspace-mode">CONTROLLED PAYMENT WORKFLOW</span></div>
      ${workflowStrip(['Requestor','Dept Head'].concat(rfpFinanceReviewOn()?['Finance Check']:[]).concat(['Head of Finance']).concat(rfpMancomOn()?['MANCOM (≥ '+money(rfpMancomMin())+')']:[]).concat(['CEO Approval','Instruct Bank (MNC)','Proof & Close']),2)}
      <section class="workspace-card"><header><h2>Request for Payment Worklist</h2><span>${data.rows.length} requests</span></header>
        ${financeTable(['RFP','Date','Payee','Department','PO','Net Payable','Status','Action'],rows)}</section>`;
    content.innerHTML=workbenchShell(body,'approvals');bindWorkbench();
    window.__rfpRows={};data.rows.forEach(function(x){window.__rfpRows[x.id]=x;});
    $$('[data-print-rfp]').forEach(function(b){b.onclick=function(){if(window.czPrintRfp)window.czPrintRfp(window.__rfpRows[b.dataset.printRfp]);};});
    $('#newRfp').onclick=()=>openRfpForm(data.purchaseOrders,master);
    if($('#openLiquidations'))$('#openLiquidations').onclick=renderLiquidations;
    $$('[data-rfp-action]').forEach(button=>button.onclick=()=>runRfpAction(button.dataset.rfpAction,button.dataset.rfpId,master));
  }catch(error){showWorkspaceError(error);}
}
async function submitRfpAction(id,body){
  try{await api(`/finance/payment-requests/${id}/action`,{method:'POST',body:JSON.stringify(body)});
    toast('Payment request updated');await renderPaymentRequests();}catch(error){toast(error.message,'error');}
}
function runRfpAction(action,id,master){
  // Every approval step is signed. Draw or type, same as the requestor.
  if(['SUBMIT','DEPARTMENT_APPROVE','FINANCE_REVIEW','FINANCE_VALIDATE','MANCOM_APPROVE'].includes(action)){
    const title={SUBMIT:'Submit request for payment',DEPARTMENT_APPROVE:'Department Head approval',
      FINANCE_REVIEW:'Finance check - documents and department approval',
      FINANCE_VALIDATE:'Head of Finance approval',
      MANCOM_APPROVE:'MANCOM approval (at or above '+money(rfpMancomMin())+')'}[action];
    modal(title,`<form id="rfpSignForm" class="operational-form grid">
      <div class="wide">${signatureField('rfpStep','Your signature')}</div>
      <label class="wide"><span>Remarks (optional)</span><input name="notes"></label>
      <div class="modal-actions wide"><button type="submit" class="command primary">${esc(rfpActionLabel(action))}</button>
        <button type="button" class="command" id="rfpSignCancel">Cancel</button></div>
    </form>`,'Your signature is stored on the document and printed on the form');
    const mb=$('#modalBody');
    const pad=bindSignatureField('rfpStep',mb);
    mb.querySelector('#rfpSignCancel').onclick=()=>closeModal();
    mb.querySelector('#rfpSignForm').onsubmit=event=>{
      event.preventDefault();
      const signed=pad.get();
      if(!signed)return toast('Draw or type your signature first.','error');
      const f=formDataObject(event.currentTarget);
      closeModal();
      submitRfpAction(id,{action,signature:signed.signature,signatureType:signed.signatureType,notes:f.notes});
    };
    return;
  }
  if(action==='RETURN'){
    // Reason dropdown plus remarks, as the live system does it. No signature is
    // required to return - only to approve.
    modal('Return this request for payment',`<form id="rfpReturnForm" class="operational-form grid">
      <label class="wide"><span>Reason for returning</span><select name="reasonCode" required>
        <option value="">Select a reason…</option>
        ${RFP_RETURN_REASONS.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select></label>
      <label class="wide"><span>Remarks</span><textarea name="remarks" required placeholder="Explain what needs to be corrected"></textarea></label>
      <div class="modal-actions wide"><button type="submit" class="command primary">Return request</button><button type="button" class="command" id="rfpReturnCancel">Cancel</button></div></form>`,
      'It goes back to the requestor to correct and resubmit. The requestor, department head and finance are all notified.');
    const mb=$('#modalBody');
    mb.querySelector('#rfpReturnCancel').onclick=()=>closeModal();
    mb.querySelector('#rfpReturnForm').onsubmit=event=>{event.preventDefault();
      const f=formDataObject(event.currentTarget);
      const reason=[f.reasonCode,f.remarks].filter(x=>String(x||'').trim()).join(' - ');
      if(!reason)return toast('Choose a reason and add your remarks.','error');
      closeModal();submitRfpAction(id,{action:'RETURN',reason:reason});};
    return;
  }
  if(action==='FINAL_APPROVE'){
    modal('Final Approval - Release for Payment',`<form id="rfpFinalForm" class="operational-form grid">
      <label class="wide"><span>Expense or inventory account code</span><input name="accountCode" value="6990" required></label>
      <div class="wide">${signatureField('rfpFinal','CEO signature')}</div>
      <div class="modal-actions wide"><button type="submit" class="command primary">Approve payment</button>
        <button type="button" class="command" id="rfpFinalCancel">Cancel</button></div></form>`);
    const mbF=$('#modalBody');
    const finalPad=bindSignatureField('rfpFinal',mbF);
    mbF.querySelector('#rfpFinalCancel').onclick=()=>closeModal();
    $('#rfpFinalForm').onsubmit=event=>{event.preventDefault();
      const signed=finalPad.get();
      if(!signed)return toast('Draw or type your signature first.','error');
      const f=formDataObject(event.currentTarget);closeModal();
      submitRfpAction(id,{action:action,accountCode:f.accountCode||'6990',signature:signed.signature,signatureType:signed.signatureType});};
    return;
  }
  if(action==='MARK_PAID'){
    const banks=(master&&master.bankAccounts)||[];if(!banks.length)return toast('Create a bank account first.','error');
    modal('Prepare Payment - Instruct Bank (MNC)',`<form id="rfpPayForm" class="operational-form grid">
      <label class="wide"><span>Disbursing bank / partner email (MNC)</span><input name="bankInstructionEmail" type="email" placeholder="treasury@bank.com"></label>
      <label class="wide"><span>Bank account</span><select name="bankAccountId">${banks.map(b=>`<option value="${b.id}">${esc(b.bank_name||b.account_name||b.bank_account_code||('Bank '+b.id))}</option>`).join('')}</select></label>
      <label class="wide"><span>Bank payment reference</span><input name="paymentReference" required placeholder="e.g. BT-2026-0102"></label>
      
      <button class="command primary">Prepare payment</button></form>`);
    $('#rfpPayForm').onsubmit=event=>{event.preventDefault();const f=formDataObject(event.currentTarget);if(!f.paymentReference)return;closeModal();submitRfpAction(id,{action:action,bankAccountId:f.bankAccountId||banks[0].id,paymentReference:f.paymentReference,bankInstructionEmail:f.bankInstructionEmail});};
    return;
  }
  if(action==='CONFIRM_PAID'){
    modal('Confirm Payment - Attach Proof',`<form id="rfpProofForm" class="operational-form grid">
      <label class="wide"><span>Proof of payment reference / link</span><input name="proofReference" required placeholder="Bank receipt no. or document URL"></label>
      <label class="wide"><span>Attach proof of payment</span><input id="rfpProofFile" type="file" multiple accept=".pdf,.png,.jpg,.jpeg"></label>
      
      <button class="command primary">Confirm payment</button></form>`);
    $('#rfpProofForm').onsubmit=async event=>{event.preventDefault();const f=formDataObject(event.currentTarget);if(!f.proofReference)return;
      const input=$('#rfpProofFile');
      const files=input&&input.files?[...input.files]:[];
      const attachments=await Promise.all(files.slice(0,5).map(file=>new Promise(resolve=>{
        const reader=new FileReader();
        reader.onload=()=>resolve({fileName:file.name,contentType:file.type||'',size:file.size,data:String(reader.result||'').split(',')[1]||''});
        reader.onerror=()=>resolve(null);reader.readAsDataURL(file);})));
      closeModal();submitRfpAction(id,{action:action,proofReference:f.proofReference,attachments:attachments.filter(Boolean)});};
    return;
  }
  submitRfpAction(id,{action:action});
}
function rfpActionLabel(a){return ({SUBMIT:'Submit',DEPARTMENT_APPROVE:'Dept Head Approve',FINANCE_REVIEW:'Finance Check',FINANCE_VALIDATE:'Head of Finance Approve',MANCOM_APPROVE:'MANCOM Approve',FINAL_APPROVE:'CEO Approve',MARK_PAID:'Prepare Payment',CONFIRM_PAID:'Confirm & Attach Proof'})[a]||String(a).replaceAll('_',' ');}
// The MANCOM tier is switched off for E88: high-value spend is agreed in the
// MANCOM meeting before it is recorded here. The server tells us
// (mancomEnabled/mancomMin); Infinity means the stage never applies.
function rfpMancomMin(){return window.__rfpMancomMin==null?Infinity:Number(window.__rfpMancomMin);}
function rfpMancomOn(){return isFinite(rfpMancomMin());}
function rfpFinanceReviewOn(){return window.__rfpFinanceReview!==false;}
// The reasons the live system offers when an approver sends a request back.
const RFP_RETURN_REASONS=['Incomplete supporting documents','Incorrect amount or computation',
  'Wrong payee or bank details','Missing quotation or purchase order','Not within approved budget',
  'Requires further justification','Duplicate request','Other'];

/* ===================================================================
 * Reusable e-signature field: Draw on a pad, or Type in a signature font.
 * Used by the RFP form and every RFP approval step. Returns a PNG data URL
 * for DRAW and the typed name for TYPE, so the printed document can render
 * whichever the signer chose.
 * =================================================================== */
function signatureField(prefix,label){
  return `<div class="sig-field" data-sig="${esc(prefix)}">
    <span class="sig-label">${esc(label||'Signature')}</span>
    <div class="sig-tabs">
      <button type="button" class="table-action active" id="${prefix}TabDraw">Draw</button>
      <button type="button" class="table-action" id="${prefix}TabType">Type</button>
    </div>
    <div id="${prefix}DrawWrap" class="sig-draw">
      <canvas id="${prefix}Pad" class="po-sigpad" width="460" height="150"></canvas>
      <button type="button" class="table-action" id="${prefix}ClearPad">Clear</button>
    </div>
    <div id="${prefix}TypeWrap" class="sig-type" style="display:none">
      <input id="${prefix}TypedName" class="sig-typed" placeholder="Type your full name">
    </div>
  </div>`;
}

function bindSignatureField(prefix,root){
  const q=id=>(root||document).querySelector('#'+prefix+id);
  let mode='DRAW',ink=false;
  const pad=q('Pad');
  if(pad){
    const ctx=pad.getContext('2d');
    ctx.lineWidth=2.2;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#12305f';
    let drawing=false;
    const pos=event=>{const r=pad.getBoundingClientRect();const t=event.touches?event.touches[0]:event;
      return [(t.clientX-r.left)*(pad.width/r.width),(t.clientY-r.top)*(pad.height/r.height)];};
    const down=event=>{event.preventDefault();drawing=true;const[x,y]=pos(event);ctx.beginPath();ctx.moveTo(x,y);};
    const move=event=>{if(!drawing)return;event.preventDefault();const[x,y]=pos(event);ctx.lineTo(x,y);ctx.stroke();ink=true;};
    const up=()=>{drawing=false;};
    pad.addEventListener('mousedown',down);pad.addEventListener('mousemove',move);window.addEventListener('mouseup',up);
    pad.addEventListener('touchstart',down,{passive:false});pad.addEventListener('touchmove',move,{passive:false});pad.addEventListener('touchend',up);
    const clear=q('ClearPad');
    if(clear)clear.onclick=()=>{ctx.clearRect(0,0,pad.width,pad.height);ink=false;};
  }
  const draw=q('TabDraw'),type=q('TabType'),drawWrap=q('DrawWrap'),typeWrap=q('TypeWrap');
  if(draw)draw.onclick=()=>{mode='DRAW';drawWrap.style.display='';typeWrap.style.display='none';draw.classList.add('active');type.classList.remove('active');};
  if(type)type.onclick=()=>{mode='TYPE';drawWrap.style.display='none';typeWrap.style.display='';type.classList.add('active');draw.classList.remove('active');};
  return {
    mode:()=>mode,
    get(){
      if(mode==='DRAW')return ink?{signature:pad.toDataURL('image/png'),signatureType:'DRAW'}:null;
      const name=(q('TypedName').value||'').trim();
      return name?{signature:name,signatureType:'TYPE'}:null;
    },
  };
}

function openRfpForm(purchaseOrders,master){
  modal('New Request for Payment',`<form id="rfpForm" class="operational-form grid">
    <label><span>Entity</span><select name="entityCode">${master.entities.map(x=>`<option>${esc(x.entity_code)}</option>`).join('')}</select></label>
    <label><span>Request Date</span><input name="requestDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label>
    <label class="wide"><span>Approved Purchase Order</span><select name="purchaseOrderId"><option value="">Non-PO request</option>
      ${purchaseOrders.map(x=>`<option value="${x.id}">${esc(x.purchase_order_no)} · ${esc(x.vendor_name)} · ${money(x.total_amount)}</option>`).join('')}</select></label>
    <label class="wide"><span>Payee</span><select name="payeePartnerId"><option value="">Use PO vendor</option>
      ${master.partners.filter(x=>x.partner_type==='VENDOR').map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
    <label><span>Requestor name</span><input name="requestorName" value="${esc((state.session&&state.session.user&&(state.session.user.displayName||state.session.user.email))||'')}"></label>
    <label><span>Requestor email</span><input name="requestorEmail" type="email" value="${esc((state.session&&state.session.user&&state.session.user.email)||'')}"></label>
    <label><span>Department</span><input name="department" required></label><label><span>Contact number</span><input name="contactNo"></label>
    <label><span>Cost Center</span><input name="costCenter"></label>
    <label><span>Request type</span><select name="requestType"><option>Payment to Vendor</option><option>Cash Advance</option><option>Reimbursement</option><option>Per Diem Request</option></select></label>
    <label><span>Payment type</span><select name="paymentType"><option>Full</option><option>Partial</option><option>Subscription</option></select></label>
    <label><span>Mode of payment</span><select name="modeOfPayment"><option>Bank Deposit/Transfer</option><option>Check</option><option>Online Payment</option><option>Credit Card</option></select></label>
    <label><span>Bank name</span><input name="bankName"></label>
    <label><span>Account name</span><input name="accountName"></label>
    <label><span>Account number</span><input name="accountNo"></label>
    <label><span>Payee TIN</span><input name="payeeTin"></label>
    <label><span>Payee contact</span><input name="payeeContact"></label>
    <label><span>GL account</span><input name="glAccount"></label>
    <label><span>Currency</span><select name="currency"><option>PHP</option><option>USD</option></select></label>
    <label><span>Supplier Invoice</span><input name="supplierInvoiceNo"></label><label><span>Invoice Date</span><input name="invoiceDate" type="date"></label>
    <label><span>Gross Amount</span><input name="grossAmount" type="number" step="0.01" required></label>
    <label><span>VAT Amount</span><input name="vatAmount" type="number" step="0.01"></label>
    <label><span>Withholding</span><input name="withholdingAmount" type="number" step="0.01"></label>
    <label><span>Due Date</span><input name="dueDate" type="date"></label>
    <label class="wide"><span>Purpose</span><textarea name="purpose" required></textarea></label>
    <label class="wide"><span>Additional remarks</span><input name="remarks"></label>
    <label class="wide"><span>Supporting documents (required)</span><input id="rfpDocs" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"></label>
    <div id="rfpDocList" class="po-doc-list wide"></div>
    <div class="wide">${signatureField('rfpSig','Your signature')}</div>
    <button class="command primary">Save RFP</button></form>`);
  const rfpFiles=[];
  const rfpRender=()=>{const host=$('#rfpDocList');if(!host)return;
    host.innerHTML=rfpFiles.length?rfpFiles.map((f,i)=>`<span class="po-doc-chip">${esc(f.name)} <button type="button" data-rfp-drop="${i}">&times;</button></span>`).join(''):'<span class="po-doc-empty">No file attached yet</span>';
    host.querySelectorAll('[data-rfp-drop]').forEach(b=>b.onclick=()=>{rfpFiles.splice(Number(b.dataset.rfpDrop),1);rfpRender();});};
  rfpRender();
  const rfpSig=bindSignatureField('rfpSig');
  if($('#rfpDocs'))$('#rfpDocs').onchange=event=>{[...event.target.files].forEach(f=>{if(f.size<=5*1024*1024&&rfpFiles.length<6)rfpFiles.push(f);});event.target.value='';rfpRender();};
  $('#rfpForm').onsubmit=async event=>{event.preventDefault();
    if(!rfpFiles.length){toast('Attach the supporting document before saving.','error');return;}
    const payload=formDataObject(event.currentTarget);
    payload.attachments=await Promise.all(rfpFiles.map(file=>new Promise(resolve=>{
      const reader=new FileReader();
      reader.onload=()=>resolve({fileName:file.name,contentType:file.type||'',size:file.size,data:String(reader.result||'').split(',')[1]||''});
      reader.onerror=()=>resolve({fileName:file.name,contentType:file.type||'',size:file.size,data:''});
      reader.readAsDataURL(file);})));
    const signed=rfpSig.get();
    if(!signed){toast('Draw or type your signature before saving.','error');return;}
    payload.requestorSignature=signed.signature;
    payload.signatureType=signed.signatureType;
    try{await api('/finance/payment-requests',{method:'POST',body:JSON.stringify(payload)});closeModal();toast('Payment request created');await renderPaymentRequests();}
    catch(error){toast(error.message,'error');}};
}


async function renderLiquidations(){
  content.innerHTML='<div class="workspace-loading">Loading cash advance liquidations...</div>';
  try{
    const [eligible,existing]=await Promise.all([
      api('/finance/liquidations/eligible'),
      api('/finance/liquidations'),
    ]);
    const eligRows=(eligible.rows||[]).map(row=>`<tr>
      <td><b>${esc(row.requestNo)}</b></td><td>${date(row.requestDate)}</td><td>${esc(row.purpose||'-')}</td>
      <td class="num">${money(row.amount)}</td><td>${statusBadge(row.status)}</td>
      <td>${row.liquidation?`<button class="table-action" data-open-liq="${row.liquidation.id}">Open ${esc(row.liquidation.liquidation_no)}</button>`
        :`<button class="table-action" data-start-liq="${row.id}">Start liquidation</button>`}</td></tr>`);
    const liqRows=(existing.rows||[]).map(row=>`<tr>
      <td><b>${esc(row.liquidation_no)}</b></td><td>${esc(row.request_no)}</td><td>${esc(row.requestor_email)}</td>
      <td class="num">${money(row.advance_amount)}</td><td class="num">${money(row.spent_amount)}</td>
      <td class="num">${money(row.variance)}</td><td>${statusBadge(row.status)}</td>
      <td><button class="table-action" data-open-liq="${row.id}">Open</button></td></tr>`);
    const body=`<div class="workspace-commandbar"><button class="command" id="liqBack">Back to Payables</button>
        <span class="command-spacer"></span><span class="workspace-mode">CASH ADVANCE LIQUIDATION</span></div>
      <section class="workspace-card"><header><h2>Your approved cash advances</h2><span>${(eligible.rows||[]).length} available</span></header>
        ${operationalTable(['RFP','Date','Purpose','Advance','RFP Status','Action'],eligRows,
          {emptyMessage:'You have no fully approved cash advance to liquidate. A liquidation only opens once the cash-advance RFP is fully approved.'})}</section>
      <section class="workspace-card"><header><h2>Liquidation register</h2><span>${(existing.rows||[]).length} records</span></header>
        ${operationalTable(['Liquidation','Cash advance','Requestor','Advance','Spent','Variance','Status','Action'],liqRows)}</section>`;
    content.innerHTML=workbenchShell(body,'approvals');bindOperationalShell();
    $('#liqBack').onclick=renderPaymentRequests;
    $$('[data-start-liq]').forEach(b=>b.onclick=async()=>{
      try{const r=await api('/finance/liquidations',{method:'POST',body:JSON.stringify({paymentRequestId:Number(b.dataset.startLiq)})});
        toast('Liquidation '+(r.liquidationNo||'')+' opened');await openLiquidation(r.id);}
      catch(err){toast(err.message,'error');}});
    $$('[data-open-liq]').forEach(b=>b.onclick=()=>openLiquidation(Number(b.dataset.openLiq)));
  }catch(error){showWorkspaceError(error);}
}

async function openLiquidation(id){
  try{
    const data=await api('/finance/liquidations/'+id);
    const header=data.header;const items=data.items||[];
    const editable=header.status==='DRAFT';
    const lineHtml=item=>`<div class="line-editor-row liq-line">
      <input data-liq="expenseDate" type="date" value="${esc((item&&item.expense_date||'').slice(0,10))}" ${editable?'':'disabled'}>
      <input data-liq="particulars" placeholder="Particulars" value="${esc(item&&item.particulars||'')}" ${editable?'':'disabled'}>
      <input data-liq="amount" type="number" min="0" step="0.01" placeholder="Amount" value="${esc(item&&item.amount||'')}" ${editable?'':'disabled'}>
      <input data-liq="receiptNo" placeholder="Receipt no." value="${esc(item&&item.receipt_no||'')}" ${editable?'':'disabled'}>
      ${editable?'<button type="button" class="remove-line">&times;</button>':''}</div>`;
    modal('Liquidation '+esc(header.liquidation_no),
      `<div class="operational-form">
        <div class="workspace-kpis">${kpi('Cash advance',money(header.advance_amount))}${kpi('Total spent',money(header.spent_amount))}${kpi('Variance',money(header.variance))}${kpi('Status',header.status)}</div>
        <div class="line-editor-head"><b>Expenses (one line per receipt)</b>${editable?'<button type="button" id="liqAddLine">Add line</button>':''}</div>
        <div id="liqLines" class="line-editor">${(items.length?items:(editable?[null]:[])).map(lineHtml).join('')}</div>
        ${editable?'<label class="wide"><span>Attach receipts</span><input id="liqFiles" type="file" multiple accept=".pdf,.png,.jpg,.jpeg"></label>':''}
        ${(data.attachments||[]).length?'<p style="font-size:12px"><b>Receipts on file:</b> '+data.attachments.map(a=>a.file_url?`<a href="${esc(a.file_url)}" target="_blank" rel="noopener">${esc(a.file_name)}</a>`:esc(a.file_name)).join(', ')+'</p>':''}
        <div class="modal-actions">
          ${editable?'<button type="button" class="command" id="liqSave">Save lines</button><button type="button" class="command primary" id="liqSubmit">Submit to Finance</button>':''}
          ${(!editable&&header.status==='SUBMITTED'&&can('FINANCE','APPROVE'))?'<button type="button" class="command primary" id="liqApprove">Approve</button><button type="button" class="command" id="liqReject">Return</button>':''}
          <button type="button" class="command" id="liqClose">Close</button>
        </div>
      </div>`, 'Cash advance '+esc(header.request_no));
    const mb=$('#modalBody');
    bindKpiCards();
    const wire=row=>{const rm=row.querySelector('.remove-line');if(rm)rm.onclick=()=>row.remove();};
    mb.querySelectorAll('.liq-line').forEach(wire);
    if(mb.querySelector('#liqAddLine'))mb.querySelector('#liqAddLine').onclick=()=>{
      const wrap=document.createElement('div');wrap.innerHTML=lineHtml(null);
      const row=wrap.firstElementChild;wire(row);mb.querySelector('#liqLines').append(row);};
    const collect=()=>[...mb.querySelectorAll('.liq-line')].map(row=>({
      expenseDate:row.querySelector('[data-liq="expenseDate"]').value,
      particulars:row.querySelector('[data-liq="particulars"]').value,
      amount:Number(row.querySelector('[data-liq="amount"]').value||0),
      receiptNo:row.querySelector('[data-liq="receiptNo"]').value,
    })).filter(x=>x.amount>0);
    const readFiles=async()=>{
      const input=mb.querySelector('#liqFiles');
      const files=input&&input.files?[...input.files]:[];
      return await Promise.all(files.slice(0,8).map(file=>new Promise(resolve=>{
        const reader=new FileReader();
        reader.onload=()=>resolve({fileName:file.name,contentType:file.type||'',size:file.size,data:String(reader.result||'').split(',')[1]||''});
        reader.onerror=()=>resolve(null);reader.readAsDataURL(file);})));
    };
    const save=async()=>{
      const lines=collect();
      if(!lines.length){toast('Add at least one expense line','error');return null;}
      const attachments=(await readFiles()).filter(Boolean);
      return await api('/finance/liquidations/'+id+'/lines',{method:'POST',body:JSON.stringify({lines,attachments})});
    };
    if(mb.querySelector('#liqSave'))mb.querySelector('#liqSave').onclick=async()=>{
      try{const r=await save();if(!r)return;toast('Saved. Spent '+money(r.spent)+', variance '+money(r.variance));await openLiquidation(id);}
      catch(err){toast(err.message,'error');}};
    if(mb.querySelector('#liqSubmit'))mb.querySelector('#liqSubmit').onclick=async()=>{
      try{const r=await save();if(!r)return;
        await api('/finance/liquidations/'+id+'/submit',{method:'POST',body:'{}'});
        closeModal();toast('Liquidation submitted to Finance');await renderLiquidations();}
      catch(err){toast(err.message,'error');}};
    if(mb.querySelector('#liqApprove'))mb.querySelector('#liqApprove').onclick=async()=>{
      try{await api('/finance/liquidations/'+id+'/review',{method:'POST',body:JSON.stringify({decision:'APPROVE'})});
        closeModal();toast('Liquidation approved');await renderLiquidations();}catch(err){toast(err.message,'error');}};
    if(mb.querySelector('#liqReject'))mb.querySelector('#liqReject').onclick=async()=>{
      const remarks=prompt('Reason for returning this liquidation:');
      if(remarks===null)return;
      try{await api('/finance/liquidations/'+id+'/review',{method:'POST',body:JSON.stringify({decision:'REJECT',remarks})});
        closeModal();toast('Liquidation returned');await renderLiquidations();}catch(err){toast(err.message,'error');}};
    mb.querySelector('#liqClose').onclick=()=>closeModal();
  }catch(error){toast(error.message,'error');}
}


/* ===================================================================
 * ATLAS class keys
 * Motorcycle = VIN / frame no. + motor no.
 * Battery    = barcode / DevID + IMEI / ICCID / SIM
 * Locker     = SN + IMSI
 * =================================================================== */
function atlasKeys(asset){
  const type=String(asset&&(asset.serial_type||asset.category)||'').toUpperCase();
  if(/MOTOR|MC|VEHICLE|FRAME|VIN/.test(type))
    return {classLabel:'Motorcycle',primaryLabel:'VIN / frame no.',secondaryLabel:'Motor no.'};
  if(/BAT|BATTERY|BARCODE|DEVID/.test(type))
    return {classLabel:'Battery',primaryLabel:'Barcode / DevID',secondaryLabel:'IMEI / ICCID / SIM'};
  if(/LOCK|BSS|STATION|SN/.test(type))
    return {classLabel:'Locker / Station',primaryLabel:'Serial no. (SN)',secondaryLabel:'IMSI'};
  return {classLabel:asset&&asset.category||'Unit',primaryLabel:'Serial no.',secondaryLabel:'Secondary serial'};
}

/* ===================================================================
 * Mobile receiving: scan on a phone, confirm, and it counts itself.
 * Keeps the camera open between units so a whole shipment can be walked
 * through without touching the screen apart from Confirm.
 * =================================================================== */
async function openMobileReceive(shipmentId,workbench,lookups){
  const openExpected=(workbench.expectedAssets||[]).filter(a=>!['RECEIVED','SUBSTITUTED','CANCELLED','SHORT_CLOSED'].includes(a.expected_status));
  modal('Mobile receiving · '+esc(workbench.header.shipment_no),
    `<div class="mobile-receive">
      <div class="mr-head">
        <label><span>Receiving location</span><select id="mrLocation"><option value="">Select location</option>
          ${lookups.locations.map(l=>`<option value="${l.id}" ${Number(l.id)===Number(state.inbound.locationId)?'selected':''}>${esc(l.code)} · ${esc(l.name)}</option>`).join('')}</select></label>
      </div>
      <div class="mr-counter"><b id="mrCount">${state.inbound.receiptLines.length}</b><span>of ${openExpected.length} expected</span></div>
      <div id="mrStatus" class="mr-status">Tap <b>Scan unit</b>, point the camera at the QR or barcode, then tap Confirm.</div>
      <input id="mrSerial" inputmode="text" autocomplete="off" placeholder="Or type / scan with a hardware scanner">
      <div class="mr-actions">
        <button type="button" class="command primary mr-big" id="mrScan">Scan unit</button>
        <button type="button" class="command mr-big" id="mrConfirm">Confirm</button>
      </div>
      <div id="mrList" class="mr-list"></div>
      <div class="modal-actions">
        <button type="button" class="command primary" id="mrPost">Post goods receipt</button>
        <button type="button" class="command" id="mrClose">Close</button>
      </div>
    </div>`,
    'Scan and confirm. Every confirmed unit is matched against the ATLAS manifest.');
  const mb=$('#modalBody');
  let pending='';
  const setStatus=(text,tone)=>{const el=mb.querySelector('#mrStatus');el.className='mr-status '+(tone||'');el.innerHTML=text;};
  const paint=()=>{
    mb.querySelector('#mrCount').textContent=state.inbound.receiptLines.length;
    mb.querySelector('#mrList').innerHTML=state.inbound.receiptLines.slice().reverse().slice(0,40)
      .map(l=>`<div class="mr-item ${l.acceptance==='MATCHED'?'good':'bad'}"><b>${esc(l.actualSerialNo)}</b><span>${esc(l.acceptance.replace(/_/g,' '))}</span></div>`).join('')
      ||'<div class="mr-empty">Nothing scanned yet</div>';
  };
  paint();
  const confirmSerial=async raw=>{
    const serial=serialFromQrPayload(raw||pending||mb.querySelector('#mrSerial').value);
    if(!serial){setStatus('Nothing to confirm. Scan a unit first.','bad');return;}
    try{
      const candidate=[...state.inbound.receiptLines,{actualSerialNo:serial,sourceMethod:'QR',qrPayload:raw||''}];
      const result=await api('/receiving/validate',{method:'POST',body:JSON.stringify({shipmentId,lines:candidate})});
      state.inbound.receiptLines=result.results;
      const last=result.results[result.results.length-1];
      setStatus(`<b>${esc(serial)}</b> · ${esc(String(last.acceptance).replace(/_/g,' '))}${last.message?' · '+esc(last.message):''}`,
        last.acceptance==='MATCHED'?'good':'bad');
      if(navigator.vibrate)navigator.vibrate(last.acceptance==='MATCHED'?40:[60,60,60]);
      pending='';mb.querySelector('#mrSerial').value='';
      paint();
    }catch(error){setStatus(esc(error.message),'bad');}
  };
  mb.querySelector('#mrScan').onclick=()=>scanQrWithCamera(value=>{
    pending=value;
    setStatus('Scanned <b>'+esc(serialFromQrPayload(value))+'</b>. Tap Confirm to count it.','');
    if(navigator.vibrate)navigator.vibrate(25);
    confirmSerial(value);
  });
  mb.querySelector('#mrConfirm').onclick=()=>confirmSerial('');
  mb.querySelector('#mrSerial').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();confirmSerial('');}};
  mb.querySelector('#mrClose').onclick=()=>{closeModal();renderGoodsReceipt(shipmentId);};
  mb.querySelector('#mrPost').onclick=async()=>{
    const locationId=Number(mb.querySelector('#mrLocation').value||state.inbound.locationId);
    if(!locationId){setStatus('Select the receiving location first.','bad');return;}
    if(!state.inbound.receiptLines.length){setStatus('Scan at least one unit.','bad');return;}
    try{
      const result=await api('/receiving',{method:'POST',body:JSON.stringify({shipmentId,locationId,
        documentRef:'MOBILE',notes:'Received on mobile',lines:state.inbound.receiptLines})});
      state.inbound.receiptLines=[];state.inbound.shipment=null;
      closeModal();toast(result.receiptNo+' posted');
      await renderGoodsReceipt();
      try{if(window.czPrintGRN&&result.receiptId)window.czPrintGRN(result.receiptId);}catch(e){}
    }catch(error){setStatus(esc(error.message),'bad');}
  };
}

/* ===================================================================
 * Service Management
 * =================================================================== */
async function renderServiceWorkspace(section){
  if(section==='setup')return renderServiceSetup();
  if(section==='records')return renderServiceJobs();
  if(section==='approvals')return renderServiceJobs('IN_PROGRESS');
  if(section==='reports')return renderServiceReports();
  return renderServiceOverview();
}

async function renderServiceOverview(){
  content.innerHTML='<div class="workspace-loading">Loading service control center...</div>';
  try{
    const [summary,jobs]=await Promise.all([api('/service/summary'),api('/service/jobs?size=25')]);
    const byStatus=Object.fromEntries((summary.byStatus||[]).map(r=>[r.status,r.n]));
    const rows=(jobs.rows||[]).map(serviceRow);
    const rev=summary.revenue||{};
    const tiles=vizTiles([
      {label:'Open jobs',value:(byStatus.DRAFT||0)+(byStatus.ESTIMATED||0)+(byStatus.IN_PROGRESS||0),
       tone:'warning',sub:'not yet completed',section:'records'},
      {label:'In progress',value:byStatus.IN_PROGRESS||0,tone:'serious',sub:'on the bench',section:'approvals'},
      {label:'Completed',value:byStatus.COMPLETED||0,tone:'good',sub:'work finished',section:'records'},
      {label:'Parts held',value:summary.partsReserved||0,sub:'reserved out of stock',section:'records'},
      {label:'Revenue',value:Number(rev.revenue||0),sub:'billed on service',section:'reports'}
    ]);
    // Where the work is sitting.
    const stages=[['DRAFT','Draft'],['ESTIMATED','Estimated'],['IN_PROGRESS','In progress'],
      ['COMPLETED','Completed'],['CLOSED','Closed'],['CANCELLED','Cancelled']];
    const pipeline=vizDonut(stages.map(([c,l])=>({label:l,value:Number(byStatus[c]||0)})),
      {title:'Job orders by stage',totalLabel:'Jobs',keyLabel:'Stage',valueLabel:'Jobs'});
    // Cost against what it was sold for. One scale, so the gap is honest.
    const economics=vizBars([
      {label:'Material',value:Number(rev.material||rev.parts_cost||0)},
      {label:'Labour',value:Number(rev.labor||rev.labour||0)},
      {label:'Revenue',value:Number(rev.revenue||0),color:VIZ.series[2]},
      {label:'Margin',value:Number(rev.margin||0),color:VIZ.status.good}
    ].filter(r=>r.value>0),{title:'Service economics',money:true,
      keyLabel:'Measure',valueLabel:'Amount',labelWidth:86});
    // The biggest jobs on the book, by what they will bill.
    const topJobs=vizBars((jobs.rows||[])
      .map(j=>({label:j.job_no,value:Number(j.final_price||j.estimated_price||0)}))
      .filter(r=>r.value>0).sort((a,b)=>b.value-a.value),
      {title:'Largest job orders',money:true,color:VIZ.series[1],
       keyLabel:'Job',valueLabel:'Price',limit:6,labelWidth:104});
    const body=`${workflowStrip(['Job Order','Assembly Card','Estimate & Markup','Completion','Excess Return'],0)}
      ${tiles}
      <div class="viz-grid">${pipeline}${economics}${topJobs}</div>
      <div class="ramco-layout"><div class="ramco-main">
        <section class="workspace-card"><header><div><h2>Service Job Orders</h2></div>
          <button class="ramco-primary" id="svcNew">New Job Order</button></header>
          ${operationalTable(['Job','Type','Customer','Unit Serial','Status','Est. Price','Final Price','Action'],rows,
            {emptyMessage:'No service jobs yet'})}</section>
      </div><aside class="ramco-rail"><section><header>Service Actions</header><div class="ramco-action-links">
        <button data-section-link="records">All Job Orders</button>
        <button data-section-link="approvals">Jobs In Progress</button>
        <button data-section-link="reports">Service Profitability</button>
        <button data-section-link="setup">Rates & Markup</button>
      </div></section></aside></div>`;
    content.innerHTML=workbenchShell(body,'center');bindOperationalShell();bindViz(content,section=>openSection(section));
    $('#svcNew').onclick=openServiceJobForm;
    bindServiceRows();
  }catch(error){showWorkspaceError(error);}
}

function serviceRow(row){
  return `<tr><td><b>${esc(row.job_no)}</b>${Number(row.attachment_count)?' <span class="chip-mini">'+row.attachment_count+' file(s)</span>':''}</td>
    <td>${esc(row.job_type)}</td><td>${esc(row.customer_name||'-')}</td><td>${esc(row.unit_serial_no||'-')}</td>
    <td>${statusBadge(row.status)}</td><td class="num">${money(row.estimated_price)}</td><td class="num">${money(row.final_price)}</td>
    <td><button class="table-action" data-svc-open="${row.id}">Open</button><button class="table-action" data-svc-print="${row.id}">Print JO</button></td></tr>`;
}

function bindServiceRows(){
  $$('[data-svc-open]').forEach(b=>b.onclick=()=>openServiceJob(Number(b.dataset.svcOpen)));
  $$('[data-svc-print]').forEach(b=>b.onclick=()=>printJobOrder(Number(b.dataset.svcPrint)));
}

async function renderServiceJobs(status=''){
  content.innerHTML='<div class="workspace-loading">Loading job orders...</div>';
  try{
    const data=await api('/service/jobs?size=250'+(status?'&status='+encodeURIComponent(status):''));
    const rows=(data.rows||[]).map(serviceRow);
    const body=`<div class="workspace-commandbar"><button class="command primary" id="svcNew">New Job Order</button>
        <span class="command-spacer"></span><span class="workspace-mode">${status?esc(status.replace(/_/g,' ')):'SERVICE JOB REGISTER'}</span></div>
      <section class="workspace-card"><header><h2>Job Orders</h2><span>${data.total} records</span></header>
        ${operationalTable(['Job','Type','Customer','Unit Serial','Status','Est. Price','Final Price','Action'],rows,
          {emptyMessage:'No service jobs yet'})}</section>`;
    content.innerHTML=workbenchShell(body,status?'approvals':'records');bindOperationalShell();
    $('#svcNew').onclick=openServiceJobForm;
    bindServiceRows();
  }catch(error){showWorkspaceError(error);}
}

async function renderServiceReports(){
  content.innerHTML='<div class="workspace-loading">Loading service profitability...</div>';
  try{
    const [summary,jobs]=await Promise.all([api('/service/summary'),api('/service/jobs?size=250')]);
    const closed=(jobs.rows||[]).filter(r=>['COMPLETED','CLOSED'].includes(r.status));
    const rows=closed.map(r=>`<tr><td><b>${esc(r.job_no)}</b></td><td>${esc(r.customer_name||'-')}</td>
      <td class="num">${money(r.final_material_cost)}</td><td class="num">${money(r.labor_cost)}</td>
      <td class="num">${money(r.overhead_cost)}</td><td class="num">${money(r.final_cost)}</td>
      <td class="num">${esc(r.markup_pct)}%</td><td class="num">${money(r.final_price)}</td>
      <td class="num">${money(r.gross_margin)}</td></tr>`);
    const body=`<div class="workspace-kpis">
        ${kpi('Revenue',money(summary.revenue&&summary.revenue.revenue))}
        ${kpi('Cost',money(summary.revenue&&summary.revenue.cost))}
        ${kpi('Gross Margin',money(summary.revenue&&summary.revenue.margin))}
        ${kpi('Jobs Billed',closed.length)}</div>
      <section class="workspace-card"><header><h2>Service Profitability</h2><span>${closed.length} completed jobs</span></header>
        ${operationalTable(['Job','Customer','Material','Labour','Overhead','Total Cost','Markup','Price','Margin'],rows)}</section>`;
    content.innerHTML=workbenchShell(body,'reports');bindOperationalShell();
  }catch(error){showWorkspaceError(error);}
}

function renderServiceSetup(){
  const body=`<section class="workspace-card"><header><h2>Service Rates</h2></header>
    <form id="svcRates" class="operational-form grid">
      <label><span>Default labour rate per hour</span><input name="SERVICE_LABOR_RATE" type="number" min="0" step="0.01"></label>
      <label><span>Default markup %</span><input name="SERVICE_DEFAULT_MARKUP" type="number" min="0" step="0.1"></label>
      <label><span>Overhead % of material + labour</span><input name="SERVICE_OVERHEAD_PCT" type="number" min="0" step="0.1"></label>
      <button class="command primary">Save rates</button>
    </form></section>`;
  content.innerHTML=workbenchShell(body,'setup');bindOperationalShell();
  api('/service/lookups').then(l=>{
    const f=$('#svcRates');if(!f)return;
    f.SERVICE_LABOR_RATE.value=l.laborRate;f.SERVICE_DEFAULT_MARKUP.value=l.defaultMarkup;f.SERVICE_OVERHEAD_PCT.value=l.overheadPct;
  }).catch(()=>{});
  $('#svcRates').onsubmit=async event=>{
    event.preventDefault();const f=formDataObject(event.currentTarget);
    try{await api('/service/settings',{method:'POST',body:JSON.stringify(f)});toast('Service rates saved');}
    catch(error){toast(error.message,'error');}
  };
}

async function openServiceJobForm(){
  const lookups=await api('/service/lookups');
  modal('New Job Order',`<form id="svcJobForm" class="operational-form grid">
    <label><span>Job type</span><select name="jobType"><option value="REPAIR">Repair</option><option value="PREVENTIVE">Preventive service</option>
      <option value="WARRANTY">Warranty</option><option value="ROADSIDE">Roadside assistance</option><option value="INSTALLATION">Installation</option></select></label>
    <label><span>Priority</span><select name="priority"><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label>
    <label class="wide"><span>Customer / holder</span><select name="customerId"><option value="">Walk-in</option>
      ${lookups.customers.map(x=>`<option value="${x.id}">${esc(x.partner_code)} · ${esc(x.name)}</option>`).join('')}</select></label>
    <label><span>Contact person</span><input name="contactPerson"></label>
    <label><span>Contact number</span><input name="contactNumber"></label>
    <label class="wide"><span>Unit under service (serial)</span><div class="pick-with-add">
      <input name="unitSerialNo" id="svcUnitSerial" placeholder="Scan or type the unit serial" list="svcUnits">
      <button type="button" class="table-action" id="svcScanUnit">Scan QR</button></div>
      <datalist id="svcUnits">${lookups.units.slice(0,1200).map(u=>`<option value="${esc(u.serial_no)}">${esc(u.item_name||'')}</option>`).join('')}</datalist></label>
    <label><span>Odometer / usage</span><input name="odometer"></label>
    <label><span>Promised date</span><input name="promisedDate" type="date"></label>
    <label class="wide"><span>Complaint / work requested</span><textarea name="complaint" required></textarea></label>
    <label class="wide"><span>Initial diagnosis</span><textarea name="diagnosis"></textarea></label>
    <label><span>Markup %</span><input name="markupPct" type="number" min="0" step="0.1" value="${esc(lookups.defaultMarkup)}"></label>
    <label class="wide"><span>Attach photos / documents</span><input id="svcFiles" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.mp4"></label>
    <div class="modal-actions wide"><button type="submit" class="command primary">Create job order</button>
      <button type="button" class="command" id="svcCancel">Cancel</button></div>
  </form>`);
  const mb=$('#modalBody');
  mb.querySelector('#svcCancel').onclick=()=>closeModal();
  mb.querySelector('#svcScanUnit').onclick=()=>scanQrWithCamera(v=>{mb.querySelector('#svcUnitSerial').value=serialFromQrPayload(v);});
  mb.querySelector('#svcJobForm').onsubmit=async event=>{
    event.preventDefault();
    const payload=formDataObject(event.currentTarget);
    payload.markupPct=Number(payload.markupPct||0);
    const input=mb.querySelector('#svcFiles');
    const files=input&&input.files?[...input.files]:[];
    payload.attachments=(await Promise.all(files.slice(0,8).map(file=>new Promise(resolve=>{
      const reader=new FileReader();
      reader.onload=()=>resolve({fileName:file.name,contentType:file.type||'',size:file.size,data:String(reader.result||'').split(',')[1]||''});
      reader.onerror=()=>resolve(null);reader.readAsDataURL(file);})))).filter(Boolean);
    try{const r=await api('/service/jobs',{method:'POST',body:JSON.stringify(payload)});
      closeModal();toast('Job order '+r.jobNo+' created');await openServiceJob(r.id);}
    catch(error){toast(error.message,'error');}
  };
}

async function openServiceJob(id){
  try{
    const [data,lookups]=await Promise.all([api('/service/jobs/'+id),api('/service/lookups')]);
    const h=data.header;const parts=data.parts||[];const labor=data.labor||[];
    const editable=!['CLOSED','CANCELLED'].includes(h.status);
    const reserved=parts.filter(p=>p.state==='RESERVED');
    const partRows=parts.map(p=>`<tr><td>${esc(p.item_code||'-')}</td><td>${esc(p.item_name||'-')}</td>
      <td>${esc(p.serial_no||'-')}</td><td class="num">${esc(p.qty)}</td><td class="num">${money(p.unit_cost)}</td>
      <td class="num">${money(p.line_cost)}</td><td>${statusBadge(p.state)}</td>
      <td>${(editable&&p.state==='RESERVED')?`<button class="table-action" data-svc-drop-part="${p.id}">Remove</button>`:'-'}</td></tr>`);
    const laborRows=labor.map(l=>`<tr><td>${esc(l.description||'-')}</td><td>${esc(l.technician||'-')}</td>
      <td class="num">${esc(l.hours)}</td><td class="num">${money(l.rate)}</td><td class="num">${money(l.amount)}</td></tr>`);
    const returnRows=(data.returns||[]).map(r=>`<tr><td><b>${esc(r.return_no)}</b></td><td>${esc(r.serial_no||r.item_code||'-')}</td>
      <td class="num">${esc(r.qty)}</td><td>${esc(r.condition_code)}</td><td>${esc(r.returned_by||'-')}</td><td>${date(r.returned_at)}</td></tr>`);

    modal('Job Order '+esc(h.job_no),
      `<div class="operational-form svc-job">
        <div class="workspace-kpis">
          ${kpi('Status',h.status)}${kpi('Material',money(h.material_cost))}${kpi('Labour',money(h.labor_cost))}
          ${kpi('Overhead',money(h.overhead_cost))}${kpi('Cost',money(h.estimated_cost))}
          ${kpi('Markup',h.markup_pct+'%')}${kpi('Price / Revenue',money(h.estimated_price))}
          ${['COMPLETED','CLOSED'].includes(h.status)?kpi('Final price',money(h.final_price))+kpi('Margin',money(h.gross_margin)):''}</div>

        <div class="record-fields">
          <label class="record-field"><span>Customer</span><input value="${esc(h.customer_name||'Walk-in')}" readonly></label>
          <label class="record-field"><span>Unit serial</span><input value="${esc(h.unit_serial_no||'-')}" readonly></label>
          <label class="record-field"><span>Complaint</span><input value="${esc(h.complaint||'')}" readonly></label>
          <label class="record-field"><span>Diagnosis</span><input id="svcDiagnosis" value="${esc(h.diagnosis||'')}" ${editable?'':'readonly'}></label>
          <label class="record-field"><span>Work performed</span><input id="svcWork" value="${esc(h.work_performed||'')}" ${editable?'':'readonly'}></label>
          <label class="record-field"><span>Markup %</span><input id="svcMarkup" type="number" min="0" step="0.1" value="${esc(h.markup_pct)}" ${editable?'':'readonly'}></label>
        </div>

        <div class="line-editor-head"><b>Assembly card - parts drawn from inventory</b>
          ${editable&&!['COMPLETED','CLOSED'].includes(h.status)?'<button type="button" id="svcAddPart">Add part</button>':''}</div>
        ${operationalTable(['Item','Description','Serial','Qty','Unit cost','Line cost','State','Action'],partRows,
          {key:'svc-parts',emptyMessage:'No parts drawn yet. A part picked here leaves inventory immediately.'})}

        <div class="line-editor-head" style="margin-top:10px"><b>Labour</b>${editable?'<button type="button" id="svcAddLabor">Edit labour</button>':''}</div>
        ${operationalTable(['Description','Technician','Hours','Rate','Amount'],laborRows,{key:'svc-labor',emptyMessage:'No labour recorded'})}

        ${returnRows.length?'<div class="line-editor-head" style="margin-top:10px"><b>Parts returned to inventory</b></div>'
          +operationalTable(['Return','Part','Qty','Condition','By','Date'],returnRows,{key:'svc-returns'}):''}

        ${(data.attachments||[]).length?'<p style="font-size:12px;margin-top:10px"><b>Files:</b> '
          +data.attachments.map(a=>a.file_url?`<a href="${esc(a.file_url)}" target="_blank" rel="noopener">${esc(a.file_name)}</a>`:esc(a.file_name)).join(', ')+'</p>':''}
        ${editable?'<label class="wide"><span>Attach more files</span><input id="svcMoreFiles" type="file" multiple></label>':''}

        <div class="modal-actions">
          ${editable?'<button type="button" class="command" id="svcSave">Save & reprice</button>':''}
          ${editable&&['DRAFT','ESTIMATED'].includes(h.status)?'<button type="button" class="command" id="svcApprove">Approve & start</button>':''}
          ${editable&&['IN_PROGRESS','ESTIMATED','DRAFT'].includes(h.status)?'<button type="button" class="command primary" id="svcComplete">Complete job</button>':''}
          ${reserved.length&&editable?`<button type="button" class="command" id="svcReturnParts">Return ${reserved.length} excess part(s)</button>`:''}
          ${h.status==='COMPLETED'?'<button type="button" class="command primary" id="svcClose">Close job</button>':''}
          <button type="button" class="command" id="svcPrint">Print Job Order</button>
          ${editable?'<button type="button" class="command" id="svcCancelJob">Cancel job</button>':''}
          <button type="button" class="command" id="svcDone">Close window</button>
        </div>
      </div>`, esc(h.job_type)+' · '+esc(h.customer_name||'Walk-in'));

    const mb=$('#modalBody');bindKpiCards();
    const refresh=()=>openServiceJob(id);

    if(mb.querySelector('#svcAddPart'))mb.querySelector('#svcAddPart').onclick=()=>openServicePartPicker(id,lookups,refresh);
    if(mb.querySelector('#svcAddLabor'))mb.querySelector('#svcAddLabor').onclick=()=>openServiceLabor(id,labor,lookups,refresh);
    $$('[data-svc-drop-part]').forEach(b=>b.onclick=async()=>{
      try{await api('/service/jobs/'+id+'/parts/'+b.dataset.svcDropPart,{method:'DELETE'});
        toast('Part returned to inventory');await refresh();}catch(err){toast(err.message,'error');}});

    if(mb.querySelector('#svcSave'))mb.querySelector('#svcSave').onclick=async()=>{
      const input=mb.querySelector('#svcMoreFiles');
      const files=input&&input.files?[...input.files]:[];
      const attachments=(await Promise.all(files.slice(0,8).map(file=>new Promise(resolve=>{
        const reader=new FileReader();
        reader.onload=()=>resolve({fileName:file.name,contentType:file.type||'',size:file.size,data:String(reader.result||'').split(',')[1]||''});
        reader.onerror=()=>resolve(null);reader.readAsDataURL(file);})))).filter(Boolean);
      try{
        await api('/service/jobs/'+id,{method:'PATCH',body:JSON.stringify({
          diagnosis:mb.querySelector('#svcDiagnosis').value,workPerformed:mb.querySelector('#svcWork').value,
          markupPct:Number(mb.querySelector('#svcMarkup').value||0),attachments})});
        await api('/service/jobs/'+id+'/estimate',{method:'POST',body:JSON.stringify({markupPct:Number(mb.querySelector('#svcMarkup').value||0)})});
        toast('Job repriced');await refresh();
      }catch(err){toast(err.message,'error');}};

    if(mb.querySelector('#svcApprove'))mb.querySelector('#svcApprove').onclick=async()=>{
      try{await api('/service/jobs/'+id+'/approve',{method:'POST',body:'{}'});toast('Job approved and in progress');await refresh();}
      catch(err){toast(err.message,'error');}};

    if(mb.querySelector('#svcComplete'))mb.querySelector('#svcComplete').onclick=()=>openServiceComplete(id,parts,refresh,mb.querySelector('#svcWork').value);
    if(mb.querySelector('#svcReturnParts'))mb.querySelector('#svcReturnParts').onclick=()=>openServiceReturn(id,reserved,lookups,refresh);
    if(mb.querySelector('#svcClose'))mb.querySelector('#svcClose').onclick=async()=>{
      try{await api('/service/jobs/'+id+'/close',{method:'POST',body:'{}'});closeModal();toast('Job closed');await renderServiceJobs();}
      catch(err){toast(err.message,'error');}};
    if(mb.querySelector('#svcCancelJob'))mb.querySelector('#svcCancelJob').onclick=async()=>{
      const reason=prompt('Reason for cancelling this job order:');
      if(reason===null)return;
      try{const r=await api('/service/jobs/'+id+'/cancel',{method:'POST',body:JSON.stringify({reason})});
        closeModal();toast('Job cancelled; '+r.restored+' part(s) returned to stock');await renderServiceJobs();}
      catch(err){toast(err.message,'error');}};
    mb.querySelector('#svcPrint').onclick=()=>printJobOrder(id);
    mb.querySelector('#svcDone').onclick=()=>{closeModal();renderServiceJobs();};
  }catch(error){toast(error.message,'error');}
}

function openServicePartPicker(jobId,lookups,done){
  const serialOptions=lookups.spareAssets.slice(0,2000).map(a=>`<option value="${esc(a.serial_no)}" data-cost="${esc(a.unit_cost||0)}">${esc(a.serial_no)} · ${esc(a.item_name||a.item_code)} · ${esc(a.current_location_code||'')}</option>`).join('');
  const itemOptions=lookups.items.map(i=>`<option value="${i.id}" data-cost="${esc(i.standard_cost||0)}" data-serialized="${i.serialized?1:0}">${esc(i.item_code)} · ${esc(i.item_name)}</option>`).join('');
  modal('Add part to the assembly card',`<form id="svcPartForm" class="operational-form grid">
    <label class="wide"><span>Serialised part from stock</span><div class="pick-with-add">
      <select id="svcPartSerial"><option value="">Not a serialised part</option>${serialOptions}</select>
      <button type="button" class="table-action" id="svcPartScan">Scan</button></div></label>
    <label class="wide"><span>Or a quantity item</span><select id="svcPartItem"><option value="">Select item</option>${itemOptions}</select></label>
    <label><span>Quantity</span><input id="svcPartQty" type="number" min="0.01" step="0.01" value="1"></label>
    <label><span>Unit cost</span><input id="svcPartCost" type="number" min="0" step="0.01" value="0"></label>
    <label class="wide"><span>Notes</span><input id="svcPartNotes"></label>
    <div class="modal-actions wide"><button type="submit" class="command primary">Add to job</button>
      <button type="button" class="command" id="svcPartCancel">Cancel</button></div>
  </form>`,'A serialised part leaves inventory the moment it is added');
  const mb=$('#modalBody');
  const serialSel=mb.querySelector('#svcPartSerial'),itemSel=mb.querySelector('#svcPartItem'),cost=mb.querySelector('#svcPartCost'),qty=mb.querySelector('#svcPartQty');
  serialSel.onchange=()=>{const o=serialSel.selectedOptions[0];if(o&&o.value){cost.value=o.dataset.cost||0;qty.value=1;qty.readOnly=true;itemSel.value='';}else qty.readOnly=false;};
  itemSel.onchange=()=>{const o=itemSel.selectedOptions[0];if(o&&o.value){cost.value=o.dataset.cost||0;serialSel.value='';qty.readOnly=false;}};
  mb.querySelector('#svcPartScan').onclick=()=>scanQrWithCamera(v=>{
    const serial=serialFromQrPayload(v);
    const match=[...serialSel.options].find(o=>o.value===serial);
    if(match){serialSel.value=serial;serialSel.onchange();toast('Part '+serial+' selected');}
    else toast('Serial '+serial+' is not available in stock','error');});
  mb.querySelector('#svcPartCancel').onclick=()=>closeModal();
  mb.querySelector('#svcPartForm').onsubmit=async event=>{
    event.preventDefault();
    const payload={serialNo:serialSel.value,itemId:itemSel.value?Number(itemSel.value):null,
      qty:Number(qty.value||1),unitCost:Number(cost.value||0),notes:mb.querySelector('#svcPartNotes').value};
    if(!payload.serialNo&&!payload.itemId)return toast('Pick a serialised part or an item.','error');
    try{await api('/service/jobs/'+jobId+'/parts',{method:'POST',body:JSON.stringify(payload)});
      closeModal();toast('Part added and removed from available stock');await done();}
    catch(err){toast(err.message,'error');}};
}

function openServiceLabor(jobId,existing,lookups,done){
  const line=l=>`<div class="line-editor-row svc-labor-line">
    <input data-l="description" placeholder="Task" value="${esc(l&&l.description||'')}">
    <input data-l="technician" placeholder="Technician" value="${esc(l&&l.technician||'')}">
    <input data-l="hours" type="number" min="0" step="0.25" placeholder="Hours" value="${esc(l&&l.hours||'')}">
    <input data-l="rate" type="number" min="0" step="0.01" placeholder="Rate" value="${esc((l&&l.rate)||lookups.laborRate)}">
    <button type="button" class="remove-line">&times;</button></div>`;
  modal('Labour on this job',`<div class="operational-form">
    <div class="line-editor-head"><b>Labour lines</b><button type="button" id="svcLaborAdd">Add line</button></div>
    <div id="svcLaborLines" class="line-editor">${(existing.length?existing:[null]).map(line).join('')}</div>
    <div class="modal-actions"><button type="button" class="command primary" id="svcLaborSave">Save labour</button>
      <button type="button" class="command" id="svcLaborCancel">Cancel</button></div></div>`);
  const mb=$('#modalBody');
  const wire=row=>{row.querySelector('.remove-line').onclick=()=>row.remove();};
  mb.querySelectorAll('.svc-labor-line').forEach(wire);
  mb.querySelector('#svcLaborAdd').onclick=()=>{const w=document.createElement('div');w.innerHTML=line(null);
    const row=w.firstElementChild;wire(row);mb.querySelector('#svcLaborLines').append(row);};
  mb.querySelector('#svcLaborCancel').onclick=()=>closeModal();
  mb.querySelector('#svcLaborSave').onclick=async()=>{
    const rows=[...mb.querySelectorAll('.svc-labor-line')].map(r=>({
      description:r.querySelector('[data-l="description"]').value,
      technician:r.querySelector('[data-l="technician"]').value,
      hours:Number(r.querySelector('[data-l="hours"]').value||0),
      rate:Number(r.querySelector('[data-l="rate"]').value||0)})).filter(x=>x.hours>0);
    try{await api('/service/jobs/'+jobId+'/labor',{method:'POST',body:JSON.stringify({labor:rows})});
      closeModal();toast('Labour saved');await done();}catch(err){toast(err.message,'error');}};
}

function openServiceComplete(jobId,parts,done,workPerformed){
  const reserved=parts.filter(p=>p.state==='RESERVED');
  modal('Complete job order',`<div class="operational-form">
    <label class="wide"><span>Work performed</span><textarea id="svcCompleteWork">${esc(workPerformed||'')}</textarea></label>
    <div class="line-editor-head"><b>Confirm what was actually used</b></div>
    <div id="svcUsedLines" class="line-editor">${reserved.map(p=>`<div class="line-editor-row svc-used-line" data-part="${p.id}">
      <span class="used-label">${esc(p.item_name||p.item_code||'Part')}${p.serial_no?' · '+esc(p.serial_no):''}</span>
      <input data-u="qtyUsed" type="number" min="0" step="0.01" value="${esc(p.qty)}" ${p.serial_no?'readonly':''}>
      <span class="used-of">of ${esc(p.qty)}</span></div>`).join('')||'<div class="workspace-empty"><b>No parts to confirm</b></div>'}</div>
    <div class="modal-actions"><button type="button" class="command primary" id="svcCompleteGo">Complete job</button>
      <button type="button" class="command" id="svcCompleteCancel">Cancel</button></div></div>`,
    'Anything not used stays reserved and can be returned to inventory');
  const mb=$('#modalBody');
  mb.querySelector('#svcCompleteCancel').onclick=()=>closeModal();
  mb.querySelector('#svcCompleteGo').onclick=async()=>{
    const used=[...mb.querySelectorAll('.svc-used-line')].map(r=>({partId:Number(r.dataset.part),
      qtyUsed:Number(r.querySelector('[data-u="qtyUsed"]').value||0)}));
    try{const r=await api('/service/jobs/'+jobId+'/complete',{method:'POST',
      body:JSON.stringify({workPerformed:mb.querySelector('#svcCompleteWork').value,used})});
      closeModal();
      toast('Job completed · final price '+money(r.totals&&r.totals.finalPrice));
      await done();}
    catch(err){toast(err.message,'error');}};
}

function openServiceReturn(jobId,reserved,lookups,done){
  modal('Return excess parts to inventory',`<div class="operational-form">
    <label class="wide"><span>Return to location</span><select id="svcRetLoc"><option value="">Keep current location</option>
      ${lookups.locations.map(l=>`<option value="${l.id}" data-code="${esc(l.code)}" data-name="${esc(l.name)}" data-type="${esc(l.location_type)}">${esc(l.code)} · ${esc(l.name)}</option>`).join('')}</select></label>
    <div class="line-editor-head"><b>Excess parts</b></div>
    <div id="svcRetLines" class="line-editor">${reserved.map(p=>`<div class="line-editor-row svc-ret-line" data-part="${p.id}">
      <label class="ret-pick"><input type="checkbox" data-r="pick" checked> ${esc(p.item_name||p.item_code||'Part')}${p.serial_no?' · '+esc(p.serial_no):''}</label>
      <input data-r="qty" type="number" min="0" step="0.01" value="${esc(Number(p.qty)-Number(p.qty_used||0))}" ${p.serial_no?'readonly':''}>
      <select data-r="condition"><option value="GOOD">Good - back to available</option><option value="DAMAGED">Damaged - quarantine</option></select>
    </div>`).join('')}</div>
    <div class="modal-actions"><button type="button" class="command primary" id="svcRetGo">Return to inventory</button>
      <button type="button" class="command" id="svcRetCancel">Cancel</button></div></div>`,
    'Returned units become available in the warehouse again');
  const mb=$('#modalBody');
  mb.querySelector('#svcRetCancel').onclick=()=>closeModal();
  mb.querySelector('#svcRetGo').onclick=async()=>{
    const loc=mb.querySelector('#svcRetLoc').selectedOptions[0];
    const returns=[...mb.querySelectorAll('.svc-ret-line')]
      .filter(r=>r.querySelector('[data-r="pick"]').checked)
      .map(r=>({partId:Number(r.dataset.part),qty:Number(r.querySelector('[data-r="qty"]').value||0),
        conditionCode:r.querySelector('[data-r="condition"]').value}));
    if(!returns.length)return toast('Select at least one part','error');
    try{const r=await api('/service/jobs/'+jobId+'/return-parts',{method:'POST',body:JSON.stringify({
        returns,locationId:loc&&loc.value?Number(loc.value):null,locationCode:loc?loc.dataset.code:'',
        locationName:loc?loc.dataset.name:'',locationType:loc?loc.dataset.type:''})});
      closeModal();toast(r.restored.length+' part(s) returned to inventory on '+r.returnNo);await done();}
    catch(err){toast(err.message,'error');}};
}

async function printJobOrder(id){
  try{
    const data=await api('/service/jobs/'+id);
    const h=data.header;
    const rows=(data.parts||[]).map((p,i)=>[String(i+1),p.item_code||'',p.item_name||'',p.serial_no||'',String(p.qty),money(p.unit_cost),money(p.line_cost)]);
    const laborRows=(data.labor||[]).map((l,i)=>[String(i+1),l.description||'',l.technician||'',String(l.hours),money(l.rate),money(l.amount)]);
    const w=window.open('','_blank','width=940,height=1000');
    if(!w)return toast('Allow pop-ups to print the Job Order.','error');
    const cell=v=>'<td>'+esc(v)+'</td>';
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Job Order ${esc(h.job_no)}</title><style>
      *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#17212b;padding:26px;max-width:900px;margin:0 auto}
      header{display:flex;align-items:center;gap:14px;border-bottom:3px solid #0a2239;padding-bottom:10px;margin-bottom:14px}
      header img{height:40px}h1{font-size:19px;margin:0;color:#0a2239;letter-spacing:1px}
      .meta{margin-left:auto;text-align:right;color:#667;font-size:11px}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #c2ceda;margin-bottom:12px}
      .grid div{padding:6px 9px;border-top:1px solid #e4eaf0}.grid b{color:#556;font-weight:600}
      h2{font-size:13px;margin:14px 0 6px;color:#0a2239}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #c2ceda;padding:6px 8px;text-align:left}
      th{background:#eef2f6}td.n,th.n{text-align:right}
      .totals{margin-top:12px;margin-left:auto;width:320px}
      .totals td{border:0;padding:3px 0}.totals tr.big td{border-top:2px solid #0a2239;padding-top:6px;font-weight:700;font-size:14px}
      .sign{display:grid;grid-template-columns:repeat(3,1fr);gap:26px;margin-top:48px}
      .sign div{border-top:1px solid #333;padding-top:6px;font-size:11px;color:#556;text-align:center}
      .bar{margin-top:20px}.bar button{padding:9px 18px;background:#0a2239;color:#fff;border:0;border-radius:4px;cursor:pointer}
      @media print{.bar{display:none}}</style></head><body>
      <header><img src="${location.origin}/logo-navy.png" alt="E88 Ventures Inc."><div><h1>JOB ORDER</h1>
        <div style="font-size:11px;color:#667">Blitz - ERP · Service Management</div></div>
        <div class="meta">${esc(h.job_no)}<br>${esc((h.created_at||'').slice(0,10))}<br>${esc(h.status)}</div></header>
      <div class="grid">
        <div><b>Customer:</b> ${esc(h.customer_name||'Walk-in')}</div><div><b>Contact:</b> ${esc(h.contact_person||'')} ${esc(h.contact_number||'')}</div>
        <div><b>Job type:</b> ${esc(h.job_type)}</div><div><b>Priority:</b> ${esc(h.priority||'NORMAL')}</div>
        <div><b>Unit serial:</b> ${esc(h.unit_serial_no||'-')}</div><div><b>Unit:</b> ${esc(h.unit_item_name||'-')}</div>
        <div><b>Odometer:</b> ${esc(h.odometer||'-')}</div><div><b>Promised:</b> ${esc(h.promised_date||'-')}</div>
        <div style="grid-column:1/-1"><b>Complaint:</b> ${esc(h.complaint||'')}</div>
        <div style="grid-column:1/-1"><b>Diagnosis:</b> ${esc(h.diagnosis||'')}</div>
        <div style="grid-column:1/-1"><b>Work performed:</b> ${esc(h.work_performed||'')}</div>
      </div>
      <h2>Parts (assembly card)</h2>
      <table><thead><tr><th>#</th><th>Item</th><th>Description</th><th>Serial</th><th class="n">Qty</th><th class="n">Unit cost</th><th class="n">Amount</th></tr></thead>
      <tbody>${rows.length?rows.map(r=>'<tr>'+r.map((v,i)=>i>=4?'<td class="n">'+esc(v)+'</td>':cell(v)).join('')+'</tr>').join(''):'<tr><td colspan="7">No parts</td></tr>'}</tbody></table>
      <h2>Labour</h2>
      <table><thead><tr><th>#</th><th>Task</th><th>Technician</th><th class="n">Hours</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead>
      <tbody>${laborRows.length?laborRows.map(r=>'<tr>'+r.map((v,i)=>i>=3?'<td class="n">'+esc(v)+'</td>':cell(v)).join('')+'</tr>').join(''):'<tr><td colspan="6">No labour recorded</td></tr>'}</tbody></table>
      <table class="totals">
        <tr><td>Material</td><td class="n" style="text-align:right">${money(h.material_cost)}</td></tr>
        <tr><td>Labour</td><td style="text-align:right">${money(h.labor_cost)}</td></tr>
        <tr><td>Overhead</td><td style="text-align:right">${money(h.overhead_cost)}</td></tr>
        <tr><td>Total cost</td><td style="text-align:right">${money(h.final_cost||h.estimated_cost)}</td></tr>
        <tr><td>Markup ${esc(h.markup_pct)}%</td><td style="text-align:right">${money((h.final_price||h.estimated_price)-(h.final_cost||h.estimated_cost))}</td></tr>
        <tr class="big"><td>Total payable</td><td style="text-align:right">${money(h.final_price||h.estimated_price)}</td></tr>
      </table>
      <div class="sign"><div>Prepared by / Date</div><div>Approved by / Date</div><div>Customer conforme / Date</div></div>
      <div class="bar"><button onclick="window.print()">Print this document</button></div>
      </body></html>`);
    w.document.close();
  }catch(error){toast(error.message,'error');}
}


/* ===================================================================
 * Mobile physical count: scan, it counts itself, variance is shown at once.
 * =================================================================== */
function openMobileCount(countId,data){
  modal('Mobile count · '+esc(data.header.count_no),
    `<div class="mobile-receive">
      <div class="mr-counter"><b id="mcCount">${data.summary.counted}</b><span>of ${data.summary.expected} expected</span></div>
      <div id="mcStatus" class="mr-status">Tap <b>Scan unit</b> and the count sheet updates itself.</div>
      <input id="mcSerial" inputmode="text" autocomplete="off" placeholder="Or type / scan with a hardware scanner">
      <details class="mr-newunit" id="mcNewWrap">
        <summary>Details for units not yet in the system</summary>
        
        <label><span>Item code</span><input id="mcItemCode" autocomplete="off" placeholder="e.g. MC-0001"></label>
        <label><span>Item / model name</span><input id="mcItemName" autocomplete="off"></label>
        <label><span>Class</span><select id="mcCategory">
          <option value="">Use the count sheet's class</option>
          <option value="MC">Motorcycle</option><option value="BAT">Battery</option>
          <option value="BSS">Locker / Station</option><option value="SP">Spare part</option>
          <option value="CHG">Charger</option><option value="OTH">Other</option></select></label>
        <label><span>Unit cost</span><input id="mcUnitCost" type="number" step="0.01" min="0" placeholder="0.00"></label>
        <label><span>Condition</span><select id="mcCondition">
          <option value="GOOD">Good</option><option value="DAMAGED">Damaged</option>
          <option value="FOR_REPAIR">For repair</option></select></label>
        <label><span>Motor / secondary no. <i>(this unit only)</i></span><input id="mcMotorNo" autocomplete="off"></label>
      </details>
      <div class="mr-actions">
        <button type="button" class="command primary mr-big" id="mcScan">Scan unit</button>
        <button type="button" class="command mr-big" id="mcAdd">Count</button>
      </div>
      <div id="mcList" class="mr-list"></div>
      <div class="modal-actions">
        <button type="button" class="command primary" id="mcSubmit">Submit count</button>
        <button type="button" class="command" id="mcClose">Close</button>
      </div>
    </div>`,'Every scan is checked against the frozen count sheet');
  const mb=$('#modalBody');
  const log=[];
  const setStatus=(t,tone)=>{const el=mb.querySelector('#mcStatus');el.className='mr-status '+(tone||'');el.innerHTML=t;};
  const paint=()=>{
    mb.querySelector('#mcList').innerHTML=log.slice().reverse().slice(0,40)
      .map(l=>`<div class="mr-item ${esc(l.tone||(l.variance?'bad':'good'))}"><b>${esc(l.serial)}</b><span>${esc(l.label||l.variance||'counted')}</span></div>`).join('')
      ||'<div class="mr-empty">Nothing counted yet</div>';
  };
  paint();
  const count=async raw=>{
    const serial=serialFromQrPayload(raw||mb.querySelector('#mcSerial').value);
    if(!serial){setStatus('Scan or type a serial.','bad');return;}
    try{
      const v=id=>{const el=mb.querySelector(id);return el?el.value.trim():'';};
      const result=await api(`/inventory/cycle-counts/${countId}/scan`,{method:'POST',
        body:JSON.stringify({serialNo:serial,qrPayload:raw||'',scanMethod:raw?'QR':'MANUAL',
          itemCode:v('#mcItemCode'),itemName:v('#mcItemName'),category:v('#mcCategory'),
          unitCost:v('#mcUnitCost'),conditionCode:v('#mcCondition'),motorNo:v('#mcMotorNo')})});
      const r=result.result||{};
      const variance=r.varianceType;
      // A unit the system has never seen is not an error during an opening
      // count - it is the whole point. Say so, and only warn when we had to
      // register it blind.
      const isNew=r.willRegister;
      const label=isNew?(r.needsItemDetail?'new unit · no item code':'new unit · will be registered')
        :(variance?String(variance).replace(/_/g,' '):'counted');
      log.push({serial,variance:(variance&&!isNew)?label:'',tone:isNew?(r.needsItemDetail?'warn':'new'):(variance?'bad':'good'),label});
      mb.querySelector('#mcCount').textContent=log.length+Number(data.summary.counted||0);
      setStatus(`<b>${esc(serial)}</b> · ${esc(label)}`,isNew?(r.needsItemDetail?'warn':'good'):(variance?'bad':'good'));
      if(navigator.vibrate)navigator.vibrate((variance&&!isNew)?[60,60,60]:40);
      // Nothing was set in the sticky panel and the system has never seen this
      // serial: ask what it is now, while the unit is still in hand.
      if(r.needsItemDetail&&r.lineId){
        // The identify dialog takes over the modal, so the panel is rebuilt
        // afterwards from fresh data rather than left behind an empty shell.
        await identifyCountedUnit(countId,{id:r.lineId,actual_serial_no:serial},
          {note:'This serial is not in the system yet. Identify it now, or set the model once in "Details for units not yet in the system" and keep scanning.'});
        try{
          const fresh=await api(`/inventory/cycle-counts/${countId}`,{noCache:true});
          closeModal();openMobileCount(countId,fresh);
        }catch(e){closeModal();}
        return;
      }
      mb.querySelector('#mcSerial').value='';
      // The motor number belongs to one unit; everything else is sticky.
      if(mb.querySelector('#mcMotorNo'))mb.querySelector('#mcMotorNo').value='';
      paint();
    }catch(error){setStatus(esc(error.message),'bad');}
  };
  mb.querySelector('#mcScan').onclick=()=>scanQrWithCamera(v=>count(v));
  mb.querySelector('#mcAdd').onclick=()=>count('');
  mb.querySelector('#mcSerial').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();count('');}};
  mb.querySelector('#mcClose').onclick=()=>{closeModal();renderPhysicalCount(countId);};
  mb.querySelector('#mcSubmit').onclick=async()=>{
    try{await api(`/inventory/cycle-counts/${countId}/submit`,{method:'POST',body:'{}'});
      closeModal();toast('Count submitted for approval');await renderPhysicalCount(countId);}
    catch(error){setStatus(esc(error.message),'bad');}
  };
}

/* ===================================================================
 * Goods-issue card: open a delivery and drive its movement from here.
 * =================================================================== */
async function openDeliveryCard(id,done){
  try{
    const data=await api('/deliveries/'+id);
    const h=data.header||data;
    const assets=data.assets||[];
    const rows=assets.map(a=>`<tr><td>${esc(a.item_name||a.item_code||'-')}</td><td>${esc(a.category||'-')}</td>
      <td><b>${esc(a.serial_no||'-')}</b></td><td>${statusBadge(a.current_status||'-')}</td></tr>`);
    modal('Delivery '+esc(h.delivery_no),
      `<div class="operational-form">
        <div class="workspace-kpis">${kpi('Status',h.status)}${kpi('Serials',assets.length)}
          ${kpi('Destination',h.destination||'-')}${kpi('Holder',h.recipient_name||'-')}</div>
        ${operationalTable(['Item','Class','Serial','Inventory status'],rows,{key:'dlv-assets'})}
        <div class="modal-actions">
          ${h.status==='PLANNED'||h.status==='READY'?'<button type="button" class="command primary" id="dlvRelease">Post goods issuance</button>':''}
          ${h.status==='RELEASED'?'<button type="button" class="command primary" id="dlvComplete">Confirm delivered</button>':''}
          <button type="button" class="command" id="dlvPrint">Print delivery note</button>
          <button type="button" class="command" id="dlvClose">Close</button>
        </div>
      </div>`,esc(h.requisition_no||h.sales_order_no||''));
    const mb=$('#modalBody');bindKpiCards();
    if(mb.querySelector('#dlvRelease'))mb.querySelector('#dlvRelease').onclick=async()=>{
      try{const r=await api('/deliveries/'+id+'/release',{method:'POST',body:JSON.stringify({releaseDate:new Date().toISOString()})});
        closeModal();toast(r.released+' serialized units issued');await done();}catch(err){toast(err.message,'error');}};
    if(mb.querySelector('#dlvComplete'))mb.querySelector('#dlvComplete').onclick=async()=>{
      try{await api('/deliveries/'+id+'/complete',{method:'POST',body:JSON.stringify({actualDeliveryDate:new Date().toISOString()})});
        closeModal();toast('Delivery confirmed');await done();}catch(err){toast(err.message,'error');}};
    mb.querySelector('#dlvPrint').onclick=()=>{try{if(window.czPrintDelivery)window.czPrintDelivery(id);}catch(e){}};
    mb.querySelector('#dlvClose').onclick=()=>closeModal();
  }catch(error){toast(error.message,'error');}
}

/* ===================================================================
 * Draft goods return: editable and voidable until it is posted.
 * =================================================================== */
async function openReturnDraft(id,lookups,done){
  try{
    const data=await api('/returns/'+id+'/detail');
    const h=data.header;const lines=data.lines||[];
    modal('Edit draft return '+esc(h.return_no),
      `<div class="operational-form grid">
        <label><span>Return date</span><input id="rdDate" type="date" value="${esc((h.return_date||'').slice(0,10))}"></label>
        <label><span>Return location</span><select id="rdLocation"><option value="">Keep current</option>
          ${(lookups.locations||[]).map(l=>`<option value="${esc(l.code)}" data-name="${esc(l.name)}" data-type="${esc(l.location_type)}">${esc(l.code)} · ${esc(l.name)}</option>`).join('')}</select></label>
        <label><span>Reason</span><select id="rdReason">${['CUSTOMER_RETURN','END_OF_LEASE','REPLACEMENT','EMPLOYEE_RETURN','DEMO_COMPLETE','REPAIR','OTHER']
          .map(r=>`<option ${r===h.reason_code?'selected':''}>${r}</option>`).join('')}</select></label>
        <label class="wide"><span>Notes</span><input id="rdNotes" value="${esc(h.notes||'')}"></label>
        <div class="wide line-editor-head"><b>Returned units</b></div>
        <div class="wide line-editor">${lines.map(l=>`<div class="line-editor-row rd-line" data-line="${l.id}">
          <span class="used-label">${esc(l.expected_serial||l.actual_serial||'-')}</span>
          <input data-rd="actualSerialNo" value="${esc(l.actual_serial||'')}" placeholder="Actual serial">
          <select data-rd="conditionCode">${['GOOD','DAMAGED','FOR_REPAIR','MISSING_PARTS']
            .map(cnd=>`<option ${cnd===l.condition_code?'selected':''}>${cnd}</option>`).join('')}</select>
          <input data-rd="notes" value="${esc(l.notes||'')}" placeholder="Line notes">
        </div>`).join('')||'<div class="workspace-empty"><b>No lines</b></div>'}</div>
        <div class="modal-actions wide">
          <button type="button" class="command primary" id="rdSave">Save draft</button>
          <button type="button" class="command" id="rdVoid">Void draft</button>
          <button type="button" class="command" id="rdCancel">Cancel</button>
        </div>
      </div>`,'A draft return can be corrected or voided; a posted return cannot');
    const mb=$('#modalBody');
    mb.querySelector('#rdCancel').onclick=()=>closeModal();
    mb.querySelector('#rdSave').onclick=async()=>{
      const loc=mb.querySelector('#rdLocation').selectedOptions[0];
      const payload={returnDate:mb.querySelector('#rdDate').value,
        returnLocationCode:loc&&loc.value?loc.value:'',returnLocationName:loc?loc.dataset.name:'',
        returnLocationType:loc?loc.dataset.type:'',reasonCode:mb.querySelector('#rdReason').value,
        notes:mb.querySelector('#rdNotes').value,
        lines:[...mb.querySelectorAll('.rd-line')].map(r=>({id:Number(r.dataset.line),
          actualSerialNo:r.querySelector('[data-rd="actualSerialNo"]').value,
          conditionCode:r.querySelector('[data-rd="conditionCode"]').value,
          notes:r.querySelector('[data-rd="notes"]').value}))};
      try{await api('/returns/'+id,{method:'PATCH',body:JSON.stringify(payload)});
        closeModal();toast('Draft return updated');await done();}catch(err){toast(err.message,'error');}};
    mb.querySelector('#rdVoid').onclick=async()=>{
      const reason=prompt('Reason for voiding this draft return:');
      if(reason===null)return;
      try{await api('/returns/'+id+'/void',{method:'POST',body:JSON.stringify({reason})});
        closeModal();toast('Draft return voided');await done();}catch(err){toast(err.message,'error');}};
  }catch(error){toast(error.message,'error');}
}

async function renderAgingTax(){
  content.innerHTML='<div class="workspace-loading">Preparing aging and tax reports…</div>';
  try{
    const [ar,ap,tax]=await Promise.all([api('/finance/aging/AR'),api('/finance/aging/AP'),api(`/finance/reports/tax-summary?${financeQuery()}`)]);
    const aging=(data)=>data.rows.map(row=>`<tr><td><b>${esc(row.document_no)}</b></td><td>${esc(row.partner_name)}</td>
      <td>${date(row.document_date)}</td><td>${date(row.due_date)}</td><td>${esc(row.aging_bucket)}</td><td class="num">${money(row.open_balance)}</td></tr>`);
    const body=`${financeFilters()}<div class="workspace-kpis">${kpi('Total AP',money(ap.totals.total))}${kpi('AP Over 90',money(ap.totals.OVER_90))}</div>
      <section class="workspace-card"><header><h2>Accounts Payable Aging</h2></header>
        ${financeTable(['Document','Supplier','Date','Due','Bucket','Open Balance'],aging(ap))}</section>
      <section class="workspace-card"><header><h2>VAT and Withholding Tax Control Accounts</h2></header>
        ${financeTable(['Account','Name','Debit','Credit','Net'],tax.rows.map(row=>`<tr><td><b>${esc(row.account_code)}</b></td>
          <td>${esc(row.account_name)}</td><td class="num">${money(row.debit)}</td><td class="num">${money(row.credit)}</td>
          <td class="num">${money(row.net)}</td></tr>`))}</section>`;
    content.innerHTML=workbenchShell(body,'reports');bindWorkbench();bindFinanceFilters(renderAgingTax);
  }catch(error){showWorkspaceError(error);}
}

async function renderFixedAssetsFinance(section){
  if(section==='center')return renderFinanceCenter('Fixed Asset Work Summary','Capitalization, depreciation and serial-level asset control');
  content.innerHTML='<div class="workspace-loading">Loading fixed assets…</div>';
  try{
    const data=await api('/finance/fixed-assets');
    if(section==='records'){
      const rows=data.rows.map(row=>`<tr><td><b>${esc(row.serial_no)}</b></td><td>${esc(row.item_name)}</td><td>${esc(row.asset_class)}</td>
        <td>${date(row.capitalization_date)}</td><td class="num">${money(row.acquisition_cost)}</td>
        <td class="num">${money(row.accumulated_depreciation)}</td><td class="num">${money(row.net_book_value)}</td>
        <td>${financeStatus(row.status)}</td></tr>`);
      const body=`<div class="workspace-commandbar"><button class="command primary" id="capitalizeAsset">Capitalize Inventory Asset</button>
        <span class="command-spacer"></span><span class="workspace-mode">${data.rows.length} FIXED ASSETS</span></div>
        <section class="workspace-card"><header><h2>Fixed Asset Register</h2></header>
          ${financeTable(['Serial','Asset','Class','Capitalized','Cost','Accumulated Depreciation','Net Book Value','Status'],rows)}</section>`;
      content.innerHTML=workbenchShell(body,'records');bindWorkbench();
      $('#capitalizeAsset').onclick=()=>openCapitalizeForm(data.candidates);
    }else if(section==='approvals'){
      const rows=data.runs.map(row=>`<tr><td><b>${esc(row.run_no)}</b></td><td>${esc(row.entity_code)}</td><td>${esc(row.period_name)}</td>
        <td>${date(row.run_date)}</td><td class="num">${money(row.total_depreciation)}</td><td>${financeStatus(row.status)}</td>
        <td>${row.status==='DRAFT'?`<button class="table-action" data-dep-approve="${row.id}">Approve</button>`:
          row.status==='APPROVED'?`<button class="table-action" data-dep-post="${row.id}">Post</button>`:esc(row.journal_no||'-')}</td></tr>`);
      const body=`<div class="workspace-commandbar"><button class="command primary" id="newDepRun">New Depreciation Run</button></div>
        <section class="workspace-card"><header><h2>Depreciation Runs</h2></header>
          ${financeTable(['Run','Entity','Period','Date','Depreciation','Status','Action'],rows)}</section>`;
      content.innerHTML=workbenchShell(body,'approvals');bindWorkbench();
      $('#newDepRun').onclick=()=>openDepreciationRun();
      $$('[data-dep-approve]').forEach(button=>button.onclick=()=>actDepreciation(button.dataset.depApprove,'approve'));
      $$('[data-dep-post]').forEach(button=>button.onclick=()=>actDepreciation(button.dataset.depPost,'post'));
    }else if(section==='reports'){
      const cost=data.rows.reduce((s,x)=>s+Number(x.acquisition_cost||0),0);const dep=data.rows.reduce((s,x)=>s+Number(x.accumulated_depreciation||0),0);
      const body=`<div class="workspace-kpis">${kpi('Asset Cost',money(cost))}${kpi('Accumulated Depreciation',money(dep))}
        ${kpi('Net Book Value',money(cost-dep))}${kpi('Capitalized Units',data.rows.length)}</div>
        <section class="workspace-card"><header><h2>Fixed Asset Summary by Class</h2></header>
          ${financeTable(['Class','Units','Cost','Depreciation','Net Book Value'],Object.values(data.rows.reduce((m,x)=>{
            const key=x.asset_class;m[key]||={key,count:0,cost:0,dep:0};m[key].count++;m[key].cost+=Number(x.acquisition_cost||0);m[key].dep+=Number(x.accumulated_depreciation||0);return m;
          },{})).map(x=>`<tr><td><b>${esc(x.key)}</b></td><td>${x.count}</td><td class="num">${money(x.cost)}</td>
            <td class="num">${money(x.dep)}</td><td class="num">${money(x.cost-x.dep)}</td></tr>`))}</section>`;
      content.innerHTML=workbenchShell(body,'reports');bindWorkbench();
    }else return renderFinanceControlNotes('Fixed Asset Setup',[
      ['Capitalization','Inventory serial is reused; no duplicate asset master is created.'],
      ['Depreciation','Straight-line monthly depreciation is limited to residual value.'],
      ['Disposal or reversal','Requires an approved finance change request and permanent audit trail.'],
    ]);
  }catch(error){showWorkspaceError(error);}
}
function openCapitalizeForm(candidates){
  modal('Capitalize Inventory Asset',`<form id="capitalizeForm" class="operational-form grid">
    <label class="wide"><span>Inventory Serial</span><select name="assetId" required><option value="">Select…</option>
      ${candidates.map(x=>`<option value="${x.id}">${esc(x.category)} · ${esc(x.serial_no)} · ${esc(x.item_name)} · ${money(x.unit_cost)}</option>`).join('')}</select></label>
    <label><span>Entity</span><select name="entityCode"><option>E88</option><option>NRD</option><option>RIDEBOX</option><option>SHARED</option></select></label>
    <label><span>Asset Class</span><select name="assetClass"><option>MOTORCYCLE</option><option>BATTERY</option><option>BSS</option><option>EQUIPMENT</option><option>IT</option></select></label>
    <label><span>Capitalization Date</span><input name="capitalizationDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label>
    <label><span>Acquisition Cost</span><input name="acquisitionCost" type="number" min="0" step="0.01"></label>
    <label><span>Residual Value</span><input name="residualValue" type="number" min="0" step="0.01"></label>
    <label><span>Useful Life (Months)</span><input name="usefulLifeMonths" type="number" min="1" value="36"></label>
    <button class="command primary">Capitalize Asset</button></form>`);
  $('#capitalizeForm').onsubmit=async event=>{event.preventDefault();try{await api('/finance/fixed-assets/capitalize',
    {method:'POST',body:JSON.stringify(formDataObject(event.currentTarget))});closeModal();toast('Asset capitalized');await renderFixedAssetsFinance('records');}
    catch(error){toast(error.message,'error');}};
}
function openDepreciationRun(){
  modal('New Depreciation Run',`<form id="depreciationForm" class="operational-form grid">
    <label><span>Entity</span><select name="entityCode"><option>E88</option><option>NRD</option><option>RIDEBOX</option><option>SHARED</option></select></label>
    <label><span>Run Date</span><input name="runDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label>
    <button class="command primary">Calculate Depreciation</button></form>`);
  $('#depreciationForm').onsubmit=async event=>{event.preventDefault();try{const result=await api('/finance/depreciation-runs',
    {method:'POST',body:JSON.stringify(formDataObject(event.currentTarget))});closeModal();toast(`${result.runNo} calculated`);await renderFixedAssetsFinance('approvals');}
    catch(error){toast(error.message,'error');}};
}
async function actDepreciation(id,action){
  try{await api(`/finance/depreciation-runs/${id}/${action}`,{method:'POST',body:'{}'});toast(`Depreciation ${action}d`);await renderFixedAssetsFinance('approvals');}
  catch(error){toast(error.message,'error');}
}

async function renderManagementAccounting(section){
  if(section==='center')return renderFinanceCenter('Management Accounting Work Summary','Operational source events, unit economics and budget control');
  if(section==='records'){
    content.innerHTML='<div class="workspace-loading">Loading operational accounting events…</div>';
    try{
      const data=await api('/finance/source-events');
      const rows=data.rows.map(row=>`<tr><td><b>${esc(row.source_no)}</b></td><td>${date(row.event_date)}</td><td>${esc(row.source_module)}</td>
        <td>${esc(row.event_type.replaceAll('_',' '))}</td><td class="num">${money(row.amount)}</td><td>${financeStatus(row.status)}</td>
        <td>${esc(row.journal_no||row.error_message||'-')}</td><td>${row.status==='ERROR'?
          `<button class="table-action" data-retry-event="${row.id}">Retry</button>`:'-'}</td></tr>`);
      const body=`<div class="workspace-commandbar"><button class="command primary" id="syncFinance">Synchronize Operational Transactions</button>
        <span class="command-spacer"></span><span class="workspace-mode">${data.rows.length} SOURCE EVENTS</span></div>
        <section class="workspace-card"><header><h2>Operational Source-to-Ledger Control</h2></header>
          ${financeTable(['Source','Date','Module','Event','Amount','Status','Journal / Error','Action'],rows)}</section>`;
      content.innerHTML=workbenchShell(body,'records');bindWorkbench();
      $('#syncFinance').onclick=async()=>{try{const result=await api('/finance/sync-operational',{method:'POST',body:'{}'});
        toast(`${result.captured} accounting events synchronized`);await renderManagementAccounting('records');}catch(error){toast(error.message,'error');}};
      $$('[data-retry-event]').forEach(button=>button.onclick=async()=>{try{
        await api(`/finance/source-events/${button.dataset.retryEvent}/retry`,{method:'POST',body:'{}'});
        toast('Source event reprocessed');await renderManagementAccounting('records');
      }catch(error){toast(error.message,'error');}});
    }catch(error){showWorkspaceError(error);}
  }else if(section==='approvals')return renderInventoryFinanceReconciliation();
  else if(section==='reports')return renderBudgetActual();
  else return renderFinanceControlNotes('Management Dimensions',[
    ['Entity','E88 Ventures, NRD Motorcycle, RideBox and Shared Services.'],
    ['Required dimensions','Department, cost center, business line, project/site, partner and source document.'],
    ['Source of truth','Posted operational transactions create journals; Finance validates and posts.'],
  ]);
}
async function renderInventoryFinanceReconciliation(){
  content.innerHTML='<div class="workspace-loading">Reconciling inventory and finance…</div>';
  try{
    const data=await api('/finance/reports/inventory-reconciliation');
    const rows=data.byCategory.map(row=>`<tr><td><b>${esc(row.class_name||row.category)}</b></td><td>${esc(row.account_code)}</td><td>${esc(row.cogs_account_code)}</td><td>${row.units}</td><td>${row.valued_units}</td><td>${row.unvalued_units}</td><td class="num">${money(row.subledger_value)}</td><td class="num">${money(row.gl_value)}</td><td class="num">${money(row.difference)}</td><td>${statusBadge(row.status)}</td></tr>`);
    const body=`<div class="workspace-kpis">${kpi('Inventory Subledger',money(data.summary.inventory_subledger))}
      ${kpi('Inventory General Ledger',money(data.summary.inventory_general_ledger))}
      ${kpi('Difference',money(data.summary.difference))}${kpi('Status',data.summary.reconciled?'RECONCILED':'REVIEW REQUIRED')}</div>
      <section class="workspace-card"><header><h2>Separate Inventory Control Accounts</h2></header>
        ${financeTable(['Inventory Class','Inventory GL','COGS GL','Units','Valued','Missing Cost','Subledger','General Ledger','Difference','Status'],rows)}</section>
      <section class="workspace-card"><header><h2>Inventory Finance Events</h2></header>
        ${financeTable(['Status','Event Type','Events','Amount'],data.sourceEvents.map(row=>`<tr><td>${financeStatus(row.status)}</td>
          <td>${esc(row.event_type)}</td><td>${row.events}</td><td class="num">${money(row.amount)}</td></tr>`))}</section>`;
    content.innerHTML=workbenchShell(body,'approvals');bindWorkbench();
  }catch(error){showWorkspaceError(error);}
}

async function renderBudgetActual(){
  content.innerHTML='<div class="workspace-loading">Loading budget versus actual…</div>';
  try{
    const data=await api(`/finance/reports/budget-actual?year=${new Date().getFullYear()}`);
    const rows=data.rows.map(row=>`<tr><td><b>${esc(row.department||'Unassigned')}</b></td><td>${esc(row.cost_center||'-')}</td>
      <td>${esc(row.account_title)}</td><td class="num">${money(row.budget_amount)}</td><td class="num">${money(row.actual_amount)}</td>
      <td class="num">${money(row.variance)}</td><td class="num">${money(row.utilizationPct)}%</td></tr>`);
    const body=`<div class="workspace-commandbar"><span class="workspace-mode">${data.year} BUDGET PERFORMANCE</span></div>
      <section class="workspace-card"><header><h2>Department Budget vs Actual</h2></header>
        ${financeTable(['Department','Cost Center','Account','Budget','Actual','Remaining / (Over)','Utilization'],rows)}</section>`;
    content.innerHTML=workbenchShell(body,'reports');bindWorkbench();
  }catch(error){showWorkspaceError(error);}
}

async function renderConsolidation(section){
  content.innerHTML='<div class="workspace-loading">Preparing entity and consolidated statements…</div>';
  try{
    if(section==='approvals')return renderJournalApprovals();
    if(section==='setup')return renderFinanceControlNotes('Consolidation Setup',[
      ['Entities','E88 Ventures, NRD Motorcycle, RideBox and Shared Services use one chart of accounts.'],
      ['Eliminations','Intercompany and shared-service eliminations use approved consolidation journals.'],
      ['Period close','Each entity closes independently before the consolidated close.'],
    ]);
    const entities=['E88','NRD','RIDEBOX','SHARED'];const reports=await Promise.all(entities.map(entity=>
      api(`/finance/reports/financial-statements?entity=${entity}&dateFrom=${new Date().getFullYear()}-01-01&dateTo=${new Date().toISOString().slice(0,10)}`)));
    const rows=reports.map((report,index)=>`<tr><td><b>${entities[index]}</b></td><td class="num">${money(report.pnl.revenue)}</td>
      <td class="num">${money(report.pnl.cogs)}</td><td class="num">${money(report.pnl.operatingExpenses)}</td>
      <td class="num">${money(report.pnl.netIncome)}</td><td class="num">${money(report.balanceSheet.assets)}</td>
      <td class="num">${money(report.balanceSheet.liabilities)}</td></tr>`);
    const totals=reports.reduce((out,r)=>{out.revenue+=r.pnl.revenue;out.cogs+=r.pnl.cogs;out.opex+=r.pnl.operatingExpenses;
      out.net+=r.pnl.netIncome;out.assets+=r.balanceSheet.assets;out.liabilities+=r.balanceSheet.liabilities;return out;},
      {revenue:0,cogs:0,opex:0,net:0,assets:0,liabilities:0});
    const body=`<div class="workspace-kpis">${kpi('Consolidated Revenue',money(totals.revenue))}
      ${kpi('Consolidated Gross Profit',money(totals.revenue-totals.cogs))}${kpi('Consolidated Net Income',money(totals.net))}
      ${kpi('Consolidated Assets',money(totals.assets))}</div>
      <section class="workspace-card"><header><h2>Entity Financial Statements</h2></header>
        ${financeTable(['Entity','Revenue','COGS','Operating Expense','Net Income','Assets','Liabilities'],rows)}</section>
      <section class="workspace-card"><header><h2>Consolidation Control</h2></header>
        </section>`;
    content.innerHTML=workbenchShell(body,section==='reports'?'reports':section==='records'?'records':'center');bindWorkbench();
  }catch(error){showWorkspaceError(error);}
}

async function renderTreasury(section){
  if(section==='center')return renderFinanceCenter('Treasury Work Summary','Cash position, bank activity, matching and reconciliation');
  content.innerHTML='<div class="workspace-loading">Loading treasury…</div>';
  try{
    const [banks,transactions,reconciliations]=await Promise.all([
      api('/finance/bank-accounts'),api('/finance/bank-transactions'),api('/finance/bank-reconciliations'),
    ]);
    if(section==='setup')return renderFinanceControlNotes('Treasury Setup',[
      ['Bank master','Each legal entity retains its own bank account and mapped GL control account.'],
      ['Statement import','Transactions are deduplicated by bank, date, reference, amount and direction.'],
      ['Reconciliation','Matching requires equal bank and journal amounts; differences remain visible.'],
    ]);
    const bankRows=banks.rows.map(row=>`<tr><td><b>${esc(row.bank_account_code)}</b></td><td>${esc(row.entity_code)}</td>
      <td>${esc(row.bank_name)}</td><td>${esc(row.account_name)}</td><td>${esc(row.account_number_masked||'-')}</td>
      <td class="num">${money(row.statement_balance)}</td><td>${row.unmatched}</td></tr>`);
    const txRows=transactions.rows.map(row=>`<tr><td>${date(row.transaction_date)}</td><td><b>${esc(row.bank_account_code)}</b></td>
      <td>${esc(row.bank_reference||'-')}</td><td>${esc(row.description)}</td><td>${esc(row.direction)}</td>
      <td class="num">${money(row.amount)}</td><td>${financeStatus(row.status)}</td><td>${esc(row.journal_no||'-')}</td>
      <td>${row.status==='UNMATCHED'?`<button class="table-action" data-match-bank="${row.id}">Match</button>`:'Matched'}</td></tr>`);
    const reconciliationRows=reconciliations.rows.map(row=>`<tr><td><b>${esc(row.reconciliation_no)}</b></td>
      <td>${esc(row.bank_account_code)} · ${esc(row.bank_name)}</td><td>${date(row.statement_date)}</td>
      <td class="num">${money(row.statement_ending_balance)}</td><td class="num">${money(row.book_ending_balance)}</td>
      <td class="num">${money(row.difference)}</td><td>${financeStatus(row.status)}</td>
      <td>${row.status==='SUBMITTED'?`<button class="table-action" data-recon-decision="${row.id}" data-decision="APPROVE">Approve</button>
        <button class="table-action danger" data-recon-decision="${row.id}" data-decision="REJECT">Reject</button>`:'-'}</td></tr>`);
    const body=`<div class="workspace-commandbar"><button class="command primary" id="newBank">New Bank Account</button>
      <button class="command" id="importBankTx">Enter Bank Transaction</button>
      <button class="command" id="newReconciliation">Prepare Reconciliation</button></div>
      <section class="workspace-card"><header><h2>Bank Accounts</h2></header>
        ${financeTable(['Code','Entity','Bank','Account','Number','Statement Balance','Unmatched'],bankRows)}</section>
      <section class="workspace-card"><header><h2>${section==='reports'?'Cash Movement Report':'Bank Statement Transactions'}</h2><span>${transactions.rows.length} lines</span></header>
        ${financeTable(['Date','Bank','Reference','Description','Direction','Amount','Status','Journal','Match'],txRows)}</section>
      <section class="workspace-card"><header><h2>${section==='approvals'?'Reconciliation Approval Worklist':'Bank Reconciliations'}</h2>
        <span>Independent approval; zero difference required</span></header>
        ${financeTable(['Reconciliation','Bank','Statement Date','Statement Balance','Book Balance','Difference','Status','Decision'],reconciliationRows)}</section>`;
    content.innerHTML=workbenchShell(body,section);bindWorkbench();
    $('#newBank').onclick=openBankAccountForm;$('#importBankTx').onclick=()=>openBankTransactionForm(banks.rows);
    $('#newReconciliation').onclick=()=>openBankReconciliationForm(banks.rows);
    $$('[data-match-bank]').forEach(button=>button.onclick=async()=>{const journalLineId=prompt('Posted bank journal line ID to match:');
      if(!journalLineId)return;try{await api(`/finance/bank-transactions/${button.dataset.matchBank}/match`,{method:'POST',
        body:JSON.stringify({journalLineId})});toast('Bank transaction matched');await renderTreasury(section);}
      catch(error){toast(error.message,'error');}});
    $$('[data-recon-decision]').forEach(button=>button.onclick=async()=>{const notes=prompt(`${button.dataset.decision} notes:`,'Reviewed bank statement and book balance');
      if(notes===null)return;try{await api(`/finance/bank-reconciliations/${button.dataset.reconDecision}/decision`,{method:'POST',
        body:JSON.stringify({decision:button.dataset.decision,notes})});toast('Reconciliation decided');await renderTreasury(section);}
      catch(error){toast(error.message,'error');}});
  }catch(error){showWorkspaceError(error);}
}
function openBankAccountForm(){
  modal('New Bank Account',`<form id="bankAccountForm" class="operational-form grid">
    <label><span>Code</span><input name="bankAccountCode" required></label><label><span>Entity</span><select name="entityCode"><option>E88</option><option>NRD</option><option>RIDEBOX</option><option>SHARED</option></select></label>
    <label><span>Bank Name</span><input name="bankName" required></label><label><span>Account Name</span><input name="accountName" required></label>
    <label><span>Masked Account Number</span><input name="accountNumberMasked" placeholder="****1234"></label>
    <label><span>GL Account</span><input name="glAccountCode" value="1010"></label>
    <label><span>Opening Balance</span><input name="openingBalance" type="number" step="0.01"></label>
    <button class="command primary">Create Bank Account</button></form>`);
  $('#bankAccountForm').onsubmit=async event=>{event.preventDefault();try{await api('/finance/bank-accounts',{method:'POST',
    body:JSON.stringify(formDataObject(event.currentTarget))});closeModal();toast('Bank account created');await renderTreasury('records');}
    catch(error){toast(error.message,'error');}};
}
function openBankTransactionForm(banks){
  modal('Enter Bank Statement Transaction',`<form id="bankTxForm" class="operational-form grid">
    <label class="wide"><span>Bank Account</span><select name="bankAccountId">${banks.map(x=>`<option value="${x.id}">${esc(x.bank_account_code)} · ${esc(x.bank_name)}</option>`).join('')}</select></label>
    <label><span>Transaction Date</span><input name="transactionDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label>
    <label><span>Direction</span><select name="direction"><option>CREDIT</option><option>DEBIT</option></select></label>
    <label><span>Reference</span><input name="bankReference"></label><label><span>Amount</span><input name="amount" type="number" min="0" step="0.01"></label>
    <label class="wide"><span>Description</span><input name="description"></label><button class="command primary">Save Transaction</button></form>`);
  $('#bankTxForm').onsubmit=async event=>{event.preventDefault();try{await api('/finance/bank-transactions',{method:'POST',
    body:JSON.stringify(formDataObject(event.currentTarget))});closeModal();toast('Bank transaction saved');await renderTreasury('records');}
    catch(error){toast(error.message,'error');}};
}
function openBankReconciliationForm(banks){
  modal('Prepare Bank Reconciliation',`<form id="bankReconciliationForm" class="operational-form grid">
    <label class="wide"><span>Bank Account</span><select name="bankAccountId" required>
      ${banks.map(x=>`<option value="${x.id}">${esc(x.bank_account_code)} · ${esc(x.bank_name)} · ${esc(x.account_name)}</option>`).join('')}</select></label>
    <label><span>Statement Date</span><input name="statementDate" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
    <label><span>Statement Ending Balance</span><input name="statementEndingBalance" type="number" step="0.01" required></label>
    <label><span>Approved Adjustments</span><input name="adjustments" type="number" step="0.01" value="0"></label>
    <label class="wide"><span>Notes</span><textarea name="notes" required>Prepared from bank statement; unmatched transactions remain open.</textarea></label>
    <button class="command primary">Submit Reconciliation</button></form>`);
  $('#bankReconciliationForm').onsubmit=async event=>{event.preventDefault();try{
    await api('/finance/bank-reconciliations',{method:'POST',body:JSON.stringify(formDataObject(event.currentTarget))});
    closeModal();toast('Reconciliation submitted for independent approval');await renderTreasury('approvals');
  }catch(error){toast(error.message,'error');}};
}

async function renderFinancePlanning(section){
  if(section==='center')return renderFinanceCenter('Planning and Budgeting Work Summary','Department budgets, forecasts, actuals and cash planning');
  if(section==='reports')return renderBudgetActual();
  if(section==='setup')return renderFinanceControlNotes('Planning Setup',[
    ['Budget dimensions','Year, month, department, cost center, account and OPEX/CAPEX.'],
    ['Actual source','Only approved and posted finance journals feed actual results.'],
    ['Scenarios','Budget, base, upside, downside and rolling forecast remain version controlled.'],
  ]);
  content.innerHTML='<div class="workspace-loading">Loading budget workbench…</div>';
  try{
    const year=new Date().getFullYear();const data=await api(`/planning/workbench?year=${year}`);
    const rows=data.rows.map(row=>`<tr><td><b>${esc(row.department)}</b></td><td>${esc(row.costCenter||'-')}</td>
      <td>${esc(row.accountTitle)}</td><td>${esc(row.capexOpex)}</td><td class="num">${money(row.fyBudget)}</td>
      <td class="num">${money(row.actual)}</td><td class="num">${money(row.forecast)}</td>
      <td class="num">${money(row.variance)}</td><td>${financeStatus(row.status)}</td></tr>`);
    const body=`<div class="workspace-commandbar"><span class="workspace-mode">${year} BUDGET AND FORECAST WORKBENCH</span></div>
      <section class="workspace-card"><header><h2>${section==='approvals'?'Forecast Review':'Department Budget Register'}</h2>
        <span>${data.rows.length} budget lines</span></header>
        ${financeTable(['Department','Cost Center','Account','Type','Budget','Actual','Forecast','Variance','Status'],rows)}</section>`;
    content.innerHTML=workbenchShell(body,section);bindWorkbench();
  }catch(error){showWorkspaceError(error);}
}

function renderFinanceControlNotes(title,items){
  const body=`<section class="workspace-card"><header><h2>${esc(title)}</h2></header>
    <div class="definition-list finance-control-list">${items.map(([label,text])=>`<div><b>${esc(label)}</b><span>${esc(text)}</span></div>`).join('')}</div></section>`;
  content.innerHTML=workbenchShell(body,state.section);bindWorkbench();
}

async function renderInboundWorkspace(section){
  if(section==='records')return renderPurchaseOrders();
  if(section==='approvals')return renderExpectedShipments();
  if(section==='reports')return renderGoodsReceipt();
  if(section==='setup')return renderInboundDiscrepancies();
  return renderInboundOverview();
}

async function renderInboundOverview(){
  content.innerHTML='<div class="workspace-loading">Loading inbound control center…</div>';
  try{
    const [pos,shipments,openReceipts,reconciliation]=await Promise.all([
      api('/procurement/purchase-orders?size=500'),
      api('/shipments?size=500'),
      api('/receiving/open-shipments'),
      api('/receiving/reports/reconciliation'),
    ]);
    const approved=pos.rows.filter(row=>['APPROVED','PARTIALLY_RECEIVED'].includes(row.status)).length;
    const expected=shipments.rows.reduce((sum,row)=>sum+Number(row.expected_qty||0),0);
    const received=shipments.rows.reduce((sum,row)=>sum+Number(row.received_qty||0),0);
    const discrepancies=reconciliation.totals.openVariances;
    const recent=shipments.rows.slice(0,12);
    const body=`${workflowStrip(['Purchase Order','ATLAS Expected Shipment','Goods Receipt','Warehouse Visibility'],0)}
      <div class="workspace-kpis">${kpi('Approved POs',approved,{section:'records'})}${kpi('Expected Units',expected,{section:'approvals'})}${kpi('Received Units',received,{section:'reports'})}${kpi('Open Discrepancies',discrepancies,{section:'setup'})}</div>
      <div class="ramco-layout">
        <div class="ramco-main">
          <section class="ramco-window">
            <header><div><b>Inbound Shipment Control</b><small>PO-controlled expected and actual receiving</small></div><button class="ramco-primary" data-section-link="approvals">Upload ATLAS</button></header>
            ${operationalTable(['Shipment','Purchase Order','Batch','Supplier','Expected','Received','Variance','Status'],recent.map(row=>`<tr>
              <td><b>${esc(row.shipment_no)}</b></td><td>${esc(row.purchase_order_ref||'-')}</td><td>${esc(row.batch_code||'-')}</td>
              <td>${esc(row.supplier_name||'-')}</td><td>${esc(row.expected_qty||0)}</td><td>${esc(row.received_qty||0)}</td>
              <td>${esc(row.open_variances||0)}</td><td>${statusBadge(row.status)}</td></tr>`))}
          </section>
        </div>
        <aside class="ramco-rail">
          <section><header>Inbound Actions</header><div class="ramco-action-links">
            <button data-section-link="records">Purchase Orders</button><button data-section-link="approvals">ATLAS Expected Shipments</button>
            <button data-section-link="reports">Receive & Scan Units</button><button data-section-link="setup">Discrepancy Reports</button>
          </div></section>
          <section><header>Receiving Queue</header>${horizontalBars([
            ['Open shipments',openReceipts.rows.length,'blue'],['Matched',reconciliation.totals.matched,'green'],
            ['With variances',reconciliation.totals.withDiscrepancies,'orange'],
          ])}</section>
        </aside>
      </div>`;
    content.innerHTML=workbenchShell(body,'center');
    bindOperationalShell();
  }catch(error){showWorkspaceError(error);}
}

async function renderPurchaseOrders(){
  content.innerHTML='<div class="workspace-loading">Loading purchase orders…</div>';
  try{
    const data=await api('/procurement/purchase-orders?size=500');
    const rows=data.rows.map(row=>`<tr data-po="${row.id}"><td><b>${esc(row.purchase_order_no)}</b></td><td>${date(row.order_date)}</td>
      <td>${esc(row.vendor_name||'-')}</td><td>${date(row.expected_delivery_date)}</td><td>${esc(row.currency)}</td>
      <td class="num">${money(row.total_amount)}</td><td>${esc(row.line_count)}</td><td>${statusBadge(row.status)}</td>
      <td><button class="table-action" data-print-po="${row.id}">Print PO</button>${row.status==='DRAFT'&&can('PROCUREMENT','APPROVE')?`<button class="table-action" data-approve-po="${row.id}">Approve</button>`:''}</td></tr>`);
    const body=`${workflowStrip(['Purchase Order','ATLAS Expected Shipment','Goods Receipt','Warehouse Visibility'],0)}
      <div class="workspace-commandbar"><button class="command primary" id="createPO">New Purchase Order</button>
        <span class="command-spacer"></span><span class="workspace-mode">PURCHASE ORDER REGISTER</span></div>
      <section class="workspace-card"><header><h2>Purchase Orders</h2><span>${data.total} records</span></header>
      ${operationalTable(['PO Number','Order Date','Vendor','Expected Delivery','Currency','Total','Lines','Status','Action'],rows)}</section>`;
    content.innerHTML=workbenchShell(body,'records');
    bindOperationalShell();
    $('#createPO').onclick=renderPurchaseOrderForm;
    $$('[data-approve-po]').forEach(button=>button.onclick=async event=>{
      event.stopPropagation();
      try{const result=await api(`/procurement/purchase-orders/${button.dataset.approvePo}/approve`,{method:'POST',body:'{}'});toast(result.approved?'Purchase order approved':`Approval step recorded; ${result.approvalDecision?.state?.pending||0} step(s) remain`);await renderPurchaseOrders();}
      catch(error){toast(error.message,'error');}
    });
  }catch(error){showWorkspaceError(error);}
}

async function renderPurchaseOrderForm(){
  const lookups=await api('/masters/lookups');
  // Vendor droplist is fed by BOTH the partner master and the vendor accreditation platform
  let accredited=[];
  try{const av=await api('/masters/accredited-vendors');accredited=(av.rows||av.vendors||av||[]);}catch(e){accredited=[];}
  const vendorNames=[...new Set([].concat(
    (lookups.vendors||[]).map(v=>v.name||v.partner_name||''),
    (accredited||[]).map(v=>v.name||v.vendor_name||v.partner_name||'')
  ).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const body=`${workflowStrip(['Purchase Order','ATLAS Expected Shipment','Goods Receipt','Warehouse Visibility'],0)}
    <div class="record-actionbar"><button class="command primary" id="savePO">Save Purchase Order</button><button class="command" id="cancelPO">Cancel</button></div>
    <form id="poForm" class="record-page">
      <header><div><small>Inbound Logistics</small><h2>New Purchase Order</h2></div><div class="record-number">AUTO NUMBER</div></header>
      <section class="record-body"><div class="record-fields">
        <label class="record-field"><span>Vendor</span><select name="vendorName" required><option value="">Select vendor</option>${vendorNames.map(v=>`<option>${esc(v)}</option>`).join('')}</select></label>
        ${recordField('Order Date','orderDate','date',new Date().toISOString().slice(0,10),'required')}
        ${recordField('Expected Delivery','expectedDeliveryDate','date','')}
        <label class="record-field"><span>Currency</span><select name="currency"><option>PHP</option><option>USD</option><option>EUR</option></select></label>
        ${recordField('Exchange Rate','exchangeRate','number','1','min="0.000001" step="0.000001"')}
        ${recordField('Incoterm','incoterm','text','')}
        ${recordField('Payment Terms','paymentTerms','text','')}
        ${recordField('Tax Amount','taxAmount','number','0','min="0" step="0.01"')}
      </div></section>
      <section class="record-sublist"><div class="line-editor-head"><b>Vendor & document details (printed on the PO)</b></div>
        <div class="record-fields">
          <label class="record-field"><span>Vendor contact person</span><input id="poVcp"></label>
          <label class="record-field"><span>Vendor contact number</span><input id="poVcn"></label>
          <label class="record-field"><span>Vendor email</span><input id="poVemail"></label>
          <label class="record-field"><span>Vendor address</span><input id="poVaddr"></label>
          <label class="record-field"><span>Vendor Tax ID</span><input id="poVtax"></label>
          <label class="record-field"><span>Activity / Purpose</span><input id="poActivity"></label>
          <label class="record-field"><span>Invoice number</span><input id="poInvoice"></label>
          <label class="record-field"><span>Delivery terms</span><input id="poDelivery" value="FOB"></label>
          <label class="record-field"><span>Other remarks</span><input id="poOther"></label>
          <label class="record-field"><span>Requested by (name)</span><input id="poReqName"></label>
          <label class="record-field"><span>Requested by (title)</span><input id="poReqTitle" value="Requestor"></label>
          <label class="record-field"><span>Department</span><input id="poDept"></label>
        </div></section>
      <div class="record-tabs"><button type="button" class="active">Items</button></div>
      <section class="record-sublist"><div class="line-editor-head"><b>Purchase Order Lines</b><button type="button" id="addPOLine">Add Line</button></div>
        <div id="poLines" class="line-editor"></div></section>
      <section class="record-sublist"><div class="line-editor-head"><b>Supporting documents (required)</b></div>
        <div class="record-fields">
          <label class="record-field wide"><span>Approved quotation / invoice / supporting file</span><input id="poDocs" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.docx,.doc"></label>
        </div>
        <div id="poDocList" class="po-doc-list"></div>
      </section>
      <section class="record-sublist"><div class="line-editor-head"><b>Approval routing</b></div>
        <div class="record-fields">
          <label class="record-field"><span>Department Manager name</span><input id="apMgrName"></label>
          <label class="record-field"><span>Department Manager email</span><input id="apMgrEmail" type="email" placeholder="name@nrdev.ph"></label>
          <label class="record-field"><span>Department Head name</span><input id="apDeptName"></label>
          <label class="record-field"><span>Department Head email</span><input id="apDeptEmail" type="email" placeholder="name@nrdev.ph"></label>
          <label class="record-field"><span>Finance name</span><input id="apFinName" value="Finance"></label>
          <label class="record-field"><span>Finance email (embedded)</span><input id="apFinEmail" value="mmungcal@nrdev.ph" readonly></label>
          <label class="record-field"><span>CEO name</span><input id="apCeoName"></label>
          <label class="record-field"><span>CEO email</span><input id="apCeoEmail" type="email" placeholder="name@nrdev.ph"></label>
        </div>
        <div class="line-editor-head" style="margin-top:8px"><b>Your signature (creator)</b></div>
        <div class="sig-tabs"><button type="button" class="table-action active" id="poTabDraw">Draw</button><button type="button" class="table-action" id="poTabType">Type</button></div>
        <div id="poDrawWrap"><canvas id="poPad" class="po-sigpad" width="420" height="140"></canvas> <button type="button" class="table-action" id="poClearPad">Clear</button></div>
        <div id="poTypeWrap" style="display:none"><input id="poTypedName" class="sig-typed" placeholder="Type your full name" style="min-width:260px"></div>
      </section>
    </form>`;
  content.innerHTML=workbenchShell(body,'records');
  bindOperationalShell();
  const itemOptionHtml=item=>`<option value="${item.id}" data-code="${esc(item.item_code)}" data-name="${esc(item.item_name)}" data-category="${esc(item.category)}">${esc(item.item_code)} · ${esc(item.item_name)}</option>`;
  const openNewItemModal=targetRow=>{
    const cats=['MC','BAT','BSS','SP','CHG','OTH'];
    modal('Create new item',`<form id="newItemForm" class="operational-form grid">
      <label><span>Item name</span><input name="itemName" required placeholder="e.g. Brake lever (D400)"></label>
      <label><span>Class</span><select name="category">${cats.map(c=>`<option>${c}</option>`).join('')}</select></label>
      <label class="wide"><span>Item type</span><select name="productType"><option value="SERIALIZED">Inventoriable, serialized (per-unit serial)</option><option value="QUANTITY">Inventoriable, quantity (bulk stock)</option><option value="SERVICE">Non-inventoriable (service / expense)</option></select></label>
      <label><span>Unit of measure</span><input name="uom" value="PCS"></label>
      <label><span>Standard cost</span><input name="standardCost" type="number" min="0" step="0.01" value="0"></label>
      <div class="modal-actions wide"><button type="submit" class="command primary">Create item</button><button type="button" class="command" id="niCancel">Cancel</button></div>
    </form>`,'Add a locally purchased or missing item to the master');
    const mb=$('#modalBody');const f=mb.querySelector('#newItemForm');
    mb.querySelector('#niCancel').onclick=()=>closeModal();
    f.onsubmit=async e=>{e.preventDefault();const p=formDataObject(f);
      try{const r=await api('/masters/items/register',{method:'POST',body:JSON.stringify({itemName:p.itemName,category:p.category,productType:p.productType,uom:p.uom,standardCost:Number(p.standardCost||0)})});
        const item=r.item||r;lookups.items.push(item);
        $$('#poLines select[data-line="itemId"]').forEach(sel=>sel.insertAdjacentHTML('beforeend',itemOptionHtml(item)));
        const tsel=targetRow.querySelector('select[data-line="itemId"]');tsel.value=String(item.id);
        targetRow.querySelector('[data-line="description"]').value=(tsel.selectedOptions[0]&&tsel.selectedOptions[0].dataset.name)||item.item_name||'';
        if(Number(p.standardCost||0))targetRow.querySelector('[data-line="unitCost"]').value=Number(p.standardCost);
        closeModal();toast('Item created: '+(item.item_code||item.item_name));
      }catch(err){toast(err.message,'error');}};
  };
  const addLine=()=>{
    const row=document.createElement('div');
    row.className='line-editor-row po-line';
    row.innerHTML=`<div class="po-item-cell"><select data-line="itemId" required><option value="">Item…</option>${lookups.items.map(itemOptionHtml).join('')}</select><button type="button" class="table-action po-newitem" title="Create a new item not in the master">+ New</button></div>
      <input data-line="description" placeholder="Description"><input data-line="unit" placeholder="Unit" value="pcs"><input data-line="qty" type="number" min="0.01" step="0.01" value="1" aria-label="Quantity">
      <input data-line="unitCost" type="number" min="0" step="0.01" value="0" aria-label="Unit cost"><input data-line="remarks" placeholder="Remarks"><button type="button" class="remove-line">×</button>`;
    row.querySelector('select').onchange=()=>{
      const option=row.querySelector('select').selectedOptions[0];
      row.querySelector('[data-line="description"]').value=option?.dataset.name||'';
    };
    row.querySelector('.po-newitem').onclick=()=>openNewItemModal(row);
    row.querySelector('.remove-line').onclick=()=>row.remove();
    $('#poLines').append(row);
  };
  addLine();$('#addPOLine').onclick=addLine;$('#cancelPO').onclick=renderPurchaseOrders;
  // creator signature pad
  let poSigMode='DRAW',poPad,poCtx,poDrawing=false,poInk=false;
  const initPoPad=()=>{poPad=$('#poPad');if(!poPad)return;poCtx=poPad.getContext('2d');poCtx.lineWidth=2.2;poCtx.lineCap='round';poCtx.strokeStyle='#12305f';
    const pos=e=>{const r=poPad.getBoundingClientRect();const t=e.touches?e.touches[0]:e;return[(t.clientX-r.left)*(poPad.width/r.width),(t.clientY-r.top)*(poPad.height/r.height)];};
    const down=e=>{e.preventDefault();poDrawing=true;const[x,y]=pos(e);poCtx.beginPath();poCtx.moveTo(x,y);};
    const move=e=>{if(!poDrawing)return;e.preventDefault();const[x,y]=pos(e);poCtx.lineTo(x,y);poCtx.stroke();poInk=true;};
    const up=()=>{poDrawing=false;};
    poPad.addEventListener('mousedown',down);poPad.addEventListener('mousemove',move);window.addEventListener('mouseup',up);
    poPad.addEventListener('touchstart',down);poPad.addEventListener('touchmove',move);poPad.addEventListener('touchend',up);
    $('#poClearPad').onclick=()=>{poCtx.clearRect(0,0,poPad.width,poPad.height);poInk=false;};};
  initPoPad();
  const poDocFiles=[];
  const poRenderDocs=()=>{const host=$('#poDocList');if(!host)return;
    host.innerHTML=poDocFiles.length?poDocFiles.map((f,i)=>`<span class="po-doc-chip">${esc(f.name)} <button type="button" data-doc-drop="${i}">&times;</button></span>`).join(''):'<span class="po-doc-empty">No file attached yet</span>';
    host.querySelectorAll('[data-doc-drop]').forEach(b=>b.onclick=()=>{poDocFiles.splice(Number(b.dataset.docDrop),1);poRenderDocs();});};
  poRenderDocs();
  if($('#poDocs'))$('#poDocs').onchange=event=>{
    [...event.target.files].forEach(file=>{
      if(file.size>5*1024*1024)return toast(file.name+' is over 5 MB',
        'error');
      if(poDocFiles.length>=5)return toast('Maximum 5 attachments','error');
      poDocFiles.push(file);
    });
    event.target.value='';poRenderDocs();
  };
  const poReadDocs=()=>Promise.all(poDocFiles.map(file=>new Promise(resolve=>{
    const reader=new FileReader();
    reader.onload=()=>resolve({fileName:file.name,contentType:file.type||'application/octet-stream',size:file.size,data:String(reader.result||'').split(',')[1]||''});
    reader.onerror=()=>resolve({fileName:file.name,contentType:file.type||'',size:file.size,data:''});
    reader.readAsDataURL(file);
  })));
  $('#poTabDraw')&&($('#poTabDraw').onclick=()=>{poSigMode='DRAW';$('#poDrawWrap').style.display='';$('#poTypeWrap').style.display='none';$('#poTabDraw').classList.add('active');$('#poTabType').classList.remove('active');});
  $('#poTabType')&&($('#poTabType').onclick=()=>{poSigMode='TYPE';$('#poDrawWrap').style.display='none';$('#poTypeWrap').style.display='';$('#poTabType').classList.add('active');$('#poTabDraw').classList.remove('active');});
  const poGetSig=()=>{if(poSigMode==='DRAW'){return poInk?{signature:poPad.toDataURL('image/png'),signatureType:'DRAW'}:null;}const n=($('#poTypedName').value||'').trim();return n?{signature:n,signatureType:'TYPE'}:null;};
  $('#savePO').onclick=()=>$('#poForm').requestSubmit();
  $('#poForm').onsubmit=async event=>{
    event.preventDefault();
    const payload=formDataObject(event.currentTarget);
    const gv=id=>{const el=$(id);return el?el.value:'';};
    payload.vendorContactPerson=gv('#poVcp');payload.vendorContactNumber=gv('#poVcn');payload.vendorEmail=gv('#poVemail');payload.vendorAddress=gv('#poVaddr');payload.vendorTaxId=gv('#poVtax');payload.activityPurpose=gv('#poActivity');payload.invoiceNumber=gv('#poInvoice');payload.deliveryTerms=gv('#poDelivery');payload.otherRemarks=gv('#poOther');payload.requestedByName=gv('#poReqName');payload.requestedByTitle=gv('#poReqTitle');payload.customerDepartment=gv('#poDept');
    payload.lines=$$('.po-line').map(row=>{
      const option=row.querySelector('select').selectedOptions[0];
      return {itemId:Number(row.querySelector('select').value),itemCode:option?.dataset.code||'',
        itemName:option?.dataset.name||'',category:option?.dataset.category||'OTH',
        description:row.querySelector('[data-line="description"]').value,
        remarks:row.querySelector('[data-line="remarks"]')?row.querySelector('[data-line="remarks"]').value:'',unit:row.querySelector('[data-line="unit"]')?row.querySelector('[data-line="unit"]').value:'pcs',
        qty:Number(row.querySelector('[data-line="qty"]').value),unitCost:Number(row.querySelector('[data-line="unitCost"]').value),serialized:true};
    });
    payload.attachments=await poReadDocs();
    const approvers=[];
    const add=(role,name,email)=>{if((email||'').trim())approvers.push({role,name:(name||'').trim(),email:email.trim()});};
    add('DEPT_MANAGER',$('#apMgrName').value,$('#apMgrEmail').value);
    add('DEPT_HEAD',$('#apDeptName').value,$('#apDeptEmail').value);
    add('FINANCE',$('#apFinName').value||'Finance',$('#apFinEmail').value||'mmungcal@nrdev.ph');
    add('CEO',$('#apCeoName').value,$('#apCeoEmail').value);
    if(!payload.attachments.length){toast('Attach the approved quotation or invoice before saving.','error');return;}
    if(approvers.length){const sig=poGetSig();if(!sig){toast('Please sign (draw or type) before routing for approval.','error');return;}
      payload.approvers=approvers;payload.creatorSignature=sig.signature;payload.creatorSignatureType=sig.signatureType;payload.creatorName=(state.session&&state.session.user&&(state.session.user.displayName||state.session.user.email))||'';}
    try{const result=await api('/procurement/purchase-orders',{method:'POST',body:JSON.stringify(payload)});
      if(result.chainBuilt&&result.firstToken){const link=location.origin+'/approve.html?token='+result.firstToken;
        modal('Purchase order routed for approval',`<div class="operational-form"><p><b>${esc(result.purchaseOrderNo)}</b> is now FOR APPROVAL.</p><p style="color:#556;font-size:12px">Send this link to the first approver (Department Head). Each approver gets the next link automatically after they sign - no login needed.</p><label><span>Approval link</span><input id="poShareLink" readonly value="${esc(link)}"></label><div class="modal-actions"><button type="button" class="command primary" id="poCopyLink">Copy link</button><button type="button" class="command" id="poDoneLink">Done</button></div></div>`);
        const mb=$('#modalBody');mb.querySelector('#poCopyLink').onclick=()=>{const i=mb.querySelector('#poShareLink');i.select();try{document.execCommand('copy');}catch(e){}try{navigator.clipboard&&navigator.clipboard.writeText(link);}catch(e){}toast('Link copied');};
        mb.querySelector('#poDoneLink').onclick=async()=>{closeModal();await renderPurchaseOrders();};
      } else {toast(`Purchase order ${result.purchaseOrderNo} created`);await renderPurchaseOrders();}
    }catch(error){toast(error.message,'error');}
  };
}

async function renderExpectedShipments(){
  content.innerHTML='<div class="workspace-loading">Loading expected shipments…</div>';
  try{
    const [pos,shipments]=await Promise.all([
      api('/procurement/purchase-orders?size=500'),
      api('/shipments?size=500'),
    ]);
    const eligible=pos.rows.filter(row=>['APPROVED','PARTIALLY_RECEIVED'].includes(row.status));
    const preview=state.inbound.preview;
    const body=`${workflowStrip(['Purchase Order','ATLAS Expected Shipment','Goods Receipt','Warehouse Visibility'],1)}
      <div class="ramco-layout">
        <div class="ramco-main">
          <section class="workspace-card atlas-upload-card">
            <header><h2>ATLAS Expected Shipment Upload</h2></header>
            <form id="atlasForm" class="operational-form">
              <label><span>Purchase Order</span><select name="purchaseOrderId" required><option value="">Select approved PO…</option>${eligible.map(po=>`<option value="${po.id}">${esc(po.purchase_order_no)} · ${esc(po.vendor_name)} · ${money(po.total_amount)} ${esc(po.currency)}</option>`).join('')}</select></label>
              <label><span>ATLAS Excel file</span><input type="file" name="file" accept=".xlsx,.xls" required></label>
              <button class="command primary">Preview Expected Shipment</button>
            </form>
            ${preview?`<div class="upload-preview">
              <div>${kpi('Import',preview.importNo)}${kpi('Purchase Order',preview.purchaseOrder.purchaseOrderNo)}${kpi('Valid Rows',preview.summary.valid)}${kpi('Exceptions',preview.summary.exceptions)}</div>
              <button class="command primary" id="commitAtlas">Commit Expected Shipment</button>
            </div>`:''}
          </section>
          <section class="workspace-card"><header><h2>Expected Shipments</h2><span>${shipments.total} shipments</span></header>
            ${operationalTable(['Shipment','Purchase Order','Batch','Supplier','Expected','Received','ETA','Status'],shipments.rows.map(row=>`<tr>
              <td><b>${esc(row.shipment_no)}</b></td><td>${esc(row.purchase_order_ref||'-')}</td><td>${esc(row.batch_code||'-')}</td>
              <td>${esc(row.supplier_name||'-')}</td><td>${esc(row.expected_qty||0)}</td><td>${esc(row.received_qty||0)}</td>
              <td>${date(row.eta)}</td><td>${statusBadge(row.status)}</td></tr>`))}
          </section>
        </div>
        
      </div>`;
    content.innerHTML=workbenchShell(body,'approvals');
    bindOperationalShell();
    $('#atlasForm').onsubmit=async event=>{
      event.preventDefault();
      try{state.inbound.preview=await api('/atlas/preview',{method:'POST',body:new FormData(event.currentTarget)});toast('ATLAS preview ready');await renderExpectedShipments();}
      catch(error){toast(error.message,'error');}
    };
    if($('#commitAtlas'))$('#commitAtlas').onclick=async()=>{
      try{const result=await api(`/atlas/${preview.importId}/commit`,{method:'POST',body:'{}'});toast(`${result.shipments.length} expected shipment(s) committed`);state.inbound.preview=null;await renderExpectedShipments();}
      catch(error){toast(error.message,'error');}
    };
  }catch(error){showWorkspaceError(error);}
}

async function loadJsQR(){
  if(window.jsQR)return window.jsQR;
  const tryLoad=src=>new Promise((res,rej)=>{const el=document.createElement('script');el.src=src;el.onload=()=>res(window.jsQR);el.onerror=rej;document.head.appendChild(el);});
  try{return await tryLoad('https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js');}
  catch(e){try{return await tryLoad('https://unpkg.com/jsqr@1.4.0/dist/jsQR.js');}catch(e2){return null;}}
}
async function scanQrWithCamera(onScan){
  if(!navigator.mediaDevices?.getUserMedia){
    toast('Camera is not available on this device. Use manual serial entry.','error');
    return;
  }
  const hasDetector=('BarcodeDetector' in window);
  let jsqr=null;
  if(!hasDetector){jsqr=await loadJsQR();}
  if(!hasDetector&&!jsqr){
    toast('QR scanning needs a connection on this browser (Android scans offline). Use manual entry.','error');
    return;
  }
  let stream;
  let stopped=false;
  modal('Scan QR / serial',`<div class="scanner"><video id="qrVideo" playsinline autoplay muted></video><canvas id="qrCanvas" hidden></canvas><p>Point the camera at the unit QR code. Works on Android and iOS.</p><button class="command" id="stopScanner">Close scanner</button></div>`);
  const stop=()=>{
    stopped=true;
    stream?.getTracks().forEach(track=>track.stop());
    state.scannerStream=null;
    closeModal();
  };
  $('#stopScanner').onclick=stop;
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}});
    state.scannerStream=stream;
    const video=$('#qrVideo');video.srcObject=stream;
    try{await video.play();}catch(e){}
    const detector=hasDetector?new BarcodeDetector({formats:['qr_code','code_128','data_matrix']}):null;
    const canvas=$('#qrCanvas');const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const tick=async()=>{
      if(stopped)return;
      try{
        let raw=null;
        if(detector){
          const codes=await detector.detect(video);
          if(codes[0]?.rawValue)raw=codes[0].rawValue;
        }else if(jsqr&&video.readyState>=2&&video.videoWidth){
          canvas.width=video.videoWidth;canvas.height=video.videoHeight;
          ctx.drawImage(video,0,0,canvas.width,canvas.height);
          const frame=ctx.getImageData(0,0,canvas.width,canvas.height);
          const result=jsqr(frame.data,frame.width,frame.height,{inversionAttempts:'attemptBoth'});
          if(result&&result.data)raw=result.data;
        }
        if(raw){
          const value=serialFromQrPayload(raw);
          stop();
          await onScan(value);
          return;
        }
      }catch(e){}
      requestAnimationFrame(tick);
    };
    video.onloadeddata=tick;
    if(video.readyState>=2)tick();
  }catch(error){
    stop();
    toast(`Camera unavailable: ${error.message}`,'error');
  }
}

async function renderGoodsReceipt(selectedShipmentId=''){
  content.innerHTML='<div class="workspace-loading">Loading receiving workbench…</div>';
  try{
    const [open,lookups]=await Promise.all([api('/receiving/open-shipments'),api('/masters/lookups')]);
    const shipmentId=Number(selectedShipmentId||state.inbound.shipment?.header?.id||open.rows[0]?.shipment_id||0);
    const workbench=shipmentId?await api(`/receiving/shipment/${shipmentId}`):null;
    if(workbench&&Number(state.inbound.shipment?.header?.id)!==shipmentId){
      state.inbound.shipment=workbench;
      state.inbound.receiptLines=[];
    }else if(workbench)state.inbound.shipment=workbench;
    const lines=state.inbound.receiptLines;
    const scanRows=lines.map((row,index)=>`<tr><td>${index+1}</td><td>${esc(row.expectedSerialNo||'-')}</td><td><b>${esc(row.actualSerialNo)}</b></td>
      <td>${statusBadge(row.acceptance)}</td><td>${esc(row.message||'-')}</td><td><button class="table-action" data-remove-scan="${index}">Remove</button></td></tr>`);
    const expectedOptions=(workbench?.expectedAssets||[]).filter(asset=>!['RECEIVED','SUBSTITUTED','CANCELLED','SHORT_CLOSED'].includes(asset.expected_status))
      .map(asset=>`<option value="${asset.id}">${esc(asset.serial_no)} · ${esc(asset.item_code||asset.item_name||'Item')}</option>`).join('');
    // ATLAS gives a different identifying key per class, so the expected list
    // shows the key the receiver will actually read off the unit.
    const expectedRows=(workbench?.expectedAssets||[]).slice(0,400).map(asset=>{
      const k=atlasKeys(asset);
      return `<tr data-expected-pick="${asset.id}" data-serial="${esc(asset.serial_no)}" class="${['RECEIVED','SUBSTITUTED'].includes(asset.expected_status)?'':'clickable-row'}">
        <td>${esc(k.classLabel)}</td><td><b>${esc(asset.serial_no)}</b><small class="atlas-key">${esc(k.primaryLabel)}</small></td>
        <td>${esc(asset.secondary_serial||'-')}<small class="atlas-key">${esc(k.secondaryLabel)}</small></td>
        <td>${esc(asset.item_code||'-')}</td><td>${esc(asset.item_name||asset.description||'-')}</td>
        <td>${esc(asset.model||'-')} ${esc(asset.color||'')}</td>
        <td>${esc(asset.actual_serial_no||'-')}</td><td>${statusBadge(asset.match_status||asset.expected_status)}</td></tr>`;});
    const openExpected=(workbench?.expectedAssets||[]).filter(a=>!['RECEIVED','SUBSTITUTED','CANCELLED','SHORT_CLOSED'].includes(a.expected_status));
    const body=`${workflowStrip(['Purchase Order','ATLAS Expected Shipment','Goods Receipt','Warehouse Visibility'],2)}
      <div class="workspace-commandbar">
        <label class="inline-control"><span>Expected Shipment</span><select id="receiptShipment"><option value="">Select shipment…</option>${open.rows.map(row=>`<option value="${row.shipment_id}" ${Number(row.shipment_id)===shipmentId?'selected':''}>${esc(row.shipment_no)} · PO ${esc(row.purchase_order_no||row.purchase_order_ref||'-')} · ${esc(row.remaining_qty)} remaining</option>`).join('')}</select></label>
        <label class="inline-control"><span>Receiving Location</span><select id="receiptLocation"><option value="">Select warehouse/store…</option>${lookups.locations.map(location=>`<option value="${location.id}" ${Number(location.id)===Number(state.inbound.locationId)?'selected':''}>${esc(location.code)} · ${esc(location.name)} (${esc(location.location_type)})</option>`).join('')}</select></label>
      </div>
      ${workbench?`<div class="ramco-layout receiving-layout">
        <div class="ramco-main">
          <section class="workspace-card">
            <header><div><h2>${esc(workbench.header.shipment_no)} · Goods Receipt</h2><span>PO ${esc(workbench.header.purchase_order_ref||'-')} · Batch ${esc(workbench.header.batch_code||'-')}</span></div>${statusBadge(workbench.header.status)}</header>
            <div class="scan-entry">
              <select id="expectedAsset"><option value="">Auto-match expected serial…</option>${expectedOptions}</select>
              <input id="actualSerial" autocomplete="off" placeholder="Scan or enter actual serial">
              <button class="command primary" id="addSerial">Add Serial</button><button class="command scan-camera" id="cameraReceipt">Scan QR</button>
              <button class="command" id="mobileReceive">Mobile receive</button>
            </div>
            <div class="scan-summary">${kpi('Scanned',lines.length)}${kpi('Matched',lines.filter(row=>row.acceptance==='MATCHED').length)}
              ${kpi('Discrepancies',lines.filter(row=>row.acceptance!=='MATCHED').length)}</div>
            ${operationalTable(['#','Expected Serial','Actual Serial','Classification','Message',''],scanRows)}
            <div class="receipt-post"><label>Receipt reference <input id="receiptReference" placeholder="DR, invoice, or receiving document"></label>
              <label>Notes <input id="receiptNotes" placeholder="Receiving notes"></label>
              <button class="command primary" id="postReceipt" ${lines.length?'':'disabled'}>Confirm & Post Goods Receipt</button></div>
          </section>
          <section class="workspace-card"><header><div><h2>ATLAS Expected Units</h2><span>${workbench.expectedAssets.length} units on the manifest · ${openExpected.length} still to receive</span></div></header>
            ${operationalTable(['Class','Primary key','Secondary key','Item','Description','Model / Colour','Actual Serial','Status'],expectedRows,{key:'atlas-expected'})}</section>
        </div>
        
      </div>`:operationalEmpty('No expected shipments are ready for receiving.')}`;
    content.innerHTML=workbenchShell(body,'reports');
    bindOperationalShell();
    if(!workbench)return;
    $('#receiptShipment').onchange=event=>renderGoodsReceipt(event.target.value);
    $('#receiptLocation').onchange=event=>{state.inbound.locationId=Number(event.target.value)||null;};
    const validateLines=async newLine=>{
      const candidate=[...state.inbound.receiptLines,newLine];
      const result=await api('/receiving/validate',{method:'POST',body:JSON.stringify({shipmentId,lines:candidate})});
      state.inbound.receiptLines=result.results;
      await renderGoodsReceipt(shipmentId);
    };
    const addManual=async serialValue=>{
      const serial=String(serialValue||$('#actualSerial').value).trim();
      if(!serial)return toast('Scan or enter an actual serial.','error');
      try{
        await validateLines({actualSerialNo:serial,expectedAssetId:Number($('#expectedAsset').value)||null,
          sourceMethod:serialValue?'QR':'MANUAL',qrPayload:serialValue||''});
      }catch(error){toast(error.message,'error');}
    };
    $('#addSerial').onclick=()=>addManual('');
    $('#actualSerial').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();addManual('');}};
    $('#cameraReceipt').onclick=()=>scanQrWithCamera(value=>addManual(value));
    $('#mobileReceive').onclick=()=>openMobileReceive(shipmentId,workbench,lookups);
    $$('[data-remove-scan]').forEach(button=>button.onclick=async()=>{
      state.inbound.receiptLines.splice(Number(button.dataset.removeScan),1);
      if(state.inbound.receiptLines.length){
        const result=await api('/receiving/validate',{method:'POST',body:JSON.stringify({shipmentId,lines:state.inbound.receiptLines})});
        state.inbound.receiptLines=result.results;
      }
      await renderGoodsReceipt(shipmentId);
    });
    $('#postReceipt').onclick=async()=>{
      const locationId=Number($('#receiptLocation').value||state.inbound.locationId);
      if(!locationId)return toast('Select the receiving warehouse or retail location.','error');
      try{
        const result=await api('/receiving',{method:'POST',body:JSON.stringify({
          shipmentId,locationId,documentRef:$('#receiptReference').value,notes:$('#receiptNotes').value,
          lines:state.inbound.receiptLines,
        })});
        toast(`${result.receiptNo} posted to ${result.location.code}`);
        state.inbound.receiptLines=[];state.inbound.shipment=null;state.inbound.locationId=null;
        const __rid=result.receiptId,__rno=result.receiptNo,__loc=(result.location&&result.location.code)||'';
        await renderGoodsReceipt();
        modal('Goods Receipt posted',`<div class="operational-form"><p><b>${esc(__rno)}</b> was posted${__loc?(' to '+esc(__loc)):''}.</p><p style="color:#556;font-size:12px;margin:4px 0 10px">Print the Goods Receipt Note now, or reprint it anytime from the receipt row.</p><div class="modal-actions"><button type="button" class="command primary" id="grPrintNow">Print GR</button><button type="button" class="command" id="grReprint">Reprint</button><button type="button" class="command" id="grDone">Done</button></div></div>`);
        const __pf=()=>{try{if(window.czPrintGRN&&__rid)window.czPrintGRN(__rid);}catch(e){}};
        const __mb=$('#modalBody');
        if(__mb){if(__mb.querySelector('#grPrintNow'))__mb.querySelector('#grPrintNow').onclick=__pf;
          if(__mb.querySelector('#grReprint'))__mb.querySelector('#grReprint').onclick=__pf;
          if(__mb.querySelector('#grDone'))__mb.querySelector('#grDone').onclick=()=>closeModal();}
      }catch(error){toast(error.message,'error');}
    };
  }catch(error){showWorkspaceError(error);}
}

async function renderInboundDiscrepancies(){
  content.innerHTML='<div class="workspace-loading">Loading discrepancy reports…</div>';
  try{
    const [summary,details]=await Promise.all([
      api('/receiving/reports/reconciliation'),
      api('/receiving/reports/discrepancies?status=OPEN'),
    ]);
    const __hasVar=row=>Number(row.quantity_variance||0)!==0||Number(row.open_variances||0)!==0;
    const summaryRows=summary.rows.map(row=>{const qv=Number(row.quantity_variance||0),sv=Number(row.open_variances||0);
      return `<tr class="disc-row ${__hasVar(row)?'has-var':'no-var'}"><td><b>${esc(row.shipment_no)}</b></td><td>${esc(row.purchase_order_no||'-')}</td>
      <td>${esc(row.receipt_locations||'-')}</td><td>${esc(row.expected_qty)}</td><td>${esc(row.received_qty)}</td>
      <td${qv!==0?' class="var-hot"':''}>${esc(row.quantity_variance)}</td><td${sv!==0?' class="var-hot"':''}>${esc(row.open_variances)}</td><td>${statusBadge(row.reconciliation_status)}</td></tr>`;});
    const __anyVar=summary.rows.some(__hasVar);const __odClick=Number(summary.totals.openVariances||0)>0;
    const detailRows=details.rows.map(row=>`<tr><td><b>${esc(row.variance_no)}</b></td><td>${esc(row.purchase_order_no||'-')}</td><td>${esc(row.shipment_no)}</td>
      <td>${esc(row.receipt_no)}</td><td>${esc(row.location_code)}</td><td>${esc(row.variance_type)}</td>
      <td>${esc(row.expected_serial_no||'-')}</td><td>${esc(row.actual_serial_no||'-')}</td><td>${esc(row.reason||'-')}</td>
      <td><button class="table-action" data-resolve-variance="${row.id}">Resolve</button></td></tr>`);
    const body=`${workflowStrip(['Purchase Order','ATLAS Expected Shipment','Goods Receipt','Warehouse Visibility'],3)}
      <div class="workspace-kpis">
        <article class="workspace-kpi"><span>Shipments</span><strong>${esc(summary.totals.shipments)}</strong></article>
        <article class="workspace-kpi"><span>Expected</span><strong>${esc(summary.totals.expected)}</strong></article>
        <article class="workspace-kpi"><span>Received</span><strong>${esc(summary.totals.received)}</strong></article>
        <article class="workspace-kpi ${__odClick?'kpi-click':''}" ${__odClick?'id="kpiOpenDisc" role="button" tabindex="0" title="Jump to the exceptions to resolve"':''}><span>Open Discrepancies</span><strong>${esc(summary.totals.openVariances)}</strong></article>
      </div>
      <section class="workspace-card"><header><div><h2>Expected Shipment vs Goods Receipt</h2></div>
        <label class="disc-toggle"><input type="checkbox" id="discShowAll" ${__anyVar?'':'checked'}> Show shipments with no variance</label></header>
        ${__anyVar?'':'<div class="recon-clean"><b>All shipments reconcile</b><p>Every received shipment matches its ATLAS manifest, with no quantity or serial variances.</p></div>'}
        <div id="discSummaryWrap" class="${__anyVar?'only-var':''}">${operationalTable(['Shipment','Purchase Order','Receipt Locations','Expected','Received','Qty Variance','Serial Variances','Status'],summaryRows)}</div></section>
      <section class="workspace-card" id="openDiscSection"><header><h2>Open Serial Discrepancies</h2><span>${details.total} exceptions</span></header>
        ${details.total?operationalTable(['Variance','PO','Shipment','Receipt','Location','Type','Expected Serial','Actual Serial','Reason','Action'],detailRows):'<div class="recon-clean"><b>No open serial discrepancies</b><p>Nothing to resolve. Unexpected or missing serials from receiving would appear here.</p></div>'}</section>`;
    content.innerHTML=workbenchShell(body,'setup');
    bindOperationalShell();
    const __kod=$('#kpiOpenDisc');if(__kod){const __jump=()=>{const el=document.getElementById('openDiscSection');if(el)el.scrollIntoView({behavior:'smooth',block:'start'});};__kod.onclick=__jump;__kod.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();__jump();}};}
    const __sa=$('#discShowAll');if(__sa)__sa.onchange=()=>{const w=$('#discSummaryWrap');if(w)w.classList.toggle('only-var',!__sa.checked);};
    $$('[data-resolve-variance]').forEach(button=>button.onclick=()=>{
      modal('Resolve receiving discrepancy',`<form id="resolveVariance" class="operational-form"><label><span>Resolution</span><textarea name="resolution" required placeholder="Document the approved resolution"></textarea></label><button class="command primary">Resolve</button></form>`);
      $('#resolveVariance').onsubmit=async event=>{
        event.preventDefault();
        try{await api(`/receiving/variances/${button.dataset.resolveVariance}/resolve`,{method:'POST',body:JSON.stringify(formDataObject(event.currentTarget))});closeModal();toast('Discrepancy resolved');await renderInboundDiscrepancies();}
        catch(error){toast(error.message,'error');}
      };
    });
  }catch(error){showWorkspaceError(error);}
}

async function renderOutboundWorkspace(section){
  if(section==='records')return renderOutboundRequisitions();
  if(section==='approvals')return renderPreRelease();
  if(section==='reports')return renderGoodsIssuance();
  if(section==='setup')return renderDeliveryReturns();
  return renderOutboundOverview();
}

async function renderOutboundOverview(){
  content.innerHTML='<div class="workspace-loading">Loading outbound control center…</div>';
  try{
    const data=await api('/requisitions/outbound-workbench');
    const open=data.requisitions.filter(row=>!['FULFILLED','CANCELLED'].includes(row.status));
    const ready=data.deliveries.filter(row=>['PLANNED','READY'].includes(row.status));
    const inTransit=data.deliveries.filter(row=>row.status==='RELEASED');
    const returnable=data.requisitions.filter(row=>row.status==='FULFILLED'&&row.expected_return_date);
    const rows=open.slice(0,20).map(row=>`<tr><td><b>${esc(row.requisition_no)}</b></td><td>${esc(row.request_type||'-')}</td>
      <td>${esc(row.holder_type||'-')}</td><td>${esc(row.holder_name||row.partner_name||'-')}</td><td>${date(row.required_date)}</td>
      <td>${esc(row.serial_count||0)}</td><td>${esc(row.total_qty||0)}</td><td>${statusBadge(row.status)}</td></tr>`);
    const body=`${workflowStrip(['Requisition','Pre-release Checklist','Goods Issuance','Delivery / Custody'],0)}
      <div class="workspace-kpis">${kpi('Open Requisitions',open.length,{section:'records'})}${kpi('Ready to Issue',ready.length,{section:'approvals'})}
        ${kpi('Out for Delivery',inTransit.length,{section:'reports'})}${kpi('Expected Returns',returnable.length,{section:'setup'})}</div>
      <div class="ramco-layout"><div class="ramco-main"><section class="workspace-card">
        <header><div><h2>Outbound & Custody Work Summary</h2></div>
          <button class="ramco-primary" data-section-link="records">New Requisition</button></header>
        ${operationalTable(['Requisition','Purpose','Holder Type','Holder','Required','Serials','Total Qty','Status'],rows)}
      </section></div><aside class="ramco-rail"><section><header>Transaction Launchpad</header><div class="ramco-action-links">
        <button data-section-link="records">Create Requisition</button><button data-section-link="approvals">Pre-release Inspection</button>
        <button data-section-link="reports">Post Goods Issuance</button><button data-section-link="setup">Delivery & Goods Return</button>
      </div></section></aside></div>`;
    content.innerHTML=workbenchShell(body,'center');bindOperationalShell();
  }catch(error){showWorkspaceError(error);}
}

async function renderOutboundRequisitions(){
  content.innerHTML='<div class="workspace-loading">Loading requisitions…</div>';
  try{
    const [lookups,data,deptData]=await Promise.all([api('/requisitions/lookups'),api('/requisitions/outbound-workbench'),api('/admin/records/departments').catch(()=>({rows:[]}))]);
    const departments=(deptData&&deptData.rows)||[];
    // A sales order that already has a requisition disappears from the picker so it cannot be double-processed
    const usedOrders=new Set();
    (data.requisitions||[]).forEach(r=>{[r.source_order_id,r.sales_order_id,r.order_id].forEach(v=>{if(v)usedOrders.add(String(v));});
      [r.sales_order_no,r.source_order_no].forEach(v=>{if(v)usedOrders.add(String(v));});});
    const openOrders=(lookups.orders||[]).filter(o=>!usedOrders.has(String(o.id))&&!usedOrders.has(String(o.sales_order_no)));
    const rows=data.requisitions.map(row=>`<tr><td><b>${esc(row.requisition_no)}</b></td><td>${date(row.request_date)}</td>
      <td>${esc(row.request_type||'-')}</td><td>${esc(row.holder_type||'-')}</td><td>${esc(row.holder_name||'-')}</td>
      <td>${esc(row.serial_count||0)}</td><td>${esc(row.total_qty||0)}</td><td>${date(row.required_date)}</td><td>${statusBadge(row.status)}</td>
      <td><button class="table-action" data-req-open="${row.id}">Open</button>${['SUBMITTED','DRAFT'].includes(row.status)&&can('REQUISITIONS','APPROVE')?`<button class="table-action" data-approve-requisition="${row.id}">Approve</button>`:''}<button class="table-action" data-print-req="${row.id}">Print Slip</button></td></tr>`);
    const body=`${workflowStrip(['Requisition','Pre-release Checklist','Goods Issuance','Delivery / Custody'],0)}
      <section class="workspace-card"><header><div><h2>Create Requisition Slip</h2></div><span>AUTO REFERENCE</span></header>
        <form id="requisitionForm" class="operational-form grid">
          <label><span>Request Type</span><select name="requestType">${lookups.requestTypes.map(value=>`<option>${esc(value)}</option>`).join('')}</select></label>
          <label><span>Holder Type</span><select name="holderType" id="holderType">${lookups.holderTypes.map(value=>`<option>${esc(value)}</option>`).join('')}</select></label>
          <label><span>Existing Customer / Employee</span><select name="holderPartnerId" id="holderPartner"><option value="">Enter a holder below…</option>${lookups.holders.map(row=>`<option value="${row.id}" data-name="${esc(row.name)}" data-email="${esc(row.email||'')}">${esc(row.partner_type)} · ${esc(row.name)}</option>`).join('')}</select></label>
          <label><span>Holder / Department / Demo / Project Name</span><input name="holderName" id="holderName" required></label>
          <label><span>Holder Email</span><input name="holderEmail" id="holderEmail" type="email"></label>
          <label><span>Department</span><select name="department"><option value="">Select department…</option>${departments.map(d=>`<option${d.name===(state.session.user.department||'')?' selected':''}>${esc(d.name)}</option>`).join('')}</select></label>
          <label><span>Required Date</span><input name="requiredDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label>
          <label><span>Expected Return Date</span><input name="expectedReturnDate" type="date"></label>
          <label><span>Source Sales / Lease Order</span><select name="sourceOrderId" id="sourceOrder"><option value="">Not order-related</option>${openOrders.map(order=>`<option value="${order.id}" data-no="${esc(order.sales_order_no)}" data-customer="${esc(order.customer_name)}" data-customer-id="${order.customer_id}" data-destination="${esc(order.delivery_address||'')}">${esc(order.sales_order_no)} · ${esc(order.transaction_type)} · ${esc(order.customer_name)}</option>`).join('')}</select></label>
          <label class="wide"><span>Purpose / Custody Reason</span><input name="purpose" required placeholder="Lease deployment, employee use, demo, sale, pilot, project, or internal use"></label>
          <label class="wide"><span>Destination</span><input name="destination" id="requisitionDestination" required></label>
          <div class="wide line-editor-head"><b>Requested Items and Available Serials</b><button type="button" id="addRequisitionLine">Add Item</button></div>
          <div id="requisitionLines" class="wide line-editor requisition-lines"></div>
          <label class="wide"><span>Remarks</span><textarea name="remarks"></textarea></label>
          <button class="command primary">Submit Requisition</button>
        </form>
      </section>
      <section class="workspace-card"><header><h2>Requisition Register</h2><span>${data.requisitions.length} documents</span></header>
        ${operationalTable(['Requisition','Date','Purpose','Holder Type','Holder','Serials','Qty','Required','Status','Action'],rows)}</section>`;
    content.innerHTML=workbenchShell(body,'records');bindOperationalShell();
    const addLine=()=>{
      const row=document.createElement('div');row.className='requisition-line';
      row.innerHTML=`<select data-req="itemId"><option value="">Select item…</option>${lookups.items.map(item=>`<option value="${item.id}" data-serialized="${item.serialized}" data-code="${esc(item.item_code)}">${esc(item.category)} · ${esc(item.item_code)} · ${esc(item.item_name)}</option>`).join('')}</select>
        <div class="serial-picker" data-req="serials"><select class="serial-add" disabled><option value="">Select an item first</option></select><div class="serial-chips"></div></div>
        <input data-req="qty" type="number" min="0.01" step="0.01" value="1" placeholder="Quantity">
        <input data-req="description" placeholder="Line description"><button type="button" class="remove-line">×</button>`;
      const itemSelect=row.querySelector('[data-req="itemId"]');
      const picker=row.querySelector('.serial-picker');
      const adder=picker.querySelector('.serial-add');
      const chips=picker.querySelector('.serial-chips');
      const qtyInput=row.querySelector('[data-req="qty"]');
      const syncQty=()=>{if(picker.dataset.serialized==='1')qtyInput.value=chips.querySelectorAll('.serial-chip').length||1;};
      const addChip=(serial,loc)=>{const chip=document.createElement('span');chip.className='serial-chip';chip.dataset.serial=serial;chip.dataset.loc=loc||'';
        chip.innerHTML=`<span>${esc(serial)}</span><button type="button" title="Remove" aria-label="Remove ${esc(serial)}">×</button>`;
        chip.querySelector('button').onclick=()=>{const o=document.createElement('option');o.value=serial;o.dataset.loc=loc||'';o.textContent=serial+(loc?` · ${loc}`:'');adder.append(o);chip.remove();syncQty();};
        chips.append(chip);};
      itemSelect.onchange=()=>{
        const itemId=Number(itemSelect.value);
        const item=lookups.items.find(value=>value.id===itemId);
        const assets=lookups.assets.filter(asset=>asset.item_id===itemId);
        chips.innerHTML='';picker.dataset.serialized=item?.serialized?'1':'0';
        if(item?.serialized){
          adder.innerHTML=assets.length?'<option value="">Add a serial…</option>'+assets.map(asset=>`<option value="${esc(asset.serial_no)}" data-loc="${esc(asset.current_location_code||'')}">${esc(asset.serial_no)} · ${esc(asset.current_location_code||'No location')}</option>`).join(''):'<option value="">No available serials</option>';
          adder.disabled=!assets.length;picker.style.display='';qtyInput.readOnly=true;qtyInput.value=1;
        }else{adder.innerHTML='<option value="">Not serialized</option>';adder.disabled=true;picker.style.display='none';qtyInput.readOnly=false;}
      };
      adder.onchange=()=>{const opt=adder.selectedOptions[0];if(!opt||!opt.value)return;addChip(opt.value,opt.dataset.loc);opt.remove();adder.value='';syncQty();};
      row.querySelector('.remove-line').onclick=()=>row.remove();$('#requisitionLines').append(row);
    };
    addLine();$('#addRequisitionLine').onclick=addLine;
    $('#holderPartner').onchange=event=>{
      const option=event.target.selectedOptions[0];if(!option?.value)return;
      $('#holderName').value=option.dataset.name||'';$('#holderEmail').value=option.dataset.email||'';
    };
    $('#sourceOrder').onchange=event=>{
      const option=event.target.selectedOptions[0];if(!option?.value)return;
      $('#holderName').value=option.dataset.customer||'';$('#holderPartner').value=option.dataset.customerId||'';
      $('#requisitionDestination').value=option.dataset.destination||'';
    };
    $('#requisitionForm').onsubmit=async event=>{
      event.preventDefault();const payload=formDataObject(event.currentTarget);
      const order=$('#sourceOrder').selectedOptions[0];payload.sourceOrderNo=order?.dataset.no||'';
      payload.lines=$$('.requisition-line').map(row=>{
        const itemId=Number(row.querySelector('[data-req="itemId"]').value);
        const item=lookups.items.find(value=>value.id===itemId);
        return {itemId,itemCode:item?.item_code,itemName:item?.item_name,category:item?.category,
          serialRequired:!!item?.serialized,serials:[...row.querySelectorAll('.serial-chip')].map(chip=>chip.dataset.serial),
          qty:Number(row.querySelector('[data-req="qty"]').value||0),description:row.querySelector('[data-req="description"]').value||item?.item_name};
      }).filter(line=>line.itemId);
      try{const result=await api('/requisitions',{method:'POST',body:JSON.stringify(payload)});toast(`${result.requisitionNo} created`);await renderOutboundRequisitions();}
      catch(error){toast(error.message,'error');}
    };
    $$('[data-approve-requisition]').forEach(button=>button.onclick=async()=>{
      try{const result=await api(`/requisitions/${button.dataset.approveRequisition}/approve`,{method:'POST',body:'{}'});toast(`${result.assignmentNo} and ${result.deliveryNo} created`);await renderOutboundRequisitions();}
      catch(error){toast(error.message,'error');}
    });
    $$('[data-req-open]').forEach(button=>button.onclick=event=>{event.stopPropagation();openRequisitionDetail(Number(button.dataset.reqOpen),lookups);});
  }catch(error){showWorkspaceError(error);}
}

function serialChipify(picker){if(!picker)return;const adder=picker.querySelector('.serial-add'),chips=picker.querySelector('.serial-chips');if(!adder||!chips)return;
  adder.onchange=()=>{const opt=adder.selectedOptions[0];if(!opt||!opt.value)return;const chip=document.createElement('span');chip.className='serial-chip';chip.dataset.serial=opt.value;
    chip.innerHTML=`<span>${esc(opt.value)}</span><button type="button" title="Remove" aria-label="Remove ${esc(opt.value)}">×</button>`;
    chip.querySelector('button').onclick=()=>{opt.hidden=false;chip.remove();};opt.hidden=true;chips.append(chip);adder.value='';};}
function serialChipValues(picker){return picker?[...picker.querySelectorAll('.serial-chip')].map(c=>c.dataset.serial):[];}
async function openRequisitionDetail(id,lookups){
  try{
    const data=await api('/requisitions/'+id);
    const h=data.header||{};
    const editable=!['APPROVED','ISSUED','FULFILLED','CANCELLED'].includes(h.status);
    const allocRows=(data.allocations||[]).filter(a=>a.asset_id).map(a=>`<tr><td><b>${esc(a.serial_no)}</b></td><td>${esc(a.item_code||'-')}</td><td>${esc(a.item_name||'-')}</td><td>${esc(a.category||'-')}</td><td>${statusBadge(a.allocation_status||'SELECTED')}</td></tr>`).join('');
    const lineRows=(data.lines||[]).map(l=>`<tr><td>${esc(l.item_code||'-')}</td><td>${esc(l.description||l.item_name||'-')}</td><td class="num">${esc(l.qty||0)}</td><td>${l.serial_required?'Serialized':'Quantity'}</td></tr>`).join('');
    const usedSerials=new Set((data.allocations||[]).filter(a=>a.serial_no).map(a=>a.serial_no));
    const avail=(lookups.assets||[]).filter(a=>!usedSerials.has(a.serial_no));
    const byItem={};avail.forEach(a=>{(byItem[a.item_name||a.item_code]=byItem[a.item_name||a.item_code]||[]).push(a);});
    const optgroups=Object.keys(byItem).sort().map(name=>`<optgroup label="${esc(name)} (${byItem[name].length} available)">${byItem[name].map(a=>`<option value="${esc(a.serial_no)}">${esc(a.category)} · ${esc(a.serial_no)} · ${esc(a.current_location_code||'No location')}</option>`).join('')}</optgroup>`).join('');
    const allocateBlock=editable?`
      <section class="record-sublist">
        <header><div><h3>Allocate Available Serials</h3><p>Pick the exact units to reserve on this requisition. Motorcycles then flow to the Pre-release checklist.</p></div></header>
        <div class="lease-unit-picker"><label><span>Available Serial Numbers</span>
          <div class="serial-picker" id="reqAllocPicker"><select class="serial-add"><option value="">Add a serial…</option>${optgroups||''}</select><div class="serial-chips"></div></div></label>
          <div><button type="button" class="command primary" id="reqAllocBtn">Allocate Selected Serials</button></div></div>
      </section>`:'';
    const approveBtn=(['SUBMITTED','DRAFT'].includes(h.status)&&can('REQUISITIONS','APPROVE'))?`<button type="button" class="command primary" id="reqApproveBtn">Approve &amp; Create Delivery</button>`:'';
    const body=`<div class="definition-list" style="margin-bottom:12px">
        <div><b>Holder</b><span>${esc(h.holder_name||h.partner_name||'-')} (${esc(h.holder_type||'-')})</span></div>
        <div><b>Purpose</b><span>${esc(h.purpose||h.custody_purpose||'-')}</span></div>
        <div><b>Destination</b><span>${esc(h.destination||'-')}</span></div>
        <div><b>Required</b><span>${esc(date(h.required_date))}</span></div>
        <div><b>Status</b><span>${statusBadge(h.status)}</span></div></div>
      <section class="record-sublist"><header><div><h3>Requested Lines</h3></div></header>
        ${operationalTable(['Item','Description','Qty','Type'],lineRows?[lineRows]:[])}</section>
      <section class="record-sublist"><header><div><h3>Allocated Serials</h3><p>${usedSerials.size} reserved</p></div></header>
        ${operationalTable(['Serial','Item','Description','Class','Status'],allocRows?[allocRows]:[])}</section>
      ${allocateBlock}
      <div class="modal-actions">${approveBtn}<button type="button" class="table-action" data-print-req="${id}">Print Requisition Slip</button><button type="button" class="table-action" data-print-pickslip="${id}">Print Pick Slip</button></div>`;
    modal('Requisition '+esc(h.requisition_no||id),body,esc(h.holder_name||''));
    const mb=$('#modalBody');
    serialChipify(mb.querySelector('#reqAllocPicker'));
    const allocBtn=mb.querySelector('#reqAllocBtn');
    if(allocBtn)allocBtn.onclick=async()=>{
      const serials=serialChipValues(mb.querySelector('#reqAllocPicker'));
      if(!serials.length){toast('Select at least one serial.','error');return;}
      try{const r=await api('/requisitions/'+id+'/allocate',{method:'POST',body:JSON.stringify({serials})});
        toast(r.allocated+' serial(s) allocated. Requisition is ready to approve.');closeModal();await renderOutboundRequisitions();openRequisitionDetail(id,lookups);}
      catch(e){toast(e.message,'error');}
    };
    const apprBtn=mb.querySelector('#reqApproveBtn');
    if(apprBtn)apprBtn.onclick=async()=>{
      try{const r=await api('/requisitions/'+id+'/approve',{method:'POST',body:'{}'});
        toast('Approved. '+r.deliveryNo+' created - now run Pre-release, then Goods Issuance.');closeModal();await renderOutboundRequisitions();}
      catch(e){toast(e.message,'error');}
    };
    mb.querySelectorAll('[data-print-req]').forEach(b=>b.onclick=()=>{if(window.czPrintRequisition)window.czPrintRequisition(id);});
  }catch(error){toast(error.message,'error');}
}

async function renderPreRelease(){
  content.innerHTML='<div class="workspace-loading">Loading pre-release worklist…</div>';
  try{
    const data=await api('/requisitions/outbound-workbench');
    const latest=new Map();for(const check of data.checks)if(!latest.has(check.serial_no))latest.set(check.serial_no,check);
    const rows=data.allocations.filter(row=>row.asset_id&&row.category==='MC'&&/^R5FBM/i.test(row.serial_no||'')&&['RESERVED','ISSUED'].includes(row.allocation_status)).map(row=>{
      const check=latest.get(row.serial_no);
      return `<tr><td><b>${esc(row.requisition_no)}</b></td><td>${esc(row.serial_no)}</td><td>${esc(row.item_name)}</td>
        <td>${esc(row.current_location_code||'-')}</td><td>${check?statusBadge(check.result):statusBadge('PENDING')}</td>
        <td>${check?date(check.check_date):'-'}</td><td><button class="table-action" data-checklist="${esc(row.serial_no)}" data-unit="${esc(row.item_name)}" data-req="${esc(row.requisition_no)}">Open checklist</button></td></tr>`;
    });
    const body=`${workflowStrip(['Requisition','Pre-release Checklist','Goods Issuance','Delivery / Custody'],1)}
      <section class="workspace-card"><header><div><h2>Pre-release Checklist Worklist</h2></div></header>
        ${operationalTable(['Requisition','Serial','Unit','Location','Result','Checked','Action'],rows)}</section>`;
    let __regRows=[];try{let __all=[];for(let __p=1;__p<=8;__p++){const __rg=await api('/checklists?size=250&page='+__p);const __rr=(__rg.rows||[]);__all=__all.concat(__rr);if(__rr.length<250)break;}__regRows=__all.map(r=>{const pend=/PENDING/i.test(r.result||'');const raw=r.serial_no||'';const m=raw.match(/R5FBM\w+/i);const cs=m?m[0]:raw;const act=pend?`<button class="table-action" data-open-pdi="${esc(cs)}" data-unit="${esc(raw.slice(0,40))}">Open & inspect</button>`:'-';return `<tr><td><b>${esc(r.checklist_no)}</b></td><td>${esc(raw.slice(0,48))}</td><td>${statusBadge(r.result)}</td><td>${esc(r.approved_by||'-')}</td><td>${esc((r.created_at||'').slice(0,10))}</td><td>${act}</td></tr>`;});}catch(e){}const __regBody=`<section class="workspace-card"><header><div><h2>Pre-release Checklist Register</h2><span>All ${__regRows.length} inspection records (actuals). Pending rows can be opened and completed.</span></div></header>${operationalTable(['Checklist #','Serial / Unit','Result','Approved By','Recorded','Action'],__regRows)}</section>`;content.innerHTML=workbenchShell(body+__regBody,'approvals');bindOperationalShell();
    const PDI_ITEMS=[['vin','VIN matches the record'],['batteryA','Battery A seated & assigned'],['batteryB','Battery B seated & assigned'],['charger','Charger provided & tested'],['pdi','PDI (physical pre-delivery inspection) done'],['pdiform','PDI form completed & signed'],['hydra','Batteries assigned in Hydra'],['apptest','App testing done'],['account','Rider account created']];
    const openPdi=(serial,unit,req)=>{
      const items=PDI_ITEMS.map(([k,label])=>`<label class="pdi-check"><input type="checkbox" data-pdi="${k}" checked><span>${esc(label)}</span></label>`).join('');
      modal('Pre-release Inspection · '+serial,`<form id="pdiForm" class="operational-form">
        <div class="pdi-grid">${items}</div>
        <label class="pdi-notes">Defect notes <span>(required if any item is unchecked)</span>
          <textarea data-pdi-notes rows="2" placeholder="Describe any defect found"></textarea></label>
        <div class="modal-actions"><button type="button" class="table-action" data-pdi-tick>Tick all (pass)</button>
        <button type="button" class="table-action danger" data-pdi-clear>Clear all</button>
        <button type="submit" class="primary-action">Submit inspection</button></div></form>`,(req?req+' · ':'')+unit);
      const form=$('#modalBody').querySelector('#pdiForm');
      form.querySelector('[data-pdi-tick]').onclick=()=>form.querySelectorAll('[data-pdi]').forEach(c=>c.checked=true);
      form.querySelector('[data-pdi-clear]').onclick=()=>form.querySelectorAll('[data-pdi]').forEach(c=>c.checked=false);
      form.onsubmit=async e=>{
        e.preventDefault();
        const checklist={};const failed=[];
        form.querySelectorAll('[data-pdi]').forEach(c=>{checklist[c.dataset.pdi]=c.checked;if(!c.checked)failed.push((PDI_ITEMS.find(i=>i[0]===c.dataset.pdi)||[,c.dataset.pdi])[1]);});
        const notes=(form.querySelector('[data-pdi-notes]').value||'').trim();
        if(failed.length&&!notes){toast('Enter defect notes for the unchecked items.','error');return;}
        const result=failed.length?'FAILED':'PASSED';
        const defects=failed.length?failed.concat(notes?['Notes: '+notes]:[]):[];
        try{const r=await api('/checklists',{method:'POST',body:JSON.stringify({serialNo:serial,result,defects,checklist})});
          toast(`${r.checklistNo}: ${r.result}`);closeModal();await renderPreRelease();}
        catch(err){toast(err.message,'error');}
      };
    };
    $$('[data-checklist]').forEach(button=>button.onclick=()=>openPdi(button.dataset.checklist,button.dataset.unit||'',button.dataset.req||''));
    $$('[data-open-pdi]').forEach(button=>button.onclick=()=>openPdi(button.dataset.openPdi,button.dataset.unit||'',''));
  }catch(error){showWorkspaceError(error);}
}

async function renderGoodsIssuance(){
  content.innerHTML='<div class="workspace-loading">Loading goods issuance…</div>';
  try{
    const data=await api('/requisitions/outbound-workbench');
    const rows=data.deliveries.filter(row=>['PLANNED','READY'].includes(row.status)).map(row=>`<tr><td><b>${esc(row.delivery_no)}</b></td>
      <td>${esc(row.requisition_no)}</td><td>${esc(row.assignment_no)}</td><td>${date(row.scheduled_date)}</td><td>${esc(row.destination)}</td>
      <td>${esc(row.recipient_name)}</td><td>${esc(row.serial_count)}</td><td>${statusBadge(row.status)}</td>
      <td><button class="table-action" data-release-delivery="${row.id}">Post Goods Issuance</button></td></tr>`);
    const body=`${workflowStrip(['Requisition','Pre-release Checklist','Goods Issuance','Delivery / Custody'],2)}
      <section class="workspace-card"><header><div><h2>Goods Issuance Worklist</h2></div></header>
      ${rows.length?operationalTable(['Delivery','Requisition','Assignment','Schedule','Destination','Holder','Serials','Status','Action'],rows):outboundEmptyHint('No deliveries are waiting to be issued.','A delivery lands here automatically once you approve a requisition (Requisitions tab, Approve & Create Delivery). For motorcycles, pass the Pre-release checklist first, then use Post Goods Issuance here.')}</section>`;
    let __gi=[];try{for(let __p=1;__p<=8;__p++){const __r=await api('/deliveries?size=250&page='+__p);const __rr=(__r.rows||[]);__gi=__gi.concat(__rr);if(__rr.length<250)break;}}catch(e){}
    const __giRows=__gi.map(r=>`<tr class="clickable-row" data-gi-open="${r.id}" data-gi-status="${esc(r.status)}"><td><b>${esc(r.delivery_no)}</b> <button class="table-action" data-print-dlv="${r.id}">Print</button></td><td>${esc(r.requisition_no||r.sales_order_no||'-')}</td><td>${esc(r.assignment_no||'-')}</td><td>${esc(r.destination||'-')}</td><td>${esc(r.recipient_name||'-')}</td><td>${esc(r.asset_count||0)}</td><td>${statusBadge(r.status)}</td><td>${esc((r.scheduled_date||r.created_at||'').slice(0,10))}</td></tr>`);
    const __giBody=`<section class="workspace-card"><header><div><h2>Goods Issuance Register</h2><span>All ${__gi.length} outbound movements (actuals).</span></div></header>${operationalTable(['Delivery','Requisition','Assignment','Destination','Holder','Serials','Status','Date'],__giRows)}</section>`;
    content.innerHTML=workbenchShell(body+__giBody,'reports');bindOperationalShell();
    $$('[data-release-delivery]').forEach(button=>button.onclick=async event=>{
      event.stopPropagation();
      try{const result=await api(`/deliveries/${button.dataset.releaseDelivery}/release`,{method:'POST',body:JSON.stringify({releaseDate:new Date().toISOString()})});toast(`${result.released} serialized units issued`);await renderGoodsIssuance();}
      catch(error){toast(error.message,'error');}
    });
    // Every goods-issue row opens its delivery so the movement can be updated from the card.
    $$('[data-gi-open]').forEach(row=>row.onclick=event=>{
      if(event.target.closest('button'))return;
      openDeliveryCard(Number(row.dataset.giOpen),renderGoodsIssuance);
    });
  }catch(error){showWorkspaceError(error);}
}

async function renderDeliveryReturns(){
  content.innerHTML='<div class="workspace-loading">Loading delivery and returns…</div>';
  try{
    const [data,assignmentReturns,salesReturns,returnRegister,lookups]=await Promise.all([
      api('/requisitions/outbound-workbench'),api('/returns/assignments/active'),
      api('/returns/deliveries/returnable'),api('/returns?size=500'),api('/masters/lookups'),
    ]);
    let __dall=[];try{for(let __p=1;__p<=8;__p++){const __r=await api('/deliveries?size=250&page='+__p);const __rr=(__r.rows||[]);__dall=__dall.concat(__rr);if(__rr.length<250)break;}}catch(e){}
    const __dallRows=__dall.map(r=>`<tr><td><b>${esc(r.delivery_no)}</b> <button class="table-action" data-print-dlv="${r.id}">Print</button></td><td>${esc(r.requisition_no||r.sales_order_no||'-')}</td><td>${esc(r.assignment_no||'-')}</td><td>${esc(r.destination||'-')}</td><td>${esc(r.recipient_name||'-')}</td><td>${esc(r.asset_count||0)}</td><td>${statusBadge(r.status)}</td><td>${esc((r.actual_delivery_date||r.scheduled_date||r.created_at||'').slice(0,10))}</td></tr>`);
    const __dallBody=`<section class="workspace-card"><header><div><h2>Delivery Register</h2><span>All ${__dall.length} deliveries (actuals).</span></div></header>${operationalTable(['Delivery','Requisition','Assignment / Sale','Destination','Holder','Serials','Status','Date'],__dallRows)}</section>`;
    const deliveryRows=data.deliveries.filter(row=>['RELEASED','DELIVERED'].includes(row.status)).map(row=>`<tr><td><b>${esc(row.delivery_no)}</b></td><td>${esc(row.requisition_no||'-')}</td>
      <td>${esc(row.assignment_no||row.sales_order_no||'-')}</td><td>${esc(row.destination)}</td><td>${esc(row.recipient_name)}</td><td>${statusBadge(row.status)}</td>
      <td>${row.status==='RELEASED'?`<button class="table-action" data-complete-delivery="${row.id}">Confirm Delivery</button>`:'-'}</td></tr>`);
    const returnRows=(returnRegister.rows||[]).map(row=>{const source=row.return_type==='SALES_RETURN'
      ?`${row.sales_order_no||'Sale'} / ${row.delivery_no||'Delivery'}`
      :(row.assignment_no||'Deployment');return `<tr><td><b>${esc(row.return_no)}</b></td><td>${esc(row.return_type||'CUSTODY_RETURN')}</td>
      <td>${esc(source)}</td><td>${esc(row.customer_name||row.partner_name||'-')}</td><td>${date(row.return_date)}</td>
      <td>${esc(row.return_location_code||'-')}</td><td>${esc(row.line_count)}</td><td>${row.return_type==='SALES_RETURN'&&Number(row.refund_gross_amount||0)>0?money(row.refund_gross_amount):'-'}</td>
      <td>${statusBadge(row.status)}</td><td>${row.status==='DRAFT'
        ?`<button class="table-action" data-post-return="${row.id}">Post Return</button><button class="table-action" data-edit-return="${row.id}">Edit</button><button class="table-action" data-void-return="${row.id}">Void</button>`
        :'-'}</td></tr>`;});
    const body=`${workflowStrip(['Requisition','Pre-release Checklist','Goods Issuance','Delivery / Custody'],3)}
      <section class="workspace-card"><header><h2>Delivery Confirmation</h2></header>
        ${deliveryRows.length?operationalTable(['Delivery','Requisition','Assignment / Sale','Destination','Holder','Status','Action'],deliveryRows):outboundEmptyHint('No deliveries are ready to confirm.','This list is only for confirming outbound deliveries to a customer or holder, which flow from an approved requisition then Goods Issuance. To bring a delivered unit back to the warehouse you do NOT need a requisition; use Create Goods Return below.')}</section>
      ${__dallBody}
      <section class="workspace-card"><header><div><h2>Create Goods Return</h2></div></header>
        <form id="returnForm" class="operational-form grid">
          <label><span>Return Source</span><select name="sourceType" id="returnSourceType"><option value="ASSIGNMENT">Deployment / Custody</option><option value="CUSTOMER_SALE">Customer Sale</option></select></label>
          <label class="wide" id="returnAssignmentWrap"><span>Active Deployment / Assignment</span><select name="assignmentId" id="returnAssignment"><option value="">Select deployment…</option>${assignmentReturns.rows.map(row=>`<option value="${row.id}">${esc(row.assignment_no)} · ${esc(row.assignment_type)} · ${esc(row.holder_name||row.partner_name)} · ${esc(row.asset_count)} units</option>`).join('')}</select></label>
          <label class="wide" id="returnSaleWrap" hidden><span>Delivered Customer Sale</span><select name="deliveryId" id="returnSale"><option value="">Select delivered sale…</option>${salesReturns.rows.map(row=>`<option value="${row.delivery_id}" data-gross="${Number(row.gross_amount||0)}">${esc(row.sales_order_no)} · ${esc(row.delivery_no)} · ${esc(row.customer_name)} · ${esc(row.returnable_assets)}/${esc(row.delivered_assets)} returnable</option>`).join('')}</select></label>
          <label><span>Return Date</span><input name="returnDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label>
          <label><span>Return Location</span><select name="returnLocationCode" id="returnLocation"><option value="RET-QUAR">RET-QUAR · Returns Quarantine</option>${lookups.locations.map(row=>`<option value="${esc(row.code)}" data-name="${esc(row.name)}" data-type="${esc(row.location_type)}">${esc(row.code)} · ${esc(row.name)}</option>`).join('')}</select></label>
          <label><span>Reason</span><select name="reasonCode"><option>CUSTOMER_RETURN</option><option>END_OF_LEASE</option><option>REPLACEMENT</option><option>EMPLOYEE_RETURN</option><option>DEMO_COMPLETE</option><option>REPAIR</option><option>OTHER</option></select></label>
          <label id="returnCreditWrap" hidden><span>Customer Credit</span><select name="issueCredit" id="returnIssueCredit"><option value="true">Create credit memo</option><option value="false">Physical return only</option></select></label>
          <label id="returnRefundWrap" hidden><span>Credit Gross Amount</span><input name="refundGrossAmount" id="returnRefundGross" type="number" min="0" step="0.01" placeholder="Auto-prorate when blank"></label>
          <div id="returnLines" class="wide return-line-editor">${operationalEmpty('Select a return source to load its serials.')}</div>
          <label class="wide"><span>Notes</span><textarea name="notes"></textarea></label>
          <button class="command primary">Create Goods Return</button>
        </form>
      </section>
      <section class="workspace-card"><header><h2>Goods Return Register</h2><span>${returnRegister.total||returnRows.length} returns</span></header>
        ${operationalTable(['Return','Type','Source','Customer / Holder','Date','Location','Lines','Credit','Status','Action'],returnRows)}</section>`;
    content.innerHTML=workbenchShell(body,'setup');bindOperationalShell();

    const renderReturnLines=assets=>{
      $('#returnLines').innerHTML=assets.length?assets.map(row=>`<div class="return-line" data-expected="${esc(row.serial_no)}" data-category="${esc(row.category)}">
        <b>${esc(row.category)} · ${esc(row.item_name||row.item_code)}</b><span>${esc(row.serial_no)}</span>
        <input data-return="actualSerial" value="${esc(row.serial_no)}" placeholder="Scan actual serial">
        <select data-return="condition"><option>GOOD</option><option>DAMAGED</option><option>FOR_REPAIR</option><option>MISSING_PARTS</option></select>
        <button type="button" class="table-action scan-return">Scan QR</button></div>`).join(''):operationalEmpty('No unreturned serialized units remain for this source.');
      $$('.scan-return').forEach(button=>button.onclick=()=>scanQrWithCamera(value=>{button.closest('.return-line').querySelector('[data-return="actualSerial"]').value=value;}));
    };
    const syncReturnSource=()=>{
      const isSale=$('#returnSourceType').value==='CUSTOMER_SALE';
      $('#returnAssignmentWrap').hidden=isSale;$('#returnSaleWrap').hidden=!isSale;
      $('#returnCreditWrap').hidden=!isSale;$('#returnRefundWrap').hidden=!isSale;
      $('#returnAssignment').required=!isSale;$('#returnSale').required=isSale;
      if(isSale){$('#returnAssignment').value='';const deliveryId=Number($('#returnSale').value);renderReturnLines(salesReturns.assets.filter(row=>row.delivery_id===deliveryId));}
      else{$('#returnSale').value='';$('#returnRefundGross').value='';const assignmentId=Number($('#returnAssignment').value);renderReturnLines(assignmentReturns.assets.filter(row=>row.assignment_id===assignmentId));}
    };
    $('#returnSourceType').onchange=syncReturnSource;
    $('#returnAssignment').onchange=syncReturnSource;
    $('#returnSale').onchange=()=>{const deliveryId=Number($('#returnSale').value);renderReturnLines(salesReturns.assets.filter(row=>row.delivery_id===deliveryId));};
    syncReturnSource();

    $('#returnForm').onsubmit=async event=>{
      event.preventDefault();const payload=formDataObject(event.currentTarget);
      const isSale=payload.sourceType==='CUSTOMER_SALE';
      if(isSale){delete payload.assignmentId;payload.deliveryId=Number(payload.deliveryId);payload.issueCredit=payload.issueCredit!=='false';}
      else{delete payload.deliveryId;delete payload.issueCredit;delete payload.refundGrossAmount;payload.assignmentId=Number(payload.assignmentId);}
      delete payload.sourceType;
      const location=$('#returnLocation').selectedOptions[0];
      payload.returnLocationName=location?.dataset.name||'Returns Quarantine';
      payload.returnLocationType=location?.dataset.type||'QUARANTINE';
      payload.lines=$$('.return-line').map(row=>({expectedSerial:row.dataset.expected,
        actualSerial:row.querySelector('[data-return="actualSerial"]').value,itemCategory:row.dataset.category,
        conditionCode:row.querySelector('[data-return="condition"]').value}));
      try{const result=await api('/returns',{method:'POST',body:JSON.stringify(payload)});toast(`${result.returnNo} created for review`);await renderDeliveryReturns();}
      catch(error){toast(error.message,'error');}
    };
    $$('[data-complete-delivery]').forEach(button=>button.onclick=async()=>{
      try{await api(`/deliveries/${button.dataset.completeDelivery}/complete`,{method:'POST',body:JSON.stringify({deliveryDate:new Date().toISOString()})});toast('Delivery, inventory, custody, and Finance source posting prepared');await renderDeliveryReturns();}
      catch(error){toast(error.message,'error');}
    });
    $$('[data-edit-return]').forEach(button=>button.onclick=()=>openReturnDraft(Number(button.dataset.editReturn),lookups,renderDeliveryReturns));
    $$('[data-void-return]').forEach(button=>button.onclick=async()=>{
      const reason=prompt('Reason for voiding this draft return:');
      if(reason===null)return;
      try{await api('/returns/'+button.dataset.voidReturn+'/void',{method:'POST',body:JSON.stringify({reason})});
        toast('Draft return voided');await renderDeliveryReturns();}
      catch(error){toast(error.message,'error');}});
    $$('[data-post-return]').forEach(button=>button.onclick=async()=>{
      try{const result=await api(`/returns/${button.dataset.postReturn}/post`,{method:'POST',body:'{}'});toast(result.returnType==='SALES_RETURN'?'Sales return posted with inventory and Finance entries':'Goods return posted and custody updated');await renderDeliveryReturns();}
      catch(error){toast(error.message,'error');}
    });
  }catch(error){showWorkspaceError(error);}
}

async function renderWarehouseWorkspace(section){
  if(section==='records')return renderWarehouseVisibility();
  if(section==='approvals')return renderStockMovement();
  if(section==='reports')return renderQrTrace();
  if(section==='setup')return renderLocationMaster();
  return renderWarehouseOverview();
}

async function renderWarehouseOverview(){
  content.innerHTML='<div class="workspace-loading">Loading warehouse visibility…</div>';
  try{
    const [data,classes]=await Promise.all([api('/inventory/visibility?size=1'),api('/inventory/by-class')]);
    const classOrder=['D400','R280','RSPORT','BAT','BSS','CHG','SP','OTH'];
    const byCode=new Map((classes.rows||[]).map(row=>[row.cls,row]));
    const classRows=classOrder.map(code=>byCode.get(code)).filter(Boolean);
    // Status first: what is sellable right now, what is stuck, what is unpriced.
    const sum=k=>classRows.reduce((t,r)=>t+Number(r[k]||0),0);
    const tiles=vizTiles([
      {label:'Total units',value:sum('total'),sub:'on the books',section:'records'},
      {label:'Available',value:sum('available'),tone:'good',sub:'ready to move',section:'records'},
      {label:'Deployed',value:sum('deployed'),sub:'with customers',section:'records'},
      {label:'Quarantine',value:sum('quarantine'),tone:sum('quarantine')?'serious':'good',
       sub:'held back',section:'records'},
      {label:'Missing cost',value:Number(data.summary?.unvalued_units||0),
       tone:Number(data.summary?.unvalued_units||0)?'critical':'good',sub:'unvalued units',section:'reports'}
    ]);
    // Where the stock sits, and what each class is worth - two questions, two charts,
    // never one chart with two scales.
    const mix=vizDonut(classRows.map(r=>({label:r.class_name,value:Number(r.total||0)})),
      {title:'Units by inventory class',totalLabel:'Units',keyLabel:'Class',valueLabel:'Units'});
    const byLoc=vizBars((data.byLocation||[]).map(r=>({label:r.location_code,value:Number(r.total_units||0)}))
        .sort((a,b)=>b.value-a.value),
      {title:'Units by location',keyLabel:'Location',valueLabel:'Units',limit:7,labelWidth:104});
    const value=vizBars(classRows.map(r=>({label:r.class_name,value:Number(r.inventory_value||0)}))
        .filter(r=>r.value>0).sort((a,b)=>b.value-a.value),
      {title:'Inventory value by class',money:true,color:VIZ.series[2],
       keyLabel:'Class',valueLabel:'Value',limit:7,labelWidth:104});
    const classKpis='';
    const locations=data.byLocation.map(row=>`<tr class="clickable-row" data-location-filter="${row.location_id}"><td><b>${esc(row.location_code)}</b></td><td>${esc(row.location_name)}</td>
      <td>${esc(row.location_type)}</td><td>${esc(row.total_units)}</td><td>${esc(row.available_units||0)}</td>
      <td>${esc(row.quarantine_units||0)}</td><td>${esc(row.unreconciled_units||0)}</td></tr>`);
    const items=(classes.items||[]).map(row=>`<tr class="clickable-row" data-item-filter="${esc(row.item_code)}" data-class-filter="${esc(row.class_code)}">
      <td>${esc(row.class_name)}</td><td><b>${esc(row.item_code)}</b></td><td>${esc(row.item_name)}</td>
      <td>${Number(row.total||0).toLocaleString()}</td><td>${Number(row.available||0).toLocaleString()}</td><td>${Number(row.deployed||0).toLocaleString()}</td>
      <td>${Number(row.quarantine||0).toLocaleString()}</td><td>${Number(row.unvalued||0).toLocaleString()}</td><td class="num">${money(row.inventory_value)}</td></tr>`);
    const body=`${tiles}
      <div class="viz-grid">${mix}${byLoc}${value}</div>
      <section class="workspace-card"><header><div><h2>Inventory by Exact Material Code</h2></div><button class="ramco-primary" data-section-link="records">Open Serial Register</button></header>
        ${operationalTable(['Inventory Class','Material Code','Tagged Item / Description','Total Serials','Available','Deployed','Quarantine','Missing Cost','Inventory Value'],items,{key:'warehouse-items',emptyMessage:'No classified inventory records. Apply migration 0022 and verify opening data.'})}</section>
      <div class="ramco-layout"><div class="ramco-main"><section class="workspace-card">
        <header><div><h2>Warehouse & Retail Location Visibility</h2></div></header>
        ${operationalTable(['Location','Name','Type','Total Units','Available','Quarantine','Unreconciled'],locations,{key:'warehouse-locations'})}
      </section></div><aside class="ramco-rail">
        <section><header>Visibility Actions</header><div class="ramco-action-links"><button data-section-link="records">Find Units</button>
          <button data-section-link="approvals">Move Units</button><button data-section-link="reports">QR Trace</button><button data-section-link="setup">Location Master</button></div></section>
        <section><header>Valuation Control</header><div class="definition-list"><div><b>Missing cost</b><span>${Number(data.summary?.unvalued_units||0).toLocaleString()}</span></div><div><b>Inventory value</b><span>${money(data.summary?.inventory_value)}</span></div></div></section>
      </aside></div>`;
    content.innerHTML=workbenchShell(body,'center');
    bindOperationalShell();
    bindViz(content,section=>openSection(section));
    $$('[data-location-filter]').forEach(row=>row.onclick=()=>renderWarehouseVisibility(row.dataset.locationFilter));
    $$('[data-item-filter]').forEach(row=>row.onclick=()=>renderWarehouseVisibility('',row.dataset.itemFilter,'',row.dataset.classFilter));
  }catch(error){showWorkspaceError(error);}
}

async function renderWarehouseVisibility(locationId='',search='',status='',category='',page=1){
  content.innerHTML='<div class="workspace-loading">Loading unit register…</div>';
  try{
    const size=100;
    const [data,lookups,byClass]=await Promise.all([
      api(`/inventory/visibility?${new URLSearchParams({locationId,q:search,status,category,page,size})}`),
      api('/masters/lookups'),
      api('/inventory/by-class'),
    ]);
    const rows=data.rows.map(row=>`<tr class="clickable-row" data-inventory-serial="${esc(row.serial_no)}"><td><b>${esc(row.serial_no)}</b></td><td>${esc(row.item_code||'-')}</td><td>${esc(row.item_name||'-')}</td>
      <td>${esc(row.category)}</td><td>${esc(row.location_code||'UNASSIGNED')}</td><td>${esc(row.location_name||'-')}</td>
      <td>${statusBadge(row.current_status)}</td><td>${esc(row.current_holder_name||'-')}</td><td class="num">${money(row.unit_cost)}</td><td>${statusBadge(row.valuation_status||'UNVALUED')}</td><td>${statusBadge(row.reconciliation_status)}</td></tr>`);
    const pages=Math.max(1,Math.ceil(Number(data.total||0)/size));
    const body=`<div class="workspace-commandbar">
      <input id="unitSearch" placeholder="Serial, material code, item, holder, or location" value="${esc(search)}">
      <select id="unitClass"><option value="">All inventory classes</option>${[['D400','Motorcycle D400'],['R280','Motorcycle R280'],['RSPORT','Motorcycle R280 Sport'],['BAT','Batteries'],['BSS','Lockers / BSS'],['CHG','Chargers'],['SP','Spare Parts & Accessories']].map(([value,label])=>`<option value="${value}" ${value===category?'selected':''}>${label}</option>`).join('')}</select>
      <select id="unitLocation"><option value="">All locations</option>${lookups.locations.map(row=>`<option value="${row.id}" ${Number(row.id)===Number(locationId)?'selected':''}>${esc(row.code)} · ${esc(row.name)}</option>`).join('')}</select>
      <select id="unitStatus"><option value="">All statuses</option>${['AVAILABLE','ASSIGNED','QUARANTINE','UNDER_REPAIR','LEASED','SOLD'].map(value=>`<option ${value===status?'selected':''}>${value}</option>`).join('')}</select>
      <button class="command primary" id="applyUnitFilter">Apply</button><span class="command-spacer"></span><span class="workspace-mode">${Number(data.total||0).toLocaleString()} UNITS · PAGE ${page}/${pages}</span>
    </div><div class="workspace-kpis inventory-class-kpis">${((byClass&&(byClass.classes||byClass.rows))||[]).map(function(c){var av=Number(c.available||0),ls=Number(c.leased||0);return '<article class="workspace-kpi kpi-al"><span>'+esc(c.class_name||c.cls||c.class_code||'Class')+'</span><strong>'+av.toLocaleString()+' <small>available</small></strong><em>'+ls.toLocaleString()+' leased</em></article>';}).join('')}</div>
    <section class="workspace-card"><header><h2>Exact Serial Inventory Register</h2></header>
      ${operationalTable(['Serial','Material Code','Tagged Item','Class','Location','Location Name','Status','Assigned To','Unit Cost','Valuation','Reconciliation'],rows,{key:'serial-inventory',emptyMessage:'No serial records match the filters. Confirm D1 migrations and opening data were loaded.'})}
      <div class="table-pager"><button class="command" id="previousUnitPage" ${page<=1?'disabled':''}>Previous</button><span>Page ${page} of ${pages}</span><button class="command" id="nextUnitPage" ${page>=pages?'disabled':''}>Next</button></div>
    </section>`;
    content.innerHTML=workbenchShell(body,'records');
    bindOperationalShell();
    const apply=()=>renderWarehouseVisibility($('#unitLocation').value,$('#unitSearch').value,$('#unitStatus').value,$('#unitClass').value,1);
    $('#applyUnitFilter').onclick=apply;
    $('#unitSearch').onkeydown=event=>{if(event.key==='Enter')apply();};
    if($('#previousUnitPage'))$('#previousUnitPage').onclick=()=>renderWarehouseVisibility(locationId,search,status,category,page-1);
    if($('#nextUnitPage'))$('#nextUnitPage').onclick=()=>renderWarehouseVisibility(locationId,search,status,category,page+1);
    $$('[data-inventory-serial]').forEach(row=>row.onclick=()=>openInventoryDetail(row.dataset.inventorySerial));
  }catch(error){showWorkspaceError(error);}
}

async function openInventoryDetail(serial){
  modal(`Inventory Serial · ${serial}`,'<div class="workspace-loading">Loading connected records…</div>','Exact item, custody, movement, delivery, return, and reconciliation history');
  try{
    const data=await api(`/inventory/${encodeURIComponent(serial)}/history`,{noCache:true});
    const asset=data.asset||{};
    const movements=(data.movements||[]).map(row=>`<tr><td>${date(row.movement_date)}</td><td>${esc(row.movement_type)}</td><td>${esc(row.from_location_code||'-')}</td><td>${esc(row.to_location_code||'-')}</td><td>${esc(row.to_status||'-')}</td><td>${esc(row.source_doc_no||'-')}</td></tr>`);
    const assignments=(data.assignments||[]).map(row=>`<tr><td>${esc(row.assignment_no)}</td><td>${esc(row.assignment_type)}</td><td>${esc(row.holder_name)}</td><td>${date(row.start_date)}</td><td>${statusBadge(row.status)}</td></tr>`);
    const deliveries=(data.deliveries||[]).map(row=>`<tr><td>${esc(row.delivery_no)}</td><td>${date(row.scheduled_date)}</td><td>${esc(row.destination||'-')}</td><td>${statusBadge(row.status)}</td></tr>`);
    const returns=(data.returns||[]).map(row=>`<tr><td>${esc(row.return_no)}</td><td>${date(row.return_date)}</td><td>${esc(row.expected_serial||'-')}</td><td>${esc(row.actual_serial||'-')}</td><td>${statusBadge(row.acceptance_status||row.status)}</td></tr>`);
    const reconciliation=(data.reconciliation||[]).map(row=>`<tr><td>${esc(row.case_no||row.id)}</td><td>${esc(row.case_type||'SERIAL')}</td><td>${esc(row.expected_serial||'-')}</td><td>${esc(row.actual_serial||'-')}</td><td>${statusBadge(row.status)}</td></tr>`);
    $('#modalBody').innerHTML=`<div class="inventory-detail-grid">
      <div><small>Inventory Class</small><b>${esc(asset.category||'-')}</b></div><div><small>Material Code</small><b>${esc(asset.item_code||'-')}</b></div>
      <div><small>Tagged Item</small><b>${esc(asset.item_name||'-')}</b></div><div><small>Serial</small><b>${esc(asset.serial_no||'-')}</b></div>
      <div><small>Status</small><b>${esc(asset.current_status||'-')}</b></div><div><small>Location</small><b>${esc(asset.current_location_code||'UNASSIGNED')}</b></div>
      <div><small>Assigned To</small><b>${esc(asset.current_holder_name||'-')}</b></div><div><small>Unit Cost</small><b>${money(asset.unit_cost)}</b></div>
      <div><small>Cost Source</small><b>${esc(asset.cost_source||'-')}</b></div><div><small>Valuation</small><b>${esc(asset.valuation_status||'UNVALUED')}</b></div>
    </div>
    <h3>Stock Movements</h3>${operationalTable(['Date','Movement','From','To','Resulting Status','Source Document'],movements,{key:'inventory-detail-movements'})}
    <h3>Assignments and Custody</h3>${operationalTable(['Assignment','Type','Holder','Start','Status'],assignments,{key:'inventory-detail-assignments'})}
    <h3>Deliveries</h3>${operationalTable(['Delivery','Scheduled','Destination','Status'],deliveries,{key:'inventory-detail-deliveries'})}
    <h3>Returns</h3>${operationalTable(['Return','Date','Expected Serial','Actual Serial','Status'],returns,{key:'inventory-detail-returns'})}
    <h3>Reconciliation Cases</h3>${operationalTable(['Case','Type','Expected','Actual','Status'],reconciliation,{key:'inventory-detail-reconciliation'})}`;
    enhanceTables();
  }catch(error){$('#modalBody').innerHTML=`<div class="workspace-error"><b>Unable to load serial details</b><span>${esc(error.message)}</span></div>`;}
}

async function renderAssemblyWorkbench(){
  content.innerHTML='<div class="workspace-loading">Loading assembly workbench…</div>';
  try{
    const [lookups,data]=await Promise.all([api('/masters/lookups'),api('/assemblies')]);
    const itemOpt=(lookups.items||[]).map(i=>`<option value="${i.id}" data-code="${esc(i.item_code)}" data-name="${esc(i.item_name)}" data-cost="${esc(i.standard_cost||0)}">${esc(i.item_code)} · ${esc(i.item_name)}</option>`).join('');
    const locOpt=(lookups.locations||[]).map(l=>`<option value="${l.id}" data-code="${esc(l.code)}">${esc(l.code)} · ${esc(l.name)}</option>`).join('');
    const rows=(data.rows||[]).map(a=>`<tr><td><b>${esc(a.assembly_no)}</b></td><td>${esc(a.output_item_name)}</td><td class="num">${esc(a.component_count)}</td><td class="num">${money(a.total_cost)}</td><td>${esc(a.location_code||'-')}</td><td>${statusBadge(a.status)}</td><td>${a.status==='BUILT'?`<button class="table-action" data-disasm="${a.id}">Disassemble</button>`:'-'}</td></tr>`);
    const body=`<div class="ramco-layout"><div class="ramco-main">
      <section class="workspace-card"><header><div><h2>Build Assembly</h2><span>Combine parts into one bundled unit. Serialized parts become unusable (In Assembly) until you disassemble.</span></div></header>
        <form id="asmForm" class="operational-form grid">
          <label><span>Assembly / output name</span><input name="outputItemName" required placeholder="e.g. Swap Station Cabinet (built)"></label>
          <label><span>Location</span><select name="locationId" id="asmLoc"><option value="">Select…</option>${locOpt}</select></label>
          <div class="wide line-editor-head"><b>Components</b><button type="button" id="asmAddLine">Add component</button></div>
          <div id="asmLines" class="wide line-editor"></div>
          <label class="wide"><span>Notes</span><input name="notes"></label>
          <div class="wide" style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><b>Total assembled cost: <span id="asmTotal">0.00</span></b><button class="command primary">Build Assembly</button></div>
        </form></section>
      <section class="workspace-card"><header><div><h2>Assembly Register</h2><span>${(data.rows||[]).length} assemblies</span></div></header>
        ${operationalTable(['Assembly','Output','Parts','Rolled Cost','Location','Status','Action'],rows)}</section>
      </div><aside class="ramco-rail">
      <section><header>Go to</header><div class="ramco-action-links"><button type="button" id="asmBackMove">Stock Movement</button></div></section></aside></div>`;
    content.innerHTML=workbenchShell(body,'approvals');bindOperationalShell();
    const recalc=()=>{let t=0;$$('.asm-line').forEach(r=>{const q=Number(r.querySelector('[data-a="qty"]').value||0),c=Number(r.querySelector('[data-a="cost"]').value||0);t+=q*c;});const el=$('#asmTotal');if(el)el.textContent=money(t);};
    const addLine=()=>{const row=document.createElement('div');row.className='line-editor-row asm-line';
      row.innerHTML=`<select data-a="item"><option value="">Item…</option>${itemOpt}</select><input data-a="serial" placeholder="Serial (optional)"><input data-a="qty" type="number" min="0.01" step="0.01" value="1"><input data-a="cost" type="number" min="0" step="0.01" value="0"><button type="button" class="remove-line">×</button>`;
      row.querySelector('[data-a="item"]').onchange=e=>{const o=e.target.selectedOptions[0];if(o&&o.dataset.cost)row.querySelector('[data-a="cost"]').value=o.dataset.cost;recalc();};
      row.querySelector('[data-a="qty"]').oninput=recalc;row.querySelector('[data-a="cost"]').oninput=recalc;
      row.querySelector('.remove-line').onclick=()=>{row.remove();recalc();};
      $('#asmLines').append(row);};
    addLine();$('#asmAddLine').onclick=addLine;
    $('#asmBackMove')&&($('#asmBackMove').onclick=()=>renderStockMovement());
    $('#asmForm').onsubmit=async e=>{e.preventDefault();
      const fd=formDataObject($('#asmForm'));const loc=$('#asmLoc').selectedOptions[0];
      const components=$$('.asm-line').map(r=>{const o=r.querySelector('[data-a="item"]').selectedOptions[0];return {itemId:Number(r.querySelector('[data-a="item"]').value)||null,itemCode:o?o.dataset.code:'',itemName:o?o.dataset.name:'',serialNo:r.querySelector('[data-a="serial"]').value,qty:Number(r.querySelector('[data-a="qty"]').value||0),unitCost:Number(r.querySelector('[data-a="cost"]').value||0)};}).filter(x=>x.itemName&&x.qty>0);
      if(!components.length){toast('Add at least one component.','error');return;}
      const payload={outputItemName:fd.outputItemName,locationId:$('#asmLoc').value||null,locationCode:loc?loc.dataset.code:'',notes:fd.notes,components};
      try{const r=await api('/assemblies/build',{method:'POST',body:JSON.stringify(payload)});toast(`${r.assemblyNo} built · cost ${money(r.totalCost)}`);await renderAssemblyWorkbench();}catch(err){toast(err.message,'error');}};
    $$('[data-disasm]').forEach(b=>b.onclick=async()=>{if(!confirm('Disassemble this assembly? Serialized parts return to Available.'))return;try{await api('/assemblies/'+b.dataset.disasm+'/disassemble',{method:'POST',body:'{}'});toast('Disassembled');await renderAssemblyWorkbench();}catch(err){toast(err.message,'error');}});
  }catch(error){showWorkspaceError(error);}
}

const MOVEMENT_STATUS_KEY='blitz-movement-statuses';
const MOVEMENT_STATUS_BASE=[
  {code:'AVAILABLE',restricted:false},{code:'AVAILABLE_FOR_LEASE',restricted:false},
  {code:'AVAILABLE_FOR_SALE',restricted:false},{code:'RESERVED',restricted:true},
  {code:'QUARANTINE',restricted:true},{code:'UNDER_REPAIR',restricted:true},
  {code:'ASSIGNED',restricted:true},{code:'SOLD',restricted:true}];
function movementStatuses(){
  let extra=[];try{extra=JSON.parse(localStorage.getItem(MOVEMENT_STATUS_KEY)||'[]');}catch(e){extra=[];}
  return MOVEMENT_STATUS_BASE.concat(extra.filter(x=>x&&x.code));
}
function movementStatusOptions(){
  const list=(state.movementStatuses&&state.movementStatuses.length)?state.movementStatuses:movementStatuses();
  return list.map(x=>`<option value="${esc(x.code)}"${x.restricted?' data-restricted="1"':''}>${esc(x.label||x.code.replace(/_/g,' '))}${x.restricted?' (restricted)':''}</option>`).join('');
}
function isSoldStatus(value){return String(value||'').toUpperCase()==='SOLD';}
async function renderStockMovement(){
  content.innerHTML='<div class="workspace-loading">Loading movement workbench…</div>';
  try{
    const [lookups,movements,statusData,slipData]=await Promise.all([
      api('/masters/lookups'),api('/inventory/movements'),
      api('/inventory/movement-statuses').catch(()=>({rows:[]})),
      api('/inventory/move-requests').catch(()=>({rows:[]}))]);
    state.movementStatuses=(statusData.rows&&statusData.rows.length)?statusData.rows:movementStatuses();
    const slips=slipData.rows||[];
    const rows=movements.rows.slice(0,250).map(row=>`<tr data-move-serial="${esc(row.serial_no)}" style="cursor:pointer" title="Click to move this serial to another location"><td><b>${esc(row.movement_no)}</b></td><td>${date(row.movement_date)}</td>
      <td>${esc(row.movement_type)}</td><td>${esc(row.serial_no)}</td><td>${esc(row.item_name||row.item_code||'-')}</td>
      <td>${esc(row.from_location_code||'-')}</td><td>${esc(row.to_location_code||'-')}</td><td>${esc(row.to_status||'-')}</td><td>${esc(row.posted_by||'-')}</td></tr>`);
    const body=`<div class="ramco-layout"><div class="ramco-main">
      <section class="workspace-card"><header><h2>Post Stock Movement</h2></header>
        <form id="movementForm" class="operational-form grid">
          <label><span>Serial Number</span><div class="scan-field"><input name="serialNo" id="moveSerial" required placeholder="Scan or enter serial"><button type="button" class="table-action" id="moveScan">Scan QR</button></div></label>
          <label><span>Movement</span><select name="movementType"><option>TRANSFER</option><option>PLACEMENT</option><option>STATUS_CHANGE</option><option>ADJUSTMENT</option></select></label>
          <label><span>Destination</span><select name="locationId" required><option value="">Select location…</option>${lookups.locations.map(row=>`<option value="${row.id}">${esc(row.code)} · ${esc(row.name)}</option>`).join('')}</select></label>
          <label><span>New Status</span><select name="toStatus" id="moveStatus">${movementStatusOptions()}</select>
            <button type="button" class="table-action" id="moveAddStatus">+ Add status</button></label>
          <label class="wide"><span>Reason / notes</span><input name="notes" required></label>
          <button class="command primary">Create Requisition Slip</button>
        </form>
      </section>
      <section class="workspace-card"><header><h2>Movement Slips Awaiting Approval</h2><span>${slips.filter(x=>['SUBMITTED','DEPT_MANAGER_APPROVED'].includes(x.status)).length} open</span></header>
        ${operationalTable(['Slip','Serial','Item','To Location','New Status','Requested By','Status','Action'],
          slips.filter(x=>['SUBMITTED','DEPT_MANAGER_APPROVED'].includes(x.status)).map(x=>`<tr>
            <td><b>${esc(x.request_no)}</b></td><td>${esc(x.serial_no)}</td><td>${esc(x.item_name||x.item_code||'-')}</td>
            <td>${esc(x.to_location_code||x.to_location_name||'-')}</td><td>${esc((x.to_status||'-').replace(/_/g,' '))}</td>
            <td>${esc(x.requested_by||'-')}</td><td>${statusBadge(x.status)}</td>
            <td>${can('INVENTORY','APPROVE')?`<button class="table-action" data-slip-approve="${x.id}">${x.status==='SUBMITTED'?'Manager approve':'Head approve & post'}</button><button class="table-action" data-slip-reject="${x.id}">Reject</button>`:'-'}</td></tr>`),
          {emptyMessage:'No movement slips are waiting for approval'})}</section>
      <section class="workspace-card"><header><h2>Movement Register</h2><span>${movements.total} entries</span></header>
        ${operationalTable(['Movement','Date','Type','Serial','Item','From','To','Status','Posted By'],rows)}</section>
      </div><aside class="ramco-rail"><section><header>Master Data</header><div class="ramco-action-links"><button type="button" id="openItemMaster">Item Master (Products)</button><button type="button" id="openAssembly">Assembly / BOM</button></div></section></aside></div>`;
    content.innerHTML=workbenchShell(body,'approvals');
    bindOperationalShell();
    var __ms=$('#moveScan');if(__ms)__ms.onclick=()=>scanQrWithCamera(value=>{var el=$('#moveSerial');if(el)el.value=value;});
    var __mas=$('#moveAddStatus');
    if(__mas)__mas.onclick=()=>{
      modal('Add movement status',`<form id="msForm" class="operational-form grid">
        <label class="wide"><span>Status code</span><input name="code" required placeholder="e.g. AVAILABLE_FOR_DEMO"></label>
        <label class="wide"><span>Rule</span><select name="restricted"><option value="0">Not restricted - unit can still be moved</option><option value="1">Restricted - unit can no longer be moved</option></select></label>
        <div class="modal-actions wide"><button type="submit" class="command primary">Add status</button><button type="button" class="command" id="msCancel">Cancel</button></div>
      </form>`);
      const mb=$('#modalBody');mb.querySelector('#msCancel').onclick=()=>closeModal();
      mb.querySelector('#msForm').onsubmit=async ev=>{
        ev.preventDefault();const f=formDataObject(ev.currentTarget);
        const code=String(f.code||'').trim().toUpperCase().replace(/\s+/g,'_');
        if(!code)return;
        try{
          await api('/inventory/movement-statuses',{method:'POST',body:JSON.stringify({
            code,label:code.replace(/_/g,' '),restricted:f.restricted==='1',terminal:f.restricted==='1'&&/SOLD|SCRAP|DISPOSED/.test(code)})});
          closeModal();toast('Status added');renderStockMovement();
        }catch(err){toast(err.message,'error');}
      };
    };
    $$('[data-move-serial]').forEach(function(tr){tr.onclick=function(){var s=tr.getAttribute('data-move-serial');var el=$('#moveSerial');if(el){el.value=s;el.focus();el.scrollIntoView({behavior:'smooth',block:'center'});toast('Serial '+s+' loaded into Post Stock Movement');}};});
    $$('[data-slip-approve]').forEach(b=>b.onclick=async()=>{
      try{const r=await api('/inventory/move-requests/'+b.dataset.slipApprove+'/approve',{method:'POST',body:'{}'});
        toast(r.posted?'Movement posted to the stock ledger':'Approved. Waiting for the Department Head.');await renderStockMovement();}
      catch(err){toast(err.message,'error');}});
    $$('[data-slip-reject]').forEach(b=>b.onclick=async()=>{
      const reason=prompt('Reason for rejecting this movement slip:');
      if(reason===null)return;
      try{await api('/inventory/move-requests/'+b.dataset.slipReject+'/reject',{method:'POST',body:JSON.stringify({reason})});
        toast('Movement slip rejected');await renderStockMovement();}
      catch(err){toast(err.message,'error');}});
    var __im=$('#openItemMaster');if(__im)__im.onclick=function(){renderProductRegistration();};
    var __ab=$('#openAssembly');if(__ab)__ab.onclick=function(){renderAssemblyWorkbench();};
    $('#movementForm').onsubmit=async event=>{
      event.preventDefault();
      const payload=formDataObject(event.currentTarget);
      const location=lookups.locations.find(row=>Number(row.id)===Number(payload.locationId));
      payload.toLocationName=location.name;payload.toLocationCode=location.code;payload.toLocationType=location.location_type;
      // A movement is never posted directly any more: it raises a slip that runs
      // Department Manager -> Department Head before the ledger is touched.
      try{
        const created=await api('/inventory/move-requests',{method:'POST',body:JSON.stringify({
          serialNo:payload.serialNo,movementType:payload.movementType,toStatus:payload.toStatus,
          toLocationId:Number(payload.locationId),toLocationCode:payload.toLocationCode,
          toLocationName:payload.toLocationName,toLocationType:payload.toLocationType,notes:payload.notes})});
        toast('Movement slip '+(created.requestNo||'')+' raised. It posts once both approvers sign.');
        await renderStockMovement();
      }catch(error){toast(error.message,'error');}
    };
  }catch(error){showWorkspaceError(error);}
}

async function renderQrTrace(){
  const body=`<div class="ramco-layout"><div class="ramco-main"><section class="workspace-card qr-trace-card">
    <header><h2>QR / Serial Trace</h2></header>
    <div class="scan-entry"><input id="traceSerial" placeholder="Scan or enter serial number"><button class="command primary" id="traceLookup">Trace Unit</button>
      <button class="command" id="traceCamera">Scan QR</button></div><div id="traceResult">${operationalEmpty('Scan a unit to see its current location and status.')}</div>
  </section></div></div>`;
  content.innerHTML=workbenchShell(body,'reports');
  bindOperationalShell();
  const lookup=async value=>{
    const serial=serialFromQrPayload(value||$('#traceSerial').value);
    if(!serial)return toast('Scan or enter a serial.','error');
    try{
      const data=await api(`/inventory/qr-lookup?serial=${encodeURIComponent(serial)}`);
      const record=data.asset||data.expected;
      $('#traceResult').innerHTML=record?`<div class="trace-result"><div><small>Serial</small><b>${esc(serial)}</b></div>
        <div><small>Record</small><b>${data.asset?'RECEIVED INVENTORY':'EXPECTED SHIPMENT'}</b></div>
        <div><small>Item</small><b>${esc(record.item_name||record.item_code||'-')}</b></div>
        <div><small>Location</small><b>${esc(record.current_location_code||'Not received')}</b></div>
        <div><small>Status</small>${statusBadge(record.current_status||record.expected_status||record.shipment_status)}</div>
        <div><small>Holder</small><b>${esc(record.current_holder_name||'-')}</b></div></div>`:operationalEmpty(`Serial ${serial} was not found.`);
    }catch(error){toast(error.message,'error');}
  };
  $('#traceLookup').onclick=()=>lookup('');
  $('#traceSerial').onkeydown=event=>{if(event.key==='Enter')lookup('');};
  $('#traceCamera').onclick=()=>scanQrWithCamera(lookup);
}

async function renderLocationMaster(){
  content.innerHTML='<div class="workspace-loading">Loading locations…</div>';
  try{
    const lookups=await api('/masters/lookups');
    const rows=lookups.locations.map(row=>`<tr><td><b>${esc(row.code)}</b></td><td>${esc(row.name)}</td><td>${esc(row.location_type)}</td><td>${esc(row.partner_name||'-')}</td></tr>`);
    const body=`<div class="ramco-layout"><div class="ramco-main">
      <section class="workspace-card"><header><h2>Location Master</h2></header>
        <form id="locationForm" class="operational-form grid"><label><span>Code (optional)</span><input name="code"></label>
          <label><span>Location Name</span><input name="name" required></label><label><span>Type</span><select name="locationType">
            <option>WAREHOUSE</option><option>RETAIL</option><option>STORE</option><option>DEPOT</option><option>STATION</option><option>OTHER</option>
          </select></label><button class="command primary">Add Location</button></form>
        ${operationalTable(['Code','Location','Type','Partner'],rows)}
      </section></div></div>`;
    content.innerHTML=workbenchShell(body,'setup');bindOperationalShell();
    $('#locationForm').onsubmit=async event=>{
      event.preventDefault();
      try{await api('/masters/locations',{method:'POST',body:JSON.stringify(formDataObject(event.currentTarget))});toast('Location created');await renderLocationMaster();}
      catch(error){toast(error.message,'error');}
    };
  }catch(error){showWorkspaceError(error);}
}

async function renderCycleWorkspace(section){
  if(section==='records')return renderCyclePlans();
  if(section==='approvals')return renderPhysicalCount();
  if(section==='reports')return renderCycleVariances();
  if(section==='setup')return renderCycleSetup();
  return renderCycleOverview();
}

async function renderCycleOverview(){
  content.innerHTML='<div class="workspace-loading">Loading cycle count control\u2026</div>';
  try{
    const data=await api('/inventory/cycle-counts');
    const all=data.rows||[];
    const by=st=>all.filter(r=>r.status===st).length;
    const variances=all.reduce((sum,row)=>sum+Number(row.variance_units||0),0);
    const counted=all.reduce((sum,row)=>sum+Number(row.counted_units||0),0);
    const expected=all.reduce((sum,row)=>sum+Number(row.expected_units||0),0);

    // The coloured row across the top: state first, detail underneath.
    const tiles=vizTiles([
      {label:'Open',value:by('OPEN'),tone:'warning',sub:'being counted',section:'records'},
      {label:'For approval',value:by('SUBMITTED'),tone:'serious',sub:'awaiting sign-off',section:'approvals'},
      {label:'Approved',value:by('APPROVED')+by('POSTED'),tone:'good',sub:'closed out',section:'records'},
      {label:'Variances',value:variances,tone:variances?'critical':'good',sub:'units in question',section:'reports'},
      {label:'Units counted',value:counted,sub:'across all sheets',section:'approvals'}
    ]);

    // What the register is made of, by state.
    const statuses=[['OPEN','Open'],['SUBMITTED','For approval'],['APPROVED','Approved'],
      ['POSTED','Posted'],['CANCELLED','Cancelled']];
    const donut=vizDonut(statuses.map(([code,label])=>({label,value:by(code)})),
      {title:'Count sheets by status',totalLabel:'Sheets',keyLabel:'Status',valueLabel:'Sheets'});

    // Where the variances actually are - the question a controller asks first.
    const byLocation={};
    all.forEach(r=>{const k=r.location_code||'Unassigned';
      byLocation[k]=(byLocation[k]||0)+Number(r.variance_units||0);});
    const varianceRows=Object.keys(byLocation).map(k=>({label:k,value:byLocation[k]}))
      .filter(r=>r.value>0).sort((a,b)=>b.value-a.value);
    const bars=vizBars(varianceRows,{title:'Variances by location',color:VIZ.status.critical,
      keyLabel:'Location',valueLabel:'Variance units',limit:6,labelWidth:110});

    // How far each open sheet has got. Progress, not a score.
    const progress=all.filter(r=>r.status==='OPEN').slice(0,6).map(r=>{
      const exp=Number(r.expected_units||0), got=Number(r.counted_units||0);
      const pct=exp?Math.min(100,(got/exp)*100):(got?100:0);
      return {label:r.count_no+' \u00b7 '+(r.location_code||''),pct,
        valueLabel:got+(exp?' / '+exp:''),tone:pct>=100?'good':pct>=50?'warning':'serious'};
    });
    const meters=vizMeter(progress,{title:'Open sheets in progress',subtitle:'counted against expected'});

    const rows=all.slice(0,20).map(row=>`<tr data-cycle="${row.id}"><td><b>${esc(row.count_no)}</b></td><td>${date(row.count_date)}</td>
      <td>${esc(row.location_code)} \u00b7 ${esc(row.location_name)}</td><td>${esc(row.category||'All')}</td><td>${esc(row.expected_units)}</td>
      <td>${esc(row.counted_units)}</td><td>${esc(row.variance_units)}</td><td>${statusBadge(row.status)}</td></tr>`);

    const body=`${tiles}
      <div class="viz-grid">${donut}${bars}${meters}</div>
      <div class="ramco-layout"><div class="ramco-main"><section class="workspace-card">
        <header><div><h2>Inventory Cycle Counting</h2><span>${all.length} sheet${all.length===1?'':'s'} \u00b7 ${compact(counted)} of ${compact(expected)} expected units counted</span></div><button class="ramco-primary" data-section-link="records">New Count Plan</button></header>
        ${operationalTable(['Count No.','Date','Location','Category','Expected','Counted','Variance','Status'],rows)}
      </section></div><aside class="ramco-rail"><section><header>Counting Actions</header><div class="ramco-action-links">
        <button data-section-link="records">Create / Print Count Plan</button><button data-section-link="approvals">Mobile Physical Count</button>
        <button data-section-link="reports">Variance Reports</button></div></section></aside></div>`;
    content.innerHTML=workbenchShell(body,'center');bindOperationalShell();
    bindViz(content,section=>openSection(section));
    $$('[data-cycle]').forEach(row=>row.onclick=()=>{state.cycleCount=Number(row.dataset.cycle);renderPhysicalCount(state.cycleCount);});
  }catch(error){showWorkspaceError(error);}
}

async function renderCyclePlans(){
  content.innerHTML='<div class="workspace-loading">Loading count plans…</div>';
  try{
    const [data,lookups]=await Promise.all([api('/inventory/cycle-counts'),api('/masters/lookups')]);
    const rows=data.rows.map(row=>`<tr data-cycle="${row.id}"><td><b>${esc(row.count_no)}</b></td><td>${date(row.count_date)}</td>
      <td>${esc(row.location_code)} · ${esc(row.location_name)}</td><td>${esc(row.location_type)}</td><td>${esc(row.category||'All')}</td>
      <td>${esc(row.assigned_to||'-')}</td><td>${esc(row.expected_units)}</td><td>${statusBadge(row.status)}</td></tr>`);
    const body=`<div class="ramco-layout"><div class="ramco-main">
      <section class="workspace-card"><header><h2>Create Cycle Count Plan</h2></header>
        <form id="cyclePlanForm" class="operational-form grid">
          <label><span>Warehouse / Retail Location</span><select name="locationId" required><option value="">Select location…</option>${lookups.locations.map(row=>`<option value="${row.id}">${esc(row.code)} · ${esc(row.name)}</option>`).join('')}</select></label>
          <label><span>Count Date</span><input name="countDate" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
          <label><span>Category</span><select name="category"><option value="">All categories</option>${['MC','BAT','BSS','SP','CHG','OTH'].map(value=>`<option>${value}</option>`).join('')}</select></label>
          <label><span>Assigned To</span><input name="assignedTo" value="${esc(state.session.user.email)}"></label>
          <label class="wide"><span>Count Instructions</span><input name="instructions" placeholder="Physical-count instructions"></label>
          <button class="command primary">Create Count Sheet</button>
        </form>
      </section>
      <section class="workspace-card"><header><h2>Cycle Count Register</h2><span>${data.total} plans</span></header>
        ${operationalTable(['Count No.','Date','Location','Type','Category','Assigned To','Expected','Status',''],rows)}</section>
      </div></div>`;
    content.innerHTML=workbenchShell(body,'records');bindOperationalShell();
    $('#cyclePlanForm').onsubmit=async event=>{
      event.preventDefault();
      try{const result=await api('/inventory/cycle-counts',{method:'POST',body:JSON.stringify(formDataObject(event.currentTarget))});toast(`${result.countNo} created with ${result.expectedUnits} units`);state.cycleCount=result.id;await renderPhysicalCount(result.id);}
      catch(error){toast(error.message,'error');}
    };
    $$('[data-cycle]').forEach(row=>row.onclick=event=>{
      if(event.target.closest('[data-drop-count]'))return;
      state.cycleCount=Number(row.dataset.cycle);renderPhysicalCount(state.cycleCount);});
    // An open plan raised by mistake can be deleted; a submitted one is history.
    $$('[data-drop-count]').forEach(b=>b.onclick=event=>{
      event.stopPropagation();
      const cid=b.dataset.dropCount;const cno=b.dataset.dropNo;
      modal('Remove '+esc(cno)+'?',
        `<div class="operational-form"><p>This plan will be cancelled and disappear from the register.
          Nothing is erased - what was counted against it is kept, so the record of who scanned what stays intact.
          Only an open plan can be removed this way.</p>
        <div class="modal-actions"><button type="button" class="command primary" id="dcYes">Remove plan</button>
        <button type="button" class="command" id="dcNo">Keep it</button></div></div>`);
      const mb=$('#modalBody');
      mb.querySelector('#dcNo').onclick=()=>closeModal();
      mb.querySelector('#dcYes').onclick=async()=>{
        try{await api('/inventory/cycle-counts/'+cid,{method:'DELETE'});
          closeModal();toast(cno+' removed from the register');
          if(state.cycleCount===Number(cid))state.cycleCount=null;
          await renderCyclePlans();}
        catch(error){toast(error.message,'error');}
      };
    });
  }catch(error){showWorkspaceError(error);}
}

function printCycleCountSheet(data){
  const popup=window.open('','_blank','width=980,height=1000');
  if(!popup)return toast('Allow pop-ups to print the cycle count sheet.','error');
  const rows=data.lines.filter(row=>row.expected_asset_id).map((row,index)=>`<tr><td>${index+1}</td><td>${esc(row.item_code||'')}</td><td>${esc(row.item_name||'')}</td>
    <td>${esc(row.expected_serial_no||'')}</td><td class="blank"></td><td class="blank"></td></tr>`).join('');
  popup.document.write(`<!doctype html><html><head><title>${esc(data.header.count_no)}</title><style>
    body{font:12px Arial;margin:24px;color:#111}header{display:flex;justify-content:space-between;border-bottom:2px solid #0a2239;padding-bottom:12px}
    h1{margin:0;font-size:22px}p{margin:4px 0}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #777;padding:7px;text-align:left}
    .blank{height:22px}.sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:28px;margin-top:50px}.sign div{border-top:1px solid #111;padding-top:6px}
    @media print{button{display:none}}</style></head><body><header><div><h1>Blitz - ERP Inventory Cycle Count</h1><p>${esc(data.header.count_no)} · ${esc(data.header.location_code)} - ${esc(data.header.location_name)}</p>
    <p>Count date: ${esc(data.header.count_date)} · Category: ${esc(data.header.category||'All')}</p></div><div>© 2026 AL23<br>Internal Use Only</div></header>
    <table><thead><tr><th>#</th><th>Item Code</th><th>Item</th><th>Expected Serial</th><th>Actual / Tick</th><th>Remarks</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="sign"><div>Counted by / Date</div><div>Reviewed by / Date</div><div>Approved by / Date</div></div><button onclick="window.print()">Print</button></body></html>`);
  popup.document.close();
}

/* ===================================================================
 * "What is this?" - the unit was counted but the system has never seen it.
 * Shown right after the scan so the counter identifies it while the unit is
 * still in their hands, and reused by the Edit button on the count sheet.
 * =================================================================== */
function identifyCountedUnit(countId,line,opts){
  opts=opts||{};
  const d=line||{};
  const cats=[['','Use the count sheet class'],['MC','Motorcycle'],['BAT','Battery'],['BSS','Locker / Station'],
    ['SP','Spare part'],['CHG','Charger'],['OTH','Other']];
  const conds=[['GOOD','Good'],['DAMAGED','Damaged'],['FOR_REPAIR','For repair']];
  return new Promise(resolve=>{
    modal(opts.title||('Identify '+esc(d.actual_serial_no||'this unit')),
      `<form id="iduForm" class="operational-form grid">
        
        <label class="wide"><span>Serial</span><input name="serialNo" value="${esc(d.actual_serial_no||'')}" ${opts.lockSerial?'readonly':''}></label>
        <label><span>Item code</span><input name="itemCode" value="${esc(d.item_code||'')}" placeholder="e.g. MC-0001" list="iduItems"></label>
        <label><span>Item / model name</span><input name="itemName" value="${esc(d.item_name||'')}"></label>
        <label><span>Class</span><select name="category">${cats.map(x=>`<option value="${x[0]}" ${String(d.new_category||'')===x[0]?'selected':''}>${esc(x[1])}</option>`).join('')}</select></label>
        <label><span>Serial type</span><input name="serialType" value="${esc(d.new_serial_type||'SERIAL')}" placeholder="FRAME / BARCODE / SN"></label>
        <label><span>Motor / secondary no.</span><input name="motorNo" value="${esc(d.new_motor_no||'')}"></label>
        <label><span>Unit cost</span><input name="unitCost" type="number" step="0.01" min="0" value="${d.new_unit_cost!=null?Number(d.new_unit_cost):''}"></label>
        <label><span>Condition</span><select name="conditionCode">${conds.map(x=>`<option value="${x[0]}" ${String(d.condition_code||'GOOD')===x[0]?'selected':''}>${esc(x[1])}</option>`).join('')}</select></label>
        <datalist id="iduItems"></datalist>
        <div class="modal-actions wide">
          <button type="submit" class="command primary">Save</button>
          <button type="button" class="command" id="iduSkip">${esc(opts.skipLabel||'Skip for now')}</button>
        </div>
      </form>`,'Anything left blank is still counted and flagged for review');
    const mb=$('#modalBody');
    // Offer the item codes already in the system so the counter can pick rather
    // than type - and once a known code is entered, the master fills in the
    // description, class and cost so nobody retypes what the system already knows.
    api('/masters/items?size=250').then(r=>{
      const list=mb.querySelector('#iduItems');
      const rows=r.rows||[];
      if(list)list.innerHTML=rows.map(i=>`<option value="${esc(i.item_code)}">${esc(i.item_name||'')}</option>`).join('');
      const byCode={};rows.forEach(i=>{byCode[String(i.item_code||'').toUpperCase()]=i;});
      const codeEl=mb.querySelector('[name="itemCode"]');
      const nameEl=mb.querySelector('[name="itemName"]');
      const catEl=mb.querySelector('[name="category"]');
      const costEl=mb.querySelector('[name="unitCost"]');
      if(!codeEl)return;
      const applyMaster=()=>{
        const hit=byCode[String(codeEl.value||'').trim().toUpperCase()];
        if(!hit)return;
        if(nameEl&&!nameEl.value.trim())nameEl.value=hit.item_name||'';
        if(catEl&&!catEl.value&&hit.category)catEl.value=hit.category;
        if(costEl&&!Number(costEl.value)&&Number(hit.standard_cost))costEl.value=Number(hit.standard_cost);
      };
      codeEl.addEventListener('input',applyMaster);
      codeEl.addEventListener('change',applyMaster);
      codeEl.addEventListener('blur',applyMaster);
      applyMaster();
    }).catch(()=>{});
    mb.querySelector('#iduSkip').onclick=()=>{closeModal();resolve(null);};
    mb.querySelector('#iduForm').onsubmit=async event=>{
      event.preventDefault();
      const f=formDataObject(event.currentTarget);
      try{
        await api(`/inventory/cycle-counts/${countId}/lines/${d.id}`,{method:'PATCH',body:JSON.stringify(f)});
        closeModal();toast('Unit identified');resolve(f);
      }catch(error){toast(error.message,'error');}
    };
  });
}

/* ===================================================================
 * Count sheet upload: a team with a clipboard types the serials into a
 * spreadsheet. Preview first, so nothing is written until it looks right.
 * =================================================================== */
const COUNT_TEMPLATE_COLUMNS=['serial_no','item_code','item_name','category','serial_type',
  'secondary_serial','motor_no','unit_cost','condition','remarks'];

function downloadCountTemplate(header){
  const rows=[COUNT_TEMPLATE_COLUMNS.join(','),
    'LC6PAGA13R0099001,MC-0001,E88 Cruiser,MC,FRAME,,MTR-88231,78000,GOOD,example row - delete me',
    '519110002370AAX001,BAT-0001,E88 Battery 72V,BAT,BARCODE,ICCID-0001,,24000,GOOD,'];
  const blob=new Blob([rows.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='count-sheet-'+((header&&header.count_no)||'template')+'.csv';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(function(){URL.revokeObjectURL(a.href);},2000);
}

function openCountUpload(countId,header){
  const tone={COUNTED:'good',NEW_UNIT:'new',LOCATION_MISMATCH:'warn',
    DUPLICATE:'bad',ALREADY_COUNTED:'warn',SKIPPED:'bad'};
  modal('Upload count sheet · '+esc((header&&header.count_no)||''),
    '<div class="operational-form">'
    +''
    +'<p><button type="button" class="command" id="cuTemplate">Download template (.csv)</button></p>'
    +'<label class="wide"><span>Count sheet file (.csv)</span><input id="cuFile" type="file" accept=".csv,text/csv"></label>'
    +'<div id="cuPreview"></div>'
    +'<div class="modal-actions wide">'
    +'<button type="button" class="command primary" id="cuImport" disabled>Import</button>'
    +'<button type="button" class="command" id="cuClose">Close</button>'
    +'</div></div>','Re-uploading the same file adds nothing - counted serials are skipped');
  const mb=$('#modalBody');
  let csvText='';
  mb.querySelector('#cuTemplate').onclick=function(){downloadCountTemplate(header);};
  mb.querySelector('#cuClose').onclick=function(){closeModal();renderPhysicalCount(countId);};
  mb.querySelector('#cuFile').onchange=async function(event){
    const file=event.target.files&&event.target.files[0];
    if(!file)return;
    csvText=await file.text();
    try{
      const r=await api('/inventory/cycle-counts/'+countId+'/import',{method:'POST',body:JSON.stringify({csv:csvText})});
      const counts=Object.entries(r.summary||{}).map(function(kv){
        return '<span class="cu-chip '+esc(tone[kv[0]]||'')+'">'+esc(String(kv[0]).replace(/_/g,' ').toLowerCase())+': '+kv[1]+'</span>';
      }).join('');
      const rows=(r.rows||[]).slice(0,300).map(function(x){
        return '<tr class="'+esc(tone[x.status]||'')+'"><td>'+x.rowNo+'</td><td><b>'+esc(x.serial||'-')+'</b></td>'
          +'<td>'+esc(x.itemCode||'-')+'</td><td>'+esc(String(x.status).replace(/_/g,' ').toLowerCase())+'</td>'
          +'<td>'+esc(x.message||'')+'</td></tr>';
      });
      const willAdd=(r.rows||[]).filter(function(x){return ['COUNTED','NEW_UNIT','LOCATION_MISMATCH'].indexOf(x.status)>=0;}).length;
      mb.querySelector('#cuPreview').innerHTML='<div class="cu-summary">'+counts+'</div>'
        +''
        +'<div class="cu-table">'+operationalTable(['Row','Serial','Item','Result','Note'],rows)+'</div>';
      mb.querySelector('#cuImport').disabled=willAdd===0;
    }catch(error){toast(error.message,'error');}
  };
  mb.querySelector('#cuImport').onclick=async function(){
    try{
      const r=await api('/inventory/cycle-counts/'+countId+'/import',{method:'POST',body:JSON.stringify({csv:csvText,commit:true})});
      closeModal();toast(r.added+' unit(s) added to the count sheet');await renderPhysicalCount(countId);
    }catch(error){toast(error.message,'error');}
  };
}

async function renderPhysicalCount(countId=state.cycleCount){
  content.innerHTML='<div class="workspace-loading">Loading physical count…</div>';
  try{
    const register=await api('/inventory/cycle-counts');
    const id=Number(countId||register.rows.find(row=>row.status==='OPEN')?.id||register.rows[0]?.id||0);
    state.cycleCount=id||null;
    const data=id?await api(`/inventory/cycle-counts/${id}`):null;
    // A row stays editable and removable until the count is submitted: the
    // counter scans first and identifies the unit afterwards.
    const editable=data?.header?.status==='OPEN';
    const rows=(data?.lines||[]).map(row=>{
      const unidentified=row.is_new_unit&&!row.item_code;
      return `<tr${unidentified?' class="row-needs-item"':''}>
      <td>${row.item_code?esc(row.item_code):(row.is_new_unit?'<span class="needs-item">Identify this unit</span>':'-')}</td>
      <td>${esc(row.item_name||'-')}</td>
      <td>${esc(row.expected_serial_no||'-')}</td><td>${esc(row.actual_serial_no||'-')}</td><td>${statusBadge(row.count_status)}</td>
      <td>${row.variance_type?statusBadge(row.variance_type):'-'}</td><td>${esc(row.actual_location_code||'-')}</td>
      <td>${editable&&row.actual_serial_no?`<button class="table-action" data-edit-line="${row.id}">Edit</button>
        <button class="table-action danger" data-drop-line="${row.id}">${row.expected_serial_no?'Undo scan':'Remove'}</button>`:'-'}</td></tr>`;});
    const body=`<div class="workspace-commandbar"><label class="inline-control"><span>Count Plan</span><select id="physicalCountSelect"><option value="">Select count…</option>${register.rows.map(row=>`<option value="${row.id}" ${row.id===id?'selected':''}>${esc(row.count_no)} · ${esc(row.location_code)} · ${esc(row.status)}</option>`).join('')}</select></label>
      ${data?`<button class="command" id="printCount">Print Count Sheet</button><button class="command primary" id="submitCount" ${data.header.status==='OPEN'?'':'disabled'}>Submit Count</button>${data.header.status==='OPEN'?`<button class="command danger" id="removeCount">Remove count sheet</button>`:''}`:''}</div>
      ${data?`<div class="ramco-layout"><div class="ramco-main"><section class="workspace-card">
        <header><div><h2>${esc(data.header.count_no)} · Physical Count</h2><span>${esc(data.header.location_code)} - ${esc(data.header.location_name)}</span></div>${statusBadge(data.header.status)}</header>
        <div class="scan-entry"><input id="countSerial" placeholder="Scan or enter physical serial"><button class="command primary" id="countAdd">Count Serial</button>
          <button class="command" id="countCamera">Scan QR</button><button class="command" id="countMobile">Mobile count</button>
          <button class="command" id="countUpload">Upload count sheet</button></div>
        <div class="scan-summary">${kpi('Expected',data.summary.expected)}${kpi('Scanned',data.summary.counted)}${kpi('Variances',data.summary.variances)}
          ${kpi('Missing',data.summary.missing)}${kpi('Location Mismatch',data.summary.locationMismatch)}</div>
        ${operationalTable(['Item','Description','Expected Serial','Actual Serial','Count Status','Variance','Actual Location',''],rows)}
      </section></div></div>`:operationalEmpty('Create or select a cycle count plan.')}`;
    content.innerHTML=workbenchShell(body,'approvals');bindOperationalShell();
    $('#physicalCountSelect').onchange=event=>renderPhysicalCount(Number(event.target.value));
    if(!data)return;
    $('#printCount').onclick=()=>printCycleCountSheet(data);
    // A sheet raised by mistake is removed from here too, not only from the
    // register - this is the screen you are looking at when you notice.
    if($('#removeCount'))$('#removeCount').onclick=()=>{
      const cno=data.header.count_no;
      const counted=Number(data.summary.counted||0);
      modal('Remove '+esc(cno)+'?',
        `<div class="operational-form"><p>This count sheet will be cancelled and disappear from the register.
          ${counted?`It already has <b>${counted}</b> scanned unit${counted===1?'':'s'}, which stay on the cancelled sheet - nothing is erased and nothing is posted to inventory.`
            :'Nothing has been scanned against it yet.'}</p>
        <div class="modal-actions"><button type="button" class="command primary" id="rcYes">Remove count sheet</button>
        <button type="button" class="command" id="rcNo">Keep it</button></div></div>`);
      const mb=$('#modalBody');
      mb.querySelector('#rcNo').onclick=()=>closeModal();
      mb.querySelector('#rcYes').onclick=async()=>{
        try{
          await api('/inventory/cycle-counts/'+id,{method:'DELETE'});
          closeModal();toast(cno+' removed');
          state.cycleCount=null;
          await renderPhysicalCount(null);
        }catch(error){toast(error.message,'error');}
      };
    };
    const scan=async value=>{
      const serial=serialFromQrPayload(value||$('#countSerial').value);
      if(!serial)return toast('Scan or enter a serial.','error');
      try{
        const result=await api(`/inventory/cycle-counts/${id}/scan`,{method:'POST',body:JSON.stringify({serialNo:serial,qrPayload:value||'',scanMethod:value?'QR':'MANUAL'})});
        const r=result.result||{};
        if(r.needsItemDetail){
          // Unknown serial: ask what it is now, while the unit is still in hand.
          toast(`${serial} counted · not in the system yet`,'success');
          await identifyCountedUnit(id,{id:r.lineId,actual_serial_no:serial});
        }else{
          toast(r.varianceType?`${serial}: ${String(r.varianceType).replace(/_/g,' ')}`:`${serial} counted`,r.varianceType?'error':'success');
        }
        await renderPhysicalCount(id);
      }catch(error){toast(error.message,'error');}
    };
    $('#countAdd').onclick=()=>scan('');
    $('#countSerial').onkeydown=event=>{if(event.key==='Enter')scan('');};
    $('#countCamera').onclick=()=>scanQrWithCamera(scan);
    $('#countMobile').onclick=()=>openMobileCount(id,data);
    if($('#countUpload'))$('#countUpload').onclick=()=>openCountUpload(id,data.header);
    $$('[data-edit-line]').forEach(b=>b.onclick=async()=>{
      const line=(data.lines||[]).find(x=>String(x.id)===b.dataset.editLine);
      if(!line)return;
      await identifyCountedUnit(id,line,{title:'Edit counted unit',lockSerial:!!line.expected_serial_no,
        note:line.is_new_unit?'This serial is not in the system yet. Identify it and it will be registered at this location when the count is posted.'
          :'This unit is already registered. You can correct the serial you scanned.',skipLabel:'Cancel'});
      await renderPhysicalCount(id);
    });
    $$('[data-drop-line]').forEach(b=>b.onclick=async()=>{
      const line=(data.lines||[]).find(x=>String(x.id)===b.dataset.dropLine);
      const expected=line&&line.expected_serial_no;
      const question=expected
        ? `Undo the scan of ${line.actual_serial_no}? The unit stays on the sheet as not yet counted.`
        : `Remove ${line?line.actual_serial_no:'this row'} from the count sheet? It was scanned in error and will not be recorded.`;
      modal(expected?'Undo this scan':'Remove this row',
        `<div class="operational-form"><p>${esc(question)}</p>
         <div class="modal-actions"><button type="button" class="command primary" id="dropYes">${expected?'Undo scan':'Remove row'}</button>
         <button type="button" class="command" id="dropNo">Keep it</button></div></div>`);
      const mb=$('#modalBody');
      mb.querySelector('#dropNo').onclick=()=>closeModal();
      mb.querySelector('#dropYes').onclick=async()=>{
        try{await api(`/inventory/cycle-counts/${id}/lines/${b.dataset.dropLine}`,{method:'DELETE'});
          closeModal();toast(expected?'Scan undone':'Row removed');await renderPhysicalCount(id);}
        catch(error){toast(error.message,'error');}
      };
    });
    $('#submitCount').onclick=async()=>{
      try{await api(`/inventory/cycle-counts/${id}/submit`,{method:'POST',body:'{}'});toast('Cycle count submitted and variance report generated');await renderPhysicalCount(id);}
      catch(error){toast(error.message,'error');}
    };
  }catch(error){showWorkspaceError(error);}
}

async function renderCycleVariances(countId=state.cycleCount){
  content.innerHTML='<div class="workspace-loading">Loading cycle-count variances…</div>';
  try{
    const register=await api('/inventory/cycle-counts');
    const id=Number(countId||register.rows.find(row=>Number(row.variance_units)>0)?.id||register.rows[0]?.id||0);
    const data=id?await api(`/inventory/cycle-counts/${id}`):null;
    const variance=id?await api(`/inventory/cycle-counts/${id}/variances`):{rows:[],total:0};
    const isFinance=String(state.session.user.role||'').toUpperCase()==='FINANCE';
    const rows=variance.rows.map(row=>`<tr><td>${isFinance?`<input type="checkbox" class="var-pick" value="${row.id||row.line_id||''}">`:''}${esc(row.variance_type)}</td><td>${esc(row.item_code||'-')}</td><td>${esc(row.item_name||'-')}</td>
      <td>${esc(row.expected_serial_no||'-')}</td><td>${esc(row.actual_serial_no||'-')}</td><td>${esc(row.count_location_code)}</td>
      <td>${esc(row.actual_location_code||'-')}</td><td>${esc(row.scanned_by||'-')}</td><td>${date(row.scanned_at)}</td></tr>`);
    const body=`<div class="workspace-commandbar"><label class="inline-control"><span>Count Plan</span><select id="varianceCountSelect"><option value="">Select count…</option>${register.rows.map(row=>`<option value="${row.id}" ${row.id===id?'selected':''}>${esc(row.count_no)} · ${esc(row.location_code)} · ${row.variance_units} variances</option>`).join('')}</select></label>
      ${data?.header.status==='SUBMITTED'?'<button class="command primary" id="approveCount">Approve Count Report</button>':''}
      ${isFinance&&variance.total?'<button class="command" id="financeOverride">Finance override</button>':''}
      ${!isFinance&&variance.total?'<span class="workspace-mode">FINANCE OVERRIDE REQUIRED</span>':''}</div>
      <section class="workspace-card"><header><h2>Physical Count Variance Report</h2><span>${variance.total} discrepancies</span></header>
        ${operationalTable(['Variance','Item','Description','Expected Serial','Actual Serial','Count Location','Actual Location','Scanned By','Scanned At'],rows)}</section>`;
    content.innerHTML=workbenchShell(body,'reports');bindOperationalShell();
    $('#varianceCountSelect').onchange=event=>renderCycleVariances(Number(event.target.value));
    if($('#financeOverride'))$('#financeOverride').onclick=()=>{
      const picked=$$('.var-pick').filter(x=>x.checked).map(x=>Number(x.value)).filter(Boolean);
      if(!picked.length)return toast('Tick the variance lines you are correcting.','error');
      modal('Finance override',`<form id="ovForm" class="operational-form grid">
        <label class="wide"><span>Correction</span><select name="resolution">
          <option value="ACCEPT_SYSTEM">System record is correct - clear the variance</option>
          <option value="ACCEPT_COUNT">Physical count is correct - keep for adjustment</option></select></label>
        <label class="wide"><span>Remarks explaining the discrepancy</span><textarea name="remarks" required></textarea></label>
        <div class="modal-actions wide"><button type="submit" class="command primary">Apply to ${picked.length} line(s)</button>
          <button type="button" class="command" id="ovCancel">Cancel</button></div></form>`,
        'Only Finance can override a physical count variance');
      const mb=$('#modalBody');
      mb.querySelector('#ovCancel').onclick=()=>closeModal();
      mb.querySelector('#ovForm').onsubmit=async event=>{
        event.preventDefault();const f=formDataObject(event.currentTarget);
        try{
          const r=await api(`/inventory/cycle-counts/${id}/override`,{method:'POST',body:JSON.stringify({
            remarks:f.remarks,lines:picked.map(lineId=>({lineId,resolution:f.resolution}))})});
          closeModal();toast(r.corrected+' variance line(s) corrected');await renderCycleVariances(id);
        }catch(err){toast(err.message,'error');}
      };
    };
    if($('#approveCount'))$('#approveCount').onclick=async()=>{
      try{await api(`/inventory/cycle-counts/${id}/approve`,{method:'POST',body:'{}'});toast('Cycle-count report approved');await renderCycleVariances(id);}
      catch(error){toast(error.message,'error');}
    };
  }catch(error){showWorkspaceError(error);}
}

function renderCycleSetup(){
  const body=`<div class="setup-grid">
    <section class="workspace-card"><header><h2>Cycle Count Method</h2></header><ol class="setup-steps">
      <li>Create a count plan for one warehouse or retail location.</li><li>Print the physical count sheet or open it on a mobile device.</li>
      <li>Scan each unit QR/serial or enter it manually.</li><li>Submit to mark uncounted expected units as missing.</li>
      <li>Review and approve the generated variance report.</li></ol></section>
    <section class="workspace-card"><header><h2>Variance Types</h2></header><div class="definition-list">
      <div><b>MISSING</b><span>Expected at the location but not counted.</span></div><div><b>LOCATION MISMATCH</b><span>Found but registered in another location.</span></div>
      <div><b>UNKNOWN SERIAL</b><span>Scanned serial does not exist in inventory.</span></div><div><b>DUPLICATE</b><span>Serial was already scanned in the count.</span></div>
    </div></section></div>`;
  content.innerHTML=workbenchShell(body,'setup');bindOperationalShell();
}

let __recCfg=null,__recPass='',__recEntity=null;
function recPrettyCol(c){return String(c).replace(/_/g,' ').replace(/\b\w/g,function(ch){return ch.toUpperCase();});}
async function renderRecordConsole(entityKey,search,includeInactive){
  document.body.classList.remove('workbench-view');document.body.classList.add('launchpad-view');
  content.innerHTML='<div class="workspace-loading">Loading records...</div>';
  try{
    if(!__recCfg)__recCfg=await api('/admin/records/config',{noCache:true});
    const cfg=__recCfg;
    __recEntity=entityKey||__recEntity||(cfg.entities[0]&&cfg.entities[0].key);
    const ent=cfg.entities.find(function(e){return e.key===__recEntity;})||cfg.entities[0];
    const inactive=includeInactive?1:0;
    const data=await api('/admin/records/'+ent.key+'?q='+encodeURIComponent(search||'')+'&includeInactive='+inactive,{noCache:true});
    const cols=data.columns;
    const tabHtml=cfg.entities.map(function(e){return '<button class="report-card'+(e.key===ent.key?' active':'')+'" data-rec-entity="'+esc(e.key)+'" style="flex:0 0 auto;min-width:150px">'+esc(e.label)+'</button>';}).join('');
    const head=cols.map(function(c){return '<th>'+esc(recPrettyCol(c))+'</th>';}).join('')+'<th>Actions</th>';
    const body=(data.rows||[]).map(function(r){
      var isInactive=data.hasActive&&Number(r.active)===0;
      var tds=cols.map(function(c){return '<td>'+esc(r[c]==null?'':r[c])+'</td>';}).join('');
      var act='<button class="table-action" data-rec-edit="'+r.id+'">Edit</button>'+(data.hasActive?(isInactive?'<button class="table-action" data-rec-restore="'+r.id+'">Restore</button>':'<button class="table-action danger" data-rec-del="'+r.id+'">Delete</button>'):'');
      return '<tr'+(isInactive?' style="opacity:.5"':'')+'>'+tds+'<td>'+act+'</td></tr>';
    }).join('');
    content.innerHTML='<div class="reports-hub"><div class="reports-top"><div><h1>Master Reference</h1><p>'+(cfg.financeAccess?'You have finance-level access - edits apply directly.':'Enter the edit passcode when prompted to save changes.')+' Delete deactivates a record (reversible via Restore). Every change is audited.</p></div><button class="command" id="recBack">&larr; Blitz - ERP</button></div>'+
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">'+tabHtml+'</div>'+
      '<div class="workspace-commandbar"><input id="recSearch" placeholder="Search '+esc(ent.label)+'" value="'+esc(search||'')+'"><button class="command primary" id="recApply">Search</button><label class="inline-control" style="margin-left:10px"><input type="checkbox" id="recInactive" '+(includeInactive?'checked':'')+'> Include deactivated</label>'+(ent.create?'<button class="command" id="recAdd" style="margin-left:auto">+ Add '+esc(ent.label)+'</button>':'')+'</div>'+
      '<section class="workspace-card"><div class="record-table-wrap"><table class="record-table"><thead><tr>'+head+'</tr></thead><tbody>'+(body||'<tr><td colspan="'+(cols.length+1)+'" style="text-align:center;padding:20px;color:#64748b">No records.</td></tr>')+'</tbody></table></div></section></div>';
    $('#recBack').onclick=renderLaunchpad;
    $$('[data-rec-entity]').forEach(function(b){b.onclick=function(){__recEntity=b.dataset.recEntity;renderRecordConsole(b.dataset.recEntity,'',false);};});
    $('#recApply').onclick=function(){renderRecordConsole(ent.key,$('#recSearch').value,$('#recInactive').checked);};
    $('#recSearch').onkeydown=function(e){if(e.key==='Enter')$('#recApply').click();};
    $('#recInactive').onchange=function(){$('#recApply').click();};
    $$('[data-rec-edit]').forEach(function(b){b.onclick=function(){recordEdit(ent.key,b.dataset.recEdit);};});
    $$('[data-rec-del]').forEach(function(b){b.onclick=function(){recordDelete(ent.key,b.dataset.recDel,false);};});
    $$('[data-rec-restore]').forEach(function(b){b.onclick=function(){recordDelete(ent.key,b.dataset.recRestore,true);};});
    if($('#recAdd'))$('#recAdd').onclick=function(){recordCreate(ent);};
  }catch(error){showWorkspaceError(error);}
}
async function recordCreate(ent){
  var form='<form id="recNewForm" class="operational-form">'+ent.editable.map(function(f){return '<label><span>'+esc(recPrettyCol(f))+'</span><input name="'+esc(f)+'"></label>';}).join('')+'<div class="modal-actions"><button type="submit" class="command primary">Add record</button></div></form>';
  modal('Add '+esc(ent.label),form,'Fill the fields and save');
  var fm=$('#modalBody').querySelector('#recNewForm');
  fm.onsubmit=async function(e){e.preventDefault();
    var auth=await recordAuthPass();if(!auth.ok)return;
    var data={};ent.editable.forEach(function(f){var v=fm.querySelector('[name="'+f+'"]').value;if(v!=='')data[f]=v;});
    if(!Object.keys(data).length)return toast('Fill at least one field.','error');
    try{await api('/admin/records/'+ent.key+'/new',{method:'POST',body:JSON.stringify({data:data,passcode:auth.passcode})});
      toast('Record added');closeModal();renderRecordConsole(ent.key,'',false);
    }catch(err){if(/passcode/i.test(err.message||''))__recPass='';toast(err.message||'Add failed','error');}
  };
}
async function recordAuthPass(){
  if(__recCfg&&__recCfg.financeAccess)return {ok:true};
  if(__recPass)return {ok:true,passcode:__recPass};
  var code=window.prompt('Enter the edit passcode to authorize this change:');
  if(!code)return {ok:false};
  __recPass=String(code).trim();return {ok:true,passcode:__recPass};
}
async function recordEdit(entity,id){
  try{
    var data=await api('/admin/records/'+entity+'/'+id,{noCache:true});
    var rec=data.record;var fields=data.editable;
    var form='<form id="recForm" class="operational-form">'+fields.map(function(f){return '<label><span>'+esc(recPrettyCol(f))+'</span><input name="'+esc(f)+'" value="'+esc(rec[f]==null?'':rec[f])+'"></label>';}).join('')+'<div class="modal-actions"><button type="submit" class="command primary">Save changes</button></div></form>';
    modal('Edit record #'+id,form,'Update the fields and save');
    var fm=$('#modalBody').querySelector('#recForm');
    fm.onsubmit=async function(e){e.preventDefault();
      var auth=await recordAuthPass();if(!auth.ok)return;
      var changes={};fields.forEach(function(f){changes[f]=fm.querySelector('[name="'+f+'"]').value;});
      try{await api('/admin/records/'+entity+'/'+id,{method:'POST',body:JSON.stringify({changes:changes,passcode:auth.passcode})});
        toast('Record updated');closeModal();renderRecordConsole(entity,$('#recSearch')?$('#recSearch').value:'',$('#recInactive')?$('#recInactive').checked:false);
      }catch(err){if(/passcode/i.test(err.message||''))__recPass='';toast(err.message||'Update failed','error');}
    };
  }catch(err){toast(err.message||'Unable to load record','error');}
}
async function recordDelete(entity,id,restore){
  if(!restore&&!window.confirm('Deactivate this record? It will be hidden but can be restored.'))return;
  var auth=await recordAuthPass();if(!auth.ok)return;
  try{await api('/admin/records/'+entity+'/'+id+'/delete',{method:'POST',body:JSON.stringify({restore:!!restore,passcode:auth.passcode})});
    toast(restore?'Record restored':'Record deactivated');
    renderRecordConsole(entity,$('#recSearch')?$('#recSearch').value:'',$('#recInactive')?$('#recInactive').checked:false);
  }catch(err){if(/passcode/i.test(err.message||''))__recPass='';toast(err.message||'Action failed','error');}
}

async function renderSupplierPortal(section){
  content.innerHTML='<div class="workspace-loading">Loading vendor accreditation...</div>';
  try{
    const lookups=await api('/masters/lookups');
    let vendors=[];try{const __acc=await api('/masters/accredited-vendors');vendors=(__acc.rows||[]);}catch(e){vendors=[];}
    const defaultAdmin='https://script.google.com/a/macros/nrdev.ph/s/AKfycbwOPU2Ak4yJAnniNghLH9EBSEP6VZo6oFiWvHdl0VcFGRfAckEfb3Uoy_r4bYfm5fN8/exec';
    const portalUrl=localStorage.getItem('e88-accreditation-url')||defaultAdmin;
    const vendorUrl=portalUrl.indexOf('?')>=0?portalUrl+'&vendor=1':portalUrl+'?vendor=1';
    const stages=['Vendor Submits','Requestor Endorses','Document Review','Finance / Owner Approval','Accredited'];
    const docList=['DTI/SEC Registration','SEC GIS (General Information Sheet)','BIR Form 2303','Business Permit (current year)','Bank Certificate','Company Profile','Signed Non-Disclosure Agreement','Signed Compliance Declaration','Signed Anti-Bribery & Ethics Declaration','Latest Audited Financial Statement','Sample Sales/Service Invoice'];
    const vrows=vendors.map(function(v){return '<tr><td><b>'+esc(v.vendor_name)+'</b></td><td>'+esc(v.partner_code||'-')+'</td><td>'+statusBadge(v.status||'-')+'</td></tr>';});
    const docItems=docList.map(function(d){return '<li>'+esc(d)+'</li>';}).join('');
    const portalBtn='<a class="portal-icon-btn" href="'+esc(portalUrl)+'" target="_blank" rel="noopener" title="Open the accreditation admin console">Console \u2197</a>'
      +'<a class="portal-icon-btn" href="'+esc(vendorUrl)+'" target="_blank" rel="noopener" title="Open the vendor submission form">Vendor form \u2197</a>'
      +'<button class="portal-icon-btn" id="setPortalUrl" title="Change the portal link">\u2699</button>';
    const body=workflowStrip(stages,4)+
      '<div class="workspace-commandbar"><span class="workspace-mode">VENDOR ACCREDITATION</span><span class="command-spacer"></span>'+portalBtn+'</div>'+
      '<div class="workspace-kpis">'+kpi('Vendors',vendors.length)+kpi('Accredited',vendors.filter(function(v){return /^accredited$/i.test((v.status||'').trim());}).length)+kpi('Required Documents',docList.length)+kpi('Portal',portalUrl?'Linked':'Not linked')+'</div>'+
      '<div class="ramco-layout"><div class="ramco-main">'+
        '<section class="workspace-card"><header><div><h2>How vendor accreditation works</h2></div></header>'+
          '</section>'+
        '<section class="workspace-card"><header><div><h2>Vendor Directory</h2></div></header>'+
          operationalTable(['Vendor','Vendor Code','Status'],vrows,{key:'vendor-directory',emptyMessage:'No accredited vendors loaded.'})+'</section>'+
      '</div><aside class="ramco-rail">'+
        '<section><header>Required Documents</header><ul class="doc-checklist">'+docItems+'</ul></section>'+
        ''+
      '</aside></div>';
    content.innerHTML=workbenchShell(body,'center');bindOperationalShell();
    var sp=$('#setPortalUrl');if(sp)sp.onclick=function(){var u=window.prompt('Paste your Vendor Accreditation Portal URL (the Google Apps Script web-app link):',portalUrl);if(u!=null){localStorage.setItem('e88-accreditation-url',u.trim());renderSupplierPortal(section);}};
  }catch(error){showWorkspaceError(error);}
}

function reportsCatalog(){return [
  {key:'fin-trial-balance',cat:'FIN',title:'Trial Balance',desc:'All accounts with debit, credit and balance',endpoint:'/finance/reports/trial-balance',dateMode:'ASOF',asOfParam:'dateTo',groupBy:'account_type',totals:['debit','credit'],filters:[['account_type','Type']],
    columns:[['account_code','Account'],['account_name','Name'],['account_type','Type'],['debit','Debit','money'],['credit','Credit','money'],['balance','Balance','money']]},
  {key:'fin-ar-aging',cat:'FIN',title:'AR Aging',desc:'Open customer receivables by aging bucket',endpoint:'/finance/aging/AR',dateMode:'ASOF',asOfParam:'asOf',groupBy:'aging_bucket',totals:['open_balance'],filters:[['aging_bucket','Bucket']],
    columns:[['partner_name','Customer'],['document_no','Document'],['document_date','Date','date'],['due_date','Due','date'],['open_balance','Open Balance','money'],['aging_bucket','Bucket']]},
  {key:'fin-ap-aging',cat:'FIN',title:'AP Aging',desc:'Open supplier payables by aging bucket',endpoint:'/finance/aging/AP',dateMode:'ASOF',asOfParam:'asOf',groupBy:'aging_bucket',totals:['open_balance'],filters:[['aging_bucket','Bucket']],
    columns:[['partner_name','Supplier'],['document_no','Document'],['document_date','Date','date'],['due_date','Due','date'],['open_balance','Open Balance','money'],['aging_bucket','Bucket']]},
  {key:'sd-sales-orders',cat:'SD',title:'Sales & Lease Orders',desc:'All customer orders (sale and lease)',endpoint:'/sales',fetchAll:true,dateMode:'RANGE',dateField:'order_date',totals:['gross_amount','line_count'],filters:[['transaction_type','Type'],['status','Status']],
    columns:[['sales_order_no','Order'],['customer_name','Customer'],['transaction_type','Type'],['order_date','Date','date'],['gross_amount','Amount','money'],['line_count','Lines','num'],['status','Status']]},
  {key:'sd-deliveries',cat:'SD',title:'Deliveries',desc:'All deliveries and their status',endpoint:'/deliveries',fetchAll:true,dateMode:'RANGE',dateField:function(r){return r.actual_delivery_date||r.scheduled_date||r.created_at;},totals:['asset_count'],filters:[['status','Status']],
    columns:[['delivery_no','Delivery'],['requisition_no','Requisition'],['delivery_date','Date','date',function(r){return r.actual_delivery_date||r.scheduled_date||r.created_at;}],['destination','Destination'],['recipient_name','Holder'],['asset_count','Serials','num'],['status','Status']]},
  {key:'sd-returns',cat:'SD',title:'Goods Returns',desc:'Customer and custody returns',endpoint:'/returns',fetchAll:true,dateMode:'RANGE',dateField:'return_date',totals:['line_count'],filters:[['return_type','Type'],['status','Status']],
    columns:[['return_no','Return'],['return_type','Type'],['customer_name','Customer / Holder',null,function(r){return r.customer_name||r.partner_name||'';}],['return_date','Date','date'],['line_count','Lines','num'],['status','Status']]},
  {key:'sd-units-by-month',cat:'SD',title:'Units Sold by Month',desc:'Sold units and value per month and class',endpoint:'/sales/reports/units-by-month',dateMode:'RANGE',dateField:'ym',dateGranularity:'month',totals:['units','amount'],filters:[['class_name','Class']],
    columns:[['ym','Month'],['class_name','Class'],['units','Units','num'],['amount','Gross Amount','money']]},
  {key:'ip-by-class',cat:'IP',title:'Inventory by Class',desc:'Available, leased, total and value per class',endpoint:'/inventory/by-class',dateMode:'NONE',totals:['available','leased','total_units','sold','inventory_value'],
    columns:[['class_name','Inventory Class'],['available','Available','num'],['leased','Leased','num'],['total_units','Total Units','num',function(r){return Number(r.available||0)+Number(r.leased||0);}],['sold','Sold (ref)','num'],['inventory_value','Inventory Value','money']]},
  {key:'ip-stock-analysis',cat:'IP',title:'Inventory by Item',desc:'Per-item available, leased, sold and value',endpoint:'/inventory/analysis',dateMode:'NONE',totals:['available_qty','leased_qty','sold_qty','inventory_value'],filters:[['category','Class'],['primary_location','Location']],
    filter:function(r){return (Number(r.available_qty||0)+Number(r.leased_qty||0)+Number(r.sold_qty||0)+Number(r.on_hand_qty||0))>0;},
    columns:[['item_code','Material Code'],['item_name','Item'],['category','Class'],['primary_location','Location'],['available_qty','Available','num'],['leased_qty','Leased','num'],['sold_qty','Sold','num'],['inventory_value','Inventory Value','money']]},
  {key:'ip-movements',cat:'IP',title:'Stock Movement Register',desc:'Serialized stock-ledger movements',endpoint:'/inventory/movements',fetchAll:true,maxPages:24,dateMode:'RANGE',dateField:'movement_date',filters:[['movement_type','Type']],
    columns:[['movement_no','Movement'],['movement_date','Date','date'],['movement_type','Type'],['serial_no','Serial'],['item_name','Item'],['from_location_code','From'],['to_location_code','To'],['posted_by','Posted By']]}
];}

function reportRows(def,data){var r=def.rowsPath?def.rowsPath(data):(data.rows||data.items||[]);return def.filter?r.filter(def.filter):r;}
function reportCellValue(col,row){return col[3]?col[3](row):row[col[0]];}
async function renderReportsHub(){
  state.module=null;state.definition=null;state.section='center';
  document.body.classList.remove('workbench-view');document.body.classList.add('launchpad-view');
  const cats=[['Finance & Accounting','FIN'],['Sales & Distribution','SD'],['Inventory & Procurement','IP']];
  const defs=reportsCatalog();
  const catHtml=cats.map(function(c){return '<section class="report-cat"><header><h2>'+c[0]+'</h2><span>'+defs.filter(d=>d.cat===c[1]).length+' reports</span></header><div class="report-grid">'+
    defs.filter(d=>d.cat===c[1]).map(d=>'<button class="report-card" data-report="'+esc(d.key)+'"><b>'+esc(d.title)+'</b><span>'+esc(d.desc||'')+'</span></button>').join('')+'</div></section>';}).join('');
  content.innerHTML='<div class="reports-hub"><div class="reports-top"><div><h1>Reports &amp; Analytics</h1><p>Financial and operational reports across E88. Open a report to view it and export to Excel.</p></div><button class="command" id="reportsBack">&larr; Blitz - ERP</button></div>'+catHtml+'</div>';
  $('#reportsBack').onclick=renderLaunchpad;
  $$('[data-report]').forEach(b=>b.onclick=()=>renderReport(b.dataset.report));
}
function reportDateVal(def,row){if(!def.dateField)return null;return typeof def.dateField==='function'?def.dateField(row):row[def.dateField];}
function reportColByKey(def,key){for(var i=0;i<def.columns.length;i++)if(def.columns[i][0]===key)return def.columns[i];return null;}
function reportSum(def,rows,key){var col=reportColByKey(def,key);var sm=0;for(var i=0;i<rows.length;i++){var v=col?reportCellValue(col,rows[i]):rows[i][key];v=Number(v);if(!isNaN(v))sm+=v;}return sm;}
function reportNumFmt(v){return new Intl.NumberFormat('en-US').format(Number(v)||0);}
async function renderReport(key,opts){
  opts=opts||{};opts.filters=opts.filters||{};
  var def=reportsCatalog().find(function(d){return d.key===key;});
  if(!def)return renderReportsHub();
  content.innerHTML='<div class="workspace-loading">Loading report...</div>';
  try{
    var asOf=(def.dateMode==='ASOF')?(opts.asOf||new Date().toISOString().slice(0,10)):null;
    var basePath=def.endpoint;
    if(asOf){var ap=def.asOfParam||'asOf';basePath+=(basePath.indexOf('?')>=0?'&':'?')+ap+'='+encodeURIComponent(asOf);}
    var allRows=[];
    if(def.fetchAll){var page=1,size=def.pageSize||250,cap=def.maxPages||20;while(page<=cap){var sep=basePath.indexOf('?')>=0?'&':'?';var dd=await api(basePath+sep+'size='+size+'&page='+page);var rr=reportRows(def,dd);allRows=allRows.concat(rr);if(rr.length<size)break;page++;}}
    else{var d1=await api(basePath);allRows=reportRows(def,d1);}
    var rows=allRows.slice();
    if(def.dateMode==='RANGE'&&(opts.from||opts.to)){rows=rows.filter(function(r){var v=reportDateVal(def,r);if(!v)return false;v=String(v);if(def.dateGranularity==='month'){v=v.slice(0,7);var f=opts.from?opts.from.slice(0,7):null,t=opts.to?opts.to.slice(0,7):null;return (!f||v>=f)&&(!t||v<=t);}v=v.slice(0,10);return (!opts.from||v>=opts.from)&&(!opts.to||v<=opts.to);});}
    if(def.filters)def.filters.forEach(function(fl){var val=opts.filters[fl[0]];if(val)rows=rows.filter(function(r){return String(r[fl[0]]==null?'':r[fl[0]])===val;});});
    var cols=def.columns;
    var pt=[];
    if(def.dateMode==='RANGE')pt.push('Period: '+(opts.from?date(opts.from):'Beginning')+' to '+(opts.to?date(opts.to):'Today'));
    if(def.dateMode==='ASOF')pt.push('As of '+date(asOf));
    if(def.filters)def.filters.forEach(function(fl){if(opts.filters[fl[0]])pt.push(fl[1]+': '+opts.filters[fl[0]]);});
    var paramText=pt.join(' · ')||'All records';
    var nowd=new Date();
    var masthead='<div class="report-masthead"><div class="rm-co">E88 Ventures Inc.</div><div class="rm-title">'+esc(def.title)+'</div><div class="rm-meta">'+esc(paramText)+'</div><div class="rm-meta rm-sub">Generated '+date(nowd.toISOString())+' '+nowd.toTimeString().slice(0,5)+' · '+rows.length+' rows</div></div>';
    var ctrl='';
    if(def.dateMode==='ASOF')ctrl+='<label class="inline-control"><span>As of</span><input type="date" id="rAsOf" value="'+esc(asOf)+'"></label>';
    if(def.dateMode==='RANGE')ctrl+='<label class="inline-control"><span>From</span><input type="date" id="rFrom" value="'+esc(opts.from||'')+'"></label><label class="inline-control"><span>To</span><input type="date" id="rTo" value="'+esc(opts.to||'')+'"></label>';
    if(def.filters)def.filters.forEach(function(fl){var seen={},vals=[];allRows.forEach(function(r){var v=r[fl[0]];if(v!=null&&v!==''&&!seen[v]){seen[v]=1;vals.push(String(v));}});vals.sort();ctrl+='<label class="inline-control"><span>'+esc(fl[1])+'</span><select data-rfilter="'+esc(fl[0])+'"><option value="">All</option>'+vals.map(function(v){return '<option'+(opts.filters[fl[0]]===String(v)?' selected':'')+'>'+esc(v)+'</option>';}).join('')+'</select></label>';});
    var hasParams=(opts.from||opts.to||opts.asOf||Object.keys(opts.filters).some(function(k){return opts.filters[k];}));
    if(ctrl){ctrl+='<button class="command primary" id="rApply">Apply</button>';if(hasParams)ctrl+='<button class="command" id="rClear">Clear</button>';}
    var head=cols.map(function(c){return '<th'+((c[2]==='money'||c[2]==='num')?' class="num"':'')+'>'+esc(c[1])+'</th>';}).join('');
    function cellsFor(r){return cols.map(function(c){var v=reportCellValue(c,r);var cls=(c[2]==='money'||c[2]==='num')?' class="num"':'';var disp=c[2]==='money'?money(v):(c[2]==='date'?date(v):esc(v==null?'':v));return '<td'+cls+'>'+disp+'</td>';}).join('');}
    function totalRowHtml(label,subset,klass){return '<tr class="'+klass+'">'+cols.map(function(c,i){var cls=(c[2]==='money'||c[2]==='num')?' class="num"':'';if(i===0)return '<td'+cls+'>'+esc(label)+'</td>';if(def.totals&&def.totals.indexOf(c[0])>=0){var sv=reportSum(def,subset,c[0]);return '<td'+cls+'>'+(c[2]==='money'?money(sv):reportNumFmt(sv))+'</td>';}return '<td'+cls+'></td>';}).join('')+'</tr>';}
    var bodyHtml='';
    if(def.groupBy&&rows.length){var gcol=reportColByKey(def,def.groupBy);var sorted=rows.slice().sort(function(a,b){var av=String(reportCellValue(gcol,a)||''),bv=String(reportCellValue(gcol,b)||'');return av<bv?-1:(av>bv?1:0);});var cur=null,bucket=[];sorted.forEach(function(r){var g=String(reportCellValue(gcol,r)||'');if(cur===null)cur=g;if(g!==cur){bodyHtml+=bucket.map(function(x){return '<tr>'+cellsFor(x)+'</tr>';}).join('');if(def.totals&&def.totals.length)bodyHtml+=totalRowHtml(cur+' subtotal',bucket,'report-subtotal');cur=g;bucket=[];}bucket.push(r);});if(bucket.length){bodyHtml+=bucket.map(function(x){return '<tr>'+cellsFor(x)+'</tr>';}).join('');if(def.totals&&def.totals.length)bodyHtml+=totalRowHtml(cur+' subtotal',bucket,'report-subtotal');}}
    else{bodyHtml=rows.map(function(r){return '<tr>'+cellsFor(r)+'</tr>';}).join('');}
    var grand=(def.totals&&def.totals.length&&rows.length)?totalRowHtml('Total',rows,'report-total'):'';
    var empty='<tr><td colspan="'+cols.length+'" style="text-align:center;padding:24px;color:#64748b">No records for these parameters.</td></tr>';
    var tableHtml='<div class="record-table-wrap"><table class="record-table"><thead><tr>'+head+'</tr></thead><tbody>'+(bodyHtml||empty)+grand+'</tbody></table></div>';
    content.innerHTML='<div class="reports-hub"><div class="reports-top"><div><h1>'+esc(def.title)+'</h1><p>'+esc(def.desc||'')+'</p></div><div class="report-actions"><button class="command" id="reportBackHub">&larr; All Reports</button><button class="command primary" id="reportExcel">Export to Excel</button><button class="command" id="reportPrint">Print</button></div></div>'+(ctrl?('<div class="workspace-commandbar report-params">'+ctrl+'</div>'):'')+masthead+'<section class="workspace-card report-body-card">'+tableHtml+'</section></div>';
    window.__reportExport={cols:cols,rows:rows,def:def,paramText:paramText};
    $('#reportBackHub').onclick=renderReportsHub;
    $('#reportExcel').onclick=exportReportExcel;
    $('#reportPrint').onclick=function(){window.print();};
    if($('#rApply'))$('#rApply').onclick=function(){var no={filters:{}};if($('#rAsOf'))no.asOf=$('#rAsOf').value;if($('#rFrom'))no.from=$('#rFrom').value;if($('#rTo'))no.to=$('#rTo').value;$$('[data-rfilter]').forEach(function(sel){if(sel.value)no.filters[sel.getAttribute('data-rfilter')]=sel.value;});renderReport(key,no);};
    if($('#rClear'))$('#rClear').onclick=function(){renderReport(key,{});};
  }catch(error){var m=String(error&&error.message||error);if(/long-running export|D1_ERROR/i.test(m)){content.innerHTML='<div class="reports-hub"><div class="reports-top"><div><h1>'+esc(def.title)+'</h1></div><div class="report-actions"><button class="command" id="reportBackHub">&larr; All Reports</button></div></div><div class="workspace-empty" style="padding:30px;text-align:center"><b>The database is finishing a background task.</b><p style="margin:8px 0 14px;color:#556">This happens briefly during a backup or deploy. Try again in a few seconds.</p><button class="command primary" id="rRetry">Retry</button></div></div>';var rb=$('#rRetry');if(rb)rb.onclick=function(){renderReport(key,opts);};var bh=$('#reportBackHub');if(bh)bh.onclick=renderReportsHub;}else showWorkspaceError(error);}
}

function exportReportExcel(){
  var x=window.__reportExport;if(!x)return;var def=x.def,cols=x.cols,rows=x.rows;
  function q(v){if(v==null)v='';return '"'+String(v).replace(/"/g,'""')+'"';}
  var lines=[];
  lines.push(q('E88 Ventures Inc.'));
  lines.push(q(def.title));
  lines.push(q(x.paramText||''));
  lines.push(q('Generated '+new Date().toLocaleString()));
  lines.push('');
  lines.push(cols.map(function(c){return q(c[1]);}).join(','));
  rows.forEach(function(r){lines.push(cols.map(function(c){var v=reportCellValue(c,r);if(c[2]==='money'||c[2]==='num')v=(v==null||v==='')?'':Number(v);return q(v);}).join(','));});
  if(def.totals&&def.totals.length&&rows.length){lines.push(cols.map(function(c,i){if(i===0)return q('Total');if(def.totals.indexOf(c[0])>=0)return String(reportSum(def,rows,c[0]));return q('');}).join(','));}
  var csv='﻿'+lines.join('\r\n');
  var blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download=(def.key||'report')+'-'+new Date().toISOString().slice(0,10)+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);
  if(typeof toast==='function')toast('Exported '+rows.length+' rows to Excel (CSV)');
}


async function renderInventoryAnalysisWorkspace(section){
  if(section==='records')return renderStockAnalysis();
  if(section==='approvals')return renderInventoryPlans();
  if(section==='reports')return renderInventoryPlanningReports();
  if(section==='setup')return renderInventoryPlanningSetup();
  return renderInventoryAnalysisOverview();
}

let __invFrom='',__invTo='';
async function renderInventoryAnalysisOverview(){
  content.innerHTML='<div class="workspace-loading">Loading inventory...</div>';
  try{
    const period=(__invFrom&&__invTo);
    const byClass=await api('/inventory/by-class'+(period?('?from='+encodeURIComponent(__invFrom)+'&to='+encodeURIComponent(__invTo)):''));
    const cls=(byClass.rows||[]);
    const rows=cls.map(function(c){
      var avail=Number(c.available||0),leased=Number(c.leased||0),total=avail+leased;
      return '<tr><td><b>'+esc(c.class_name||c.cls||'Class')+'</b></td>'+
      '<td class="num">'+avail.toLocaleString()+'</td>'+
      '<td class="num">'+leased.toLocaleString()+'</td>'+
      '<td class="num"><b>'+total.toLocaleString()+'</b></td>'+
      '<td class="num">'+Number(c.sold||0).toLocaleString()+'</td>'+
      '<td class="num">'+money(c.inventory_value)+'</td></tr>';});
    var moveCard='';
    if(period){
      var mv=(byClass.movement||[]);var mmap={};mv.forEach(function(m){mmap[m.cls]={sold:m.sold,leased:m.leased};});
      var mrows=cls.map(function(c){var m=mmap[c.cls]||{sold:0,leased:0};return '<tr><td><b>'+esc(c.class_name||c.cls)+'</b></td><td class="num">'+Number(m.leased||0).toLocaleString()+'</td><td class="num">'+Number(m.sold||0).toLocaleString()+'</td></tr>';});
      moveCard='<section class="workspace-card"><header><div><h2>Movement in Selected Period</h2><span>Units newly leased or sold between '+esc(__invFrom)+' and '+esc(__invTo)+'</span></div></header>'+operationalTable(['Inventory Class','Leased in Period','Sold in Period'],mrows,{key:'class-movement'})+'</section>';
    }
    const dateBar='<div class="workspace-commandbar"><label class="inline-control"><span>From</span><input type="date" id="invFrom" value="'+esc(__invFrom)+'"></label>'+
      '<label class="inline-control"><span>To</span><input type="date" id="invTo" value="'+esc(__invTo)+'"></label>'+
      '<button class="command primary" id="invApplyDates">Apply</button>'+(period?'<button class="command" id="invClearDates">Clear</button>':'')+
      '<span class="command-spacer"></span><span class="workspace-mode">'+(period?'PERIOD MOVEMENT':'CURRENT SNAPSHOT')+'</span></div>';
    const body=dateBar+'<section class="workspace-card"><header><div><h2>Inventory by Class</h2><span>Total Units = Available + Leased (what you physically hold). Sold is shown for reference only - those units have left inventory.</span></div><button class="ramco-primary" data-section-link="records">Open Stock Analysis</button></header>'+
      operationalTable(['Inventory Class','Available','Leased','Total Units','Sold (reference)','Inventory Value'],rows,{key:'class-operational',emptyMessage:'No classified inventory records.'})+
      '</section>'+moveCard+
      '<div class="ramco-layout"><div class="ramco-main"></div><aside class="ramco-rail">'+
      '<section><header>Planning Actions</header><div class="ramco-action-links"><button data-open-product-reg>Register / Edit Product</button><button data-section-link="records">Stock Analysis</button><button data-section-link="approvals">Ordering / Deployment Plans</button><button data-section-link="reports">Planning Reports</button></div></section></aside></div>';
    content.innerHTML=workbenchShell(body,'center');
    bindOperationalShell();
    var prb=$('[data-open-product-reg]');if(prb)prb.onclick=function(){renderProductRegistration();};
    var ab=$('#invApplyDates');if(ab)ab.onclick=function(){var f=$('#invFrom').value||'',t=$('#invTo').value||'';if(!f||!t){toast('Select both From and To dates.','error');return;}__invFrom=f;__invTo=t;renderInventoryAnalysisOverview();};
    var cb=$('#invClearDates');if(cb)cb.onclick=function(){__invFrom='';__invTo='';renderInventoryAnalysisOverview();};
  }catch(error){showWorkspaceError(error);}
}

function __mvEnsure(){ if(window.__mvLoaded)return; window.__mvLoaded=true; var sc=document.createElement('script'); sc.type='module'; sc.src='https://unpkg.com/@google/model-viewer@3.5.0/dist/model-viewer.min.js'; sc.onerror=function(){window.__mvFailed=true;}; document.head.appendChild(sc); }

async function renderProductRegistration(editId){
  content.innerHTML='<div class="workspace-loading">Loading product registration...</div>';
  try{
    const list=await api('/masters/items?size=500');
    const items=(list.rows||[]);
    let current=null;
    if(editId){ try{ current=await api('/masters/items/'+editId+'/full'); }catch(e){} }
    const cats=[['MC','Motorcycle'],['BAT','Battery'],['BSS','Swap Station / Locker'],['CHG','Charger'],['SP','Spare Part / Accessory'],['OTH','Other']];
    const it=current?current.item:{}; const pf=current?(current.profile||{}):{};
    const ptype=(pf.product_type||(it.serialized?'SERIALIZED':'QUANTITY'));
    const listRows=items.map(function(r){var nm=(r.item_name||'').replace(/\s+/g,' ').trim();if(nm.length>52)nm=nm.slice(0,52)+'\u2026';var srch=((r.item_code||'')+' '+(r.item_name||'')+' '+(r.category||'')).toLowerCase();return '<button type="button" class="pr-listrow" data-prod-open="'+r.id+'" data-search="'+esc(srch)+'"><b>'+esc(r.item_code)+'</b><span class="pr-ln">'+esc(nm)+'</span><em>'+esc(r.category)+'</em></button>';}).join('');
    const catOpts=cats.map(function(x){return '<option value="'+x[0]+'"'+((it.category===x[0])?' selected':'')+'>'+x[1]+'</option>';}).join('');
    const typeOpt=function(v,label,desc){return '<label class="pdi-check"><input type="radio" name="ptype" value="'+v+'"'+(ptype===v?' checked':'')+'><span><b>'+label+'</b><br><small>'+desc+'</small></span></label>';};
    const body='<div class="workspace-commandbar"><span class="workspace-mode">PRODUCT REGISTRATION</span><span class="command-spacer"></span><button class="command" id="prNew">+ New Product</button></div>'+
      '<div class="ramco-layout"><div class="ramco-main">'+
        '<section class="workspace-card"><header><div><h2>'+(current?('Edit - '+esc(it.item_code)):'Register a Product')+'</h2></div></header>'+
        '<form id="prodForm" class="operational-form grid">'+
          '<input type="hidden" name="id" value="'+(current?it.id:'')+'">'+
          '<label><span>Product Name</span><input name="itemName" required value="'+esc(it.item_name||'')+'"></label>'+
          '<label><span>Item Code</span><input name="itemCode" value="'+esc(it.item_code||'')+'" placeholder="Auto if blank"'+(current?' readonly':'')+'></label>'+
          '<label><span>Class</span><select name="category">'+catOpts+'</select></label>'+
          '<label><span>Model / Variant</span><input name="model" value="'+esc(it.model||'')+'" placeholder="e.g. D400, R280, R280 Sport"></label>'+
          '<label><span>Unit of Measure</span><input name="uom" value="'+esc(it.base_uom||'EA')+'"></label>'+
          '<label><span>Standard / Landed Cost</span><input name="standardCost" type="number" step="0.01" value="'+esc(it.standard_cost||0)+'"></label>'+
          '<label><span>Sale / List Price</span><input name="salePrice" type="number" step="0.01" value="'+esc(pf.sale_price||0)+'"></label>'+
          '<label class="wide"><span>Description</span><textarea name="description">'+esc(pf.description||'')+'</textarea></label>'+
          '<div class="wide"><span style="font-size:12px;color:#607080">Product Type</span><div class="pdi-grid">'+
            typeOpt('SERIALIZED','Inventoriable - Serialized','Each unit tracked by serial (motorcycles, batteries, stations)')+
            typeOpt('QUANTITY','Inventoriable - Quantity','Stocked by count (spare parts, accessories)')+
            typeOpt('SERVICE','Non-inventoriable','Service / expense item, not held in stock')+
          '</div></div>'+
          '<button class="command primary">'+(current?'Save Changes':'Register Product')+'</button>'+
        '</form></section>'+
        ('<section class="workspace-card" id="mediaCard"><header><div><h2>Photos & 3D</h2><span>'+(current?'Upload unit photos (JPG/PNG, max 4MB each). Multiple photos enable the 360 spin. Optional .glb/.gltf 3D model for a movable view.':'Enter a product name above, then pick a photo here - the product saves automatically and the image is attached. JPG/PNG, max 4MB each.')+'</span></div></header>'+
          '<div class="lease-unit-picker"><label><span>Add photo(s)</span><input type="file" id="prPhoto" accept="image/*" multiple></label>'+
          '<label><span>Add 3D model (.glb/.gltf)</span><input type="file" id="prModel" accept=".glb,.gltf,model/gltf-binary"></label></div>'+
          '<div id="prMedia" class="pr-media"></div></section>')+
      '</div><aside class="ramco-rail"><section><header>All Products ('+items.length+')</header>'+
        '<input id="prSearch" class="pr-search" placeholder="Search code, name or class...">'+
        '<div class="pr-list">'+(listRows||'<div class="workspace-empty">No products yet.</div>')+'</div>'+
      '</section></aside></div>';
    content.innerHTML=workbenchShell(body,'center');bindOperationalShell();
    $('#prNew')&&($('#prNew').onclick=function(){renderProductRegistration();});
    var __ps=$('#prSearch');if(__ps)__ps.oninput=function(){var q=__ps.value.toLowerCase();$$('.pr-listrow').forEach(function(el){el.style.display=(!q||(el.getAttribute('data-search')||'').indexOf(q)>=0)?'':'none';});};
    $$('[data-prod-open]').forEach(function(row){row.onclick=function(){renderProductRegistration(row.getAttribute('data-prod-open'));};});
    $('#prodForm').onsubmit=async function(e){
      e.preventDefault();
      const p=formDataObject(e.currentTarget);
      p.productType=(e.currentTarget.querySelector('input[name="ptype"]:checked')||{}).value||'SERIALIZED';
      if(!p.id)delete p.id;
      try{ const r=await api('/masters/items/register',{method:'POST',body:JSON.stringify(p)}); toast('Product saved: '+(r.item&&r.item.item_code)); renderProductRegistration(r.item.id); }
      catch(err){ toast(err.message,'error'); }
    };
    async function __ensureProductId(){
      if(current) return it.id;
      const form=$('#prodForm'); if(!form) return null;
      if(!form.itemName||!form.itemName.value.trim()){ toast('Enter a product name first, then add photos','error'); return null; }
      const p=formDataObject(form);
      p.productType=(form.querySelector('input[name="ptype"]:checked')||{}).value||'SERIALIZED';
      delete p.id;
      const r=await api('/masters/items/register',{method:'POST',body:JSON.stringify(p)});
      return r.item&&r.item.id;
    }
    if(current){ __renderProductMedia(current); }
    $('#prPhoto')&&($('#prPhoto').onchange=async function(ev){ try{ const id=await __ensureProductId(); if(!id)return; for(const file of ev.target.files){ await __uploadProductMedia(id,file,'photo'); } renderProductRegistration(id); }catch(e){toast(e.message,'error');} });
    $('#prModel')&&($('#prModel').onchange=async function(ev){ try{ const id=await __ensureProductId(); if(!id)return; const file=ev.target.files[0]; if(file){ await __uploadProductMedia(id,file,'model'); renderProductRegistration(id); } }catch(e){toast(e.message,'error');} });
  }catch(error){showWorkspaceError(error);}
}

async function __uploadProductMedia(itemId,file,kind){
  const fd=new FormData(); fd.append('file',file); fd.append('kind',kind);
  try{ await api('/masters/items/'+itemId+'/media',{method:'POST',body:fd}); toast(kind+' uploaded'); }
  catch(e){ toast(e.message,'error'); }
}

function __renderProductMedia(full){
  const host=$('#prMedia'); if(!host)return;
  const media=(full.media||[]);
  const photos=media.filter(function(m){return m.kind==='photo';});
  const models=media.filter(function(m){return m.kind==='model';});
  const fileUrl=function(m){return '/api/masters/items/media/'+m.id+'/file';};
  let html='';
  if(models.length){ __mvEnsure(); html+='<div class="pr-3d"><h4>3D Model (drag to rotate)</h4><model-viewer src="'+fileUrl(models[0])+'" camera-controls auto-rotate touch-action="pan-y" style="width:100%;height:320px;background:#0e1b2b;border-radius:10px" ar></model-viewer><div><a href="'+fileUrl(models[0])+'" target="_blank" rel="noopener">Download model</a> · <button class="table-action danger" data-del-media="'+models[0].id+'">Remove</button></div></div>'; }
  if(photos.length>=2){ html+='<div class="pr-spin"><h4>360 Spin ('+photos.length+' frames - drag left/right)</h4><div id="prSpin" class="pr-spin-stage" style="background-image:url('+fileUrl(photos[0])+')"></div></div>'; }
  if(photos.length){ html+='<div class="pr-gallery"><h4>Photos</h4><div class="pr-thumbs">'+photos.map(function(m){return '<div class="pr-thumb"><img src="'+fileUrl(m)+'" alt=""><button class="table-action danger" data-del-media="'+m.id+'">x</button></div>';}).join('')+'</div></div>'; }
  if(!media.length){ html='<div class="workspace-empty">No photos or model yet. Add photos above; two or more enable the 360 spin.</div>'; }
  host.innerHTML=html;
  // 360 drag
  const spin=$('#prSpin');
  if(spin&&photos.length>=2){ let idx=0,down=false,sx=0; const frames=photos.map(fileUrl);
    const set=function(i){idx=(i%frames.length+frames.length)%frames.length;spin.style.backgroundImage='url('+frames[idx]+')';};
    spin.addEventListener('mousedown',function(e){down=true;sx=e.clientX;});
    window.addEventListener('mouseup',function(){down=false;});
    spin.addEventListener('mousemove',function(e){if(!down)return;var dx=e.clientX-sx;if(Math.abs(dx)>18){set(idx+(dx>0?1:-1));sx=e.clientX;}});
    spin.addEventListener('touchstart',function(e){down=true;sx=e.touches[0].clientX;},{passive:true});
    spin.addEventListener('touchmove',function(e){if(!down)return;var dx=e.touches[0].clientX-sx;if(Math.abs(dx)>18){set(idx+(dx>0?1:-1));sx=e.touches[0].clientX;}},{passive:true});
  }
  host.querySelectorAll('[data-del-media]').forEach(function(b){b.onclick=async function(){ try{ await api('/masters/items/media/'+b.getAttribute('data-del-media')+'/delete',{method:'POST',body:'{}'}); renderProductRegistration(full.item.id);}catch(e){toast(e.message,'error');} };});
}

async function renderStockAnalysis(search=''){
  content.innerHTML='<div class="workspace-loading">Loading stock analysis...</div>';
  try{
    const [analysis,byClass]=await Promise.all([api('/inventory/analysis'),api('/inventory/by-class')]);
    const q=search.toLowerCase();
    const withStock=analysis.rows.filter(row=>(Number(row.on_hand_qty||0)+Number(row.available_qty||0)+Number(row.leased_qty||0)+Number(row.sold_qty||0))>0);
    const filtered=withStock.filter(row=>!q||`${row.item_code} ${row.item_name} ${row.category}`.toLowerCase().includes(q));
    const cls=(byClass.rows||[]);
    const isMC=c=>['D400','R280','RSPORT'].includes(c.cls);
    const mcLeased=cls.filter(isMC).reduce((s,c)=>s+Number(c.leased||0),0);
    const mcAvail=cls.filter(isMC).reduce((s,c)=>s+Number(c.available||0),0);
    const mcTotal=mcAvail+mcLeased;
    const mcUtil=mcTotal?Math.round(mcLeased/mcTotal*100):0;
    const batDeployed=cls.filter(c=>c.cls==='BAT').reduce((s,c)=>s+Number(c.deployed||0),0);
    const totVal=cls.reduce((s,c)=>s+Number(c.inventory_value||0),0);
    const summaryRows=cls.map(function(c){var av=Number(c.available||0),ls=Number(c.leased||0),tot=av+ls;var util=tot?Math.round(ls/tot*100):0;return '<tr><td><b>'+esc(c.class_name||c.cls)+'</b></td><td class="num">'+av.toLocaleString()+'</td><td class="num">'+ls.toLocaleString()+'</td><td class="num"><b>'+tot.toLocaleString()+'</b></td><td class="num">'+util+'%</td><td class="num">'+money(c.inventory_value)+'</td></tr>';});
    const rows=filtered.map(row=>{var av=Number(row.available_qty||0),ls=Number(row.leased_qty||0);return `<tr class="clickable-row" data-analysis-item="${esc(row.item_code)}" data-analysis-class="${esc(row.category)}"><td><b>${esc(row.item_code)}</b></td><td>${esc(row.item_name)}</td><td>${esc(row.category)}</td>
      <td>${esc(row.primary_location||'-')}</td><td class="num">${av.toLocaleString()}</td><td class="num">${ls.toLocaleString()}</td><td class="num">${Number(row.sold_qty||0).toLocaleString()}</td><td class="num"><b>${(av+ls).toLocaleString()}</b></td>
      <td class="num">${money(row.inventory_value)}</td></tr>`;});
    const body=`<div class="workspace-commandbar"><input id="analysisSearch" value="${esc(search)}" placeholder="Search material code, item, or class">
      <button class="command primary" id="runAnalysisSearch">Apply</button><span class="command-spacer"></span><span class="workspace-mode">${filtered.length} ITEMS</span></div>
      <div class="workspace-kpis">${kpi('Fleet Utilization',mcUtil+'%')}${kpi('Motorcycles Idle',mcAvail.toLocaleString())}${kpi('Battery Swap Pool',batDeployed.toLocaleString())}${kpi('Inventory Value',money(totVal))}</div>
      <section class="workspace-card"><header><div><h2>Utilization by Class</h2></div></header>
        ${operationalTable(['Inventory Class','Available (Idle)','Leased','Total Units','Utilization','Inventory Value'],summaryRows,{key:'analysis-by-class'})}</section>
      <section class="workspace-card"><header><div><h2>Inventory by Item</h2></header></header>
        ${operationalTable(['Material Code','Item','Class','Location','Available','Leased','Sold','Total Units','Inventory Value'],rows,{key:'inventory-analysis',emptyMessage:'No items with stock match your search.'})}</section>`;
    content.innerHTML=workbenchShell(body,'records');bindOperationalShell();
    $('#runAnalysisSearch').onclick=()=>renderStockAnalysis($('#analysisSearch').value);
    $('#analysisSearch').onkeydown=event=>{if(event.key==='Enter')$('#runAnalysisSearch').click();};
    $$('[data-analysis-item]').forEach(row=>row.onclick=()=>renderWarehouseVisibility('',row.dataset.analysisItem,'',row.dataset.analysisClass));
  }catch(error){showWorkspaceError(error);}
}

async function renderInventoryPlans(){
  content.innerHTML='<div class="workspace-loading">Loading inventory plans…</div>';
  try{
    const [plans,analysis,lookups]=await Promise.all([api('/inventory/plans'),api('/inventory/analysis'),api('/masters/lookups')]);
    const rows=plans.rows.map(row=>`<tr><td><b>${esc(row.plan_no)}</b></td><td>${date(row.plan_date)}</td><td>${esc(row.plan_type)}</td>
      <td>${esc(row.source_location_code||'-')}</td><td>${esc(row.destination_location_code||'-')}</td><td>${esc(row.line_count)}</td>
      <td>${esc(row.planned_units)}</td><td>${statusBadge(row.status)}</td><td>${row.status==='DRAFT'&&can('INVENTORY','APPROVE')?`<button class="table-action" data-approve-plan="${row.id}">Approve</button>`:''}</td></tr>`);
    const body=`<div class="ramco-layout"><div class="ramco-main">
      <section class="workspace-card"><header><h2>Create Inventory Plan</h2></header>
        <form id="inventoryPlanForm" class="operational-form grid">
          <label><span>Plan Type</span><select name="planType" id="planType"><option>ORDERING</option><option>DEPLOYMENT</option><option>REPLENISHMENT</option></select></label>
          <label><span>Plan Date</span><input name="planDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label>
          <label><span>Horizon End</span><input name="horizonEnd" type="date"></label>
          <label><span>Source Location</span><select name="sourceLocationId"><option value="">Not applicable</option>${lookups.locations.map(row=>`<option value="${row.id}">${esc(row.code)} · ${esc(row.name)}</option>`).join('')}</select></label>
          <label><span>Destination Location</span><select name="destinationLocationId"><option value="">Not applicable</option>${lookups.locations.map(row=>`<option value="${row.id}">${esc(row.code)} · ${esc(row.name)}</option>`).join('')}</select></label>
          <label class="wide"><span>Purpose</span><input name="purpose" required placeholder="Why this order or deployment is needed"></label>
          <div class="wide line-editor-head"><b>Plan Lines</b><button type="button" id="addPlanLine">Add Line</button></div>
          <div id="planLines" class="wide line-editor"></div>
          <button class="command primary">Save Plan</button>
        </form>
      </section>
      <section class="workspace-card"><header><h2>Inventory Plan Register</h2><span>${plans.total} plans</span></header>
        ${operationalTable(['Plan','Date','Type','Source','Destination','Lines','Units','Status','Action'],rows)}</section>
      </div></div>`;
    content.innerHTML=workbenchShell(body,'approvals');bindOperationalShell();
    const addLine=()=>{
      const row=document.createElement('div');row.className='line-editor-row plan-line';
      row.innerHTML=`<select data-plan="itemId"><option value="">Item…</option>${analysis.rows.map(item=>`<option value="${item.item_id}" data-available="${item.available_qty}" data-incoming="${item.incoming_qty}">${esc(item.item_code)} · ${esc(item.item_name)}</option>`).join('')}</select>
        <input data-plan="availableQty" readonly placeholder="Available"><input data-plan="incomingQty" readonly placeholder="Incoming">
        <input data-plan="plannedQty" type="number" min="0.01" step="0.01" value="1" placeholder="Planned">
        <select data-plan="priority"><option>NORMAL</option><option>HIGH</option><option>CRITICAL</option><option>LOW</option></select>
        <input data-plan="reason" placeholder="Reason"><button type="button" class="remove-line">×</button>`;
      row.querySelector('[data-plan="itemId"]').onchange=event=>{
        const option=event.target.selectedOptions[0];
        row.querySelector('[data-plan="availableQty"]').value=option?.dataset.available||0;
        row.querySelector('[data-plan="incomingQty"]').value=option?.dataset.incoming||0;
      };
      row.querySelector('.remove-line').onclick=()=>row.remove();$('#planLines').append(row);
    };
    addLine();$('#addPlanLine').onclick=addLine;
    $('#inventoryPlanForm').onsubmit=async event=>{
      event.preventDefault();const payload=formDataObject(event.currentTarget);
      payload.lines=$$('.plan-line').map(row=>({
        itemId:Number(row.querySelector('[data-plan="itemId"]').value),
        availableQty:Number(row.querySelector('[data-plan="availableQty"]').value),
        incomingQty:Number(row.querySelector('[data-plan="incomingQty"]').value),
        plannedQty:Number(row.querySelector('[data-plan="plannedQty"]').value),
        priority:row.querySelector('[data-plan="priority"]').value,
        reason:row.querySelector('[data-plan="reason"]').value,
      }));
      try{const result=await api('/inventory/plans',{method:'POST',body:JSON.stringify(payload)});toast(`${result.planNo} created`);await renderInventoryPlans();}
      catch(error){toast(error.message,'error');}
    };
    $$('[data-approve-plan]').forEach(button=>button.onclick=async()=>{
      try{await api(`/inventory/plans/${button.dataset.approvePlan}/approve`,{method:'POST',body:'{}'});toast('Inventory plan approved');await renderInventoryPlans();}
      catch(error){toast(error.message,'error');}
    });
  }catch(error){showWorkspaceError(error);}
}

async function renderInventoryPlanningReports(){
  content.innerHTML='<div class="workspace-loading">Loading planning reports...</div>';
  try{
    const [analysis,byClass]=await Promise.all([api('/inventory/analysis'),api('/inventory/by-class')]);
    const cls=(byClass.rows||[]);
    const isSpare=r=>String(r.category||'').toUpperCase()==='SP';
    const spareReorder=analysis.rows.filter(r=>isSpare(r)&&Number(r.available_qty||0)===0);
    const deployable=analysis.rows.filter(r=>!isSpare(r)&&Number(r.available_qty||0)>0);
    const mcAvail=cls.filter(c=>['D400','R280','RSPORT'].includes(c.cls)).reduce((s,c)=>s+Number(c.available||0),0);
    const batAvail=cls.filter(c=>c.cls==='BAT').reduce((s,c)=>s+Number(c.available||0),0);
    const spUnits=cls.filter(c=>c.cls==='SP').reduce((s,c)=>s+Number(c.available||0),0);
    const clip=v=>{v=String(v||'');return v.length>60?v.slice(0,60)+'...':v;};
    const spareRows=spareReorder.map(r=>`<tr><td><b>${esc(r.item_code)}</b></td><td>${esc(clip(r.item_name))}</td><td class="num">${esc(r.available_qty)}</td><td class="num">${esc(r.incoming_qty)}</td><td class="num">${esc(r.open_po_qty)}</td></tr>`);
    const deployRows=deployable.map(r=>`<tr><td><b>${esc(r.item_code)}</b></td><td>${esc(clip(r.item_name))}</td><td>${esc(r.category)}</td><td>${esc(r.primary_location||'-')}</td><td class="num">${Number(r.available_qty||0).toLocaleString()}</td></tr>`);
    const body=`<section class="workspace-card"><header><div><h2>How planning works here</h2></div></header></section>
      <div class="workspace-kpis">${kpi('Spare Parts to Reorder',spareReorder.length)}${kpi('Motorcycles Idle',mcAvail.toLocaleString())}${kpi('Batteries Available',batAvail.toLocaleString())}${kpi('Spare-Part Units on Hand',spUnits.toLocaleString())}</div>
      <section class="workspace-card"><header><h2>Spare Parts to Reorder</h2></header>
        ${operationalTable(['Material Code','Item','Available','Incoming','Open PO'],spareRows,{emptyMessage:'No spare-part lines are out of stock.'})}</section>
      <section class="workspace-card"><header><h2>Available to Deploy</h2></header>
        ${operationalTable(['Material Code','Item','Class','Location','Available Units'],deployRows,{emptyMessage:'No serialized units are currently available.'})}</section>`;
    content.innerHTML=workbenchShell(body,'reports');bindOperationalShell();
  }catch(error){showWorkspaceError(error);}
}


function renderInventoryPlanningSetup(){
  const body=`<div class="setup-grid"><section class="workspace-card"><header><h2>Planning Sources</h2></header><div class="definition-list">
    <div><b>On hand</b><span>Confirmed Goods Receipt inventory by serial and location.</span></div>
    <div><b>Incoming</b><span>Open ATLAS expected serials tied to approved purchase orders.</span></div>
    <div><b>Open PO</b><span>Approved purchase-order quantities not yet received.</span></div>
    <div><b>Deployed</b><span>Units assigned to a customer, site, employee, or station.</span></div></div></section>
    <section class="workspace-card"><header><h2>Plan Types</h2></header><div class="definition-list">
      <div><b>Ordering</b><span>Procure additional items through sourcing and purchasing.</span></div>
      <div><b>Deployment</b><span>Assign available stock to a business, project, dealer, or retail need.</span></div>
      <div><b>Replenishment</b><span>Move stock between warehouses and retail locations.</span></div></div></section></div>`;
  content.innerHTML=workbenchShell(body,'setup');bindOperationalShell();
}

async function renderConnectedModuleWorkspace(section){
  if(section==='center')return renderRoleCenter();
  if(section==='records')return renderRecords();
  if(section==='approvals'){
    const approvalStatus=state.definition?.workflow?.actions?.find(action=>action.permission==='APPROVE')?.from?.[0]||'';
    return renderRecords(approvalStatus);
  }
  if(section==='reports')return renderModuleReports();
  return renderModuleSetup();
}

function downloadModuleCsv(rows,definition){
  const fields=(definition.fields||[]).filter(field=>field.list);
  const headers=['Reference','Date','Type',...fields.map(field=>field.label),'Entity','Department','Description',definition.amountLabel,'Status','Owner'];
  const values=rows.map(row=>[
    row.record_no,row.transaction_date,row.record_type,...fields.map(field=>row.payload?.[field.key]??''),
    row.entity_name,row.department,row.description,row.amount,row.status,row.owner_email,
  ]);
  const csv=[headers,...values].map(row=>row.map(value=>`"${String(value??'').replaceAll('"','""')}"`).join(',')).join('\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`${state.module.code}-${new Date().toISOString().slice(0,10)}.csv`;link.click();
  URL.revokeObjectURL(url);
}

async function renderModuleReports(){
  content.innerHTML='<div class="workspace-loading">Building live module reports…</div>';
  try{
    const [summary,records]=await Promise.all([
      api(`/workspace/modules/${state.module.code}/summary`),
      api(`/workspace/modules/${state.module.code}/records`),
    ]);
    const definition=summary.definition;
    const statusRows=summary.statusCounts.map(row=>`<tr><td>${esc(definition.statusLabels[row.status]||row.status)}</td><td class="num">${esc(row.count)}</td>
      <td>${horizontalBars([[row.status,row.count,row.status==='APPROVED'||row.status==='ACTIVE'||row.status==='CLOSED'?'green':row.status==='DRAFT'?'orange':'blue']])}</td></tr>`);
    const typeRows=summary.typeCounts.map(row=>`<tr><td>${esc(row.record_type)}</td><td class="num">${esc(row.count)}</td></tr>`);
    const reportCards=definition.reports.map((report,index)=>`<article class="module-report-card">
      <span>LIVE REPORT ${String(index+1).padStart(2,'0')}</span><h3>${esc(report)}</h3>
      <p>Generated from the ${esc(definition.plural.toLowerCase())} register and current workflow state.</p>
      <strong>${index===0?summary.counts.total:index===1?summary.counts.pending:summary.counts.completed}</strong>
      <small>${index===0?'TOTAL RECORDS':index===1?'AWAITING ACTION':'COMPLETED / POSTED'}</small>
    </article>`).join('');
    const body=`<div class="workspace-commandbar"><button class="command primary" id="exportModuleReport">Export Current Register</button>
      <button class="command" id="refreshModuleReports">Refresh</button><span class="command-spacer"></span>
      <span class="workspace-mode">${esc(definition.plural.toUpperCase())} · LIVE</span></div>
      <div class="module-report-grid">${reportCards}</div>
      <div class="setup-grid">
        <section class="workspace-card"><header><h2>Workflow Status Analysis</h2><span>${summary.counts.total} records</span></header>
          ${operationalTable(['Status','Records','Distribution'],statusRows)}</section>
        <section class="workspace-card"><header><h2>Transaction Mix</h2><span>${summary.typeCounts.length} record types</span></header>
          ${operationalTable(['Record Type','Records'],typeRows)}</section>
      </div>
      <section class="workspace-card"><header><div><h2>${esc(definition.reports[0]||definition.plural+' Register')}</h2>
        <span>Drill-down register with document references and current owners</span></div></header>${recordsTable(records.rows)}</section>`;
    content.innerHTML=workbenchShell(body,'reports');bindOperationalShell();
    $('#exportModuleReport').onclick=()=>downloadModuleCsv(records.rows,definition);
    $('#refreshModuleReports').onclick=renderModuleReports;
    $$('[data-record-id]').forEach(row=>row.onclick=()=>openRecord(row.dataset.recordId));
  }catch(error){showWorkspaceError(error);}
}

async function renderModuleSetup(){
  const definition=state.definition;
  const actionRows=definition.workflow.actions.map(action=>`<tr><td><b>${esc(action.label)}</b></td><td>${action.from.map(status=>statusBadge(status)).join(' ')}</td>
    <td>${statusBadge(action.to)}</td><td>${esc(action.permission)}</td></tr>`);
  const fieldRows=definition.fields.map(field=>`<tr><td><b>${esc(field.label)}</b></td><td>${esc(field.type)}</td>
    <td>${field.required?'Required':'Optional'}</td><td>${field.list?'Register + form':'Form'}</td></tr>`);
  const submoduleRows=(definition.submodules||[]).map(sub=>`<tr><td><b>${esc(sub.submodule_name)}</b></td><td>${esc(sub.record_type||'-')}</td>
    <td>${esc(sub.connected_module_code||'Within module')}</td><td>${esc(sub.posting_event_type||'No direct posting')}</td></tr>`);
  const connections=definition.connections.map(code=>{
    const module=moduleByCode(code);
    return `<button class="connected-module-link" data-connected-module="${esc(code)}" ${module&&canWorkspace(code)?'':'disabled'}>
      <b>${esc(module?.label||code)}</b><span>${esc(module?.groupTitle||'Connected module')}</span></button>`;
  }).join('');
  const body=`<div class="setup-grid">
    <section class="workspace-card"><header><h2>${esc(definition.noun)} Record Types</h2><span>${definition.recordTypes.length} configured</span></header>
      <div class="module-type-grid">${definition.recordTypes.map(type=>`<div><b>${esc(type)}</b><span>Auto-number: ${esc(definition.prefix)}-########</span></div>`).join('')}</div></section>
    <section class="workspace-card"><header><h2>Connected Modules</h2></header>
      <div class="connected-module-grid">${connections||operationalEmpty('No downstream module is configured.')}</div></section>
    <section class="workspace-card wide-card"><header><h2>Approval-Controlled Workflow</h2></header>
      ${operationalTable(['Action','Allowed From','Result','Required Authority'],actionRows)}
      </section>
    ${submoduleRows.length?`<section class="workspace-card wide-card"><header><h2>Functional Submodules</h2><span>${submoduleRows.length} connected process areas</span></header>
      ${operationalTable(['Submodule','Primary Record','Connected Module','Finance Event'],submoduleRows)}</section>`:''}
    <section class="workspace-card wide-card"><header><h2>Amount-Based Approval Matrix</h2></header>
      <div id="approvalMatrixHost"><div class="workspace-loading">Loading approval authority…</div></div></section>
    <section class="workspace-card wide-card"><header><h2>Module Data Dictionary</h2><span>${definition.fields.length} operational fields</span></header>
      ${operationalTable(['Field','Data Type','Validation','Used In'],fieldRows)}</section>
  </div>`;
  content.innerHTML=workbenchShell(body,'setup');bindOperationalShell();
  $$('[data-connected-module]').forEach(button=>button.onclick=()=>openWorkspace(button.dataset.connectedModule));
  const host=$('#approvalMatrixHost');
  if(state.session.user.role_code!=='ADMIN'){
    host.innerHTML='';
    return;
  }
  try{
    const data=await api('/enterprise/approval-matrices');
    const rows=data.rows.filter(row=>row.module_code==='*'||row.module_code===state.module.code);
    const matrixRows=rows.map(row=>`<tr><td><b>${esc(row.matrix_code)}</b></td><td>${esc(row.module_code)}</td><td>${esc(row.document_type)}</td><td>${esc(row.department)}</td>
      <td class="num">${money(row.amount_from)}</td><td class="num">${row.amount_to==null?'No limit':money(row.amount_to)}</td><td>${esc(row.step_no)}</td><td>${esc(row.approver_email||row.approver_role_code)}</td><td>${statusBadge(row.active?'ACTIVE':'INACTIVE')}</td></tr>`).join('');
    host.innerHTML=`${operationalTable(['Matrix','Module','Document Type','Department','From','To','Step','Approver','Status'],matrixRows)}
      <form id="approvalMatrixForm" class="operational-form grid"><label><span>Document Type</span><select name="documentType"><option value="*">All Types</option>${definition.recordTypes.map(type=>`<option>${esc(type)}</option>`).join('')}</select></label>
      <label><span>Department</span><input name="department" value="*"></label><label><span>Amount From</span><input name="amountFrom" type="number" step="0.01" value="0"></label>
      <label><span>Amount To</span><input name="amountTo" type="number" step="0.01" placeholder="No limit"></label><label><span>Step</span><input name="stepNo" type="number" min="1" value="1"></label>
      <label><span>Approver Role</span><select name="approverRoleCode"><option>SCM_MANAGER</option><option>FINANCE</option><option>ADMIN</option></select></label>
      <button class="command primary">Add Module Approval Rule</button></form>`;
    $('#approvalMatrixForm').onsubmit=async event=>{
      event.preventDefault();const form=formDataObject(event.currentTarget);
      form.moduleCode=state.module.code;form.matrixCode=`APR-${state.module.code.toUpperCase()}-${Date.now()}`;
      try{await api('/enterprise/approval-matrices',{method:'POST',body:JSON.stringify(form)});toast('Approval rule saved');await renderModuleSetup();}
      catch(error){toast(error.message,'error');}
    };
  }catch(error){host.innerHTML=`<div class="workspace-error"><b>Approval matrix unavailable</b><span>${esc(error.message)}</span></div>`;}
}

async function renderSalesOrderWorkspace(section){
  if(section==='setup')return renderModuleSetup();
  content.innerHTML='<div class="workspace-loading">Loading connected sales orders…</div>';
  try{
    const [orders,lookups]=await Promise.all([api('/sales?size=300'),api('/sales/lookups')]);
    const rows=orders.rows;
    const drafts=rows.filter(row=>row.status==='DRAFT');
    const approved=rows.filter(row=>row.status==='APPROVED');
    const value=rows.reduce((sum,row)=>sum+Number(row.gross_amount||0),0);
    const tableRows=(section==='approvals'?drafts:rows).map(row=>`<tr data-sales-order="${row.id}"><td><b>${esc(row.sales_order_no)}</b></td>
      <td>${date(row.order_date)}</td><td>${esc(row.transaction_type)}</td><td>${esc(row.customer_name)}</td><td>${esc(row.line_count)}</td>
      <td class="num">${money(row.gross_amount)}</td><td>${statusBadge(row.credit_status)}</td><td>${statusBadge(row.status)}</td>
      <td>${row.status==='DRAFT'&&can('SALES','APPROVE')?`<button class="table-action" data-approve-sales="${row.id}">Approve</button>`:'-'}</td></tr>`);
    if(section==='reports'){
      const types=['SALE','LEASE','DEMO','PILOT','EMPLOYEE_ASSIGNMENT'].map(type=>[type,rows.filter(row=>row.transaction_type===type).length]);
      const body=`<div class="workspace-kpis">${kpi('Orders',rows.length,{section:'records'})}${kpi('Draft',drafts.length,{match:'DRAFT'})}${kpi('Approved',approved.length,{match:'APPROVED'})}</div>
        <div class="setup-grid"><section class="workspace-card"><header><h2>Orders by Business Transaction</h2></header>${horizontalBars(types)}</section>
        <section class="workspace-card"><header><h2>Fulfilment Readiness</h2></header>${horizontalBars([['Draft',drafts.length,'orange'],['Approved',approved.length,'green'],['Posted',rows.filter(row=>row.status==='POSTED').length,'blue']])}</section></div>
        <section class="workspace-card"><header><h2>Sales Order Register</h2><span>${rows.length} orders</span></header>
          ${operationalTable(['Order','Date','Type','Customer / Holder','Lines','Gross','Credit','Status','Action'],tableRows)}</section>`;
      content.innerHTML=workbenchShell(body,'reports');bindOperationalShell();
      return bindSalesOrderRows();
    }
    const center=section==='center';
    const body=`${center?`<div class="workspace-kpis">${kpi('Open Drafts',drafts.length,{match:'DRAFT'})}
      ${kpi('Approved for Fulfilment',approved.length,{match:'APPROVED'})}${kpi('Motorcycles Available',(lookups.assets||[]).filter(a=>a.category==='MC'&&/^R5FBM/i.test(a.serial_no||'')).length)}${kpi('Batteries Available',(lookups.assets||[]).filter(a=>a.category==='BAT').length)}${kpi('Swap Stations Available',(lookups.assets||[]).filter(a=>a.category==='BSS').length)}</div>
      ${workflowStrip(['CRM / Customer','Sales Order','Approval','Requisition & Allocation','Pre-release','Goods Issue / Delivery'],2)}`:''}
      <div class="workspace-commandbar"><button class="command primary" id="newSalesOrder" ${can('SALES','CREATE')?'':'disabled'}>New Sales Order</button>
        <span class="command-spacer"></span><span class="workspace-mode">${section==='approvals'?'ORDER APPROVAL':'CONNECTED ORDER REGISTER'}</span></div>
      <div class="ramco-layout single"><div class="ramco-main"><section class="workspace-card"><header><div><h2>${section==='approvals'?'Orders Requiring Approval':'Sales, Lease & Assignment Orders'}</h2></div></header>
        ${operationalTable(['Order','Date','Type','Customer / Holder','Lines','Gross','Credit','Status','Action'],tableRows)}</section></div>
        </div>`;
    content.innerHTML=workbenchShell(body,section);bindOperationalShell();
    $('#newSalesOrder').onclick=()=>openSalesOrderForm(lookups);
    bindSalesOrderRows();
  }catch(error){showWorkspaceError(error);}
}

function bindSalesOrderRows(){
  $$('[data-approve-sales]').forEach(button=>button.onclick=async event=>{
    event.stopPropagation();
    try{const result=await api(`/sales/${button.dataset.approveSales}/approve`,{method:'POST',body:'{}'});
      toast(result.approved?`Approved; ${result.deliveryNo} created`:`Approval step recorded; ${result.approvalDecision?.state?.pending||0} step(s) remain`);await renderSalesOrderWorkspace(state.section);}
    catch(error){toast(error.message,'error');}
  });
  $$('[data-sales-order]').forEach(row=>row.onclick=async()=>{
    try{
      const data=await api(`/sales/${row.dataset.salesOrder}`);
      const lines=data.lines.map(line=>`<tr><td>${esc(line.line_no)}</td><td><b>${esc(line.item_code)}</b></td><td>${esc(line.description)}</td>
        <td>${esc(line.serial_no||'-')}</td><td>${esc(line.qty)}</td><td class="num">${money(line.unit_price)}</td>
        <td>${line.serial_no?statusBadge(line.current_status):'-'}</td></tr>`);
      modal(`${data.header.sales_order_no} · ${data.header.customer_name}`,`${workflowStrip(['Order','Approval','Assignment','Delivery'],data.header.status==='DRAFT'?0:2)}
        <div class="workspace-kpis">${kpi('Type',data.header.transaction_type)}${kpi('Gross',money(data.header.gross_amount))}
          ${kpi('Deliveries',data.deliveries.length)}${kpi('Status',data.header.status)}</div>
        ${operationalTable(['Line','Item','Description','Serial','Qty','Unit Price','Inventory Status'],lines)}
        ${data.header.status==='DRAFT'?`<div class="modal-actions"><button type="button" class="command primary" data-edit-so="${data.header.id}">Edit draft</button></div>`:''}`);
      const editBtn=document.querySelector('[data-edit-so]');
      if(editBtn)editBtn.onclick=()=>openSalesOrderEdit(data.header);
    }catch(error){toast(error.message,'error');}
  });
}

function openSalesOrderEdit(header){
  modal('Edit draft '+(header.sales_order_no||''),`<form id="soEditForm" class="operational-form grid">
    <label><span>Order Date</span><input name="orderDate" type="date" value="${esc((header.order_date||'').slice(0,10))}"></label>
    <label><span>Transaction Type</span><select name="transactionType">${['SALE','LEASE','DEMO','PILOT','EMPLOYEE_ASSIGNMENT'].map(t=>`<option ${t===header.transaction_type?'selected':''}>${t}</option>`).join('')}</select></label>
    <label><span>Contract Start</span><input name="contractStart" type="date" value="${esc((header.contract_start||'').slice(0,10))}"></label>
    <label><span>Contract End</span><input name="contractEnd" type="date" value="${esc((header.contract_end||'').slice(0,10))}"></label>
    <label><span>Rate per day</span><input name="ratePerDay" type="number" min="0" step="0.01" value="${esc(header.rate_per_day||'')}"></label>
    <label class="wide"><span>Delivery / Deployment Address</span><input name="deliveryAddress" value="${esc(header.delivery_address||'')}"></label>
    <div class="modal-actions wide"><button type="submit" class="command primary">Save draft</button><button type="button" class="command" id="soEditCancel">Cancel</button></div>
  </form>`,'Drafts stay editable until they are submitted');
  const mb=$('#modalBody');mb.querySelector('#soEditCancel').onclick=()=>closeModal();
  mb.querySelector('#soEditForm').onsubmit=async event=>{
    event.preventDefault();const body=formDataObject(event.currentTarget);
    body.ratePerDay=Number(body.ratePerDay||0);
    try{await api('/sales/'+header.id,{method:'PATCH',body:JSON.stringify(body)});closeModal();toast('Draft updated');await renderSalesOrderWorkspace(state.section);}
    catch(error){toast(error.message,'error');}
  };
}
function openSalesOrderForm(lookups){
  modal('New Connected Sales Order',`<form id="salesOrderForm" class="operational-form grid">
    <label><span>Transaction Type</span><select name="transactionType"><option>SALE</option><option>LEASE</option><option>DEMO</option><option>PILOT</option><option>EMPLOYEE_ASSIGNMENT</option></select></label>
    <label><span>Order Date</span><input name="orderDate" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
    <label class="wide"><span>Customer / Holder</span><div class="pick-with-add">
      <select name="customerId" required><option value="">Select customer</option>
      ${[...lookups.customers,...lookups.employees].map(row=>`<option value="${row.id}">${esc(row.partner_code)} · ${esc(row.name)}${row.credit_status?` · ${esc(row.credit_status)}`:''}</option>`).join('')}</select>
      <button type="button" class="table-action" id="soAddCustomer">+ New customer</button></div></label>
    <label><span>Contract Start</span><input name="contractStart" type="date"></label><label><span>Contract End / Expected Return</span><input name="contractEnd" type="date"></label>
    <label><span>Rate per day</span><input name="ratePerDay" type="number" min="0" step="0.01" placeholder="0.00"></label>
    <label><span>Rate currency</span><select name="rateCurrency"><option>PHP</option><option>USD</option></select></label>
    <label class="wide"><span>Delivery / Deployment Address</span><input name="deliveryAddress" required></label>
    <div class="wide so-lines-head"><span>Order lines</span>
      <button type="button" class="table-action" id="soAddLine">+ Add line</button></div>
    <div id="salesLines" class="wide"></div>
    <div class="wide so-total"><span>Order total</span><b id="soTotal">0.00</b></div>
    <label class="wide"><span>Signed contract / attachments</span><input id="soContract" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.docx,.doc"></label>
    <div id="soContractList" class="po-doc-list wide"></div>
    <button class="command primary">Create Sales Order</button>
  </form>`);

  /*
   * Order lines. Sales prices the deal; it does not pick serials - the spec is
   * explicit that serial allocation belongs to supply chain on the outbound
   * requisition - so a line is item, quantity and price, and nothing else.
   */
  const soItems=(lookups.items||[]);
  const soTotal=()=>{
    let t=0;
    $$('#salesLines .sales-line').forEach(row=>{
      t+=(Number(row.querySelector('[data-sales="qty"]').value)||0)
        *(Number(row.querySelector('[data-sales="unitPrice"]').value)||0);
    });
    const el=$('#soTotal'); if(el)el.textContent=t.toFixed(2);
  };
  const soAddLine=()=>{
    const row=document.createElement('div');
    row.className='sales-line';
    row.innerHTML=`<select data-sales="itemCode"><option value="">Select item</option>`
      +soItems.map(i=>`<option value="${esc(i.item_code)}" data-name="${esc(i.item_name||'')}" data-price="${Number(i.standard_cost)||0}">${esc(i.item_code)} · ${esc(i.item_name||'')}</option>`).join('')
      +`</select>`
      +`<input data-sales="description" placeholder="Description">`
      +`<input data-sales="qty" type="number" min="1" step="1" value="1" placeholder="Qty">`
      +`<input data-sales="unitPrice" type="number" min="0" step="0.01" value="0" placeholder="Unit price">`
      +`<button type="button" class="table-action danger remove-line">&times;</button>`;
    const pick=row.querySelector('[data-sales="itemCode"]');
    pick.onchange=()=>{
      const opt=pick.selectedOptions[0];
      if(!opt||!opt.value)return;
      const desc=row.querySelector('[data-sales="description"]');
      if(!desc.value.trim())desc.value=opt.dataset.name||'';
      const price=row.querySelector('[data-sales="unitPrice"]');
      if(!Number(price.value)&&Number(opt.dataset.price))price.value=Number(opt.dataset.price);
      soTotal();
    };
    row.querySelectorAll('[data-sales="qty"],[data-sales="unitPrice"]').forEach(i=>i.oninput=soTotal);
    row.querySelector('.remove-line').onclick=()=>{row.remove();soTotal();};
    $('#salesLines').append(row);
  };
  if($('#soAddLine'))$('#soAddLine').onclick=soAddLine;
  soAddLine();   // an order always has at least one line to fill in
  const soFiles=[];
  const soRender=()=>{const host=$('#soContractList');if(!host)return;
    host.innerHTML=soFiles.length?soFiles.map((f,i)=>`<span class="po-doc-chip">${esc(f.name)} <button type="button" data-so-drop="${i}">&times;</button></span>`).join(''):'<span class="po-doc-empty">No contract attached</span>';
    host.querySelectorAll('[data-so-drop]').forEach(b=>b.onclick=()=>{soFiles.splice(Number(b.dataset.soDrop),1);soRender();});};
  soRender();
  if($('#soContract'))$('#soContract').onchange=event=>{[...event.target.files].forEach(f=>{if(f.size<=5*1024*1024&&soFiles.length<5)soFiles.push(f);});event.target.value='';soRender();};
  const soReadFiles=()=>Promise.all(soFiles.map(file=>new Promise(resolve=>{
    const reader=new FileReader();
    reader.onload=()=>resolve({fileName:file.name,contentType:file.type||'',size:file.size,data:String(reader.result||'').split(',')[1]||''});
    reader.onerror=()=>resolve({fileName:file.name,contentType:file.type||'',size:file.size,data:''});
    reader.readAsDataURL(file);})));
  if($('#soAddCustomer'))$('#soAddCustomer').onclick=()=>{
    const sel=$('#salesOrderForm select[name="customerId"]');
    modal('New customer',`<form id="soNewCust" class="operational-form grid">
      <label class="wide"><span>Customer name</span><input name="name" required></label>
      <label><span>Contact person</span><input name="contactPerson"></label>
      <label><span>Contact number</span><input name="contactNumber"></label>
      <label class="wide"><span>Email</span><input name="email" type="email"></label>
      <label class="wide"><span>Address</span><input name="address"></label>
      <label><span>TIN</span><input name="tin"></label>
      <label><span>Payment terms</span><input name="paymentTerms" placeholder="e.g. 30 days"></label>
      <div class="modal-actions wide"><button type="submit" class="command primary">Add customer</button><button type="button" class="command" id="soNewCancel">Cancel</button></div>
    </form>`);
    const mb=$('#modalBody');mb.querySelector('#soNewCancel').onclick=()=>closeModal();
    mb.querySelector('#soNewCust').onsubmit=async ev=>{
      ev.preventDefault();const data=formDataObject(ev.currentTarget);
      try{
        const created=await api('/sales/customers',{method:'POST',body:JSON.stringify(data)});
        const row=created.customer||created;
        if(sel){const opt=document.createElement('option');opt.value=row.id;opt.textContent=(row.partner_code?row.partner_code+' · ':'')+(row.name||data.name);sel.append(opt);sel.value=String(row.id);}
        closeModal();toast('Customer added');
      }catch(err){toast(err.message,'error');}
    };
  };
  const addLine=()=>{
    const row=document.createElement('div');row.className='line-editor-row sales-line';
    row.innerHTML=`<select data-sales="itemId"><option value="">Item…</option>${lookups.items.map(item=>`<option value="${item.id}" data-code="${esc(item.item_code)}">${esc(item.item_code)} · ${esc(item.item_name)}</option>`).join('')}</select>
      <select data-sales="serialNo"><option value="">No serial / quantity item</option>${lookups.assets.map(asset=>`<option value="${esc(asset.serial_no)}" data-item="${asset.item_id}">${esc(asset.serial_no)} · ${esc(asset.item_name)} · ${esc(asset.current_location_code||'No location')}</option>`).join('')}</select>
      <input data-sales="qty" type="number" min="1" step="1" value="1" placeholder="Qty"><input data-sales="unitPrice" type="number" min="0" step="0.01" placeholder="Unit price">
      <input data-sales="description" placeholder="Line description"><button type="button" class="remove-line">×</button>`;
    row.querySelector('[data-sales="serialNo"]').onchange=event=>{
      const itemId=event.target.selectedOptions[0]?.dataset.item;if(itemId)row.querySelector('[data-sales="itemId"]').value=itemId;
      if(event.target.value)row.querySelector('[data-sales="qty"]').value=1;
    };
    row.querySelector('.remove-line').onclick=()=>row.remove();$('#salesLines').append(row);
  };
  $('#salesOrderForm').onsubmit=async event=>{
    event.preventDefault();const body=formDataObject(event.currentTarget);
    body.customerId=Number(body.customerId);
    body.ratePerDay=Number(body.ratePerDay||0);
    body.attachments=await soReadFiles();
    body.lines=$$('#salesLines .sales-line').map(row=>({
      itemCode:row.querySelector('[data-sales="itemCode"]').value,
      itemName:row.querySelector('[data-sales="itemCode"]').selectedOptions[0]?.dataset.name||'',
      description:row.querySelector('[data-sales="description"]').value.trim(),
      qty:Number(row.querySelector('[data-sales="qty"]').value)||0,
      unitPrice:Number(row.querySelector('[data-sales="unitPrice"]').value)||0,
    })).filter(l=>(l.itemCode||l.description)&&l.qty>0);
    if(!body.lines.length)return toast('Add at least one order line.','error');
    try{const result=await api('/sales',{method:'POST',body:JSON.stringify(body)});closeModal();toast(`${result.salesOrderNo} created`);await renderSalesOrderWorkspace('records');}
    catch(error){toast(error.message,'error');}
  };
}

async function renderSourcingWorkspace(section){
  if(section==='records')return renderRecords();
  if(section==='setup')return renderModuleSetup();
  content.innerHTML='<div class="workspace-loading">Loading sourcing and purchasing…</div>';
  try{
    const [po,lookups,source,landed]=await Promise.all([
      api('/procurement/purchase-orders?size=300'),api('/masters/lookups'),
      api('/workspace/modules/ip-sourcing-purchasing/summary'),api('/procurement/landed-cost'),
    ]);
    const drafts=po.rows.filter(row=>row.status==='DRAFT');
    const approved=po.rows.filter(row=>row.status==='APPROVED');
    const commitments=approved.reduce((sum,row)=>sum+Number(row.total_amount||0),0);
    const poRows=po.rows.map(row=>`<tr data-purchase-order="${row.id}"><td><b>${esc(row.purchase_order_no)}</b></td><td>${date(row.order_date)}</td>
      <td>${esc(row.vendor_name)}</td><td>${date(row.expected_delivery_date)}</td><td>${esc(row.line_count)}</td>
      <td class="num">${money(row.total_amount)}</td><td>${statusBadge(row.status)}</td><td>${row.status==='DRAFT'&&can('PROCUREMENT','APPROVE')?
        `<button class="table-action" data-approve-po="${row.id}">Approve</button>`:'-'}</td></tr>`);
    if(section==='reports'){
      const landedRows=landed.rows.map(row=>`<tr><td><b>${esc(row.landed_cost_no)}</b></td><td>${esc(row.shipment_no||row.purchase_order_no||'-')}</td>
        <td>${esc(row.allocation_method)}</td><td class="num">${money(row.total_cost)}</td><td>${statusBadge(row.status)}</td>
        <td>${row.status!=='POSTED'&&can('PROCUREMENT','POST')?`<button class="table-action" data-post-landed="${row.id}">Post</button>`:'-'}</td></tr>`);
      const body=`<div class="workspace-kpis">${kpi('Approved Commitments',money(commitments))}${kpi('Purchase Orders',po.total)}
        ${kpi('Open Sourcing',source.counts.total-source.counts.completed)}${kpi('Landed Cost Batches',landed.rows.length)}</div>
        <section class="workspace-card"><header><h2>Purchase Commitment Report</h2></header>
          ${operationalTable(['PO','Date','Supplier','Expected','Lines','Total','Status','Action'],poRows)}</section>
        <section class="workspace-card"><header><h2>Landed Cost Register</h2></header>
          ${operationalTable(['Landed Cost','Shipment / PO','Allocation','Total','Status','Action'],landedRows)}</section>`;
      content.innerHTML=workbenchShell(body,'reports');bindOperationalShell();bindProcurementRows();return;
    }
    const body=`<div class="workspace-kpis">${kpi('Sourcing Cases',source.counts.total)}${kpi('Draft POs',drafts.length)}
      ${kpi('Approved POs',approved.length)}${kpi('Purchase Commitments',money(commitments))}</div>
      ${workflowStrip(['Purchase Request','RFQ & Comparison','Purchase Order','Expected Shipment / ATLAS','Goods Receipt','AP & Payment'],section==='approvals'?2:1)}
      <div class="workspace-commandbar"><button class="command primary" id="newPurchaseOrder" ${can('PROCUREMENT','CREATE')?'':'disabled'}>New Purchase Order</button>
        <button class="command" id="openSourcingCases">Sourcing & RFQ Register</button><span class="command-spacer"></span><span class="workspace-mode">${section==='approvals'?'PURCHASE ORDER APPROVAL':'PROCUREMENT CENTER'}</span></div>
      <section class="workspace-card"><header><div><h2>Purchase Orders</h2></div></header>
        ${operationalTable(['PO','Date','Supplier','Expected','Lines','Total','Status','Action'],poRows)}</section>`;
    content.innerHTML=workbenchShell(body,section);bindOperationalShell();
    $('#newPurchaseOrder').onclick=()=>openPurchaseOrderForm(lookups);
    $('#openSourcingCases').onclick=()=>openSection('records');
    bindProcurementRows();
  }catch(error){showWorkspaceError(error);}
}

function bindProcurementRows(){
  $$('[data-approve-po]').forEach(button=>button.onclick=async event=>{
    event.stopPropagation();
    try{const result=await api(`/procurement/purchase-orders/${button.dataset.approvePo}/approve`,{method:'POST',body:'{}'});toast(result.approved?'Purchase order approved':`Approval step recorded; ${result.approvalDecision?.state?.pending||0} step(s) remain`);await renderSourcingWorkspace(state.section);}
    catch(error){toast(error.message,'error');}
  });
  $$('[data-post-landed]').forEach(button=>button.onclick=async()=>{
    try{await api(`/procurement/landed-cost/${button.dataset.postLanded}/post`,{method:'POST',body:'{}'});toast('Landed cost posted to inventory and Finance');await renderSourcingWorkspace('reports');}
    catch(error){toast(error.message,'error');}
  });
  $$('[data-purchase-order]').forEach(row=>row.onclick=async()=>{
    try{
      const data=await api(`/procurement/purchase-orders/${row.dataset.purchaseOrder}`);
      const lines=data.lines.map(line=>`<tr><td>${esc(line.line_no)}</td><td><b>${esc(line.item_code)}</b></td><td>${esc(line.description)}</td>
        <td>${esc(line.ordered_qty)}</td><td class="num">${money(line.unit_cost)}</td><td class="num">${money(line.line_amount)}</td></tr>`);
      modal(`${data.header.purchase_order_no} · ${data.header.vendor_name}`,`${workflowStrip(['PO Draft','Approval','Expected Shipment','Goods Receipt','AP'],data.header.status==='DRAFT'?0:1)}
        ${operationalTable(['Line','Item','Description','Qty','Unit Cost','Amount'],lines)}
        `);
    }catch(error){toast(error.message,'error');}
  });
}

function openPurchaseOrderForm(lookups){
  modal('New Purchase Order',`<form id="purchaseOrderForm" class="operational-form grid">
    <label class="wide"><span>Supplier</span><input name="vendorName" list="vendorList" required><datalist id="vendorList">${lookups.vendors.map(row=>`<option value="${esc(row.name)}"></option>`).join('')}</datalist></label>
    <label><span>Order Date</span><input name="orderDate" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
    <label><span>Expected Delivery</span><input name="expectedDeliveryDate" type="date"></label>
    <label><span>Currency</span><select name="currency"><option>PHP</option><option>USD</option><option>TWD</option></select></label>
    <label><span>Incoterm</span><input name="incoterm" placeholder="FOB / CIF / DDP"></label>
    <label class="wide"><span>Payment Terms</span><input name="paymentTerms"></label>
    <div class="wide line-editor-head"><b>Purchase Order Lines</b><button type="button" id="addPurchaseLine">Add Line</button></div>
    <div id="purchaseLines" class="wide line-editor"></div><button class="command primary">Create Purchase Order</button>
  </form>`);
  const addLine=()=>{
    const row=document.createElement('div');row.className='line-editor-row purchase-line';
    row.innerHTML=`<select data-po="itemId"><option value="">Item…</option>${lookups.items.map(item=>`<option value="${item.id}">${esc(item.item_code)} · ${esc(item.item_name)}</option>`).join('')}</select>
      <input data-po="qty" type="number" min="0.01" step="0.01" value="1" placeholder="Qty">
      <input data-po="unitCost" type="number" min="0" step="0.01" placeholder="Unit cost"><input data-po="description" placeholder="Description">
      <button type="button" class="remove-line">×</button>`;
    row.querySelector('.remove-line').onclick=()=>row.remove();$('#purchaseLines').append(row);
  };
  addLine();$('#addPurchaseLine').onclick=addLine;
  $('#purchaseOrderForm').onsubmit=async event=>{
    event.preventDefault();const body=formDataObject(event.currentTarget);
    body.lines=$$('.purchase-line').map(row=>{
      const item=lookups.items.find(value=>value.id===Number(row.querySelector('[data-po="itemId"]').value));
      return {itemCode:item?.item_code,itemName:item?.item_name,category:item?.category,serialized:!!item?.serialized,
        qty:Number(row.querySelector('[data-po="qty"]').value||0),unitCost:Number(row.querySelector('[data-po="unitCost"]').value||0),
        description:row.querySelector('[data-po="description"]').value||item?.item_name};
    }).filter(line=>line.itemCode&&line.qty>0);
    try{const result=await api('/procurement/purchase-orders',{method:'POST',body:JSON.stringify(body)});closeModal();toast(`${result.purchaseOrderNo} created`);await renderSourcingWorkspace('approvals');}
    catch(error){toast(error.message,'error');}
  };
}

async function renderRoleCenter(){
  content.innerHTML='<div class="workspace-loading">Loading workspace…</div>';
  try{
    const data=await api(`/workspace/modules/${state.module.code}/summary`);
    state.definition=data.definition;
    const definition=data.definition;
    const countMap=Object.fromEntries(data.statusCounts.map(row=>[row.status,Number(row.count)]));
    const stages=definition.workflow.stages;
    const statusValues=stages.slice(0,5).map((status,index)=>[definition.statusLabels[status],countMap[status]||0,['blue','orange','green','blue','green'][index]]);
    const kpis=`${kpi(`Total ${definition.plural}`,data.counts.total)}${stages.slice(0,3).map(status=>kpi(definition.statusLabels[status],countMap[status]||0)).join('')}`;
    const first=data.recent?.[0];
    const body=`<div class="ramco-status-tabs"><button class="active">All <b>${data.counts.total}</b></button>
      ${stages.slice(0,5).map(status=>`<button>${esc(definition.statusLabels[status])} <b>${countMap[status]||0}</b></button>`).join('')}</div>
    <div class="workspace-kpis">${kpis}</div>
    <div class="ramco-layout">
      <div class="ramco-main">
        <section class="ramco-window">
          <header><div class="ramco-window-tabs"><button class="active">${esc(definition.plural)}</button><button>Recent</button><button>My Work</button></div><button id="newRecord" class="ramco-primary" ${can(state.module.permission,'CREATE')?'':'disabled'}>New ${esc(definition.noun)}</button></header>
          <div class="ramco-filterbar"><select>${definition.recordTypes.map(type=>`<option>${esc(type)}</option>`).join('')}</select><input placeholder="Search reference, ${esc(definition.entityLabel.toLowerCase())}, or owner"><select><option>All Statuses</option>${stages.map(status=>`<option>${esc(definition.statusLabels[status])}</option>`).join('')}</select><button data-go="records">Go</button></div>
          ${recordsTable(data.recent)}
        </section>
        <section class="ramco-detail-panel">
          <header><b>${first?esc(first.record_no):'Record Details'}</b><div><button>◉</button><button>▦</button><button>↗</button></div></header>
          <div class="ramco-detail-grid">
            <div><small>Record Type</small><b>${first?esc(first.record_type):'-'}</b><small>Document Date</small><b>${first?date(first.transaction_date):'-'}</b></div>
            <div><small>Document Summary</small><b>${first?esc(first.description||'-'):'-'}</b><small>${esc(definition.amountLabel)}</small><b>${first?money(first.amount):'0.00'}</b></div>
            <div class="ramco-detail-actions"><button data-go="records">Open ${esc(definition.plural)}</button><button id="detailNew" ${can(state.module.permission,'CREATE')?'':'disabled'}>Create ${esc(definition.noun)}</button><button data-go="approvals">Approval Worklist</button></div>
          </div>
        </section>
      </div>
      <aside class="ramco-rail">
        <section><header>${esc(definition.noun)} Processing</header>${miniBars(statusValues)}</section>
        <section><header>Record Status</header>${horizontalBars(statusValues)}</section>
        <section><header><span>Action Links</span><span>Reports</span></header><div class="ramco-action-links">
          ${definition.quickActions.map((label,index)=>`<button ${index===0?'id="railNew"':''} ${index===0&&!can(state.module.permission,'CREATE')?'disabled':''}>${esc(label)}</button>`).join('')}
          <button data-go="records">${esc(definition.plural)} Register</button><button data-go="approvals">Approval Worklist</button>
          ${definition.reports.map(report=>`<button data-go="reports">${esc(report)}</button>`).join('')}</div></section>
      </aside>
    </div>
    <nav class="ramco-bottom-links"><button data-go="records">${esc(definition.plural)} Register</button><button data-go="approvals">Approval Worklist</button>
      ${definition.reports.map(report=>`<button data-go="reports">${esc(report)}</button>`).join('')}<button data-go="setup">Configuration</button></nav>`;
    content.innerHTML=workbenchShell(body,'center');
    bindWorkbench();
    $('#newRecord').onclick=()=>renderRecordForm();
    $('#detailNew').onclick=()=>renderRecordForm();
    $('#railNew').onclick=()=>renderRecordForm();
    $$('[data-go]').forEach(button=>button.onclick=()=>openSection(button.dataset.go));
    $$('[data-record-id]').forEach(row=>row.onclick=()=>openRecord(row.dataset.recordId));
  }catch(error){showWorkspaceError(error);}
}
async function renderRecords(defaultStatus=''){
  const definition=state.definition;
  const body=`<div class="workspace-commandbar">
    <button class="command primary" id="newRecord" ${can(state.module.permission,'CREATE')?'':'disabled'}>New ${esc(definition.noun)}</button>
    <select id="recordType"><option value="">All types</option>${definition.recordTypes.map(type=>`<option ${state.submoduleType===type?'selected':''}>${esc(type)}</option>`).join('')}</select>
    <input id="recordSearch" placeholder="Search ${esc(definition.plural.toLowerCase())}">
    <select id="recordStatus"><option value="">All Statuses</option>${definition.workflow.stages.map(status=>`<option value="${status}" ${defaultStatus===status?'selected':''}>${esc(definition.statusLabels[status])}</option>`).join('')}</select>
    <button class="command" id="runSearch">Search</button>
  </div><div class="ramco-layout records-layout"><section class="workspace-card"><header><h2>${defaultStatus?'Approval Worklist':esc(state.submoduleLabel||definition.plural)+' Register'}</h2><span id="recordCount"></span></header><div id="recordsHost"><div class="workspace-loading">Loading records…</div></div></section><aside class="ramco-rail"><section><header>Record Types</header><div class="ramco-action-links">${definition.recordTypes.map(type=>`<button>${esc(type)}</button>`).join('')}</div></section><section><header>Actions</header><div class="ramco-action-links"><button id="railNew" ${can(state.module.permission,'CREATE')?'':'disabled'}>Create ${esc(definition.noun)}</button><button data-go="reports">Reports</button><button data-go="setup">Setup</button></div></section></aside></div>`;
  content.innerHTML=workbenchShell(body,defaultStatus?'approvals':'records');
  bindWorkbench();
  $('#newRecord').onclick=()=>renderRecordForm();
  $('#railNew').onclick=()=>renderRecordForm();
  const load=async()=>{
    try{
      const query=new URLSearchParams({q:$('#recordSearch').value,status:$('#recordStatus').value,type:$('#recordType').value});
      const [data,changes]=await Promise.all([
        api(`/workspace/modules/${state.module.code}/records?${query}`),
        defaultStatus?api(`/workspace/modules/${state.module.code}/change-requests`):Promise.resolve({rows:[]}),
      ]);
      $('#recordCount').textContent=`${data.rows.length} record${data.rows.length===1?'':'s'}`;
      const requested=changes.rows.filter(row=>row.status==='REQUESTED');
      const changeRows=requested.map(row=>`<tr><td><b>${esc(row.request_no)}</b></td><td>${esc(row.record_no)}</td>
        <td>${statusBadge(row.action_type)}</td><td>${esc(row.reason)}</td><td>${esc(row.requested_by)}</td><td>${date(row.requested_at)}</td>
        <td>${row.requested_by===state.session.user.email?'<small>Requester cannot approve</small>':
          `<button class="table-action" data-change-approve="${row.id}">Approve</button>
           <button class="table-action danger" data-change-reject="${row.id}">Reject</button>`}</td></tr>`);
      $('#recordsHost').innerHTML=`${defaultStatus?`<div class="approval-control-block"><h3>Deletion & Reversal Approval Requests</h3>
        ${operationalTable(['Request','Record','Action','Reason','Requested By','Requested','Decision'],changeRows)}</div>`:''}${recordsTable(data.rows)}`;
      $$('[data-record-id]').forEach(row=>row.onclick=()=>openRecord(row.dataset.recordId));
      $$('[data-change-approve]').forEach(button=>button.onclick=()=>decideRecordChange(button.dataset.changeApprove,'APPROVE',load));
      $$('[data-change-reject]').forEach(button=>button.onclick=()=>decideRecordChange(button.dataset.changeReject,'REJECT',load));
    }catch(error){showWorkspaceError(error,'#recordsHost');}
  };
  $('#runSearch').onclick=load;
  $('#recordSearch').onkeydown=event=>{if(event.key==='Enter')load();};
  await load();
}
async function openRecord(id){
  try{
    const data=await api(`/workspace/modules/${state.module.code}/records/${id}`);
    state.definition=data.definition;
    renderRecordForm(data.record,data.documents,data.connected);
  }catch(error){showWorkspaceError(error);}
}
function recordField(label,name,type='text',value='',extra=''){
  return `<label class="record-field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function moduleField(field,value){
  const required=field.required?'required':'';
  if(field.type==='textarea')return `<label class="record-field full"><span>${esc(field.label)}</span><textarea name="${field.key}" ${required}>${esc(value??field.default??'')}</textarea></label>`;
  if(field.type==='select')return `<label class="record-field"><span>${esc(field.label)}</span><select name="${field.key}" ${required}><option value="">Select…</option>${(field.options||[]).map(option=>`<option value="${esc(option)}" ${String(value??field.default??'')===String(option)?'selected':''}>${esc(option.replaceAll('_',' '))}</option>`).join('')}</select></label>`;
  if(field.type==='checkbox')return `<label class="record-check"><input name="${field.key}" type="checkbox" ${(value??field.default)?'checked':''}><span>${esc(field.label)}</span></label>`;
  const constraints=['min','max','step'].filter(key=>field[key]!==undefined).map(key=>`${key}="${esc(field[key])}"`).join(' ');
  return recordField(field.label,field.key,field.type,value??field.default??'',`${required} ${constraints}`);
}

function specialistLineField(field){
  const required=field.required?'required':'';
  if(field.type==='select')return `<label><span>${esc(field.label)}</span><select name="${esc(field.key)}" ${required}><option value="">Select…</option>${(field.options||[]).map(option=>`<option value="${esc(option)}">${esc(option.replaceAll('_',' '))}</option>`).join('')}</select></label>`;
  if(field.type==='checkbox')return `<label class="record-check"><input name="${esc(field.key)}" type="checkbox"><span>${esc(field.label)}</span></label>`;
  return `<label><span>${esc(field.label)}</span><input name="${esc(field.key)}" type="${esc(field.type||'text')}" ${field.type==='number'?'step="0.01"':''} ${required}></label>`;
}
function approvalWorkflowSection(approvals,editing){
  if(!editing||!approvals?.required)return '';
  const rows=(approvals.steps||[]).map(step=>`<tr><td>${esc(step.cycle_no)}</td><td>${esc(step.step_no)}</td>
    <td><b>${esc(step.required_role_code)}</b></td><td>${esc(step.assigned_user_name||step.assigned_user_email||'Role queue')}</td>
    <td>${statusBadge(step.status)}</td><td>${esc(step.decided_by||'-')}</td><td>${date(step.decided_at||step.requested_at)}</td></tr>`).join('');
  return `<section class="record-sublist connected-record-section approval-matrix-section">
    <header><div><h3>Approval Matrix</h3><p>Amount-based authority and requester/approver segregation are enforced.</p></div>
      <span>${approvals.pending} pending · ${approvals.approved} approved</span></header>
    ${operationalTable(['Cycle','Step','Required Role','Assigned User','Status','Decision By','Activity Date'],rows)}
  </section>`;
}
function specialistLineSection(specialist,editing,immutable,allowed){
  if(!editing||!specialist?.config)return '';
  const config=specialist.config;
  if(String(config.engine_code||'').startsWith('CORE_'))return `<section class="record-sublist connected-record-section specialist-engine-status"><header><div><h3>Connected Transaction Engine</h3><p>${esc(config.notes||config.engine_code)}</p></div><span>${esc(config.rollout_level)}</span></header></section>`;
  const lines=specialist.lines||[];
  const rows=lines.map(line=>`<tr><td><b>${esc(line.lineNo||'-')}</b></td><td>${esc(line.lineType||'-')}</td><td>${esc(line.referenceCode||'-')}</td>
    <td>${esc(line.description||'-')}</td><td class="num">${esc(line.quantity??line.hours??'-')}</td><td class="num">${money(line.rate||0)}</td>
    <td class="num">${money(line.amount||line.billableAmount||0)}</td><td>${statusBadge(line.status||line.resultCode||'OPEN')}</td>
    <td>${allowed&&!immutable?`<button type="button" class="table-action danger" data-delete-specialist-line="${line.id}">Remove</button>`:''}</td></tr>`).join('');
  const links=(specialist.links||[]).map(link=>{
    const outbound=link.source_module_code===state.module.code;
    const code=outbound?link.target_module_code:link.source_module_code;
    const id=outbound?link.target_record_id:link.source_record_id;
    const no=outbound?link.target_record_no:link.source_record_no;
    return `<button type="button" class="connected-module-link" data-specialist-link-module="${esc(code)}" data-specialist-link-id="${id}"><b>${esc(no)}</b><span>${esc(code)} · ${esc(link.link_type)}</span></button>`;
  }).join('');
  const form=specialist.lineSchema?.length&&allowed&&!immutable?`<form id="specialistLineForm" class="operational-form grid specialist-line-form">
      ${specialist.lineSchema.map(specialistLineField).join('')}<button class="command primary">Add Operational Line</button></form>`:'';
  return `<section class="record-sublist connected-record-section specialist-engine-section">
    <header><div><h3>${esc(config.domain_code)} Specialist Engine</h3><p>${esc(config.notes||config.engine_code)}. Detail lines are validated before approval, completion, or posting.</p></div>
      <span>${lines.length} lines · ${esc(config.rollout_level)}</span></header>
    ${form}${operationalTable(['Line','Type','Reference','Description','Qty / Hours','Rate','Amount','Status','Action'],rows)}
    <div class="specialist-flow"><h4>Connected Document Flow</h4><div class="connected-module-grid">${links||operationalEmpty('Links appear automatically when related project, contract, customer, serial, employee, work-order, site, or invoice references are found.')}</div></div>
  </section>`;
}
function renderRecordForm(record=null,documents=[],connected={}){
  const editing=!!record;
  const immutable=editing&&['POSTED','CLOSED','COMPLETED','REVERSED','VOIDED','TERMINATED','EXPIRED'].includes(record.status);
  const allowed=can(state.module.permission,editing?'EDIT':'CREATE')&&!immutable;
  const definition=state.definition;
  const actions=editing?definition.workflow.actions.filter(action=>action.from.includes(record.status)&&action.code!=='REVERSE'):[];
  const documentRows=documents.map(document=>`<tr><td><b>${esc(document.document_no)}</b></td><td>${esc(document.document_type)}</td>
    <td><a href="/api/workspace/documents/${document.id}/file" target="_blank" rel="noopener">${esc(document.file_name)}</a></td>
    <td>${esc(Math.ceil(Number(document.file_size||0)/1024))} KB</td><td>${esc(document.uploaded_by||'-')}</td><td>${date(document.uploaded_at)}</td></tr>`);
  const specialist=connected.specialist||null;
  const leaseUnitRows=(connected.units||[]).map(unit=>`<tr><td><b>${esc(unit.serial_no)}</b></td><td>${esc(unit.item_code)}</td>
    <td>${esc(unit.item_name)}</td><td>${esc(unit.category)}</td><td>${esc(unit.current_location_code||'-')}</td>
    <td>${statusBadge(unit.status)}</td></tr>`);
  const leaseUnitSection=editing&&state.module.code==='sd-lease-contract-management'?`
    <section class="record-sublist connected-record-section">
      <header><div><h3>Leased Units / Annex A</h3><p>Select only available serialized motorcycles, batteries, equipment, or other lease assets.</p></div>
        <span>${connected.units?.length||0} units linked</span></header>
      <div class="lease-unit-picker">
        <label><span>Available Serial Numbers</span><div class="serial-picker" id="leaseUnitPicker"><select class="serial-add"><option value="">Add a serial…</option>${(connected.availableAssets||[]).map(asset=>`<option value="${esc(asset.serial_no)}">${esc(asset.category)} · ${esc(asset.serial_no)} · ${esc(asset.item_name)} · ${esc(asset.current_location_code||'No location')}</option>`).join('')}</select><div class="serial-chips"></div></div></label>
        <div><label><span>Replacement Value / Unit</span><input id="leaseReplacementValue" type="number" step="0.01" value="${esc(connected.lease?.replacement_value||0)}"></label>
          <label><span>Daily Rate VAT-Ex / Unit</span><input id="leaseDailyRate" type="number" step="0.01" value="${esc(connected.lease?.daily_rate_vat_ex||0)}"></label>
          <button type="button" class="command primary" id="addLeaseUnits">Add Selected Units</button></div>
      </div>
      ${operationalTable(['Serial','Item','Description','Class','Current Location','Lease Status'],leaseUnitRows)}
    </section>`:'';
  const body=`<div class="record-actionbar">
    <button class="command primary" id="saveRecord" ${allowed?'':'disabled'}>Save ${esc(definition.noun)}</button>
    ${actions.map(action=>`<button class="command workflow-action" data-action="${action.code}" ${can(state.module.permission,action.permission)?'':'disabled'}>${esc(action.label)}</button>`).join('')}
    ${editing&&!['VOIDED','REVERSED'].includes(record.status)&&can(state.module.permission,'EDIT')?`<button class="command" id="requestDelete">Request Void</button>`:''}
    ${editing&&['POSTED','ACTIVE','CLOSED','COMPLETED'].includes(record.status)&&can(state.module.permission,'EDIT')?`<button class="command" id="requestReverse">Request Reversal</button>`:''}
    <button class="command" id="cancelRecord">Cancel</button>
    <span class="command-spacer"></span>${editing?statusBadge(record.status):statusBadge(definition.workflow.stages[0])}
  </div>
  <form id="recordForm" class="record-page">
    <header><div><small>${esc(state.module.groupTitle)}</small><h2>${editing?esc(record.record_no):'New Record'}</h2></div><div class="record-number">${editing?esc(record.record_no):'AUTO NUMBER'}</div></header>
    <section class="record-body">
      <div class="record-fields">
        <label class="record-field"><span>Record Type</span><select name="recordType" required>${definition.recordTypes.map(type=>`<option ${type===(record?.record_type||definition.recordTypes[0])?'selected':''}>${esc(type)}</option>`).join('')}</select></label>
        ${recordField(definition.dateLabel,'transactionDate','date',record?.transaction_date||new Date().toISOString().slice(0,10),'required')}
        ${recordField(definition.entityLabel,'entityName','text',record?.entity_name||'')}
        ${recordField('Department','department','text',record?.department||state.session.user.department||'')}
        ${recordField('Owner','ownerEmail','email',record?.owner_email||state.session.user.email,'required')}
        ${recordField(definition.amountLabel,'amount','number',record?.amount||0,'step="0.01"')}
        ${definition.fields.map(field=>moduleField(field,record?.payload?.[field.key])).join('')}
        <label class="record-field full"><span>Description</span><textarea name="description">${esc(record?.description||'')}</textarea></label>
      </div>
    </section>
    <div class="record-tabs"><button type="button" class="active">Supporting Documents</button><button type="button">Related Modules</button><button type="button">System Information</button></div>
    <section class="record-sublist">${editing?`<div id="documentUpload" class="operational-form">
      <label><span>Document Type</span><select name="documentType"><option>CONTRACT</option><option>ANNEX</option><option>APPROVAL</option><option>SUPPORTING</option></select></label>
      <label><span>File</span><input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" required></label>
      <button type="button" class="command primary" id="uploadDocument">Upload Document</button></div>
      ${operationalTable(['Document','Type','File','Size','Uploaded By','Uploaded At'],documentRows)}`:operationalEmpty(`Save the ${definition.noun.toLowerCase()} before uploading supporting documents.`)}</section>
    ${leaseUnitSection}
    ${approvalWorkflowSection(specialist?.approvals,editing)}
    ${specialistLineSection(specialist,editing,immutable,allowed)}
  </form>`;
  content.innerHTML=workbenchShell(body,'records');
  bindWorkbench();
  $('#cancelRecord').onclick=()=>openSection('records');
  const save=async()=>{
    const body=formDataObject($('#recordForm'));
    definition.fields.filter(field=>field.type==='checkbox').forEach(field=>{body[field.key]=$(`#recordForm [name="${field.key}"]`).checked;});
    try{
      const path=`/workspace/modules/${state.module.code}/records${editing?`/${record.id}`:''}`;
      const result=await api(path,{method:editing?'PATCH':'POST',body:JSON.stringify(body)});
      toast(`${definition.noun} saved`);
      await openRecord(result.record.id);
    }catch(error){toast(error.message,'error');}
  };
  $('#saveRecord').onclick=save;
  $$('.workflow-action').forEach(button=>button.onclick=async()=>{
    try{
      const result=await api(`/workspace/modules/${state.module.code}/records/${record.id}/action`,{method:'POST',body:JSON.stringify({action:button.dataset.action})});
      if(result.approvalDecision&&!result.approvalDecision.completed)toast(`Approval step recorded; ${result.approvalDecision.state.pending} step(s) remain`);
      else toast(`${button.textContent.trim()} completed`);
      await openRecord(record.id);
    }catch(error){toast(error.message,'error');}
  });
  if($('#requestDelete'))$('#requestDelete').onclick=()=>openRecordChangeRequest(record,'DELETE');
  if($('#requestReverse'))$('#requestReverse').onclick=()=>openRecordChangeRequest(record,'REVERSE');
  if($('#uploadDocument'))$('#uploadDocument').onclick=async()=>{
    const host=$('#documentUpload');
    const file=host.querySelector('[name="file"]').files[0];
    if(!file)return toast('Choose a document to upload.','error');
    const body=new FormData();
    body.set('documentType',host.querySelector('[name="documentType"]').value);
    body.set('file',file);
    try{await api(`/workspace/modules/${state.module.code}/records/${record.id}/documents`,{method:'POST',body});toast('Document uploaded');await openRecord(record.id);}
    catch(error){toast(error.message,'error');}
  };
  serialChipify($('#leaseUnitPicker'));
  if($('#addLeaseUnits'))$('#addLeaseUnits').onclick=async()=>{
    const serials=serialChipValues($('#leaseUnitPicker'));
    if(!serials.length)return toast('Select one or more available serial numbers.','error');
    try{
      await api(`/workspace/modules/sd-lease-contract-management/records/${record.id}/units`,{
        method:'POST',body:JSON.stringify({
          serials,replacementValue:Number($('#leaseReplacementValue').value||0),
          dailyRate:Number($('#leaseDailyRate').value||0),
        }),
      });
      toast(`${serials.length} lease unit${serials.length===1?'':'s'} linked`);
      await openRecord(record.id);
    }catch(error){toast(error.message,'error');}
  };
  if($('#specialistLineForm'))$('#specialistLineForm').onsubmit=async event=>{
    event.preventDefault();
    const body=formDataObject(event.currentTarget);
    (specialist?.lineSchema||[]).filter(field=>field.type==='checkbox').forEach(field=>{body[field.key]=event.currentTarget.elements[field.key].checked;});
    try{await api(`/enterprise/modules/${state.module.code}/records/${record.id}/lines`,{method:'POST',body:JSON.stringify(body)});toast('Operational detail line added');await openRecord(record.id);}
    catch(error){toast(error.message,'error');}
  };
  $$('[data-delete-specialist-line]').forEach(button=>button.onclick=async()=>{
    try{await api(`/enterprise/modules/${state.module.code}/records/${record.id}/lines/${button.dataset.deleteSpecialistLine}`,{method:'DELETE'});toast('Operational detail line removed');await openRecord(record.id);}
    catch(error){toast(error.message,'error');}
  });
  $$('[data-specialist-link-module]').forEach(button=>button.onclick=async()=>{
    const moduleCode=button.dataset.specialistLinkModule;const targetId=button.dataset.specialistLinkId;
    await openWorkspace(moduleCode);await openRecord(targetId);
  });
}
function openRecordChangeRequest(record,actionType){
  modal(`${actionType==='REVERSE'?'Reverse':'Void'} ${record.record_no}`,`<form id="changeRequestForm" class="operational-form grid">

    <label class="wide"><span>Reason</span><textarea name="reason" required minlength="8" placeholder="Explain why this record must be ${actionType==='REVERSE'?'reversed':'voided'}"></textarea></label>
    <button class="command primary">Submit Approval Request</button>
  </form>`);
  $('#changeRequestForm').onsubmit=async event=>{
    event.preventDefault();
    const body=formDataObject(event.currentTarget);
    body.actionType=actionType;
    try{
      const result=await api(`/workspace/modules/${state.module.code}/records/${record.id}/change-requests`,{
        method:'POST',body:JSON.stringify(body),
      });
      closeModal();toast(`${result.request.requestNo} sent for approval`);await openRecord(record.id);
    }catch(error){toast(error.message,'error');}
  };
}
async function decideRecordChange(requestId,decision,reload){
  const notes=decision==='REJECT'?'Rejected during access-controlled review':'Approved after independent review';
  try{
    await api(`/workspace/modules/${state.module.code}/change-requests/${requestId}/decision`,{
      method:'POST',body:JSON.stringify({decision,notes}),
    });
    toast(`Change request ${decision.toLowerCase()}d`);
    await reload();
  }catch(error){toast(error.message,'error');}
}
function showWorkspaceError(error,selector='#content'){
  const host=$(selector);
  if(host)host.innerHTML=`<div class="workspace-error"><b>Unable to load</b><span>${esc(error.message)}</span></div>`;
  toast(error.message,'error');
}

async function renderAccessAdmin(){
  document.body.classList.remove('launchpad-view');
  document.body.classList.add('workbench-view');
  state.module=null;
  state.section='admin';
  setHeader('User Access','System Administration');
  content.innerHTML='<div class="workspace-loading">Loading user access…</div>';
  try{
    const data=await api('/admin/users');
    const selected=data.users.find(user=>user.id===state.accessUserId)||data.users[0]||null;
    openUserForm(data,selected,{landing:true});
  }catch(error){showWorkspaceError(error);}
}
function adminWorkbenchShell(body,active='users'){
  const user=state.session.user;
  const tabs=[['users','Authorized Users'],['roles','Roles & Permissions'],['audit','Access Audit']];
  return `<section class="erp-workbench access-workbench">
    <header class="workbench-systembar">
      <div><button class="admin-modules-home" title="Blitz - ERP">▦</button><span class="workbench-user-dot">●</span><b>${esc(user.displayName||user.email)}</b><small>${esc(user.role)}</small></div>
      <div><span>INTERNAL</span><button class="admin-modules-home">Modules</button><button class="workbench-logout">Sign out</button></div>
    </header>
    <div class="workbench-modulebar">
      <div><span class="workbench-star">★</span><div><h1>User & Access Management</h1><small>System Administration</small></div></div>
      <div class="workbench-module-chip">Access Control</div>
    </div>
    <nav class="workbench-tabs">${tabs.map(([id,label])=>`<button data-admin-section="${id}" class="${active===id?'active':''}">${esc(label)}</button>`).join('')}</nav>
    <main class="workbench-canvas">${body}</main>
    <footer class="workbench-footer"><span>Blitz - ERP</span><span>Controlled Module Access · © 2026 AL23</span></footer>
  </section>`;
}
function bindAdminWorkbench(){
  $$('.admin-modules-home').forEach(button=>button.onclick=renderLaunchpad);
  $$('.workbench-logout').forEach(button=>button.onclick=logout);
  $$('[data-admin-section]').forEach(button=>button.onclick=()=>{
    if(button.dataset.adminSection==='users')return renderAccessAdmin();
    if(button.dataset.adminSection==='roles')return renderRolePermissions();
    return renderAccessAudit();
  });
}
async function renderRolePermissions(roleCode=''){
  content.innerHTML='<div class="workspace-loading">Loading role permissions…</div>';
  try{
    const data=await api('/admin/users');
    const role=roleCode||data.roles.find(value=>value.code!=='ADMIN')?.code||data.roles[0]?.code;
    const actions=[
      ['can_view','View','canView'],['can_create','Create','canCreate'],['can_edit','Edit','canEdit'],
      ['can_approve','Approve','canApprove'],['can_post','Post','canPost'],['can_export','Export','canExport'],
      ['can_manage','Manage','canManage'],
    ];
    const rows=data.modules.map(module=>{
      const permission=data.permissions.find(value=>value.role_code===role&&value.module===module)||{};
      return `<tr data-role-module="${esc(module)}"><td><b>${esc(module.replaceAll('_',' '))}</b></td>
        ${actions.map(([column,label])=>`<td><label class="permission-check"><input type="checkbox" data-permission="${column}" ${role==='ADMIN'||permission[column]?'checked':''} ${role==='ADMIN'?'disabled':''}><span>${label}</span></label></td>`).join('')}</tr>`;
    }).join('');
    const body=`<div class="workspace-commandbar"><label class="inline-control"><span>Role</span><select id="permissionRole">
      ${data.roles.map(value=>`<option value="${esc(value.code)}" ${value.code===role?'selected':''}>${esc(value.name)} · ${esc(value.code)}</option>`).join('')}</select></label>
      <button class="command primary" id="saveRolePermissions" ${role==='ADMIN'?'disabled':''}>Save Permissions</button>
      <span class="command-spacer"></span><span class="workspace-mode">ROLE AUTHORITY</span></div>
      <section class="workspace-card"><header><div><h2>${esc(data.roles.find(value=>value.code===role)?.name||role)}</h2>
        <span>Action authority by operational area; individual module visibility is assigned on each user.</span></div></header>
        <div class="record-table-wrap"><table class="record-table authority-table"><thead><tr><th>Operational Area</th>${actions.map(([,label])=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
      </section>`;
    content.innerHTML=adminWorkbenchShell(body,'roles');bindAdminWorkbench();
    $('#permissionRole').onchange=event=>renderRolePermissions(event.target.value);
    $('#saveRolePermissions').onclick=async()=>{
      const permissions=$$('[data-role-module]').map(row=>{
        const item={module:row.dataset.roleModule};
        actions.forEach(([column,,key])=>{item[key]=row.querySelector(`[data-permission="${column}"]`).checked;});
        return item;
      });
      try{await api(`/admin/permissions/${role}`,{method:'POST',body:JSON.stringify({permissions})});toast(`${role} permissions saved`);await renderRolePermissions(role);}
      catch(error){toast(error.message,'error');}
    };
  }catch(error){showWorkspaceError(error);}
}
async function renderAccessAudit(search=''){
  content.innerHTML='<div class="workspace-loading">Loading access audit…</div>';
  try{
    const data=await api(`/admin/access-audit?q=${encodeURIComponent(search)}`);
    const rows=data.rows.map(row=>`<tr><td>${date(row.event_at)}</td><td><b>${esc(row.user_email||'SYSTEM')}</b></td>
      <td>${esc(row.action)}</td><td>${esc(row.module)}</td><td>${esc(row.record_type||'-')}</td><td>${esc(row.record_no||row.record_id||'-')}</td>
      <td>${esc(row.environment)}</td><td>${esc(row.ip_address||'-')}</td><td>${esc(row.request_id||'-')}</td></tr>`);
    const body=`<div class="workspace-commandbar"><input id="accessAuditSearch" value="${esc(search)}" placeholder="Search user, action, module, or reference">
      <button class="command primary" id="runAccessAudit">Search</button><button class="command" id="refreshAccessAudit">Refresh</button>
      <span class="command-spacer"></span><span class="workspace-mode">${data.total} AUDIT EVENTS</span></div>
      <section class="workspace-card"><header><div><h2>Immutable Access & Transaction Audit</h2></div></header>
        ${operationalTable(['Event Time','User','Action','Module','Record Type','Reference','Environment','IP','Request ID'],rows)}</section>`;
    content.innerHTML=adminWorkbenchShell(body,'audit');bindAdminWorkbench();
    $('#runAccessAudit').onclick=()=>renderAccessAudit($('#accessAuditSearch').value);
    $('#accessAuditSearch').onkeydown=event=>{if(event.key==='Enter')$('#runAccessAudit').click();};
    $('#refreshAccessAudit').onclick=()=>renderAccessAudit(search);
  }catch(error){showWorkspaceError(error);}
}
function openUserForm(data,user=null,options={}){
  if(user)state.accessUserId=user.id;
  const selected=new Set(user?.allowed_workspace_modules||[]);
  const accessGroups=[
    ...state.catalog.groups,
    {title:'Tools',items:state.catalog.tools},
    {title:'Add-ons',items:state.catalog.addons},
  ];
  const groups=accessGroups.map(group=>`<fieldset class="access-group"><legend>${esc(group.title)}</legend>${group.items.map(item=>`<label><input type="checkbox" name="workspaceModules" value="${esc(item.code)}" ${selected.has(item.code)?'checked':''}><span>${esc(item.label)}</span></label>`).join('')}</fieldset>`).join('');
  const actionColumns=[
    ['can_view','View'],['can_create','Create'],['can_edit','Edit'],['can_approve','Approve'],
    ['can_post','Post'],['can_export','Export'],['can_manage','Manage'],
  ];
  const buildRoleAuthority=role=>{
    const admin=role==='ADMIN';
    return data.modules.map(module=>{
      const permission=data.permissions.find(row=>row.role_code===role&&row.module===module)||{};
      return `<tr><td><b>${esc(module.replaceAll('_',' '))}</b></td>${actionColumns.map(([key])=>`<td>${admin||permission[key]?'<span class="authority-yes">✓</span>':'<span class="authority-no">-</span>'}</td>`).join('')}</tr>`;
    }).join('');
  };
  const userSwitcher=data.users.length?`<div class="access-user-switcher">
    <label><span>Authorized user</span><select id="accessUserSwitch">${data.users.map(row=>`<option value="${row.id}" ${row.id===user?.id?'selected':''}>${esc(row.display_name)} · ${esc(row.email)}</option>`).join('')}</select></label>
    <div><span>${data.users.filter(row=>row.active).length} active</span><span>${data.users.filter(row=>!row.activated).length} pending</span><span>${data.workspaceModules.length} modules</span></div>
  </div>`:'';
  const body=`<div class="record-actionbar access-actionbar">
      <button class="command primary" id="saveUser">Save User</button>
      <button class="command" id="newAccessUser">New User</button>
      ${user?`<button class="command" id="issueCredential">${user.activated?'Reset Password':'Issue Activation'}</button>`:''}
      <button class="command" id="refreshAccess">Refresh</button>
      <span class="command-spacer"></span><span class="workspace-mode">${user?'EDIT USER':'NEW USER'}</span>
    </div>
    ${userSwitcher}
    <form id="userForm" class="record-page access-record-page">
      <header><div><small>System Administration</small><h2>${user?esc(user.display_name):'New Authorized User'}</h2></div><div class="record-number">${user?`USR-${String(user.id).padStart(5,'0')}`:'AUTO NUMBER'}</div></header>
      <div class="record-tabs"><button type="button" class="active">User Profile & Access</button><button type="button">Approval Authority</button><button type="button">Authentication</button><button type="button">Audit History</button></div>
      <section class="record-body access-profile">
        <div class="record-fields">
          ${recordField('Corporate Email','email','email',user?.email||'',`required ${user?'readonly':''}`)}
          ${recordField('Display Name','displayName','text',user?.display_name||'','required')}
          ${recordField('Department','department','text',user?.department||'')}
          <label class="record-field"><span>Role</span><select name="roleCode" id="userRole">${data.roles.map(role=>`<option value="${esc(role.code)}" ${role.code===(user?.role_code||'STAFF')?'selected':''}>${esc(role.name)}</option>`).join('')}</select></label>
          <label class="record-check"><input type="checkbox" name="liveAccess" ${user?.live_access!==0?'checked':''}><span>Allow live system access</span></label>
          <label class="record-check"><input type="checkbox" name="active" ${user?.active!==0?'checked':''}><span>Active user</span></label>
        </div>
      </section>
      <section class="access-assignment">
        <header><div><h3>Allowed Modules</h3><p>Check only the modules this user is permitted to see and open.</p></div><div><button type="button" id="selectAllAccess">Select all</button><button type="button" id="clearAllAccess">Clear all</button><b id="selectedAccessCount">0 selected</b></div></header>
        <div id="adminFullAccessNote" class="admin-access-note hidden">Administrators always retain access to every module.</div>
        <div class="access-selector">${groups}</div>
      </section>
      <section class="access-authority">
        <header><div><h3>Action Authority</h3><p>Action rights come from the selected role. Every void, deletion, or reversal still requires an independent approver.</p></div><b id="authorityRole">${esc(user?.role_code||'STAFF')}</b></header>
        <div class="record-table-wrap"><table class="record-table authority-table"><thead><tr><th>Operational Area</th>${actionColumns.map(([,label])=>`<th>${label}</th>`).join('')}</tr></thead><tbody id="roleAuthorityBody">${buildRoleAuthority(user?.role_code||'STAFF')}</tbody></table></div>
      </section>
    </form>`;
  content.innerHTML=adminWorkbenchShell(body,'users');
  bindAdminWorkbench();
  $('#newAccessUser').onclick=()=>openUserForm(data,null);
  $('#refreshAccess').onclick=renderAccessAdmin;
  if($('#accessUserSwitch'))$('#accessUserSwitch').onchange=event=>{
    const next=data.users.find(row=>row.id===Number(event.currentTarget.value));
    if(next)openUserForm(data,next,{landing:true});
  };
  $('#saveUser').onclick=()=>$('#userForm').requestSubmit();
  const accessInputs=()=>$$('#userForm [name="workspaceModules"]');
  const updateAccessCount=()=>{
    const count=accessInputs().filter(input=>input.checked).length;
    $('#selectedAccessCount').textContent=`${count} selected`;
  };
  const syncRoleAccess=()=>{
    const admin=$('#userRole').value==='ADMIN';
    $('#adminFullAccessNote').classList.toggle('hidden',!admin);
    accessInputs().forEach(input=>{
      if(admin)input.checked=true;
      input.disabled=admin;
    });
    $('#selectAllAccess').disabled=admin;
    $('#clearAllAccess').disabled=admin;
    $('#authorityRole').textContent=$('#userRole').value;
    $('#roleAuthorityBody').innerHTML=buildRoleAuthority($('#userRole').value);
    updateAccessCount();
  };
  $('#userRole').onchange=syncRoleAccess;
  $('#selectAllAccess').onclick=()=>{accessInputs().forEach(input=>input.checked=true);updateAccessCount();};
  $('#clearAllAccess').onclick=()=>{accessInputs().forEach(input=>input.checked=false);updateAccessCount();};
  accessInputs().forEach(input=>input.onchange=updateAccessCount);
  syncRoleAccess();
  $('#userForm').onsubmit=async event=>{
    event.preventDefault();
    const body=formDataObject(event.currentTarget);
    body.liveAccess=event.currentTarget.elements.liveAccess.checked;
    body.active=event.currentTarget.elements.active.checked;
    body.workspaceModules=$$('#userForm [name="workspaceModules"]:checked').map(input=>input.value);
    const permissions=new Set(body.workspaceModules.map(code=>moduleByCode(code)?.permission).filter(Boolean));
    body.modules=[...permissions];
    try{
      const result=await api('/admin/users',{method:'POST',body:JSON.stringify(body)});
      state.accessUserId=result.user.id;
      toast(user?'User updated':'User created');
      await renderAccessAdmin();
      if(result.activationLink)showCredentialLink('Account activation',result.activationLink,result);
      if(result.activationLink)toast(result.emailed?('Activation email sent to '+result.emailedTo):'Account created, but the activation email did not send',result.emailed?'success':'error');
    }catch(error){toast(error.message,'error');}
  };
  if($('#issueCredential'))$('#issueCredential').onclick=async()=>{
    try{
      const result=await api(`/admin/users/${user.id}/${user.activated?'reset':'activation'}`,{method:'POST',body:'{}'});
      showCredentialLink(user.activated?'Password reset':'Account activation',result.resetLink||result.activationLink,result);
      toast(result.emailed?('Email sent to '+result.emailedTo):'The email did not send - use the link',result.emailed?'success':'error');
    }catch(error){toast(error.message,'error');}
  };
}
/*
 * The link is emailed to the person it belongs to. It is still shown here as a
 * fallback, but the dialog says plainly whether the email actually left - a
 * silent copyable link is how six accounts ended up never activated.
 */
function showCredentialLink(title,link,delivery){
  delivery=delivery||{};
  const banner=delivery.emailed
    ? `<p class="cred-sent">Sent to <b>${esc(delivery.emailedTo||'')}</b>. They can activate straight from the email - you do not need to send anything.</p>`
    : `<p class="cred-failed"><b>The email did not go out.</b>${delivery.emailError?' '+esc(delivery.emailError):''}
        Send them the link below yourself, then check the mail settings.</p>`;
  modal(title,`${banner}
    <p class="cred-hint">${delivery.emailed?'Backup link, in case they cannot find the email:':'Activation link:'}</p>
    <div class="credential-link"><input value="${esc(link)}" readonly><button class="command primary" id="copyCredential">Copy Link</button></div>`);
  $('#copyCredential').onclick=async()=>{await navigator.clipboard.writeText(link);toast('Link copied');};
}

async function logout(){
  try{await api('/auth/logout',{method:'POST',body:'{}'});}
  finally{showAuth('login');}
}
function closeMobile(){
  $('#sidebar').classList.remove('open');
  $('#mobileOverlay').classList.remove('open');
}

$('#modalClose').onclick=closeModal;
$('#modal').onclick=event=>{if(event.target===$('#modal'))closeModal();};
$('#refreshBtn').onclick=()=>state.section==='admin'?renderAccessAdmin():(state.module?openSection(state.section):renderLaunchpad());
$('#modulesBtn').onclick=renderLaunchpad;
$('#accessBtn').onclick=renderAccessAdmin;
$('#logoutBtn').onclick=logout;
$('#themeToggle').onclick=()=>{
  state.theme=state.theme==='light'?'dark':'light';
  document.documentElement.dataset.theme=state.theme;
  localStorage.setItem('e88-theme',state.theme);
};
$('#mobileMenu').onclick=()=>{$('#sidebar').classList.add('open');$('#mobileOverlay').classList.add('open');};
$('#mobileOverlay').onclick=closeMobile;
$('.brand').onclick=renderLaunchpad;
init();

/* =====================================================================
   E88 Live Customization Layer  (additive, client-side, presentation-safe)
   - Launchpad: add / rename / reorder / hide module columns & buttons
   - Branding : app title, footer text, theme, logo
   - Tables   : show / hide / reorder columns per grid (right-click a header)
   All changes persist in localStorage and survive reloads.
   This block only wraps renderLaunchpad and observes the DOM; it does not
   modify any existing function body.
   ===================================================================== */
(function(){
  const LS='e88-customize-v1';
  const read=()=>{try{return JSON.parse(localStorage.getItem(LS))||{};}catch(e){return {};}};
  const write=s=>localStorage.setItem(LS,JSON.stringify(s));
  const S=Object.assign({branding:{},groups:{},items:{},order:{},added:{groups:[],items:{}},tables:{}},read());

  const persist=()=>write(S);
  // --- Generic clickable-row record inspector (makes every table row open its details) ---
  (function(){const st=document.createElement('style');st.textContent='table.record-table tbody tr.clickable-row{cursor:pointer}table.record-table tbody tr.clickable-row:hover>td{background:#eef7fc}';document.head.appendChild(st);})();
  function czOpenRowDetail(headers,tr){
    var cells=[].slice.call(tr.children);
    var first=(cells[0]?cells[0].textContent.trim():'')||'Record';
    var fields=headers.map(function(h,i){return {label:h||('Column '+(i+1)),value:cells[i]?cells[i].textContent.replace(/\s+/g,' ').trim():''};}).filter(function(f){return f.value!=='';});
    var grid='<div class="inventory-detail-grid">'+fields.map(function(f){return '<div><small>'+esc2(f.label)+'</small><b>'+esc2(f.value)+'</b></div>';}).join('')+'</div>';
    var isDoc=/^(REQ|RS|PO|RFP|DEL|DR|DO|GRN|GRF|RCV|GRR|SO|SI|SHP|STO|MRF|GIS|GP|IT|JE|CRV|PV|PAY|IMP)(?:[-\s]|\d)/i.test(first);
    var body=grid+(isDoc?'<div class="modal-actions"><button class="button secondary" id="czPrintRow">Print slip</button></div>':'');
    try{ modal('Record - '+first,body,isDoc?'Full details - click Print slip for a formal document':'Full record details');
      var pb=document.getElementById('czPrintRow'); if(pb) pb.onclick=function(){czPrintSlip(first,fields);};
    }catch(e){}
  }
  function czWireRowInspector(){}
  function czPrintSlip(title,fields){
    var brand=(S.branding&&S.branding.appTitle)||'Blitz - ERP';
    var rows=fields.map(function(f){return '<tr><th>'+esc2(f.label)+'</th><td>'+esc2(f.value)+'</td></tr>';}).join('');
    var w=window.open('','_blank','width=840,height=920'); if(!w){alert('Please allow pop-ups to print.');return;}
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>'+esc2(title)+'</title><style>*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#17212b;padding:26px}header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0a2239;padding-bottom:10px;margin-bottom:16px}h1{font-size:18px;margin:0;color:#0a2239}.doc{margin-top:3px;color:#555;font-size:13px;font-weight:700}.meta{text-align:right;color:#666;font-size:11px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #c9d3db;padding:7px 10px;text-align:left;vertical-align:top}th{background:#eef2f6;width:220px;color:#334}.sign{display:flex;gap:34px;margin-top:52px}.sign>div{flex:1;border-top:1px solid #333;padding-top:6px;font-size:11px;color:#555;text-align:center}.bar{margin-top:22px}.bar button{padding:9px 18px;border:1px solid #0a2239;background:#0a2239;color:#fff;border-radius:4px;cursor:pointer;font-size:12px}@media print{.bar{display:none}}</style></head><body><header><div><h1>'+esc2(brand)+'</h1><div class="doc">'+esc2(title)+'</div></div><div class="meta">Printed '+new Date().toLocaleString()+'</div></header><table>'+rows+'</table><div class="sign"><div>Prepared by / Date</div><div>Approved by / Date</div><div>Received by / Date</div></div><div class="bar"><button onclick="window.print()">Print this document</button></div></body></html>');
    w.document.close();
  }
  function czDocHtml(opts){
    var brand=(S.branding&&S.branding.appTitle)||'Blitz - ERP';
    var meta=(opts.meta||[]).filter(function(m){return m&&m[1]!=null&&String(m[1]).trim()!==''&&String(m[1])!=='Invalid Date';}).map(function(m){return '<div><small>'+esc2(m[0])+'</small><b>'+esc2(m[1])+'</b></div>';}).join('');
    var lines='';
    if(opts.lineHead&&opts.lineRows&&opts.lineRows.length){
      lines='<table class="lines"><thead><tr>'+opts.lineHead.map(function(h){return '<th>'+esc2(h)+'</th>';}).join('')+'</tr></thead><tbody>'+
        opts.lineRows.map(function(r){return '<tr>'+r.map(function(v){return '<td>'+esc2(v==null?'':v)+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table>';
    }
    var purpose=opts.purpose?'<div class="purpose"><small>Purpose / Remarks</small><div>'+esc2(opts.purpose)+'</div></div>':'';
    var signs=(opts.signatures||['Prepared by / Date','Approved by / Date','Received by / Date']).map(function(x){return '<div>'+esc2(x)+'</div>';}).join('');
    return '<!doctype html><html><head><meta charset="utf-8"><title>'+esc2(opts.title)+'</title><style>'+
      '*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#17212b;padding:28px}'+
      'header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0a2239;padding-bottom:10px;margin-bottom:6px}'+
      '.brand h1{font-size:18px;margin:0;color:#0a2239}.brand small{color:#6b7785;letter-spacing:.5px}'+
      '.title{text-align:right}.title h2{margin:0;font-size:16px;color:#0a2239;text-transform:uppercase;letter-spacing:1px}.title small{color:#6b7785}'+
      '.meta{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #c9d3db;border-radius:4px;margin:14px 0;overflow:hidden}'+
      '.meta>div{padding:7px 10px;border-bottom:1px solid #eef2f6;border-right:1px solid #eef2f6}'+
      '.meta small{display:block;color:#6b7785;font-size:10px;text-transform:uppercase;letter-spacing:.4px}.meta b{font-size:12.5px;color:#17212b}'+
      '.purpose{margin:8px 0 4px;border:1px solid #c9d3db;border-radius:4px;padding:8px 10px}.purpose small{color:#6b7785;font-size:10px;text-transform:uppercase}'+
      'table.lines{width:100%;border-collapse:collapse;margin:12px 0}table.lines th,table.lines td{border:1px solid #c9d3db;padding:6px 9px;text-align:left;font-size:11.5px}table.lines th{background:#eef2f6;color:#334}'+
      '.sign{display:flex;gap:34px;margin-top:56px}.sign>div{flex:1;border-top:1px solid #333;padding-top:6px;font-size:11px;color:#555;text-align:center}'+
      '.bar{margin-top:22px}.bar button{padding:9px 18px;border:1px solid #0a2239;background:#0a2239;color:#fff;border-radius:4px;cursor:pointer;font-size:12px}@media print{.bar{display:none}}'+
      '</style></head><body><header><div class="brand" style="display:flex;align-items:center;gap:10px"><img src="'+location.origin+'/logo.png" alt="E88 Ventures" style="height:38px;width:auto"><div><h1>E88 Ventures Inc.</h1><small>'+esc2(opts.subtitle||'Blitz - ERP')+'</small></div></div>'+
      '<div class="title"><h2>'+esc2(opts.title)+'</h2><small>Printed '+new Date().toLocaleString()+'</small></div></header>'+
      '<div class="meta">'+meta+'</div>'+purpose+lines+'<div class="sign">'+signs+'</div>'+
      '<div class="bar"><button onclick="window.print()">Print this document</button></div></body></html>';
  }
  function czOpenDoc(opts){var w=window.open('','_blank','width=880,height=980');if(!w){alert('Please allow pop-ups to print.');return;}w.document.write(czDocHtml(opts));w.document.close();}
  function czd(v){try{return v?date(v):'';}catch(e){return v||'';}}
  async function czPrintRequisition(id,titleOverride){
    try{var d=await api('/requisitions/'+id);var h=d.header||{};var allocs=(d.allocations||[]);var lines=(d.lines||[]);
      var serialsByItem={};allocs.forEach(function(a){var k=a.item_code||a.item_name||'';(serialsByItem[k]=serialsByItem[k]||[]).push(a.serial_no);});
      var lr;
      if(lines.length){lr=lines.map(function(l,i){var k=l.item_code||l.item_name||'';var alloc=(serialsByItem[k]||[]).join(', ');return [(i+1)+'.',l.item_code||'',l.item_name||l.description||'',l.qty||l.quantity||'',l.uom||l.base_uom||'PCS','',alloc,''];});}
      else{lr=allocs.map(function(a,i){return [(i+1)+'.',a.item_code||'',a.item_name||'',1,'PCS','',a.serial_no||'',''];});}
      czOpenDoc({title:titleOverride||'Requisition Slip',subtitle:'Supply Chain Management',
        meta:[['RS #',h.requisition_no],['Date Requested',czd(h.request_date||h.created_at)],['Requesting Dept',h.department||h.requesting_dept],['Requestor Name',h.requestor_name||h.holder_name||h.partner_name],['Requestor Email',h.requestor_email||h.holder_email],['Purpose',h.purpose||h.custody_purpose]],
        lineHead:['No.','E88-SKU','Description','Qty','UoM','Stock','Allocation','Remarks'],lineRows:lr,
        signatures:['Prepared by / Date','Approved by / Date']});
    }catch(e){if(typeof toast==='function')toast(e.message||'Unable to print requisition','error');}
  }
  async function czPrintPickSlip(id){return czPrintRequisition(id,'Pick Slip');}
  async function czPrintGRN(id){
    try{var d=await api('/receiving/'+id);var h=d.header||{};var lines=(d.lines||[]);
      czOpenDoc({title:'Goods Receipt Note',meta:[['Receipt No',h.receipt_no],['Shipment No',h.shipment_no],['Batch',h.batch_code],['Supplier',h.supplier_name],['Receiving Location',(h.location_code?h.location_code+' - ':'')+(h.location_name||'')],['Date',czd(h.received_at||h.receipt_date||h.created_at)],['Status',h.status],['Document Ref',h.document_ref]],lineHead:['Item','Expected Serial','Actual Serial','Match'],lineRows:lines.map(function(l){return [l.item_name||l.item_code||'',l.expected_serial_no||'',l.actual_serial_no||l.serial_no||'',l.match_status||l.acceptance_status||''];}),signatures:['Received by / Date','Checked by / Date','Approved by / Date']});
    }catch(e){if(typeof toast==='function')toast(e.message||'Unable to print goods receipt','error');}
  }
  async function czPrintDelivery(id){
    try{var d=await api('/deliveries/'+id);var h=d.header||{};var assets=(d.assets||[]);
      czOpenDoc({title:'Delivery Note',meta:[['Delivery No',h.delivery_no],['Requisition',h.requisition_no],['Sales Order',h.sales_order_no],['Type',h.transaction_type],['Destination',h.destination],['Recipient',h.recipient_name],['Origin',h.origin_location_name],['Scheduled',czd(h.scheduled_date)],['Delivered',czd(h.actual_delivery_date)],['Status',h.status]],lineHead:['Item','Class','Serial No','Status'],lineRows:assets.map(function(a){return [a.item_name||a.item_code||'',a.category||'',a.serial_no||'',a.current_status||''];}),signatures:['Released by / Date','Delivered by / Date','Received by / Date']});
    }catch(e){if(typeof toast==='function')toast(e.message||'Unable to print delivery note','error');}
  }
  function czPoDocHtml(d,chain){
    var h=d.header||{},doc=h.doc||{},lines=d.lines||[];
    var cur=h.currency||'PHP';var sym=cur==='USD'?'$':(cur+' ');
    function m(v){return sym+money(v);}
    var rows=lines.map(function(l,i){return '<tr><td class="c">'+(i+1)+'</td><td>'+esc2(l.description||l.item_name||l.item_code||'')+'</td><td>'+esc2(l.remarks||'')+'</td><td class="c">'+esc2(l.unit||'pcs')+'</td><td class="r">'+m(l.unit_cost)+'</td><td class="r">'+esc2(l.ordered_qty)+'</td><td class="r">'+m(l.line_amount)+'</td></tr>';}).join('');
    function sig(role,label,name,title){var img='<div class="sigline"></div>';
      if(chain){var st=null;for(var i=0;i<chain.length;i++){if((chain[i].role||'')===role){st=chain[i];break;}}if(st){if(st.signature){img=st.signature_type==='DRAW'?('<img src="'+st.signature+'">'):('<div class="typed">'+esc2(st.signature)+'</div>');}name=name||st.approver_name;}}
      return '<div class="sg"><div class="sgv">'+img+'</div><div class="sgb"><b>'+esc2(label)+'</b><div>'+esc2(name||'')+'</div><small>'+esc2(title||'')+'</small></div></div>';}
    return '<!doctype html><html><head><meta charset="utf-8"><title>Purchase Order '+esc2(h.purchase_order_no)+'</title><style>'+
      '*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#12305f;padding:26px;max-width:900px;margin:0 auto}'+
      '.top{display:flex;align-items:center;gap:12px;border-bottom:2px solid #0a2239;padding-bottom:8px}.top img{height:40px}.top h1{font-size:20px;margin:0;letter-spacing:1px}'+
      '.ponum{display:flex;justify-content:space-between;margin:8px 0;font-weight:700}'+
      '.sec{border:1px solid #b8cbd7;margin:8px 0}.sec .hd{background:#0a2239;color:#fff;padding:4px 8px;font-weight:700;font-size:10.5px;letter-spacing:.5px}'+
      '.grid2{display:grid;grid-template-columns:1fr 1fr}.fld{padding:4px 8px;border-top:1px solid #e3e9f0}.fld b{color:#334}'+
      'table.po{width:100%;border-collapse:collapse;margin:8px 0}table.po th,table.po td{border:1px solid #9fb4c8;padding:5px 7px}table.po th{background:#eef2f6}td.c{text-align:center}td.r,th.r{text-align:right}'+
      '.tot{display:flex;justify-content:flex-end;font-weight:700;margin-top:2px}.tot div{border:1px solid #9fb4c8;padding:5px 12px}'+
      '.rem{margin:8px 0;font-size:10.5px}.rem b{display:block}'+
      '.sigs{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:34px}.sg{text-align:center}.sgv{height:50px;display:flex;align-items:flex-end;justify-content:center}.sgv img{max-height:48px}.sgv .typed{font-family:cursive;font-size:18px}.sigline{width:100%;border-bottom:1px solid #333}.sgb b{display:block;font-size:10px;color:#556}.sgb div{font-weight:700;border-top:1px solid #333;padding-top:2px}.sgb small{color:#667}'+
      '.foot{margin-top:24px;text-align:center;color:#667;font-size:10px;border-top:1px solid #cbd5e1;padding-top:6px}'+
      '.bar{margin-top:16px}.bar button{padding:8px 16px;background:#0a2239;color:#fff;border:0;border-radius:4px;cursor:pointer}@media print{.bar{display:none}}'+
      '</style></head><body>'+
      '<div class="top"><img src="'+location.origin+'/logo.png" alt="E88"><h1>PURCHASE ORDER</h1></div>'+
      '<div class="ponum"><span>PURCHASE ORDER NO: '+esc2(h.purchase_order_no)+'</span><span>DATE: '+esc2(czd(h.order_date))+'</span></div>'+
      '<div class="sec"><div class="hd">VENDOR INFORMATION</div><div class="grid2">'+
        '<div class="fld"><b>Vendor Name:</b> '+esc2(h.vendor_name)+'</div><div class="fld"><b>Contact Person:</b> '+esc2(doc.vendorContactPerson)+'</div>'+
        '<div class="fld"><b>Address:</b> '+esc2(doc.vendorAddress)+'</div><div class="fld"><b>Contact Number:</b> '+esc2(doc.vendorContactNumber)+'</div>'+
        '<div class="fld"><b>Tax ID No.:</b> '+esc2(doc.vendorTaxId)+'</div><div class="fld"><b>Email Address:</b> '+esc2(doc.vendorEmail)+'</div></div></div>'+
      '<div class="sec"><div class="hd">CUSTOMER INFORMATION</div><div class="grid2">'+
        '<div class="fld"><b>Company Name:</b> E88 VENTURES, INC.</div><div class="fld"><b>Contact Person:</b> '+esc2(doc.requestedByName)+'</div>'+
        '<div class="fld"><b>Company Address:</b> 15 BRIXTON ST KAPITOLYO SECOND DISTRICT, CITY OF PASIG 1603 PH</div><div class="fld"><b>Department:</b> '+esc2(doc.customerDepartment)+'</div>'+
        '<div class="fld"><b>Shipping Address:</b> 174 Acacia St, Octagon Village, Brgy Dela Paz, Rosario, Pasig City, Metro Manila, Philippines 1610</div><div class="fld"><b>Contact Number:</b> </div>'+
        '<div class="fld"><b>TAX ID No.:</b> 637-589-418-0000</div><div class="fld"><b>Email Address:</b> </div></div></div>'+
      '<div class="ponum" style="font-weight:400"><span><b>Activity/Purpose:</b> '+esc2(doc.activityPurpose)+'</span><span><b>Invoice number:</b> '+esc2(doc.invoiceNumber)+'</span></div>'+
      '<table class="po"><thead><tr><th>Number</th><th>Particulars/Item Description</th><th>Remarks</th><th>Unit</th><th class="r">Unit Cost</th><th class="r">QTY</th><th class="r">Amount</th></tr></thead><tbody>'+rows+'</tbody></table>'+
      '<div class="tot"><div>Total Cost&nbsp;&nbsp;'+m(h.total_amount)+'</div></div>'+
      '<div class="rem"><b>Additional Remarks:</b><div>PAYMENT TERMS: '+esc2(doc.paymentTerms||h.payment_terms)+'</div><div>DELIVERY TERMS: '+esc2(doc.deliveryTerms||h.incoterm)+'</div>'+(doc.otherRemarks?('<div>OTHER REMARKS: '+esc2(doc.otherRemarks)+'</div>'):'')+'</div>'+
      '<div class="sigs">'+sig('CREATOR','Requested by',doc.requestedByName,doc.requestedByTitle)+sig('DEPT_MANAGER','Noted by',doc.deptManagerName,'Department Manager')+sig('DEPT_HEAD','Recommended by',doc.deptHeadName,'Department Head')+sig('FINANCE','Reviewed by',doc.financeName||'Mark Alexis Mungcal','Finance & Accounting Manager')+sig('CEO','Approved By',doc.ceoName,'Chief Executive Officer')+'</div>'+
      '<div class="foot">E88 Ventures, Inc. | 15 Brixton St., Kapitolyo, Pasig City 1603 Philippines</div>'+
      '<div class="bar"><button onclick="window.print()">Print this document</button></div></body></html>';
  }
  async function czPrintPO(id){try{var d=await api('/procurement/purchase-orders/'+id);var w=window.open('','_blank','width=900,height=1000');if(!w){alert('Please allow pop-ups to print.');return;}w.document.write(czPoDocHtml(d,null));w.document.close();}catch(e){if(typeof toast==='function')toast(e.message||'Unable to print PO','error');}}
  window.czPrintPO=czPrintPO;
  function czRfpDocHtml(r){
    r=r||{};var esc=esc2;var cur=r.currency||'PHP';
    function money2(n){return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
    var bd='border:1px solid #b9c0cf;padding:4px 8px;font-size:11px';
    var bar=function(t){return '<tr><td colspan="2" style="background:#d9dde4;border:1px solid #b9c0cf;padding:3px 8px;font-size:11px;font-weight:bold">'+t+'</td></tr>';};
    var kv=function(k,v){return '<span style="color:#333">'+k+':</span> <b>'+esc(v||'')+'</b>';};
    var ck=function(on){return '<span style="display:inline-block;width:12px;height:12px;border:1px solid #555;text-align:center;line-height:11px;margin-right:5px;font-size:10px;vertical-align:middle">'+(on?'X':'')+'</span>';};
    var rt=String(r.request_type||'').toLowerCase(),pt=String(r.payment_type||'').toLowerCase(),mop=String(r.mode_of_payment||'').toLowerCase();
    var gross=Number(r.gross_amount||r.amount||0),ewt=Number(r.withholding_amount||0),net=Number(r.net_payable||(gross-ewt));
    var line='<tr>'+['<td style="'+bd+'">'+esc(czd(r.invoice_date||r.request_date))+'</td>','<td style="'+bd+'">'+esc(r.supplier_invoice_no||'')+'</td>','<td style="'+bd+'">'+esc(r.cost_center||'')+'</td>','<td style="'+bd+'">'+esc(r.purpose||'')+'</td>','<td style="'+bd+'">'+esc(r.gl_account||'')+'</td>','<td style="'+bd+';text-align:center">'+esc(r.uom||'-')+'</td>','<td style="'+bd+';text-align:center">1</td>','<td style="'+bd+';text-align:right">'+money2(net)+'</td>','<td style="'+bd+';text-align:right">'+money2(net)+'</td>'].join('')+'</tr>';
    var sigCol=function(label,name,ts,title,mark){
      var vis='<div style="height:34px"></div>';
      if(mark){
        vis=/^data:image\//.test(mark)
          ? '<div style="height:34px;display:flex;align-items:flex-end;justify-content:center"><img src="'+mark+'" style="max-height:34px;max-width:96%"></div>'
          : '<div style="height:34px;display:flex;align-items:flex-end;justify-content:center;font-family:\'Segoe Script\',\'Brush Script MT\',cursive;font-size:19px;color:#15294B">'+esc(mark)+'</div>';
      }
      return '<td style="border:1px solid #b9c0cf;padding:8px 6px;vertical-align:top;text-align:center"><div style="font-size:10px;color:#333;margin-bottom:2px">'+label+'</div>'+vis+'<div style="font-size:9.5px;font-weight:400;letter-spacing:.2px;color:#5a6577">'+esc(ts||'')+'</div><div style="border-top:1px solid #15294B;margin-top:2px;padding-top:3px;font-weight:bold;font-size:11px">'+esc(name||' ')+'</div><div style="font-size:10px;color:#445;font-style:italic">'+esc(title)+'</div></td>';};
    var signOf=function(stage){var list=(r.__signatures||[]);for(var i=0;i<list.length;i++){if(list[i].stage===stage&&list[i].signature)return list[i];}return null;};
    var markOf=function(stage){var x=signOf(stage);return x?x.signature:'';};
    var nameOf=function(stage,fallback){var x=signOf(stage);return (x&&(x.actor_name||x.actor))||fallback||'';};
    var reqName=r.requestor_name||r.requested_by||r.payee_name||'';
    return '<!doctype html><html><head><meta charset="utf-8"><title>Request for Payment '+esc(r.request_no||'')+'</title></head>'
     +'<body style="font-family:Arial,Helvetica,sans-serif;background:#eef1f5;margin:0;color:#222"><div style="max-width:1000px;margin:16px auto;background:#fff;padding:30px">'
     +'<table style="width:100%;border-collapse:collapse;margin-bottom:10px"><tr><td style="width:30%;vertical-align:middle"><img src="'+location.origin+'/logo.png" style="height:42px"></td>'
     +'<td style="width:70%;text-align:center;vertical-align:middle"><div style="font-size:17px;font-weight:bold;letter-spacing:1px;color:#15294B">REQUEST FOR PAYMENT FORM</div></td></tr></table>'
     +'<table style="width:100%;border-collapse:collapse">'
     +'<tr><td style="'+bd+';width:50%">'+kv('RFP Code',r.request_no)+'</td><td style="'+bd+';width:50%">'+kv('Request Date',czd(r.request_date))+'</td></tr>'
     +bar('REQUESTING PARTY')
     +'<tr><td style="'+bd+'">'+kv('Name',reqName)+'</td><td style="'+bd+'">'+kv('Email Address',r.requestor_email||'')+'</td></tr>'
     +'<tr><td style="'+bd+'">'+kv('Department',r.department)+'</td><td style="'+bd+'">'+kv('Contact No.',r.contact_no||'')+'</td></tr>'
     +bar('REQUEST FOR PAYMENT DETAILS')
     +'<tr><td style="'+bd+'" colspan="2">'+kv('Activity/Purpose',r.purpose)+'</td></tr>'
     +'<tr><td style="'+bd+'" colspan="2">'+kv('Purchase Order No',r.purchase_order_no||'N/A')+'</td></tr>'
     +'<tr><td style="'+bd+';vertical-align:top"><div style="color:#333;font-size:10px;margin-bottom:3px">Request Type: <i>(select all that applies)</i></div>'
     +ck(rt.indexOf('cash')>-1)+'Cash Advance<br>'+ck(rt.indexOf('reimb')>-1)+'Reimbursement<br>'+ck(rt.indexOf('per diem')>-1)+'Per Diem Request<br>'+ck(rt.indexOf('vendor')>-1)+'Payment to Vendor</td>'
     +'<td style="'+bd+';vertical-align:top"><div style="color:#333;font-size:10px;margin-bottom:3px">Attachments: <i>(click all that apply)</i></div>'
     +ck(false)+'Billing/Statement of Account<br>'+ck(false)+'Sales/Service Invoice/Official Receipts<br>'+ck(false)+'Quotation/Proposal<br>'+ck(false)+'Workplan<br>'+ck(false)+'Travel Details'
     +'<div style="margin-top:8px;text-align:right"><div style="font-size:10px;color:#333">Checked and noted by</div></div></td></tr>'
     +'<tr><td style="'+bd+';vertical-align:top"><div style="color:#333;font-size:10px;margin-bottom:3px">Payment Type: <i>(select all that applies)</i></div>'
     +ck(pt.indexOf('partial')>-1)+'Partial<br>'+ck(pt.indexOf('full')>-1)+'Full<br>'+ck(pt.indexOf('subscription')>-1)+'Subscription</td>'
     +'<td style="'+bd+';vertical-align:top">'+kv('Payment Due',czd(r.due_date))+'</td></tr>'
     +bar('PAYEE INFORMATION')
     +'<tr><td style="'+bd+';vertical-align:top">'+kv('Name',r.payee_name)+'<br>'+kv('Address',r.payee_address||'')+'<br><br><span style="color:#333">Mode of Payment:</span><br>'
     +ck(mop.indexOf('check')>-1)+'Check<br>'+ck(mop.indexOf('bank')>-1||mop.indexOf('deposit')>-1||mop.indexOf('transfer')>-1)+'Bank Deposit/Transfer<br><span style="font-size:10px;color:#555;margin-left:18px">Bank Name: '+esc(r.bank_name||'')+'<br><span style="margin-left:18px">Account Name: '+esc(r.account_name||'')+'</span><br><span style="margin-left:18px">Account No.: '+esc(r.account_no||'')+'</span></span><br>'
     +ck(mop.indexOf('online')>-1)+'Online Payment<br>'+ck(mop.indexOf('credit')>-1)+'Credit Card</td>'
     +'<td style="'+bd+';vertical-align:top">'+kv('Contact Person',r.payee_name)+'<br>'+kv('Contact Number',r.payee_contact||'')+'<br>'+kv('Email Address',r.payee_email||'')+'<br>'+kv('TIN',r.payee_tin||'')+'<br>'+kv('Vendor Code',r.vendor_code||'')+'<br>'+kv('Payment Currency',cur)+'</td></tr>'
     +bar('PARTICULARS')+'</table>'
     +'<table style="width:100%;border-collapse:collapse;font-size:10.5px"><tr style="background:#eef1f5">'
     +['Date','Invoice #','Cost Center','Particulars','GL Account','UoM','QTY','Unit Cost','Amount ('+esc(cur)+')'].map(function(h){return '<th style="'+bd+'">'+h+'</th>';}).join('')+'</tr>'+line
     +'<tr><td colspan="8" style="'+bd+';text-align:right;color:#333">Total</td><td style="'+bd+';text-align:right;font-weight:bold">'+money2(gross)+'</td></tr>'
     +'<tr><td colspan="8" style="'+bd+';text-align:right;color:#333">Less EWT</td><td style="'+bd+';text-align:right">'+money2(ewt)+'</td></tr>'
     +'<tr><td colspan="8" style="'+bd+';text-align:right;color:#333">NEW Total</td><td style="'+bd+';text-align:right;font-weight:bold">'+money2(net)+'</td></tr></table>'
     +'<div style="padding:4px 0;font-size:10px;color:#7a8194">for Accounting Only</div>'
     +'<div style="padding:2px 0;font-size:11px"><span style="color:#333">Additional Remarks:</span> '+esc(r.remarks||'')+'</div>'
     +'<table style="width:100%;border-collapse:collapse;margin-top:6px"><tr>'
     +sigCol('Requested by',nameOf('REQUESTOR',reqName),czd(r.request_date),'Requestor',markOf('REQUESTOR'))
     +sigCol('Reviewed By',nameOf('DEPARTMENT',r.department_approved_by||r.dept_head_by||''),czd(r.department_approved_at),'Department Head',markOf('DEPARTMENT'))
     // Finance checks before the head of Finance approves, so the form carries
     // both: "Checked By" and then "Approved By".
     +(signOf('FINANCE_REVIEW')
        ?sigCol('Checked By',nameOf('FINANCE_REVIEW',''),czd((signOf('FINANCE_REVIEW')||{}).created_at),'Finance & Accounting',markOf('FINANCE_REVIEW')):'')
     +sigCol('Approved By',nameOf('FINANCE',r.finance_validated_by||r.finance_by||''),czd(r.finance_validated_at),'Head of Finance & Accounting',markOf('FINANCE'))
     // The MANCOM block is printed only when the amount actually required that tier.
     +(signOf('MANCOM')
        ?sigCol('Approved By',nameOf('MANCOM',''),czd((signOf('MANCOM')||{}).created_at),'MANCOM',markOf('MANCOM')):'')
     +sigCol('Approved By',nameOf('FINAL',r.final_approved_by||r.ceo_by||''),czd(r.final_approved_at),'Chief Executive Officer',markOf('FINAL'))
     +'</tr></table>'
     +'<div style="text-align:center;font-size:9.5px;color:#7a8194;padding:8px 5px;margin-top:6px">E88 VENTURES INC. | 15 Brixton St., Kapitolyo, Pasig City 1603 Philippines</div>'
     +'<div style="margin-top:14px"><button onclick="window.print()" style="padding:8px 16px;background:#0a2239;color:#fff;border:0;border-radius:4px;cursor:pointer">Print this document</button></div>'
     +'<style>@media print{button{display:none}}</style></div></body></html>';
  }
  async function czPrintRfp(r){
    try{
      // Pull the e-signature trail so drawn and typed signatures print on the form.
      if(r&&r.id){try{var d=await api('/finance/payment-requests/'+r.id);r=Object.assign({},r,d.request||{},{__signatures:d.signatures||[]});}catch(e){}}
      var w=window.open('','_blank','width=1040,height=1000');
      if(!w){alert('Please allow pop-ups to print.');return;}
      w.document.write(czRfpDocHtml(r));w.document.close();
    }catch(e){if(typeof toast==='function')toast('Unable to print RFP','error');}
  }
  window.czPrintRfp=czPrintRfp;
  window.czPrintRequisition=czPrintRequisition;window.czPrintPickSlip=czPrintPickSlip;window.czPrintGRN=czPrintGRN;window.czPrintDelivery=czPrintDelivery;
  document.addEventListener('click',function(ev){
    var t=ev.target;if(!t||!t.closest)return;
    var pr=t.closest('[data-print-req]');if(pr){ev.preventDefault();ev.stopPropagation();czPrintRequisition(pr.getAttribute('data-print-req'));return;}
    var pp=t.closest('[data-print-pickslip]');if(pp){ev.preventDefault();ev.stopPropagation();czPrintPickSlip(pp.getAttribute('data-print-pickslip'));return;}
    var ppo=t.closest('[data-print-po]');if(ppo){ev.preventDefault();ev.stopPropagation();czPrintPO(ppo.getAttribute('data-print-po'));return;}
    var pg=t.closest('[data-print-grn]');if(pg){ev.preventDefault();ev.stopPropagation();czPrintGRN(pg.getAttribute('data-print-grn'));return;}
    var pd=t.closest('[data-print-dlv]');if(pd){ev.preventDefault();ev.stopPropagation();czPrintDelivery(pd.getAttribute('data-print-dlv'));return;}
  },true);

  /* generic row-inspector (Record / Print slip) removed per request */
  const esc2=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ---------- catalog overrides (data level, re-applied every render) ---------- */
  let BASE=null;
  function snapshotBase(){
    if(BASE)return;
    if(state.catalog&&state.catalog.groups&&state.catalog.groups.length){
      BASE=JSON.parse(JSON.stringify(state.catalog));
    }
  }
  function buildCatalog(){
    snapshotBase();
    if(!BASE)return;
    const groups=[];
    // existing groups (respect hide/rename/reorder + custom items)
    BASE.groups.forEach(g=>{
      const go=S.groups[g.code]||{};
      if(go.hidden)return;
      const items=[];
      (g.items||[]).forEach(it=>{
        const io=S.items[it.code]||{};
        if(io.hidden)return;
        items.push(Object.assign({},it,io.label?{label:io.label}:{}));
      });
      // custom items added into this group
      (S.added.items[g.code]||[]).forEach(ci=>{if(!ci.hidden)items.push(Object.assign({custom:true},ci));});
      // per-group item order
      const iord=(S.order.items||{})[g.code];
      if(iord)items.sort((a,b)=>(iord.indexOf(a.code)+1||999)-(iord.indexOf(b.code)+1||999));
      groups.push(Object.assign({},g,go.title?{title:go.title}:{},{items}));
    });
    // custom groups
    (S.added.groups||[]).forEach(cg=>{
      if((S.groups[cg.code]||{}).hidden)return;
      const items=(S.added.items[cg.code]||[]).filter(ci=>!ci.hidden).map(ci=>Object.assign({custom:true},ci));
      groups.push({code:cg.code,title:(S.groups[cg.code]||{}).title||cg.title,items,custom:true});
    });
    // group order
    if(S.order.groups)groups.sort((a,b)=>(S.order.groups.indexOf(a.code)+1||999)-(S.order.groups.indexOf(b.code)+1||999));
    state.catalog=Object.assign({},BASE,{groups});
  }

  /* ---------- branding ---------- */
  function applyBranding(){
    const b=S.branding||{};
    if(b.theme){document.documentElement.dataset.theme=b.theme;}
    const title=$('.launchpad-controls div:first-child span');
    if(title&&b.appTitle)title.textContent=b.appTitle;
    if(b.appTitle)document.title=b.appTitle;
    const foot=$('.enterprise-brand-secondary');
    if(foot&&b.footer)foot.textContent=b.footer;
    const primary=$('.enterprise-brand-primary');
    if(primary&&b.brandMark)primary.textContent=b.brandMark;
    if(b.logo){document.querySelectorAll('img[src*="logo"],.launchpad-controls img,.brand img').forEach(i=>{i.src=b.logo;});}
  }

  /* ---------- launchpad decoration (buttons + custom wiring + column count) ---------- */
  function decorateLaunchpad(){
    const controls=$('.launchpad-controls div:last-child');
    if(controls&&!controls.querySelector('#e88CustomizeBtn')){
      const s=document.createElement('button');s.id='e88SettingsBtn';s.textContent='⚙ Settings';
      const c=document.createElement('button');c.id='e88CustomizeBtn';c.textContent='✎ Customize';
      controls.insertBefore(c,controls.firstChild);controls.insertBefore(s,controls.firstChild);
      c.onclick=openCustomizer;s.onclick=openSettings;
    }
    // keep the module columns on a single row regardless of count
    const cols=$('.enterprise-columns');
    if(cols){const n=cols.children.length||11;cols.style.gridTemplateColumns=`repeat(${n},minmax(0,1fr))`;}
    // custom buttons -> friendly action instead of openWorkspace error
    $$('.enterprise-module-button[data-workspace^="custom-"]').forEach(btn=>{
      btn.onclick=()=>toast(`“${btn.textContent}” is a customized module (demo placeholder).`);
    });
    applyBranding();
  }

  /* ---------- wrap renderLaunchpad (same-module binding reassignment) ---------- */
  const _origRender=renderLaunchpad;
  renderLaunchpad=function(){
    buildCatalog();
    const r=_origRender.apply(this,arguments);
    try{decorateLaunchpad();}catch(e){console.warn('customize decorate',e);}
    return r;
  };

  /* ---------- customizer modal (launchpad editor) ---------- */
  function gTitle(code,fallback){return (S.groups[code]||{}).title||fallback;}
  function openCustomizer(){
    buildCatalog();
    const groups=state.catalog.groups;
    const rows=groups.map((g,i)=>`
      <div class="cz-row" data-g="${esc2(g.code)}">
        <div class="cz-move"><button data-mv="up" ${i===0?'disabled':''}>▲</button><button data-mv="down" ${i===groups.length-1?'disabled':''}>▼</button></div>
        <input class="cz-title" value="${esc2(g.title)}" data-g="${esc2(g.code)}">
        <span class="cz-count">${g.items.length} modules</span>
        <button class="cz-add" data-g="${esc2(g.code)}">+ module</button>
        <button class="cz-hide" data-g="${esc2(g.code)}">Hide</button>
      </div>`).join('');
    const hidden=[]
      .concat(BASE.groups.filter(g=>(S.groups[g.code]||{}).hidden).map(g=>['group',g.code,g.title]))
      .concat(BASE.groups.flatMap(g=>(g.items||[]).filter(it=>(S.items[it.code]||{}).hidden).map(it=>['item',it.code,it.label])));
    const hiddenHtml=hidden.length?`<div class="cz-hidden"><b>Hidden</b>${hidden.map(([t,code,label])=>`<button class="cz-show" data-t="${t}" data-code="${esc2(code)}">＋ ${esc2(label)}</button>`).join('')}</div>`:'';
    modal('Customize Blitz - ERP modules',`
      <style>
      .cz-toolbar{display:flex;gap:8px;margin-bottom:10px}.cz-toolbar input{flex:1;padding:7px;border:1px solid var(--line)}
      .cz-row{display:flex;align-items:center;gap:8px;padding:6px;border-bottom:1px solid var(--line)}
      .cz-row .cz-title{flex:1;padding:6px;border:1px solid var(--line)}
      .cz-move button,.cz-add,.cz-hide,.cz-show{border:1px solid var(--line);background:var(--panel);padding:4px 8px;border-radius:3px}
      .cz-count{color:var(--muted);font-size:11px;min-width:80px}
      .cz-hidden{margin-top:12px;padding:10px;background:var(--panel-2);border:1px solid var(--line)}
      .cz-hidden b{display:block;margin-bottom:6px;color:var(--muted);font-size:11px}
      .cz-show{margin:3px;color:#1669a7}
      </style>
      <div class="cz-toolbar"><input id="czNewGroup" placeholder="New column name (e.g. Treasury)"><button class="button" id="czAddGroup">Add column</button></div>
      <div id="czRows">${rows}</div>${hiddenHtml}
      <p style="color:var(--muted);font-size:11px;margin-top:10px">Changes save instantly and persist for your presentation.</p>
    `,'Add, rename, reorder, hide columns and modules');
    wireCustomizer();
  }
  function reopen(){openCustomizer();}
  function wireCustomizer(){
    const root=$('#modalBody');if(!root)return;
    root.querySelector('#czAddGroup').onclick=()=>{
      const v=root.querySelector('#czNewGroup').value.trim();if(!v)return;
      const code='custom-col-'+Date.now();
      S.added.groups.push({code,title:v});persist();renderLaunchpad();reopen();
    };
    root.querySelectorAll('.cz-title').forEach(inp=>{inp.onchange=()=>{
      const code=inp.dataset.g;S.groups[code]=Object.assign({},S.groups[code],{title:inp.value.trim()});persist();renderLaunchpad();
    };});
    root.querySelectorAll('.cz-hide').forEach(b=>{b.onclick=()=>{
      const code=b.dataset.g;S.groups[code]=Object.assign({},S.groups[code],{hidden:true});persist();renderLaunchpad();reopen();
    };});
    root.querySelectorAll('.cz-show').forEach(b=>{b.onclick=()=>{
      const {t,code}=b.dataset;
      if(t==='group')S.groups[code]=Object.assign({},S.groups[code],{hidden:false});
      else S.items[code]=Object.assign({},S.items[code],{hidden:false});
      persist();renderLaunchpad();reopen();
    };});
    root.querySelectorAll('.cz-add').forEach(b=>{b.onclick=()=>{
      const g=b.dataset.g;const name=prompt('New module button label:');if(!name)return;
      (S.added.items[g]=S.added.items[g]||[]).push({code:'custom-'+Date.now(),label:name});persist();renderLaunchpad();reopen();
    };});
    root.querySelectorAll('[data-mv]').forEach(b=>{b.onclick=()=>{
      const code=b.closest('.cz-row').dataset.g;const dir=b.dataset.mv;
      const order=(S.order.groups&&S.order.groups.length)?S.order.groups.slice():state.catalog.groups.map(g=>g.code);
      const i=order.indexOf(code);const j=dir==='up'?i-1:i+1;
      if(j<0||j>=order.length)return;order.splice(i,1);order.splice(j,0,code);
      S.order.groups=order;persist();renderLaunchpad();reopen();
    };});
  }

  /* ---------- settings / branding modal ---------- */
  function openSettings(){
    const b=S.branding||{};
    modal('Settings & Branding',`
      <div class="record-fields">
        <label class="record-field"><span>Application title</span><input id="stTitle" value="${esc2(b.appTitle||'Blitz - ERP')}"></label>
        <label class="record-field"><span>Footer text</span><input id="stFoot" value="${esc2(b.footer||'Finance Console · © 2026 AL23')}"></label>
        <label class="record-field"><span>Brand mark</span><input id="stMark" value="${esc2(b.brandMark||'E88')}"></label>
        <label class="record-field"><span>Theme</span><select id="stTheme"><option value="light" ${b.theme==='light'?'selected':''}>Light</option><option value="dark" ${b.theme==='dark'?'selected':''}>Dark</option></select></label>
        <label class="record-field full"><span>Logo URL (optional)</span><input id="stLogo" value="${esc2(b.logo||'')}" placeholder="/logo.png or https://…"></label>
      </div>
      <div class="modal-actions"><button class="button secondary" id="stReset">Reset all customization</button><button class="button" id="stSave">Save</button></div>
    `,'Applies live across the system');
    const r=$('#modalBody');
    r.querySelector('#stSave').onclick=()=>{
      S.branding={appTitle:r.querySelector('#stTitle').value.trim(),footer:r.querySelector('#stFoot').value.trim(),brandMark:r.querySelector('#stMark').value.trim(),theme:r.querySelector('#stTheme').value,logo:r.querySelector('#stLogo').value.trim()};
      if(S.branding.theme){localStorage.setItem('e88-theme',S.branding.theme);state.theme=S.branding.theme;}
      persist();$('#modal').classList.add('hidden');renderLaunchpad();toast('Settings saved');
    };
    r.querySelector('#stReset').onclick=()=>{
      if(!confirm('Reset all customization (columns, modules, branding, table columns)?'))return;
      localStorage.removeItem(LS);location.reload();
    };
  }

  /* ---------- table column customization (right-click a header) ---------- */
  function tableState(key){return S.tables[key]=S.tables[key]||{hidden:[],order:[]};}
  function applyTable(wrap){
    const key=wrap.getAttribute('data-table-key');if(!key)return;
    const st=S.tables[key];if(!st)return;
    const table=wrap.querySelector('table');if(!table)return;
    const ths=[...table.querySelectorAll('thead th')];
    const total=ths.length;
    // hide
    const setHidden=new Set(st.hidden||[]);
    function cells(tr){return [...tr.children];}
    [...table.querySelectorAll('tr')].forEach(tr=>{
      cells(tr).forEach((c,i)=>{c.style.display=setHidden.has(i)?'none':'';});
    });
    // reorder
    if(st.order&&st.order.length===total){
      [...table.querySelectorAll('tr')].forEach(tr=>{
        const cs=cells(tr);st.order.forEach(idx=>{if(cs[idx])tr.appendChild(cs[idx]);});
      });
    }
  }
  function columnMenu(wrap,thIndex,x,y){
    const key=wrap.getAttribute('data-table-key');const st=tableState(key);
    const ths=[...wrap.querySelectorAll('thead th')];
    document.querySelectorAll('.cz-colmenu').forEach(m=>m.remove());
    const menu=document.createElement('div');menu.className='cz-colmenu';
    menu.style.cssText=`position:fixed;left:${x}px;top:${y}px;z-index:200;background:var(--panel);border:1px solid var(--line);box-shadow:0 12px 30px rgba(0,0,0,.25);border-radius:5px;padding:8px;min-width:220px;max-height:60vh;overflow:auto;font-size:12px`;
    menu.innerHTML=`<b style="display:block;margin-bottom:6px">Columns</b>`+ths.map((th,i)=>`
      <label style="display:flex;align-items:center;gap:6px;padding:3px"><input type="checkbox" data-ci="${i}" ${(st.hidden||[]).includes(i)?'':'checked'}> ${esc2(th.textContent.replace(/[▲▼]/g,'').trim()||('Col '+(i+1)))}</label>`).join('')+
      `<div style="display:flex;gap:6px;margin-top:8px"><button data-mv="left" style="flex:1">◀ Move</button><button data-mv="right" style="flex:1">Move ▶</button></div>
       <button data-reset style="width:100%;margin-top:6px">Reset columns</button>`;
    document.body.appendChild(menu);
    menu.querySelectorAll('input[data-ci]').forEach(cb=>{cb.onchange=()=>{
      const i=+cb.dataset.ci;const h=new Set(st.hidden||[]);cb.checked?h.delete(i):h.add(i);st.hidden=[...h];persist();applyAllTables();
    };});
    menu.querySelector('[data-reset]').onclick=()=>{delete S.tables[key];persist();menu.remove();location.reload();};
    menu.querySelectorAll('[data-mv]').forEach(b=>{b.onclick=()=>{
      const order=(st.order&&st.order.length===ths.length)?st.order.slice():ths.map((_,i)=>i);
      const pos=order.indexOf(thIndex);const j=b.dataset.mv==='left'?pos-1:pos+1;
      if(j<0||j>=order.length)return;order.splice(pos,1);order.splice(j,0,thIndex);
      st.order=order;persist();menu.remove();applyAllTables();
    };});
    const close=e=>{if(!menu.contains(e.target)){menu.remove();document.removeEventListener('mousedown',close);}};
    setTimeout(()=>document.addEventListener('mousedown',close),0);
  }
  function wireTable(wrap){
    if(wrap.__czWired)return;wrap.__czWired=true;
    wrap.querySelectorAll('thead th').forEach((th,i)=>{
      th.title='Right-click to hide / reorder columns';
      th.addEventListener('contextmenu',ev=>{ev.preventDefault();columnMenu(wrap,i,ev.clientX,ev.clientY);});
    });
  }
  function applyAllTables(){$$('.record-table-wrap[data-table-key]').forEach(w=>{wireTable(w);applyTable(w);});}
  let _czTimer=null;
  function scheduleApply(){ if(_czTimer)return; _czTimer=setTimeout(()=>{_czTimer=null;try{applyAllTables();}catch(e){}},200); }
  const obs=new MutationObserver(muts=>{ if(muts.some(m=>m.addedNodes&&m.addedNodes.length))scheduleApply(); });
  obs.observe(document.body,{childList:true,subtree:true});

  // expose for debugging / advanced use
  // (removed) generic KPI-click per-class modal - each view now has its own inline analysis
  window.E88Custom={state:S,rebuild:buildCatalog,reset:()=>{localStorage.removeItem(LS);location.reload();}};
})();

/* ===================== BLITZ - ERP presentation layer ===================== */
(function(){
  var css=`
  :root{--blitz-1:#0a2239;--blitz-2:#123a63;--blitz-3:#1e88e5;--blitz-accent:#ffc400;}

  /* ---------- Login ---------- */
  #login{min-height:100vh;position:relative;overflow:hidden;background:radial-gradient(1200px 700px at 12% -10%,#1b4f8a 0%,transparent 60%),radial-gradient(900px 600px at 100% 110%,#0e6b8f 0%,transparent 58%),linear-gradient(135deg,#061423 0%,#0a2239 45%,#123a63 100%);background-size:200% 200%;animation:blitzDrift 18s ease-in-out infinite;}
  @keyframes blitzDrift{0%,100%{background-position:0% 50%,100% 50%,0% 50%}50%{background-position:100% 50%,0% 50%,100% 50%}}
  #login:before{content:"";position:absolute;inset:-40% -20%;background:conic-gradient(from 0deg,transparent 0deg,rgba(30,136,229,.16) 40deg,transparent 90deg,rgba(255,196,0,.10) 160deg,transparent 220deg);animation:blitzSpin 26s linear infinite;pointer-events:none}
  @keyframes blitzSpin{to{transform:rotate(360deg)}}
  #authContent{position:relative;z-index:2}
  /*
   * BLITZ - ERP as the room rather than a line on the card: set huge and very
   * faint behind everything, so the name is present without competing with
   * the one thing on screen you are meant to do.
   */
  #login:after{content:"BLITZ - ERP";position:absolute;inset:0;z-index:1;display:flex;
    align-items:center;justify-content:center;pointer-events:none;user-select:none;
    font-size:clamp(64px,17vw,260px);font-weight:800;letter-spacing:.06em;white-space:nowrap;
    color:transparent;-webkit-text-stroke:1px rgba(255,255,255,.055);
    background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.012));
    -webkit-background-clip:text;background-clip:text;
    animation:blitzMarkDrift 24s ease-in-out infinite}
  @keyframes blitzMarkDrift{0%,100%{transform:translateY(-6px) scale(1)}50%{transform:translateY(6px) scale(1.015)}}
  @media (prefers-reduced-motion:reduce){#login:after{animation:none}}
  /* the shell card is replaced by the Blitz card below */
  #login .auth-card{background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important;width:auto!important;max-width:none!important}
  #login .auth-brand,#login .auth-copyright{display:none!important}
  /*
   * The sign-in card.
   *
   * Glass on the animated deep-navy field rather than a white slab: the card
   * belongs to the background instead of sitting on top of it. Everything is
   * centred and every child shares one horizontal padding - the heading used
   * to reset its own to zero, which is why 'Sign in' hung outside the box.
   */
  .blitz-auth{width:min(430px,92vw);margin:0 auto;border-radius:22px;overflow:hidden;
    background:linear-gradient(180deg,rgba(23,52,84,.78),rgba(11,28,48,.86));
    border:1px solid rgba(255,255,255,.13);
    box-shadow:0 34px 80px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.10);
    backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
    animation:blitzRise .5s cubic-bezier(.2,.8,.25,1) both;color:#eaf2fb}
  /* One padding for every child, the brand block included. */
  .blitz-auth>*{padding-left:28px;padding-right:28px}
  .blitz-auth>.auth-links{padding-bottom:14px}
  @keyframes blitzRise{from{opacity:0;transform:translateY(18px) scale(.98)}to{opacity:1;transform:none}}
  .blitz-auth-brand{text-align:center;padding-top:34px;padding-bottom:4px;color:#fff;position:relative}
  .blitz-auth-brand:after{content:"";position:absolute;left:50%;top:-46px;width:220px;height:110px;
    transform:translateX(-50%);pointer-events:none;
    background:radial-gradient(closest-side,rgba(120,190,255,.40),transparent);
    animation:blitzGlow 5s ease-in-out infinite}
  @keyframes blitzGlow{0%,100%{opacity:.55;transform:translateX(-50%) translateY(4px)}
    50%{opacity:1;transform:translateX(-50%) translateY(-4px)}}
  /* Sized against the card, not a fixed pixel height, so it scales with the
     card on a phone and cannot be shrunk by a stray image rule. */
  .blitz-auth-brand .blitz-mark{display:block;position:relative;z-index:1;margin:0 auto;
    width:min(210px,62%);height:auto;max-height:none;object-fit:contain;
    animation:blitzMark .7s cubic-bezier(.2,.8,.25,1) both}
  @keyframes blitzMark{from{opacity:0;transform:translateY(-6px) scale(.94)}to{opacity:1;transform:none}}
  .blitz-wordmark{position:relative;z-index:1;margin:14px 0 0;font-size:25px;letter-spacing:2px;font-weight:800;color:#fff;text-transform:uppercase}
  .blitz-wordmark i{font-style:normal;color:#5cb0f7}
  .blitz-tagline{position:relative;z-index:1;margin:4px 0 0;font-size:10.5px;letter-spacing:2.5px;text-transform:uppercase;color:rgba(255,255,255,.55)}

  /* The heading keeps the card's padding rather than resetting it. */
  .blitz-auth .auth-heading{padding-top:18px;padding-bottom:14px;text-align:center}
  .blitz-auth .auth-heading h1{margin:0;font-size:23px;font-weight:700;color:#fff;letter-spacing:-.2px}
  .blitz-auth .auth-heading p{margin:5px 0 0;font-size:12.5px;color:rgba(234,242,251,.62)}

  /* Fields sit on the glass, not on white. */
  .blitz-auth .auth-field span{color:rgba(234,242,251,.72);font-size:11.5px;font-weight:600}
  .blitz-auth .auth-field input{min-height:48px;padding:12px 14px;border-radius:12px;
    border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;font-size:14px}
  .blitz-auth .auth-field input::placeholder{color:rgba(234,242,251,.35)}
  .blitz-auth .auth-field input:focus{outline:none;border-color:#5cb0f7;
    background:rgba(255,255,255,.10);box-shadow:0 0 0 3px rgba(92,176,247,.20)}
  .blitz-auth .auth-submit{min-height:48px;margin-top:8px;border:0;border-radius:12px;font-size:14.5px;font-weight:700;
    background:linear-gradient(180deg,#3d9bf0,#1e6fc4);color:#fff;
    box-shadow:0 8px 20px rgba(30,111,196,.38);transition:transform .16s ease,box-shadow .16s ease}
  .blitz-auth .auth-submit:hover{transform:translateY(-1px);box-shadow:0 12px 26px rgba(30,111,196,.46)}
  .blitz-auth .auth-submit:disabled{opacity:.6;transform:none;box-shadow:none}
  .blitz-auth .auth-message{color:#ffb4ad;text-align:center}
  .blitz-auth .auth-message.info{color:#8fc9ff}
  .blitz-auth .auth-links{border-top:1px solid rgba(255,255,255,.10);padding-top:16px}
  .blitz-auth .auth-links button{color:#8fc9ff;font-size:12.5px}
  .blitz-auth .auth-links button:hover{color:#bfe0ff;text-decoration:underline}
  .blitz-auth .password-rule{color:rgba(234,242,251,.5)}

  /* Administration is the exception, so it reads as one rather than as half
     of a choice you have to make every morning. */
  .blitz-scope-note{padding-top:0;padding-bottom:22px;text-align:center}
  .blitz-scope-note button{display:inline-flex;align-items:center;gap:8px;padding:7px 14px;
    border:1px solid rgba(255,255,255,.16);border-radius:999px;background:rgba(255,255,255,.04);
    color:rgba(234,242,251,.72);font-size:12px;cursor:pointer;transition:all .16s ease}
  .blitz-scope-note button:hover{border-color:rgba(255,255,255,.3);color:#fff}
  .blitz-scope-note button .dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.25)}
  .blitz-scope-note button.on{border-color:var(--blitz-accent);color:#ffe08a;background:rgba(255,196,0,.10)}
  .blitz-scope-note button.on .dot{background:var(--blitz-accent)}
  .blitz-auth.is-admin{border-color:rgba(255,196,0,.34);box-shadow:0 34px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,196,0,.18)}

  .blitz-charge{position:relative;z-index:1;display:flex;gap:5px;justify-content:center;margin-top:14px}
  .blitz-charge i{width:26px;height:4px;border-radius:3px;background:rgba(255,255,255,.25);animation:blitzCharge 1.6s ease-in-out infinite}
  .blitz-charge i:nth-child(2){animation-delay:.12s}.blitz-charge i:nth-child(3){animation-delay:.24s}
  .blitz-charge i:nth-child(4){animation-delay:.36s}.blitz-charge i:nth-child(5){animation-delay:.48s}
  @keyframes blitzCharge{0%,100%{background:rgba(255,255,255,.25)}50%{background:#4fa8f5;box-shadow:0 0 10px rgba(79,168,245,.7)}}
  /* Two equal cards on one row. align-items:stretch plus a fixed min-height keeps
     them the same size whether or not the label wraps. */
  /* Physical count: a unit the system has never seen is normal during an
     opening count, so it reads as progress, not as an error. */
  .mr-newunit{border:1px solid #dbe4ee;border-radius:10px;padding:8px 10px;margin:8px 0;background:#fbfcfe}
  .mr-newunit summary{cursor:pointer;font-weight:600;font-size:12.5px;color:var(--blitz-1)}
  .mr-newunit label{display:block;margin-top:8px;font-size:11.5px}
  .mr-newunit label span{display:block;color:#5a6577;margin-bottom:2px}
  .mr-newunit label i{color:#8b97a8;font-style:italic}
  .mr-newunit input,.mr-newunit select{width:100%;padding:8px 9px;border:1px solid #dbe4ee;border-radius:8px;font-size:13px}
  /* A counted row that still needs identifying stands out on the sheet. */
  /* Count sheet upload preview */
  .cu-summary{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
  .cu-chip{font-size:11px;padding:3px 9px;border-radius:999px;background:#eef2f7;color:#42506a}
  .cu-chip.good{background:#e9f8ee;color:#1d6b39}.cu-chip.new{background:#e8f2fe;color:#12508f}
  .cu-chip.warn{background:#fff6e5;color:#7a5300}.cu-chip.bad{background:#fdecec;color:#8f2226}
  .cu-table{max-height:320px;overflow:auto;border:1px solid #e3e9f1;border-radius:8px}
  .cu-table tr.bad td{background:#fdf3f3}.cu-table tr.warn td{background:#fffaf0}
  .cu-table tr.new td{background:#f4f9ff}

  /* Mobile tile launcher */
  .mtile-wrap{padding:14px}
  .mtile-head h2{margin:0;font-size:19px;color:var(--blitz-1)}
  .mtile-head span{font-size:11.5px;color:#7c8b9c;text-transform:uppercase;letter-spacing:.6px}
  .mtile-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
  .mtile{position:relative;display:flex;flex-direction:column;gap:6px;align-items:flex-start;
    min-height:132px;padding:14px;border:0;border-radius:14px;color:#fff;text-align:left;cursor:pointer;
    box-shadow:0 2px 10px rgba(10,34,57,.16)}
  .mtile svg{width:34px;height:34px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;opacity:.95}
  .mtile b{font-size:15px;line-height:1.15}
  .mtile small{font-size:11.5px;opacity:.9;line-height:1.25}
  .mtile-go{position:absolute;right:12px;bottom:10px;font-size:22px;font-style:normal;opacity:.85}
  .mtile.orange{background:linear-gradient(140deg,#f08a24,#e0741a)}
  .mtile.slate{background:linear-gradient(140deg,#3d4854,#2b333c)}
  .mtile.green{background:linear-gradient(140deg,#4aa564,#358a4d)}
  .mtile.blue{background:linear-gradient(140deg,#2a86dd,#1a68b5)}
  .mtile-full{width:100%;margin-top:14px}
  /* Sales order lines */
  .so-lines-head{display:flex;align-items:center;justify-content:space-between;
    margin-top:6px;padding-bottom:4px;border-bottom:1px solid #e3e9f1}
  .so-lines-head span{font-size:11px;font-weight:700;color:#42576a;text-transform:uppercase;letter-spacing:.5px}
  .sales-line{display:grid;grid-template-columns:1.4fr 1.4fr 70px 110px 32px;gap:6px;margin-top:6px}
  .sales-line select,.sales-line input{min-height:34px;padding:6px 8px;border:1px solid #c6d3de;border-radius:4px;min-width:0}
  .so-total{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:8px;
    padding-top:8px;border-top:1px solid #e3e9f1}
  .so-total span{font-size:11px;font-weight:700;color:#42576a;text-transform:uppercase;letter-spacing:.5px}
  .so-total b{font-size:17px;color:#0a2239;font-variant-numeric:tabular-nums}
  @media (max-width:720px){.sales-line{grid-template-columns:1fr 1fr;gap:5px}}

  /* ---------- Landing cockpit ---------- */
  .home-shell{max-width:1320px;margin:0 auto;padding:18px 20px 30px}
  .home-top{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:18px}
  .home-brand{display:flex;align-items:center;gap:11px}
  .home-brand img{height:40px;width:auto}
  .home-brand b{display:block;font-size:19px;letter-spacing:1.4px;color:#0a2239;text-transform:uppercase}
  .home-brand b i{font-style:normal;color:#1e88e5}
  .home-brand small{display:block;font-size:10.5px;letter-spacing:1.6px;color:#7c8b9c;text-transform:uppercase}
  .home-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .home-scope{padding:5px 11px;border:1px solid #cfdbe6;border-radius:999px;background:#fff;color:#42506a;font-size:11px}
  .home-open{font-weight:700}
  .home-hello{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:0 0 16px}
  .home-range{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .home-range-presets{display:flex;gap:4px}
  .home-range-presets button{padding:6px 11px;border:1px solid #d8e2ea;border-radius:999px;background:#fff;
    color:#42506a;font-size:11.5px;cursor:pointer}
  .home-range-presets button:hover{border-color:#a9c3d6}
  .home-range-presets button.on{background:#0a2239;border-color:#0a2239;color:#fff;font-weight:700}
  .home-range-dates{display:flex;align-items:center;gap:6px}
  .home-range-dates input{min-height:32px;padding:5px 8px;border:1px solid #d8e2ea;border-radius:8px;font-size:12px}
  .home-range-dates span{font-size:11.5px;color:#7c8b9c}
  .home-range-dates .command{min-height:32px;padding:5px 12px;font-size:12px}
  @media (max-width:720px){.home-hello{align-items:flex-start}.home-range{width:100%}
    .home-range-dates{width:100%}.home-range-dates input{flex:1;min-width:0}}
  .home-hello h1{margin:0;font-size:27px;color:#0a2239;letter-spacing:-.3px}
  .home-hello p{margin:3px 0 0;color:#7c8b9c;font-size:12.5px}

  .home-waiting{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:9px;margin-bottom:14px}
  .home-wait{display:flex;align-items:center;gap:12px;padding:14px 16px;border:1px solid #e8eef4;
    border-radius:10px;background:#fff;text-align:left;cursor:pointer;
    box-shadow:0 1px 2px rgba(10,34,57,.05),0 4px 14px rgba(10,34,57,.05);
    transition:transform .16s ease,box-shadow .16s ease}
  .home-wait:hover{transform:translateY(-2px);box-shadow:0 2px 4px rgba(10,34,57,.06),0 10px 24px rgba(10,34,57,.10)}
  .home-wait b{font-size:26px;font-weight:700;color:#0a2239;line-height:1}
  .home-wait span{flex:1;font-size:12.5px;color:#42506a;line-height:1.3}
  .home-wait i{font-style:normal;font-size:20px;color:#9fb0c0}
  .home-clear{margin-bottom:14px;padding:14px 16px;border:1px solid #e8eef4;border-radius:10px;
    background:#fff;color:#42506a;font-size:12.5px;
    box-shadow:0 1px 2px rgba(10,34,57,.05),0 4px 14px rgba(10,34,57,.05)}

  .home-grid{margin-bottom:14px}
  .home-foot{display:flex;justify-content:space-between;margin-top:18px;padding-top:12px;
    border-top:1px solid #e2e9f0;color:#9fb0c0;font-size:11px}
  @keyframes homeRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  @media (max-width:720px){
    .home-shell{padding:14px}
    .home-hello h1{font-size:21px}
    .home-waiting{grid-template-columns:1fr}
    .home-top{align-items:flex-start}
  }

  /* Activation / reset: say whether the email actually left. */
  .cred-sent{margin:0 0 10px;padding:9px 11px;border-radius:6px;background:#e9f8ee;color:#1d6b39;font-size:12.5px}
  .cred-failed{margin:0 0 10px;padding:9px 11px;border-radius:6px;background:#fdecec;color:#8f2226;font-size:12.5px}
  .cred-hint{margin:0 0 6px;color:#657586;font-size:11.5px}
  .mtile-back{display:block;width:100%;text-align:left;margin:0 0 12px;padding:10px 12px;border:1px solid #d7e0ea;
    border-radius:10px;background:#f5f8fb;color:var(--blitz-1);font-size:14px;font-weight:600;cursor:pointer}
  .mtile-home-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
  .mtile-brand{display:flex;align-items:center;gap:9px;min-width:0}
  .mtile-brand img{height:34px;width:auto}
  .mtile-brand b{display:block;font-size:16px;color:var(--blitz-1)}
  .mtile-brand b i{font-style:normal;color:#1e88e5}
  .mtile-brand small{display:block;font-size:11px;color:#7c8b9c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46vw}
  .mtile-signout{flex:0 0 auto;padding:8px 12px;border:1px solid #d7e0ea;border-radius:8px;background:#fff;color:#42506a;font-size:12.5px}
  @media (min-width:721px){.mtile-wrap,.mtile-back{display:none}}
  .row-needs-item{background:#fffaf0}
  .needs-item{color:#b06f00;font-weight:600;font-size:11.5px}
  .table-action.danger{color:#a4282b;border-color:#e7c3c4}
  .table-action.danger:hover{background:#fdf2f2}
  .mr-status.warn{background:#fff6e5;color:#7a5300}
  .mr-item.new{border-left:3px solid #1e88e5}
  .mr-item.warn{border-left:3px solid #e8a33d}
  .auth-submit{background:linear-gradient(135deg,var(--blitz-2),var(--blitz-3));border:0}

  /* ---------- Launchpad brand ---------- */
  .launchpad-brand{display:flex;align-items:center;gap:10px}
  .launchpad-brand .brand-logo{height:36px;width:auto;background:transparent}
  .launchpad-brand .brand-name{font-weight:800;letter-spacing:1.6px;text-transform:uppercase;font-size:16px}
  .launchpad-brand .brand-name i{font-style:normal;color:var(--blitz-3)}
  .launchpad-brand .brand-sub{color:#8496a8;font-size:10.5px;letter-spacing:1.4px;text-transform:uppercase;margin-left:2px}
  .scope-chip{border:1px solid var(--blitz-3)!important;color:var(--blitz-3)!important;font-weight:700}

  /* ---------- Freeze the module rail ---------- */
  /* one row of 11 categories, as before; align-items:start is what freezes them */
  .enterprise-columns{display:grid!important;grid-template-columns:repeat(11,minmax(0,1fr))!important;align-items:start!important;gap:4px}
  .enterprise-column{align-self:start}
  .launchpad-controls{position:sticky;top:0;z-index:30;backdrop-filter:blur(6px)}
  .workbench-headwrap{position:sticky;top:0;z-index:25;background:var(--panel,#fff);box-shadow:0 2px 10px rgba(10,34,57,.07)}
  #nav{position:sticky;top:0;max-height:100vh;overflow:auto}

  /* ---------- Clickable KPI cards ---------- */
  .workspace-kpi.is-clickable{cursor:pointer;transition:transform .13s ease,box-shadow .13s ease,border-color .13s ease;position:relative}
  .workspace-kpi.is-clickable:hover{transform:translateY(-2px);box-shadow:0 10px 22px rgba(10,34,57,.14);border-color:var(--blitz-3)}
  .workspace-kpi.is-clickable:after{content:"\\2197";position:absolute;top:7px;right:9px;font-size:11px;color:#a9b8c8;opacity:0;transition:.13s}
  .workspace-kpi.is-clickable:hover:after{opacity:1}
  .workspace-kpi.is-clickable:focus-visible{outline:2px solid var(--blitz-3);outline-offset:2px}

  /* ---------- Instructional notes removed everywhere ---------- */
  .form-note,.password-rule,.control-note,.oe-detail,.ramco-rail .definition-list{display:none!important}

  /* ---------- Signatures, attachments, pickers ---------- */
  .sig-typed{font-family:"Segoe Script","Brush Script MT",cursive!important;font-size:22px!important;color:#15294B;letter-spacing:.5px}
  .sig-field{margin:6px 0 2px}
  .sig-field .sig-label{display:block;font-size:11px;font-weight:700;color:#556;margin-bottom:5px}
  .sig-field .sig-tabs{display:flex;gap:6px;margin-bottom:6px}
  .sig-field .sig-tabs .table-action.active{background:#123a63;color:#fff;border-color:#123a63}
  .po-sigpad{display:block;width:100%;max-width:460px;height:150px;border:1.5px dashed #b6c6d6;border-radius:8px;background:#fcfdff;touch-action:none;cursor:crosshair}
  .sig-draw{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
  .sig-type input{width:100%;max-width:460px}
  .po-doc-list{display:flex;flex-wrap:wrap;gap:6px;padding:6px 0}
  .po-doc-chip{display:inline-flex;align-items:center;gap:6px;background:#eef4fb;border:1px solid #cfe0f2;border-radius:14px;padding:3px 10px;font-size:11.5px}
  .po-doc-chip button{border:0;background:none;cursor:pointer;color:#8093a6;font-size:13px;line-height:1}
  .po-doc-empty{font-size:11.5px;color:#93a3b4}
  .pick-with-add{display:flex;gap:6px;align-items:center}
  .pick-with-add select{flex:1}
  .ramco-layout.single{grid-template-columns:1fr!important;display:grid}

  /* ---------- Administration scope: configure, never approve ---------- */
  body.scope-admin [data-workbench-section="approvals"],
  body.scope-admin [data-section="approvals"],
  body.scope-admin [data-approve-po],body.scope-admin [data-approve-sales],
  body.scope-admin [data-approve-requisition],body.scope-admin [data-rfp-action],
  body.scope-admin [data-release-delivery]{display:none!important}

  /* ---------- Mobile receiving / counting ---------- */
  .mobile-receive{display:flex;flex-direction:column;gap:10px}
  .mobile-receive .mr-head label{display:block;font-size:11px;font-weight:700;color:#556}
  .mobile-receive .mr-head select{width:100%;min-height:42px}
  .mr-counter{display:flex;align-items:baseline;gap:8px;justify-content:center;padding:6px 0}
  .mr-counter b{font-size:40px;line-height:1;color:var(--blitz-1)}
  .mr-counter span{font-size:12px;color:#7c8b9c}
  .mr-status{padding:10px 12px;border-radius:8px;background:#eef4fb;border:1px solid #d5e3f2;font-size:13px;min-height:44px}
  .mr-status.good{background:#e9f8ee;border-color:#bde5c9}
  .mr-status.bad{background:#fdeceb;border-color:#f3c4c0}
  .mobile-receive input{min-height:44px;font-size:16px;width:100%}
  .mr-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .mr-big{min-height:54px;font-size:15px;font-weight:700}
  .mr-list{max-height:240px;overflow:auto;display:flex;flex-direction:column;gap:4px}
  .mr-item{display:flex;justify-content:space-between;gap:10px;padding:6px 10px;border-radius:6px;font-size:12px}
  .mr-item.good{background:#f1faf4;border-left:3px solid #35a25c}
  .mr-item.bad{background:#fdf2f1;border-left:3px solid #d9544a}
  .mr-empty{padding:10px;text-align:center;color:#93a3b4;font-size:12px}

  /* ---------- ATLAS expected units ---------- */
  small.atlas-key{display:block;font-size:10px;color:#93a3b4;font-weight:400;letter-spacing:.2px}
  .chip-mini{display:inline-block;background:#eef4fb;border:1px solid #cfe0f2;border-radius:10px;padding:0 6px;font-size:10px;color:#4b6b8a}

  /* ---------- Service Management ---------- */
  .svc-job .record-fields{margin-bottom:10px}
  .svc-labor-line{display:grid;grid-template-columns:1.4fr 1fr .6fr .7fr auto;gap:6px}
  .svc-used-line,.svc-ret-line{display:grid;grid-template-columns:1.6fr .7fr auto;gap:8px;align-items:center}
  .svc-ret-line{grid-template-columns:1.6fr .7fr 1fr}
  .used-label{font-size:12px;color:#33475b}
  .used-of{font-size:11px;color:#93a3b4}
  .ret-pick{display:flex;align-items:center;gap:6px;font-size:12px}
  .rd-line{display:grid;grid-template-columns:1fr 1fr 1fr 1.2fr;gap:6px}

  /* ---------- Mobile / tablet ---------- */
  @media (max-width:900px){
    .enterprise-columns{grid-template-columns:1fr!important}
    .ramco-layout{display:block!important}
    .ramco-rail{margin-top:14px}
    .workspace-kpis{display:grid!important;grid-template-columns:repeat(2,1fr)!important;gap:8px}
    .workspace-kpi strong{font-size:18px}
    .operational-form.grid{display:grid!important;grid-template-columns:1fr!important}
    .operational-form .wide{grid-column:1/-1}
    .record-fields{display:grid!important;grid-template-columns:1fr!important}
    .record-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
    .record-table{min-width:620px}
    .workbench-tabs{overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch}
    .workbench-tabs button{flex:0 0 auto}
    .launchpad-controls{flex-wrap:wrap;gap:6px}
    .line-editor-row,.po-line,.requisition-line,.sales-line,.svc-labor-line,.svc-used-line,.svc-ret-line,.rd-line,.liq-line{display:grid!important;grid-template-columns:1fr!important;gap:6px}
    .mr-actions{grid-template-columns:1fr}
    .mr-big{min-height:60px}
    .modal-card,#modalBody{width:96vw!important;max-width:96vw!important}
    button,.command,.table-action{min-height:38px}
    input,select,textarea{font-size:16px}
  }
  @media (max-width:560px){
    .workspace-kpis{grid-template-columns:1fr!important}
    .blitz-wordmark{font-size:25px}
  }
  `;
  var el=document.createElement('style');el.id='blitz-erp-style';el.textContent=css+VIZ_CSS;
  document.head.appendChild(el);
  try{document.title='Blitz - ERP';}catch(e){}
  document.addEventListener('DOMContentLoaded',function(){try{document.title='Blitz - ERP';}catch(e){}});
  // KPI cards rendered outside bindWorkbench still become interactive
  var kpiTimer=null;
  var kpiObs=new MutationObserver(function(){
    if(kpiTimer)return;
    kpiTimer=setTimeout(function(){kpiTimer=null;try{if(typeof bindKpiCards==='function')bindKpiCards();}catch(e){}},150);
  });
  kpiObs.observe(document.body||document.documentElement,{childList:true,subtree:true});
})();
