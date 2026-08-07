/* ===================================================================
 * Blitz - ERP · chart system
 *
 * Every chart in the ERP is drawn here, so they read as one system rather
 * than as whatever each screen felt like. No library: inline SVG only, so
 * there is nothing to load, nothing to version, and it works on a warehouse
 * phone with no signal.
 *
 * The palette is validated, not chosen by eye - eight categorical hues that
 * clear the colourblind and normal-vision separation floors on a white
 * surface. Three of them sit below 3:1 contrast, so every chart ships with
 * direct labels and a table view; colour never carries meaning on its own.
 *
 * Rules held throughout: one axis, never two. Hues assigned in fixed order,
 * never cycled. Status colours reserved for state and never reused as a
 * series. Text wears ink, never the data colour.
 * =================================================================== */

export const VIZ = {
  series: ['#2a78d6','#eb6834','#1baf7a','#eda100','#e87ba4','#008300','#4a3aa7','#e34948'],
  status: { good:'#0ca30c', warning:'#fab219', serious:'#ec835a', critical:'#d03b3b' },
  surface:'#ffffff',
  ink:'#0b0b0b', ink2:'#52514e', muted:'#898781',
  grid:'#e1e0d9', axis:'#c3c2b7',
  // A sequential ramp for magnitude: one hue, light to dark. Never a rainbow.
  ramp:['#cde2fb','#9ec5f4','#6da7ec','#3987e5','#256abf','#184f95','#0d366b'],
};

const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>(
  {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* A value a person reads at a glance, not an accountant's figure. */
export function compact(n){
  const v = Number(n)||0; const a = Math.abs(v);
  if (a >= 1e9) return (v/1e9).toFixed(a>=1e10?0:1).replace(/\.0$/,'')+'B';
  if (a >= 1e6) return (v/1e6).toFixed(a>=1e7?0:1).replace(/\.0$/,'')+'M';
  if (a >= 1e4) return (v/1e3).toFixed(0)+'K';
  if (a >= 1e3) return v.toLocaleString('en-US');
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
const money = n => '₱'+compact(n);

let uid = 0;
const nextId = () => 'viz'+(++uid);

/* Axis ticks a person can read: 0 / 500 / 1,000, never 0 / 437 / 874. */
function niceTicks(max, count){
  if (!(max>0)) return [0,1];
  const raw = max/(count||4);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1,2,2.5,5,10].map(m=>m*mag).find(s=>s>=raw) || 10*mag;
  const out=[]; for(let v=0; v<=max+step*0.001; v+=step) out.push(v);
  if (out[out.length-1] < max) out.push(out[out.length-1]+step);
  return out;
}

/* -------------------------------------------------------------- shell */
/*
 * Every chart is a figure: a title, the plot, a legend when there is more
 * than one series, and a table behind a toggle. The table is not a nicety -
 * it is how a value stays reachable when a hue is too light to label.
 */
function figure({ title, subtitle, body, legend, table, id, open, openLabel }){
  // A chart on a dashboard is a question. Giving the whole card a destination
  // means the answer is one click away instead of a hunt through the rail.
  return '<figure class="viz'+(open?' viz-clickable':'')+'" id="'+id+'"'
    + (open?' data-viz-open="'+esc(open)+'" tabindex="0" role="link"':'')
    + '>'
    + (title ? '<figcaption><span class="viz-title">'+esc(title)+'</span>'
        + (subtitle?'<span class="viz-sub">'+esc(subtitle)+'</span>':'')
        + (table?'<button type="button" class="viz-tbl-toggle" data-viz-table="'+id+'">Table</button>':'')
        + '</figcaption>' : '')
    + '<div class="viz-plot">'+body+'</div>'
    + (legend||'')
    + (table?'<div class="viz-table" hidden>'+table+'</div>':'')
    + (open?'<span class="viz-open">'+esc(openLabel||'Open')+' <i>&rsaquo;</i></span>':'')
    + '</figure>';
}

function legendOf(items){
  if (!items || items.length < 2) return '';   // one series needs no legend
  return '<ul class="viz-legend">'+items.map(i =>
    '<li><i style="background:'+i.color+'"></i>'+esc(i.label)+'</li>').join('')+'</ul>';
}

function tableOf(head, rows){
  return '<table><thead><tr>'+head.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead>'
    +'<tbody>'+rows.map(r=>'<tr>'+r.map((c,i)=>'<td'+(i?' class="num"':'')+'>'+esc(c)+'</td>').join('')+'</tr>').join('')
    +'</tbody></table>';
}

/* ------------------------------------------------------------- donut */
/*
 * A donut answers "what is this made of" for a handful of parts. More than
 * six and it stops being readable, so the tail folds into Other rather than
 * inventing a ninth hue.
 */
export function vizDonut(rows, opts){
  opts = opts||{};
  const id = nextId();
  let data = (rows||[]).filter(r=>Number(r.value)>0).slice();
  data.sort((a,b)=>Number(b.value)-Number(a.value));
  if (data.length > 6){
    const tail = data.slice(5);
    data = data.slice(0,5).concat([{label:'Other',
      value:tail.reduce((s,r)=>s+Number(r.value||0),0)}]);
  }
  const total = data.reduce((s,r)=>s+Number(r.value||0),0);
  // A circle with nothing in it is still a circle. Removing the card leaves a
  // hole in the grid that reads as a screen that failed to load, so an empty
  // donut keeps its ring, draws no arc, and says nought in the middle.
  if (!total) return emptyDonut(id, opts);

  const R = 54, r = 34, cx = 62, cy = 62;
  const GAP = 0.035;                       // the 2px surface gap, in radians
  let angle = -Math.PI/2;
  const arcs = data.map((row,i)=>{
    const color = row.color || VIZ.series[i % VIZ.series.length];
    const frac = Number(row.value)/total;
    const sweep = frac*Math.PI*2;
    const a0 = angle + (data.length>1?GAP/2:0);
    const a1 = angle + sweep - (data.length>1?GAP/2:0);
    angle += sweep;
    if (a1 <= a0) return '';
    const big = (a1-a0) > Math.PI ? 1 : 0;
    const p = (rad,ang)=>[cx+rad*Math.cos(ang), cy+rad*Math.sin(ang)];
    const [x0,y0]=p(R,a0), [x1,y1]=p(R,a1), [x2,y2]=p(r,a1), [x3,y3]=p(r,a0);
    return '<path d="M'+x0.toFixed(2)+' '+y0.toFixed(2)
      +'A'+R+' '+R+' 0 '+big+' 1 '+x1.toFixed(2)+' '+y1.toFixed(2)
      +'L'+x2.toFixed(2)+' '+y2.toFixed(2)
      +'A'+r+' '+r+' 0 '+big+' 0 '+x3.toFixed(2)+' '+y3.toFixed(2)+'Z" fill="'+color+'"'
      +' tabindex="0" role="img"'
      +' data-viz-tip="'+esc(row.label)+': '+esc(compact(row.value))
      +' ('+Math.round(frac*100)+'%)"></path>';
  }).join('');

  const centre = opts.centreLabel!==false
    ? '<text x="'+cx+'" y="'+(cy-2)+'" class="viz-hero" text-anchor="middle">'+esc(compact(total))+'</text>'
      +'<text x="'+cx+'" y="'+(cy+14)+'" class="viz-heroSub" text-anchor="middle">'+esc(opts.totalLabel||'Total')+'</text>'
    : '';

  return figure({ id, title:opts.title, subtitle:opts.subtitle,
    open:opts.open, openLabel:opts.openLabel,
    body:'<svg viewBox="0 0 124 124" class="viz-svg viz-donut" role="img" aria-label="'
      +esc(opts.title||'Breakdown')+'">'+arcs+centre+'</svg>',
    legend: legendOf(data.map((r,i)=>({label:r.label+' · '+compact(r.value),
      color:r.color||VIZ.series[i%VIZ.series.length]}))),
    table: tableOf([opts.keyLabel||'Item', opts.valueLabel||'Value'],
      data.map(r=>[r.label, compact(r.value)])) });
}

/* -------------------------------------------------------------- bars */
/*
 * Horizontal bars for comparing named things - the label has room to be a
 * real name instead of a truncated stub, which is why this beats columns
 * for "top 5 suppliers" or "documents pending".
 */
export function vizBars(rows, opts){
  opts = opts||{};
  const id = nextId();
  const data = (rows||[]).slice(0, opts.limit||8);
  if (!data.length) return emptyFigure(id, opts, 'Nothing to show yet');
  const max = Math.max.apply(null, data.map(r=>Math.abs(Number(r.value)||0)).concat([1]));
  const BAR = Math.min(24, opts.barSize||18);
  const ROW = BAR + 14;
  const LABEL = opts.labelWidth || 120;
  const W = 420, PAD_R = 54;
  const plotW = W - LABEL - PAD_R;
  const H = data.length*ROW + 6;
  const fmt = opts.money ? money : compact;

  const bars = data.map((row,i)=>{
    const y = i*ROW + 4;
    const v = Number(row.value)||0;
    const w = Math.max(v>0 ? 3 : 0, (Math.abs(v)/max)*plotW);
    const color = row.color || (opts.color || VIZ.series[0]);
    // 4px rounded data-end, square where it meets the baseline.
    const R = Math.min(4, w);
    const x = LABEL;
    const d = 'M'+x+' '+y+'h'+(w-R)+'a'+R+' '+R+' 0 0 1 '+R+' '+R
      +'v'+(BAR-2*R)+'a'+R+' '+R+' 0 0 1 '+(-R)+' '+R+'h'+(-(w-R))+'z';
    return '<g class="viz-bar" tabindex="0" data-viz-tip="'+esc(row.label)+': '+esc(fmt(v))+'">'
      + '<text x="'+(LABEL-8)+'" y="'+(y+BAR/2+4)+'" class="viz-cat" text-anchor="end">'+esc(row.label)+'</text>'
      + (w>0?'<path d="'+d+'" fill="'+color+'"/>':'')
      + '<text x="'+(LABEL+w+7)+'" y="'+(y+BAR/2+4)+'" class="viz-val">'+esc(fmt(v))+'</text>'
      + '</g>';
  }).join('');

  return figure({ id, title:opts.title, subtitle:opts.subtitle, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel,
    body:'<svg viewBox="0 0 '+W+' '+H+'" class="viz-svg" preserveAspectRatio="xMinYMin meet" role="img" aria-label="'
      +esc(opts.title||'Comparison')+'">'
      +'<line x1="'+LABEL+'" y1="0" x2="'+LABEL+'" y2="'+H+'" stroke="'+VIZ.axis+'" stroke-width="1"/>'
      +bars+'</svg>',
    table: tableOf([opts.keyLabel||'Item', opts.valueLabel||'Value'],
      data.map(r=>[r.label, fmt(Number(r.value)||0)])) });
}

/* ----------------------------------------------------------- columns */
/* Columns when the category is time-like and ordered left to right. */
export function vizColumns(rows, opts){
  opts = opts||{};
  const id = nextId();
  const data = (rows||[]).slice();
  if (!data.length) return emptyFigure(id, opts, 'Nothing to show yet');
  const fmt = opts.money ? money : compact;
  const max = Math.max.apply(null, data.map(r=>Math.abs(Number(r.value)||0)).concat([1]));
  const ticks = niceTicks(max, 4);
  const top = ticks[ticks.length-1];
  const W = 440, H = 210, PAD_L = 46, PAD_B = 30, PAD_T = 12;
  const plotW = W-PAD_L-14, plotH = H-PAD_B-PAD_T;
  const band = plotW/data.length;
  const BAR = Math.min(24, band-10);

  const grid = ticks.map(t=>{
    const y = PAD_T + plotH - (t/top)*plotH;
    return '<line x1="'+PAD_L+'" y1="'+y.toFixed(1)+'" x2="'+(W-14)+'" y2="'+y.toFixed(1)
      +'" stroke="'+VIZ.grid+'" stroke-width="1"/>'
      +'<text x="'+(PAD_L-8)+'" y="'+(y+4).toFixed(1)+'" class="viz-tick" text-anchor="end">'+esc(compact(t))+'</text>';
  }).join('');

  const cols = data.map((row,i)=>{
    const v = Number(row.value)||0;
    const h = Math.max(v>0?2:0, (v/top)*plotH);
    const x = PAD_L + i*band + (band-BAR)/2;
    const y = PAD_T + plotH - h;
    const color = row.color || opts.color || VIZ.series[0];
    const R = Math.min(4, h, BAR/2);
    const d = 'M'+x+' '+(y+R)+'a'+R+' '+R+' 0 0 1 '+R+' '+(-R)+'h'+(BAR-2*R)
      +'a'+R+' '+R+' 0 0 1 '+R+' '+R+'v'+(h-R)+'h'+(-BAR)+'z';
    return '<g class="viz-bar" tabindex="0" data-viz-tip="'+esc(row.label)+': '+esc(fmt(v))+'">'
      + (h>0?'<path d="'+d+'" fill="'+color+'"/>':'')
      + '<text x="'+(x+BAR/2)+'" y="'+(H-PAD_B+16)+'" class="viz-cat" text-anchor="middle">'+esc(row.label)+'</text>'
      + '</g>';
  }).join('');

  return figure({ id, title:opts.title, subtitle:opts.subtitle, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel,
    body:'<svg viewBox="0 0 '+W+' '+H+'" class="viz-svg" role="img" aria-label="'+esc(opts.title||'Trend')+'">'
      +grid
      +'<line x1="'+PAD_L+'" y1="'+(PAD_T+plotH)+'" x2="'+(W-14)+'" y2="'+(PAD_T+plotH)
      +'" stroke="'+VIZ.axis+'" stroke-width="1"/>'
      +cols+'</svg>',
    table: tableOf([opts.keyLabel||'Period', opts.valueLabel||'Value'],
      data.map(r=>[r.label, fmt(Number(r.value)||0)])) });
}

/* -------------------------------------------------------------- line */
/*
 * Change over time. One y-scale only - two measures of different size get
 * two charts, never a second axis, because a dual axis lets the author put
 * the crossing point wherever they like.
 */
export function vizLine(series, opts){
  opts = opts||{};
  const id = nextId();
  const sets = (series||[]).filter(s=>s && (s.points||[]).length);
  if (!sets.length) return emptyFigure(id, opts, 'Nothing to show yet');
  const fmt = opts.money ? money : compact;
  const labels = sets[0].points.map(p=>p.label);
  const max = Math.max.apply(null, sets.flatMap(s=>s.points.map(p=>Number(p.value)||0)).concat([1]));
  const ticks = niceTicks(max, 4);
  const top = ticks[ticks.length-1];
  const W = 440, H = 210, PAD_L = 46, PAD_B = 28, PAD_T = 12, PAD_R = 54;
  const plotW = W-PAD_L-PAD_R, plotH = H-PAD_B-PAD_T;
  const xOf = i => PAD_L + (labels.length===1 ? plotW/2 : (i/(labels.length-1))*plotW);
  const yOf = v => PAD_T + plotH - ((Number(v)||0)/top)*plotH;

  const grid = ticks.map(t=>{
    const y = yOf(t);
    return '<line x1="'+PAD_L+'" y1="'+y.toFixed(1)+'" x2="'+(W-PAD_R)+'" y2="'+y.toFixed(1)
      +'" stroke="'+VIZ.grid+'" stroke-width="1"/>'
      +'<text x="'+(PAD_L-8)+'" y="'+(y+4).toFixed(1)+'" class="viz-tick" text-anchor="end">'+esc(compact(t))+'</text>';
  }).join('');

  const xLabels = labels.map((l,i)=>
    '<text x="'+xOf(i).toFixed(1)+'" y="'+(H-PAD_B+16)+'" class="viz-cat" text-anchor="middle">'+esc(l)+'</text>'
  ).join('');

  const paths = sets.map((s,si)=>{
    const color = s.color || VIZ.series[si % VIZ.series.length];
    const d = s.points.map((p,i)=>(i?'L':'M')+xOf(i).toFixed(1)+' '+yOf(p.value).toFixed(1)).join('');
    const dots = s.points.map((p,i)=>
      '<circle cx="'+xOf(i).toFixed(1)+'" cy="'+yOf(p.value).toFixed(1)+'" r="4" fill="'+color
      +'" stroke="'+VIZ.surface+'" stroke-width="2" tabindex="0"'
      +' data-viz-tip="'+esc(s.label)+' · '+esc(p.label)+': '+esc(fmt(p.value))+'"></circle>').join('');
    const last = s.points[s.points.length-1];
    // Label the end of the line, not every point.
    const endLabel = '<text x="'+(xOf(s.points.length-1)+9).toFixed(1)+'" y="'+(yOf(last.value)+4).toFixed(1)
      +'" class="viz-val">'+esc(fmt(last.value))+'</text>';
    return '<path d="'+d+'" fill="none" stroke="'+color
      +'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'+dots+endLabel;
  }).join('');

  return figure({ id, title:opts.title, subtitle:opts.subtitle, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel,
    body:'<svg viewBox="0 0 '+W+' '+H+'" class="viz-svg" role="img" aria-label="'+esc(opts.title||'Trend')+'">'
      +grid
      +'<line x1="'+PAD_L+'" y1="'+(PAD_T+plotH)+'" x2="'+(W-PAD_R)+'" y2="'+(PAD_T+plotH)
      +'" stroke="'+VIZ.axis+'" stroke-width="1"/>'
      +xLabels+paths+'</svg>',
    legend: legendOf(sets.map((s,i)=>({label:s.label, color:s.color||VIZ.series[i%VIZ.series.length]}))),
    table: tableOf([opts.keyLabel||'Period'].concat(sets.map(s=>s.label)),
      labels.map((l,i)=>[l].concat(sets.map(s=>fmt(s.points[i]?s.points[i].value:0))))) });
}


/* -------------------------------------------------------------- ring */
/*
 * One proportion, read as a figure. The track is a light step of the fill's
 * own ramp so the whole arc carries state, and the number sits in the middle
 * where the eye already is.
 */
export function vizRing(pct, opts){
  opts = opts||{};
  const id = nextId();
  const v = Math.max(0, Math.min(100, Number(pct)||0));
  const tone = opts.tone && VIZ.status[opts.tone] ? VIZ.status[opts.tone] : (opts.color || VIZ.series[0]);
  const R = 52, C = 2*Math.PI*R, cx = 64, cy = 64, STROKE = 12;
  const dash = (v/100)*C;
  /*
   * Zero draws no arc at all. A round line cap on a zero-length dash still
   * paints a dot, which reads as "a little bit" when the answer is none - so
   * the arc is omitted entirely, and the cap only rounds once the arc is
   * longer than the stroke is wide.
   */
  const arc = v > 0
    ? '<circle cx="'+cx+'" cy="'+cy+'" r="'+R+'" fill="none" stroke="'+tone+'" stroke-width="'+STROKE+'"'
      +' stroke-linecap="'+(dash >= STROKE ? 'round' : 'butt')+'"'
      +' stroke-dasharray="'+dash.toFixed(1)+' '+(C-dash).toFixed(1)+'"'
      +' transform="rotate(-90 '+cx+' '+cy+')" class="viz-ring-arc"/>'
    : '';
  const body = '<svg viewBox="0 0 128 128" class="viz-svg viz-ring'+(v>0?'':' is-empty')+'" role="img" aria-label="'
    +esc((opts.title||'Progress')+': '+Math.round(v)+'%')+'"'
    +' tabindex="0" data-viz-tip="'+esc(opts.tipLabel||opts.title||'Progress')+': '+Math.round(v)+'%">'
    +'<circle cx="'+cx+'" cy="'+cy+'" r="'+R+'" fill="none" stroke="'+(opts.track||'#e8eef4')+'" stroke-width="'+STROKE+'"/>'
    +arc
    +'<text x="'+cx+'" y="'+(cy+(opts.caption?0:7))+'" class="viz-ring-value'+(v>0?'':' is-zero')+'" text-anchor="middle">'
      +esc(opts.valueLabel!=null?opts.valueLabel:Math.round(v)+'%')+'</text>'
    +(opts.caption?'<text x="'+cx+'" y="'+(cy+18)+'" class="viz-heroSub" text-anchor="middle">'+esc(opts.caption)+'</text>':'')
    +'</svg>';
  return figure({ id, title:opts.title, subtitle:opts.subtitle, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, body,
    table: tableOf([opts.keyLabel||'Measure','Value'], [[opts.title||'Progress', Math.round(v)+'%']]) });
}

/* A 12-point sparkline for a stat tile. Trend only - it carries no axis, so
   it never pretends to be readable as values. */
function sparkline(points, color){
  const data = (points||[]).map(p=>Number(p&&p.value!=null?p.value:p)||0);
  if (data.length < 2) return '';
  if (!data.some(v => v > 0)) return '';   // no history is not a flat line
  const max = Math.max.apply(null, data.concat([1]));
  const W = 74, H = 22, band = W/data.length;
  const bars = data.map((v,i)=>{
    const h = Math.max(2, (v/max)*H);
    const x = i*band, w = Math.max(2, band-2);
    return '<rect x="'+x.toFixed(1)+'" y="'+(H-h).toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+h.toFixed(1)
      +'" rx="1.5" fill="'+color+'" opacity="'+(i===data.length-1?1:0.42)+'"/>';
  }).join('');
  return '<svg viewBox="0 0 '+W+' '+H+'" class="viz-spark" aria-hidden="true">'+bars+'</svg>';
}

/* ------------------------------------------------------- status tiles */
/*
 * The coloured row across the top of a cockpit. Each tile is a state, so it
 * wears a status colour - never a series hue - and always carries its label
 * and count, because a colour alone does not say "delayed".
 */
export function vizTiles(tiles, opts){
  opts = opts||{};
  const list = (tiles||[]).filter(Boolean);
  if (!list.length) return '';
  return '<div class="viz-tiles">'+list.map(t=>{
    const tone = t.tone && VIZ.status[t.tone] ? t.tone : 'neutral';
    const pct = t.pct==null ? '' : '<b class="viz-tile-pct">'+Math.round(t.pct)+'%</b>';
    const spark = t.spark ? sparkline(t.spark, (t.tone&&VIZ.status[t.tone])||VIZ.series[0]) : '';
    // A delta is signed, named against a period, and coloured by whether the
    // direction is good here - not by whether the arrow points up.
    let delta = '';
    if (t.delta && t.delta.value != null && t.delta.value !== 0) {
      const up = Number(t.delta.value) > 0;
      const good = t.delta.upIsGood === false ? !up : up;
      delta = '<small class="viz-tile-delta '+(good?'up':'down')+'">'
        + (up?'\u2191':'\u2193') + ' ' + esc(Math.abs(Number(t.delta.value)).toFixed(1)) + '% '
        + '<i>' + esc(t.delta.period || 'vs last period') + '</i></small>';
    }
    const dest = t.module || t.section;
    const zero = !(Number(t.value) > 0);
    return '<button type="button" class="viz-tile '+tone+(dest?' is-clickable':'')+(zero?' is-zero':'')+'"'
      + (t.module?' data-viz-open="'+esc(t.module)+'"':'')
      + (!t.module&&t.section?' data-viz-go="'+esc(t.section)+'"':'')
      + (t.match?' data-viz-match="'+esc(t.match)+'"':'')
      + '><span class="viz-tile-label">'+esc(t.label)+'</span>'
      + (spark?'<span class="viz-tile-spark">'+spark+'</span>':'')
      + '<span class="viz-tile-row"><b class="viz-tile-value">'+esc(compact(t.value))
        + (t.suffix?'<i class="viz-tile-unit">'+esc(t.suffix)+'</i>':'')+'</b>'+pct+'</span>'
      + (delta || (t.sub?'<small>'+esc(t.sub)+'</small>':''))+'</button>';
  }).join('')+'</div>';
}

/* ------------------------------------------------------------- meter */
/* A single proportion. The track is a lighter step of the fill's own ramp. */
export function vizMeter(rows, opts){
  opts = opts||{};
  const id = nextId();
  const data = (rows||[]).slice(0,8);
  if (!data.length) return emptyFigure(id, opts, 'Nothing to show yet');
  const body = '<ul class="viz-meters">'+data.map(r=>{
    const pct = Math.max(0, Math.min(100, Number(r.pct)||0));
    const tone = r.tone && VIZ.status[r.tone] ? VIZ.status[r.tone] : (r.color||VIZ.series[0]);
    return '<li tabindex="0" data-viz-tip="'+esc(r.label)+': '+Math.round(pct)+'%">'
      +'<span class="viz-meter-head"><span>'+esc(r.label)+'</span>'
      +'<b'+(pct>0?'':' class="is-zero"')+'>'+esc(r.valueLabel!=null?r.valueLabel:Math.round(pct)+'%')+'</b></span>'
      +'<span class="viz-meter-track">'
      +(pct>0?'<i style="width:'+pct.toFixed(1)+'%;background:'+tone+'"></i>':'')
      +'</span></li>';
  }).join('')+'</ul>';
  return figure({ id, title:opts.title, subtitle:opts.subtitle, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, open:opts.open, openLabel:opts.openLabel, body,
    table: tableOf([opts.keyLabel||'Item','Progress'],
      data.map(r=>[r.label, Math.round(Number(r.pct)||0)+'%'])) });
}

function emptyFigure(id, opts, message){
  return figure({ id, title:opts.title, subtitle:opts.subtitle,
    open:opts.open, openLabel:opts.openLabel,
    body:'<p class="viz-empty">'+esc(message)+'</p>' });
}

function emptyDonut(id, opts){
  const R = 54, r = 34, cx = 62, cy = 62;
  const stroke = R - r;
  const track = '<circle cx="'+cx+'" cy="'+cy+'" r="'+((R+r)/2)+'" fill="none" stroke="#e8eef4"'
    +' stroke-width="'+stroke+'"></circle>';
  const centre = opts.centreLabel!==false
    ? '<text x="'+cx+'" y="'+(cy-2)+'" class="viz-hero is-zero" text-anchor="middle">0</text>'
      +'<text x="'+cx+'" y="'+(cy+14)+'" class="viz-heroSub" text-anchor="middle">'
      +esc(opts.totalLabel||'Total')+'</text>'
    : '';
  return figure({ id, title:opts.title, subtitle:opts.subtitle,
    open:opts.open, openLabel:opts.openLabel,
    body:'<svg viewBox="0 0 124 124" class="viz-svg viz-donut is-empty" role="img" aria-label="'
      +esc(opts.title||'Breakdown')+'">'+track+centre+'</svg>' });
}

/* --------------------------------------------------------- behaviour */
/*
 * One delegated listener for the whole page rather than a handler per mark -
 * a cockpit can hold several hundred marks and they should cost nothing.
 */
let bound = false;
export function bindViz(root, onNavigate, onOpen){
  const scope = root || document;
  scope.querySelectorAll('[data-viz-table]').forEach(btn=>{
    btn.onclick = () => {
      const fig = document.getElementById(btn.dataset.vizTable);
      const tbl = fig && fig.querySelector('.viz-table');
      if (!tbl) return;
      const showing = !tbl.hasAttribute('hidden');
      if (showing) tbl.setAttribute('hidden',''); else tbl.removeAttribute('hidden');
      btn.classList.toggle('on', !showing);
      btn.textContent = showing ? 'Table' : 'Chart';
      const plot = fig.querySelector('.viz-plot');
      if (plot) plot.style.display = showing ? '' : 'none';
    };
  });
  if (typeof onNavigate === 'function'){
    scope.querySelectorAll('[data-viz-go]').forEach(tile=>{
      tile.onclick = () => onNavigate(tile.dataset.vizGo, tile.dataset.vizMatch||'');
    });
  }
  if (typeof onOpen === 'function'){
    scope.querySelectorAll('[data-viz-open]').forEach(el=>{
      el.onclick = (e) => {
        // The table toggle lives inside a clickable card; it must not navigate.
        if (e.target.closest('[data-viz-table]')) return;
        onOpen(el.getAttribute('data-viz-open'));
      };
      el.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(el.getAttribute('data-viz-open')); }
      };
    });
  }
  if (bound) return;
  bound = true;
  const tip = document.createElement('div');
  tip.className = 'viz-tip'; tip.hidden = true;
  document.body.appendChild(tip);
  const show = (target, x, y) => {
    tip.textContent = target.getAttribute('data-viz-tip');
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(6, Math.min(window.innerWidth-w-6, x-w/2))+'px';
    tip.style.top  = Math.max(6, y-h-12)+'px';
  };
  document.addEventListener('mousemove', e=>{
    const t = e.target.closest && e.target.closest('[data-viz-tip]');
    if (t) show(t, e.clientX, e.clientY); else tip.hidden = true;
  }, {passive:true});
  document.addEventListener('focusin', e=>{
    const t = e.target.closest && e.target.closest('[data-viz-tip]');
    if (!t) { tip.hidden = true; return; }
    const r = t.getBoundingClientRect();
    show(t, r.left+r.width/2, r.top);
  });
  document.addEventListener('scroll', ()=>{ tip.hidden = true; }, {passive:true, capture:true});
}

/* ----------------------------------------------------------- the CSS */
export const VIZ_CSS = `
.viz{margin:0;padding:13px 15px 11px;background:#fff;border:1px solid #e8eef4;border-radius:10px;min-width:0;
  box-shadow:0 1px 2px rgba(10,34,57,.05),0 4px 14px rgba(10,34,57,.05)}
.viz figcaption{display:flex;align-items:baseline;gap:8px;margin-bottom:10px}
.viz-title{font-size:12.5px;font-weight:700;color:#0b0b0b}
.viz-sub{font-size:10.5px;color:${VIZ.muted}}
.viz-clickable{cursor:pointer;transition:transform .16s ease,box-shadow .16s ease}
.viz-clickable:hover{transform:translateY(-2px);box-shadow:0 2px 4px rgba(10,34,57,.06),0 10px 24px rgba(10,34,57,.10)}
.viz-clickable:focus-visible{outline:2px solid #2a78d6;outline-offset:2px}
.viz-open{display:block;margin-top:9px;padding-top:8px;border-top:1px solid #f0f4f8;
  font-size:11px;font-weight:700;color:#1669a7}
.viz-open i{font-style:normal}
.viz-tile.is-clickable{cursor:pointer}
.viz-tile:not(.is-clickable){cursor:default;box-shadow:0 1px 2px rgba(10,34,57,.05),0 4px 14px rgba(10,34,57,.05)}
.viz-tile:not(.is-clickable):hover{transform:none;box-shadow:0 1px 2px rgba(10,34,57,.05),0 4px 14px rgba(10,34,57,.05)}
.viz-tbl-toggle{margin-left:auto;padding:3px 9px;border:1px solid #c9d6e0;border-radius:999px;
  background:#fff;color:#42506a;font-size:10px;cursor:pointer}
.viz-tbl-toggle.on{background:#eef4f9;border-color:#a9c3d6;color:#14507f}
.viz-plot{min-height:40px}
.viz-svg{display:block;width:100%;height:auto;max-height:230px;overflow:visible}
.viz-donut{max-width:190px;margin:0 auto}
.viz-cat{font-size:10px;fill:${VIZ.ink2}}
.viz-tick{font-size:9.5px;fill:${VIZ.muted};font-variant-numeric:tabular-nums}
.viz-val{font-size:10.5px;font-weight:700;fill:${VIZ.ink}}
.viz-hero{font-size:20px;font-weight:700;fill:${VIZ.ink}}
.viz-hero.is-zero{fill:${VIZ.muted}}
.viz-heroSub{font-size:8.5px;fill:${VIZ.muted};text-transform:uppercase;letter-spacing:.7px}
.viz-bar{cursor:default}
.viz-bar:focus{outline:none}
.viz-bar:focus-visible path{stroke:${VIZ.ink};stroke-width:2}
.viz-empty{margin:0;padding:22px 0;text-align:center;color:${VIZ.muted};font-size:11px}
.viz-legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:10px 0 0;padding:0;list-style:none}
.viz-legend li{display:flex;align-items:center;gap:6px;font-size:10.5px;color:${VIZ.ink2}}
.viz-legend i{width:9px;height:9px;border-radius:2px;flex:0 0 auto}
.viz-table{margin-top:8px;max-height:230px;overflow:auto}
.viz-table table{width:100%;border-collapse:collapse;font-size:11px}
.viz-table th,.viz-table td{padding:5px 8px;border-bottom:1px solid #eef2f6;text-align:left}
.viz-table th{color:${VIZ.muted};font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
.viz-table td.num{text-align:right;font-variant-numeric:tabular-nums}

.viz-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:8px;margin-bottom:10px}
/* Depth, not a coloured rule: the tiles are one calm surface and the number
   carries the weight. State still reads - it is on the dot beside the label,
   so the tile never leans on colour alone. */
.viz-tile{display:flex;flex-direction:column;gap:3px;padding:11px 13px;border:1px solid #e8eef4;
  border-radius:10px;background:#fff;text-align:left;cursor:pointer;
  box-shadow:0 1px 2px rgba(10,34,57,.05),0 4px 14px rgba(10,34,57,.05);
  transition:transform .16s ease,box-shadow .16s ease}
.viz-tile:hover{transform:translateY(-2px);box-shadow:0 2px 4px rgba(10,34,57,.06),0 10px 24px rgba(10,34,57,.10)}
.viz-tile-label{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:700;
  color:${VIZ.ink2};text-transform:uppercase;letter-spacing:.5px}
.viz-tile-label:before{content:"";width:7px;height:7px;border-radius:50%;background:#c9d4de;flex:0 0 auto}
.viz-tile.good .viz-tile-label:before{background:${VIZ.status.good}}
.viz-tile.warning .viz-tile-label:before{background:${VIZ.status.warning}}
.viz-tile.serious .viz-tile-label:before{background:${VIZ.status.serious}}
.viz-tile.critical .viz-tile-label:before{background:${VIZ.status.critical}}
.viz-tile-row{display:flex;align-items:baseline;justify-content:space-between;gap:6px}
.viz-tile-value{font-size:22px;font-weight:700;color:${VIZ.ink};line-height:1.05}
.viz-tile-unit{font-style:normal;font-size:14px;font-weight:700;color:${VIZ.ink2};margin-left:1px}
.viz-tile-pct{font-size:11px;font-weight:700;color:${VIZ.ink2}}
.viz-tile small{font-size:10px;color:${VIZ.muted}}

.viz-ring{max-width:172px;margin:0 auto;display:block}
.viz-ring-arc{transition:stroke-dasharray .6s cubic-bezier(.2,.8,.25,1)}
.viz-ring-value{font-size:23px;font-weight:700;fill:${VIZ.ink}}
.viz-ring-value.is-zero{fill:${VIZ.muted}}
.viz-meter-head b.is-zero{color:${VIZ.muted}}
/* A tile reading zero has nothing to report, so its state dot goes quiet. */
.viz-tile.is-zero .viz-tile-label:before{background:#dbe3ea!important}
.viz-tile.is-zero .viz-tile-value{color:${VIZ.muted}}
.viz-spark{display:block;width:74px;height:22px;margin:2px 0 1px}
.viz-tile-spark{display:block}
.viz-tile-delta{display:block;font-size:10.5px;font-weight:700}
.viz-tile-delta.up{color:#0d7a34}
.viz-tile-delta.down{color:#a52a2a}
.viz-tile-delta i{font-style:normal;font-weight:400;color:${VIZ.muted}}

.viz-meters{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:9px}
.viz-meters li{display:flex;flex-direction:column;gap:4px}
.viz-meter-head{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:${VIZ.ink2}}
.viz-meter-head b{color:${VIZ.ink};font-variant-numeric:tabular-nums}
.viz-meter-track{display:block;height:8px;border-radius:999px;background:#e8eef4;overflow:hidden}
.viz-meter-track i{display:block;height:100%;border-radius:999px}

/* Cards have an upper width as well as a lower one: one chart on its own must
   not stretch across a 1700px screen just because there is room. */
.viz-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,460px));
  justify-content:start;gap:9px;margin-bottom:10px}
.viz-grid.two{grid-template-columns:repeat(auto-fit,minmax(320px,560px))}

.viz-tip{position:fixed;z-index:9999;padding:5px 9px;border-radius:5px;background:rgba(11,11,11,.92);
  color:#fff;font-size:11px;pointer-events:none;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.28)}

@media (max-width:720px){
  .viz-grid,.viz-grid.two{grid-template-columns:1fr}
  .viz-svg{max-height:200px}
  .viz-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
  .viz-tile-value{font-size:19px}
}
@media print{ .viz-tbl-toggle{display:none} .viz-table{display:block!important} }
`;
