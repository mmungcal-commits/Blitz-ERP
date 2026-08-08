/*
 * The Request for Payment form, exactly as E88 print it.
 *
 * This lives on its own because two very different pages need the same piece of
 * paper and they must not drift: the Print RFP button inside Blitz, and the
 * login-free page Monde Nissin open from the dispatch email. A form that shows
 * four signatures in the office and three to the payer is worse than no form.
 *
 * Pure string building, no DOM: the only things it borrows from its caller are
 * a date formatter and the origin the logo is served from.
 */
const RFPDOC_ESC = v => String(v == null ? '' : v)
  .replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const RFPDOC_DATE = v => {
  if (!v) return '';
  const d = new Date(String(v).length <= 10 ? String(v) + 'T00:00:00' : v);
  return isNaN(d) ? String(v)
    : d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
};

  export function rfpDocumentHtml(r,opts){
    r=r||{};opts=opts||{};var esc=RFPDOC_ESC;var czd=opts.date||RFPDOC_DATE;
    var origin=opts.origin||'';var cur=r.currency||'PHP';
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
     +'<table style="width:100%;border-collapse:collapse;margin-bottom:10px"><tr><td style="width:30%;vertical-align:middle"><img src="'+origin+'/logo.png" style="height:42px"></td>'
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
