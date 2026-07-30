const state={
  session:null,
  catalog:{groups:[],tools:[],addons:[]},
  workspaceAccess:[],
  module:null,
  section:'center',
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
function closeModal(){$('#modal').classList.add('hidden');}
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

function showAuth(mode='login'){
  state.session=null;
  state.module=null;
  document.body.classList.remove('launchpad-view');
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
  state.section='center';
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
  const items=[
    ['center','Role Center','▦'],
    ['records','Transactions','☷'],
    ['reports','Reports','▥'],
    ['setup','Setup','⚙'],
  ];
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
  state.section='center';
  document.body.classList.remove('launchpad-view');
  setHeader(module.label,module.groupTitle);
  renderSidebar();
  await renderRoleCenter();
}
async function openSection(section){
  if(!state.module)return renderLaunchpad();
  state.section=section;
  renderSidebar();
  if(section==='center')return renderRoleCenter();
  if(section==='records')return renderRecords();
  if(section==='reports')return renderEmptyWorkspace('Reports');
  if(section==='setup')return renderEmptyWorkspace('Setup');
}
function kpi(label,value){
  return `<article class="workspace-kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`;
}
function recordsTable(rows){
  if(!rows?.length)return'<div class="workspace-empty"><b>No records</b></div>';
  const lease=state.module?.code==='sd-lease-contract-management';
  return `<div class="record-table-wrap"><table class="record-table"><thead><tr><th>Reference</th><th>Date</th><th>Type</th>${lease?'<th>Channel</th>':''}<th>Description</th><th>Owner</th><th class="num">Amount</th><th>Status</th><th>Updated</th></tr></thead><tbody>
    ${rows.map(row=>`<tr data-record-id="${row.id}"><td><b>${esc(row.record_no)}</b></td><td>${date(row.transaction_date)}</td><td>${esc(row.record_type)}</td>${lease?`<td>${esc(row.business_channel||'—')}</td>`:''}<td>${esc(row.description||'—')}</td><td>${esc(row.owner_email||'—')}</td><td class="num">${money(row.amount)}</td><td>${statusBadge(row.status)}</td><td>${date(row.updated_at)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
async function renderRoleCenter(){
  content.innerHTML='<div class="workspace-loading">Loading workspace…</div>';
  try{
    const data=await api(`/workspace/modules/${state.module.code}/summary`);
    const lease=state.module.code==='sd-lease-contract-management';
    const kpis=lease
      ? `${kpi('Lease Contracts',data.counts.total)}${kpi('B2B',data.counts.b2b)}${kpi('B2C',data.counts.b2c)}${kpi('B2B2C',data.counts.b2b2c)}`
      : `${kpi('Total Records',data.counts.total)}${kpi('Drafts',data.counts.drafts)}${kpi('Pending Approval',data.counts.pending)}${kpi('Completed',data.counts.completed)}`;
    content.innerHTML=`<div class="workspace-commandbar">
      <button class="command primary" id="newRecord" ${can(state.module.permission,'CREATE')?'':'disabled'}>New Record</button>
      <button class="command" data-go="records">Transactions</button>
      <button class="command" data-go="reports">Reports</button>
      <span class="command-spacer"></span><span class="workspace-mode">MODULE FOUNDATION</span>
    </div>
    <div class="workspace-kpis">${kpis}</div>
    <div class="workspace-grid">
      <section class="workspace-card wide"><header><h2>Recent Records</h2><button data-go="records">View All</button></header>${recordsTable(data.recent)}</section>
      <section class="workspace-card"><header><h2>My Work</h2></header><div class="workspace-empty"><b>No assigned work</b></div></section>
      <section class="workspace-card"><header><h2>Alerts</h2></header><div class="workspace-empty"><b>No alerts</b></div></section>
    </div>`;
    $('#newRecord').onclick=()=>renderRecordForm();
    $$('[data-go]').forEach(button=>button.onclick=()=>openSection(button.dataset.go));
    $$('[data-record-id]').forEach(row=>row.onclick=()=>openRecord(row.dataset.recordId));
  }catch(error){showWorkspaceError(error);}
}
async function renderRecords(){
  const lease=state.module.code==='sd-lease-contract-management';
  content.innerHTML=`<div class="workspace-commandbar">
    <button class="command primary" id="newRecord" ${can(state.module.permission,'CREATE')?'':'disabled'}>New Record</button>
    <select id="savedView"><option>All Records</option><option>My Records</option><option>Drafts</option><option>Pending Approval</option></select>
    <input id="recordSearch" placeholder="Search records">
    <select id="recordStatus"><option value="">All Statuses</option><option>DRAFT</option><option>FOR_APPROVAL</option><option>APPROVED</option><option>POSTED</option><option>CLOSED</option></select>
    ${lease?'<select id="recordChannel"><option value="">All Channels</option><option>B2B</option><option>B2C</option><option>B2B2C</option></select>':''}
    <button class="command" id="runSearch">Search</button>
  </div><section class="workspace-card"><header><h2>Transactions</h2><span id="recordCount"></span></header><div id="recordsHost"><div class="workspace-loading">Loading records…</div></div></section>`;
  $('#newRecord').onclick=()=>renderRecordForm();
  const load=async()=>{
    try{
      const query=new URLSearchParams({q:$('#recordSearch').value,status:$('#recordStatus').value,channel:$('#recordChannel')?.value||''});
      const data=await api(`/workspace/modules/${state.module.code}/records?${query}`);
      $('#recordCount').textContent=`${data.rows.length} record${data.rows.length===1?'':'s'}`;
      $('#recordsHost').innerHTML=recordsTable(data.rows);
      $$('[data-record-id]').forEach(row=>row.onclick=()=>openRecord(row.dataset.recordId));
    }catch(error){showWorkspaceError(error,'#recordsHost');}
  };
  $('#runSearch').onclick=load;
  $('#recordSearch').onkeydown=event=>{if(event.key==='Enter')load();};
  await load();
}
async function openRecord(id){
  try{
    const data=await api(`/workspace/modules/${state.module.code}/records/${id}`);
    renderRecordForm(data.record);
  }catch(error){showWorkspaceError(error);}
}
function recordField(label,name,type='text',value='',extra=''){
  return `<label class="record-field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function renderRecordForm(record=null){
  const editing=!!record;
  const allowed=can(state.module.permission,editing?'EDIT':'CREATE');
  const lease=state.module.code==='sd-lease-contract-management';
  const leaseFields=lease?`
        <label class="record-field"><span>Business Channel</span><select name="businessChannel" required><option value="">Select…</option>${['B2B','B2C','B2B2C'].map(value=>`<option value="${value}" ${record?.payload?.businessChannel===value?'selected':''}>${value}</option>`).join('')}</select></label>
        ${recordField('Contract End Date','contractEndDate','date',record?.payload?.contractEndDate||'')}
        <label class="record-field"><span>Billing Frequency</span><select name="billingFrequency"><option value="">Select…</option>${['MONTHLY','QUARTERLY','ANNUAL'].map(value=>`<option value="${value}" ${record?.payload?.billingFrequency===value?'selected':''}>${value}</option>`).join('')}</select></label>
        ${recordField('Units','unitCount','number',record?.payload?.unitCount||0,'min="0" step="1"')}
  `:'';
  content.innerHTML=`<div class="record-actionbar">
    <button class="command primary" id="saveRecord" ${allowed?'':'disabled'}>Save Draft</button>
    <button class="command" id="submitRecord" ${allowed?'':'disabled'}>Submit for Approval</button>
    <button class="command" id="cancelRecord">Cancel</button>
    <span class="command-spacer"></span>${editing?statusBadge(record.status):statusBadge('DRAFT')}
  </div>
  <form id="recordForm" class="record-page">
    <header><div><small>${esc(state.module.groupTitle)}</small><h2>${editing?esc(record.record_no):'New Record'}</h2></div><div class="record-number">${editing?esc(record.record_no):'AUTO NUMBER'}</div></header>
    <section class="record-body">
      <div class="record-fields">
        ${recordField('Record Type','recordType','text',record?.record_type||state.module.label,'required')}
        ${recordField('Transaction Date','transactionDate','date',record?.transaction_date||new Date().toISOString().slice(0,10),'required')}
        ${recordField('Entity','entityName','text',record?.entity_name||'')}
        ${recordField('Department','department','text',record?.department||state.session.user.department||'')}
        ${recordField('Owner','ownerEmail','email',record?.owner_email||state.session.user.email,'required')}
        ${recordField(lease?'Contract Value':'Amount','amount','number',record?.amount||0,'step="0.01"')}
        ${leaseFields}
        <label class="record-field full"><span>Description</span><textarea name="description">${esc(record?.description||'')}</textarea></label>
      </div>
    </section>
    <div class="record-tabs"><button type="button" class="active">Lines</button><button type="button">Related Records</button><button type="button">System Information</button></div>
    <section class="record-sublist"><div class="workspace-empty"><b>No lines</b></div></section>
  </form>`;
  $('#cancelRecord').onclick=()=>openSection('records');
  const save=async status=>{
    const body=formDataObject($('#recordForm'));
    body.status=status;
    try{
      const path=`/workspace/modules/${state.module.code}/records${editing?`/${record.id}`:''}`;
      const result=await api(path,{method:editing?'PATCH':'POST',body:JSON.stringify(body)});
      toast(status==='DRAFT'?'Draft saved':'Record submitted');
      await openRecord(result.record.id);
    }catch(error){toast(error.message,'error');}
  };
  $('#saveRecord').onclick=()=>save('DRAFT');
  $('#submitRecord').onclick=()=>save('FOR_APPROVAL');
}
function renderEmptyWorkspace(title){
  content.innerHTML=`<div class="workspace-commandbar"><button class="command" data-go="center">Role Center</button><span class="command-spacer"></span><span class="workspace-mode">MODULE FOUNDATION</span></div>
    <section class="workspace-card"><header><h2>${esc(title)}</h2></header><div class="workspace-empty"><b>Not configured</b></div></section>`;
  $$('[data-go]').forEach(button=>button.onclick=()=>openSection(button.dataset.go));
}
function showWorkspaceError(error,selector='#content'){
  const host=$(selector);
  if(host)host.innerHTML=`<div class="workspace-error"><b>Unable to load</b><span>${esc(error.message)}</span></div>`;
  toast(error.message,'error');
}

async function renderAccessAdmin(){
  document.body.classList.remove('launchpad-view');
  state.module=null;
  state.section='admin';
  setHeader('User Access','System Administration');
  $('#nav').innerHTML=`<button class="nav-home" id="moduleHome">← Enterprise Modules</button><div class="nav-group">System</div><button class="nav-item active"><span class="nav-icon">♙</span>User Access</button>`;
  $('#moduleHome').onclick=renderLaunchpad;
  content.innerHTML='<div class="workspace-loading">Loading user access…</div>';
  try{
    const data=await api('/admin/users');
    content.innerHTML=`<div class="workspace-commandbar"><button class="command primary" id="newUser">New User</button><span class="command-spacer"></span><span class="workspace-mode">ACCESS CONTROL</span></div>
      <section class="workspace-card"><header><h2>Authorized Users</h2><span>${data.users.length} users</span></header>
      <div class="record-table-wrap"><table class="record-table"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Department</th><th>Modules</th><th>Status</th></tr></thead><tbody>
      ${data.users.map((user,index)=>`<tr data-user="${index}"><td><b>${esc(user.email)}</b></td><td>${esc(user.display_name)}</td><td>${esc(user.role_code)}</td><td>${esc(user.department||'—')}</td><td>${user.allowed_workspace_modules?.length||0}</td><td>${statusBadge(user.active?'ACTIVE':'INACTIVE')}</td></tr>`).join('')}
      </tbody></table></div></section>`;
    $('#newUser').onclick=()=>openUserForm(data);
    $$('[data-user]').forEach(row=>row.onclick=()=>openUserForm(data,data.users[Number(row.dataset.user)]));
  }catch(error){showWorkspaceError(error);}
}
function openUserForm(data,user=null){
  const selected=new Set(user?.allowed_workspace_modules||[]);
  const accessGroups=[
    ...state.catalog.groups,
    {title:'Enterprise Tools',items:state.catalog.tools},
    {title:'Enterprise Add-ons',items:state.catalog.addons},
  ];
  const groups=accessGroups.map(group=>`<fieldset class="access-group"><legend>${esc(group.title)}</legend>${group.items.map(item=>`<label><input type="checkbox" name="workspaceModules" value="${esc(item.code)}" ${selected.has(item.code)?'checked':''}><span>${esc(item.label)}</span></label>`).join('')}</fieldset>`).join('');
  modal(user?'Edit User':'New User',`<form id="userForm">
    <div class="record-fields">
      ${recordField('Corporate Email','email','email',user?.email||'','required')}
      ${recordField('Display Name','displayName','text',user?.display_name||'','required')}
      ${recordField('Department','department','text',user?.department||'')}
      <label class="record-field"><span>Role</span><select name="roleCode">${data.roles.map(role=>`<option value="${esc(role.code)}" ${role.code===(user?.role_code||'STAFF')?'selected':''}>${esc(role.name)}</option>`).join('')}</select></label>
      <label class="record-check"><input type="checkbox" name="liveAccess" ${user?.live_access!==0?'checked':''}><span>Live access</span></label>
      <label class="record-check"><input type="checkbox" name="active" ${user?.active!==0?'checked':''}><span>Active</span></label>
    </div>
    <div class="access-selector">${groups}</div>
    <div class="modal-actions">${user?`<button type="button" class="command" id="issueCredential">${user.activated?'Reset Password':'Issue Activation'}</button>`:''}<button class="command primary">Save User</button></div>
  </form>`,'Module access');
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
      closeModal();
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
