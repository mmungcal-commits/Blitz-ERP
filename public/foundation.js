const FOUNDATION_BUILD='E88-FULL-ERP-20260731-R5';
const state={
  session:null,
  catalog:{groups:[],tools:[],addons:[]},
  workspaceAccess:[],
  module:null,
  definition:null,
  section:'center',
  inbound:{preview:null,receiptLines:[],shipment:null,locationId:null},
  cycleCount:null,
  scannerStream:null,
  theme:localStorage.getItem('e88-theme')||'light',
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
  if(!value)return'—';
  const parsed=new Date(value);
  return Number.isNaN(parsed.getTime())?esc(value):parsed.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
}
function money(value){
  const number=Number(value||0);
  return new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(number);
}
function statusBadge(value='DRAFT'){
  const status=String(value).toUpperCase();
  const tone=/APPROVED|POSTED|CLOSED/.test(status)?'good':/CANCELLED|REJECTED/.test(status)?'bad':/FOR_APPROVAL|PENDING/.test(status)?'warn':'info';
  return `<span class="status ${tone}">${esc(status.replaceAll('_',' '))}</span>`;
}
async function api(path,options={}){
  const response=await fetch('/api'+path,{
    ...options,
    credentials:'same-origin',
    headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(options.headers||{})},
  });
  const data=await response.json().catch(()=>({ok:false,error:`HTTP ${response.status}`}));
  if(!response.ok||!data.ok){
    const error=new Error(data.error||`Request failed (${response.status})`);
    error.status=response.status;
    throw error;
  }
  return data;
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
    ...state.catalog.tools.map(item=>({...item,groupCode:'tools',groupTitle:'Enterprise Tools',type:'tool'})),
    ...state.catalog.addons.map(item=>({...item,groupCode:'addons',groupTitle:'Enterprise Add-ons',type:'addon'})),
  ];
}
function moduleByCode(code){return moduleList().find(module=>module.code===code);}
function can(permission,action='VIEW'){
  if(state.session?.user?.role==='ADMIN')return true;
  const row=(state.session?.permissions||[]).find(value=>value.module===permission);
  return !!row?.[`can_${action.toLowerCase()}`];
}
function canWorkspace(code){
  return state.session?.user?.role==='ADMIN'||state.workspaceAccess.includes(code);
}
function workspaceTabs(code=state.module?.code){
  if(code==='fa-general-accounting')return [
    ['center','Accounting Center'],['records','Journals'],['approvals','Approvals'],
    ['reports','Financial Reports'],['setup','Accounts & Periods'],
  ];
  if(code==='fa-receivables-payables')return [
    ['center','AR/AP Center'],['records','Subledgers'],['approvals','RFP & Payments'],
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
    'sd-order-management':[['center','Order Center'],['records','Sales Orders'],['approvals','Order Approval'],['reports','Order Analytics'],['setup','Order Controls']],
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
    host.innerHTML=`<div class="auth-heading"><h1>Sign in</h1><p>E88 Enterprise System</p></div>
      <form id="loginForm" class="auth-form">
        ${authField('Corporate email','email','email',email,'autocomplete="username" placeholder="name@nrdev.ph" required')}
        ${authField('Password','password','password','','autocomplete="current-password" required')}
        <button class="button auth-submit">Sign in</button>
      </form>
      <div id="authMessage" class="auth-message"></div>
      <div class="auth-links"><button type="button" data-auth="activate">Activate account</button><button type="button" data-auth="reset">Reset password</button></div>`;
    $('#loginForm').onsubmit=async event=>{
      event.preventDefault();
      const button=event.currentTarget.querySelector('button');
      button.disabled=true;
      authMessage('Signing in…','info');
      try{
        await api('/auth/login',{method:'POST',body:JSON.stringify(formDataObject(event.currentTarget))});
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
    state.catalog=state.session.workspaceCatalog||{groups:[],tools:[],addons:[]};
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
function renderLaunchpad(){
  state.module=null;
  state.definition=null;
  state.section='center';
  document.body.classList.remove('workbench-view');
  document.body.classList.add('launchpad-view');
  content.innerHTML=`<section class="enterprise-launchpad">
    <div class="launchpad-controls">
      <div><img src="/logo.png" alt="E88"><span>Enterprise Modules</span></div>
      <div><span>${esc(state.session.user.displayName||state.session.user.email)}</span>${state.session.user.role==='ADMIN'?'<button id="launchAccess">User Access</button>':''}<button id="launchLogout">Sign out</button></div>
    </div>
    <div class="enterprise-map">
      <div class="enterprise-columns">${state.catalog.groups.map(group=>`<section class="enterprise-column">
        <div class="enterprise-category">${esc(group.title)}</div>
        <div class="enterprise-module-stack">${group.items.map(item=>enterpriseButton(item)).join('')}</div>
      </section>`).join('')}</div>
      <div class="enterprise-tools">${state.catalog.tools.map(item=>enterpriseButton(item,'enterprise-tool-button')).join('')}</div>
      <div class="enterprise-addons-title"><span>Enterprise Add-ons</span></div>
      <div class="enterprise-addons">${state.catalog.addons.map(item=>enterpriseButton(item,'enterprise-addon-button')).join('')}</div>
      <footer class="enterprise-brand-strip">
        <div class="enterprise-brand-primary">E88</div>
        <div class="enterprise-brand-secondary">Enterprise System · © 2026 AL23</div>
      </footer>
    </div>
  </section>`;
  $$('[data-workspace]').forEach(button=>button.onclick=()=>openWorkspace(button.dataset.workspace));
  $('#launchLogout').onclick=logout;
  if($('#launchAccess'))$('#launchAccess').onclick=renderAccessAdmin;
}

function renderSidebar(){
  const module=state.module;
  const icons={center:'▦',records:'☷',approvals:'✓',reports:'▥',setup:'⚙'};
  const items=workspaceTabs(module.code).map(([section,label])=>[section,label,icons[section]]);
  $('#nav').innerHTML=`<button class="nav-home" id="moduleHome">← Enterprise Modules</button>
    <div class="nav-group">${esc(module.groupTitle)}</div>
    ${items.map(([section,label,icon])=>`<button class="nav-item ${state.section===section?'active':''}" data-section="${section}"><span class="nav-icon">${icon}</span>${label}</button>`).join('')}
    ${state.session.user.role==='ADMIN'?'<div class="nav-group">System</div><button class="nav-item" id="sidebarAccess"><span class="nav-icon">♙</span>User Access</button>':''}`;
  $('#moduleHome').onclick=renderLaunchpad;
  $$('[data-section]').forEach(button=>button.onclick=()=>openSection(button.dataset.section));
  if($('#sidebarAccess'))$('#sidebarAccess').onclick=renderAccessAdmin;
}
function setHeader(title,subtitle=''){
  $('#pageTitle').textContent=title;
  $('#pageSubtitle').textContent=subtitle;
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
  await openSection('center');
}
async function openSection(section){
  if(!state.module)return renderLaunchpad();
  state.section=section;
  renderSidebar();
  if(state.module.code.startsWith('fa-'))return renderFinanceWorkspace(section);
  if(state.module.code==='ip-inbound-logistics')return renderInboundWorkspace(section);
  if(state.module.code==='ip-warehouse-management')return renderWarehouseWorkspace(section);
  if(state.module.code==='ip-cycle-counting')return renderCycleWorkspace(section);
  if(state.module.code==='ip-inventory-analysis')return renderInventoryAnalysisWorkspace(section);
  if(state.module.code==='sd-outbound-logistics')return renderOutboundWorkspace(section);
  if(state.module.code==='sd-order-management')return renderSalesOrderWorkspace(section);
  if(state.module.code==='ip-sourcing-purchasing')return renderSourcingWorkspace(section);
  return renderConnectedModuleWorkspace(section);
}
function kpi(label,value){
  return `<article class="workspace-kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`;
}
function workbenchShell(body,active=state.section){
  const module=state.module;
  const user=state.session.user;
  const tabs=workspaceTabs(module.code);
  return `<section class="erp-workbench">
    <header class="workbench-systembar">
      <div><button class="workbench-home" title="Enterprise Modules">▦</button><span class="workbench-user-dot">●</span><b>${esc(user.displayName||user.email)}</b><small>${esc(user.role)}</small></div>
      <div><span>INTERNAL</span><button class="workbench-home">Modules</button><button class="workbench-logout">Sign out</button></div>
    </header>
    <div class="workbench-modulebar">
      <div><span class="workbench-star">★</span><div><h1>${esc(module.label)}</h1><small>${esc(module.groupTitle)}</small></div></div>
      <div class="workbench-module-chip">${esc(module.label)}</div>
    </div>
    <nav class="workbench-tabs">${tabs.map(([id,label])=>`<button data-workbench-section="${id}" class="${active===id?'active':''}">${esc(label)}</button>`).join('')}</nav>
    <main class="workbench-canvas">${body}</main>
    <footer class="workbench-footer"><span>E88 Enterprise System</span><span>Connected Workspace · © 2026 AL23</span></footer>
  </section>`;
}
function bindWorkbench(){
  $$('.workbench-home').forEach(button=>button.onclick=renderLaunchpad);
  $$('.workbench-logout').forEach(button=>button.onclick=logout);
  $$('[data-workbench-section]').forEach(button=>button.onclick=()=>openSection(button.dataset.workbenchSection));
  $$('[data-go]').forEach(button=>button.onclick=()=>openSection(button.dataset.go));
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
    if(raw===undefined||raw===null||raw==='')return'—';
    if(field.type==='date'||field.type==='datetime-local')return date(raw);
    if(field.type==='number'&&/amount|cost|price|rate|value|balance/i.test(field.key))return money(raw);
    if(field.type==='checkbox')return raw?'Yes':'No';
    return esc(raw);
  };
  return `<div class="record-table-wrap"><table class="record-table"><thead><tr><th>Reference</th><th>Date</th><th>Type</th>${listFields.map(field=>`<th>${esc(field.label)}</th>`).join('')}<th>Description</th><th>Owner</th><th class="num">${esc(state.definition?.amountLabel||'Amount')}</th><th>Status</th><th>Updated</th></tr></thead><tbody>
    ${rows.map(row=>`<tr data-record-id="${row.id}"><td><b>${esc(row.record_no)}</b></td><td>${date(row.transaction_date)}</td><td>${esc(row.record_type)}</td>
      ${listFields.map(field=>`<td>${value(row,field)}</td>`).join('')}<td>${esc(row.description||'—')}</td><td>${esc(row.owner_email||'—')}</td>
      <td class="num">${money(row.amount)}</td><td>${statusBadge(row.status)}</td><td>${date(row.updated_at)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function operationalEmpty(message){
  return `<div class="workspace-empty"><b>${esc(message)}</b></div>`;
}
function operationalTable(headers,rows){
  if(!rows.length)return operationalEmpty('No records');
  return `<div class="record-table-wrap"><table class="record-table"><thead><tr>${headers.map(header=>`<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
function workflowStrip(steps,active=0){
  return `<div class="process-strip">${steps.map((step,index)=>`<div class="${index===active?'active':index<active?'complete':''}"><span>${index+1}</span><b>${esc(step)}</b></div>`).join('')}</div>`;
}
function bindOperationalShell(){
  bindWorkbench();
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

async function renderFinanceCenter(title,subtitle){
  content.innerHTML='<div class="workspace-loading">Loading connected finance…</div>';
  try{
    const query=financeQuery();
    const [dashboard,journals]=await Promise.all([
      api(`/finance/dashboard?${query}`),api('/finance/journals?entity=E88'),
    ]);
    const balances=dashboard.balances||{};
    const body=`${financeFilters('<span class="command-spacer"></span><span class="workspace-mode">CONNECTED LEDGER</span>')}
      <div class="workspace-kpis">${kpi('Cash',money(balances.cash))}${kpi('Receivables',money(balances.receivables))}
        ${kpi('Payables',money(balances.payables))}${kpi('Revenue',money(balances.revenue))}
        ${kpi('Net Income',money(balances.profit))}</div>
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
        <section><header>Accounting Control</header><div class="control-note"><b>Balanced and period controlled</b>
          <p>Every posted journal balances, is linked to its source, and cannot post into a closed period.</p></div></section>
      </aside></div>`;
    content.innerHTML=workbenchShell(body,'center');bindWorkbench();
    bindFinanceFilters(()=>renderFinanceCenter(title,subtitle));
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
      <section class="workspace-card"><header><h2>Journal Register</h2><span>Manual and system-generated entries</span></header>
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
      <td>${esc(line.account_name)}</td><td>${esc(line.partner_name||'—')}</td><td>${esc(line.department||'—')}</td>
      <td>${esc(line.cost_center||'—')}</td><td class="num">${money(line.base_debit)}</td>
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
          <div><small>Prepared By</small><b>${esc(h.created_by)}</b><small>Approved By</small><b>${esc(h.approved_by||'—')}</b></div>
        </div></section><section class="record-sublist">${financeTable(['#','Account','Name','Partner','Department','Cost Center','Debit','Credit'],rows)}</section>
      </section>`;
    content.innerHTML=workbenchShell(body,'records');bindWorkbench();$('#journalBack').onclick=renderJournalRegister;
    if($('#journalAction'))$('#journalAction').onclick=async()=>{
      try{await api(`/finance/journals/${id}/action`,{method:'POST',body:JSON.stringify({action:$('#journalAction').dataset.action})});
        toast('Journal updated');await openFinanceJournal(id);
      }catch(error){toast(error.message,'error');}
    };
    const request=type=>modal(`${type} ${h.journal_no}`,`<form id="financeChangeForm" class="operational-form">
      <div class="control-note"><b>Independent approval required</b><p>The original journal remains permanently auditable.</p></div>
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
          <td>${esc(row.department||'—')}</td><td>${esc(row.cost_center||'—')}</td>
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
      <section class="workspace-card"><header><h2>Accounting Periods</h2><span>Closed periods reject postings</span></header>
        ${financeTable(['Period','Start','End','Status','Control'],periodRows)}</section>`;
    content.innerHTML=workbenchShell(body,'setup');bindWorkbench();
    $('#generatePeriods').onclick=async()=>{try{await api('/finance/periods/generate',{method:'POST',body:JSON.stringify({entityCode:'E88',year:new Date().getFullYear()})});
      toast('Accounting periods generated');await renderAccountingSetup();}catch(error){toast(error.message,'error');}};
    $$('[data-close-period]').forEach(button=>button.onclick=async()=>{const reason=prompt('Month-end close reason:','Month-end review completed');
      if(!reason)return;try{await api(`/finance/periods/${button.dataset.closePeriod}/close-request`,{method:'POST',body:JSON.stringify({reason})});
      toast('Period close sent for independent approval');}catch(error){toast(error.message,'error');}});
    $('#newAccount').onclick=()=>modal('New Chart of Account',`<form id="accountForm" class="operational-form grid">
      <label><span>Account Code</span><input name="accountCode" required></label><label><span>Account Name</span><input name="accountName" required></label>
      <label><span>Account Type</span><select name="accountType"><option>ASSET</option><option>LIABILITY</option><option>EQUITY</option>
        <option>REVENUE</option><option>COGS</option><option>EXPENSE</option></select></label>
      <label><span>Control Type</span><select name="controlType"><option>NONE</option><option>BANK</option><option>AR</option><option>AP</option>
        <option>INVENTORY</option><option>FIXED_ASSET</option><option>TAX</option></select></label>
      <label><span>Cash Flow Group</span><select name="cashFlowGroup"><option>OPERATING</option><option>INVESTING</option><option>FINANCING</option></select></label>
      <button class="command primary">Create Account</button></form>`);
    $('#accountForm').onsubmit=async event=>{event.preventDefault();try{await api('/finance/accounts',{method:'POST',body:JSON.stringify(formDataObject(event.currentTarget))});
      closeModal();toast('Account created');await renderAccountingSetup();}catch(error){toast(error.message,'error');}};
  }catch(error){showWorkspaceError(error);}
}

async function renderReceivablesPayables(section){
  if(section==='center')return renderFinanceCenter('Receivables and Payables Work Summary','Invoices, supplier bills, collections and controlled payments');
  if(section==='records')return renderSubledger();
  if(section==='approvals')return renderPaymentRequests();
  if(section==='reports')return renderAgingTax();
  return renderFinanceControlNotes('AR/AP Controls',[
    ['Three-way match','Supplier bills should reference the approved PO and actual goods receipt.'],
    ['Collections','Customer receipts are applied to exact invoices and update open balances.'],
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
      <td>${financeStatus(row.status)}</td><td>${row.status==='DRAFT'?`<button class="table-action" data-post-subledger="${row.id}" data-document-type="${esc(row.document_type)}">Prepare Journal</button>`:esc(row.journal_no||'—')}</td></tr>`);
    const body=`<div class="workspace-commandbar"><button class="command primary" id="newSubledger">New Invoice / Bill / Receipt</button>
      <button class="command" id="generateLeaseBilling">Generate Lease Billing</button><span class="command-spacer"></span>
      <span class="workspace-mode">${data.rows.length} DOCUMENTS</span></div>
      <section class="workspace-card"><header><h2>AR/AP Document Register</h2><span>Open balances and journal status</span></header>
        ${financeTable(['Document','Date','Type','Customer / Supplier','Gross','Open','Status','Journal'],rows)}</section>`;
    content.innerHTML=workbenchShell(body,'records');bindWorkbench();
    $('#newSubledger').onclick=()=>openSubledgerForm(master);
    $('#generateLeaseBilling').onclick=()=>openLeaseBillingForm(leases.contracts);
    $$('[data-post-subledger]').forEach(button=>button.onclick=async()=>{
      const defaultAccount=button.dataset.documentType.includes('RECEIPT')||button.dataset.documentType.includes('PAYMENT')?'1010':
        button.dataset.documentType.includes('INVOICE')||button.dataset.documentType.includes('LEASE')?'4000':'6990';
      const accountCode=prompt('Expense, inventory, revenue or bank account code:',defaultAccount);
      if(!accountCode)return;try{await api(`/finance/subledger/${button.dataset.postSubledger}/post`,{method:'POST',body:JSON.stringify({accountCode,bankAccountCode:accountCode})});
      toast('Accounting journal prepared for approval');await renderSubledger();}catch(error){toast(error.message,'error');}});
  }catch(error){showWorkspaceError(error);}
}
function openSubledgerForm(master){
  modal('New AR/AP Document',`<form id="subledgerForm" class="operational-form grid">
    <label><span>Type</span><select name="documentType"><option>CUSTOMER_INVOICE</option><option>SUPPLIER_BILL</option>
      <option>CUSTOMER_RECEIPT</option><option>SUPPLIER_PAYMENT</option><option>LEASE_BILLING</option></select></label>
    <label><span>Entity</span><select name="entityCode">${master.entities.map(x=>`<option>${esc(x.entity_code)}</option>`).join('')}</select></label>
    <label class="wide"><span>Customer / Supplier</span><select name="partnerId" required><option value="">Select…</option>
      ${master.partners.map(x=>`<option value="${x.id}">${esc(x.partner_type)} · ${esc(x.partner_code)} · ${esc(x.name)}</option>`).join('')}</select></label>
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
    const rows=data.rows.map(row=>{
      const action=row.status==='DRAFT'?'SUBMIT':row.status==='SUBMITTED'?'DEPARTMENT_APPROVE':
        row.status==='DEPARTMENT_APPROVED'?'FINANCE_VALIDATE':row.status==='FINANCE_VALIDATED'?'FINAL_APPROVE':
          row.status==='APPROVED'?'MARK_PAID':row.status==='PAYMENT_PREPARED'?'CONFIRM_PAID':'';
      return `<tr><td><b>${esc(row.request_no)}</b></td><td>${date(row.request_date)}</td><td>${esc(row.payee_name)}</td>
        <td>${esc(row.department)}</td><td>${esc(row.purchase_order_no||'—')}</td><td class="num">${money(row.net_payable)}</td>
        <td>${financeStatus(row.status)}</td><td>${action?`<button class="table-action" data-rfp-action="${action}" data-rfp-id="${row.id}">${esc(action.replaceAll('_',' '))}</button>`:'—'}</td></tr>`;
    });
    const body=`<div class="workspace-commandbar"><button class="command primary" id="newRfp">New Request for Payment</button>
      <span class="command-spacer"></span><span class="workspace-mode">CONTROLLED PAYMENT WORKFLOW</span></div>
      ${workflowStrip(['Request','Department Approval','Finance Validation','Final Approval','Payment'],2)}
      <section class="workspace-card"><header><h2>Request for Payment Worklist</h2><span>${data.rows.length} requests</span></header>
        ${financeTable(['RFP','Date','Payee','Department','PO','Net Payable','Status','Action'],rows)}</section>`;
    content.innerHTML=workbenchShell(body,'approvals');bindWorkbench();
    $('#newRfp').onclick=()=>openRfpForm(data.purchaseOrders,master);
    $$('[data-rfp-action]').forEach(button=>button.onclick=async()=>{
      const body={action:button.dataset.rfpAction};
      if(body.action==='FINAL_APPROVE')body.accountCode=prompt('Expense or inventory account code:','6990')||'6990';
      if(body.action==='MARK_PAID'){
        const bank=master.bankAccounts[0];if(!bank)return toast('Create a bank account first.','error');
        body.bankAccountId=bank.id;body.paymentReference=prompt('Bank payment reference:','');
        if(!body.paymentReference)return;
      }
      try{await api(`/finance/payment-requests/${button.dataset.rfpId}/action`,{method:'POST',body:JSON.stringify(body)});
        toast('Payment request updated');await renderPaymentRequests();}catch(error){toast(error.message,'error');}
    });
  }catch(error){showWorkspaceError(error);}
}
function openRfpForm(purchaseOrders,master){
  modal('New Request for Payment',`<form id="rfpForm" class="operational-form grid">
    <label><span>Entity</span><select name="entityCode">${master.entities.map(x=>`<option>${esc(x.entity_code)}</option>`).join('')}</select></label>
    <label><span>Request Date</span><input name="requestDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label>
    <label class="wide"><span>Approved Purchase Order</span><select name="purchaseOrderId"><option value="">Non-PO request</option>
      ${purchaseOrders.map(x=>`<option value="${x.id}">${esc(x.purchase_order_no)} · ${esc(x.vendor_name)} · ${money(x.total_amount)}</option>`).join('')}</select></label>
    <label class="wide"><span>Payee</span><select name="payeePartnerId"><option value="">Use PO vendor</option>
      ${master.partners.filter(x=>x.partner_type==='VENDOR').map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
    <label><span>Department</span><input name="department" required></label><label><span>Cost Center</span><input name="costCenter"></label>
    <label><span>Supplier Invoice</span><input name="supplierInvoiceNo"></label><label><span>Invoice Date</span><input name="invoiceDate" type="date"></label>
    <label><span>Gross Amount</span><input name="grossAmount" type="number" step="0.01" required></label>
    <label><span>VAT Amount</span><input name="vatAmount" type="number" step="0.01"></label>
    <label><span>Withholding</span><input name="withholdingAmount" type="number" step="0.01"></label>
    <label><span>Due Date</span><input name="dueDate" type="date"></label>
    <label class="wide"><span>Purpose</span><textarea name="purpose" required></textarea></label>
    <button class="command primary">Save RFP</button></form>`);
  $('#rfpForm').onsubmit=async event=>{event.preventDefault();try{await api('/finance/payment-requests',{method:'POST',
    body:JSON.stringify(formDataObject(event.currentTarget))});closeModal();toast('Payment request created');await renderPaymentRequests();}
    catch(error){toast(error.message,'error');}};
}

async function renderAgingTax(){
  content.innerHTML='<div class="workspace-loading">Preparing aging and tax reports…</div>';
  try{
    const [ar,ap,tax]=await Promise.all([api('/finance/aging/AR'),api('/finance/aging/AP'),api(`/finance/reports/tax-summary?${financeQuery()}`)]);
    const aging=(data)=>data.rows.map(row=>`<tr><td><b>${esc(row.document_no)}</b></td><td>${esc(row.partner_name)}</td>
      <td>${date(row.document_date)}</td><td>${date(row.due_date)}</td><td>${esc(row.aging_bucket)}</td><td class="num">${money(row.open_balance)}</td></tr>`);
    const body=`${financeFilters()}<div class="workspace-kpis">${kpi('Total AR',money(ar.totals.total))}${kpi('AR Over 90',money(ar.totals.OVER_90))}
      ${kpi('Total AP',money(ap.totals.total))}${kpi('AP Over 90',money(ap.totals.OVER_90))}</div>
      <div class="two-column"><section class="workspace-card"><header><h2>Accounts Receivable Aging</h2></header>
        ${financeTable(['Document','Customer','Date','Due','Bucket','Open Balance'],aging(ar))}</section>
      <section class="workspace-card"><header><h2>Accounts Payable Aging</h2></header>
        ${financeTable(['Document','Supplier','Date','Due','Bucket','Open Balance'],aging(ap))}</section></div>
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
        <section class="workspace-card"><header><h2>Fixed Asset Register</h2><span>Linked to exact inventory serials</span></header>
          ${financeTable(['Serial','Asset','Class','Capitalized','Cost','Accumulated Depreciation','Net Book Value','Status'],rows)}</section>`;
      content.innerHTML=workbenchShell(body,'records');bindWorkbench();
      $('#capitalizeAsset').onclick=()=>openCapitalizeForm(data.candidates);
    }else if(section==='approvals'){
      const rows=data.runs.map(row=>`<tr><td><b>${esc(row.run_no)}</b></td><td>${esc(row.entity_code)}</td><td>${esc(row.period_name)}</td>
        <td>${date(row.run_date)}</td><td class="num">${money(row.total_depreciation)}</td><td>${financeStatus(row.status)}</td>
        <td>${row.status==='DRAFT'?`<button class="table-action" data-dep-approve="${row.id}">Approve</button>`:
          row.status==='APPROVED'?`<button class="table-action" data-dep-post="${row.id}">Post</button>`:esc(row.journal_no||'—')}</td></tr>`);
      const body=`<div class="workspace-commandbar"><button class="command primary" id="newDepRun">New Depreciation Run</button></div>
        <section class="workspace-card"><header><h2>Depreciation Runs</h2><span>One controlled run per entity and period</span></header>
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
        <td>${esc(row.journal_no||row.error_message||'—')}</td><td>${row.status==='ERROR'?
          `<button class="table-action" data-retry-event="${row.id}">Retry</button>`:'—'}</td></tr>`);
      const body=`<div class="workspace-commandbar"><button class="command primary" id="syncFinance">Synchronize Operational Transactions</button>
        <span class="command-spacer"></span><span class="workspace-mode">${data.rows.length} SOURCE EVENTS</span></div>
        <section class="workspace-card"><header><h2>Operational Source-to-Ledger Control</h2><span>Every inventory and commercial event</span></header>
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
    const rows=data.byCategory.map(row=>`<tr><td><b>${esc(row.category)}</b></td><td>${row.units}</td><td class="num">${money(row.subledger_value)}</td></tr>`);
    const body=`<div class="workspace-kpis">${kpi('Inventory Subledger',money(data.summary.inventory_subledger))}
      ${kpi('Inventory General Ledger',money(data.summary.inventory_general_ledger))}
      ${kpi('Difference',money(data.summary.difference))}${kpi('Status',data.summary.reconciled?'RECONCILED':'REVIEW REQUIRED')}</div>
      <section class="workspace-card"><header><h2>Inventory Valuation by Class</h2><span>Serial-level quantity and valuation</span></header>
        ${financeTable(['Class','Units','Subledger Value'],rows)}</section>
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
    const rows=data.rows.map(row=>`<tr><td><b>${esc(row.department||'Unassigned')}</b></td><td>${esc(row.cost_center||'—')}</td>
      <td>${esc(row.account_title)}</td><td class="num">${money(row.budget_amount)}</td><td class="num">${money(row.actual_amount)}</td>
      <td class="num">${money(row.variance)}</td><td class="num">${money(row.utilizationPct)}%</td></tr>`);
    const body=`<div class="workspace-commandbar"><span class="workspace-mode">${data.year} BUDGET PERFORMANCE</span></div>
      <section class="workspace-card"><header><h2>Department Budget vs Actual</h2><span>Date-controlled posted ledger actuals</span></header>
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
      <section class="workspace-card"><header><h2>Entity Financial Statements</h2><span>Before intercompany eliminations</span></header>
        ${financeTable(['Entity','Revenue','COGS','Operating Expense','Net Income','Assets','Liabilities'],rows)}</section>
      <section class="workspace-card"><header><h2>Consolidation Control</h2></header>
        <div class="control-note"><b>Elimination entries use General Accounting</b><p>Create an elimination journal, tag the entity and source reference, route it for approval, then post before final consolidated reporting.</p></div></section>`;
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
      <td>${esc(row.bank_name)}</td><td>${esc(row.account_name)}</td><td>${esc(row.account_number_masked||'—')}</td>
      <td class="num">${money(row.statement_balance)}</td><td>${row.unmatched}</td></tr>`);
    const txRows=transactions.rows.map(row=>`<tr><td>${date(row.transaction_date)}</td><td><b>${esc(row.bank_account_code)}</b></td>
      <td>${esc(row.bank_reference||'—')}</td><td>${esc(row.description)}</td><td>${esc(row.direction)}</td>
      <td class="num">${money(row.amount)}</td><td>${financeStatus(row.status)}</td><td>${esc(row.journal_no||'—')}</td>
      <td>${row.status==='UNMATCHED'?`<button class="table-action" data-match-bank="${row.id}">Match</button>`:'Matched'}</td></tr>`);
    const reconciliationRows=reconciliations.rows.map(row=>`<tr><td><b>${esc(row.reconciliation_no)}</b></td>
      <td>${esc(row.bank_account_code)} · ${esc(row.bank_name)}</td><td>${date(row.statement_date)}</td>
      <td class="num">${money(row.statement_ending_balance)}</td><td class="num">${money(row.book_ending_balance)}</td>
      <td class="num">${money(row.difference)}</td><td>${financeStatus(row.status)}</td>
      <td>${row.status==='SUBMITTED'?`<button class="table-action" data-recon-decision="${row.id}" data-decision="APPROVE">Approve</button>
        <button class="table-action danger" data-recon-decision="${row.id}" data-decision="REJECT">Reject</button>`:'—'}</td></tr>`);
    const body=`<div class="workspace-commandbar"><button class="command primary" id="newBank">New Bank Account</button>
      <button class="command" id="importBankTx">Enter Bank Transaction</button>
      <button class="command" id="newReconciliation">Prepare Reconciliation</button></div>
      <section class="workspace-card"><header><h2>Bank Accounts</h2><span>Separate by legal entity</span></header>
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
    const rows=data.rows.map(row=>`<tr><td><b>${esc(row.department)}</b></td><td>${esc(row.costCenter||'—')}</td>
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
  const body=`<section class="workspace-card"><header><h2>${esc(title)}</h2><span>Connected finance controls</span></header>
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
      <div class="workspace-kpis">${kpi('Approved POs',approved)}${kpi('Expected Units',expected)}${kpi('Received Units',received)}${kpi('Open Discrepancies',discrepancies)}</div>
      <div class="ramco-layout">
        <div class="ramco-main">
          <section class="ramco-window">
            <header><div><b>Inbound Shipment Control</b><small>PO-controlled expected and actual receiving</small></div><button class="ramco-primary" data-section-link="approvals">Upload ATLAS</button></header>
            ${operationalTable(['Shipment','Purchase Order','Batch','Supplier','Expected','Received','Variance','Status'],recent.map(row=>`<tr>
              <td><b>${esc(row.shipment_no)}</b></td><td>${esc(row.purchase_order_ref||'—')}</td><td>${esc(row.batch_code||'—')}</td>
              <td>${esc(row.supplier_name||'—')}</td><td>${esc(row.expected_qty||0)}</td><td>${esc(row.received_qty||0)}</td>
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
      <td>${esc(row.vendor_name||'—')}</td><td>${date(row.expected_delivery_date)}</td><td>${esc(row.currency)}</td>
      <td class="num">${money(row.total_amount)}</td><td>${esc(row.line_count)}</td><td>${statusBadge(row.status)}</td>
      <td>${row.status==='DRAFT'&&can('PROCUREMENT','APPROVE')?`<button class="table-action" data-approve-po="${row.id}">Approve</button>`:''}</td></tr>`);
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
      try{await api(`/procurement/purchase-orders/${button.dataset.approvePo}/approve`,{method:'POST',body:'{}'});toast('Purchase order approved');await renderPurchaseOrders();}
      catch(error){toast(error.message,'error');}
    });
  }catch(error){showWorkspaceError(error);}
}

async function renderPurchaseOrderForm(){
  const lookups=await api('/masters/lookups');
  const body=`${workflowStrip(['Purchase Order','ATLAS Expected Shipment','Goods Receipt','Warehouse Visibility'],0)}
    <div class="record-actionbar"><button class="command primary" id="savePO">Save Purchase Order</button><button class="command" id="cancelPO">Cancel</button></div>
    <form id="poForm" class="record-page">
      <header><div><small>Inbound Logistics</small><h2>New Purchase Order</h2></div><div class="record-number">AUTO NUMBER</div></header>
      <section class="record-body"><div class="record-fields">
        <label class="record-field"><span>Vendor</span><select name="vendorName" required><option value="">Select vendor…</option>${lookups.vendors.map(v=>`<option>${esc(v.name)}</option>`).join('')}</select></label>
        ${recordField('Order Date','orderDate','date',new Date().toISOString().slice(0,10),'required')}
        ${recordField('Expected Delivery','expectedDeliveryDate','date','')}
        <label class="record-field"><span>Currency</span><select name="currency"><option>PHP</option><option>USD</option><option>EUR</option></select></label>
        ${recordField('Exchange Rate','exchangeRate','number','1','min="0.000001" step="0.000001"')}
        ${recordField('Incoterm','incoterm','text','')}
        ${recordField('Payment Terms','paymentTerms','text','')}
        ${recordField('Tax Amount','taxAmount','number','0','min="0" step="0.01"')}
      </div></section>
      <div class="record-tabs"><button type="button" class="active">Items</button></div>
      <section class="record-sublist"><div class="line-editor-head"><b>Purchase Order Lines</b><button type="button" id="addPOLine">Add Line</button></div>
        <div id="poLines" class="line-editor"></div></section>
    </form>`;
  content.innerHTML=workbenchShell(body,'records');
  bindOperationalShell();
  const addLine=()=>{
    const row=document.createElement('div');
    row.className='line-editor-row po-line';
    row.innerHTML=`<select data-line="itemId" required><option value="">Item…</option>${lookups.items.map(item=>`<option value="${item.id}" data-code="${esc(item.item_code)}" data-name="${esc(item.item_name)}" data-category="${esc(item.category)}">${esc(item.item_code)} · ${esc(item.item_name)}</option>`).join('')}</select>
      <input data-line="description" placeholder="Description"><input data-line="qty" type="number" min="0.01" step="0.01" value="1" aria-label="Quantity">
      <input data-line="unitCost" type="number" min="0" step="0.01" value="0" aria-label="Unit cost"><button type="button" class="remove-line">×</button>`;
    row.querySelector('select').onchange=()=>{
      const option=row.querySelector('select').selectedOptions[0];
      row.querySelector('[data-line="description"]').value=option?.dataset.name||'';
    };
    row.querySelector('.remove-line').onclick=()=>row.remove();
    $('#poLines').append(row);
  };
  addLine();$('#addPOLine').onclick=addLine;$('#cancelPO').onclick=renderPurchaseOrders;
  $('#savePO').onclick=()=>$('#poForm').requestSubmit();
  $('#poForm').onsubmit=async event=>{
    event.preventDefault();
    const payload=formDataObject(event.currentTarget);
    payload.lines=$$('.po-line').map(row=>{
      const option=row.querySelector('select').selectedOptions[0];
      return {itemId:Number(row.querySelector('select').value),itemCode:option?.dataset.code||'',
        itemName:option?.dataset.name||'',category:option?.dataset.category||'OTH',
        description:row.querySelector('[data-line="description"]').value,
        qty:Number(row.querySelector('[data-line="qty"]').value),unitCost:Number(row.querySelector('[data-line="unitCost"]').value),serialized:true};
    });
    try{const result=await api('/procurement/purchase-orders',{method:'POST',body:JSON.stringify(payload)});toast(`Purchase order ${result.purchaseOrderNo} created`);await renderPurchaseOrders();}
    catch(error){toast(error.message,'error');}
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
            <header><h2>ATLAS Expected Shipment Upload</h2><span>Approved PO required</span></header>
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
              <td><b>${esc(row.shipment_no)}</b></td><td>${esc(row.purchase_order_ref||'—')}</td><td>${esc(row.batch_code||'—')}</td>
              <td>${esc(row.supplier_name||'—')}</td><td>${esc(row.expected_qty||0)}</td><td>${esc(row.received_qty||0)}</td>
              <td>${date(row.eta)}</td><td>${statusBadge(row.status)}</td></tr>`))}
          </section>
        </div>
        <aside class="ramco-rail"><section><header>ATLAS Control</header><div class="control-note"><b>Expected only</b><p>ATLAS never creates warehouse inventory. Actual Goods Receipt creates the inventory serial.</p></div></section>
        <section><header>Required Link</header><div class="control-note"><b>Purchase Order</b><p>Every import and shipment retains its approved PO reference.</p></div></section></aside>
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

async function scanQrWithCamera(onScan){
  if(!navigator.mediaDevices?.getUserMedia||!('BarcodeDetector' in window)){
    toast('Camera QR detection is not supported on this browser. Use manual serial entry.','error');
    return;
  }
  let stream;
  let stopped=false;
  modal('Scan QR / serial',`<div class="scanner"><video id="qrVideo" playsinline autoplay></video><p>Point the camera at the unit QR code.</p><button class="command" id="stopScanner">Close scanner</button></div>`);
  const stop=()=>{
    stopped=true;
    stream?.getTracks().forEach(track=>track.stop());
    closeModal();
  };
  $('#stopScanner').onclick=stop;
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}});
    state.scannerStream=stream;
    const video=$('#qrVideo');video.srcObject=stream;
    const detector=new BarcodeDetector({formats:['qr_code','code_128','data_matrix']});
    const detect=async()=>{
      if(stopped)return;
      try{
        const codes=await detector.detect(video);
        if(codes[0]?.rawValue){
          const value=serialFromQrPayload(codes[0].rawValue);
          stop();
          await onScan(value);
          return;
        }
      }catch{}
      requestAnimationFrame(detect);
    };
    video.onloadeddata=detect;
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
    const scanRows=lines.map((row,index)=>`<tr><td>${index+1}</td><td>${esc(row.expectedSerialNo||'—')}</td><td><b>${esc(row.actualSerialNo)}</b></td>
      <td>${statusBadge(row.acceptance)}</td><td>${esc(row.message||'—')}</td><td><button class="table-action" data-remove-scan="${index}">Remove</button></td></tr>`);
    const expectedOptions=(workbench?.expectedAssets||[]).filter(asset=>!['RECEIVED','SUBSTITUTED','CANCELLED','SHORT_CLOSED'].includes(asset.expected_status))
      .map(asset=>`<option value="${asset.id}">${esc(asset.serial_no)} · ${esc(asset.item_code||asset.item_name||'Item')}</option>`).join('');
    const expectedRows=(workbench?.expectedAssets||[]).slice(0,250).map(asset=>`<tr><td>${esc(asset.serial_no)}</td><td>${esc(asset.item_code||'—')}</td>
      <td>${esc(asset.item_name||asset.description||'—')}</td><td>${esc(asset.actual_serial_no||'—')}</td><td>${statusBadge(asset.match_status||asset.expected_status)}</td></tr>`);
    const body=`${workflowStrip(['Purchase Order','ATLAS Expected Shipment','Goods Receipt','Warehouse Visibility'],2)}
      <div class="workspace-commandbar">
        <label class="inline-control"><span>Expected Shipment</span><select id="receiptShipment"><option value="">Select shipment…</option>${open.rows.map(row=>`<option value="${row.shipment_id}" ${Number(row.shipment_id)===shipmentId?'selected':''}>${esc(row.shipment_no)} · PO ${esc(row.purchase_order_no||row.purchase_order_ref||'—')} · ${esc(row.remaining_qty)} remaining</option>`).join('')}</select></label>
        <label class="inline-control"><span>Receiving Location</span><select id="receiptLocation"><option value="">Select warehouse/store…</option>${lookups.locations.map(location=>`<option value="${location.id}" ${Number(location.id)===Number(state.inbound.locationId)?'selected':''}>${esc(location.code)} · ${esc(location.name)} (${esc(location.location_type)})</option>`).join('')}</select></label>
      </div>
      ${workbench?`<div class="ramco-layout receiving-layout">
        <div class="ramco-main">
          <section class="workspace-card">
            <header><div><h2>${esc(workbench.header.shipment_no)} · Goods Receipt</h2><span>PO ${esc(workbench.header.purchase_order_ref||'—')} · Batch ${esc(workbench.header.batch_code||'—')}</span></div>${statusBadge(workbench.header.status)}</header>
            <div class="scan-entry">
              <select id="expectedAsset"><option value="">Auto-match expected serial…</option>${expectedOptions}</select>
              <input id="actualSerial" autocomplete="off" placeholder="Scan or enter actual serial">
              <button class="command primary" id="addSerial">Add Serial</button><button class="command scan-camera" id="cameraReceipt">Scan QR</button>
            </div>
            <div class="scan-summary">${kpi('Scanned',lines.length)}${kpi('Matched',lines.filter(row=>row.acceptance==='MATCHED').length)}
              ${kpi('Discrepancies',lines.filter(row=>row.acceptance!=='MATCHED').length)}</div>
            ${operationalTable(['#','Expected Serial','Actual Serial','Classification','Message',''],scanRows)}
            <div class="receipt-post"><label>Receipt reference <input id="receiptReference" placeholder="DR, invoice, or receiving document"></label>
              <label>Notes <input id="receiptNotes" placeholder="Receiving notes"></label>
              <button class="command primary" id="postReceipt" ${lines.length?'':'disabled'}>Confirm & Post Goods Receipt</button></div>
          </section>
          <section class="workspace-card"><header><h2>Expected vs Actual Serials</h2><span>${workbench.expectedAssets.length} expected</span></header>
            ${operationalTable(['Expected Serial','Item','Description','Actual Serial','Status'],expectedRows)}</section>
        </div>
        <aside class="ramco-rail"><section><header>Receipt Control</header><div class="control-note"><b>Actual creates inventory</b><p>Matched units become available. Substituted or unexpected units go to quarantine with a discrepancy.</p></div></section>
        <section><header>Destination</header><div class="control-note"><b>Required location</b><p>Every confirmed serial is assigned to the selected warehouse or retail location.</p></div></section></aside>
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
        await renderGoodsReceipt();
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
    const summaryRows=summary.rows.map(row=>`<tr><td><b>${esc(row.shipment_no)}</b></td><td>${esc(row.purchase_order_no||'—')}</td>
      <td>${esc(row.receipt_locations||'—')}</td><td>${esc(row.expected_qty)}</td><td>${esc(row.received_qty)}</td>
      <td>${esc(row.quantity_variance)}</td><td>${esc(row.open_variances)}</td><td>${statusBadge(row.reconciliation_status)}</td></tr>`);
    const detailRows=details.rows.map(row=>`<tr><td><b>${esc(row.variance_no)}</b></td><td>${esc(row.purchase_order_no||'—')}</td><td>${esc(row.shipment_no)}</td>
      <td>${esc(row.receipt_no)}</td><td>${esc(row.location_code)}</td><td>${esc(row.variance_type)}</td>
      <td>${esc(row.expected_serial_no||'—')}</td><td>${esc(row.actual_serial_no||'—')}</td><td>${esc(row.reason||'—')}</td>
      <td><button class="table-action" data-resolve-variance="${row.id}">Resolve</button></td></tr>`);
    const body=`${workflowStrip(['Purchase Order','ATLAS Expected Shipment','Goods Receipt','Warehouse Visibility'],3)}
      <div class="workspace-kpis">${kpi('Shipments',summary.totals.shipments)}${kpi('Expected',summary.totals.expected)}
        ${kpi('Received',summary.totals.received)}${kpi('Open Discrepancies',summary.totals.openVariances)}</div>
      <section class="workspace-card"><header><h2>Expected Shipment vs Goods Receipt</h2><span>Quantity reconciliation</span></header>
        ${operationalTable(['Shipment','Purchase Order','Receipt Locations','Expected','Received','Qty Variance','Serial Variances','Status'],summaryRows)}</section>
      <section class="workspace-card"><header><h2>Open Serial Discrepancies</h2><span>${details.total} exceptions</span></header>
        ${operationalTable(['Variance','PO','Shipment','Receipt','Location','Type','Expected Serial','Actual Serial','Reason','Action'],detailRows)}</section>`;
    content.innerHTML=workbenchShell(body,'setup');
    bindOperationalShell();
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
    const rows=open.slice(0,20).map(row=>`<tr><td><b>${esc(row.requisition_no)}</b></td><td>${esc(row.request_type||'—')}</td>
      <td>${esc(row.holder_type||'—')}</td><td>${esc(row.holder_name||row.partner_name||'—')}</td><td>${date(row.required_date)}</td>
      <td>${esc(row.serial_count||0)}</td><td>${esc(row.total_qty||0)}</td><td>${statusBadge(row.status)}</td></tr>`);
    const body=`${workflowStrip(['Requisition','Pre-release Checklist','Goods Issuance','Delivery / Custody'],0)}
      <div class="workspace-kpis">${kpi('Open Requisitions',open.length)}${kpi('Ready to Issue',ready.length)}
        ${kpi('Out for Delivery',inTransit.length)}${kpi('Expected Returns',returnable.length)}</div>
      <div class="ramco-layout"><div class="ramco-main"><section class="workspace-card">
        <header><div><h2>Outbound & Custody Work Summary</h2><span>Customer, employee, demo, pilot, internal, project, and lease movements</span></div>
          <button class="ramco-primary" data-section-link="records">New Requisition</button></header>
        ${operationalTable(['Requisition','Purpose','Holder Type','Holder','Required','Serials','Total Qty','Status'],rows)}
      </section></div><aside class="ramco-rail"><section><header>Transaction Launchpad</header><div class="ramco-action-links">
        <button data-section-link="records">Create Requisition</button><button data-section-link="approvals">Pre-release Inspection</button>
        <button data-section-link="reports">Post Goods Issuance</button><button data-section-link="setup">Delivery & Goods Return</button>
      </div></section><section><header>Control</header><div class="control-note"><b>One serial history</b><p>Every selected unit remains linked from requisition through custody, delivery, and return.</p></div></section></aside></div>`;
    content.innerHTML=workbenchShell(body,'center');bindOperationalShell();
  }catch(error){showWorkspaceError(error);}
}

async function renderOutboundRequisitions(){
  content.innerHTML='<div class="workspace-loading">Loading requisitions…</div>';
  try{
    const [lookups,data]=await Promise.all([api('/requisitions/lookups'),api('/requisitions/outbound-workbench')]);
    const rows=data.requisitions.map(row=>`<tr><td><b>${esc(row.requisition_no)}</b></td><td>${date(row.request_date)}</td>
      <td>${esc(row.request_type||'—')}</td><td>${esc(row.holder_type||'—')}</td><td>${esc(row.holder_name||'—')}</td>
      <td>${esc(row.serial_count||0)}</td><td>${esc(row.total_qty||0)}</td><td>${date(row.required_date)}</td><td>${statusBadge(row.status)}</td>
      <td>${['SUBMITTED','DRAFT'].includes(row.status)&&can('REQUISITIONS','APPROVE')?`<button class="table-action" data-approve-requisition="${row.id}">Approve</button>`:''}</td></tr>`);
    const body=`${workflowStrip(['Requisition','Pre-release Checklist','Goods Issuance','Delivery / Custody'],0)}
      <section class="workspace-card"><header><div><h2>Create Requisition Slip</h2><span>Select the holder, available items, and exact serials for full custody traceability.</span></div><span>AUTO REFERENCE</span></header>
        <form id="requisitionForm" class="operational-form grid">
          <label><span>Request Type</span><select name="requestType">${lookups.requestTypes.map(value=>`<option>${esc(value)}</option>`).join('')}</select></label>
          <label><span>Holder Type</span><select name="holderType" id="holderType">${lookups.holderTypes.map(value=>`<option>${esc(value)}</option>`).join('')}</select></label>
          <label><span>Existing Customer / Employee</span><select name="holderPartnerId" id="holderPartner"><option value="">Enter a holder below…</option>${lookups.holders.map(row=>`<option value="${row.id}" data-name="${esc(row.name)}" data-email="${esc(row.email||'')}">${esc(row.partner_type)} · ${esc(row.name)}</option>`).join('')}</select></label>
          <label><span>Holder / Department / Demo / Project Name</span><input name="holderName" id="holderName" required></label>
          <label><span>Holder Email</span><input name="holderEmail" id="holderEmail" type="email"></label>
          <label><span>Department</span><input name="department" value="${esc(state.session.user.department||'')}"></label>
          <label><span>Required Date</span><input name="requiredDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label>
          <label><span>Expected Return Date</span><input name="expectedReturnDate" type="date"></label>
          <label><span>Source Sales / Lease Order</span><select name="sourceOrderId" id="sourceOrder"><option value="">Not order-related</option>${lookups.orders.map(order=>`<option value="${order.id}" data-no="${esc(order.sales_order_no)}" data-customer="${esc(order.customer_name)}" data-customer-id="${order.customer_id}" data-destination="${esc(order.delivery_address||'')}">${esc(order.sales_order_no)} · ${esc(order.transaction_type)} · ${esc(order.customer_name)}</option>`).join('')}</select></label>
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
        <select data-req="serials" multiple size="4" title="Select one or more available serials"><option disabled>Select an item first</option></select>
        <input data-req="qty" type="number" min="0.01" step="0.01" value="1" placeholder="Quantity">
        <input data-req="description" placeholder="Line description"><button type="button" class="remove-line">×</button>`;
      const itemSelect=row.querySelector('[data-req="itemId"]');
      const serialSelect=row.querySelector('[data-req="serials"]');
      itemSelect.onchange=()=>{
        const itemId=Number(itemSelect.value);
        const item=lookups.items.find(value=>value.id===itemId);
        const assets=lookups.assets.filter(asset=>asset.item_id===itemId);
        serialSelect.innerHTML=assets.length?assets.map(asset=>`<option value="${esc(asset.serial_no)}">${esc(asset.serial_no)} · ${esc(asset.current_location_code||'No location')}</option>`).join(''):'<option disabled>No available serials</option>';
        serialSelect.disabled=!item?.serialized;
        row.querySelector('[data-req="qty"]').readOnly=!!item?.serialized;
      };
      serialSelect.onchange=()=>{row.querySelector('[data-req="qty"]').value=serialSelect.selectedOptions.length||1;};
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
          serialRequired:!!item?.serialized,serials:[...row.querySelector('[data-req="serials"]').selectedOptions].map(option=>option.value),
          qty:Number(row.querySelector('[data-req="qty"]').value||0),description:row.querySelector('[data-req="description"]').value||item?.item_name};
      }).filter(line=>line.itemId);
      try{const result=await api('/requisitions',{method:'POST',body:JSON.stringify(payload)});toast(`${result.requisitionNo} created`);await renderOutboundRequisitions();}
      catch(error){toast(error.message,'error');}
    };
    $$('[data-approve-requisition]').forEach(button=>button.onclick=async()=>{
      try{const result=await api(`/requisitions/${button.dataset.approveRequisition}/approve`,{method:'POST',body:'{}'});toast(`${result.assignmentNo} and ${result.deliveryNo} created`);await renderOutboundRequisitions();}
      catch(error){toast(error.message,'error');}
    });
  }catch(error){showWorkspaceError(error);}
}

async function renderPreRelease(){
  content.innerHTML='<div class="workspace-loading">Loading pre-release worklist…</div>';
  try{
    const data=await api('/requisitions/outbound-workbench');
    const latest=new Map();for(const check of data.checks)if(!latest.has(check.serial_no))latest.set(check.serial_no,check);
    const rows=data.allocations.filter(row=>row.asset_id&&row.category==='MC'&&['RESERVED','ISSUED'].includes(row.allocation_status)).map(row=>{
      const check=latest.get(row.serial_no);
      return `<tr><td><b>${esc(row.requisition_no)}</b></td><td>${esc(row.serial_no)}</td><td>${esc(row.item_name)}</td>
        <td>${esc(row.current_location_code||'—')}</td><td>${check?statusBadge(check.result):statusBadge('PENDING')}</td>
        <td>${check?date(check.check_date):'—'}</td><td><button class="table-action" data-precheck="${esc(row.serial_no)}" data-result="PASSED">Pass Inspection</button>
        <button class="table-action danger" data-precheck="${esc(row.serial_no)}" data-result="FAILED">Record Defect</button></td></tr>`;
    });
    const body=`${workflowStrip(['Requisition','Pre-release Checklist','Goods Issuance','Delivery / Custody'],1)}
      <section class="workspace-card"><header><div><h2>Pre-release Checklist Worklist</h2><span>Motorcycles require a passed inspection before goods issuance.</span></div></header>
        ${operationalTable(['Requisition','Serial','Unit','Location','Result','Checked','Action'],rows)}</section>`;
    content.innerHTML=workbenchShell(body,'approvals');bindOperationalShell();
    $$('[data-precheck]').forEach(button=>button.onclick=async()=>{
      const failed=button.dataset.result==='FAILED';
      const defects=failed?prompt('Enter the detected defects. The unit will not be released.'):'';
      if(failed&&!defects)return;
      try{const result=await api('/checklists',{method:'POST',body:JSON.stringify({
        serialNo:button.dataset.precheck,result:button.dataset.result,defects:failed?[defects]:[],
        checklist:{identity:true,brakes:!failed,lights:!failed,tires:!failed,battery:true,documents:true},
      })});toast(`${result.checklistNo}: ${result.result}`);await renderPreRelease();}
      catch(error){toast(error.message,'error');}
    });
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
      <section class="workspace-card"><header><div><h2>Goods Issuance Worklist</h2><span>Posting creates the serial-level outbound stock movement.</span></div></header>
      ${operationalTable(['Delivery','Requisition','Assignment','Schedule','Destination','Holder','Serials','Status','Action'],rows)}</section>`;
    content.innerHTML=workbenchShell(body,'reports');bindOperationalShell();
    $$('[data-release-delivery]').forEach(button=>button.onclick=async()=>{
      try{const result=await api(`/deliveries/${button.dataset.releaseDelivery}/release`,{method:'POST',body:JSON.stringify({releaseDate:new Date().toISOString()})});toast(`${result.released} serialized units issued`);await renderGoodsIssuance();}
      catch(error){toast(error.message,'error');}
    });
  }catch(error){showWorkspaceError(error);}
}

async function renderDeliveryReturns(){
  content.innerHTML='<div class="workspace-loading">Loading delivery and returns…</div>';
  try{
    const [data,returnable,lookups]=await Promise.all([
      api('/requisitions/outbound-workbench'),api('/returns/assignments/active'),api('/masters/lookups'),
    ]);
    const deliveryRows=data.deliveries.filter(row=>['RELEASED','DELIVERED'].includes(row.status)).map(row=>`<tr><td><b>${esc(row.delivery_no)}</b></td><td>${esc(row.requisition_no)}</td>
      <td>${esc(row.assignment_no)}</td><td>${esc(row.destination)}</td><td>${esc(row.recipient_name)}</td><td>${statusBadge(row.status)}</td>
      <td>${row.status==='RELEASED'?`<button class="table-action" data-complete-delivery="${row.id}">Confirm Delivery</button>`:'—'}</td></tr>`);
    const returnRows=data.returns.map(row=>`<tr><td><b>${esc(row.return_no)}</b></td><td>${esc(row.assignment_no)}</td><td>${date(row.return_date)}</td>
      <td>${esc(row.return_location_code||'—')}</td><td>${esc(row.line_count)}</td><td>${statusBadge(row.status)}</td>
      <td>${row.status==='DRAFT'?`<button class="table-action" data-post-return="${row.id}">Post Return</button>`:'—'}</td></tr>`);
    const body=`${workflowStrip(['Requisition','Pre-release Checklist','Goods Issuance','Delivery / Custody'],3)}
      <section class="workspace-card"><header><h2>Delivery Confirmation</h2><span>Released units awaiting proof of delivery</span></header>
        ${operationalTable(['Delivery','Requisition','Assignment','Destination','Holder','Status','Action'],deliveryRows)}</section>
      <section class="workspace-card"><header><div><h2>Create Goods Return from Deployment</h2><span>Returns start from the exact serials assigned to an active custody record.</span></div></header>
        <form id="returnForm" class="operational-form grid">
          <label class="wide"><span>Active Deployment / Assignment</span><select name="assignmentId" id="returnAssignment" required><option value="">Select deployment…</option>${returnable.rows.map(row=>`<option value="${row.id}">${esc(row.assignment_no)} · ${esc(row.assignment_type)} · ${esc(row.holder_name||row.partner_name)} · ${esc(row.asset_count)} units</option>`).join('')}</select></label>
          <label><span>Return Date</span><input name="returnDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label>
          <label><span>Return Location</span><select name="returnLocationCode" id="returnLocation"><option value="RET-QUAR">RET-QUAR · Returns Quarantine</option>${lookups.locations.map(row=>`<option value="${esc(row.code)}" data-name="${esc(row.name)}" data-type="${esc(row.location_type)}">${esc(row.code)} · ${esc(row.name)}</option>`).join('')}</select></label>
          <label><span>Reason</span><select name="reasonCode"><option>END_OF_LEASE</option><option>REPLACEMENT</option><option>EMPLOYEE_RETURN</option><option>DEMO_COMPLETE</option><option>REPAIR</option><option>OTHER</option></select></label>
          <div id="returnLines" class="wide return-line-editor">${operationalEmpty('Select an assignment to load its deployed serials.')}</div>
          <label class="wide"><span>Notes</span><textarea name="notes"></textarea></label>
          <button class="command primary">Create Goods Return</button>
        </form>
      </section>
      <section class="workspace-card"><header><h2>Goods Return Register</h2><span>${data.returns.length} returns</span></header>
        ${operationalTable(['Return','Assignment','Date','Location','Lines','Status','Action'],returnRows)}</section>`;
    content.innerHTML=workbenchShell(body,'setup');bindOperationalShell();
    $('#returnAssignment').onchange=event=>{
      const assignmentId=Number(event.target.value);
      const assets=returnable.assets.filter(row=>row.assignment_id===assignmentId);
      $('#returnLines').innerHTML=assets.length?assets.map(row=>`<div class="return-line" data-expected="${esc(row.serial_no)}" data-category="${esc(row.category)}">
        <b>${esc(row.category)} · ${esc(row.item_name)}</b><span>${esc(row.serial_no)}</span>
        <input data-return="actualSerial" value="${esc(row.serial_no)}" placeholder="Scan actual serial">
        <select data-return="condition"><option>GOOD</option><option>DAMAGED</option><option>FOR_REPAIR</option><option>MISSING_PARTS</option></select>
        <button type="button" class="table-action scan-return">Scan QR</button></div>`).join(''):operationalEmpty('No active serialized units remain on this assignment.');
      $$('.scan-return').forEach(button=>button.onclick=()=>scanQrWithCamera(value=>{button.closest('.return-line').querySelector('[data-return="actualSerial"]').value=value;}));
    };
    $('#returnForm').onsubmit=async event=>{
      event.preventDefault();const payload=formDataObject(event.currentTarget);
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
      try{await api(`/deliveries/${button.dataset.completeDelivery}/complete`,{method:'POST',body:JSON.stringify({deliveryDate:new Date().toISOString()})});toast('Delivery and custody confirmed');await renderDeliveryReturns();}
      catch(error){toast(error.message,'error');}
    });
    $$('[data-post-return]').forEach(button=>button.onclick=async()=>{
      try{await api(`/returns/${button.dataset.postReturn}/post`,{method:'POST',body:'{}'});toast('Goods return posted and inventory updated');await renderDeliveryReturns();}
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
    const data=await api('/inventory/visibility');
    const available=data.rows.filter(row=>row.current_status==='AVAILABLE').length;
    const quarantine=data.rows.filter(row=>row.current_status==='QUARANTINE').length;
    const assigned=data.rows.filter(row=>row.current_holder_name).length;
    const locations=data.byLocation.map(row=>`<tr data-location-filter="${row.location_id}"><td><b>${esc(row.location_code)}</b></td><td>${esc(row.location_name)}</td>
      <td>${esc(row.location_type)}</td><td>${esc(row.total_units)}</td><td>${esc(row.available_units||0)}</td>
      <td>${esc(row.quarantine_units||0)}</td><td>${esc(row.unreconciled_units||0)}</td></tr>`);
    const body=`<div class="workspace-kpis">${kpi('Visible Units',data.total)}${kpi('Locations',data.byLocation.length)}
      ${kpi('Available',available)}${kpi('Quarantine',quarantine)}${kpi('Assigned',assigned)}</div>
      <div class="ramco-layout"><div class="ramco-main"><section class="workspace-card">
        <header><div><h2>Warehouse & Retail Location Visibility</h2><span>All confirmed serials by current location</span></div><button class="ramco-primary" data-section-link="records">Open Unit Register</button></header>
        ${operationalTable(['Location','Name','Type','Total Units','Available','Quarantine','Unreconciled'],locations)}
      </section></div><aside class="ramco-rail">
        <section><header>Visibility Actions</header><div class="ramco-action-links"><button data-section-link="records">Find Units</button>
          <button data-section-link="approvals">Move Units</button><button data-section-link="reports">QR Trace</button><button data-section-link="setup">Location Master</button></div></section>
        <section><header>Unit Position</header>${horizontalBars([['Available',available,'green'],['Assigned',assigned,'blue'],['Quarantine',quarantine,'orange']])}</section>
      </aside></div>`;
    content.innerHTML=workbenchShell(body,'center');
    bindOperationalShell();
    $$('[data-location-filter]').forEach(row=>row.onclick=()=>renderWarehouseVisibility(row.dataset.locationFilter));
  }catch(error){showWorkspaceError(error);}
}

async function renderWarehouseVisibility(locationId='',search='',status=''){
  content.innerHTML='<div class="workspace-loading">Loading unit register…</div>';
  try{
    const [data,lookups]=await Promise.all([
      api(`/inventory/visibility?${new URLSearchParams({locationId,q:search,status})}`),
      api('/masters/lookups'),
    ]);
    const rows=data.rows.map(row=>`<tr><td><b>${esc(row.serial_no)}</b></td><td>${esc(row.item_code||'—')}</td><td>${esc(row.item_name||'—')}</td>
      <td>${esc(row.category)}</td><td>${esc(row.location_code||'UNASSIGNED')}</td><td>${esc(row.location_name||'—')}</td>
      <td>${statusBadge(row.current_status)}</td><td>${esc(row.current_holder_name||'—')}</td><td>${statusBadge(row.reconciliation_status)}</td></tr>`);
    const body=`<div class="workspace-commandbar">
      <input id="unitSearch" placeholder="Serial, item, holder, or location" value="${esc(search)}">
      <select id="unitLocation"><option value="">All locations</option>${lookups.locations.map(row=>`<option value="${row.id}" ${Number(row.id)===Number(locationId)?'selected':''}>${esc(row.code)} · ${esc(row.name)}</option>`).join('')}</select>
      <select id="unitStatus"><option value="">All statuses</option>${['AVAILABLE','ASSIGNED','QUARANTINE','UNDER_REPAIR','LEASED','SOLD'].map(value=>`<option ${value===status?'selected':''}>${value}</option>`).join('')}</select>
      <button class="command primary" id="applyUnitFilter">Apply</button><span class="command-spacer"></span><span class="workspace-mode">${data.total} UNITS</span>
    </div><section class="workspace-card"><header><h2>Unit Location Register</h2><span>Live serial-level visibility</span></header>
      ${operationalTable(['Serial','Item Code','Item','Class','Location','Location Name','Status','Assigned To','Reconciliation'],rows)}</section>`;
    content.innerHTML=workbenchShell(body,'records');
    bindOperationalShell();
    $('#applyUnitFilter').onclick=()=>renderWarehouseVisibility($('#unitLocation').value,$('#unitSearch').value,$('#unitStatus').value);
    $('#unitSearch').onkeydown=event=>{if(event.key==='Enter')$('#applyUnitFilter').click();};
  }catch(error){showWorkspaceError(error);}
}

async function renderStockMovement(){
  content.innerHTML='<div class="workspace-loading">Loading movement workbench…</div>';
  try{
    const [lookups,movements]=await Promise.all([api('/masters/lookups'),api('/inventory/movements')]);
    const rows=movements.rows.slice(0,250).map(row=>`<tr><td><b>${esc(row.movement_no)}</b></td><td>${date(row.movement_date)}</td>
      <td>${esc(row.movement_type)}</td><td>${esc(row.serial_no)}</td><td>${esc(row.item_name||row.item_code||'—')}</td>
      <td>${esc(row.from_location_code||'—')}</td><td>${esc(row.to_location_code||'—')}</td><td>${esc(row.to_status||'—')}</td><td>${esc(row.posted_by||'—')}</td></tr>`);
    const body=`<div class="ramco-layout"><div class="ramco-main">
      <section class="workspace-card"><header><h2>Post Stock Movement</h2><span>Transfer, placement, or status change</span></header>
        <form id="movementForm" class="operational-form grid">
          <label><span>Serial Number</span><input name="serialNo" required placeholder="Scan or enter serial"></label>
          <label><span>Movement</span><select name="movementType"><option>TRANSFER</option><option>PLACEMENT</option><option>STATUS_CHANGE</option><option>ADJUSTMENT</option></select></label>
          <label><span>Destination</span><select name="locationId" required><option value="">Select location…</option>${lookups.locations.map(row=>`<option value="${row.id}">${esc(row.code)} · ${esc(row.name)}</option>`).join('')}</select></label>
          <label><span>New Status</span><select name="toStatus"><option>AVAILABLE</option><option>QUARANTINE</option><option>UNDER_REPAIR</option><option>ASSIGNED</option></select></label>
          <label class="wide"><span>Reason / notes</span><input name="notes" required></label>
          <button class="command primary">Post Movement</button>
        </form>
      </section>
      <section class="workspace-card"><header><h2>Movement Register</h2><span>${movements.total} entries</span></header>
        ${operationalTable(['Movement','Date','Type','Serial','Item','From','To','Status','Posted By'],rows)}</section>
      </div><aside class="ramco-rail"><section><header>Stock Control</header><div class="control-note"><b>One serial, one position</b><p>Every movement updates current location and writes an immutable stock-ledger entry.</p></div></section></aside></div>`;
    content.innerHTML=workbenchShell(body,'approvals');
    bindOperationalShell();
    $('#movementForm').onsubmit=async event=>{
      event.preventDefault();
      const payload=formDataObject(event.currentTarget);
      const location=lookups.locations.find(row=>Number(row.id)===Number(payload.locationId));
      payload.toLocationName=location.name;payload.toLocationCode=location.code;payload.toLocationType=location.location_type;
      try{await api('/inventory/move',{method:'POST',body:JSON.stringify(payload)});toast('Stock movement posted');await renderStockMovement();}
      catch(error){toast(error.message,'error');}
    };
  }catch(error){showWorkspaceError(error);}
}

async function renderQrTrace(){
  const body=`<div class="ramco-layout"><div class="ramco-main"><section class="workspace-card qr-trace-card">
    <header><h2>QR / Serial Trace</h2><span>Mobile-ready unit lookup</span></header>
    <div class="scan-entry"><input id="traceSerial" placeholder="Scan or enter serial number"><button class="command primary" id="traceLookup">Trace Unit</button>
      <button class="command" id="traceCamera">Scan QR</button></div><div id="traceResult">${operationalEmpty('Scan a unit to see its current location and status.')}</div>
  </section></div><aside class="ramco-rail"><section><header>Trace Result</header><div class="control-note"><b>Inventory or expected</b><p>The lookup checks received inventory, ATLAS expected shipments, and open serial exceptions.</p></div></section></aside></div>`;
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
        <div><small>Item</small><b>${esc(record.item_name||record.item_code||'—')}</b></div>
        <div><small>Location</small><b>${esc(record.current_location_code||'Not received')}</b></div>
        <div><small>Status</small>${statusBadge(record.current_status||record.expected_status||record.shipment_status)}</div>
        <div><small>Holder</small><b>${esc(record.current_holder_name||'—')}</b></div></div>`:operationalEmpty(`Serial ${serial} was not found.`);
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
    const rows=lookups.locations.map(row=>`<tr><td><b>${esc(row.code)}</b></td><td>${esc(row.name)}</td><td>${esc(row.location_type)}</td><td>${esc(row.partner_name||'—')}</td></tr>`);
    const body=`<div class="ramco-layout"><div class="ramco-main">
      <section class="workspace-card"><header><h2>Location Master</h2><span>Warehouses, retail stores, depots, and stock points</span></header>
        <form id="locationForm" class="operational-form grid"><label><span>Code (optional)</span><input name="code"></label>
          <label><span>Location Name</span><input name="name" required></label><label><span>Type</span><select name="locationType">
            <option>WAREHOUSE</option><option>RETAIL</option><option>STORE</option><option>DEPOT</option><option>STATION</option><option>OTHER</option>
          </select></label><button class="command primary">Add Location</button></form>
        ${operationalTable(['Code','Location','Type','Partner'],rows)}
      </section></div><aside class="ramco-rail"><section><header>Location Rule</header><div class="control-note"><b>Required for receipts</b><p>Goods receipts cannot post without an active destination location.</p></div></section></aside></div>`;
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
  content.innerHTML='<div class="workspace-loading">Loading cycle count control…</div>';
  try{
    const data=await api('/inventory/cycle-counts');
    const open=data.rows.filter(row=>row.status==='OPEN').length;
    const submitted=data.rows.filter(row=>row.status==='SUBMITTED').length;
    const variances=data.rows.reduce((sum,row)=>sum+Number(row.variance_units||0),0);
    const rows=data.rows.slice(0,20).map(row=>`<tr data-cycle="${row.id}"><td><b>${esc(row.count_no)}</b></td><td>${date(row.count_date)}</td>
      <td>${esc(row.location_code)} · ${esc(row.location_name)}</td><td>${esc(row.category||'All')}</td><td>${esc(row.expected_units)}</td>
      <td>${esc(row.counted_units)}</td><td>${esc(row.variance_units)}</td><td>${statusBadge(row.status)}</td></tr>`);
    const body=`<div class="workspace-kpis">${kpi('Count Plans',data.total)}${kpi('Open Counts',open)}${kpi('For Approval',submitted)}${kpi('Variances',variances)}</div>
      <div class="ramco-layout"><div class="ramco-main"><section class="workspace-card">
        <header><div><h2>Inventory Cycle Counting</h2><span>Print, scan, count, and reconcile by location</span></div><button class="ramco-primary" data-section-link="records">New Count Plan</button></header>
        ${operationalTable(['Count No.','Date','Location','Category','Expected','Counted','Variance','Status'],rows)}
      </section></div><aside class="ramco-rail"><section><header>Counting Actions</header><div class="ramco-action-links">
        <button data-section-link="records">Create / Print Count Plan</button><button data-section-link="approvals">Mobile Physical Count</button>
        <button data-section-link="reports">Variance Reports</button></div></section></aside></div>`;
    content.innerHTML=workbenchShell(body,'center');bindOperationalShell();
    $$('[data-cycle]').forEach(row=>row.onclick=()=>{state.cycleCount=Number(row.dataset.cycle);renderPhysicalCount(state.cycleCount);});
  }catch(error){showWorkspaceError(error);}
}

async function renderCyclePlans(){
  content.innerHTML='<div class="workspace-loading">Loading count plans…</div>';
  try{
    const [data,lookups]=await Promise.all([api('/inventory/cycle-counts'),api('/masters/lookups')]);
    const rows=data.rows.map(row=>`<tr data-cycle="${row.id}"><td><b>${esc(row.count_no)}</b></td><td>${date(row.count_date)}</td>
      <td>${esc(row.location_code)} · ${esc(row.location_name)}</td><td>${esc(row.location_type)}</td><td>${esc(row.category||'All')}</td>
      <td>${esc(row.assigned_to||'—')}</td><td>${esc(row.expected_units)}</td><td>${statusBadge(row.status)}</td></tr>`);
    const body=`<div class="ramco-layout"><div class="ramco-main">
      <section class="workspace-card"><header><h2>Create Cycle Count Plan</h2><span>Snapshot expected serials at one location</span></header>
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
        ${operationalTable(['Count No.','Date','Location','Type','Category','Assigned To','Expected','Status'],rows)}</section>
      </div><aside class="ramco-rail"><section><header>Count Sheet</header><div class="control-note"><b>System snapshot</b><p>The plan freezes the expected serial list for printing or mobile QR counting.</p></div></section></aside></div>`;
    content.innerHTML=workbenchShell(body,'records');bindOperationalShell();
    $('#cyclePlanForm').onsubmit=async event=>{
      event.preventDefault();
      try{const result=await api('/inventory/cycle-counts',{method:'POST',body:JSON.stringify(formDataObject(event.currentTarget))});toast(`${result.countNo} created with ${result.expectedUnits} units`);state.cycleCount=result.id;await renderPhysicalCount(result.id);}
      catch(error){toast(error.message,'error');}
    };
    $$('[data-cycle]').forEach(row=>row.onclick=()=>{state.cycleCount=Number(row.dataset.cycle);renderPhysicalCount(state.cycleCount);});
  }catch(error){showWorkspaceError(error);}
}

function printCycleCountSheet(data){
  const popup=window.open('','_blank','noopener,noreferrer');
  if(!popup)return toast('Allow pop-ups to print the cycle count sheet.','error');
  const rows=data.lines.filter(row=>row.expected_asset_id).map((row,index)=>`<tr><td>${index+1}</td><td>${esc(row.item_code||'')}</td><td>${esc(row.item_name||'')}</td>
    <td>${esc(row.expected_serial_no||'')}</td><td class="blank"></td><td class="blank"></td></tr>`).join('');
  popup.document.write(`<!doctype html><html><head><title>${esc(data.header.count_no)}</title><style>
    body{font:12px Arial;margin:24px;color:#111}header{display:flex;justify-content:space-between;border-bottom:2px solid #0a2239;padding-bottom:12px}
    h1{margin:0;font-size:22px}p{margin:4px 0}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #777;padding:7px;text-align:left}
    .blank{height:22px}.sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:28px;margin-top:50px}.sign div{border-top:1px solid #111;padding-top:6px}
    @media print{button{display:none}}</style></head><body><header><div><h1>E88 Inventory Cycle Count</h1><p>${esc(data.header.count_no)} · ${esc(data.header.location_code)} — ${esc(data.header.location_name)}</p>
    <p>Count date: ${esc(data.header.count_date)} · Category: ${esc(data.header.category||'All')}</p></div><div>© 2026 AL23<br>Internal Use Only</div></header>
    <table><thead><tr><th>#</th><th>Item Code</th><th>Item</th><th>Expected Serial</th><th>Actual / Tick</th><th>Remarks</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="sign"><div>Counted by / Date</div><div>Reviewed by / Date</div><div>Approved by / Date</div></div><button onclick="window.print()">Print</button></body></html>`);
  popup.document.close();
}

async function renderPhysicalCount(countId=state.cycleCount){
  content.innerHTML='<div class="workspace-loading">Loading physical count…</div>';
  try{
    const register=await api('/inventory/cycle-counts');
    const id=Number(countId||register.rows.find(row=>row.status==='OPEN')?.id||register.rows[0]?.id||0);
    state.cycleCount=id||null;
    const data=id?await api(`/inventory/cycle-counts/${id}`):null;
    const rows=(data?.lines||[]).map(row=>`<tr><td>${esc(row.item_code||'—')}</td><td>${esc(row.item_name||'—')}</td>
      <td>${esc(row.expected_serial_no||'—')}</td><td>${esc(row.actual_serial_no||'—')}</td><td>${statusBadge(row.count_status)}</td>
      <td>${row.variance_type?statusBadge(row.variance_type):'—'}</td><td>${esc(row.actual_location_code||'—')}</td></tr>`);
    const body=`<div class="workspace-commandbar"><label class="inline-control"><span>Count Plan</span><select id="physicalCountSelect"><option value="">Select count…</option>${register.rows.map(row=>`<option value="${row.id}" ${row.id===id?'selected':''}>${esc(row.count_no)} · ${esc(row.location_code)} · ${esc(row.status)}</option>`).join('')}</select></label>
      ${data?`<button class="command" id="printCount">Print Count Sheet</button><button class="command primary" id="submitCount" ${data.header.status==='OPEN'?'':'disabled'}>Submit Count</button>`:''}</div>
      ${data?`<div class="ramco-layout"><div class="ramco-main"><section class="workspace-card">
        <header><div><h2>${esc(data.header.count_no)} · Physical Count</h2><span>${esc(data.header.location_code)} — ${esc(data.header.location_name)}</span></div>${statusBadge(data.header.status)}</header>
        <div class="scan-entry"><input id="countSerial" placeholder="Scan or enter physical serial"><button class="command primary" id="countAdd">Count Serial</button>
          <button class="command" id="countCamera">Scan QR</button></div>
        <div class="scan-summary">${kpi('Expected',data.summary.expected)}${kpi('Scanned',data.summary.counted)}${kpi('Variances',data.summary.variances)}
          ${kpi('Missing',data.summary.missing)}${kpi('Location Mismatch',data.summary.locationMismatch)}</div>
        ${operationalTable(['Item','Description','Expected Serial','Actual Serial','Count Status','Variance','Actual Location'],rows)}
      </section></div><aside class="ramco-rail"><section><header>Mobile Count</header><div class="control-note"><b>Fast serial scan</b><p>Each QR scan checks the frozen count sheet and detects missing, unexpected, unknown, or wrong-location units.</p></div></section></aside></div>`:operationalEmpty('Create or select a cycle count plan.')}`;
    content.innerHTML=workbenchShell(body,'approvals');bindOperationalShell();
    $('#physicalCountSelect').onchange=event=>renderPhysicalCount(Number(event.target.value));
    if(!data)return;
    $('#printCount').onclick=()=>printCycleCountSheet(data);
    const scan=async value=>{
      const serial=serialFromQrPayload(value||$('#countSerial').value);
      if(!serial)return toast('Scan or enter a serial.','error');
      try{
        const result=await api(`/inventory/cycle-counts/${id}/scan`,{method:'POST',body:JSON.stringify({serialNo:serial,qrPayload:value||'',scanMethod:value?'QR':'MANUAL'})});
        toast(result.result.varianceType?`${serial}: ${result.result.varianceType}`:`${serial} counted`,result.result.varianceType?'error':'success');
        await renderPhysicalCount(id);
      }catch(error){toast(error.message,'error');}
    };
    $('#countAdd').onclick=()=>scan('');
    $('#countSerial').onkeydown=event=>{if(event.key==='Enter')scan('');};
    $('#countCamera').onclick=()=>scanQrWithCamera(scan);
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
    const rows=variance.rows.map(row=>`<tr><td>${esc(row.variance_type)}</td><td>${esc(row.item_code||'—')}</td><td>${esc(row.item_name||'—')}</td>
      <td>${esc(row.expected_serial_no||'—')}</td><td>${esc(row.actual_serial_no||'—')}</td><td>${esc(row.count_location_code)}</td>
      <td>${esc(row.actual_location_code||'—')}</td><td>${esc(row.scanned_by||'—')}</td><td>${date(row.scanned_at)}</td></tr>`);
    const body=`<div class="workspace-commandbar"><label class="inline-control"><span>Count Plan</span><select id="varianceCountSelect"><option value="">Select count…</option>${register.rows.map(row=>`<option value="${row.id}" ${row.id===id?'selected':''}>${esc(row.count_no)} · ${esc(row.location_code)} · ${row.variance_units} variances</option>`).join('')}</select></label>
      ${data?.header.status==='SUBMITTED'?'<button class="command primary" id="approveCount">Approve Count Report</button>':''}</div>
      <section class="workspace-card"><header><h2>Physical Count Variance Report</h2><span>${variance.total} discrepancies</span></header>
        ${operationalTable(['Variance','Item','Description','Expected Serial','Actual Serial','Count Location','Actual Location','Scanned By','Scanned At'],rows)}</section>`;
    content.innerHTML=workbenchShell(body,'reports');bindOperationalShell();
    $('#varianceCountSelect').onchange=event=>renderCycleVariances(Number(event.target.value));
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

async function renderInventoryAnalysisWorkspace(section){
  if(section==='records')return renderStockAnalysis();
  if(section==='approvals')return renderInventoryPlans();
  if(section==='reports')return renderInventoryPlanningReports();
  if(section==='setup')return renderInventoryPlanningSetup();
  return renderInventoryAnalysisOverview();
}

async function renderInventoryAnalysisOverview(){
  content.innerHTML='<div class="workspace-loading">Loading inventory analysis…</div>';
  try{
    const [analysis,plans]=await Promise.all([api('/inventory/analysis'),api('/inventory/plans')]);
    const actions=analysis.rows.filter(row=>Number(row.available_qty)===0||Number(row.quarantine_qty)>0||Number(row.open_po_qty)>0).slice(0,20);
    const rows=actions.map(row=>`<tr><td><b>${esc(row.item_code)}</b></td><td>${esc(row.item_name)}</td><td>${esc(row.category)}</td>
      <td>${esc(row.on_hand_qty)}</td><td>${esc(row.available_qty)}</td><td>${esc(row.incoming_qty)}</td><td>${esc(row.open_po_qty)}</td>
      <td>${esc(row.quarantine_qty)}</td><td>${Number(row.available_qty)===0?statusBadge('REVIEW ORDER'):Number(row.quarantine_qty)>0?statusBadge('QUALITY HOLD'):statusBadge('INCOMING')}</td></tr>`);
    const body=`<div class="workspace-kpis">${kpi('On-hand Units',analysis.totals.onHand)}${kpi('Available',analysis.totals.available)}
      ${kpi('ATLAS Incoming',analysis.totals.incoming)}${kpi('Open PO Qty',analysis.totals.openPO)}${kpi('Quarantine',analysis.totals.quarantine)}</div>
      <div class="ramco-layout"><div class="ramco-main"><section class="workspace-card">
        <header><div><h2>Supply Chain Inventory Monitor</h2><span>Ordering, replenishment, and deployment decisions</span></div><button class="ramco-primary" data-section-link="approvals">Create Plan</button></header>
        ${operationalTable(['Item','Description','Class','On Hand','Available','Incoming','Open PO','Quarantine','Action'],rows)}
      </section></div><aside class="ramco-rail">
        <section><header>Planning Actions</header><div class="ramco-action-links"><button data-section-link="records">Analyze Inventory</button>
          <button data-section-link="approvals">Ordering / Deployment Plans</button><button data-section-link="reports">Planning Reports</button></div></section>
        <section><header>Plan Register</header>${horizontalBars([['Draft',plans.rows.filter(row=>row.status==='DRAFT').length,'orange'],['Approved',plans.rows.filter(row=>row.status==='APPROVED').length,'green']])}</section>
      </aside></div>`;
    content.innerHTML=workbenchShell(body,'center');bindOperationalShell();
  }catch(error){showWorkspaceError(error);}
}

async function renderStockAnalysis(search=''){
  content.innerHTML='<div class="workspace-loading">Loading stock analysis…</div>';
  try{
    const analysis=await api('/inventory/analysis');
    const q=search.toLowerCase();
    const filtered=analysis.rows.filter(row=>!q||`${row.item_code} ${row.item_name} ${row.category}`.toLowerCase().includes(q));
    const rows=filtered.map(row=>`<tr><td><b>${esc(row.item_code)}</b></td><td>${esc(row.item_name)}</td><td>${esc(row.category)}</td>
      <td>${esc(row.location_count)}</td><td>${esc(row.on_hand_qty)}</td><td>${esc(row.available_qty)}</td><td>${esc(row.deployed_qty)}</td>
      <td>${esc(row.quarantine_qty)}</td><td>${esc(row.incoming_qty)}</td><td>${esc(row.open_po_qty)}</td>
      <td class="num">${money(Number(row.on_hand_qty||0)*Number(row.standard_cost||0))}</td></tr>`);
    const body=`<div class="workspace-commandbar"><input id="analysisSearch" value="${esc(search)}" placeholder="Search item or class">
      <button class="command primary" id="runAnalysisSearch">Apply</button><span class="command-spacer"></span><span class="workspace-mode">${filtered.length} ITEMS</span></div>
      <section class="workspace-card"><header><h2>Inventory Analysis</h2><span>Live, expected, and committed supply</span></header>
        ${operationalTable(['Item','Description','Class','Locations','On Hand','Available','Deployed','Quarantine','ATLAS Incoming','Open PO','Stock Value'],rows)}</section>`;
    content.innerHTML=workbenchShell(body,'records');bindOperationalShell();
    $('#runAnalysisSearch').onclick=()=>renderStockAnalysis($('#analysisSearch').value);
    $('#analysisSearch').onkeydown=event=>{if(event.key==='Enter')$('#runAnalysisSearch').click();};
  }catch(error){showWorkspaceError(error);}
}

async function renderInventoryPlans(){
  content.innerHTML='<div class="workspace-loading">Loading inventory plans…</div>';
  try{
    const [plans,analysis,lookups]=await Promise.all([api('/inventory/plans'),api('/inventory/analysis'),api('/masters/lookups')]);
    const rows=plans.rows.map(row=>`<tr><td><b>${esc(row.plan_no)}</b></td><td>${date(row.plan_date)}</td><td>${esc(row.plan_type)}</td>
      <td>${esc(row.source_location_code||'—')}</td><td>${esc(row.destination_location_code||'—')}</td><td>${esc(row.line_count)}</td>
      <td>${esc(row.planned_units)}</td><td>${statusBadge(row.status)}</td><td>${row.status==='DRAFT'&&can('INVENTORY','APPROVE')?`<button class="table-action" data-approve-plan="${row.id}">Approve</button>`:''}</td></tr>`);
    const body=`<div class="ramco-layout"><div class="ramco-main">
      <section class="workspace-card"><header><h2>Create Inventory Plan</h2><span>Ordering, deployment, or replenishment</span></header>
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
      </div><aside class="ramco-rail"><section><header>Planning Rule</header><div class="control-note"><b>Analysis to action</b><p>Plans preserve the live available and incoming quantities used when the decision was created.</p></div></section></aside></div>`;
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
  content.innerHTML='<div class="workspace-loading">Loading planning reports…</div>';
  try{
    const analysis=await api('/inventory/analysis');
    const low=analysis.rows.filter(row=>Number(row.available_qty)===0);
    const incoming=analysis.rows.filter(row=>Number(row.incoming_qty)>0||Number(row.open_po_qty)>0);
    const riskRows=low.map(row=>`<tr><td><b>${esc(row.item_code)}</b></td><td>${esc(row.item_name)}</td><td>${esc(row.category)}</td>
      <td>${esc(row.on_hand_qty)}</td><td>${esc(row.available_qty)}</td><td>${esc(row.deployed_qty)}</td><td>${esc(row.incoming_qty)}</td><td>${esc(row.open_po_qty)}</td></tr>`);
    const inboundRows=incoming.map(row=>`<tr><td><b>${esc(row.item_code)}</b></td><td>${esc(row.item_name)}</td><td>${esc(row.available_qty)}</td>
      <td>${esc(row.incoming_qty)}</td><td>${esc(row.open_po_qty)}</td><td>${esc(Number(row.available_qty)+Number(row.incoming_qty)+Number(row.open_po_qty))}</td></tr>`);
    const body=`<div class="workspace-kpis">${kpi('Items With No Available Stock',low.length)}${kpi('Incoming Units',analysis.totals.incoming)}
      ${kpi('Open PO Units',analysis.totals.openPO)}${kpi('Quarantine Units',analysis.totals.quarantine)}</div>
      <section class="workspace-card"><header><h2>Availability Risk Report</h2><span>Items requiring ordering or deployment review</span></header>
        ${operationalTable(['Item','Description','Class','On Hand','Available','Deployed','Incoming','Open PO'],riskRows)}</section>
      <section class="workspace-card"><header><h2>Supply Pipeline Report</h2><span>Current + expected + ordered</span></header>
        ${operationalTable(['Item','Description','Available','ATLAS Incoming','Open PO','Projected Supply'],inboundRows)}</section>`;
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

function renderModuleSetup(){
  const definition=state.definition;
  const actionRows=definition.workflow.actions.map(action=>`<tr><td><b>${esc(action.label)}</b></td><td>${action.from.map(status=>statusBadge(status)).join(' ')}</td>
    <td>${statusBadge(action.to)}</td><td>${esc(action.permission)}</td></tr>`);
  const fieldRows=definition.fields.map(field=>`<tr><td><b>${esc(field.label)}</b></td><td>${esc(field.type)}</td>
    <td>${field.required?'Required':'Optional'}</td><td>${field.list?'Register + form':'Form'}</td></tr>`);
  const connections=definition.connections.map(code=>{
    const module=moduleByCode(code);
    return `<button class="connected-module-link" data-connected-module="${esc(code)}" ${module&&canWorkspace(code)?'':'disabled'}>
      <b>${esc(module?.label||code)}</b><span>${esc(module?.groupTitle||'Connected module')}</span></button>`;
  }).join('');
  const body=`<div class="setup-grid">
    <section class="workspace-card"><header><h2>${esc(definition.noun)} Record Types</h2><span>${definition.recordTypes.length} configured</span></header>
      <div class="module-type-grid">${definition.recordTypes.map(type=>`<div><b>${esc(type)}</b><span>Auto-number: ${esc(definition.prefix)}-########</span></div>`).join('')}</div></section>
    <section class="workspace-card"><header><h2>Connected Modules</h2><span>End-to-end document flow</span></header>
      <div class="connected-module-grid">${connections||operationalEmpty('No downstream module is configured.')}</div></section>
    <section class="workspace-card wide-card"><header><h2>Approval-Controlled Workflow</h2><span>Requester and approver separation applies</span></header>
      ${operationalTable(['Action','Allowed From','Result','Required Authority'],actionRows)}
      <div class="control-note"><b>Protected history</b><p>Posted, active, completed, closed, terminated, expired, or reversed records cannot be edited. Void and reversal require a reason and approval by another authorized user.</p></div></section>
    <section class="workspace-card wide-card"><header><h2>Module Data Dictionary</h2><span>${definition.fields.length} operational fields</span></header>
      ${operationalTable(['Field','Data Type','Validation','Used In'],fieldRows)}</section>
  </div>`;
  content.innerHTML=workbenchShell(body,'setup');bindOperationalShell();
  $$('[data-connected-module]').forEach(button=>button.onclick=()=>openWorkspace(button.dataset.connectedModule));
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
      <td>${row.status==='DRAFT'&&can('SALES','APPROVE')?`<button class="table-action" data-approve-sales="${row.id}">Approve</button>`:'—'}</td></tr>`);
    if(section==='reports'){
      const types=['SALE','LEASE','DEMO','PILOT','EMPLOYEE_ASSIGNMENT'].map(type=>[type,rows.filter(row=>row.transaction_type===type).length]);
      const body=`<div class="workspace-kpis">${kpi('Order Value',money(value))}${kpi('Orders',rows.length)}${kpi('Draft',drafts.length)}${kpi('Approved',approved.length)}</div>
        <div class="setup-grid"><section class="workspace-card"><header><h2>Orders by Business Transaction</h2></header>${horizontalBars(types)}</section>
        <section class="workspace-card"><header><h2>Fulfilment Readiness</h2></header>${horizontalBars([['Draft',drafts.length,'orange'],['Approved',approved.length,'green'],['Posted',rows.filter(row=>row.status==='POSTED').length,'blue']])}</section></div>
        <section class="workspace-card"><header><h2>Sales Order Register</h2><span>${rows.length} orders</span></header>
          ${operationalTable(['Order','Date','Type','Customer / Holder','Lines','Gross','Credit','Status','Action'],tableRows)}</section>`;
      content.innerHTML=workbenchShell(body,'reports');bindOperationalShell();
      return bindSalesOrderRows();
    }
    const center=section==='center';
    const body=`${center?`<div class="workspace-kpis">${kpi('Order Value',money(value))}${kpi('Open Drafts',drafts.length)}
      ${kpi('Approved for Fulfilment',approved.length)}${kpi('Available Serials',lookups.assets.length)}</div>
      ${workflowStrip(['CRM / Customer','Sales Order','Approval','Requisition & Allocation','Pre-release','Goods Issue / Delivery'],2)}`:''}
      <div class="workspace-commandbar"><button class="command primary" id="newSalesOrder" ${can('SALES','CREATE')?'':'disabled'}>New Sales Order</button>
        <span class="command-spacer"></span><span class="workspace-mode">${section==='approvals'?'ORDER APPROVAL':'CONNECTED ORDER REGISTER'}</span></div>
      <div class="ramco-layout"><div class="ramco-main"><section class="workspace-card"><header><div><h2>${section==='approvals'?'Orders Requiring Approval':'Sales, Lease & Assignment Orders'}</h2>
        <span>Reserved serials flow automatically to outbound logistics</span></div></header>
        ${operationalTable(['Order','Date','Type','Customer / Holder','Lines','Gross','Credit','Status','Action'],tableRows)}</section></div>
        <aside class="ramco-rail"><section><header>Order Controls</header><div class="definition-list">
          <div><b>Serial availability</b><span>Only clear, available inventory can be ordered.</span></div>
          <div><b>Credit control</b><span>Blocked customers cannot be approved.</span></div>
          <div><b>Connected fulfilment</b><span>Approval creates assignment and delivery records.</span></div></div></section></aside></div>`;
    content.innerHTML=workbenchShell(body,section);bindOperationalShell();
    $('#newSalesOrder').onclick=()=>openSalesOrderForm(lookups);
    bindSalesOrderRows();
  }catch(error){showWorkspaceError(error);}
}

function bindSalesOrderRows(){
  $$('[data-approve-sales]').forEach(button=>button.onclick=async event=>{
    event.stopPropagation();
    try{const result=await api(`/sales/${button.dataset.approveSales}/approve`,{method:'POST',body:'{}'});
      toast(`Approved; ${result.deliveryNo} created`);await renderSalesOrderWorkspace(state.section);}
    catch(error){toast(error.message,'error');}
  });
  $$('[data-sales-order]').forEach(row=>row.onclick=async()=>{
    try{
      const data=await api(`/sales/${row.dataset.salesOrder}`);
      const lines=data.lines.map(line=>`<tr><td>${esc(line.line_no)}</td><td><b>${esc(line.item_code)}</b></td><td>${esc(line.description)}</td>
        <td>${esc(line.serial_no||'—')}</td><td>${esc(line.qty)}</td><td class="num">${money(line.unit_price)}</td>
        <td>${line.serial_no?statusBadge(line.current_status):'—'}</td></tr>`);
      modal(`${data.header.sales_order_no} · ${data.header.customer_name}`,`${workflowStrip(['Order','Approval','Assignment','Delivery'],data.header.status==='DRAFT'?0:2)}
        <div class="workspace-kpis">${kpi('Type',data.header.transaction_type)}${kpi('Gross',money(data.header.gross_amount))}
          ${kpi('Deliveries',data.deliveries.length)}${kpi('Status',data.header.status)}</div>
        ${operationalTable(['Line','Item','Description','Serial','Qty','Unit Price','Inventory Status'],lines)}`);
    }catch(error){toast(error.message,'error');}
  });
}

function openSalesOrderForm(lookups){
  modal('New Connected Sales Order',`<form id="salesOrderForm" class="operational-form grid">
    <label><span>Transaction Type</span><select name="transactionType"><option>SALE</option><option>LEASE</option><option>DEMO</option><option>PILOT</option><option>EMPLOYEE_ASSIGNMENT</option></select></label>
    <label><span>Order Date</span><input name="orderDate" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
    <label class="wide"><span>Customer / Holder</span><select name="customerId" required><option value="">Select…</option>
      ${[...lookups.customers,...lookups.employees].map(row=>`<option value="${row.id}">${esc(row.partner_code)} · ${esc(row.name)}${row.credit_status?` · ${esc(row.credit_status)}`:''}</option>`).join('')}</select></label>
    <label><span>Contract Start</span><input name="contractStart" type="date"></label><label><span>Contract End / Expected Return</span><input name="contractEnd" type="date"></label>
    <label class="wide"><span>Delivery / Deployment Address</span><input name="deliveryAddress" required></label>
    <div class="wide line-editor-head"><b>Items and Serial Numbers</b><button type="button" id="addSalesLine">Add Line</button></div>
    <div id="salesLines" class="wide line-editor"></div><button class="command primary">Create Sales Order</button>
  </form>`);
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
  addLine();$('#addSalesLine').onclick=addLine;
  $('#salesOrderForm').onsubmit=async event=>{
    event.preventDefault();const body=formDataObject(event.currentTarget);
    body.customerId=Number(body.customerId);
    body.lines=$$('.sales-line').map(row=>{
      const item=lookups.items.find(value=>value.id===Number(row.querySelector('[data-sales="itemId"]').value));
      return {itemCode:item?.item_code,itemName:item?.item_name,category:item?.category,
        serialNo:row.querySelector('[data-sales="serialNo"]').value,qty:Number(row.querySelector('[data-sales="qty"]').value||0),
        unitPrice:Number(row.querySelector('[data-sales="unitPrice"]').value||0),description:row.querySelector('[data-sales="description"]').value||item?.item_name};
    }).filter(line=>line.itemCode||line.serialNo);
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
        `<button class="table-action" data-approve-po="${row.id}">Approve</button>`:'—'}</td></tr>`);
    if(section==='reports'){
      const landedRows=landed.rows.map(row=>`<tr><td><b>${esc(row.landed_cost_no)}</b></td><td>${esc(row.shipment_no||row.purchase_order_no||'—')}</td>
        <td>${esc(row.allocation_method)}</td><td class="num">${money(row.total_cost)}</td><td>${statusBadge(row.status)}</td>
        <td>${row.status!=='POSTED'&&can('PROCUREMENT','POST')?`<button class="table-action" data-post-landed="${row.id}">Post</button>`:'—'}</td></tr>`);
      const body=`<div class="workspace-kpis">${kpi('Approved Commitments',money(commitments))}${kpi('Purchase Orders',po.total)}
        ${kpi('Open Sourcing',source.counts.total-source.counts.completed)}${kpi('Landed Cost Batches',landed.rows.length)}</div>
        <section class="workspace-card"><header><h2>Purchase Commitment Report</h2><span>Approved POs connected to expected shipments and AP</span></header>
          ${operationalTable(['PO','Date','Supplier','Expected','Lines','Total','Status','Action'],poRows)}</section>
        <section class="workspace-card"><header><h2>Landed Cost Register</h2><span>Freight, duties, handling and other inventory cost</span></header>
          ${operationalTable(['Landed Cost','Shipment / PO','Allocation','Total','Status','Action'],landedRows)}</section>`;
      content.innerHTML=workbenchShell(body,'reports');bindOperationalShell();bindProcurementRows();return;
    }
    const body=`<div class="workspace-kpis">${kpi('Sourcing Cases',source.counts.total)}${kpi('Draft POs',drafts.length)}
      ${kpi('Approved POs',approved.length)}${kpi('Purchase Commitments',money(commitments))}</div>
      ${workflowStrip(['Purchase Request','RFQ & Comparison','Purchase Order','Expected Shipment / ATLAS','Goods Receipt','AP & Payment'],section==='approvals'?2:1)}
      <div class="workspace-commandbar"><button class="command primary" id="newPurchaseOrder" ${can('PROCUREMENT','CREATE')?'':'disabled'}>New Purchase Order</button>
        <button class="command" id="openSourcingCases">Sourcing & RFQ Register</button><span class="command-spacer"></span><span class="workspace-mode">${section==='approvals'?'PURCHASE ORDER APPROVAL':'PROCUREMENT CENTER'}</span></div>
      <section class="workspace-card"><header><div><h2>Purchase Orders</h2><span>Approved orders become selectable in ATLAS expected shipments</span></div></header>
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
    try{await api(`/procurement/purchase-orders/${button.dataset.approvePo}/approve`,{method:'POST',body:'{}'});toast('Purchase order approved');await renderSourcingWorkspace(state.section);}
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
        <div class="control-note"><b>${data.shipments.length} linked expected shipment(s)</b><p>ATLAS uploads must reference this approved purchase order before receiving.</p></div>`);
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
            <div><small>Record Type</small><b>${first?esc(first.record_type):'—'}</b><small>Document Date</small><b>${first?date(first.transaction_date):'—'}</b></div>
            <div><small>Document Summary</small><b>${first?esc(first.description||'—'):'—'}</b><small>${esc(definition.amountLabel)}</small><b>${first?money(first.amount):'0.00'}</b></div>
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
    <select id="recordType"><option value="">All types</option>${definition.recordTypes.map(type=>`<option>${esc(type)}</option>`).join('')}</select>
    <input id="recordSearch" placeholder="Search ${esc(definition.plural.toLowerCase())}">
    <select id="recordStatus"><option value="">All Statuses</option>${definition.workflow.stages.map(status=>`<option value="${status}" ${defaultStatus===status?'selected':''}>${esc(definition.statusLabels[status])}</option>`).join('')}</select>
    <button class="command" id="runSearch">Search</button>
  </div><div class="ramco-layout records-layout"><section class="workspace-card"><header><h2>${defaultStatus?'Approval Worklist':esc(definition.plural)+' Register'}</h2><span id="recordCount"></span></header><div id="recordsHost"><div class="workspace-loading">Loading records…</div></div></section><aside class="ramco-rail"><section><header>Record Types</header><div class="ramco-action-links">${definition.recordTypes.map(type=>`<button>${esc(type)}</button>`).join('')}</div></section><section><header>Actions</header><div class="ramco-action-links"><button id="railNew" ${can(state.module.permission,'CREATE')?'':'disabled'}>Create ${esc(definition.noun)}</button><button data-go="reports">Reports</button><button data-go="setup">Setup</button></div></section></aside></div>`;
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
function renderRecordForm(record=null,documents=[],connected={}){
  const editing=!!record;
  const immutable=editing&&['POSTED','CLOSED','COMPLETED','REVERSED','VOIDED','TERMINATED','EXPIRED'].includes(record.status);
  const allowed=can(state.module.permission,editing?'EDIT':'CREATE')&&!immutable;
  const definition=state.definition;
  const actions=editing?definition.workflow.actions.filter(action=>action.from.includes(record.status)&&action.code!=='REVERSE'):[];
  const documentRows=documents.map(document=>`<tr><td><b>${esc(document.document_no)}</b></td><td>${esc(document.document_type)}</td>
    <td><a href="/api/workspace/documents/${document.id}/file" target="_blank" rel="noopener">${esc(document.file_name)}</a></td>
    <td>${esc(Math.ceil(Number(document.file_size||0)/1024))} KB</td><td>${esc(document.uploaded_by||'—')}</td><td>${date(document.uploaded_at)}</td></tr>`);
  const leaseUnitRows=(connected.units||[]).map(unit=>`<tr><td><b>${esc(unit.serial_no)}</b></td><td>${esc(unit.item_code)}</td>
    <td>${esc(unit.item_name)}</td><td>${esc(unit.category)}</td><td>${esc(unit.current_location_code||'—')}</td>
    <td>${statusBadge(unit.status)}</td></tr>`);
  const leaseUnitSection=editing&&state.module.code==='sd-lease-contract-management'?`
    <section class="record-sublist connected-record-section">
      <header><div><h3>Leased Units / Annex A</h3><p>Select only available serialized motorcycles, batteries, equipment, or other lease assets.</p></div>
        <span>${connected.units?.length||0} units linked</span></header>
      <div class="lease-unit-picker">
        <label><span>Available Serial Numbers</span><select id="leaseAvailableUnits" multiple size="8">
          ${(connected.availableAssets||[]).map(asset=>`<option value="${esc(asset.serial_no)}">${esc(asset.category)} · ${esc(asset.serial_no)} · ${esc(asset.item_name)} · ${esc(asset.current_location_code||'No location')}</option>`).join('')}
        </select></label>
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
    try{await api(`/workspace/modules/${state.module.code}/records/${record.id}/action`,{method:'POST',body:JSON.stringify({action:button.dataset.action})});toast(`${button.textContent.trim()} completed`);await openRecord(record.id);}
    catch(error){toast(error.message,'error');}
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
  if($('#addLeaseUnits'))$('#addLeaseUnits').onclick=async()=>{
    const serials=[...$('#leaseAvailableUnits').selectedOptions].map(option=>option.value);
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
}
function openRecordChangeRequest(record,actionType){
  modal(`${actionType==='REVERSE'?'Reverse':'Void'} ${record.record_no}`,`<form id="changeRequestForm" class="operational-form grid">
    <div class="control-note wide"><b>Approval required</b><p>The original record will remain in the audit trail. A different authorized approver must approve this request.</p></div>
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
      <div><button class="admin-modules-home" title="Enterprise Modules">▦</button><span class="workbench-user-dot">●</span><b>${esc(user.displayName||user.email)}</b><small>${esc(user.role)}</small></div>
      <div><span>INTERNAL</span><button class="admin-modules-home">Modules</button><button class="workbench-logout">Sign out</button></div>
    </header>
    <div class="workbench-modulebar">
      <div><span class="workbench-star">★</span><div><h1>User & Access Management</h1><small>System Administration</small></div></div>
      <div class="workbench-module-chip">Access Control</div>
    </div>
    <nav class="workbench-tabs">${tabs.map(([id,label])=>`<button data-admin-section="${id}" class="${active===id?'active':''}">${esc(label)}</button>`).join('')}</nav>
    <main class="workbench-canvas">${body}</main>
    <footer class="workbench-footer"><span>E88 Enterprise System</span><span>Controlled Module Access · © 2026 AL23</span></footer>
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
      <td>${esc(row.action)}</td><td>${esc(row.module)}</td><td>${esc(row.record_type||'—')}</td><td>${esc(row.record_no||row.record_id||'—')}</td>
      <td>${esc(row.environment)}</td><td>${esc(row.ip_address||'—')}</td><td>${esc(row.request_id||'—')}</td></tr>`);
    const body=`<div class="workspace-commandbar"><input id="accessAuditSearch" value="${esc(search)}" placeholder="Search user, action, module, or reference">
      <button class="command primary" id="runAccessAudit">Search</button><button class="command" id="refreshAccessAudit">Refresh</button>
      <span class="command-spacer"></span><span class="workspace-mode">${data.total} AUDIT EVENTS</span></div>
      <section class="workspace-card"><header><div><h2>Immutable Access & Transaction Audit</h2><span>User, approval, credential, permission, and business record actions</span></div></header>
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
    {title:'Enterprise Tools',items:state.catalog.tools},
    {title:'Enterprise Add-ons',items:state.catalog.addons},
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
      return `<tr><td><b>${esc(module.replaceAll('_',' '))}</b></td>${actionColumns.map(([key])=>`<td>${admin||permission[key]?'<span class="authority-yes">✓</span>':'<span class="authority-no">—</span>'}</td>`).join('')}</tr>`;
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
      if(result.activationLink)showCredentialLink('Account activation',result.activationLink);
    }catch(error){toast(error.message,'error');}
  };
  if($('#issueCredential'))$('#issueCredential').onclick=async()=>{
    try{
      const result=await api(`/admin/users/${user.id}/${user.activated?'reset':'activation'}`,{method:'POST',body:'{}'});
      showCredentialLink(user.activated?'Password reset':'Account activation',result.resetLink||result.activationLink);
    }catch(error){toast(error.message,'error');}
  };
}
function showCredentialLink(title,link){
  modal(title,`<div class="credential-link"><input value="${esc(link)}" readonly><button class="command primary" id="copyCredential">Copy Link</button></div>`);
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
