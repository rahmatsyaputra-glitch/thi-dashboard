Chart.register(ChartDataLabels);
// Global tooltip styling — matches the dashboard's navy/rounded card language instead of
// Chart.js's generic dark box. Applies to every chart automatically; per-chart `callbacks`
// (which control tooltip *content*) still work exactly as before.
Chart.defaults.plugins.tooltip.backgroundColor='#14213D';
Chart.defaults.plugins.tooltip.titleColor='#fff';
Chart.defaults.plugins.tooltip.bodyColor='rgba(255,255,255,.85)';
Chart.defaults.plugins.tooltip.padding=10;
Chart.defaults.plugins.tooltip.cornerRadius=8;
Chart.defaults.plugins.tooltip.titleFont={size:12,weight:'700'};
Chart.defaults.plugins.tooltip.bodyFont={size:11.5};
Chart.defaults.plugins.tooltip.displayColors=false;
Chart.defaults.plugins.tooltip.boxPadding=4;
Chart.defaults.plugins.tooltip.caretSize=6;
Chart.register({
  id:'barSoftShadow',
  beforeDatasetDraw(chart){
    const ctx=chart.ctx;
    ctx.save();
    ctx.shadowColor='rgba(15,23,42,.22)';
    ctx.shadowBlur=10;
    ctx.shadowOffsetY=5;
  },
  afterDatasetDraw(chart){ chart.ctx.restore(); }
});
// Lighten/darken an rgb()/#hex color by percent (positive = lighter, negative = darker)
function shadeRGB(color, percent){
  let r,g,b;
  const hexM = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if(hexM){ r=parseInt(hexM[1],16); g=parseInt(hexM[2],16); b=parseInt(hexM[3],16); }
  else { const m=color.match(/\d+/g).map(Number); [r,g,b]=m; }
  const t = percent<0?0:255, p=Math.abs(percent)/100;
  r=Math.round((t-r)*p)+r; g=Math.round((t-g)*p)+g; b=Math.round((t-b)*p)+b;
  return `rgb(${r},${g},${b})`;
}
// Vertical bevel gradient for a bar's fill — subtle light-to-dark, gives a raised/embossed look
// without distorting the actual data value (unlike literal 3D charts).
function barBevelGradient(chart, colorIndex, colorArr){
  const {ctx:c, chartArea}=chart;
  if(!chartArea) return colorArr[colorIndex];
  const base=colorArr[colorIndex];
  const grad=c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  grad.addColorStop(0, shadeRGB(base,22));
  grad.addColorStop(0.5, base);
  grad.addColorStop(1, shadeRGB(base,-14));
  return grad;
}
// Same bevel idea but as a CSS string, for the plain HTML/CSS bars (rank/area/diverging bars)
function barGradCSS(hex){
  return `linear-gradient(180deg, ${shadeRGB(hex,28)} 0%, ${hex} 50%, ${shadeRGB(hex,-16)} 100%)`;
}
const G={green:'#14213D',green2:'#FCA311',greenMd:'#1e2f54',blue:'#14213D',amber:'#FCA311',red:'#EF4444',purple:'#8B5CF6',text:'#0d1829',text2:'#3a4a6b',text3:'#7a8aaa',gold:'#FCA311',goldDk:'#c97a00',navy:'#14213D'};
const STATE={method:'avg',dept:'all',tenure:'all',city:'all',decimals:false,activeTab:'overview',fbPage:1,fbSearch:'',fbType:'all',fbDept:'all',fbTenure:'all',PER_PAGE:12};
let CH={};

// ── ANIMATION HELPERS ────────────────────────────────────────────────
function animateNumber(el, to, opts={}){
  if(!el || to===null || to===undefined || isNaN(to)) return;
  const {decimals=0, duration=850, suffix='', prefix=''}=opts;
  // Cancel any in-flight animation on this element first — without this, rapid
  // re-triggers (e.g. quickly switching filters) start a second rAF loop that
  // fights the first one over the same element, causing the number to flicker.
  if(el._cuRaf){ cancelAnimationFrame(el._cuRaf); el._cuRaf=null; }
  const from = parseFloat(el.dataset.cuVal); const start = isNaN(from)?0:from;
  if(Math.abs(start-to)<0.005){el.textContent=`${prefix}${to.toFixed(decimals)}${suffix}`;el.dataset.cuVal=to;return}
  el.classList.remove('value-pulse'); void el.offsetWidth; el.classList.add('value-pulse');
  const t0=performance.now();
  function tick(now){
    const p=Math.min((now-t0)/duration,1);
    const eased=1-Math.pow(1-p,3);
    const val=start+(to-start)*eased;
    el.textContent=`${prefix}${val.toFixed(decimals)}${suffix}`;
    el.dataset.cuVal=val; // keep this current so a mid-flight re-trigger continues smoothly instead of jumping back to a stale value
    if(p<1){ el._cuRaf=requestAnimationFrame(tick); } else { el.dataset.cuVal=to; el._cuRaf=null; }
  }
  el._cuRaf=requestAnimationFrame(tick);
}
// Grows a bar/fill element's width from 0 on first paint, then transitions normally after
function animateWidth(el, pct){
  if(!el) return;
  const target=`${Math.max(0,Math.min(pct,100))}%`;
  if(!el.dataset.wInit){el.style.width='0%';el.dataset.wInit='1';requestAnimationFrame(()=>requestAnimationFrame(()=>{el.style.width=target}))}
  else el.style.width=target;
}
// Cross-fades an element's content instead of an abrupt innerHTML swap — used for
// tables/lists that change on filter/method changes. Skipped on the very first render
// (DASHBOARD_READY still false) so initial load keeps its normal entrance animation.
let DASHBOARD_READY=false;
// ══════════════════════════════════════════════════════════════════════
// CUSTOM DROPDOWN — replaces the browser's native <select> popup (which
// can't be styled/animated at all) with a fully custom, brand-matched one.
// The original <select> stays in the DOM (just visually hidden) and stays
// the single source of truth — every existing filter listener, fillFilters(),
// programmatic `.value = ...` reset, etc. keeps working completely unchanged.
// ══════════════════════════════════════════════════════════════════════
function enhanceSelect(selectEl){
  if(!selectEl || selectEl._enhanced) return;
  selectEl._enhanced = true;
  const chip = selectEl.closest('.filter-chip') || selectEl.parentElement;
  if(!chip) return;
  chip.classList.add('m3-dd');
  chip.setAttribute('tabindex','0');
  chip.setAttribute('role','button');
  selectEl.setAttribute('tabindex','-1');
  selectEl.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:1px;height:1px';

  const label = document.createElement('span');
  label.className = 'm3-dd-label';
  chip.insertBefore(label, selectEl);

  const caret = document.createElement('i');
  caret.className = 'ti ti-chevron-down m3-dd-caret';
  chip.appendChild(caret);

  const menu = document.createElement('div');
  menu.className = 'm3-dd-menu';
  chip.appendChild(menu);

  function buildMenu(){
    menu.innerHTML='';
    [...selectEl.options].forEach(opt=>{
      const item=document.createElement('div');
      item.className='m3-dd-item'+(opt.value===selectEl.value?' selected':'')+(opt.disabled?' disabled':'');
      item.textContent=opt.textContent;
      if(!opt.disabled){
        item.addEventListener('click',(e)=>{
          e.stopPropagation();
          selectEl.value=opt.value; // goes through the overridden setter below -> syncs label automatically
          selectEl.dispatchEvent(new Event('change',{bubbles:true}));
          closeMenu();
        });
      }
      menu.appendChild(item);
    });
  }
  function syncLabel(){ const opt=selectEl.options[selectEl.selectedIndex]; label.textContent=opt?opt.textContent:''; }
  function openMenu(){
    document.querySelectorAll('.m3-dd.open').forEach(o=>{ if(o!==chip) o.classList.remove('open'); });
    buildMenu();
    chip.classList.add('open');
  }
  function closeMenu(){ chip.classList.remove('open'); }

  chip.addEventListener('click',(e)=>{
    e.stopPropagation();
    chip.classList.contains('open') ? closeMenu() : openMenu();
  });
  chip.addEventListener('keydown',(e)=>{
    if(e.key==='Enter'||e.key===' '){ e.preventDefault(); chip.classList.contains('open')?closeMenu():openMenu(); }
  });

  // fillFilters()/populateDeptCityOptions() rebuild the <option> list via innerHTML —
  // catch that here so the custom menu (and label) stay in sync automatically.
  const mo=new MutationObserver(()=>{ syncLabel(); if(chip.classList.contains('open')) buildMenu(); });
  mo.observe(selectEl,{childList:true});

  // Existing code resets filters via `document.getElementById(...).value = 'all'` in
  // several places (Reset button, quarter-change handler, etc). Overriding the setter
  // here means the custom label updates automatically for ALL of those, with no need
  // to touch that code at all.
  const nativeDesc=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');
  Object.defineProperty(selectEl,'value',{
    get(){ return nativeDesc.get.call(selectEl); },
    set(v){ nativeDesc.set.call(selectEl,v); syncLabel(); },
    configurable:true,
  });

  syncLabel();
}
function enhanceAllSelects(root=document){
  root.querySelectorAll('select.chip-select').forEach(enhanceSelect);
}
document.addEventListener('click', ()=>{ document.querySelectorAll('.m3-dd.open').forEach(o=>o.classList.remove('open')); });
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') document.querySelectorAll('.m3-dd.open').forEach(o=>o.classList.remove('open')); });

function refreshHTML(el, html, cb, duration=150){
  if(!el) return;
  if(!DASHBOARD_READY){ el.innerHTML=html; if(cb)cb(); return; }
  el.style.transition = `opacity ${duration}ms var(--m3-ease-standard)`;
  void el.offsetWidth; // same reflow-safety trick, applied symmetrically to the fade-out start
  el.style.opacity='0';
  setTimeout(()=>{
    el.innerHTML=html;
    void el.offsetWidth; // force a reflow so the browser registers "new content, opacity:0" as its own frame before animating to opacity:1 — otherwise the fade-in can get silently skipped
    el.style.opacity='1';
    if(cb)cb();
  }, duration);
}
// Counts every [data-cu] number span inside a container up from 0 (or its previous
// value) to its target — used for pill/table scores that get rebuilt as raw HTML
// strings each render, where animateNumber's per-element dataset tracking still
// works fine since dataset.cuVal persists on the element even after reflow.
function growNumbers(container, opts={}){
  if(!container) return;
  container.querySelectorAll('[data-cu]').forEach(el=>{
    const to=parseFloat(el.dataset.cu);
    if(isNaN(to)) return;
    animateNumber(el, to, {decimals:STATE.decimals?2:0, duration:opts.duration||900});
  });
}
// Grows every [data-w] bar-fill element inside a container from 0 to its target width,
// for bars that get rebuilt as raw HTML strings (so animateWidth's per-element dataset
// tracking doesn't apply — these are fresh DOM nodes every render).
function growBars(container){
  if(!container) return;
  const bars=[...container.querySelectorAll('[data-w]')];
  if(!bars.length) return;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    bars.forEach(b=>{ b.style.width=b.dataset.w; });
  }));
}

// ── FORMAT ────────────────────────────────────────────────────────
const dp=n=>STATE.decimals?(+n).toFixed(2):Math.round(+n).toString();
const pct=n=>(n===null||n===undefined||isNaN(n))?'—':`${dp(n)}%`;
const dlt=d=>{if(d===null||d===undefined||isNaN(d))return'—';const v=STATE.decimals?Math.abs(d).toFixed(2):Math.round(Math.abs(d)).toString();return d>0.001?`▲ +${v}%`:d<-0.001?`▼ -${v}%`:`= 0%`};
const dCls=d=>d>0.001?'up':d<-0.001?'dn':'na';
function barColor(v){if(v>=75)return G.navy;if(v>=65)return G.gold;return G.red}
function heatColor(v){if(v===null||v===undefined)return{bg:'#f8fafc',text:'#94a3b8'};let r,g,b;if(v<30){r=239;g=68;b=68}else if(v<42){r=252;g=165;b=165}else if(v<55){r=253;g=230;b=138}else if(v<68){r=187;g=247;b=208}else{r=74;g=222;b=128}const lum=0.299*r+0.587*g+0.114*b;return{bg:`rgb(${r},${g},${b})`,text:lum>155?'#1a1a1a':'#fff'}}
function sentiment(s){if(s>=80)return{l:'Excellent',ic:'ti-star',cl:'excellent',desc:'Outstanding employee happiness across the organization!'};if(s>=73)return{l:'Good',ic:'ti-mood-smile',cl:'good',desc:'Overall employee happiness remains healthy.'};if(s>=65)return{l:'Fair',ic:'ti-mood-neutral',cl:'fair',desc:'Some areas need attention to improve engagement.'};return{l:'Needs Attention',ic:'ti-mood-sad',cl:'low',desc:'Several critical areas require immediate action.'}}
const ICONS={vv:'ti-flag',ld:'ti-crown',tw:'ti-users-group',cm:'ti-message-circle',cu:'ti-heart',pd:'ti-seedling',ap:'ti-target-arrow',rc:'ti-award',ws:'ti-building',in:'ti-shield-check',tx:'ti-confetti'};

// ── HELPERS ────────────────────────────────────────────────────────
const MARKETING_COMBINED = 'Marketing (Combined)';
function getFiltered(){
  const q=THI.quarters[THI.activeQuarter];
  if(!q?.respondents) return [];
  return q.respondents.filter(r=>{
    let deptMatch;
    if(THI.scopedDept) deptMatch = r.deptGroup===THI.scopedDept; // token-scoped report: always group-level
    else if(STATE.dept==='all') deptMatch = true;
    else if(STATE.dept===MARKETING_COMBINED) deptMatch = r.deptGroup==='Marketing';
    else deptMatch = r.dept===STATE.dept;
    return deptMatch && (STATE.tenure==='all'||r.tenure===STATE.tenure) && (STATE.city==='all'||r.city===STATE.city);
  });
}
function getFilteredForQuarter(q){
  if(!q?.respondents) return [];
  return q.respondents.filter(r=>{
    let deptMatch;
    if(THI.scopedDept) deptMatch = r.deptGroup===THI.scopedDept;
    else if(STATE.dept==='all') deptMatch = true;
    else if(STATE.dept===MARKETING_COMBINED) deptMatch = r.deptGroup==='Marketing';
    else deptMatch = r.dept===STATE.dept;
    return deptMatch && (STATE.tenure==='all'||r.tenure===STATE.tenure) && (STATE.city==='all'||r.city===STATE.city);
  });
}
function getPrev(m){const i=THI.activeQuarter;if(i<=0)return null;const pq=THI.quarters[i-1];if(!pq?.loaded||!pq.respondents?.length)return null;const resp=THI.scopedDept?pq.respondents.filter(r=>r.deptGroup===THI.scopedDept):pq.respondents;return THI.calcAreaScores(resp,m)}
function getPrevNPS(){const i=THI.activeQuarter;if(i<=0)return null;const pq=THI.quarters[i-1];if(!pq?.loaded||!pq.respondents?.length)return null;const resp=THI.scopedDept?pq.respondents.filter(r=>r.deptGroup===THI.scopedDept):pq.respondents;return THI.calcNPS(resp)}

// ── FILTERS ────────────────────────────────────────────────────────
function fillFilters(resp){
  const depts=[...new Set(resp.map(r=>r.dept))].sort();
  const hasMarketingGroup = depts.some(d=>['Audience Development','Communications','Marketing'].includes(d));
  const deptsWithGroup = hasMarketingGroup ? [...depts, MARKETING_COMBINED] : depts;
  const cities=[...new Set(resp.map(r=>r.city))].filter(Boolean).sort();
  const TORD=['< 6 months','6 months – 1 yr','1 – 2 years','2 – 3 years','3 – 4 years','4 – 5 years','> 5 years'];
  const tenures=TORD.filter(t=>resp.some(r=>r.tenure===t));
  const fill=(id,items,all)=>{const sel=document.getElementById(id);if(!sel)return;const cur=sel.value;sel.innerHTML=`<option value="all">${all}</option>`;items.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;sel.appendChild(o)});sel.value=items.includes(cur)?cur:'all'};
  fill('filterDept',deptsWithGroup,'All Departments');fill('filterTenure',tenures,'All Tenure');fill('filterCity',cities,'All Locations');fill('fbDept',deptsWithGroup,'All Departments');fill('fbTenure',tenures,'All Tenure');
}
function buildQuarterSelect(){
  const sel=document.getElementById('filterQuarter');sel.innerHTML='';
  THI.quarters.forEach((q,i)=>{const o=document.createElement('option');o.value=i;o.textContent=q.label;if(!q.sheetId)o.disabled=true;sel.appendChild(o)});
  sel.value=THI.activeQuarter.toString();
  sel.addEventListener('change',async e=>{
    const i=+e.target.value;
    const q=THI.quarters[i];
    if(!q?.sheetId)return;
    THI.activeQuarter=i;
    const appEl=document.getElementById('appContent');
    appEl.classList.add('is-loading-quarter');
    // Most quarters are already pre-loaded at startup — this only actually awaits
    // network work the rare time a quarter's data hasn't been fetched yet.
    const needsLoad = THI.quarters.filter(q=>q.sheetId&&!q.loaded);
    if(needsLoad.length) await Promise.all(needsLoad.map(q=>loadQuarterData(q)));
    fillFilters(q.respondents||[]);
    STATE.dept='all';STATE.tenure='all';STATE.city='all';
    document.getElementById('filterDept').value='all';
    document.getElementById('filterTenure').value='all';
    document.getElementById('filterCity').value='all';
    renderAll();
    appEl.classList.remove('is-loading-quarter');
  });
}
function heroSVG(score){
  const c=score>=75?'#fde68a':score>=65?'#fde68a':'#fecaca';
  const c2=score>=75?'#FCA311':score>=65?'#FCA311':'#f87171';
  return`<svg width="132" height="122" viewBox="0 0 140 130" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="70" cy="44" r="24" fill="${c}" opacity=".8"/>
    <circle cx="70" cy="44" r="13" fill="rgba(255,255,255,.55)"/>
    <circle cx="65" cy="42" r="2.5" fill="rgba(255,255,255,.95)"/>
    <circle cx="75" cy="42" r="2.5" fill="rgba(255,255,255,.95)"/>
    <path d="M63 49 q7 7 14 0" stroke="rgba(255,255,255,.9)" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M36 105c0-20 15-30 34-30s34 10 34 105" fill="${c}" opacity=".6"/>
    <circle cx="22" cy="60" r="15" fill="${c2}" opacity=".55"/>
    <path d="M4 105c0-15 9-22 18-22" fill="${c2}" opacity=".45"/>
    <circle cx="118" cy="60" r="15" fill="${c2}" opacity=".55"/>
    <path d="M136 105c0-15-9-22-18-22" fill="${c2}" opacity=".45"/>
    <circle cx="70" cy="65" r="58" fill="rgba(255,255,255,.025)"/>
  </svg>`;
}
function npsHeroSVG(){
  return`<svg width="132" height="122" viewBox="0 0 140 130" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="70" cy="46" r="26" fill="#A290B7" opacity=".65"/>
    <path d="M70 60c-9-7-16-13-16-20a9 9 0 0 1 16-5.5A9 9 0 0 1 86 40c0 7-7 13-16 20z" fill="#fff" opacity=".95"/>
    <circle cx="24" cy="62" r="14" fill="#946D6D" opacity=".55"/>
    <path d="M6 106c0-15 8-22 18-22" fill="#946D6D" opacity=".45"/>
    <circle cx="116" cy="62" r="14" fill="#946D6D" opacity=".55"/>
    <path d="M134 106c0-15-8-22-18-22" fill="#946D6D" opacity=".45"/>
    <path d="M38 108c0-19 14-28 32-28s32 9 32 108" fill="#946D6D" opacity=".65"/>
    <circle cx="70" cy="66" r="58" fill="rgba(255,255,255,.025)"/>
  </svg>`;
}

// ── OVERVIEW ────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════
// COMPARISON TAB — paired-question perception analysis
// ══════════════════════════════════════════════════════════════════════
function scoreForQuestion(resp, qNum, method){
  const i = qNum - 1;
  const vals = resp.map(r=>r.qs[i]).filter(v=>v!==null&&!isNaN(v));
  if(!vals.length) return null;
  if(method==='avg') return vals.reduce((s,v)=>s+v,0)/vals.length/7*100;
  const thresh = method==='fav67' ? 6 : 5;
  return vals.filter(v=>v>=thresh).length/vals.length*100;
}
const MANAGERIAL_LEVELS = ['Manager','Sr. Manager','Team Lead'];
const LEVEL_ORDER_ALL = ['Associate','Sr. Associate','Manager','Sr. Manager','Functional','Team Lead'];
let CMP_Q_LEVEL = 'all'; // 'all' | 'managerial' | 'nonManagerial' — Level pill for the expanded area's question detail (general dashboard only)
let CMP_Q_EXPANDED = {}; // { [quarterIndex]: true } — Total ↔ per-level breakdown toggle, within the currently expanded area
let CMP_EXPANDED_AREA = null; // area key currently expanded in the Area Performance table (one at a time)
function splitByManagerial(resp){
  return {
    managerial: resp.filter(r=>MANAGERIAL_LEVELS.includes(r.level)),
    nonManagerial: resp.filter(r=>r.level && !MANAGERIAL_LEVELS.includes(r.level)),
  };
}
function cmpOverrideKey(quarterLabel, pairId){ return `thi_cmp_override_${quarterLabel}_${pairId}`; }
function getCmpOverride(quarterLabel, pairId){
  try{ const raw=localStorage.getItem(cmpOverrideKey(quarterLabel,pairId)); return raw?JSON.parse(raw):null; }
  catch(e){ return null; }
}
function setCmpOverride(quarterLabel, pairId, narrative){
  try{ localStorage.setItem(cmpOverrideKey(quarterLabel,pairId), JSON.stringify(narrative)); }catch(e){}
}
function clearCmpOverride(quarterLabel, pairId){
  try{ localStorage.removeItem(cmpOverrideKey(quarterLabel,pairId)); }catch(e){}
}

const CMP_LABEL_ICONS = {
  'Ownership':            {icon:'ti-hand-grab',   color:'#16a34a'},
  'Work Ownership':       {icon:'ti-hand-grab',   color:'#16a34a'},
  'Recognition':          {icon:'ti-award',       color:'#c97a00'},
  'Growth Mindset':       {icon:'ti-seedling',    color:'#22c55e'},
  'Development Support':  {icon:'ti-school',      color:'#3b82f6'},
  'Workplace Support':    {icon:'ti-building',    color:'#8b5cf6'},
  'Managerial':           {icon:'ti-user-star',   color:'#2563eb'},
  'Non-Managerial':       {icon:'ti-users',       color:'#64748b'},
};
const CMP_NAR_ICONS = {
  finding:     {icon:'ti-search',          color:'#2563eb'},
  indication:  {icon:'ti-arrow-big-right', color:'#c97a00'},
  implication: {icon:'ti-alert-triangle',  color:'#dc2626'},
};
const COMPARISON_SECTIONS = [
  {
    id:'perception', title:'Perception: Personal Believe', icon:'ti-scale', color:'#8B5CF6',
    subtitle:"How Timmys perceive their own effort vs the organization's support",
    pairs:[
      { id:'ownership_recognition', title:'Ownership vs Recognition',
        a:{label:'Ownership', q:29, text:'I believe that I am taking full responsibility and ownership of my work'},
        b:{label:'Recognition', q:31, text:'In general, I feel that IDN appreciates my work and contributions'},
        segment:'all',
        narrative:(a,b,gap,hi,lo)=>({
          finding:`${hi===0?'High individual accountability':'Strong recognition'} (${dp(a)}%) contrasts with ${hi===0?'low perceived recognition':'lower ownership'} (${dp(b)}%), a ${dp(gap)}-point gap.`,
          indication:`Employees appear to be taking on more ownership of their work, but the organization's recognition of that effort has not kept pace.`,
          implication:`If this gap persists, the most accountable employees are the ones most likely to disengage or leave first, since their effort feels unacknowledged.`,
        }) },
      { id:'growth_development', title:'Growth Mindset vs Development Support',
        a:{label:'Growth Mindset', q:22, text:'I believe that I have a growth mindset (a belief that talents can be developed through hard work, problems/challenges, and input from others)'},
        b:{label:'Development Support', q:24, text:'IDN provides me with development opportunity that helps me grow as an individual'},
        segment:'all',
        narrative:(a,b,gap,hi,lo)=>({
          finding:`A high growth mindset (${dp(a)}%) is not matched by current development support (${dp(b)}%), a ${dp(gap)}-point gap.`,
          indication:`More employees want to grow, but access to development programs isn't keeping up with that willingness.`,
          implication:`Employee motivation to grow may plateau or reverse over time as repeated unmet expectations erode enthusiasm.`,
        }) },
      { id:'ownership_workplace', title:'Work Ownership vs Workplace Support',
        a:{label:'Work Ownership', q:29, text:'I believe that I am taking full responsibility and ownership of my work'},
        b:{label:'Workplace Support', q:35, text:'I feel that the facilities and resources at the workplace effectively support my work'},
        segment:'all',
        narrative:(a,b,gap,hi,lo)=>({
          finding:`High commitment to results (${dp(a)}%) is being undermined by lower confidence in facilities and tools (${dp(b)}%), a ${dp(gap)}-point gap.`,
          indication:`Workplace conditions have not kept pace — people are pushing harder in an environment that isn't fully supporting them.`,
          implication:`Sustained neglect of the work environment risks shifting employee frustration from passive to vocal over time.`,
        }) },
    ],
  },
  {
    id:'leadership', title:'Leadership: Lens Analysis', icon:'ti-users', color:'#2a78d6',
    subtitle:'Managerial (Manager, Sr. Manager, Team Lead) vs Non-Managerial perception',
    pairs:[
      { id:'okr_achieve', title:'How to Achieve OKR',
        a:{label:'Managerial', q:27, text:'I know how to achieve my OKR', segment:'managerial'},
        b:{label:'Non-Managerial', q:8, text:"I believe that my direct supervisor has the capability to reach the team's OKR", segment:'nonManagerial'},
        narrative:(a,b,gap,hi,lo)=>({
          finding:`Managers feel confident in goal clarity (${dp(a)}%), but only ${dp(b)}% of non-managers trust their supervisor's capability to reach those goals — a ${dp(gap)}-point gap.`,
          indication:`Direction is being set at the top, but it isn't landing clearly at the execution level.`,
          implication:`Low confidence in supervisor capability can lead to team anxiety and a lack of clear direction, potentially stalling OKR progress.`,
        }) },
      { id:'work_ownership_lens', title:'Work Ownership',
        a:{label:'Managerial', q:29, text:'I believe that I am taking full responsibility and ownership of my work', segment:'managerial'},
        b:{label:'Non-Managerial', q:32, text:'I feel that my leaders (direct supervisor) recognizes my work and contributions', segment:'nonManagerial'},
        narrative:(a,b,gap,hi,lo)=>({
          finding:`Managers claim high ownership of their work (${dp(a)}%), yet team recognition scores remain lower (${dp(b)}%) — a ${dp(gap)}-point gap.`,
          indication:`Leaders feel they are doing the work, but that isn't consistently translating into active appreciation for their team's contributions.`,
          implication:`When ownership isn't paired with recognition, high-performing team members may feel ignored, risking disengagement and lower productivity.`,
        }) },
      { id:'comms_effectiveness', title:'Communication & Effectiveness',
        a:{label:'Managerial', q:14, text:'I feel that my teammates and I are able to communicate effectively and respectfully with each other', segment:'managerial'},
        b:{label:'Non-Managerial', q:16, text:'I feel that my direct supervisor is a reliable and helpful source of information for me', segment:'nonManagerial'},
        narrative:(a,b,gap,hi,lo)=>({
          finding:`Team-level communication is perceived reasonably well by managers (${dp(a)}%), but supervisors aren't fully trusted as reliable information sources (${dp(b)}%) — a ${dp(gap)}-point gap.`,
          indication:`Communication flows better horizontally among teammates than vertically from supervisors.`,
          implication:`A lack of reliable information from leaders can force teams to rely on guesswork, increasing the risk of misalignment with company goals.`,
        }) },
    ],
  },
];

function renderAreaPerfTable(targetId='areaPerfList'){
  const quarters = THI.quarters; // fixed 4-quarter structure
  const perQuarterScores = quarters.map(q=>{
    if(!q?.loaded) return null;
    const resp = getFilteredForQuarter(q);
    if(!resp.length) return null;
    return THI.calcAreaScores(resp, STATE.method);
  });
  const perQuarterNPS = quarters.map(q=>{
    if(!q?.loaded) return null;
    const resp = getFilteredForQuarter(q);
    if(!resp.length) return null;
    return THI.calcNPS(resp);
  });
  const perQuarterCfg = quarters.map(q=>THI.config?.[q?.label] || {});

  // Rank areas within each quarter to find that quarter's top-3/bottom-3
  const rankMaps = perQuarterScores.map(scores=>{
    if(!scores) return null;
    const ranked = [...THI.AREAS].map(a=>({key:a.key,val:scores[a.key]})).sort((a,b)=>b.val-a.val);
    const map = {};
    ranked.forEach((r,i)=>{
      if(i<3) map[r.key]=`ct${i+1}`;
      else if(i>=ranked.length-3) map[r.key]=`cb${ranked.length-i}`;
    });
    return map;
  });

  const deltaHtmlFor=(val,prevVal)=>{
    if(prevVal===null||prevVal===undefined) return '';
    const d = val - prevVal;
    const dc = d>0.05?'#16a34a':d<-0.05?'#dc2626':'#94a3b8';
    const arrow = d>0.05?'▲':d<-0.05?'▼':'=';
    return `<span class="ap-table-delta" style="color:${dc}">${arrow} ${dp(Math.abs(d))}</span>`;
  };

  const theadHtml = `<tr><th style="text-align:left">Area</th>${quarters.map(q=>`<th>${q.label}</th>`).join('')}</tr>`;

  const areaRowsHtml = THI.AREAS.map(a=>{
    const cells = quarters.map((q,qi)=>{
      const scores = perQuarterScores[qi];
      if(!scores) return `<td class="ap-table-cell"><span class="ap-table-na">—</span></td>`;
      const val = scores[a.key];
      const prevScores = qi>0 ? perQuarterScores[qi-1] : null;
      const deltaHtml = prevScores ? deltaHtmlFor(val, prevScores[a.key]) : '';
      const hlClass = rankMaps[qi]?.[a.key] || '';
      return `<td class="ap-table-cell"><div class="ap-table-cell-inner ${hlClass}"><span class="ap-table-val">${pct(val)}</span>${deltaHtml}</div></td>`;
    }).join('');
    const isOpen = CMP_EXPANDED_AREA === a.key;
    const rowHtml = `<tr class="ap-table-area-row${isOpen?' ap-area-row-open':''}" data-area-key="${a.key}" data-target="${targetId}"><td class="ap-table-area ap-area-clickable">
        <i class="ti ${ICONS[a.key]}" style="font-size:.8rem;color:#94a3b8;margin-right:6px"></i>${a.label}
        <i class="ti ti-chevron-${isOpen?'up':'down'}" style="font-size:.62rem;opacity:.55;margin-left:4px"></i>
      </td>${cells}</tr>`;
    const detailHtml = isOpen ? `<tr class="ap-area-detail-row"><td colspan="${quarters.length+1}">${buildAreaQuestionDetailHtml(a, quarters)}</td></tr>` : '';
    return rowHtml + detailHtml;
  }).join('');

  // Overall Score + THI Achievement
  const overallCells = quarters.map((q,qi)=>{
    const scores = perQuarterScores[qi];
    if(!scores) return `<td class="ap-table-cell"><span class="ap-table-na">—</span></td>`;
    const prevScores = qi>0 ? perQuarterScores[qi-1] : null;
    const deltaHtml = prevScores ? deltaHtmlFor(scores.total, prevScores.total) : '';
    return `<td class="ap-table-cell"><div class="ap-table-cell-inner"><span class="ap-table-val">${pct(scores.total)}</span>${deltaHtml}</div></td>`;
  }).join('');
  const thiAchieveCells = quarters.map((q,qi)=>{
    const scores = perQuarterScores[qi];
    const targetOKR = perQuarterCfg[qi]?.targetOKR ?? null;
    if(!scores || !targetOKR) return `<td class="ap-table-cell"><span class="ap-table-na">—</span></td>`;
    const achieve = scores.total/targetOKR*100;
    const prevScores = qi>0 ? perQuarterScores[qi-1] : null;
    const prevTarget = qi>0 ? (perQuarterCfg[qi-1]?.targetOKR ?? null) : null;
    const prevAchieve = (prevScores&&prevTarget) ? prevScores.total/prevTarget*100 : null;
    const deltaHtml = deltaHtmlFor(achieve, prevAchieve);
    return `<td class="ap-table-cell"><div class="ap-table-cell-inner"><span class="ap-table-val">${pct(achieve)}</span>${deltaHtml}</div></td>`;
  }).join('');

  // NPS Score + NPS Achievement
  const npsCells = quarters.map((q,qi)=>{
    const npsData = perQuarterNPS[qi];
    if(!npsData) return `<td class="ap-table-cell"><span class="ap-table-na">—</span></td>`;
    const prevNps = qi>0 ? perQuarterNPS[qi-1] : null;
    const deltaHtml = prevNps ? deltaHtmlFor(npsData.nps, prevNps.nps) : '';
    return `<td class="ap-table-cell"><div class="ap-table-cell-inner"><span class="ap-table-val">${dp(npsData.nps)}</span>${deltaHtml}</div></td>`;
  }).join('');
  const npsAchieveCells = quarters.map((q,qi)=>{
    const npsData = perQuarterNPS[qi];
    const targetNPS = perQuarterCfg[qi]?.targetNPS ?? null;
    if(!npsData || !targetNPS) return `<td class="ap-table-cell"><span class="ap-table-na">—</span></td>`;
    const achieve = npsData.nps/targetNPS*100;
    const prevNps = qi>0 ? perQuarterNPS[qi-1] : null;
    const prevTarget = qi>0 ? (perQuarterCfg[qi-1]?.targetNPS ?? null) : null;
    const prevAchieve = (prevNps&&prevTarget) ? prevNps.nps/prevTarget*100 : null;
    const deltaHtml = deltaHtmlFor(achieve, prevAchieve);
    return `<td class="ap-table-cell"><div class="ap-table-cell-inner"><span class="ap-table-val">${pct(achieve)}</span>${deltaHtml}</div></td>`;
  }).join('');

  const summaryRowsHtml = `
    <tr class="ap-table-summary-row ap-row-thi"><td class="ap-table-area"><i class="ti ti-chart-bar" style="font-size:.8rem;color:#c97a00;margin-right:6px"></i>Overall Score</td>${overallCells}</tr>
    <tr class="ap-table-summary-row ap-row-thi"><td class="ap-table-area"><i class="ti ti-target-arrow" style="font-size:.8rem;color:#c97a00;margin-right:6px"></i>THI Achievement</td>${thiAchieveCells}</tr>
    <tr class="ap-table-divider-row"><td colspan="${quarters.length+1}"></td></tr>
    <tr class="ap-table-summary-row ap-row-nps"><td class="ap-table-area"><i class="ti ti-trending-up" style="font-size:.8rem;color:#1d4ed8;margin-right:6px"></i>NPS Score</td>${npsCells}</tr>
    <tr class="ap-table-summary-row ap-row-nps"><td class="ap-table-area"><i class="ti ti-target-arrow" style="font-size:.8rem;color:#1d4ed8;margin-right:6px"></i>NPS Achievement</td>${npsAchieveCells}</tr>`;

  refreshHTML(document.getElementById(targetId), `<table class="ap-table"><thead>${theadHtml}</thead><tbody>${areaRowsHtml}${summaryRowsHtml}</tbody></table>`);
}

function renderComparison(resp, opts={}){
  const areaPerfElId = opts.areaPerfElId || 'areaPerfList';
  const bodyElId = opts.bodyElId || 'comparisonBody';
  renderAreaPerfTable(areaPerfElId);
  const q = THI.quarters[THI.activeQuarter];
  const quarterLabel = q?.label || 'unknown';
  const { managerial, nonManagerial } = splitByManagerial(resp);
  const segMap = { all:resp, managerial, nonManagerial };
  const pairScores = []; // collected for post-render count-up animation

  const html = COMPARISON_SECTIONS.map(section=>{
    const pairsHtml = section.pairs.map(pair=>{
      const respA = segMap[pair.a.segment || pair.segment || 'all'];
      const respB = segMap[pair.b.segment || pair.segment || 'all'];
      const scoreA = scoreForQuestion(respA, pair.a.q, STATE.method);
      const scoreB = scoreForQuestion(respB, pair.b.q, STATE.method);
      const hasData = scoreA!==null && scoreB!==null;
      const gap = hasData ? Math.abs(scoreA-scoreB) : null;
      const hiIdx = hasData && scoreA>=scoreB ? 0 : 1;
      if(hasData) pairScores.push({id:pair.id, scoreA, scoreB});

      const override = getCmpOverride(quarterLabel, pair.id);
      const auto = hasData ? pair.narrative(scoreA, scoreB, gap, hiIdx, hiIdx===0?1:0) : null;
      const nar = override || auto || {finding:'Not enough data for this quarter.', indication:'', implication:''};
      const iconA = CMP_LABEL_ICONS[pair.a.label] || {icon:'ti-circle',color:'#94a3b8'};
      const iconB = CMP_LABEL_ICONS[pair.b.label] || {icon:'ti-circle',color:'#94a3b8'};

      return `
      <div class="cmp-pair" data-pair-id="${pair.id}">
        <div class="cmp-pair-head">
          <div class="cmp-pair-title">${pair.title}</div>
          <button class="cmp-edit-btn" onclick="toggleCmpEdit('${pair.id}')"><i class="ti ti-pencil"></i> Edit narrative</button>
        </div>
        <div class="cmp-main-grid">
          <div class="cmp-scores-col">
            <div class="cmp-side cmp-side-a">
              <div class="cmp-side-label"><i class="ti ${iconA.icon}" style="color:${iconA.color}"></i> ${pair.a.label}</div>
              <div class="cmp-side-text">${pair.a.text}</div>
              <div class="cmp-side-score" id="cmpScoreA-${pair.id}">${hasData?'':'—'}</div>
            </div>
            <div class="cmp-vs-h">VS</div>
            <div class="cmp-side cmp-side-b">
              <div class="cmp-side-label"><i class="ti ${iconB.icon}" style="color:${iconB.color}"></i> ${pair.b.label}</div>
              <div class="cmp-side-text">${pair.b.text}</div>
              <div class="cmp-side-score" id="cmpScoreB-${pair.id}">${hasData?'':'—'}</div>
            </div>
          </div>
          <div class="cmp-narrative-col">
            <div class="cmp-narrative" id="cmpNarrative-${pair.id}">
              ${nar.finding?`<div class="cmp-nar-line"><i class="ti ${CMP_NAR_ICONS.finding.icon}" style="color:${CMP_NAR_ICONS.finding.color}"></i><span><strong>Finding:</strong> ${nar.finding}</span></div>`:''}
              ${nar.indication?`<div class="cmp-nar-line"><i class="ti ${CMP_NAR_ICONS.indication.icon}" style="color:${CMP_NAR_ICONS.indication.color}"></i><span><strong>Indication:</strong> ${nar.indication}</span></div>`:''}
              ${nar.implication?`<div class="cmp-nar-line"><i class="ti ${CMP_NAR_ICONS.implication.icon}" style="color:${CMP_NAR_ICONS.implication.color}"></i><span><strong>Implication:</strong> ${nar.implication}</span></div>`:''}
              <div class="cmp-nar-foot"><i class="ti ti-sparkles"></i> ${override?'Manually edited':'Auto-generated from the live gap'} ${override?'· <a href="javascript:void(0)" onclick="resetCmpNarrative(\''+pair.id+'\')">Reset to auto</a>':''}</div>
            </div>
            <div class="cmp-edit-panel" id="cmpEdit-${pair.id}" style="display:none">
              <label class="cmp-edit-label">Finding</label>
              <textarea class="cmp-edit-textarea" id="cmpEditFinding-${pair.id}" rows="2">${(nar.finding||'').replace(/</g,'&lt;')}</textarea>
              <label class="cmp-edit-label">Indication</label>
              <textarea class="cmp-edit-textarea" id="cmpEditIndication-${pair.id}" rows="2">${(nar.indication||'').replace(/</g,'&lt;')}</textarea>
              <label class="cmp-edit-label">Implication</label>
              <textarea class="cmp-edit-textarea" id="cmpEditImplication-${pair.id}" rows="2">${(nar.implication||'').replace(/</g,'&lt;')}</textarea>
              <div class="cmp-edit-actions">
                <button class="cmp-save-btn" onclick="saveCmpNarrative('${pair.id}')">Save</button>
                <button class="cmp-cancel-btn" onclick="toggleCmpEdit('${pair.id}')">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');

    return `
    <div class="card cmp-section">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <div style="width:36px;height:36px;border-radius:10px;background:${section.color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="ti ${section.icon}" style="font-size:1.1rem;color:${section.color}"></i></div>
        <div style="flex:1;min-width:200px"><div style="font-size:.85rem;font-weight:700;color:var(--text)">${section.title}</div><div style="font-size:.72rem;color:var(--text3)">${section.subtitle}</div></div>
        ${section.id==='leadership' ? `
        <div style="display:flex;gap:8px;flex-shrink:0">
          <span style="display:flex;align-items:center;gap:5px;font-size:.7rem;font-weight:700;color:#2563eb;background:#2563eb14;padding:5px 10px;border-radius:20px"><i class="ti ti-user-star" style="font-size:.85rem"></i> ${managerial.length.toLocaleString()} Managerial</span>
          <span style="display:flex;align-items:center;gap:5px;font-size:.7rem;font-weight:700;color:#64748b;background:#64748b14;padding:5px 10px;border-radius:20px"><i class="ti ti-users" style="font-size:.85rem"></i> ${nonManagerial.length.toLocaleString()} Non-Managerial</span>
        </div>` : ''}
      </div>
      ${pairsHtml}
    </div>`;
  }).join('');

  refreshHTML(document.getElementById(bodyElId), html, ()=>{
    pairScores.forEach(({id,scoreA,scoreB})=>{
      const elA=document.getElementById(`cmpScoreA-${id}`), elB=document.getElementById(`cmpScoreB-${id}`);
      if(elA){ elA.dataset.cuVal=elA.dataset.cuVal||'0'; animateNumber(elA, scoreA, {decimals:STATE.decimals?2:0, suffix:'%'}); }
      if(elB){ elB.dataset.cuVal=elB.dataset.cuVal||'0'; animateNumber(elB, scoreB, {decimals:STATE.decimals?2:0, suffix:'%'}); }
    });
  });
}

// ── Per-question detail for one Area, embedded as an expand row inside the
// Area Performance table. Click an area's name to open/close it.
// On the general dashboard the Level pill (All / Managerial / Non-Managerial)
// is available, with a per-quarter Total ↔ per-level breakdown toggle; on the
// per-department report the pill is hidden and plain per-quarter scores show.
function buildAreaQuestionDetailHtml(area, quarters){
  const showLevelControls = !THI.scopedDept;
  const showLevels = showLevelControls && CMP_Q_LEVEL !== 'all';

  const segFilter = resp=>{
    if(!showLevelControls) return resp;
    if(CMP_Q_LEVEL==='managerial') return resp.filter(r=>MANAGERIAL_LEVELS.includes(r.level));
    if(CMP_Q_LEVEL==='nonManagerial') return resp.filter(r=>r.level && !MANAGERIAL_LEVELS.includes(r.level));
    return resp;
  };
  const levelPool = CMP_Q_LEVEL==='managerial' ? MANAGERIAL_LEVELS : LEVEL_ORDER_ALL.filter(l=>!MANAGERIAL_LEVELS.includes(l));
  const allRespAllQ = quarters.flatMap(q=>q?.loaded ? getFilteredForQuarter(q) : []);
  const levelsInScope = showLevels ? levelPool.filter(l=>allRespAllQ.some(r=>r.level===l)) : [];

  const perQuarter = quarters.map(q=>{
    if(!q?.loaded) return null;
    const base = getFilteredForQuarter(q);
    const resp = segFilter(base);
    const agg = { n: resp.length, scores: area.items.map(idx=>scoreForQuestion(resp, idx+1, STATE.method)) };
    let byLevel = null;
    if(showLevels){
      byLevel = levelsInScope.map(l=>{
        const lResp = resp.filter(r=>r.level===l);
        return { level:l, n: lResp.length, scores: area.items.map(idx=>scoreForQuestion(lResp, idx+1, STATE.method)) };
      });
    }
    return { agg, byLevel };
  });

  const deltaHtmlQ=(val,prevVal)=>{
    if(val===null||val===undefined||prevVal===null||prevVal===undefined) return '';
    const d = val - prevVal;
    const dc = d>0.05?'#16a34a':d<-0.05?'#dc2626':'#94a3b8';
    const arrow = d>0.05?'▲':d<-0.05?'▼':'=';
    return `<span class="ap-table-delta" style="color:${dc}">${arrow} ${dp(Math.abs(d))}</span>`;
  };

  let theadHtml = '';
  if(!showLevels){
    // No header needed here — the quarter labels already show in the Area
    // Performance table right above; repeating them would just be noise.
    theadHtml = '';
  } else {
    // Single header row (no repeated quarter names): just "Total" — click to
    // expand into that quarter's per-level breakdown, click any level name to
    // collapse back. Column count here always matches the data rows exactly.
    const headerCells = quarters.map((q,qi)=>{
      const pq = perQuarter[qi];
      if(!pq) return `<th class="ap-table-na">—</th>`;
      const expanded = !!CMP_Q_EXPANDED[qi];
      if(!expanded || !pq.byLevel || !pq.byLevel.length){
        return `<th class="qbytq-pill-th qtr-toggle-th" data-qi="${qi}" title="Click to expand per-level breakdown">Total<div class="ap-table-n">n=${pq.agg.n.toLocaleString()}</div></th>`;
      }
      return pq.byLevel.map(lv=>`<th class="qtr-toggle-th" data-qi="${qi}" title="Click to collapse">${lv.level}<div class="ap-table-n">n=${lv.n.toLocaleString()}</div></th>`).join('');
    }).join('');
    theadHtml = `<tr><th class="qcol" style="text-align:left">Question</th>${headerCells}</tr>`;
  }

  const rowsHtml = area.items.map((idx,i)=>{
    const label = (THI.QUESTION_LABELS && THI.QUESTION_LABELS[idx]) || `Question ${idx+1}`;
    const cells = quarters.map((q,qi)=>{
      const pq = perQuarter[qi];
      const prevPq = qi>0 ? perQuarter[qi-1] : null;
      if(!showLevels){
        const val = pq ? pq.agg.scores[i] : null;
        if(val===null||val===undefined) return `<td class="ap-table-cell"><span class="ap-table-na">—</span></td>`;
        const prevVal = prevPq ? prevPq.agg.scores[i] : null;
        return `<td class="ap-table-cell qbytq-pill-td"><div class="ap-table-cell-inner"><span class="ap-table-val">${pct(val)}</span>${deltaHtmlQ(val,prevVal)}</div></td>`;
      }
      if(!pq) return `<td class="ap-table-cell"><span class="ap-table-na">—</span></td>`;
      const expanded = !!CMP_Q_EXPANDED[qi];
      if(!expanded || !pq.byLevel || !pq.byLevel.length){
        const val = pq.agg.scores[i];
        if(val===null||val===undefined) return `<td class="ap-table-cell"><span class="ap-table-na">—</span></td>`;
        const prevVal = prevPq ? prevPq.agg.scores[i] : null;
        return `<td class="ap-table-cell qbytq-pill-td"><div class="ap-table-cell-inner"><span class="ap-table-val">${pct(val)}</span>${deltaHtmlQ(val,prevVal)}</div></td>`;
      }
      return pq.byLevel.map((lv,li)=>{
        const val = lv.scores[i];
        if(val===null||val===undefined) return `<td class="ap-table-cell"><span class="ap-table-na">—</span></td>`;
        const prevLv = prevPq?.byLevel?.[li];
        const prevVal = prevLv ? prevLv.scores[i] : null;
        return `<td class="ap-table-cell"><div class="ap-table-cell-inner"><span class="ap-table-val">${pct(val)}</span>${deltaHtmlQ(val,prevVal)}</div></td>`;
      }).join('');
    }).join('');
    return `<tr><td class="ap-table-area qcol"><span style="color:#94a3b8;font-weight:600">Q${idx+1}.</span> ${label}</td>${cells}</tr>`;
  }).join('');

  const pillHtml = showLevelControls ? `
    <div class="level-pill-wrap" data-area-key="${area.key}" style="display:flex;border:1px solid var(--border2);border-radius:20px;overflow:hidden;flex-shrink:0">
      <button class="view-toggle-btn ${CMP_Q_LEVEL==='all'?'active':''}" data-level="all" style="padding:6px 14px;font-size:.7rem">All</button>
      <button class="view-toggle-btn ${CMP_Q_LEVEL==='managerial'?'active':''}" data-level="managerial" style="padding:6px 14px;font-size:.7rem">Managerial</button>
      <button class="view-toggle-btn ${CMP_Q_LEVEL==='nonManagerial'?'active':''}" data-level="nonManagerial" style="padding:6px 14px;font-size:.7rem">Non-Managerial</button>
    </div>` : '';

  const nSummary = quarters.map((q,qi)=>{
    const n = perQuarter[qi]?.agg.n;
    return n!==undefined&&n!==null ? `${q.label} n=${n.toLocaleString()}` : null;
  }).filter(Boolean).join(' · ');

  return `<div class="ap-area-detail">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap">
      <div style="font-size:.72rem;color:var(--text3)">${area.items.length} question${area.items.length>1?'s':''} in <strong style="color:var(--text)">${area.label}</strong>${nSummary?` <span style="opacity:.7">· ${nSummary}</span>`:''}</div>
      ${pillHtml}
    </div>
    <div style="max-height:420px;overflow:auto">
      <table class="ap-table qbytq-table${showLevels?' qbytq-bylevel':''}">${theadHtml?`<thead>${theadHtml}</thead>`:''}<tbody>${rowsHtml}</tbody></table>
    </div>
  </div>`;
}

// Click an area row to expand/collapse its per-question detail.
document.addEventListener('click', e=>{
  const cell = e.target.closest('.ap-area-clickable');
  if(!cell) return;
  const row = cell.closest('.ap-table-area-row');
  if(!row) return;
  const key = row.dataset.areaKey;
  const targetId = row.dataset.target;
  CMP_EXPANDED_AREA = CMP_EXPANDED_AREA === key ? null : key;
  CMP_Q_LEVEL = 'all';
  CMP_Q_EXPANDED = {};
  renderAreaPerfTable(targetId);
});
// Participation table cell (by Department/Tenure/Level) — click to see the
// Responded / Not Responded / Population breakdown behind that %, and click
// "Not Responded" again to expand the actual names of who hasn't filled it in.
let partCellPopoverEl = null;
function closePartCellPopover(){
  if(partCellPopoverEl){ partCellPopoverEl.remove(); partCellPopoverEl = null; }
}
// Roster entries (name/email/dept/tenure/level) for this category that haven't
// responded this quarter yet — matched by email against who actually did.
function getNonRespondentNames(qObj, catType, catLabel){
  const roster = qObj?.population?.roster;
  if(!roster?.length) return null; // no roster detail loaded for this quarter — can't break it down by name
  const matchesCat = entry => {
    if(catType==='dept') return catLabel==='Marketing' ? entry.deptGroup==='Marketing' : entry.dept===catLabel;
    if(catType==='tenure') return entry.tenure===catLabel;
    if(catType==='level') return entry.level===catLabel;
    return false;
  };
  // Mirror the same dept exclusion used for the Tenure/Level population counts
  // (getExcludedHeadcountInBucket) — but ONLY when browsing by Tenure/Level.
  // Clicking an excluded dept's OWN row (e.g. Boss Creator in the Department
  // table) must still show its real names: that row was never affected by the
  // exclusion in the first place (getDeptData shows every dept's true numbers;
  // the exclusion only keeps an excluded dept's headcount from leaking into
  // OTHER buckets' totals), so filtering it out here would wrongly empty it.
  const excludeDepts = catType!=='dept' ? (THI.config?.[qObj?.label]?.excludeDepts || []) : [];
  const isExcluded = entry => excludeDepts.some(d=> d==='Marketing' ? entry.deptGroup==='Marketing' : entry.dept===d);
  const respondedEmails = new Set((qObj.respondents||[]).map(r=>r.email).filter(Boolean));
  return roster
    .filter(entry => matchesCat(entry) && !isExcluded(entry) && !(entry.email && respondedEmails.has(entry.email)))
    .map(entry => entry.name)
    .sort((a,b)=>a.localeCompare(b));
}
function renderPartCellPopover(cat, catType, quarter, res, notresp, pop, namesExpanded){
  const qObj = THI.quarters.find(q=>q.label===quarter);
  const names = namesExpanded ? getNonRespondentNames(qObj, catType, cat) : null;
  let namesHtml = '';
  if(namesExpanded){
    if(names===null) namesHtml = `<div class="pcp-names-empty">Roster detail not available for this quarter.</div>`;
    else if(!names.length) namesHtml = `<div class="pcp-names-empty">Nobody — everyone in this group responded.</div>`;
    else namesHtml = `<div class="pcp-names-list">${names.map(n=>`<div class="pcp-name">${n}</div>`).join('')}</div>`;
  }
  return `
    <div class="pcp-title">${cat} — ${quarter}</div>
    <div class="pcp-row"><span class="pcp-dot" style="background:#16a34a"></span>Responded<span class="pcp-val">${Number(res).toLocaleString()}</span></div>
    <div class="pcp-row pcp-notresp-row" data-expanded="${!!namesExpanded}"><span class="pcp-dot" style="background:#dc2626"></span>Not Responded<span class="pcp-val">${Number(notresp).toLocaleString()}</span><i class="ti ${namesExpanded?'ti-chevron-up':'ti-chevron-down'} pcp-chevron"></i></div>
    ${namesHtml}
    <div class="pcp-row pcp-total"><span class="pcp-dot" style="background:#14213D"></span>Population<span class="pcp-val">${Number(pop).toLocaleString()}</span></div>
  `;
}
function positionPartCellPopover(pop_, anchorCell){
  const r = anchorCell.getBoundingClientRect();
  const pw = pop_.offsetWidth, ph = pop_.offsetHeight;
  let left = r.left + r.width/2 - pw/2 + window.scrollX;
  left = Math.max(8, Math.min(left, window.innerWidth - pw - 8 + window.scrollX));
  let top = r.bottom + 6 + window.scrollY;
  if(top + ph > window.innerHeight + window.scrollY) top = r.top - ph - 6 + window.scrollY; // flip above if no room below
  if(top < window.scrollY + 8) top = window.scrollY + 8; // last resort: don't go off the top either
  pop_.style.left = left+'px';
  pop_.style.top = top+'px';
}
document.addEventListener('click', e=>{
  // Toggle the name list inside an already-open popover.
  const notRespRow = e.target.closest('.pcp-notresp-row');
  if(notRespRow && partCellPopoverEl){
    const { cat, catType, quarter, res, notresp, pop } = partCellPopoverEl.dataset;
    const nowExpanded = notRespRow.dataset.expanded !== 'true';
    partCellPopoverEl.innerHTML = renderPartCellPopover(cat, catType, quarter, res, notresp, pop, nowExpanded);
    const anchor = partCellPopoverEl._anchorCell;
    if(anchor) positionPartCellPopover(partCellPopoverEl, anchor);
    return;
  }

  const cell = e.target.closest('.part-cell-clickable');
  if(!cell){
    // Clicking anywhere else (that isn't the popover itself) closes it.
    if(!e.target.closest('.part-cell-popover')) closePartCellPopover();
    return;
  }
  const wasOpenOnThisCell = partCellPopoverEl && partCellPopoverEl.dataset.forCell === cell.dataset.cat+'|'+cell.dataset.quarter;
  closePartCellPopover();
  if(wasOpenOnThisCell) return; // clicking the same cell again just closes it

  const { cat, catType, quarter, res, notresp, pop } = cell.dataset;
  const pop_ = document.createElement('div');
  pop_.className = 'part-cell-popover';
  pop_.dataset.forCell = cat+'|'+quarter;
  pop_.dataset.cat = cat;
  pop_.dataset.catType = catType;
  pop_.dataset.quarter = quarter;
  pop_.dataset.res = res;
  pop_.dataset.notresp = notresp;
  pop_.dataset.pop = pop;
  pop_.innerHTML = renderPartCellPopover(cat, catType, quarter, res, notresp, pop, false);
  pop_._anchorCell = cell;
  document.body.appendChild(pop_);
  positionPartCellPopover(pop_, cell);
  partCellPopoverEl = pop_;
});
// Level pill (inside an expanded area's detail) — general dashboard only.
document.addEventListener('click', e=>{
  const btn = e.target.closest('.level-pill-wrap .view-toggle-btn');
  if(!btn) return;
  const wrap = btn.closest('.level-pill-wrap');
  const areaTargetId = wrap.closest('[id$="PerfList"]')?.id;
  if(!areaTargetId) return;
  wrap.querySelectorAll('.view-toggle-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  CMP_Q_LEVEL = btn.dataset.level;
  CMP_Q_EXPANDED = {}; // reset per-quarter expand state when switching group
  renderAreaPerfTable(areaTargetId);
});
// Per-quarter Total ↔ per-level breakdown toggle, within an expanded area's detail.
document.addEventListener('click', e=>{
  const th = e.target.closest('.qtr-toggle-th[data-qi]');
  if(!th) return;
  const areaTargetId = th.closest('[id$="PerfList"]')?.id;
  if(!areaTargetId) return;
  const qi = +th.dataset.qi;
  CMP_Q_EXPANDED[qi] = !CMP_Q_EXPANDED[qi];
  renderAreaPerfTable(areaTargetId);
});
window.toggleCmpEdit = function(pairId){
  const panel = document.getElementById(`cmpEdit-${pairId}`);
  const nar = document.getElementById(`cmpNarrative-${pairId}`);
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  nar.style.display = open ? 'block' : 'none';
};
window.saveCmpNarrative = function(pairId){
  const q = THI.quarters[THI.activeQuarter];
  const finding = document.getElementById(`cmpEditFinding-${pairId}`).value.trim();
  const indication = document.getElementById(`cmpEditIndication-${pairId}`).value.trim();
  const implication = document.getElementById(`cmpEditImplication-${pairId}`).value.trim();
  setCmpOverride(q?.label||'unknown', pairId, {finding, indication, implication});
  if(THI.scopedDept) renderComparison(getFiltered(), {areaPerfElId:'drAreaPerfList', bodyElId:'drComparisonBody'});
  else renderComparison(getFiltered());
};
window.resetCmpNarrative = function(pairId){
  const q = THI.quarters[THI.activeQuarter];
  clearCmpOverride(q?.label||'unknown', pairId);
  if(THI.scopedDept) renderComparison(getFiltered(), {areaPerfElId:'drAreaPerfList', bodyElId:'drComparisonBody'});
  else renderComparison(getFiltered());
};

function renderOverview(resp){
  const curr=THI.calcAreaScores(resp,STATE.method);
  const prev=getPrev(STATE.method);
  const nps=THI.calcNPS(resp);
  const pNPS=getPrevNPS();
  const score=curr.total;
  const smt=sentiment(score);
  const sorted=[...THI.AREAS].map(a=>({...a,val:curr[a.key],pv:prev?prev[a.key]:null})).sort((a,b)=>b.val-a.val);

  // ── HERO: OKR Achievement + THI Score ring + status ──
  const heroQ=THI.quarters[THI.activeQuarter];
  document.getElementById('heroTopLabel').textContent=`TIMMY HAPPINESS INDEX · ${(heroQ?.label||'').toUpperCase()}`;
  const cfg=THI.config?.[heroQ?.label]||{};
  const targetOKR=cfg.targetOKR??null;
  const prevQObj=THI.activeQuarter>0?THI.quarters[THI.activeQuarter-1]:null;
  const prevCfg=prevQObj?(THI.config?.[prevQObj.label]||{}):{};
  // OKR Achievement is always Average-per-7 based, regardless of whatever Method filter is selected —
  // so it doesn't silently change meaning if someone switches the dashboard's scoring method.
  const currAvg=STATE.method==='avg'?curr:THI.calcAreaScores(resp,'avg');
  const prevAvg=STATE.method==='avg'?prev:getPrev('avg');

  document.getElementById('heroIllus').innerHTML=heroSVG(score);

  if(targetOKR){
    const okrAchieve=currAvg.total/targetOKR*100;
    document.getElementById('heroOkrValue').innerHTML=`<span id="heroOkrValueNum">0</span>%`;
    animateNumber(document.getElementById('heroOkrValueNum'), okrAchieve, {decimals:0});
    document.getElementById('heroOkrTarget').textContent=`Target THI: ${targetOKR}%`;
    const prevOkrTarget=prevCfg.targetOKR;
    const prevOkrAchieve=(prevAvg&&prevOkrTarget)?prevAvg.total/prevOkrTarget*100:null;
    const okrDeltaEl=document.getElementById('heroDelta');
    if(prevOkrAchieve!==null){
      const od=okrAchieve-prevOkrAchieve;
      okrDeltaEl.innerHTML=`<i class="ti ti-arrow-${od>=0?'up':'down'}"></i> ${Math.abs(+dp(od))}% vs Previous Quarter`;
      okrDeltaEl.className=`hero-delta ${od>=0?'up':'dn'}`;
    }else{
      okrDeltaEl.innerHTML='No previous quarter loaded';
      okrDeltaEl.className='hero-delta';
    }
  }else{
    document.getElementById('heroOkrValue').textContent='—';
    document.getElementById('heroOkrTarget').textContent='Target OKR not set in Config sheet';
    document.getElementById('heroDelta').innerHTML='';
  }

  // THI Score pill (icon + number, no ring chart anymore)
  document.getElementById('heroRingCenter').innerHTML=`${dp(score)}%`;

  const od=prev?score-prev.total:null;
  const ringDeltaEl=document.getElementById('heroRingDelta');
  if(od!==null){
    ringDeltaEl.style.display='flex';
    ringDeltaEl.className=`hero-pill-delta ${od>=0?'up':'dn'}`;
    ringDeltaEl.innerHTML=`<i class="ti ti-arrow-${od>=0?'up':'down'}" style="font-size:.7rem"></i>${dp(Math.abs(od))} vs Previous Period`;
  }else{
    ringDeltaEl.style.display='none';
  }

  const hbEl=document.getElementById('heroBadge');
  if(hbEl){
    hbEl.innerHTML=`<i class="ti ${smt.ic}"></i> ${smt.l}`;hbEl.className=`hero-badge ${smt.cl}`;
    const hbtEl=document.getElementById('heroBadgeTooltip');
    if(hbtEl) hbtEl.innerHTML=`
      <div class="hero-badge-tt-title">Status Definition (THI Score)</div>
      <div class="hero-badge-tt-row"><span>Excellent</span><span style="color:#c4b5fd">≥ 80%</span></div>
      <div class="hero-badge-tt-row"><span>Good</span><span style="color:#7fdbb6">≥ 73%</span></div>
      <div class="hero-badge-tt-row"><span>Fair</span><span style="color:#FCA311">≥ 65%</span></div>
      <div class="hero-badge-tt-row"><span>Needs Attention</span><span style="color:#f87171">&lt; 65%</span></div>`;
  }

  // ── NPS HERO CARD ──
  document.getElementById('npsHeroTopLabel').textContent=`NET PROMOTER SCORE · ${(heroQ?.label||'').toUpperCase()}`;
  document.getElementById('npsHeroIllus').innerHTML=npsHeroSVG();
  const targetNPS=cfg.targetNPS??null;
  if(targetNPS){
    const npsAchieve=nps.nps/targetNPS*100;
    document.getElementById('npsHeroAchieveValue').innerHTML=`<span id="npsHeroAchieveValueNum">0</span>%`;
    animateNumber(document.getElementById('npsHeroAchieveValueNum'), npsAchieve, {decimals:0});
    document.getElementById('npsHeroTarget').textContent=`Target NPS: ${targetNPS}`;
    const prevTargetNPS=prevCfg.targetNPS;
    const prevNpsAchieve=(pNPS&&prevTargetNPS)?pNPS.nps/prevTargetNPS*100:null;
    const npsDeltaEl=document.getElementById('npsHeroDelta');
    if(prevNpsAchieve!==null){
      const nd=npsAchieve-prevNpsAchieve;
      npsDeltaEl.innerHTML=`<i class="ti ti-arrow-${nd>=0?'up':'down'}"></i> ${Math.abs(+dp(nd))}% vs Previous Quarter`;
      npsDeltaEl.className=`hero-delta ${nd>=0?'up':'dn'}`;
    }else{
      npsDeltaEl.innerHTML='No previous quarter loaded';
      npsDeltaEl.className='hero-delta';
    }
  }else{
    document.getElementById('npsHeroAchieveValue').textContent='—';
    document.getElementById('npsHeroTarget').textContent='Target NPS not set in Config sheet';
    document.getElementById('npsHeroDelta').innerHTML='';
  }

  // NPS Score ring: sentiment-based icon/color (mirrors the THI Score "sentiment" pattern),
  // ring fill proportional to NPS clamped to a 0-100 display range (real-world NPS here is
  // practically always positive, but we guard the low end too).
  function npsSentimentCls(v){
    if(v>=30) return {icon:'ti-mood-smile', cls:''};
    if(v>=0)  return {icon:'ti-mood-neutral', cls:'sentiment-fair'};
    return {icon:'ti-mood-sad', cls:'sentiment-poor'};
  }
  const npsClamped=Math.max(0,Math.min(100,nps.nps));
  const RING_CIRC=2*Math.PI*31; // r=31, matches the enlarged SVG circle
  const ringFillLen=(npsClamped/100)*RING_CIRC;
  const {icon:npsIcon, cls:npsSentCls}=npsSentimentCls(nps.nps);

  const npsValEl=document.getElementById('npsHeroScoreVal');
  npsValEl.textContent=dp(nps.nps);
  npsValEl.className=`hero-gauge-val ${npsSentCls}`;

  const npsIconEl=document.getElementById('npsGaugeIcon');
  npsIconEl.className=`ti ${npsIcon} ${npsSentCls}`;

  const npsRingFillEl=document.getElementById('npsGaugeRingFill');
  npsRingFillEl.setAttribute('stroke-dasharray', `${ringFillLen} ${RING_CIRC}`);
  npsRingFillEl.setAttribute('stroke', npsSentCls==='sentiment-fair'?'#c97a00':npsSentCls==='sentiment-poor'?'#dc2626':'#2A835F');

  const npsD=pNPS?nps.nps-pNPS.nps:null;
  const npsScoreDeltaEl=document.getElementById('npsHeroScoreDelta');
  if(npsD!==null){
    npsScoreDeltaEl.style.display='inline-flex';
    npsScoreDeltaEl.className=`hero-gauge-delta ${npsD>=0?'up':'dn'}`;
    npsScoreDeltaEl.innerHTML=`<i class="ti ti-arrow-${npsD>=0?'up':'down'}" style="font-size:.65rem"></i>${dp(Math.abs(npsD))} vs prev`;
  }else{
    npsScoreDeltaEl.style.display='none';
  }

  // INSIGHTS
  const ins=[];
  if(prev){const dec=THI.AREAS.filter(a=>curr[a.key]<prev[a.key]).length;if(dec===THI.AREAS.length)ins.push({t:'neg',txt:`All ${THI.AREAS.length} areas declined vs previous quarter`});else if(dec===0)ins.push({t:'pos',txt:`All areas improved vs previous quarter`});else ins.push({t:dec>6?'neg':'pos',txt:`${dec} of ${THI.AREAS.length} areas declined vs previous quarter`})}
  else ins.push({t:'info',txt:'No previous quarter data — showing current quarter only'});
  const topA=sorted[0],botA=sorted[sorted.length-1];
  ins.push({t:'pos',txt:`<strong>${topA.label}</strong> remains the strongest area at ${pct(topA.val)}`});
  ins.push({t:'neg',txt:`<strong>${botA.label}</strong> needs attention at ${pct(botA.val)}`});
  if(pNPS){const nd=nps.nps-pNPS.nps;ins.push({t:nd>=0?'pos':'neg',txt:`NPS ${nd>=0?'improved':'dropped'} to <strong>${Math.round(nps.nps)}</strong> (${nd>=0?'▲':'▼'} ${Math.abs(Math.round(nd))} pts)`})}
  else ins.push({t:'info',txt:`NPS is <strong>${Math.round(nps.nps)}</strong> with ${Math.round(nps.promoters)}% promoters`});
  // Build highlighted insights paragraph
  const hl=(txt,cls)=>`<span style="display:inline;padding:1px 5px;border-radius:4px;font-weight:700;font-size:inherit;${
    cls==='pos'?'background:#dcfce7;color:#15803d':
    cls==='neg'?'background:#fee2e2;color:#dc2626':
    cls==='navy'?'background:#e8edf8;color:#14213D':
    cls==='warn'?'background:#fff7ed;color:#c2410c':
    'background:#fef3c7;color:#c97a00'}">${txt}</span>`;

  const topArea  = sorted[0];
  const botArea  = sorted[sorted.length-1];
  let declinedCount = 0;
  if(prev){ sorted.forEach(a=>{ const pk=Object.entries(prev).find(([k])=>k===a.key); if(pk&&a.val<pk[1]) declinedCount++; }); }
  const declinedTxt = prev ? ` Overall, ${declinedCount>0?hl(`${declinedCount} of 11 areas`,'warn')+' declined vs the previous quarter.':hl('all areas improved or held steady','pos')}.` : '';
  const npsTxt = ` NPS stands at ${hl(Math.round(nps.nps),'navy')} with ${hl(Math.round(nps.promoters)+'% promoters','navy')}.`;

  const paraHTML = `${hl(topArea.label,'pos')} remains the strongest area at ${hl(pct(topArea.val),'pos')}, while ${hl(botArea.label,'neg')} needs the most attention at ${hl(pct(botArea.val),'neg')}.${declinedTxt}${npsTxt}`;

  const parasEl = document.getElementById('insightsPara');
  if(parasEl) parasEl.innerHTML = paraHTML;
  // Keep insightsList for backward compat (hidden)
  const listEl = document.getElementById('insightsList');
  if(listEl) listEl.innerHTML='';

  // KPI CARDS
  const q=THI.quarters[THI.activeQuarter];const pop=q?.population;
  let partLabel='Responses',partVal=`${resp.length.toLocaleString()}`,partSub='Total respondents this quarter',partBar=100;
  if(pop){let popN=getEffectivePopulationTotal(q),respN=resp.length;if(STATE.dept==='Marketing (Combined)'&&pop.byDeptGroup?.Marketing)popN=pop.byDeptGroup.Marketing;else if(STATE.dept!=='all'&&pop.byDept[STATE.dept])popN=pop.byDept[STATE.dept];else if(STATE.tenure!=='all'&&pop.byTenure[STATE.tenure])popN=pop.byTenure[STATE.tenure];const rate=respN/popN*100;partLabel='Participation Rate';partVal=`${dp(rate)}%`;partSub=`${respN.toLocaleString()} of ${popN.toLocaleString()} Timmys`;partBar=Math.min(rate,100)}
  document.getElementById('kpiRow').innerHTML=`
    <div class="kpi-card green">
      <div class="kpi-bg-icon"><i class="ti ti-users"></i></div>
      <div class="kpi-content">
        <div class="kpi-label">${partLabel}</div>
        <div class="kpi-val">${partVal}</div>
        <div class="kpi-sub">${partSub}</div>
      </div>
      <div class="kpi-prog"><div class="kpi-prog-fill" id="kpiBar0" style="width:0%"></div></div>
    </div>
    <div class="kpi-card emerald">
      <div class="kpi-bg-icon"><i class="ti ti-trophy"></i></div>
      <div class="kpi-content">
        <div class="kpi-label">Top Area</div>
        <div class="kpi-val" id="kpiValTop">${pct(topA.val)==='—'?'—':'0%'}</div>
        <div class="kpi-sub">${topA.label}</div>
      </div>
      <div class="kpi-prog"><div class="kpi-prog-fill" id="kpiBar2" style="width:0%"></div></div>
    </div>
    <div class="kpi-card red">
      <div class="kpi-bg-icon"><i class="ti ti-alert-triangle"></i></div>
      <div class="kpi-content">
        <div class="kpi-label">Bottom Area</div>
        <div class="kpi-val" id="kpiValBot">${pct(botA.val)==='—'?'—':'0%'}</div>
        <div class="kpi-sub">${botA.label}</div>
      </div>
      <div class="kpi-prog"><div class="kpi-prog-fill" id="kpiBar3" style="width:0%"></div></div>
    </div>`;

  if(pct(topA.val)!=='—') animateNumber(document.getElementById('kpiValTop'), topA.val, {decimals:STATE.decimals?2:0, suffix:'%'});
  if(pct(botA.val)!=='—') animateNumber(document.getElementById('kpiValBot'), botA.val, {decimals:STATE.decimals?2:0, suffix:'%'});
  animateWidth(document.getElementById('kpiBar0'), partBar);
  animateWidth(document.getElementById('kpiBar2'), topA.val);
  animateWidth(document.getElementById('kpiBar3'), botA.val);


  // NPS — A2 design: green tinted header + mini bar chart + stacked bar + breakdown rows
  const pPct=Math.round(nps.promoters), aPct=Math.round(nps.passives), dPct=Math.round(nps.detractors);
  const npsD2=pNPS?nps.nps-pNPS.nps:null;
  const npsVal=Math.round(nps.nps);
  const promoterCount=Math.round(resp.length*nps.promoters/100);
  const passiveCount=Math.round(resp.length*nps.passives/100);
  const detractorCount=resp.length-promoterCount-passiveCount;
  if(CH.npsOv){CH.npsOv.destroy();CH.npsOv=null;}
  if(CH.dist){CH.dist.destroy();CH.dist=null;}

  // Build mini bar chart — NPS per quarter, scale max=60
  const NPS_MAX = 60;
  const npsQuarterBars = THI.quarters.map(q=>{
    if(!q.loaded||!q.respondents?.length) return null;
    return Math.round(THI.calcNPS(q.respondents).nps);
  });

  const deltaBadge = npsD2!==null
    ? `<div class="nps-delta-badge ${npsD2>=0?'pos':'neg'}">${npsD2>=0?'▲':'▼'} ${dp(Math.abs(npsD2))} vs prev quarter</div>`
    : `<div class="nps-delta-badge neu">No previous quarter</div>`;

  document.getElementById('distLegend').innerHTML=`
    <div class="nps-header">
      <div class="nps-header-left">
        <div class="nps-sublbl">Net Promoter Score</div>
        <div class="nps-big-num" id="npsBigNum">0</div>
        ${deltaBadge}
      </div>
      <div class="nps-header-divider"></div>
      <div class="nps-mini-chart">
        <div class="nps-mini-title">NPS Trend by Quarter</div>
        <div class="nps-mini-bars" style="position:relative;height:110px"><canvas id="npsTrendChart"></canvas></div>
      </div>
    </div>
    <div class="nps-stacked">
      <div style="width:0%;transition:width .6s var(--ease-lift);background:${G.navy};height:100%;border-radius:8px 0 0 8px" data-w="${pPct}%"></div>
      <div style="width:0%;transition:width .6s var(--ease-lift);background:${G.gold};height:100%" data-w="${aPct}%"></div>
      <div style="width:0%;transition:width .6s var(--ease-lift);background:${G.red};height:100%;border-radius:0 8px 8px 0" data-w="${dPct}%"></div>
    </div>
    <div class="nps-rows">
      <div class="nps-row">
        <i class="ti ti-thumb-up" style="color:${G.navy};font-size:1rem;width:18px;text-align:center"></i>
        <span class="nps-rname" style="color:var(--navy)">Promoters</span>
        <div class="nps-rbar"><div style="width:0%;transition:width .6s var(--ease-lift);background:${G.navy};height:100%;border-radius:4px" data-w="${pPct}%"></div></div>
        <span class="nps-rval" style="color:var(--navy)">${promoterCount} (${pPct}%)</span>
      </div>
      <div class="nps-row">
        <i class="ti ti-hand-stop" style="color:${G.gold};font-size:1rem;width:18px;text-align:center"></i>
        <span class="nps-rname" style="color:var(--gold-dk)">Passives</span>
        <div class="nps-rbar"><div style="width:0%;transition:width .6s var(--ease-lift);background:${G.gold};height:100%;border-radius:4px" data-w="${aPct}%"></div></div>
        <span class="nps-rval" style="color:var(--gold-dk)">${passiveCount} (${aPct}%)</span>
      </div>
      <div class="nps-row">
        <i class="ti ti-thumb-down" style="color:${G.red};font-size:1rem;width:18px;text-align:center"></i>
        <span class="nps-rname" style="color:#dc2626">Detractors</span>
        <div class="nps-rbar"><div style="width:0%;transition:width .6s var(--ease-lift);background:${G.red};height:100%;border-radius:4px" data-w="${dPct}%"></div></div>
        <span class="nps-rval" style="color:#dc2626">${detractorCount} (${dPct}%)</span>
      </div>
    </div>`;
  growBars(document.getElementById('distLegend'));
  animateNumber(document.getElementById('npsBigNum'), npsVal, {decimals:0});

  // NPS Trend by Quarter — same visual pattern as the Timmy Happiness Index Trend chart
  const npsTrendLabels=THI.quarters.map(q=>q.label.replace('Quarter ','Q'));
  const npsBarColors=npsQuarterBars.map((v,i)=>v===null?'#e2e8f0':i===THI.activeQuarter?G.gold:G.navy);
  const npsTrendData={labels:npsTrendLabels,datasets:[{
    label:'NPS',
    data:npsQuarterBars.map(v=>v!==null?v:0),
    backgroundColor:ctx=>barBevelGradient(ctx.chart, ctx.dataIndex, npsBarColors),
    borderRadius:6,
    borderSkipped:false,
  }]};
  const npsTrendOpts={
    responsive:true,maintainAspectRatio:false,
    plugins:{
      legend:{display:false},
      datalabels:{
        display:ctx=>npsQuarterBars[ctx.dataIndex]!==null,
        anchor:'end',align:'top',
        font:{size:10,weight:'700'},
        formatter:(v,ctx)=>npsQuarterBars[ctx.dataIndex]!==null?`${v}`:'',
        color:G.text
      },
      tooltip:{callbacks:{label:c=>npsQuarterBars[c.dataIndex]!==null?` NPS: ${c.parsed.y}`:' No data yet'}}
    },
    scales:{
      y:{min:0,max:NPS_MAX,display:false},
      x:{grid:{display:false},ticks:{font:{size:9.5,weight:'700'},color:ctx=>npsQuarterBars[ctx.index]!==null?G.text:G.text3}}
    }
  };
  const npsTrendCanvas=document.getElementById('npsTrendChart');
  if(npsTrendCanvas){
    if(CH.npsTrend && CH.npsTrend.canvas && CH.npsTrend.canvas.isConnected){
      CH.npsTrend.data=npsTrendData;CH.npsTrend.options=npsTrendOpts;CH.npsTrend.update();
    }else{
      try{ if(CH.npsTrend) CH.npsTrend.destroy(); }catch(e){}
      CH.npsTrend=new Chart(npsTrendCanvas.getContext('2d'),{type:'bar',data:npsTrendData,options:npsTrendOpts});
    }
  }



  // TOP 3 / BOTTOM 3 DEPARTMENTS
  const depts=[...new Set(resp.map(r=>r.dept))];
  const deptScores=depts.map(d=>({d,v:THI.calcAreaScores(resp.filter(r=>r.dept===d),STATE.method).total})).sort((a,b)=>b.v-a.v);
  const deptRowHtml=(list,cls)=>list.map((r,i)=>`
    <div class="rank-row">
      <div class="rank-num" style="background:${cls==='g'?['#16a34a','#22c55e','#4ade80'][i]:['#ef4444','#f87171','#fca5a5'][i]};color:#fff">${i+1}</div>
      <div class="rank-name">${r.d}</div>
      <div class="rank-bar"><div class="rank-bar-fill" style="width:0%;transition:width .6s var(--ease-lift);background:${cls==='g'?barGradCSS('#16a34a'):barGradCSS('#ef4444')}" data-w="${r.v}%"></div></div>
      <div class="rank-val" style="color:${cls==='g'?'#16a34a':'#ef4444'}">${pct(r.v)}</div>
    </div>`).join('');
  const top3DeptEl=document.getElementById('top3Dept'), bot3DeptEl=document.getElementById('bot3Dept');
  refreshHTML(top3DeptEl, deptRowHtml(deptScores.slice(0,3),'g'), ()=>growBars(top3DeptEl));
  refreshHTML(bot3DeptEl, deptRowHtml([...deptScores].reverse().slice(0,3),'r'), ()=>growBars(bot3DeptEl));

  // (Area Performance moved to the Comparison tab — see renderAreaPerfTable())

  // TOP 3 / BOTTOM 3 AREAS
  const areaRowHtml=(list,cls)=>list.map((a,i)=>`
    <div class="rank-row">
      <div class="rank-num" style="background:${cls==='g'?['#16a34a','#22c55e','#4ade80'][i]:['#ef4444','#f87171','#fca5a5'][i]};color:#fff">${i+1}</div>
      <div class="rank-name">${a.label}</div>
      <div class="rank-bar"><div class="rank-bar-fill" style="width:0%;transition:width .6s var(--ease-lift);background:${cls==='g'?barGradCSS('#16a34a'):barGradCSS('#ef4444')}" data-w="${a.val}%"></div></div>
      <div class="rank-val" style="color:${cls==='g'?'#16a34a':'#ef4444'}">${pct(a.val)}</div>
    </div>`).join('');
  const top3AreasEl=document.getElementById('top3Areas');
  refreshHTML(top3AreasEl, areaRowHtml(sorted.slice(0,3),'g'), ()=>growBars(top3AreasEl));
  const bot3AreasEl=document.getElementById('bot3Areas');
  refreshHTML(bot3AreasEl, areaRowHtml([...sorted].reverse().slice(0,3),'r'), ()=>growBars(bot3AreasEl));

  // TOP/BOTTOM Q
  const items=THI.calcItemScores(resp,STATE.method).map((it,i)=>({...it,label:THI.QUESTION_LABELS[i]||`Question ${i+1}`}));
  const qTop=[...items].sort((a,b)=>b.score-a.score).slice(0,3);
  const qBot=[...items].sort((a,b)=>a.score-b.score).slice(0,3);
  const qHtml=(list,cls,nc)=>list.map((it,i)=>`<div class="q-row"><span class="q-num ${nc}">${i+1}</span><div class="q-body"><div class="q-area">${it.area}</div><div class="q-text">${it.label}</div></div><span class="q-val ${cls}">${pct(it.score)}</span></div>`).join('');
  refreshHTML(document.getElementById('top3Q'), qHtml(qTop,'qv-g','qn-g'));
  refreshHTML(document.getElementById('bot3Q'), qHtml(qBot,'qv-r','qn-r'));

  // Jumbotron stats
  const jumboQ = document.getElementById('jumboQuarter');
  const jumboS = document.getElementById('jumboScore');
  const jumboR = document.getElementById('jumboResp');
  const jumboRt= document.getElementById('jumboRate');
  if(jumboQ) jumboQ.textContent = THI.quarters[THI.activeQuarter]?.label||'';
  if(jumboS) jumboS.textContent = `${dp(score)}%`;
  if(jumboR) jumboR.textContent = resp.length.toLocaleString();
  if(jumboRt){
    const pop2 = getEffectivePopulationTotal(THI.quarters[THI.activeQuarter]);
    jumboRt.textContent = `${dp(resp.length/pop2*100)}%`;
  }
  const smt2=sentiment(score);
  const top3n=sorted.slice(0,3).map(a=>a.label).join(', ');
  const bot3n=sorted.slice(-3).map(a=>a.label).join(', ');
  let trend='';if(prev){const d=score-prev.total;trend=d>0?`, improving by ${Math.abs(+dp(d))} points`:d<0?`, declining by ${Math.abs(+dp(d))} points`:`, holding steady`}
  let npsNote=pNPS?` NPS stands at ${dp(nps.nps)} (${nps.nps>=pNPS.nps?'▲':'▼'}${dp(Math.abs(nps.nps-pNPS.nps))} vs prev).`:` NPS is ${dp(nps.nps)} with ${dp(nps.promoters)}% promoters.`;

  // Extract trending topics from open feedback (q45/q46)
  const allFB = [];
  resp.forEach(r=>{
    if((r.q45||'').trim().length>3) allFB.push(r.q45.trim().toLowerCase());
    if((r.q46||'').trim().length>3) allFB.push(r.q46.trim().toLowerCase());
  });
  // Simple keyword frequency
  const KW = {
    'internet & infrastructure':['internet','wifi','wi-fi','infrastru','kantor','office','laptop','device'],
    'work flexibility (WFH)':['wfh','work from home','remote','hybrid','fleksibel','flexibility'],
    'collaboration':['kolabor','collaborat','one idn','cross','divisi','team work'],
    'leadership & management':['manajer','manager','leader','manajemen','management','atasan'],
    'decision making':['keputusan','decision','decision-making','birokrasi','proses kerja','efisien'],
    'recognition & benefits':['apresiasi','recogni','benefit','kompensasi','salary','gaji','tunjangan'],
    'culture & environment':['kultur','culture','lingkungan','environ','nyaman','suasana'],
  };
  const kwCount={};
  Object.keys(KW).forEach(topic=>{
    kwCount[topic]=allFB.filter(fb=>KW[topic].some(kw=>fb.includes(kw))).length;
  });
  const topTopics = Object.entries(kwCount).filter(([,c])=>c>0).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([t])=>t);
  const trendingTxt = topTopics.length ? `This quarter, Timmys most frequently mentioned: ${topTopics.join(', ')}.` : '';

  const summaryEl = document.getElementById('aiText');
  const wrapEl    = document.getElementById('aiSummaryWrap');
  if(summaryEl&&wrapEl){
    const hlG = txt=>`<span style="display:inline;padding:1px 4px;border-radius:4px;font-weight:700;font-size:inherit;background:#fef3c7;color:#c97a00">${txt}</span>`;
    const topicsHTML = topTopics.length
      ? `This quarter, Timmys most frequently mentioned ${topTopics.map(t=>hlG(t)).join(', ')} in their open feedback.`
      : 'No significant feedback themes detected this quarter.';
    summaryEl.innerHTML = topicsHTML;
    wrapEl.style.display = 'block';
  }
  try{ document.getElementById('aiRobot').innerHTML=''; }catch(e){}
  document.getElementById('footerDate').textContent=new Date().toLocaleDateString('en-US',{day:'numeric',month:'long',year:'numeric'});
}

// ── DEPARTMENT ─────────────────────────────────────────────────────
function renderDept(){
  const q=THI.quarters[THI.activeQuarter];const allR=q?.respondents||[];if(!allR.length)return;
  const depts=[...new Set(allR.map(r=>r.dept))].sort();
  const mkRow=resp=>{const s=THI.calcAreaScores(resp,STATE.method);const n=THI.calcNPS(resp);return{overall:s.total,nps:n.nps,...Object.fromEntries(THI.AREAS.map(a=>[a.key,s[a.key]]))}};
  const allRow=mkRow(allR);const rows=depts.map(d=>({dept:d,...mkRow(allR.filter(r=>r.dept===d))}));
  const AREA_KEYS=THI.AREAS.map(a=>a.key);
  const COLS=['overall','nps',...AREA_KEYS];
  const LABEL={overall:'Overall',nps:'NPS',vv:'Vision',ld:'Leader',tw:'Team',cm:'Comm',cu:'Culture',pd:'Dev',ap:'Account.',rc:'Recog.',ws:'Workplace',in:'Integrity',tx:'Timmy Exp'};

  // Prev quarter rows for delta
  const prevQ=THI.activeQuarter>0?THI.quarters[THI.activeQuarter-1]:null;
  const prevRows={};
  if(prevQ?.respondents?.length){
    const pDepts=[...new Set(prevQ.respondents.map(r=>r.dept))];
    pDepts.forEach(d=>{prevRows[d]=mkRow(prevQ.respondents.filter(r=>r.dept===d));});
  }
  const prevAllRow = prevQ?.respondents?.length ? mkRow(prevQ.respondents) : null;

  // Delta arrow helper
  const deltaArrow=(curr,prev,key)=>{
    if(!prev||prev[key]==null) return '';
    const d=curr[key]-prev[key];
    if(Math.abs(d)<0.2) return '';
    const col=d>0?'#16a34a':'#dc2626';
    const arr=d>0?'▲':'▼';
    return `<span style="font-size:.62rem;color:${col};margin-left:2px;font-weight:700">${arr}</span>`;
  };

  // Cell value with delta
  const cellVal=(row,prevRow,key)=>{
    const val = key==='nps'?dp(row[key]):pct(row[key]);
    const arrow = deltaArrow(row, prevRow, key);
    return `${val}${arrow}`;
  };

  // Highlight: per ROW — top 3 and bottom 3 areas (exclude overall & nps from ranking)
  const rowCellClass=(row, key)=>{
    if(key==='overall'||key==='nps') return '';
    const areaVals = AREA_KEYS.map(k=>({k, v:row[k]})).sort((a,b)=>b.v-a.v);
    const rank = areaVals.findIndex(a=>a.k===key);
    if(rank<3) return `ct${rank+1}`;
    if(rank>=AREA_KEYS.length-3) return `cb${AREA_KEYS.length-rank}`;
    return '';
  };

  document.getElementById('deptHead').innerHTML=`<th class="dept-name" style="min-width:140px;text-align:left;padding-left:12px">Department</th>${COLS.map(k=>`<th>${LABEL[k]}</th>`).join('')}`;
  refreshHTML(document.getElementById('deptBody'),
    rows.map(row=>`<tr><td class="dept-name">${row.dept}</td>${COLS.map(k=>`<td class="${rowCellClass(row,k)}">${cellVal(row,prevRows[row.dept],k)}</td>`).join('')}</tr>`).join('')+
    `<tr class="row-all"><td class="dept-name">All Departments</td>${COLS.map(k=>`<td class="${rowCellClass(allRow,k)}">${cellVal(allRow,prevAllRow,k)}</td>`).join('')}</tr>`);

  // Column hover highlight
  setTimeout(()=>{
    const table = document.querySelector('.dept-table');
    if(!table) return;
    const ths = table.querySelectorAll('thead th');
    ths.forEach((th,colIdx)=>{
      if(colIdx===0) return; // skip dept name col
      th.addEventListener('mouseenter',()=>{
        ths.forEach(t=>t.classList.remove('col-active'));
        th.classList.add('col-active');
        table.querySelectorAll('tbody tr').forEach(tr=>{
          tr.querySelectorAll('td').forEach((td,i)=>{
            if(i===colIdx) td.classList.add('col-hover');
            else td.classList.remove('col-hover');
          });
        });
      });
      th.addEventListener('mouseleave',()=>{
        th.classList.remove('col-active');
        table.querySelectorAll('.col-hover').forEach(td=>td.classList.remove('col-hover'));
      });
    });
  }, 50);
  // Dept Overall Chart — VERTICAL bar with delta vs prev quarter
  const sortedD=[...rows].sort((a,b)=>b.overall-a.overall);
  const n=sortedD.length;

  // Prev quarter dept scores
  const pq=THI.activeQuarter>0?THI.quarters[THI.activeQuarter-1]:null;
  const prevDeptScores={};
  if(pq?.respondents?.length){
    const pDepts=[...new Set(pq.respondents.map(r=>r.dept))];
    pDepts.forEach(d=>{
      const pResp=pq.respondents.filter(r=>r.dept===d);
      prevDeptScores[d]=THI.calcAreaScores(pResp,STATE.method).total;
    });
  }

  // Gradient navy→gold→red
  const gradColors=sortedD.map((_,i)=>{
    const t=n<=1?0:i/(n-1);
    if(t<0.5){const f=t/0.5;return `rgb(${Math.round(20+(252-20)*f)},${Math.round(33+(163-33)*f)},${Math.round(61+(17-61)*f)})`;}
    else{const f=(t-0.5)/0.5;return `rgb(${Math.round(252+(239-252)*f)},${Math.round(163+(68-163)*f)},${Math.round(17+(68-17)*f)})`;}
  });

  const shortLabel=name=>name.length>12?name.slice(0,11)+'…':name;
  if(CH.dOv)CH.dOv.destroy();

  const deltaColors = sortedD.map(r=>{
    const prev=prevDeptScores[r.dept];
    if(!prev) return '#94a3b8';
    const d=r.overall-prev;
    return d>0.1?'#16a34a':d<-0.1?'#dc2626':'#94a3b8';
  });
  const deltaLabels = sortedD.map(r=>{
    const prev=prevDeptScores[r.dept];
    if(!prev) return '';
    const d=r.overall-prev;
    const arrow=d>0.1?'▲':d<-0.1?'▼':'=';
    const sign=d>0.1?'+':'';
    return `${arrow}${sign}${dp(Math.abs(d))}%`;
  });

  const dOvData={
    labels:sortedD.map(r=>shortLabel(r.dept)),
    datasets:[
      {
        label:'Overall Score',
        data:sortedD.map(r=>+r.overall.toFixed(1)),
        backgroundColor:ctx=>barBevelGradient(ctx.chart, ctx.dataIndex, gradColors),
        borderRadius:5,
        barPercentage:0.65,
        datalabels:{
          anchor:'end',align:'top',offset:14,
          font:{size:10,weight:'800'},
          color:ctx=>gradColors[ctx.dataIndex],
          formatter:v=>`${dp(v)}%`,
        }
      },
      {
        label:'Delta',
        data:sortedD.map(r=>+r.overall.toFixed(1)),
        backgroundColor:'transparent',
        borderWidth:0,
        barPercentage:0.65,
        datalabels:{
          anchor:'end',align:'top',offset:2,
          font:{size:9,weight:'700'},
          color:ctx=>deltaColors[ctx.dataIndex],
          formatter:(_,ctx)=>deltaLabels[ctx.dataIndex],
        }
      }
    ]
  };
  const dOvOptions={
    responsive:true,maintainAspectRatio:false,
    layout:{padding:{top:48}},
    plugins:{
      legend:{display:false},
      tooltip:{
        callbacks:{
          title:ctx=>sortedD[ctx[0].dataIndex].dept,
          label:c=>{
            const dept=sortedD[c.dataIndex].dept;
            const prev=prevDeptScores[dept];
            const curr=c.parsed.y.toFixed(1);
            if(prev==null) return ` Overall: ${curr}%`;
            const d=(c.parsed.y-prev).toFixed(1);
            return [` Overall: ${curr}%`, ` vs prev: ${d>0?'+':''}${d}%`];
          }
        }
      }
    },
    scales:{
      y:{min:0,max:100,ticks:{callback:v=>`${v}%`,font:{size:10}},grid:{color:'#f1f5f9'}},
      x:{ticks:{font:{size:9.5},maxRotation:35,minRotation:25},grid:{display:false}}
    }
  };
  // Update in place when the bar count hasn't changed (most filter/method changes) —
  // Chart.js animates the transition between old and new values smoothly.
  // Only destroy+recreate when the structure actually changes (different dept count),
  // OR when the existing chart's canvas is no longer attached to the page (stale reference).
  const dOvCanvas = document.getElementById('deptOvChart');
  const dOvCanvasOk = dOvCanvas && dOvCanvas.isConnected;
  if(CH.dOv && dOvCanvasOk && CH.dOv.canvas && CH.dOv.canvas.isConnected && CH.dOv.data.labels.length===dOvData.labels.length){
    try{
      CH.dOv.data=dOvData;
      CH.dOv.options=dOvOptions;
      CH.dOv.update();
    }catch(e){
      console.error('deptOvChart update failed, recreating:', e);
      CH.dOv=null;
    }
  }
  if(!CH.dOv || !CH.dOv.canvas || !CH.dOv.canvas.isConnected){
    try{ if(CH.dOv) CH.dOv.destroy(); }catch(e){}
    if(dOvCanvasOk){
      try{
        CH.dOv=new Chart(dOvCanvas.getContext('2d'),{type:'bar',data:dOvData,options:dOvOptions});
      }catch(e){
        console.error('deptOvChart creation failed:', e);
      }
    }
  }
  // Area chart removed
  if(CH.dAr){CH.dAr.destroy();CH.dAr=null;}

  // Level heatmap table
  const lvlEl = document.getElementById('levelHeatmap');
  if(lvlEl&&allR.length){
    const LEVEL_ORD=['Associate','Sr. Associate','Manager','Sr. Manager','Functional','Team Lead'];
    const levels = LEVEL_ORD.filter(l=>allR.some(r=>r.level===l));
    const AREA_KEYS3 = THI.AREAS.map(a=>a.key);
    const LABEL3={vv:'Vision',ld:'Leader',tw:'Team',cm:'Comm',cu:'Culture',pd:'Dev',ap:'Account.',rc:'Recog.',ws:'Workplace',in:'Integrity',tx:'Timmy Exp'};

    if(!levels.length){
      lvlEl.innerHTML='<tbody><tr><td style="padding:16px;text-align:center;color:#94a3b8;font-size:.82rem">Level data is not available for this quarter yet.</td></tr></tbody>';
    }else{
      const lvlRowClass=(areaValMap, key)=>{
        const sorted = AREA_KEYS3.map(k=>({k,v:areaValMap[k]})).sort((a,b)=>b.v-a.v);
        const rank = sorted.findIndex(a=>a.k===key);
        if(rank<3) return `ct${rank+1}`;
        if(rank>=AREA_KEYS3.length-3) return `cb${AREA_KEYS3.length-rank}`;
        return '';
      };

      let h3=`<thead><tr>
        <th style="min-width:120px;text-align:left;padding-left:12px;background:var(--navy);color:#fff;font-size:.63rem">Level</th>
        <th style="text-align:center;background:var(--navy);color:#fff;font-size:.63rem">Overall</th>
        <th style="text-align:center;background:var(--navy);color:#fff;font-size:.63rem">NPS</th>
        ${THI.AREAS.map(a=>`<th style="text-align:center;background:var(--navy);color:#fff;font-size:.63rem;white-space:nowrap">${LABEL3[a.key]||a.label}</th>`).join('')}
      </tr></thead><tbody>`;

      const allScores3=THI.calcAreaScores(allR,STATE.method);
      const allNPS3=THI.calcNPS(allR).nps;
      const allValMap3={...Object.fromEntries(AREA_KEYS3.map(k=>[k,allScores3[k]]))};

      const prevLevelRows={};
      const prevAllLevel = pq?.respondents?.length ? {total:THI.calcAreaScores(pq.respondents,STATE.method).total,...Object.fromEntries(AREA_KEYS3.map(k=>[k,THI.calcAreaScores(pq.respondents,STATE.method)[k]]))} : null;
      if(pq?.respondents?.length){
        const pLevels=[...new Set(pq.respondents.map(r=>r.level).filter(Boolean))];
        pLevels.forEach(l=>{
          const pResp=pq.respondents.filter(r=>r.level===l);
          const ps=THI.calcAreaScores(pResp,STATE.method);
          prevLevelRows[l]={total:ps.total,...Object.fromEntries(AREA_KEYS3.map(k=>[k,ps[k]]))};
        });
      }

      const lvlDelta=(curr,prevRow,key)=>{
        if(!prevRow||prevRow[key]==null) return '';
        const d=curr-prevRow[key];
        if(Math.abs(d)<0.2) return '';
        const col=d>0?'#16a34a':'#dc2626';
        return `<span style="font-size:.62rem;color:${col};margin-left:2px;font-weight:700">${d>0?'▲':'▼'}</span>`;
      };

      levels.forEach(l=>{
        const lResp=allR.filter(r=>r.level===l);
        const ls=THI.calcAreaScores(lResp,STATE.method);
        const lnps=THI.calcNPS(lResp).nps;
        const valMap3={...Object.fromEntries(AREA_KEYS3.map(k=>[k,ls[k]]))};
        const pLvlRow = prevLevelRows[l]||null;
        h3+=`<tr>
          <td style="font-size:.8rem;font-weight:600;padding-left:12px;border-bottom:1px solid #f1f5f9">${l}</td>
          <td style="text-align:center;font-size:.8rem;font-weight:600;background:transparent!important">${pct(ls.total)}${lvlDelta(ls.total,pLvlRow,'total')}</td>
          <td style="text-align:center;font-size:.8rem;font-weight:600;background:transparent!important">${dp(lnps)}</td>
          ${THI.AREAS.map(a=>`<td class="${lvlRowClass(valMap3,a.key)}" style="text-align:center;font-size:.78rem">${pct(ls[a.key])}${lvlDelta(ls[a.key],pLvlRow,a.key)}</td>`).join('')}
        </tr>`;
      });

      h3+=`<tr class="row-all">
        <td style="font-size:.8rem;font-weight:800;padding-left:12px">All Levels</td>
        <td style="text-align:center;font-size:.8rem;font-weight:700;background:#eef0f5!important">${pct(allScores3.total)}${lvlDelta(allScores3.total,prevAllLevel,'total')}</td>
        <td style="text-align:center;font-size:.8rem;font-weight:700;background:#eef0f5!important">${dp(allNPS3)}</td>
        ${THI.AREAS.map(a=>`<td class="${lvlRowClass(allValMap3,a.key)}" style="text-align:center;font-size:.78rem;font-weight:700">${pct(allScores3[a.key])}${lvlDelta(allScores3[a.key],prevAllLevel,a.key)}</td>`).join('')}
      </tr></tbody>`;
      refreshHTML(lvlEl, h3);
    }
  }

  // Tenure heatmap table
  const tenEl = document.getElementById('tenureHeatmap');
  if(tenEl&&allR.length){
    const TORD2=['< 6 months','6 months – 1 yr','1 – 2 years','2 – 3 years','3 – 4 years','4 – 5 years','> 5 years'];
    const tenures = TORD2.filter(t=>allR.some(r=>r.tenure===t));
    const AREA_KEYS2 = THI.AREAS.map(a=>a.key);
    const LABEL2={vv:'Vision',ld:'Leader',tw:'Team',cm:'Comm',cu:'Culture',pd:'Dev',ap:'Account.',rc:'Recog.',ws:'Workplace',in:'Integrity',tx:'Timmy Exp'};

    // Per-row highlight: top 3 gold, bottom 3 red — area columns only (not overall, not nps)
    const tenRowClass=(areaValMap, key)=>{
      const sorted = AREA_KEYS2.map(k=>({k,v:areaValMap[k]})).sort((a,b)=>b.v-a.v);
      const rank = sorted.findIndex(a=>a.k===key);
      if(rank<3) return `ct${rank+1}`;
      if(rank>=AREA_KEYS2.length-3) return `cb${AREA_KEYS2.length-rank}`;
      return '';
    };

    let h2=`<thead><tr>
      <th style="min-width:120px;text-align:left;padding-left:12px;background:var(--navy);color:#fff;font-size:.63rem">Tenure</th>
      <th style="text-align:center;background:var(--navy);color:#fff;font-size:.63rem">Overall</th>
      <th style="text-align:center;background:var(--navy);color:#fff;font-size:.63rem">NPS</th>
      ${THI.AREAS.map(a=>`<th style="text-align:center;background:var(--navy);color:#fff;font-size:.63rem;white-space:nowrap">${LABEL2[a.key]||a.label}</th>`).join('')}
    </tr></thead><tbody>`;

    const allScores=THI.calcAreaScores(allR,STATE.method);
    const allNPS=THI.calcNPS(allR).nps;
    const allValMap={...Object.fromEntries(AREA_KEYS2.map(k=>[k,allScores[k]]))};

    // Prev quarter tenure scores for delta
    const prevTenureRows={};
    const prevAllTenure = pq?.respondents?.length ? {total:THI.calcAreaScores(pq.respondents,STATE.method).total,...Object.fromEntries(AREA_KEYS2.map(k=>[k,THI.calcAreaScores(pq.respondents,STATE.method)[k]]))} : null;
    if(pq?.respondents?.length){
      const pTenures=[...new Set(pq.respondents.map(r=>r.tenure))];
      pTenures.forEach(t=>{
        const pResp=pq.respondents.filter(r=>r.tenure===t);
        const ps=THI.calcAreaScores(pResp,STATE.method);
        prevTenureRows[t]={total:ps.total,...Object.fromEntries(AREA_KEYS2.map(k=>[k,ps[k]]))};
      });
    }

    const tenDelta=(curr,prevRow,key)=>{
      if(!prevRow||prevRow[key]==null) return '';
      const d=curr-prevRow[key];
      if(Math.abs(d)<0.2) return '';
      const col=d>0?'#16a34a':'#dc2626';
      return `<span style="font-size:.62rem;color:${col};margin-left:2px;font-weight:700">${d>0?'▲':'▼'}</span>`;
    };

    tenures.forEach(t=>{
      const tResp=allR.filter(r=>r.tenure===t);
      const ts=THI.calcAreaScores(tResp,STATE.method);
      const tnps=THI.calcNPS(tResp).nps;
      const valMap={...Object.fromEntries(AREA_KEYS2.map(k=>[k,ts[k]]))};
      const pTenRow = prevTenureRows[t]||null;
      h2+=`<tr>
        <td style="font-size:.8rem;font-weight:600;padding-left:12px;border-bottom:1px solid #f1f5f9">${t}</td>
        <td style="text-align:center;font-size:.8rem;font-weight:600;background:transparent!important">${pct(ts.total)}${tenDelta(ts.total,pTenRow,'total')}</td>
        <td style="text-align:center;font-size:.8rem;font-weight:600;background:transparent!important">${dp(tnps)}</td>
        ${THI.AREAS.map(a=>`<td class="${tenRowClass(valMap,a.key)}" style="text-align:center;font-size:.78rem">${pct(ts[a.key])}${tenDelta(ts[a.key],pTenRow,a.key)}</td>`).join('')}
      </tr>`;
    });

    // All Tenure row — with highlight on area cols only
    h2+=`<tr class="row-all">
      <td style="font-size:.8rem;font-weight:800;padding-left:12px">All Tenure</td>
      <td style="text-align:center;font-size:.8rem;font-weight:700;background:#eef0f5!important">${pct(allScores.total)}${tenDelta(allScores.total,prevAllTenure,'total')}</td>
      <td style="text-align:center;font-size:.8rem;font-weight:700;background:#eef0f5!important">${dp(allNPS)}</td>
      ${THI.AREAS.map(a=>`<td class="${tenRowClass(allValMap,a.key)}" style="text-align:center;font-size:.78rem;font-weight:700">${pct(allScores[a.key])}${tenDelta(allScores[a.key],prevAllTenure,a.key)}</td>`).join('')}
    </tr></tbody>`;
    refreshHTML(tenEl, h2);
  }
}

// ── HEATMAP ─────────────────────────────────────────────────────────
function buildHM(id,rowData,cols){const t=document.getElementById(id);let h=`<thead><tr><th class="area-col">Area</th><th class="hm-all">All</th>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>`;rowData.rows.forEach(row=>{h+=`<tr><td class="hm-area">${row.area}</td>`;const ac=heatColor(row.cols['_all']);h+=`<td class="hm-all" style="background:${ac.bg};color:${ac.text}">${pct(row.cols['_all'])}</td>`;cols.forEach(c=>{const v=row.cols[c];if(v==null){h+=`<td style="background:#f8fafc;color:#94a3b8">—</td>`;return}const col=heatColor(v);h+=`<td style="background:${col.bg};color:${col.text}">${pct(v)}</td>`});h+='</tr>'});h+=`<tr class="total-row"><td class="hm-area">Total</td>`;const atc=heatColor(rowData.totalCols['_all']);h+=`<td class="hm-all" style="background:${atc.bg};color:${atc.text}">${pct(rowData.totalCols['_all'])}</td>`;cols.forEach(c=>{const v=rowData.totalCols[c];if(v==null){h+=`<td style="background:#f8fafc;color:#94a3b8">—</td>`;return}const col=heatColor(v);h+=`<td style="background:${col.bg};color:${col.text}">${pct(v)}</td>`});h+='</tr></tbody>';t.innerHTML=h}
function renderHeatmap(resp){const hD=THI.calcHeatmapDept(resp,'fav67');buildHM('hmDept',hD,hD.depts);const hT=THI.calcHeatmapTenure(resp,'fav67');buildHM('hmTenure',hT,hT.tenures)}

// ── NPS ──────────────────────────────────────────────────────────────
function renderNPS(resp){
  const nps=THI.calcNPS(resp);
  document.getElementById('npsCenter').textContent=Math.round(nps.nps);
  if(CH.nps)CH.nps.destroy();
  CH.nps=new Chart(document.getElementById('npsDonut').getContext('2d'),{type:'doughnut',data:{labels:['Promoters','Passives','Detractors'],datasets:[{data:[nps.promoters,nps.passives,nps.detractors],backgroundColor:[G.navy,G.gold,G.red],borderWidth:2,borderColor:'#fff',hoverOffset:4}]},options:{cutout:'70%',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},datalabels:{display:false}}}});
  document.getElementById('npsLegend').innerHTML=[['Promoters',nps.promoters,G.navy],['Passives',nps.passives,G.gold],['Detractors',nps.detractors,G.red]].map(([l,v,c])=>`<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c};margin-right:4px"></span>${l} ${pct(v)}</span>`).join('');
  const depts=[...new Set(resp.map(r=>r.dept))].sort();
  document.getElementById('npsDeptBody').innerHTML=depts.map(d=>{const n=THI.calcNPS(resp.filter(r=>r.dept===d));return`<tr><td>${d}</td><td><strong style="color:${n.nps>=0?G.green:G.red}">${dp(n.nps)}</strong></td></tr>`}).join('');
  const q=THI.quarters[THI.activeQuarter];const note=document.getElementById('partNote');const grid=document.getElementById('partGrid');
  if(q?.population){
    note.textContent=`Based on ${q.population.total.toLocaleString()} Timmys in the Participant list for ${q.label}.`;
    const allR=q.respondents||[];
    const dRow=Object.keys(q.population.byDept).sort().map(d=>{const pop=q.population.byDept[d],res=allR.filter(r=>r.dept===d).length,rate=pop?(res/pop*100):0;return`<tr><td>${d}</td><td>${res}</td><td>${pop}</td><td><strong>${dp(rate)}%</strong></td></tr>`}).join('');
    const TORD=['< 6 months','6 months – 1 yr','1 – 2 years','2 – 3 years','3 – 4 years','4 – 5 years','> 5 years'];
    const tRow=TORD.filter(t=>q.population.byTenure[t]).map(t=>{const pop=q.population.byTenure[t],res=allR.filter(r=>r.tenure===t).length,rate=pop?(res/pop*100):0;return`<tr><td>${t}</td><td>${res}</td><td>${pop}</td><td><strong>${dp(rate)}%</strong></td></tr>`}).join('');
    grid.innerHTML=`<div style="overflow-x:auto"><div style="font-size:.8rem;font-weight:700;margin-bottom:8px">By Department</div><table class="data-table"><thead><tr><th>Department</th><th>Responded</th><th>Population</th><th>Rate</th></tr></thead><tbody>${dRow}</tbody></table></div><div style="overflow-x:auto"><div style="font-size:.8rem;font-weight:700;margin-bottom:8px">By Tenure</div><table class="data-table"><thead><tr><th>Tenure</th><th>Responded</th><th>Population</th><th>Rate</th></tr></thead><tbody>${tRow}</tbody></table></div>`;
  }else{note.textContent='Participant list not loaded.';grid.innerHTML=`<div style="padding:20px;color:#94a3b8;font-size:.85rem">${resp.length} respondents in current selection.</div>`}
}

// ── FEEDBACK ──────────────────────────────────────────────────────────
function getFB(resp){const items=[];resp.forEach(r=>{const q45=(r.q45||'').trim(),q46=(r.q46||'').trim();if(q45&&q45!=='-'&&q45.length>3)items.push({type:'positive',text:q45,dept:r.dept,tenure:r.tenure});if(q46&&q46!=='-'&&q46.length>3)items.push({type:'improve',text:q46,dept:r.dept,tenure:r.tenure})});return items}
function renderFeedback(resp){
  const wrapEl = document.getElementById('fbBarChart');
  if(!wrapEl) return;

  // Get checklist labels from CHECKLIST_COLS (set by data-loader)
  const cols = typeof CHECKLIST_COLS !== 'undefined' ? CHECKLIST_COLS : [];

  // Previous quarter (unfiltered) — used only to compute the rate delta, never for the bar length itself
  const pq = THI.activeQuarter>0 ? THI.quarters[THI.activeQuarter-1] : null;
  const prevRespRaw = (pq?.loaded && pq.respondents?.length) ? pq.respondents : null;
  const prevResp = prevRespRaw && THI.scopedDept ? prevRespRaw.filter(r=>r.deptGroup===THI.scopedDept) : prevRespRaw;
  const prevTotal = prevResp ? (prevResp.length||1) : null;

  // If no checklist cols detected, fallback to old keyword-based counting (no delta available)
  if(!cols.length){
    const all=getFB(resp);
    const KW={'Vision & Values':['vision','values','visi'],'Leadership':['leader','management'],'Teamwork':['team','kolaborasi'],'Communication':['komunikasi','communication'],'Culture':['culture','budaya'],'Personal Development':['development','learning'],'Accountability & Performance':['OKR','accountability'],'Recognition':['apresiasi','recognition'],'Workplace Support':['fasilitas','laptop','wifi'],'Integrity':['integrity','integritas'],'Timmy Experience':['happy','bangga','proud']};
    const rows = THI.AREAS.map(a=>{
      const kws=KW[a.label]||[];
      const well=all.filter(i=>i.type==='positive'&&kws.some(k=>i.text.toLowerCase().includes(k.toLowerCase()))).length;
      const imp =all.filter(i=>i.type==='improve'&&kws.some(k=>i.text.toLowerCase().includes(k.toLowerCase()))).length;
      return {label:a.label, well, imp, wellDelta:null, impDelta:null};
    });
    renderDivergingBars(wrapEl, rows);
    return;
  }

  // Count V and X per area from checklist (raw counts — these drive the bar length/value)
  const total = resp.length || 1;
  const rows = cols.map(c=>{
    const vCount = resp.filter(r=>r.checklist&&r.checklist[c.label]==='V').length;
    const xCount = resp.filter(r=>r.checklist&&r.checklist[c.label]==='X').length;
    let wellDelta=null, impDelta=null;
    if(prevResp){
      const pv = prevResp.filter(r=>r.checklist&&r.checklist[c.label]==='V').length;
      const px = prevResp.filter(r=>r.checklist&&r.checklist[c.label]==='X').length;
      // Delta compares RATE (%) vs previous quarter, not raw count — respondent totals differ per quarter,
      // so a straight count-vs-count comparison would be misleading.
      wellDelta = (vCount/total*100) - (pv/prevTotal*100);
      impDelta  = (xCount/total*100) - (px/prevTotal*100);
    }
    return {label:c.label, well:vCount, imp:xCount, wellDelta, impDelta};
  });

  // Order rows to match THI.AREAS (same sequence used by the heatmap), not by score.
  // Normalize "&" to "and" too, since sheet headers may spell it out ("Vision and Values")
  // while THI.AREAS uses the symbol ("Vision & Values") — without this they'd never match.
  const norm = s=>(s||'').toLowerCase().replace(/&/g,'and').replace(/[^a-z]/g,'');
  const areaOrder = THI.AREAS.map(a=>norm(a.label));
  rows.sort((a,b)=>{
    let ia=areaOrder.indexOf(norm(a.label)); if(ia===-1) ia=999;
    let ib=areaOrder.indexOf(norm(b.label)); if(ib===-1) ib=999;
    return ia-ib;
  });

  renderDivergingBars(wrapEl, rows);
}

// Diverging bar chart: Need Improvement (left) — Area name (center) — Did Well (right)
// Bar length/value = raw respondent count for the active quarter+filters.
// Small badge next to each value = change in rate (percentage points) vs the previous quarter.
function renderDivergingBars(container, rows){
  if(!rows.length){ container.innerHTML=''; return; }
  const maxVal = Math.max(1, ...rows.flatMap(r=>[r.well,r.imp]));
  const deltaBadge = d=>{
    if(d===null||d===undefined) return '';
    if(Math.abs(d)<0.05) return `<span style="font-size:.62rem;color:#94a3b8;font-weight:700">= 0pt</span>`;
    const up=d>0;
    const col=up?'#16a34a':'#dc2626';
    return `<span style="font-size:.62rem;font-weight:700;color:${col};white-space:nowrap">${up?'▲':'▼'} ${Math.abs(d).toFixed(STATE.decimals?2:0)}pt</span>`;
  };
  const rowsHtml = rows.map((r,idx)=>{
    const wellW = Math.max(2,Math.round(r.well/maxVal*100));
    const impW  = Math.max(2,Math.round(r.imp/maxVal*100));
    return `<div style="display:grid;grid-template-columns:1fr 170px 1fr;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f8fafc">
      <div style="display:flex;justify-content:flex-end;align-items:center;gap:7px">
        ${deltaBadge(r.impDelta)}
        <div style="font-size:.75rem;font-weight:700;color:#dc2626;min-width:22px;text-align:right">${r.imp}</div>
        <div class="divbar-fill divbar-imp" id="dbImp${idx}" data-w="${impW}" style="height:15px;width:0%"></div>
      </div>
      <div style="font-size:.78rem;font-weight:600;color:var(--text2);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${r.label}">${r.label}</div>
      <div style="display:flex;align-items:center;gap:7px">
        <div class="divbar-fill divbar-well" id="dbWell${idx}" data-w="${wellW}" style="height:15px;width:0%"></div>
        <div style="font-size:.75rem;font-weight:700;color:#16a34a;min-width:22px">${r.well}</div>
        ${deltaBadge(r.wellDelta)}
      </div>
    </div>`;
  }).join('');

  container.innerHTML = `
    ${rowsHtml}
    <div style="display:flex;justify-content:center;gap:18px;margin-top:14px;font-size:.7rem;color:var(--text3)">
      <span style="display:flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:2px;background:#ef4444"></span>Need Improvement</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:2px;background:#16a34a"></span>Did Well</span>
      <span>▲▼ = vs previous quarter, in percentage points</span>
    </div>
  `;
  rows.forEach((r,idx)=>{
    requestAnimationFrame(()=>{
      const impEl=document.getElementById(`dbImp${idx}`), wellEl=document.getElementById(`dbWell${idx}`);
      if(impEl) impEl.style.width=`${impEl.dataset.w}%`;
      if(wellEl) wellEl.style.width=`${wellEl.dataset.w}%`;
    });
  });
}
function renderFBList(resp){
  let items=getFB(resp);
  if(STATE.fbType!=='all')items=items.filter(i=>i.type===STATE.fbType);
  if(STATE.fbDept!=='all')items=items.filter(i=>i.dept===STATE.fbDept);
  if(STATE.fbTenure!=='all')items=items.filter(i=>i.tenure===STATE.fbTenure);
  if(STATE.fbSearch){const q=STATE.fbSearch.toLowerCase();items=items.filter(i=>i.text.toLowerCase().includes(q)||i.dept.toLowerCase().includes(q))}
  const total=items.length,pages=Math.ceil(total/STATE.PER_PAGE)||1,page=Math.min(STATE.fbPage,pages);
  const paged=items.slice((page-1)*STATE.PER_PAGE,page*STATE.PER_PAGE);
  document.getElementById('fbCount').textContent=`Showing ${paged.length} of ${total} responses`;
  document.getElementById('fbList').innerHTML=paged.length?paged.map(i=>`<div class="fb-card ${i.type}"><div class="fb-meta"><span class="fb-tag ${i.type}">${i.type==='positive'?'✓ Did Well':'↑ To Improve'}</span><span class="fb-dept">${i.dept}</span><span class="fb-tenure">${i.tenure}</span></div><div class="fb-text">${i.text.replace(/\n/g,'<br>')}</div></div>`).join(''):'<p style="color:#94a3b8;padding:20px;text-align:center">No feedback matches.</p>';
  const pg=document.getElementById('fbPag');
  if(pages<=1){pg.innerHTML='';return}
  let html='';
  if(page>1)html+=`<button class="pg-btn" data-p="${page-1}">‹</button>`;
  for(let p=Math.max(1,page-2);p<=Math.min(pages,page+2);p++)html+=`<button class="pg-btn ${p===page?'active':''}" data-p="${p}">${p}</button>`;
  if(page<pages)html+=`<button class="pg-btn" data-p="${page+1}">›</button>`;
  pg.innerHTML=html;
  pg.querySelectorAll('.pg-btn').forEach(b=>b.addEventListener('click',()=>{STATE.fbPage=+b.dataset.p;renderFBList(getFiltered())}));
}

// ── MATRIX ────────────────────────────────────────────────────────────
function renderMatrix(resp){
  const sc=THI.calcAreaScores(resp,STATE.method);const imp={vv:75,ld:68,tw:70,cm:69,cu:78,pd:73,ap:65,rc:76,ws:77,tx:80,in:62};const avg=sc.total||74,avgI=69;
  const pts=THI.AREAS.map(a=>({x:+sc[a.key].toFixed(2),y:imp[a.key]||65,label:a.label}));
  const cols=pts.map(p=>p.x<avg&&p.y>=avgI?G.red:p.x>=avg&&p.y>=avgI?G.navy:p.x<avg&&p.y<avgI?G.gold:'#cbd5e1');
  if(CH.matrix)CH.matrix.destroy();
  CH.matrix=new Chart(document.getElementById('matrixChart').getContext('2d'),{type:'scatter',data:{datasets:[{data:pts,backgroundColor:cols,pointRadius:11,pointHoverRadius:14}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},datalabels:{anchor:'end',align:'top',offset:4,formatter:(_,c)=>pts[c.dataIndex].label,font:{size:10,weight:'700'},color:G.text},tooltip:{callbacks:{label:c=>` ${pts[c.dataIndex].label}: ${pts[c.dataIndex].x}%`}}},scales:{x:{min:50,max:105,title:{display:true,text:'Score (%)'},ticks:{callback:v=>`${v}%`},grid:{color:'#f1f5f9'}},y:{min:55,max:90,title:{display:true,text:'Impact'},grid:{color:'#f1f5f9'}}}}});
}

// ── KEY ISSUES ────────────────────────────────────────────────────────
function renderKeyIssues(resp){
  const s67=THI.calcItemScores(resp,'fav67');
  const gaps=[{left:'Ownership',lv:s67[28],ll:'I take full responsibility for my work',right:'Recognition',rv:s67[30],rl:'IDN appreciates my work',f:'High accountability contrasts with low recognition — contributions feel unnoticed.'},{left:'Growth Mindset',lv:s67[21],ll:'I have a growth mindset',right:'Dev. Support',rv:s67[23],rl:'IDN provides development opportunities',f:'Willingness to grow is not matched by perceived support.'},{left:'Work Ownership',lv:s67[28],ll:'I take full responsibility',right:'Workplace Support',rv:s67[34],rl:'Facilities support my work',f:'High commitment is undermined by inadequate tools.'}];
  document.getElementById('gapGrid').innerHTML=gaps.map(g=>`<div class="gap-card"><div class="gap-title">${g.left} vs ${g.right}</div><div class="gap-compare"><div class="gap-side left"><div class="gv">${pct(g.lv)}</div><div class="gl">${g.ll}</div></div><div class="gap-vs">VS</div><div class="gap-side right"><div class="gv">${pct(g.rv)}</div><div class="gl">${g.rl}</div></div></div><div class="gap-finding">${g.f}</div></div>`).join('');
  document.getElementById('issuesList').innerHTML=[{tag:'#WorkplaceSupport',desc:'Outdated tools create daily friction for longer-tenured employees.',action:'Prioritize device audit · Establish device lifecycle policy'},{tag:'#Absentism&Integrity',desc:'Manual attendance tracking perceived as inconsistent.',action:'Transition to digital tap-in · Align team leads'},{tag:'#EmployeeBenefit',desc:'Growing concern about benefit adequacy.',action:'Benchmark vs market · Close critical coverage gaps'}].map(i=>`<div class="issue-card"><div class="issue-tag">${i.tag}</div><div class="issue-desc">${i.desc}</div><div class="issue-action"><strong>Action:</strong> ${i.action}</div></div>`).join('');
}

// ── TREND CHART (independent of Quarter filter) ──────────────────────
function renderTrend(){
  THI.quarters.forEach(q=>{if(q.sheetId&&!q.loaded) loadQuarterData(q)});
  const tLabels=THI.quarters.map(q=>q.label);
  const tData=THI.quarters.map(q=>{
    if(!q.loaded||!q.respondents?.length) return null;
    const qResp=q.respondents.filter(r=>
      (STATE.dept==='all'||r.dept===STATE.dept)&&
      (STATE.tenure==='all'||r.tenure===STATE.tenure)
    );
    return qResp.length>0 ? +THI.calcAreaScores(qResp,STATE.method).total.toFixed(2) : null;
  });
  // Color: green for data, light gray for no-data quarters
  const barColors=tData.map((v,i)=>v===null?'#e2e8f0':i===THI.activeQuarter?G.gold:G.navy);
  const trendData={labels:tLabels,datasets:[{
    label:'THI Score',
    data:tData.map(v=>v!==null?v:0),
    backgroundColor:ctx=>barBevelGradient(ctx.chart, ctx.dataIndex, barColors),
    borderRadius:8,
    borderSkipped:false,
  }]};
  const trendOptions={
    responsive:true,maintainAspectRatio:false,
    plugins:{
      legend:{display:false},
      datalabels:{
        display:ctx=>tData[ctx.dataIndex]!==null,
        anchor:'end',align:'top',
        font:{size:12,weight:'700'},
        formatter:(v,ctx)=>tData[ctx.dataIndex]!==null?`${dp(v)}%`:'',
        color:G.text
      },
      tooltip:{callbacks:{
        label:c=>tData[c.dataIndex]!==null?` THI: ${c.parsed.y}%`:' No data yet'
      }}
    },
    scales:{
      y:{min:0,max:100,ticks:{callback:v=>`${v}%`},grid:{color:'#f1f5f9'}},
      x:{grid:{display:false},ticks:{
        color:ctx=>tData[ctx.index]!==null?G.text:G.text3,
        font:{weight:ctx=>tData[ctx.index]!==null?'700':'400'}
      }}
    }
  };
  if(CH.trend && CH.trend.data.labels.length===trendData.labels.length){
    CH.trend.data=trendData;
    CH.trend.options=trendOptions;
    CH.trend.update();
  }else{
    if(CH.trend) CH.trend.destroy();
    CH.trend=new Chart(document.getElementById('trendChart').getContext('2d'),{type:'bar',data:trendData,options:trendOptions});
  }
}

// ── PARTICIPATION TAB ─────────────────────────────────────────────
// A quarter's population total can need certain departments excluded from the
// Participation Rate denominator for that quarter only (e.g. Boss Creator was
// eligible but shouldn't count toward Quarter 3's headcount). This list comes
// from the Config sheet's "exclude_depts" column (comma-separated dept names
// per quarter) — see THI.config in data-loader.js — so adding a new quarter's
// exclusions is just a sheet edit, no code change or redeploy needed.
// This only ever affects Participation Rate: THI Score/NPS/Heatmap are
// computed purely from actual respondent answers, never from headcount, so an
// excluded dept's zero responses were already having zero effect on those.
// The per-department breakdown table is unaffected too — an excluded dept's
// own row still shows its real % there, which is correct and separate from this.
// EVERY place in this file that turns a quarter's population into a rate must
// go through this one function — several used to read qObj.population.total
// directly (Overview KPI card, jumbotron, both Daily Progress chart loops),
// silently bypassing any exclusion and causing exactly the "number didn't
// change" symptom this was built to fix.
function getEffectivePopulationTotal(qObj){
  const rawTotal = qObj?.population?.total || qObj?.respondents?.length || 0;
  const excludeDepts = THI.config?.[qObj?.label]?.excludeDepts;
  if(!excludeDepts?.length || !qObj?.population?.byDept) return rawTotal;
  const excluded = excludeDepts.reduce((sum,d)=>sum+(qObj.population.byDept[d]||0), 0);
  return Math.max(0, rawTotal-excluded);
}
// Same exclusion, but scoped to a single Tenure or Level bucket rather than the
// grand total — needed because "Participation by Tenure/Level" computes its own
// population count per bucket, entirely separate from getEffectivePopulationTotal
// above, so an excluded dept's headcount was still silently counted there even
// after the overall Participation Rate correctly excluded it. Walks the roster
// (not just the aggregate byDept count) since it needs to match on tenure/level
// too, not just department.
function getExcludedHeadcountInBucket(qObj, matchBucket){
  const excludeDepts = THI.config?.[qObj?.label]?.excludeDepts;
  if(!excludeDepts?.length || !qObj?.population?.roster) return 0;
  return qObj.population.roster.filter(entry=>
    excludeDepts.some(d=> d==='Marketing' ? entry.deptGroup==='Marketing' : entry.dept===d) && matchBucket(entry)
  ).length;
}

function renderParticipation(){
  const q   = THI.quarters[THI.activeQuarter];
  const pop = q?.population;
  const allR= q?.respondents||[];
  const responded  = allR.length;
  const population = getEffectivePopulationTotal(q);
  const notResp    = Math.max(0, population - responded);
  const rate       = population ? (responded/population*100) : 0;

  // Prev quarter data
  const pq  = THI.activeQuarter>0 ? THI.quarters[THI.activeQuarter-1] : null;
  const pPop= pq ? getEffectivePopulationTotal(pq) : null;
  const pRes= pq?.respondents?.length || null;
  const pRate= (pPop&&pRes) ? pRes/pPop*100 : null;
  const pNotResp = (pPop&&pRes) ? Math.max(0,pPop-pRes) : null;

  // Sentiment label
  const rateSentiment = rate>=95?'Excellent Participation':rate>=85?'Good Participation':rate>=70?'Fair Participation':'Needs Improvement';
  const deltaRate = pRate!==null ? rate-pRate : null;

  // Hero
  animateNumber(document.getElementById('partHeroScore'), rate, {decimals:STATE.decimals?2:0, suffix:'%'});
  document.getElementById('partHeroSentiment').textContent = rateSentiment;
  const dEl = document.getElementById('partHeroDelta');
  if(deltaRate!==null){
    dEl.textContent = `${deltaRate>=0?'▲':'▼'} ${deltaRate>=0?'+':''}${dp(deltaRate)}% vs ${pq?.label||'prev quarter'}`;
    dEl.className = `part-hero-delta ${deltaRate>=0?'':'dn'}`;
  } else {
    dEl.textContent = 'No previous quarter loaded';
    dEl.className = 'part-hero-delta na';
  }
  document.getElementById('partHeroSub').textContent = `${responded.toLocaleString()} of ${population.toLocaleString()} Timmys responded`;

  // ── EVERY VOICE COUNTS card — symbolic up-down trend sparkline ────
  const evcSpark = document.getElementById('evcSparkline');
  if(evcSpark){
    const W=90,H=44;
    const pts = `3,32 18,14 30,26 46,8 62,20 87,5`;
    evcSpark.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none">
      <polyline points="${pts}" fill="none" stroke="#10b981" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="87" cy="5" r="3" fill="#10b981"/>
    </svg>`;
  }

  // ── DAILY TREND CHART — all quarters, active highlighted ─────────
  const dailyEl   = document.getElementById('partDailyChart');
  const yLabelsEl = document.getElementById('partDailyYLabels');
  const xLabelsEl = document.getElementById('partDailyXLabels');

  if(!dailyEl) return;

  // Y labels
  yLabelsEl.innerHTML = ['100%','75%','50%','25%','0%'].map(l=>
    `<span style="font-size:.62rem;color:var(--text3)">${l}</span>`).join('');

  // Max days across all quarters with data
  const MAX_DAYS = 5;
  const DAILY_H  = 180;

  // Build per-quarter cumulative data
  const qLines = THI.quarters.map((qObj,qi)=>{
    const conf = SURVEY_DURATION[qObj.label];
    if(!conf?.start || !qObj.loaded || !qObj.respondents?.length) return null;

    const startDate = new Date(conf.start);
    const endDate   = new Date(conf.end);
    const totalDays = Math.min(Math.round((endDate-startDate)/(1000*60*60*24))+1, MAX_DAYS);
    const pop2      = getEffectivePopulationTotal(qObj);

    // Count per day from timestamp
    const dayCounts = Array(totalDays).fill(0);
    let unparsed = 0;
    qObj.respondents.forEach(r=>{
      if(!r.timestamp) return;
      const ts = new Date(r.timestamp);
      if(isNaN(ts.getTime())){ unparsed++; return; }
      const dayIdx = Math.floor((ts-startDate)/(1000*60*60*24));
      if(dayIdx>=0 && dayIdx<totalDays) dayCounts[dayIdx]++;
    });

    // If most timestamps unparsed, distribute evenly as fallback
    const totalCounted = dayCounts.reduce((a,b)=>a+b,0);
    if(totalCounted < qObj.respondents.length * 0.3){
      // Fallback: spread respondents evenly across days
      const perDay = Math.floor(qObj.respondents.length/totalDays);
      for(let i=0;i<totalDays;i++) dayCounts[i]=perDay;
      dayCounts[totalDays-1] += qObj.respondents.length - perDay*totalDays;
    }

    // Cumulative %
    let running=0;
    const cumulPct = dayCounts.map(c=>{ running+=c; return +(running/pop2*100).toFixed(1); });

    return { label:qObj.label, cumulPct, totalDays, isActive: qi===THI.activeQuarter };
  }).filter(Boolean);

  if(!qLines.length){
    dailyEl.innerHTML=`<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:.8rem">No data available — configure SURVEY_DURATION in data-loader.js</div>`;
    xLabelsEl.innerHTML=''; return;
  }

  // X positions: Day 1 to MAX_DAYS, evenly spaced
  const xStep = 90/(MAX_DAYS-1);
  const xPos  = i => 5 + i*xStep; // 5%–95%
  const yPos  = pct => 5 + pct/100*90; // 5%–95% bottom

  let html='';

  // Grid lines
  [25,50,75,100].forEach(p=>{
    html+=`<div style="position:absolute;left:0;right:0;height:1px;background:#f1f5f9;bottom:${p}%"></div>`;
  });

  // Draw each quarter line
  qLines.forEach(({label,cumulPct,totalDays,isActive})=>{
    const col   = isActive?'#FCA311':'#cbd5e1';
    const opac  = isActive?1:0.6;
    const sw    = isActive?2.5:1.5;

    // SVG line + area
    const pts = cumulPct.map((_,i)=>`${xPos(i)},${100-yPos(cumulPct[i])}`).join(' ');
    const areaPath = `M ${xPos(0)},${100-yPos(cumulPct[0])} L ${pts.split(' ').slice(1).join(' L ')} L ${xPos(totalDays-1)} 100 L ${xPos(0)} 100 Z`;

    if(isActive){
      html+=`<svg style="position:absolute;inset:0;width:100%;height:100%;overflow:visible" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs><linearGradient id="dlg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${col}" stop-opacity=".2"/>
          <stop offset="100%" stop-color="${col}" stop-opacity=".02"/>
        </linearGradient></defs>
        <path d="${areaPath}" fill="url(#dlg)"/>
        <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" opacity="${opac}"/>
      </svg>`;
    } else {
      html+=`<svg style="position:absolute;inset:0;width:100%;height:100%;overflow:visible" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" opacity="${opac}" stroke-dasharray="${isActive?'none':'4,3'}"/>
      </svg>`;
    }

    // Points + labels (active quarter only)
    cumulPct.forEach((pct,i)=>{
      const x = xPos(i);
      const y = yPos(pct);
      const isLast = i===totalDays-1;
      if(isActive){
        const dotCol = isLast?'var(--navy)':'#FCA311';
        const sz = isLast?13:10;
        html+=`<div style="position:absolute;width:${sz}px;height:${sz}px;border-radius:50%;background:${dotCol};border:2px solid #fff;box-shadow:0 0 0 2px ${dotCol};transform:translate(-50%,50%);left:${x}%;bottom:${y}%;z-index:2"></div>`;
        html+=`<div style="position:absolute;font-size:.72rem;font-weight:800;color:${dotCol};transform:translateX(-50%);left:${x}%;bottom:calc(${y}% + 13px);white-space:nowrap;z-index:2">${pct}%</div>`;
        // Delta
        if(i>0){
          const delta = +(pct-cumulPct[i-1]).toFixed(1);
          const midX  = (xPos(i-1)+xPos(i))/2;
          const midY  = (yPos(cumulPct[i-1])+yPos(pct))/2;
          html+=`<div style="position:absolute;font-size:.62rem;font-weight:700;background:#f0fdf4;color:#16a34a;padding:1px 6px;border-radius:20px;border:1px solid #bbf7d0;transform:translate(-50%,-50%);left:${midX}%;bottom:${midY}%;white-space:nowrap;z-index:3">+${delta}%</div>`;
        }
      } else {
        // Just small dot for inactive quarters
        html+=`<div style="position:absolute;width:6px;height:6px;border-radius:50%;background:${col};transform:translate(-50%,50%);left:${x}%;bottom:${y}%;opacity:.5"></div>`;
      }
    });

    // Quarter label at end of line (inactive)
    if(!isActive){
      const lastPct = cumulPct[totalDays-1];
      html+=`<div style="position:absolute;font-size:.6rem;font-weight:600;color:#94a3b8;left:calc(${xPos(totalDays-1)}% + 6px);bottom:${yPos(lastPct)}%;transform:translateY(50%);white-space:nowrap">${label.replace('Quarter ','Q')}</div>`;
    }
  });

  dailyEl.innerHTML = html;

  // X labels — Day 1..MAX_DAYS with active quarter dates
  const activeConf = SURVEY_DURATION[THI.quarters[THI.activeQuarter]?.label];
  const activeStart = activeConf?.start ? new Date(activeConf.start) : null;
  xLabelsEl.innerHTML = Array.from({length:MAX_DAYS},(_,i)=>{
    const x = xPos(i);
    let dateLbl = '';
    if(activeStart){
      const d = new Date(activeStart); d.setDate(d.getDate()+i);
      dateLbl = d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
    }
    const isLastActive = activeConf && i===Math.min(Math.round((new Date(activeConf.end)-new Date(activeConf.start))/(1000*60*60*24)),MAX_DAYS-1);
    return `<div style="position:absolute;left:${x}%;transform:translateX(-50%);text-align:center">
      <div style="font-size:.7rem;font-weight:${isLastActive?'800':'600'};color:${isLastActive?'var(--navy)':'var(--text2)'}">Day ${i+1}${isLastActive?' ✓':''}</div>
      ${dateLbl?`<div style="font-size:.6rem;color:var(--text3)">${dateLbl}</div>`:''}
    </div>`;
  }).join('');


  const maxPop = Math.max(...THI.quarters.map(q=>getEffectivePopulationTotal(q)), 1);
  const CHART_H = 110; // px max bar height

  const getDurDays = (label) => {
    const d = SURVEY_DURATION[label];
    if(!d?.start||!d?.end) return null;
    const s=new Date(d.start), e=new Date(d.end);
    return Math.round((e-s)/(1000*60*60*24))+1;
  };

  const vbarsHTML = THI.quarters.map((q,i)=>{
    const isActive = i===THI.activeQuarter;
    if(!q.loaded||!q.respondents?.length){
      return `<div class="pvb-col">
        <div class="pvb-val nodata">—</div>
        <div class="pvb-nodata"></div>
        <div class="pvb-lbl nodata">${q.label}</div>
        <div class="pvb-info nodata">No data yet</div>
      </div>`;
    }
    const pop2 = getEffectivePopulationTotal(q);
    const res2 = q.respondents.length;
    const notR = Math.max(0, pop2-res2);
    const rt   = +(res2/pop2*100).toFixed(1);
    const resH = Math.max(6, Math.round(res2/maxPop*CHART_H));
    const notRH= Math.max(3, Math.round(notR/maxPop*CHART_H));
    const dur  = getDurDays(q.label);
    const durTxt = dur ? `${res2} resp · ${dur} days` : `${res2} resp`;
    return `<div class="pvb-col">
      <div class="pvb-val ${isActive?'active':''}">${dp(rt)}%</div>
      <div class="pvb-stack" style="height:${resH+notRH}px">
        <div class="pvb-responded ${isActive?'active':''}" style="height:${resH}px"></div>
        <div class="pvb-passive" style="height:${notRH}px"></div>
      </div>
      <div class="pvb-lbl ${isActive?'active':''}">${q.label}</div>
      <div class="pvb-info ${isActive?'active':''}">${durTxt}</div>
    </div>`;
  }).join('');

  if(CH.partTrend){CH.partTrend.destroy();CH.partTrend=null;}
  const vbarsEl = document.getElementById('partVBars');
  if(vbarsEl) vbarsEl.innerHTML = vbarsHTML;
  const xlabelsEl = document.getElementById('partXLabels');
  if(xlabelsEl) xlabelsEl.innerHTML = '';
  const durEl = document.getElementById('surveyDurationTable');
  if(durEl) durEl.innerHTML = '';
  const metricsEl = document.getElementById('partMetrics');
  if(metricsEl) metricsEl.innerHTML = '';



  // Helper: build participation table — all quarters as columns, delta from Q2+
  const buildPartTable = (tableId, getRowData, catType) => {
    const el = document.getElementById(tableId);
    if(!el) return;
    const loadedQs = THI.quarters.filter(q=>q.loaded&&q.respondents?.length);
    if(!loadedQs.length){el.innerHTML='<thead><tr><th>No data loaded</th></tr></thead>';return;}

    // Header — full label "Quarter 1", "Quarter 2", etc.
    const qHeaders = THI.quarters.map(q=>`<th style="text-align:center">${q.label}</th>`).join('');
    el.innerHTML = `<thead><tr><th>Category</th>${qHeaders}</tr></thead><tbody></tbody>`;
    const tbody = el.querySelector('tbody');

    const categories = getRowData(THI.quarters[THI.activeQuarter], allR);
    categories.forEach(cat=>{
      const cells = THI.quarters.map((q,qi)=>{
        if(!q.loaded||!q.respondents?.length) return `<td style="text-align:center;color:#cbd5e1">—</td>`;
        const row = getRowData(q, q.respondents).find(r=>r.label===cat.label);
        const val = row?.curr ?? null;
        if(val===null) return `<td style="text-align:center;color:#cbd5e1">—</td>`;

        // Delta from Q2 onwards
        let deltaHtml = '';
        if(qi>0){
          const prevQ = THI.quarters[qi-1];
          if(prevQ?.loaded&&prevQ?.respondents?.length){
            const {curr: prevVal} = getRowData(prevQ, prevQ.respondents).find(r=>r.label===cat.label)||{curr:null};
            if(prevVal!==null){
              const d = val-prevVal;
              const arrow = d>0.4?'▲':d<-0.4?'▼':'=';
              const col = d>0.4?'#16a34a':d<-0.4?'#dc2626':'#94a3b8';
              deltaHtml = `<span style="color:${col};font-size:.62rem;font-weight:700;margin-left:2px">${arrow}</span>`;
            }
          }
        }
        // Highlight: 100% = blue, <80% = red, else normal
        const bg = val>=99.5?'background:#e8f0fe;color:#1d4ed8;font-weight:700':val<80?'background:#fee2e2;color:#dc2626;font-weight:700':'';
        const res = row.res ?? 0, pop = row.pop ?? 0, notResp = Math.max(0, pop-res);
        return `<td class="part-cell-clickable" style="text-align:center;font-size:.82rem;font-weight:600;cursor:pointer;${bg}" data-cat="${cat.label}" data-cat-type="${catType}" data-quarter="${q.label}" data-res="${res}" data-notresp="${notResp}" data-pop="${pop}">${dp(val)}%${deltaHtml}</td>`;
      }).join('');
      const tr = document.createElement('tr');
      tr.innerHTML = `<td style="font-size:.8rem;font-weight:500">${cat.label}</td>${cells}`;
      tbody.appendChild(tr);
    });
  };

  // Data getters per table type
  const getDeptData = (q, resp) => {
    // Row list comes from the population roster (byDept), not from who actually
    // responded — a dept that's eligible but got zero respondents this quarter
    // (e.g. Boss Creator in Quarter 3) must still get a row showing 0%, not
    // disappear from the table entirely. Union across every loaded quarter's
    // roster so a dept only present in another quarter's population still shows
    // up (as "—") everywhere, keeping the row set identical across columns.
    const popKeys = new Set();
    THI.quarters.forEach(qq=>{ if(qq?.population?.byDept) Object.keys(qq.population.byDept).forEach(d=>popKeys.add(d)); });
    // Safety net: also include any dept name seen only in respondent data, in
    // case a quarter's roster sheet is missing/incomplete for that dept.
    THI.quarters.forEach(qq=>{ (qq?.respondents||[]).forEach(r=>{ if(r.dept) popKeys.add(r.dept); }); });
    // These never get their own row: "Audience Development"/"Communications" are
    // legacy pre-merge names whose data already rolls up into "Marketing" via
    // deptGroup below, and "Special Projects" is a stray duplicate of "Special
    // Project" that shouldn't exist as a separate department at all.
    const HIDDEN_DEPT_ROWS = new Set(['Audience Development','Communications','Special Projects']);
    HIDDEN_DEPT_ROWS.forEach(d=>popKeys.delete(d));
    const rawKeys = [...popKeys];
    // Always surface a "Marketing" row, even in quarters where the raw dept name was
    // still "Audience Development"/"Communications" — computed as the combined group total.
    const hasMarketingGroup = THI.quarters.some(qq=>(qq?.respondents||[]).some(r=>r.deptGroup==='Marketing')) || popKeys.has('Marketing');
    const keys = [...new Set([...rawKeys, ...(hasMarketingGroup?['Marketing']:[])])].sort();
    return keys.map(d=>{
      const isMarketing = d==='Marketing';
      const dPop = isMarketing
        ? (q?.population?.byDeptGroup?.Marketing || resp.filter(r=>r.deptGroup==='Marketing').length)
        : (q?.population?.byDept?.[d] || resp.filter(r=>r.dept===d).length);
      const dRes = isMarketing ? resp.filter(r=>r.deptGroup==='Marketing').length : resp.filter(r=>r.dept===d).length;
      return {label:d, curr:dPop>0?(dRes/dPop*100):null, pop:dPop, res:dRes};
    });
  };
  const TORD=['< 6 months','6 months – 1 yr','1 – 2 years','2 – 3 years','3 – 4 years','4 – 5 years','> 5 years'];
  const getTenureData = (q, resp) => {
    return TORD.filter(t=>resp.some(r=>r.tenure===t)).map(t=>{
      const rawPop = q?.population?.byTenure?.[t] || resp.filter(r=>r.tenure===t).length;
      const tPop = Math.max(0, rawPop - getExcludedHeadcountInBucket(q, e=>e.tenure===t));
      const tRes = resp.filter(r=>r.tenure===t).length;
      return {label:t, curr:tPop>0?(tRes/tPop*100):null, pop:tPop, res:tRes};
    });
  };
  const LEVEL_ORD = ['Associate','Sr. Associate','Manager','Sr. Manager','Functional','Team Lead'];
  const getLevelData = (q, resp) => {
    return LEVEL_ORD.filter(l=>resp.some(r=>r.level===l)).map(l=>{
      const rawPop = q?.population?.byLevel?.[l] || resp.filter(r=>r.level===l).length;
      const lPop = Math.max(0, rawPop - getExcludedHeadcountInBucket(q, e=>e.level===l));
      const lRes = resp.filter(r=>r.level===l).length;
      return {label:l, curr:lPop>0?(lRes/lPop*100):null, pop:lPop, res:lRes};
    });
  };

  buildPartTable('partDeptTable', getDeptData, 'dept');
  buildPartTable('partTenureTable', getTenureData, 'tenure');
  buildPartTable('partLevelTable', getLevelData, 'level');
}
// ── HEATMAP VIEW TOGGLE ───────────────────────────────────────────
let STATE_BUBBLE_AREA = 'all'; // 'all' or area key

function switchDeptChartView(view){
  document.getElementById('drTrendView').classList.toggle('active', view==='trend');
  document.getElementById('drDistView').classList.toggle('active', view==='dist');
  document.getElementById('btnDrTrend').classList.toggle('active', view==='trend');
  document.getElementById('btnDrDist').classList.toggle('active', view==='dist');
}

function switchHeatmapView(view){
  document.getElementById('heatmapTableView').classList.toggle('active', view==='table');
  document.getElementById('heatmapDistView').classList.toggle('active', view==='dist');
  document.getElementById('btnTableView').classList.toggle('active', view==='table');
  document.getElementById('btnDistView').classList.toggle('active', view==='dist');
  if(view==='dist') renderBubbleChart();
}

// ── DEPT REPORT — Distribution view (bubble strip, columns = quarters) ──
function renderDeptBubbleChart(){
  const scoreColor = v => v>=7?'#14213D':v>=5?'#2563eb':v===4?'#FCA311':'#ef4444';
  const qList = THI.quarters; // reserve every quarter slot, even ones without data yet
  const n = qList.length;
  const area = document.getElementById('drBubbleArea');
  if(!area) return;
  if(!n){ area.innerHTML=''; document.getElementById('drBubbleXLabels').innerHTML=''; document.getElementById('drBubbleYLabels').innerHTML=''; return; }

  const qData = qList.map(qq=>({
    label: qq.label,
    resp: (qq.loaded && qq.respondents) ? qq.respondents.filter(r=>r.deptGroup===THI.scopedDept) : [],
  }));

  // Divide the chart into n EQUAL-WIDTH columns (0-100%), one per quarter.
  // xCenter is the true midpoint of each column — this used to be computed with a
  // separate "6% margin + spacing" formula that didn't match the columns' actual
  // drawn boundaries, which is why dots always drifted toward one side.
  const colWidthPct = 100/n;
  const EDGE_MARGIN = 3; // keep dots from touching column dividers / chart edges
  const colBounds = qData.map((_,qi)=>{
    const left = qi*colWidthPct;
    const right = (qi+1)*colWidthPct;
    const xCenter = (left+right)/2;
    const maxJitter = Math.max(1.5, colWidthPct/2 - EDGE_MARGIN);
    return {xCenter, left, right, maxJitter};
  });

  const scatterDots=[], avgData=[];
  qData.forEach(({resp},qi)=>{
    const {xCenter, maxJitter} = colBounds[qi];
    let rawScores=[];
    resp.forEach(r=>{
      const vals=r.qs.filter(v=>v!==null&&!isNaN(v)&&v>0);
      if(vals.length) rawScores.push(vals.reduce((a,b)=>a+b,0)/vals.length);
    });
    rawScores.forEach((score,idx)=>{
      const jitter=((idx*1.9)%(maxJitter*2))-maxJitter;
      scatterDots.push({x:xCenter+jitter,y:score,color:scoreColor(Math.round(score))});
    });
    const avg=rawScores.length?rawScores.reduce((a,b)=>a+b,0)/rawScores.length:null;
    if(avg!==null) avgData.push({xCenter,avg,maxJitter});
  });

  document.getElementById('drBubbleYLabels').innerHTML =
    [7,6,5,4,3,2,1].map(v=>`<span style="font-size:.6rem;font-weight:700;color:${scoreColor(v)}">${v}</span>`).join('');

  let html='';
  colBounds.forEach(({left,right},qi)=>{
    const w=right-left;
    if(qi%2===0) html+=`<div style="position:absolute;top:0;bottom:0;left:${left}%;width:${w}%;background:rgba(0,0,0,.018)"></div>`;
    if(qi<n-1) html+=`<div style="position:absolute;top:0;bottom:0;left:${right}%;width:1px;background:#efefef"></div>`;
  });
  [1,2,3,4,5,6].forEach(v=>{
    html+=`<div style="position:absolute;left:0;right:0;height:1px;background:#f1f5f9;bottom:calc(100%*${v}/6)"></div>`;
  });
  avgData.forEach(({xCenter,avg,maxJitter})=>{
    const yPct=5+(avg-1)/6*90;
    const col=avg>=5?'#14213D':avg>=4?'#c97a00':'#dc2626';
    const hw=maxJitter;
    html+=`<div style="position:absolute;left:calc(${xCenter}% - ${hw}%);width:${hw*2}%;height:2.5px;background:${col};border-radius:2px;bottom:calc(${yPct}% + 4px);z-index:3"></div>`;
    html+=`<div style="position:absolute;left:calc(${xCenter}% - ${hw}%);font-size:.56rem;font-weight:800;color:${col};bottom:calc(${yPct}% + 10px);z-index:3">${avg.toFixed(1)}</div>`;
  });
  scatterDots.forEach(({x,y,color})=>{
    const yPct=5+(y-1)/6*90;
    html+=`<div style="position:absolute;width:5px;height:5px;border-radius:50%;background:${color};opacity:.6;transform:translate(-50%,50%);left:${x}%;bottom:calc(${yPct}% + 4px)"></div>`;
  });
  area.innerHTML=html;

  document.getElementById('drBubbleXLabels').innerHTML = qData.map(({label},qi)=>{
    const {xCenter}=colBounds[qi];
    return `<div style="position:absolute;left:${xCenter}%;transform:translateX(-50%);font-size:.62rem;font-weight:700;color:var(--text2);white-space:nowrap">${label}</div>`;
  }).join('');

  document.getElementById('drBubbleLegend').innerHTML = `
    <div style="display:flex;align-items:center;gap:4px"><div style="width:7px;height:7px;border-radius:50%;background:#14213D"></div><span style="color:#14213D;font-weight:700">Score 7</span></div>
    <div style="display:flex;align-items:center;gap:4px"><div style="width:7px;height:7px;border-radius:50%;background:#2563eb"></div><span style="color:#2563eb;font-weight:700">Score 5–6</span></div>
    <div style="display:flex;align-items:center;gap:4px"><div style="width:7px;height:7px;border-radius:50%;background:#FCA311"></div><span style="color:#c97a00;font-weight:700">Score 4</span></div>
    <div style="display:flex;align-items:center;gap:4px"><div style="width:7px;height:7px;border-radius:50%;background:#ef4444"></div><span style="color:#dc2626;font-weight:700">Score 1–3</span></div>
    <span>· Dot = average score of 1 respondent</span>`;
}

function renderBubbleChart(){
  const q   = THI.quarters[THI.activeQuarter];
  const allR= q?.respondents||[];
  if(!allR.length) return;

  // Area chips
  const chipsEl = document.getElementById('areaChips');
  const areaOptions = [{key:'all',label:'Overall'},...THI.AREAS.map(a=>({key:a.key,label:a.label}))];
  chipsEl.innerHTML = areaOptions.map(a=>`
    <button onclick="STATE_BUBBLE_AREA='${a.key}';renderBubbleChart()"
      style="padding:4px 11px;border-radius:20px;font-size:.72rem;font-weight:600;border:1px solid ${STATE_BUBBLE_AREA===a.key?'var(--navy)':'var(--border2)'};background:${STATE_BUBBLE_AREA===a.key?'var(--navy)':'#fff'};color:${STATE_BUBBLE_AREA===a.key?'#fff':'var(--text2)'};cursor:pointer;white-space:nowrap">
      ${a.label}</button>`).join('');

  // Score color by value (1-7)
  const scoreColor = v => v>=7?'#14213D':v>=5?'#2563eb':v===4?'#FCA311':'#ef4444';

  // Depts sorted by overall desc
  const depts = [...new Set(allR.map(r=>r.dept))];
  const deptScores = depts.map(d=>({
    d,
    overall: THI.calcAreaScores(allR.filter(r=>r.dept===d),STATE.method).total
  })).sort((a,b)=>b.overall-a.overall);

  const n = deptScores.length;

  // Dept abbreviations map
  const DEPT_ABBR = {
    'Audience Development':'AuDev','Boss Creator':'BC','Business Development':'BizDev',
    'Business Operations':'BizOps','Commercial':'Comm','Communications':'Comms',
    'Corporate Strategy':'CorpStr','Engineering':'Eng','Finance & Accounting':'Fin',
    'Fortune':'Fortune','GGWP':'GGWP','ICE':'ICE','IDN App':'IDNApp',
    'IDN Creative':'IDNCr','IDN Event':'IDNEv','IDN Kids':'IDNKids',
    'IDN Research Institute':'IDNRes','IDN Times':'IDNTim','JKT48':'JKT48',
    'Lifestyle Media':'LifeM','Marketing':'Mktg','People Operations':'PeoOps',
    'Product':'Prod','Special Project':'SpecP','Video':'Video',
  };
  const deptAbbr = d => DEPT_ABBR[d] || (d.length>6 ? d.slice(0,5)+'…' : d);

  // Build strip plot data — dots constrained within dept column
  const scatterDots = [];
  const avgData     = [];
  const colW = n>1 ? 88/(n-1) : 88; // % width per dept slot
  const STRIP_W = Math.min(colW*0.4, 3); // jitter stays within 40% of column width

  deptScores.forEach(({d},di)=>{
    const dResp   = allR.filter(r=>r.dept===d);
    const xCenter = n<=1 ? 50 : (di/(n-1))*88+6;
    let rawScores = [];

    if(STATE_BUBBLE_AREA==='all'){
      dResp.forEach(r=>{
        const vals = r.qs.slice(0,43).filter(v=>v!==null&&!isNaN(v)&&v>0);
        if(vals.length) rawScores.push(vals.reduce((a,b)=>a+b,0)/vals.length);
      });
    } else {
      const areaObj = THI.AREAS.find(a=>a.key===STATE_BUBBLE_AREA);
      if(areaObj){
        dResp.forEach(r=>{
          const vals = areaObj.items.map(i=>r.qs[i]).filter(v=>v!==null&&!isNaN(v)&&v>0);
          if(vals.length) rawScores.push(vals.reduce((a,b)=>a+b,0)/vals.length);
        });
      }
    }

    rawScores.forEach((score,idx)=>{
      // Jitter strictly within column bounds
      const jitter = ((idx*1.9)%(STRIP_W*2))-STRIP_W;
      scatterDots.push({x:xCenter+jitter, y:score, color:scoreColor(Math.round(score)), di});
    });

    const avg = rawScores.length ? rawScores.reduce((a,b)=>a+b,0)/rawScores.length : null;
    if(avg!==null) avgData.push({xCenter, avg, colW});
  });

  // Y labels
  document.getElementById('bubbleYLabels').innerHTML =
    [7,6,5,4,3,2,1].map(v=>`<span style="font-size:.64rem;font-weight:700;color:${scoreColor(v)}">${v}</span>`).join('');

  // Render chart
  const area = document.getElementById('bubbleArea');
  let html = '';

  // Alternating column backgrounds + separators
  deptScores.forEach(({d},di)=>{
    const xCenter = n<=1?50:(di/(n-1))*88+6;
    const left  = di===0 ? 0 : (xCenter - colW/2);
    const right = di===n-1 ? 100 : (xCenter + colW/2);
    const w = right-left;
    if(di%2===0) html+=`<div style="position:absolute;top:0;bottom:0;left:${left}%;width:${w}%;background:rgba(0,0,0,.018)"></div>`;
    if(di<n-1) html+=`<div style="position:absolute;top:0;bottom:0;left:${right}%;width:1px;background:#efefef"></div>`;
  });

  // Grid lines
  [1,2,3,4,5,6].forEach(v=>{
    html+=`<div style="position:absolute;left:0;right:0;height:1px;background:#f1f5f9;bottom:calc(100%*${v}/6)"></div>`;
  });

  // Avg lines per dept (short horizontal line centered on dept)
  avgData.forEach(({xCenter,avg,colW})=>{
    const yPct = 5 + (avg-1)/6*90;
    const col  = avg>=5?'#14213D':avg>=4?'#c97a00':'#dc2626';
    const hw   = Math.min(colW*0.35, 3); // half-width of avg line
    html+=`<div style="position:absolute;left:calc(${xCenter}% - ${hw}%);width:${hw*2}%;height:2.5px;background:${col};border-radius:2px;bottom:calc(${yPct}% + 4px);z-index:3"></div>`;
    html+=`<div style="position:absolute;left:calc(${xCenter}% - ${hw}%);font-size:.57rem;font-weight:800;color:${col};bottom:calc(${yPct}% + 10px);z-index:3">${avg.toFixed(1)}</div>`;
  });

  // Dots
  scatterDots.forEach(({x,y,color})=>{
    const yPct = 5 + (y-1)/6*90;
    html+=`<div style="position:absolute;width:5px;height:5px;border-radius:50%;background:${color};opacity:.6;transform:translate(-50%,50%);left:${x}%;bottom:calc(${yPct}% + 4px)"></div>`;
  });

  area.innerHTML = html;

  // X labels — short max 8 chars
  // X labels — absolute positioned to match column xCenter
  const xlEl = document.getElementById('bubbleXLabels');
  xlEl.style.cssText = 'position:relative;height:28px;display:block';
  xlEl.innerHTML = deptScores.map(({d,overall},di)=>{
    const xCenter = n<=1?50:(di/(n-1))*88+6;
    const col = barColor(overall);
    return `<div title="${d}" style="position:absolute;left:${xCenter}%;transform:translateX(-50%);font-size:.58rem;font-weight:600;color:${col};white-space:nowrap">${deptAbbr(d)}</div>`;
  }).join('');


  // Legend
  document.getElementById('bubbleLegend').innerHTML = `
    <div style="display:flex;align-items:center;gap:4px"><div style="width:8px;height:8px;border-radius:50%;background:#14213D"></div><span style="color:#14213D;font-weight:700">Score 7</span></div>
    <div style="display:flex;align-items:center;gap:4px"><div style="width:8px;height:8px;border-radius:50%;background:#2563eb"></div><span style="color:#2563eb;font-weight:700">Score 5–6</span></div>
    <div style="display:flex;align-items:center;gap:4px"><div style="width:8px;height:8px;border-radius:50%;background:#FCA311"></div><span style="color:#c97a00;font-weight:700">Score 4</span></div>
    <div style="display:flex;align-items:center;gap:4px"><div style="width:8px;height:8px;border-radius:50%;background:#ef4444"></div><span style="color:#dc2626;font-weight:700">Score 1–3</span></div>
    <div style="width:1px;height:14px;background:#e2e8f0"></div>
    <div style="display:flex;align-items:center;gap:5px"><div style="width:16px;height:2.5px;background:#94a3b8;border-radius:1px"></div><span>Average per dept</span></div>
    <span>· Each dot = 1 respondent · Column = 1 dept</span>`;
}

// ── DEPT REPORT — NEW CALC HELPERS ────────────────────────────────────
function calcEngagementTiers(respondents){
  return THI.AREAS.map(a=>{
    const vals=respondents.flatMap(r=>a.items.map(i=>r.qs[i]).filter(v=>v!==null&&!isNaN(v)));
    const n=vals.length;
    if(!n) return {area:a.label,key:a.key,disengaged:0,neutral:0,engaged:0};
    return {
      area:a.label,key:a.key,
      disengaged:vals.filter(v=>v<=3).length/n*100,
      neutral:vals.filter(v=>v===4||v===5).length/n*100,
      engaged:vals.filter(v=>v>=6).length/n*100,
    };
  });
}
// Groups respondents by an arbitrary key function, then computes the FULL
// per-area score breakdown (not just .total) for each group — used by the
// Special Role report's By Department / By Tenure / By Level tables, which
// need every area's score per group, not just one summary number.
function calcGroupAreaScores(resp, groupFn, method){
  const groups={};
  resp.forEach(r=>{
    const g=groupFn(r);
    if(!g) return;
    (groups[g]=groups[g]||[]).push(r);
  });
  return Object.keys(groups).map(label=>({label, n:groups[label].length, scores:THI.calcAreaScores(groups[label], method)}));
}
function calcByLevel(respondents, method){
  const LEVEL_ORDER=['Associate','Sr. Associate','Manager','Sr. Manager','Functional','Team Lead'];
  const present=respondents.filter(r=>r.level);
  const known=LEVEL_ORDER.filter(l=>present.some(r=>r.level===l));
  const extra=[...new Set(present.map(r=>r.level))].filter(l=>!LEVEL_ORDER.includes(l));
  return [...known,...extra].map(l=>{
    const sub=present.filter(r=>r.level===l);
    return {level:l, val:sub.length?+THI.calcAreaScores(sub,method).total.toFixed(2):null};
  });
}
function calcByTenure(respondents, method){
  const TENURE_ORDER=['< 6 months','6 months – 1 yr','1 – 2 years','2 – 3 years','3 – 4 years','4 – 5 years','> 5 years'];
  const present=TENURE_ORDER.filter(t=>respondents.some(r=>r.tenure===t));
  return present.map(t=>{
    const sub=respondents.filter(r=>r.tenure===t);
    return {tenure:t, val:sub.length?+THI.calcAreaScores(sub,method).total.toFixed(2):null};
  });
}
function calcMentionCounts(respondents){
  const cols=typeof CHECKLIST_COLS!=='undefined'?CHECKLIST_COLS:[];
  return cols.map(c=>({
    label:c.label,
    well:respondents.filter(r=>r.checklist&&r.checklist[c.label]==='V').length,
    improve:respondents.filter(r=>r.checklist&&r.checklist[c.label]==='X').length,
  }));
}
function calcOtherTopics(respondents, field){
  const freq={};
  respondents.forEach(r=>{(r[field]||[]).forEach(topic=>{const k=(topic||'').trim();if(!k)return;freq[k]=(freq[k]||0)+1})});
  return Object.entries(freq).sort((a,b)=>b[1]-a[1]).map(([topic,count])=>({topic,count}));
}

// ── DEPARTMENT REPORT (token-scoped, standalone single-page view) ────
// Small SVG ring/donut used in the dept report's "C. THI Results" cards.
function buildDonutHtml(value, opts={}){
  const {size=132, stroke=15, color='#0f6e56', trackColor='var(--border2)', label=null, suffix='%'} = opts;
  const hasVal = value!==null && value!==undefined && !isNaN(value);
  const clamped = hasVal ? Math.max(0, Math.min(100, value)) : 0;
  const r = (size - stroke)/2, cx = size/2, cy = size/2;
  const c = 2*Math.PI*r;
  const offset = c * (1 - clamped/100);
  const dispVal = hasVal ? `${dp(value)}${suffix}` : '—';
  return `<div style="position:relative;width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${trackColor}" stroke-width="${stroke}"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>
    </svg>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
      <div style="font-size:1.6rem;font-weight:800;color:${color}">${dispVal}</div>
      ${label?`<div style="font-size:.62rem;font-weight:700;color:var(--text3);margin-top:1px">${label}</div>`:''}
    </div>
  </div>`;
}

// Builds the "Comparative Analysis (Population Distribution Method)" table for
// one COMPARISON_SECTIONS entry — reuses the same pair data as the Comparison
// tab, but always scored with the fav67 (Population Distribution) method,
// regardless of the currently selected Scoring Method filter.
function buildComparativeAnalysisTableHtml(section, resp){
  const { managerial, nonManagerial } = splitByManagerial(resp);
  const segMap = { all:resp, managerial, nonManagerial };
  const isLeadership = section.id === 'leadership';
  const headA = isLeadership ? 'Managerial Level' : 'Questions';
  const headB = isLeadership ? 'Non Managerial Level' : 'Questions';
  const pairsHtml = section.pairs.map((pair,i)=>{
    const respA = segMap[pair.a.segment || pair.segment || 'all'];
    const respB = segMap[pair.b.segment || pair.segment || 'all'];
    const scoreA = scoreForQuestion(respA, pair.a.q, STATE.method);
    const scoreB = scoreForQuestion(respB, pair.b.q, STATE.method);
    const scoreAHtml = scoreA===null||scoreA===undefined?'—':`<span data-cu="${scoreA}">0</span>%`;
    const scoreBHtml = scoreB===null||scoreB===undefined?'—':`<span data-cu="${scoreB}">0</span>%`;
    const labelRow = isLeadership
      ? `<div class="dr-c-cmp-label-row dr-c-cmp-label-row-single">${pair.title}</div>`
      : `<div class="dr-c-cmp-label-row"><div class="dr-c-cmp-label-a">${pair.a.label}</div><div class="dr-c-cmp-label-b">${pair.b.label}</div></div>`;
    const isLast = i===section.pairs.length-1;
    return `<div class="dr-c-cmp-pair${isLast?' dr-c-cmp-pair-last':''}">
      ${labelRow}
      <div class="dr-c-cmp-pair-row">
        <div class="dr-c-cmp-side dr-c-cmp-side-a"><div class="dr-c-cmp-q">${pair.a.q}. ${pair.a.text}</div><div class="dr-c-cmp-score dr-c-cmp-score-a">${scoreAHtml}</div></div>
        <div class="dr-c-cmp-side dr-c-cmp-side-b"><div class="dr-c-cmp-q">${pair.b.q}. ${pair.b.text}</div><div class="dr-c-cmp-score dr-c-cmp-score-b">${scoreBHtml}</div></div>
      </div>
    </div>`;
  }).join('');
  return `<div class="dr-c-cmp-head-row">
      <div class="dr-c-cmp-head-cell">${headA}</div>
      <div class="dr-c-cmp-head-cell">${headB}</div>
    </div>
    <div class="dr-c-cmp-pairs">${pairsHtml}</div>`;
}

function renderDeptReport(){
  const resp = getFiltered(); // already hard-scoped to THI.scopedDept via getFiltered()
  const q = THI.quarters[THI.activeQuarter];
  const cfg = THI.config?.[q?.label] || {};
  const targetNPS = cfg.targetNPS ?? null;
  const targetOKR = cfg.targetOKR ?? null;
  const prevQ = THI.activeQuarter>0 ? THI.quarters[THI.activeQuarter-1] : null;
  const prevCfg = prevQ ? (THI.config?.[prevQ.label] || {}) : {};

  const currAvg = THI.calcAreaScores(resp,'avg');
  const curr67  = THI.calcAreaScores(resp,'fav67');
  const prevAvg = getPrev('avg');
  const prev67  = getPrev('fav67');
  const nps     = THI.calcNPS(resp);
  const prevNps = getPrevNPS();
  const smt = sentiment(currAvg.total);

  // decimals defaults to following the Decimal toggle (STATE.decimals) rather
  // than always rounding to a whole number — evaluated fresh on every call
  // (not baked in at function-definition time), so it still reacts correctly
  // if the toggle changes after this function was created.
  const deltaBadge=(curr,prev,decimals=null,suffix='pt')=>{
    if(prev===null||prev===undefined) return `<span class="dr-metric-delta na">No prev quarter</span>`;
    const dec = decimals===null ? (STATE.decimals?2:0) : decimals;
    const d=curr-prev;
    if(Math.abs(d)<0.05) return `<span class="dr-metric-delta na">= 0${suffix}</span>`;
    const up=d>0;
    return `<span class="dr-metric-delta ${up?'up':'dn'}">${up?'▲':'▼'} ${Math.abs(d).toFixed(dec)}${suffix}</span>`;
  };

  // ── Card 1: Participation Rate ──
  const popN=q?.population?.byDeptGroup?.[THI.scopedDept] ?? q?.population?.byDept?.[THI.scopedDept];
  const prevPopN=prevQ?.population?.byDeptGroup?.[THI.scopedDept] ?? prevQ?.population?.byDept?.[THI.scopedDept];
  // Cards 1–4 (old Overview-tab metric cards) only exist if that markup is present.
  if(document.getElementById('drPartRate')){
    let partVal, partSub, ratePrev=null;
    if(popN){
      const rate=resp.length/popN*100;
      partVal=`<span id="drPartRateNum">0</span>%`;
      partSub=`${resp.length.toLocaleString()} of ${popN.toLocaleString()} Timmys`;
      if(prevQ?.respondents?.length && prevPopN){
        const prevResp=prevQ.respondents.filter(r=>r.deptGroup===THI.scopedDept);
        ratePrev=prevResp.length/prevPopN*100;
      }
      document.getElementById('drPartRate').innerHTML=partVal;
      animateNumber(document.getElementById('drPartRateNum'), rate, {decimals:0});
    }else{
      partVal=resp.length.toLocaleString();
      partSub='Total respondents this quarter';
      document.getElementById('drPartRate').textContent=partVal;
    }
    document.getElementById('drPartSub').textContent=partSub;
    document.getElementById('drPartDelta').innerHTML= popN&&ratePrev!==null ? deltaBadge(resp.length/popN*100, ratePrev) : '';

    // ── Card 2: OKR Achievement (Average per 7 vs Target OKR) ──
    if(targetOKR){
      const okrAchieve=currAvg.total/targetOKR*100;
      document.getElementById('drOkrAchieve').innerHTML=`<span id="drOkrAchieveNum">0</span>%`;
      animateNumber(document.getElementById('drOkrAchieveNum'), okrAchieve, {decimals:0});
      document.getElementById('drOkrTarget').textContent=`Avg per 7: ${dp(currAvg.total)}% · Target: ${targetOKR}%`;
      const prevOkrTarget=prevCfg.targetOKR;
      const prevOkrAchieve=(prevAvg && prevOkrTarget)? prevAvg.total/prevOkrTarget*100 : null;
      document.getElementById('drOkrDelta').innerHTML=deltaBadge(okrAchieve,prevOkrAchieve);
    }else{
      document.getElementById('drOkrAchieve').textContent='—';
      document.getElementById('drOkrTarget').textContent='Target OKR not set in the Config sheet';
      document.getElementById('drOkrDelta').innerHTML='';
    }

    // ── Card 3: THI Score (6 & 7 Method) ──
    document.getElementById('drScore67').innerHTML=`<span id="drScore67Num">0</span>%`;
    animateNumber(document.getElementById('drScore67Num'), curr67.total, {decimals:0});
    document.getElementById('drScore67Delta').innerHTML=deltaBadge(curr67.total, prev67?prev67.total:null);

    // ── Card 4: NPS Achievement (NPS vs Target NPS, NPS score shown as subtext) ──
    if(targetNPS){
      const achieve=nps.nps/targetNPS*100;
      document.getElementById('drNpsAchieve').innerHTML=`<span id="drNpsAchieveNum">0</span>%`;
      animateNumber(document.getElementById('drNpsAchieveNum'), achieve, {decimals:0});
      document.getElementById('drNpsTarget').textContent=`NPS: ${dp(nps.nps)} · Target: ${targetNPS}`;
      const prevNpsTarget=prevCfg.targetNPS;
      const prevNpsAchieve=(prevNps && prevNpsTarget)? prevNps.nps/prevNpsTarget*100 : null;
      document.getElementById('drNpsDelta').innerHTML=deltaBadge(achieve,prevNpsAchieve);
    }else{
      document.getElementById('drNpsAchieve').textContent='—';
      document.getElementById('drNpsTarget').textContent='Target NPS not set in the Config sheet';
      document.getElementById('drNpsDelta').innerHTML='';
    }
  }

  // ── Top/Bottom 3 Areas — both methods ──
  const rankAreas=(scores,prevScores)=>[...THI.AREAS].map(a=>({...a,val:scores[a.key],pv:prevScores?prevScores[a.key]:null})).sort((a,b)=>b.val-a.val);
  const sortedAvg=rankAreas(currAvg,prevAvg);
  const sorted67=rankAreas(curr67,null);
  const currMethodChart=THI.calcAreaScores(resp,STATE.method);
  const prevMethodChart=getPrev(STATE.method);
  const sortedMethod=rankAreas(currMethodChart,prevMethodChart);
  const areaRowsHtml=(list,variant)=>{
    const col = variant==='top' ? '#16a34a' : '#dc2626';
    return list.map(a=>`<div style="display:flex;align-items:center;gap:8px;padding:3px 0">
      <span style="width:150px;flex-shrink:0;font-size:.76rem;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.label}</span>
      <div style="flex:1;height:9px;background:#eef0f5;border-radius:5px;overflow:hidden;box-shadow:inset 0 1px 2px rgba(15,23,42,.12)"><div style="width:0%;height:100%;border-radius:5px;background:${barGradCSS(col)};box-shadow:0 1px 2px rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.35);transition:width .6s var(--ease-lift)" data-w="${a.val}%"></div></div>
      <span style="width:44px;text-align:right;flex-shrink:0;font-size:.76rem;font-weight:700;color:${col};text-shadow:0 1px 0 rgba(255,255,255,.6)">${pct(a.val)}</span>
    </div>`).join('');
  };
  const drTopAreasAvgEl=document.getElementById('drTopAreasAvg'), drBotAreasAvgEl=document.getElementById('drBotAreasAvg'), drTopAreas67El=document.getElementById('drTopAreas67'), drBotAreas67El=document.getElementById('drBotAreas67');
  refreshHTML(drTopAreasAvgEl, areaRowsHtml(sortedAvg.slice(0,3),'top'), ()=>growBars(drTopAreasAvgEl));
  refreshHTML(drBotAreasAvgEl, areaRowsHtml([...sortedAvg].reverse().slice(0,3),'bottom'), ()=>growBars(drBotAreasAvgEl));
  refreshHTML(drTopAreas67El, areaRowsHtml(sorted67.slice(0,3),'top'), ()=>growBars(drTopAreas67El));
  refreshHTML(drBotAreas67El, areaRowsHtml([...sorted67].reverse().slice(0,3),'bottom'), ()=>growBars(drBotAreas67El));

  // ── Section C: THI Results ──
  // Participation Rate — icon-left metric card (matches Overview tab's card style)
  const partDonutVal = popN ? (resp.length/popN*100) : (resp.length ? 100 : null);
  const cPartRateEl = document.getElementById('drCPartRate');
  if(cPartRateEl){
    if(partDonutVal===null||partDonutVal===undefined){ cPartRateEl.textContent='—'; cPartRateEl.dataset.cuVal=''; }
    else animateNumber(cPartRateEl, partDonutVal, {decimals:STATE.decimals?2:0, suffix:'%'});
  }
  const cPartDeltaEl = document.getElementById('drCPartDelta');
  if(cPartDeltaEl){
    let partRatePrev=null;
    if(popN && prevQ?.respondents?.length && prevPopN){
      const prevRespC=prevQ.respondents.filter(r=>r.deptGroup===THI.scopedDept);
      partRatePrev=prevRespC.length/prevPopN*100;
    }
    cPartDeltaEl.innerHTML = (popN && partRatePrev!==null) ? deltaBadge(partDonutVal, partRatePrev) : '';
  }
  const cPartFooterEl = document.getElementById('drCPartFooter');
  if(cPartFooterEl) cPartFooterEl.textContent = popN ? `${resp.length.toLocaleString()} of ${popN.toLocaleString()} Timmys` : `${resp.length.toLocaleString()} Timmys`;

  // THI Score card (new design): big number = raw THI score, Target Score row,
  // and a highlighted OKR Achievement row (= score/target — same figure the old
  // sub-line used to show as text, now its own row with a delta badge).
  const thiScoreVal = currMethodChart.total;
  const cThiScoreEl = document.getElementById('drCThiScore');
  if(cThiScoreEl) animateNumber(cThiScoreEl, thiScoreVal, {decimals:STATE.decimals?2:0, suffix:'%'});
  const cThiScoreDeltaEl = document.getElementById('drCThiScoreDelta');
  if(cThiScoreDeltaEl) cThiScoreDeltaEl.innerHTML = deltaBadge(thiScoreVal, prevMethodChart?prevMethodChart.total:null);
  const cThiTargetEl = document.getElementById('drCThiTarget');
  if(cThiTargetEl) cThiTargetEl.textContent = targetOKR ? `${targetOKR}%` : '—';
  const cThiAchieveEl = document.getElementById('drCThiAchieve');
  const cThiDeltaEl = document.getElementById('drCThiDelta');
  if(targetOKR){
    const okrAchieveC = thiScoreVal/targetOKR*100;
    if(cThiAchieveEl) animateNumber(cThiAchieveEl, okrAchieveC, {decimals:STATE.decimals?2:0, suffix:'%'});
    const prevOkrTargetC = prevCfg.targetOKR;
    const prevOkrAchieveC = (prevMethodChart && prevOkrTargetC) ? prevMethodChart.total/prevOkrTargetC*100 : null;
    if(cThiDeltaEl) cThiDeltaEl.innerHTML = deltaBadge(okrAchieveC, prevOkrAchieveC);
  }else{
    if(cThiAchieveEl){ cThiAchieveEl.textContent='—'; cThiAchieveEl.dataset.cuVal=''; }
    if(cThiDeltaEl) cThiDeltaEl.innerHTML='';
  }

  // NPS Score card (new design): big number = raw NPS, Target Score row, and a
  // highlighted OKR Achievement row (= NPS/target).
  const npsVal = nps.nps;
  const cNpsScoreEl = document.getElementById('drCNpsScore');
  if(cNpsScoreEl) animateNumber(cNpsScoreEl, npsVal, {decimals:STATE.decimals?2:0});
  const cNpsScoreDeltaEl = document.getElementById('drCNpsScoreDelta');
  if(cNpsScoreDeltaEl) cNpsScoreDeltaEl.innerHTML = deltaBadge(npsVal, prevNps?prevNps.nps:null);
  const cNpsTargetEl = document.getElementById('drCNpsTarget');
  if(cNpsTargetEl) cNpsTargetEl.textContent = targetNPS ? `${targetNPS}` : '—';
  const cNpsAchieveEl = document.getElementById('drCNpsAchieve');
  const cNpsDeltaEl = document.getElementById('drCNpsDelta');
  if(targetNPS){
    const npsAchieve = npsVal/targetNPS*100;
    if(cNpsAchieveEl) animateNumber(cNpsAchieveEl, npsAchieve, {decimals:STATE.decimals?2:0, suffix:'%'});
    const prevNpsTargetC = prevCfg.targetNPS;
    const prevNpsAchieveC = (prevNps && prevNpsTargetC) ? prevNps.nps/prevNpsTargetC*100 : null;
    if(cNpsDeltaEl) cNpsDeltaEl.innerHTML = deltaBadge(npsAchieve, prevNpsAchieveC);
  }else{
    if(cNpsAchieveEl){ cNpsAchieveEl.textContent='—'; cNpsAchieveEl.dataset.cuVal=''; }
    if(cNpsDeltaEl) cNpsDeltaEl.innerHTML = '';
  }

  // Top/Bottom 3 Items — individual questions, follows the active Scoring Method filter
  // Rendered as one interleaved grid (top1, bottom1, top2, bottom2, top3, bottom3) so
  // each row's height matches across both columns, and the block stretches to the
  // full height of the Areas column alongside it.
  const itemScoresActive = THI.calcItemScores(resp,STATE.method)
    .map((it,i)=>({...it, idx:i, label:(THI.QUESTION_LABELS&&THI.QUESTION_LABELS[i])||`Question ${i+1}`}))
    .filter(it=>it.n>0);
  const sortedItemsActive = [...itemScoresActive].sort((a,b)=>b.score-a.score);
  const topItems3 = sortedItemsActive.slice(0,3);
  const botItems3 = [...sortedItemsActive].reverse().slice(0,3);
  const itemRowHtml=(it,pillClass,isLast)=>`<div class="dr-c-item-row${isLast?' dr-c-item-row-last':''}"><div class="dr-c-item-area">${it.area}</div><div class="dr-c-item-text">${it.item}. ${it.label}</div><div class="dr-c-pill ${pillClass}"><span data-cu="${it.score}">0</span>%</div></div>`;
  const itemsGridHtml = [0,1,2].map(i=>{
    const top = topItems3[i] ? itemRowHtml(topItems3[i],'dr-c-pill-green', i===2) : '<div></div>';
    const bot = botItems3[i] ? itemRowHtml(botItems3[i],'dr-c-pill-red', i===2) : '<div></div>';
    return top+bot;
  }).join('');
  const cItemsGridEl = document.getElementById('drCItemsGrid');
  refreshHTML(cItemsGridEl, itemsGridHtml, ()=>growNumbers(cItemsGridEl), 320);

  // Top/Bottom 3 Areas — numbered rows with a colored score pill, follows the active Scoring Method filter
  const areaListHtml = (list,pillClass,barColor)=>list.map((a,i)=>`<div class="dr-c-area-row"><span class="dr-c-area-row-num">${i+1}.</span><span class="dr-c-area-row-label">${a.label}</span><div class="dr-c-area-row-bar"><div class="dr-c-area-row-bar-fill" style="background:${barColor};width:0%" data-w="${a.val}%"></div></div><div class="dr-c-pill ${pillClass}"><span data-cu="${a.val}">0</span>%</div></div>`).join('');
  const cTopAreasEl = document.getElementById('drCTopAreas');
  refreshHTML(cTopAreasEl, areaListHtml(sortedMethod.slice(0,3),'dr-c-pill-green','#16a34a'), ()=>{growBars(cTopAreasEl);growNumbers(cTopAreasEl);}, 320);
  const cBotAreasEl = document.getElementById('drCBotAreas');
  refreshHTML(cBotAreasEl, areaListHtml([...sortedMethod].reverse().slice(0,3),'dr-c-pill-red','#dc2626'), ()=>{growBars(cBotAreasEl);growNumbers(cBotAreasEl);}, 320);

  // Comparative Analysis (Perception & Leadership pair tables)
  const cCmpPerceptionEl = document.getElementById('drCCmpPerception');
  refreshHTML(cCmpPerceptionEl, buildComparativeAnalysisTableHtml(COMPARISON_SECTIONS[0], resp), ()=>growNumbers(cCmpPerceptionEl), 320);
  const cCmpLeadershipEl = document.getElementById('drCCmpLeadership');
  refreshHTML(cCmpLeadershipEl, buildComparativeAnalysisTableHtml(COMPARISON_SECTIONS[1], resp), ()=>growNumbers(cCmpLeadershipEl), 320);

  // ── THI Score per Area — Average Score vs Population Distribution ──
  const cAreaLineEl = document.getElementById('drCAreaLineChart');
  if(cAreaLineEl){
    const areaLabels = THI.AREAS.map(a=>a.label);
    const avgSeries = THI.AREAS.map(a=>+currAvg[a.key].toFixed(2));
    const popSeries = THI.AREAS.map(a=>+curr67[a.key].toFixed(2));
    const areaLineData = {labels:areaLabels, datasets:[
      {label:'Average Score', data:avgSeries, borderColor:G.navy, backgroundColor:G.navy, pointRadius:4, spanGaps:true,
        datalabels:{align:'top',offset:6,font:{size:9,weight:'700'},color:G.navy,formatter:v=>v!==null&&v!==undefined?`${dp(v)}%`:''}},
      {label:'Population Distribution', data:popSeries, borderColor:'#dc2626', backgroundColor:'#dc2626', pointRadius:4, spanGaps:true,
        datalabels:{align:'bottom',offset:6,font:{size:9,weight:'700'},color:'#dc2626',formatter:v=>v!==null&&v!==undefined?`${dp(v)}%`:''}},
    ]};
    const areaLineOpts = {responsive:true,maintainAspectRatio:false,layout:{padding:{top:22,bottom:6}},plugins:{legend:{display:false}},scales:{y:{min:0,max:100,ticks:{callback:v=>`${v}%`}},x:{ticks:{font:{size:9.5,weight:'600'},color:G.text2,maxRotation:35,minRotation:35}}}};
    if(CH.drCAreaLine){CH.drCAreaLine.data=areaLineData;CH.drCAreaLine.options=areaLineOpts;CH.drCAreaLine.update();}
    else{CH.drCAreaLine=new Chart(cAreaLineEl.getContext('2d'),{type:'line',data:areaLineData,options:areaLineOpts});}
  }

  // ── THI Score by Tenure / Level — follows the active Scoring Method filter ──
  const cLineOptsFixed = {responsive:true,maintainAspectRatio:false,layout:{padding:{top:20}},plugins:{legend:{display:false},datalabels:{align:'top',offset:5,font:{size:9,weight:'700'},color:'#4d7c0f',formatter:v=>v!==null&&v!==undefined?`${dp(v)}%`:''}},scales:{y:{min:0,max:100,ticks:{callback:v=>`${v}%`,font:{size:8}}},x:{ticks:{font:{size:8.5,weight:'600'},color:G.text2}}}};
  const cTenureEl = document.getElementById('drCTenureChart');
  if(cTenureEl){
    const tenureRows = calcByTenure(resp,STATE.method);
    const tenureData = {labels:tenureRows.map(t=>t.tenure), datasets:[{data:tenureRows.map(t=>t.val), borderColor:'#4d7c0f', backgroundColor:'#4d7c0f', pointRadius:3.5, spanGaps:true}]};
    if(CH.drCTenure){CH.drCTenure.data=tenureData;CH.drCTenure.update();}
    else{CH.drCTenure=new Chart(cTenureEl.getContext('2d'),{type:'line',data:tenureData,options:cLineOptsFixed});}
  }
  const cLevelEl = document.getElementById('drCLevelChart');
  const cLevelRows = calcByLevel(resp,STATE.method);
  if(!cLevelRows.length){
    const wrap = document.getElementById('drCLevelChartWrap');
    if(wrap) wrap.innerHTML = '<p style="text-align:center;color:#94a3b8;font-size:.72rem;padding:36px 0">Level data is not available for this quarter yet.</p>';
  }else if(cLevelEl){
    const levelData = {labels:cLevelRows.map(l=>l.level), datasets:[{data:cLevelRows.map(l=>l.val), borderColor:'#4d7c0f', backgroundColor:'#4d7c0f', pointRadius:3.5, spanGaps:true}]};
    if(CH.drCLevel){CH.drCLevel.data=levelData;CH.drCLevel.update();}
    else{CH.drCLevel=new Chart(cLevelEl.getContext('2d'),{type:'line',data:levelData,options:cLineOptsFixed});}
  }

  // ── Open Questions Feedback — actual comment text, this dept + quarter ──
  const qLabelC = q?.label;
  const allFeedback = (THI.openFeedback && THI.openFeedback[qLabelC]) || [];
  const deptFeedback = THI.scopedDept ? allFeedback.filter(r=>THI.getDeptGroup(r.dept)===THI.scopedDept) : allFeedback;
  const goodQuotes = deptFeedback.flatMap(r=>r.well||[]).map(t=>(t||'').trim()).filter(Boolean);
  const badQuotes = deptFeedback.flatMap(r=>r.improve||[]).map(t=>(t||'').trim()).filter(Boolean);
  const quoteListHtml = list=>{
    if(!list.length) return `<li class="dr-c-openq-list-empty">No responses yet</li>`;
    const shown = list.slice(0,8);
    let html = shown.map(t=>`<li>${t}</li>`).join('');
    if(list.length>8) html += `<li style="list-style:none;margin-left:-18px;color:var(--text3);font-style:italic">+${list.length-8} more response${list.length-8>1?'s':''}</li>`;
    return html;
  };
  const cGoodEl = document.getElementById('drCOpenQGood');
  refreshHTML(cGoodEl, quoteListHtml(goodQuotes), null, 320);
  const cBadEl = document.getElementById('drCOpenQBad');
  refreshHTML(cBadEl, quoteListHtml(badQuotes), null, 320);

  // ── Top 3 Topics by mention count (checklist-based) ──
  const mentions=calcMentionCounts(resp);
  const prevRespMentions = (prevQ?.loaded && prevQ.respondents?.length) ? prevQ.respondents.filter(r=>r.deptGroup===THI.scopedDept) : [];
  const prevMentionsMap = {};
  if(prevRespMentions.length) calcMentionCounts(prevRespMentions).forEach(m=>{prevMentionsMap[m.label]=m});
  if(mentions.length){
    const topWell=[...mentions].sort((a,b)=>b.well-a.well).slice(0,3);
    const topImprove=[...mentions].sort((a,b)=>b.improve-a.improve).slice(0,3);
    const topicRow=(m,count,col,rank)=>`<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f8fafc">
      <div style="width:18px;height:18px;border-radius:50%;background:${col};color:#fff;font-size:.6rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,.25)">${rank}</div>
      <span style="flex:1;font-size:.76rem;color:var(--text2);min-width:0;line-height:1.3">${m.label}</span>
      <span style="flex-shrink:0;white-space:nowrap;font-size:.68rem;font-weight:800;color:#fff;background:${col};padding:2px 9px;border-radius:20px">${count}</span>
    </div>`;
    refreshHTML(document.getElementById('drTopTopics'), topWell.map((m,i)=>topicRow(m,m.well,'#16a34a',i+1)).join(''));
    refreshHTML(document.getElementById('drBotTopics'), topImprove.map((m,i)=>topicRow(m,m.improve,'#dc2626',i+1)).join(''));
  }

  // ── Top/Bottom 3 Items (question-level) + OKR achievement ──
  const items=THI.calcItemScores(resp,STATE.method).map((it,i)=>({...it,label:THI.QUESTION_LABELS[i]||`Question ${i+1}`}));
  const qTop=[...items].sort((a,b)=>b.score-a.score).slice(0,3);
  const qBot=[...items].sort((a,b)=>a.score-b.score).slice(0,3);
  const itemHtml=(list,variant)=>{
    const col = variant==='top' ? '#16a34a' : '#dc2626';
    return list.map((it,i)=>`
    <div style="display:flex;align-items:center;gap:10px;min-height:64px;padding:8px 0;border-bottom:1px solid #f8fafc">
      <div style="width:22px;height:22px;border-radius:50%;background:${col};color:#fff;font-size:.68rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 4px rgba(0,0,0,.25)">${i+1}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.64rem;font-weight:700;color:var(--text3);text-transform:uppercase">${it.area}</div>
        <div style="font-size:.76rem;color:var(--text2);line-height:1.35">${it.label}</div>
        <div style="height:7px;background:#eef0f5;border-radius:4px;overflow:hidden;margin-top:5px;box-shadow:inset 0 1px 2px rgba(15,23,42,.12)"><div style="width:0%;height:100%;border-radius:4px;background:${barGradCSS(col)};box-shadow:0 1px 2px rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.35);transition:width .6s var(--ease-lift)" data-w="${it.score}%"></div></div>
      </div>
      <div style="font-size:.88rem;font-weight:800;color:${col};flex-shrink:0;width:46px;text-align:right;text-shadow:0 1px 0 rgba(255,255,255,.6)">${pct(it.score)}</div>
    </div>`).join('');
  };
  const drTopItemsEl=document.getElementById('drTopItems'), drBotItemsEl=document.getElementById('drBotItems');
  refreshHTML(drTopItemsEl, itemHtml(qTop,'top'), ()=>growBars(drTopItemsEl));
  refreshHTML(drBotItemsEl, itemHtml(qBot,'bottom'), ()=>growBars(drBotItemsEl));

  // ── Population by engagement tier, per area ──
  const eng=calcEngagementTiers(resp);
  const engSeg=(pct,bg)=>`<div style="width:0%;background:${barGradCSS(bg)};display:flex;align-items:center;justify-content:center;min-width:0;box-shadow:inset 0 1px 0 rgba(255,255,255,.3),1px 0 2px rgba(0,0,0,.15);transition:width .6s var(--ease-lift)" data-w="${pct}%">${pct>=8?`<span style="font-size:.62rem;font-weight:800;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.35)">${dp(pct)}%</span>`:''}</div>`;
  const drEngagementListEl=document.getElementById('drEngagementList');
  refreshHTML(drEngagementListEl, eng.map(e=>`
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="width:150px;font-size:.72rem;color:var(--text2);flex-shrink:0">${e.area}</span>
      <div style="flex:1;display:flex;height:19px;border-radius:4px;overflow:hidden;box-shadow:inset 0 1px 3px rgba(15,23,42,.2),0 1px 1px rgba(255,255,255,.5)">
        ${engSeg(e.disengaged,'#ef4444')}
        ${engSeg(e.neutral,'#FCA311')}
        ${engSeg(e.engaged,'#14213D')}
      </div>
    </div>`).join(''), ()=>growBars(drEngagementListEl));

  // ── Open Questions Feedback (diverging bar, reused pattern) ──
  if(mentions.length){
    const maxM=Math.max(1,...mentions.flatMap(m=>[m.well,m.improve]));
    const mentionDelta=(curr,prev,goodDirection)=>{
      if(prev===undefined||prev===null) return '';
      const d=curr-prev;
      if(d===0) return `<span style="font-size:.62rem;color:#94a3b8;font-weight:700">= 0pt</span>`;
      const isGood = goodDirection==='up' ? d>0 : d<0;
      const col = isGood ? '#16a34a' : '#dc2626';
      const arrow = d>0?'▲':'▼';
      return `<span style="font-size:.62rem;color:${col};font-weight:700">${arrow}${Math.abs(d)}pt</span>`;
    };
    const drDivergingBarsEl=document.getElementById('drDivergingBars');
    refreshHTML(drDivergingBarsEl, mentions.map((m,i)=>{
      const iw=Math.max(2,Math.round(m.improve/maxM*100));
      const ww=Math.max(2,Math.round(m.well/maxM*100));
      const pm=prevMentionsMap[m.label];
      return`<div style="display:grid;grid-template-columns:1fr 150px 1fr;align-items:center;gap:8px;padding:5px 0">
        <div style="display:flex;justify-content:flex-end;align-items:center;gap:6px">${mentionDelta(m.improve,pm?.improve,'down')}<span style="font-size:.72rem;color:#dc2626;font-weight:700">${m.improve}</span><div class="divbar-imp" style="height:13px;width:0%;transition:width .6s var(--ease-lift)" data-w="${iw}%"></div></div>
        <div style="font-size:.72rem;text-align:center;color:var(--text2)">${m.label}</div>
        <div style="display:flex;align-items:center;gap:6px"><div class="divbar-well" style="height:13px;width:0%;transition:width .6s var(--ease-lift)" data-w="${ww}%"></div><span style="font-size:.72rem;color:#16a34a;font-weight:700">${m.well}</span>${mentionDelta(m.well,pm?.well,'up')}</div>
      </div>`;
    }).join(''), ()=>growBars(drDivergingBarsEl));

    // Section C ("THI Results") uses the exact same diverging-bar visual, same data.
    const cOpenQBarsEl=document.getElementById('drCOpenQDivergingBars');
    if(cOpenQBarsEl) refreshHTML(cOpenQBarsEl, mentions.map((m,i)=>{
      const iw=Math.max(2,Math.round(m.improve/maxM*100));
      const ww=Math.max(2,Math.round(m.well/maxM*100));
      const pm=prevMentionsMap[m.label];
      return`<div style="display:grid;grid-template-columns:1fr 150px 1fr;align-items:center;gap:8px;padding:5px 0">
        <div style="display:flex;justify-content:flex-end;align-items:center;gap:6px">${mentionDelta(m.improve,pm?.improve,'down')}<span style="font-size:.72rem;color:#dc2626;font-weight:700">${m.improve}</span><div class="divbar-imp" style="height:13px;width:0%;transition:width .6s var(--ease-lift)" data-w="${iw}%"></div></div>
        <div style="font-size:.72rem;text-align:center;color:var(--text2)">${m.label}</div>
        <div style="display:flex;align-items:center;gap:6px"><div class="divbar-well" style="height:13px;width:0%;transition:width .6s var(--ease-lift)" data-w="${ww}%"></div><span style="font-size:.72rem;color:#16a34a;font-weight:700">${m.well}</span>${mentionDelta(m.well,pm?.well,'up')}</div>
      </div>`;
    }).join(''), ()=>growBars(cOpenQBarsEl));
  }

  // ── "Other" custom topics ──
  const otherWell=calcOtherTopics(resp,'otherWell');
  const otherImprove=calcOtherTopics(resp,'otherImprove');
  const otherHtml=(list,col)=>list.length?list.slice(0,5).map(o=>`<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f8fafc"><span style="flex:1;font-size:.76rem;color:var(--text2);min-width:0;line-height:1.3">${o.topic}</span><span style="flex-shrink:0;white-space:nowrap;font-size:.68rem;font-weight:800;color:${col};background:${col}18;padding:2px 9px;border-radius:20px">${o.count}</span></div>`).join(''):'<p style="color:#94a3b8;font-size:.78rem">No additional topics.</p>';
  refreshHTML(document.getElementById('drOtherWell'), otherHtml(otherWell,'#16a34a'));
  refreshHTML(document.getElementById('drOtherImprove'), otherHtml(otherImprove,'#dc2626'));

  // Open feedback — renderOpenFeedbackByDept already respects THI.scopedDept
  renderOpenFeedbackByDept('openFeedbackListReport');

  document.getElementById('drDeptName').textContent=THI.scopedDept;
  const heroDeptEl=document.getElementById('drHeroDeptName');
  if(heroDeptEl) heroDeptEl.textContent=THI.scopedDept;
  document.getElementById('drFooterDate').textContent=new Date().toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
}

function updateFilterChipStates(){
  document.querySelector('.fc-dept')?.classList.toggle('chip-active', STATE.dept!=='all');
  document.querySelector('.fc-tenure')?.classList.toggle('chip-active', STATE.tenure!=='all');
  document.querySelector('.fc-city')?.classList.toggle('chip-active', STATE.city!=='all');
  document.querySelector('.fc-method')?.classList.toggle('chip-active', STATE.method!=='avg');
}
function renderAll(){const r=getFiltered();document.getElementById('topbarSub').textContent=`${THI.quarters[THI.activeQuarter]?.label||'—'} · ${r.length.toLocaleString()} Timmys`;renderOverview(r);renderTrend();renderDept();renderParticipation();renderFeedback(r);renderOpenFeedbackByDept();renderComparison(r);updateFilterChipStates()}

// ── OPEN FEEDBACK BY DEPARTMENT (from "Open Feedback" sheet) ─────────
const DEPT_PALETTE=[
  {bg:'#E6F1FB',fg:'#0C447C'},{bg:'#FAEEDA',fg:'#854F0B'},{bg:'#E1F5EE',fg:'#085041'},
  {bg:'#FAECE7',fg:'#712B13'},{bg:'#EEEDFE',fg:'#3C3489'},{bg:'#FBEAF0',fg:'#72243E'},
  {bg:'#EAF3DE',fg:'#27500A'},{bg:'#FCEBEB',fg:'#791F1F'},
];
function deptStyle(name){
  let h=0; for(let i=0;i<name.length;i++) h=(h*31+name.charCodeAt(i))>>>0;
  return DEPT_PALETTE[h%DEPT_PALETTE.length];
}
function deptIcon(name){
  const n=(name||'').toLowerCase();
  if(/engineer|tech|dev|it\b|app/.test(n)) return 'ti-code';
  if(/market|brand/.test(n)) return 'ti-speakerphone';
  if(/financ|account/.test(n)) return 'ti-report-money';
  if(/people|culture|hr\b/.test(n)) return 'ti-users';
  if(/commercial|sales|business/.test(n)) return 'ti-briefcase';
  if(/creativ|design|art|studio/.test(n)) return 'ti-palette';
  if(/event/.test(n)) return 'ti-calendar-event';
  if(/communicat|media|pr\b/.test(n)) return 'ti-message-circle';
  if(/strateg|corporate/.test(n)) return 'ti-target-arrow';
  if(/legal/.test(n)) return 'ti-scale';
  if(/operation|ops\b/.test(n)) return 'ti-settings';
  if(/creator|content/.test(n)) return 'ti-movie';
  return 'ti-building';
}
const FEEDBACK_STOPWORDS=new Set(['yang','untuk','dan','di','ke','dari','ini','itu','dengan','pada','akan','juga','atau','tidak','ada','lebih','agar','karena','bisa','dapat','perlu','masih','antara','sudah','saat','baik','serta','terkait','dalam','terutama','seperti','oleh','para','kami','tim','tim2','yaitu','maupun','sangat','cukup','harus','akan','adanya','menjadi','the','and','to','of','for','in','on','with','a','an','is','are','be','can','more','not','this','that','it','as','has','have','also','our','we','us','their','across','teams','team']);
function extractKeywords(texts,max=4){
  const freq={};
  texts.forEach(t=>{
    (t||'').toLowerCase().replace(/[^a-z\s]/g,' ').split(/\s+/).forEach(w=>{
      if(w.length<4||FEEDBACK_STOPWORDS.has(w)) return;
      freq[w]=(freq[w]||0)+1;
    });
  });
  return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,max).map(([w])=>w);
}
function renderOpenFeedbackByDept(containerId='openFeedbackList'){
  const container = document.getElementById(containerId);
  if(!container) return;
  const qLabel = THI.quarters[THI.activeQuarter]?.label;
  const all = (THI.openFeedback && THI.openFeedback[qLabel]) || [];
  let rows = all;
  if(THI.scopedDept) rows = rows.filter(r=>THI.getDeptGroup(r.dept)===THI.scopedDept);
  else if(STATE.dept!=='all') rows = rows.filter(r=>STATE.dept===MARKETING_COMBINED ? THI.getDeptGroup(r.dept)==='Marketing' : r.dept===STATE.dept);

  if(!rows.length){
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:36px 20px">
        <svg width="86" height="64" viewBox="0 0 86 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="3" y="3" width="52" height="38" rx="9" fill="#EEF1F6" stroke="#D7DCE6" stroke-width="1.5"/>
          <path d="M16 41L16 53L28 41" fill="#EEF1F6" stroke="#D7DCE6" stroke-width="1.5" stroke-linejoin="round"/>
          <circle cx="18" cy="21" r="2.5" fill="#B9C1D1"/><circle cx="29" cy="21" r="2.5" fill="#B9C1D1"/><circle cx="40" cy="21" r="2.5" fill="#B9C1D1"/>
          <rect x="33" y="18" width="50" height="36" rx="9" fill="#FCF3E3" stroke="#F4DDA8" stroke-width="1.5"/>
          <path d="M45 54L45 62L55 54" fill="#FCF3E3" stroke="#F4DDA8" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M46 33H70M46 40H62" stroke="#EBC873" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <p style="color:var(--text2);font-size:.85rem;font-weight:600;margin:16px 0 4px">No open feedback yet</p>
        <p style="color:#94a3b8;font-size:.78rem;max-width:260px">No open feedback data available for ${qLabel||'this quarter'}${STATE.dept!=='all'?` in the ${STATE.dept} department`:''}.</p>
      </div>`;
    return;
  }

  const bulletsHtml = list => list.length
    ? list.map(t=>`<li style="margin-bottom:6px">${t}</li>`).join('')
    : `<li style="color:#94a3b8;list-style:none;margin-left:-18px">No data</li>`;

  const openByDefault = STATE.dept!=='all';

  container.innerHTML = rows.map((r,i)=>{
    const isOpen = openByDefault||i===0;
    const style = deptStyle(r.dept);
    const icon = deptIcon(r.dept);
    const keywords = extractKeywords([...r.well,...r.improve]);
    return `
    <div class="ofb-card" style="background:#fff;border:1px solid var(--border2);border-radius:12px;overflow:hidden;margin-bottom:8px">
      <button class="ofb-toggle" style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border:none;background:transparent;cursor:pointer;text-align:left;gap:10px">
        <span style="display:flex;align-items:center;gap:10px;min-width:0">
          <span style="width:32px;height:32px;flex-shrink:0;border-radius:50%;background:${style.bg};display:flex;align-items:center;justify-content:center">
            <i class="ti ${icon}" style="font-size:1rem;color:${style.fg}"></i>
          </span>
          <span style="min-width:0">
            <span style="font-size:.85rem;font-weight:700;color:var(--text);display:block;text-shadow:0 1px 0 rgba(255,255,255,.85),0 2px 5px rgba(15,23,42,.16)">${r.dept}</span>
            ${keywords.length?`<span style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">${keywords.map(k=>`<span style="font-size:.62rem;font-weight:600;color:${style.fg};background:${style.bg};padding:2px 8px;border-radius:20px;text-transform:capitalize">${k}</span>`).join('')}</span>`:''}
          </span>
        </span>
        <i class="ti ti-chevron-down ofb-chev" style="font-size:1rem;color:#7a8aaa;flex-shrink:0;transition:transform .3s var(--ease-lift);${isOpen?'transform:rotate(180deg)':''}"></i>
      </button>
      <div class="ofb-body-wrap${isOpen?' open':''}">
        <div class="ofb-body" style="padding:0 16px;border-top:1px solid #f1f5f9">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:12px 0 16px">
            <div>
              <div style="font-size:.63rem;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Need Improvement</div>
              <ul style="margin:0;padding-left:18px;font-size:.78rem;color:var(--text2);line-height:1.6">${bulletsHtml(r.improve)}</ul>
            </div>
            <div>
              <div style="font-size:.63rem;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Did Well</div>
              <ul style="margin:0;padding-left:18px;font-size:.78rem;color:var(--text2);line-height:1.6">${bulletsHtml(r.well)}</ul>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.ofb-toggle').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const wrap=btn.parentElement.querySelector('.ofb-body-wrap');
      const chev=btn.querySelector('.ofb-chev');
      const open=wrap.classList.toggle('open');
      chev.style.transform=open?'rotate(180deg)':'rotate(0deg)';
    });
  });
}
const TAB_FILTERS = {
  overview:      ['quarter','method','dept','tenure','city','decimals'],
  participation: ['quarter','decimals'],
  department:    ['quarter','method','decimals'],
  comparison:    ['quarter','method','dept','tenure','city','decimals'],
  feedback:      ['quarter','dept','city'],
};
function updateFilterVisibility(tab){
  const visible = TAB_FILTERS[tab] || ['quarter','method','dept','tenure','city','decimals'];
  ['quarter','method','dept','tenure','city','decimals'].forEach(key=>{
    const el = document.querySelector(`.fc-${key}`);
    if(el) el.style.display = visible.includes(key) ? '' : 'none';
  });
}
function updateSidebarIndicator(tab){
  const nav = document.getElementById('sbNav');
  const ind = document.getElementById('sbIndicator');
  const item = nav?.querySelector(`.sb-item[data-tab="${tab}"]`);
  if(!nav || !ind || !item) return;
  ind.style.transform = `translateY(${item.offsetTop}px)`;
  ind.style.height = `${item.offsetHeight}px`;
  ind.classList.add('on');
}
function switchTab(n){
  STATE.activeTab=n;
  const oldPane = document.querySelector('.tab-pane.active');
  const newPane = document.getElementById(`tab-${n}`);
  document.querySelectorAll('.sb-item').forEach(b=>b.classList.toggle('active',b.dataset.tab===n));
  updateFilterVisibility(n);
  updateSidebarIndicator(n);

  function activateNewPane(){
    document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
    if(newPane) newPane.classList.add('active');
    requestAnimationFrame(()=>{
      Object.values(CH).forEach(c=>{if(c&&typeof c.resize==='function'){try{c.resize()}catch(e){}}});
      if(n==='department'&&!CH.dOv)renderDept();
    });
  }

  if(!oldPane || oldPane===newPane || !DASHBOARD_READY){
    activateNewPane();
    return;
  }
  oldPane.classList.add('fx-fade');
  void oldPane.offsetWidth;
  oldPane.style.opacity='0';
  setTimeout(()=>{
    oldPane.style.opacity='';
    oldPane.classList.remove('fx-fade');
    activateNewPane();
  }, 150); // matches --m3-dur-short
}

// ── INIT ──────────────────────────────────────────────────────────────
async function init(){
  try{
    // resolveAccessToken() sets THI.accessToken synchronously before its first await,
    // so it's safe to kick off data loading at the same time instead of waiting for
    // token resolution to fully round-trip first — cuts a full sequential Apps Script
    // call off the critical path.
    const [access] = await Promise.all([
      resolveAccessToken(),
      window.initDataLoader(),
    ]);
    if(access.error){
      document.getElementById('loadingState').style.display='none';
      document.getElementById('accessDenied').style.display='flex';
      return;
    }
    // "ALL" → regular admin (sees everything, standard dashboard).
    // "ALL:<Role Name>" → a special full-access role (Office Management, Culture &
    // Learning, ...) — same full data access as admin, but flagged separately so a
    // dedicated design can be swapped in for them without affecting regular admin
    // tokens or department-scoped tokens.
    const rawDept = access.department || '';
    if(rawDept.startsWith('ALL:')){
      THI.scopedDept = null;
      THI.specialRole = rawDept.slice(4).trim();
    }else if(rawDept==='ALL'){
      THI.scopedDept = null;
      THI.specialRole = null;
    }else{
      THI.scopedDept = rawDept;
      THI.specialRole = null;
    }

    if(THI.scopedDept){
      await initDeptReport();
    }else if(THI.specialRole){
      await initSpecialRole();
    }else{
      await initAdmin();
    }
  }catch(err){
    console.error(err);
    document.getElementById('loadingState').innerHTML=`<div style="text-align:center;max-width:440px;padding:40px"><i class="ti ti-alert-circle" style="font-size:2.5rem;color:#ef4444"></i><h2 style="margin:12px 0 8px;color:#ef4444">Could not load data</h2><p style="color:#94a3b8;font-size:.88rem;line-height:1.6">Make sure Google Sheets are set to <strong>"Anyone with the link can view"</strong>.<br><br><code style="background:#f1f5f9;padding:4px 8px;border-radius:4px;font-size:.78rem">${err.message}</code></p></div>`;
  }
}

async function initAdmin(){
  buildQuarterSelect();
  fillFilters(THI.quarters[THI.activeQuarter]?.respondents||[]);
  enhanceAllSelects();
  document.getElementById('filterMethod').addEventListener('change',e=>{STATE.method=e.target.value;renderAll()});
  document.getElementById('filterDept').addEventListener('change',e=>{STATE.dept=e.target.value;STATE.fbPage=1;renderAll()});
  document.getElementById('filterTenure').addEventListener('change',e=>{STATE.tenure=e.target.value;STATE.fbPage=1;renderAll()});
  document.getElementById('filterCity').addEventListener('change',e=>{STATE.city=e.target.value;STATE.fbPage=1;renderAll()});
  document.getElementById('decimalsToggle').addEventListener('click',()=>{STATE.decimals=!STATE.decimals;document.getElementById('decimalsToggle').classList.toggle('on',STATE.decimals);renderAll()});
  document.getElementById('btnReset').addEventListener('click',()=>{STATE.dept='all';STATE.tenure='all';STATE.city='all';STATE.method='avg';STATE.decimals=false;STATE.fbPage=1;STATE.fbSearch='';STATE.fbType='all';STATE.fbDept='all';STATE.fbTenure='all';['filterDept','filterTenure','filterCity','filterMethod','fbSearch','fbType','fbDept','fbTenure'].forEach(id=>{const el=document.getElementById(id);if(!el)return;if(el.tagName==='SELECT')el.value=el.querySelector('option').value;else el.value=''});document.getElementById('decimalsToggle').classList.remove('on');renderAll()});
  ['fbSearch','fbType','fbDept','fbTenure'].forEach(id=>{const el=document.getElementById(id);if(!el)return;el.addEventListener(id==='fbSearch'?'input':'change',e=>{STATE[id==='fbSearch'?'fbSearch':id==='fbType'?'fbType':id==='fbDept'?'fbDept':'fbTenure']=e.target.value;STATE.fbPage=1;renderFBList&&renderFBList(getFiltered())})});
  document.querySelectorAll('.sb-item').forEach(b=>b.addEventListener('click',()=>{switchTab(b.dataset.tab);if(window.innerWidth<=700)document.getElementById('sidebar').classList.remove('mobile-open')}));
  document.getElementById('sidebarToggle').addEventListener('click',()=>{const sb=document.getElementById('sidebar');const mw=document.getElementById('mainWrap');if(window.innerWidth<=700)sb.classList.toggle('mobile-open');else{sb.classList.toggle('collapsed');mw.classList.toggle('full')}});
  updateFilterVisibility(STATE.activeTab);
  updateSidebarIndicator(STATE.activeTab);
  document.getElementById('loadingState').style.display='none';
  document.getElementById('appContent').style.display='block';
  renderAll();
  DASHBOARD_READY=true;
}

async function initDeptReport(){
  STATE.dept=THI.scopedDept; // lock filtering to this department everywhere (getFiltered, Open Feedback, etc.)
  document.getElementById('sidebar').style.display='none';
  document.getElementById('mainWrap').style.display='none';

  const sel=document.getElementById('drFilterQuarter');
  THI.quarters.forEach((q,i)=>{const o=document.createElement('option');o.value=i;o.textContent=q.label;if(!q.sheetId)o.disabled=true;sel.appendChild(o)});
  sel.value=THI.activeQuarter.toString();
  sel.addEventListener('change',e=>{THI.activeQuarter=+e.target.value;populateDeptCityOptions();renderDeptReport()});

  populateDeptCityOptions();
  document.getElementById('drFilterCity').addEventListener('change',e=>{STATE.city=e.target.value;renderDeptReport()});
  document.getElementById('drFilterMethod').addEventListener('change',e=>{STATE.method=e.target.value;renderDeptReport()});
  document.getElementById('drDecimalsToggle').addEventListener('click',()=>{STATE.decimals=!STATE.decimals;document.getElementById('drDecimalsToggle').classList.toggle('on',STATE.decimals);renderDeptReport()});
  enhanceAllSelects();

  // Smoothly expand/collapse an accordion body by animating max-height (measured
  // from actual content, so it works regardless of how tall the section is) plus
  // a gentle opacity fade — replaces the old instant display:none/block toggle.
  const toggleDrSection=(toggle, body)=>{
    if(body._drAnimating) return;
    const isClosed = getComputedStyle(body).display==='none';
    if(isClosed){
      body._drAnimating=true;
      body.style.display='block';
      body.style.overflow='hidden';
      body.style.maxHeight='0px';
      body.style.opacity='0';
      body.style.transition='none';
      void body.offsetHeight;
      const target=body.scrollHeight;
      body.style.transition='max-height .6s cubic-bezier(.4,0,.2,1), opacity .45s ease .05s';
      requestAnimationFrame(()=>{ body.style.maxHeight=target+'px'; body.style.opacity='1'; });
      toggle.classList.add('open');
      body.addEventListener('transitionend', function h(e){
        if(e.propertyName!=='max-height') return;
        body.style.maxHeight='none'; body.style.overflow='visible'; body._drAnimating=false;
        body.removeEventListener('transitionend', h);
      });
    }else{
      body._drAnimating=true;
      const current=body.scrollHeight;
      body.style.overflow='hidden';
      body.style.transition='none';
      body.style.maxHeight=current+'px';
      void body.offsetHeight;
      body.style.transition='max-height .5s cubic-bezier(.4,0,.2,1), opacity .3s ease';
      requestAnimationFrame(()=>{ body.style.maxHeight='0px'; body.style.opacity='0'; });
      toggle.classList.remove('open');
      body.addEventListener('transitionend', function h(e){
        if(e.propertyName!=='max-height') return;
        body.style.display='none'; body._drAnimating=false;
        body.removeEventListener('transitionend', h);
      });
    }
  };
  const introToggle=document.getElementById('drIntroToggle'), introBody=document.getElementById('drIntroBody');
  if(introToggle && introBody){
    introToggle.addEventListener('click',()=>toggleDrSection(introToggle, introBody));
  }
  const methodToggle=document.getElementById('drMethodToggle'), methodBody=document.getElementById('drMethodBody');
  if(methodToggle && methodBody){
    methodToggle.addEventListener('click',()=>toggleDrSection(methodToggle, methodBody));
  }
  // Sidebar shortcut → id of the collapsible {toggle, body} pair it should auto-open, if any.
  const drSectionAccordions={
    drSectionIntro: (introToggle&&introBody) ? [introToggle, introBody] : null,
    drSectionMethod: (methodToggle&&methodBody) ? [methodToggle, methodBody] : null,
  };

  document.querySelectorAll('#drSidebar .sb-item[data-dr-anchor]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const anchorId=btn.dataset.drAnchor;
      const targetEl=document.getElementById(anchorId);
      if(targetEl) targetEl.scrollIntoView({behavior:'smooth', block:'start'});
      // Auto-open that section if it's currently collapsed — other sections are
      // left exactly as the user set them, so a manual "both open" state isn't
      // clobbered just because they clicked a nav shortcut.
      const pair=drSectionAccordions[anchorId];
      if(pair && getComputedStyle(pair[1]).display==='none') toggleDrSection(pair[0], pair[1]);
    });
  });
  // Highlight the sidebar shortcut matching whichever section is currently in view.
  const drAnchorBtns=[...document.querySelectorAll('#drSidebar .sb-item[data-dr-anchor]')];
  if(drAnchorBtns.length){
    const drAnchorObserver=new IntersectionObserver(entries=>{
      entries.forEach(entry=>{
        if(!entry.isIntersecting) return;
        drAnchorBtns.forEach(b=>b.classList.toggle('active', b.dataset.drAnchor===entry.target.id));
      });
    }, {rootMargin:'-20% 0px -70% 0px'});
    drAnchorBtns.forEach(b=>{
      const el=document.getElementById(b.dataset.drAnchor);
      if(el) drAnchorObserver.observe(el);
    });
  }

  // Fade + slide each section in the first time it scrolls into view.
  const drFadeEls=[...document.querySelectorAll('.dr-section-fade')];
  if(drFadeEls.length){
    const drFadeObserver=new IntersectionObserver(entries=>{
      entries.forEach(entry=>{
        if(entry.isIntersecting){
          entry.target.classList.add('dr-section-visible');
          drFadeObserver.unobserve(entry.target);
        }
      });
    }, {threshold:0.12});
    drFadeEls.forEach(el=>drFadeObserver.observe(el));
  }

  // Smoothly expand/collapse an accordion body by animating max-height (measured
  // from actual content, so it works regardless of how tall the section is) plus
  // a gentle opacity fade — replaces the old instant display:none/block toggle.

  document.getElementById('loadingState').style.display='none';
  document.getElementById('deptReportWrap').style.display='block';
  renderDeptReport();
  DASHBOARD_READY=true;
}
function populateDeptCityOptions(){
  const sel=document.getElementById('drFilterCity');
  if(!sel) return;
  const q=THI.quarters[THI.activeQuarter];
  const cities=[...new Set((q?.respondents||[]).filter(r=>r.deptGroup===THI.scopedDept).map(r=>r.city))].filter(Boolean).sort();
  const cur=sel.value;
  sel.innerHTML='<option value="all">All Locations</option>';
  cities.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;sel.appendChild(o)});
  sel.value=cities.includes(cur)?cur:'all';
  if(!cities.includes(cur)) STATE.city='all';
}

// ══════════════════════════════════════════════════════════════════════
// SPECIAL ROLE REPORT — Office Management / Culture & Learning, etc.
// Full data access (all depts, like admin) but its own per-area layout:
// every area's questions (Average Score + Population Distribution side by
// side), plus By Department / By Tenure / By Level breakdowns for each area.
// ══════════════════════════════════════════════════════════════════════
const TENURE_ORDER_SR=['< 6 months','6 months – 1 yr','1 – 2 years','2 – 3 years','3 – 4 years','4 – 5 years','> 5 years'];
const LEVEL_ORDER_SR=['Associate','Sr. Associate','Manager','Sr. Manager','Functional','Team Lead'];

function populateSpecialRoleCityOptions(){
  const sel=document.getElementById('srFilterCity');
  if(!sel) return;
  const q=THI.quarters[THI.activeQuarter];
  const cities=[...new Set((q?.respondents||[]).map(r=>r.city))].filter(Boolean).sort();
  const cur=sel.value;
  sel.innerHTML='<option value="all">All Locations</option>';
  cities.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;sel.appendChild(o)});
  sel.value=cities.includes(cur)?cur:'all';
  if(!cities.includes(cur)) STATE.city='all';
}

// Only these 2 areas are shown for the special-role report (Office Management,
// Culture & Learning) — both roles see the same two, laid out side by side.
const SPECIAL_ROLE_AREA_KEYS = ['ws', 'cu'];

// Highlights whichever sidebar shortcut matches the section currently in view.
// Re-created after every render (not just once at init) because renderSpecialRoleReport()
// replaces #srMain's entire innerHTML each time — the old section elements the
// observer was watching get destroyed, so a one-time setup would silently stop
// working after the very first filter change.
let srAnchorObserver = null;
function setupSrAnchorObserver(){
  if(srAnchorObserver) srAnchorObserver.disconnect();
  const btns=[...document.querySelectorAll('#srSidebar .sb-item[data-dr-anchor]')];
  if(!btns.length) return;
  srAnchorObserver=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(!entry.isIntersecting) return;
      btns.forEach(b=>b.classList.toggle('active', b.dataset.drAnchor===entry.target.id));
    });
  }, {rootMargin:'-20% 0px -70% 0px'});
  btns.forEach(b=>{
    const el=document.getElementById(b.dataset.drAnchor);
    if(el) srAnchorObserver.observe(el);
  });
}

function renderSpecialRoleReport(){
  const resp=getFiltered();
  const method=document.getElementById('srFilterMethod')?.value||'fav67';
  const areas = THI.AREAS.filter(a=>SPECIAL_ROLE_AREA_KEYS.includes(a.key));

  const prevQ = THI.activeQuarter>0 ? THI.quarters[THI.activeQuarter-1] : null;
  const prevResp = (prevQ?.loaded && prevQ.respondents?.length) ? getFilteredForQuarter(prevQ) : [];

  const currAll=THI.calcAreaScores(resp,method);
  const prevAll=prevResp.length ? THI.calcAreaScores(prevResp,method) : null;

  const deptCurr=calcGroupAreaScores(resp, r=>THI.getDeptGroup(r.dept), method);
  const deptPrev=prevResp.length ? calcGroupAreaScores(prevResp, r=>THI.getDeptGroup(r.dept), method) : [];
  const tenureCurr=calcGroupAreaScores(resp, r=>r.tenure, method);
  const tenurePrev=prevResp.length ? calcGroupAreaScores(prevResp, r=>r.tenure, method) : [];
  const levelCurr=calcGroupAreaScores(resp, r=>r.level, method);
  const levelPrev=prevResp.length ? calcGroupAreaScores(prevResp, r=>r.level, method) : [];

  // Pair up current/previous-quarter results by group label, in a stable order —
  // canonical tenure/level order, falling back to alphabetical for department.
  const pairGroups=(currList, prevList, order)=>{
    const prevMap=Object.fromEntries((prevList||[]).map(g=>[g.label,g]));
    const labels=[...new Set(currList.map(g=>g.label))];
    labels.sort((a,b)=> order ? (order.indexOf(a)-order.indexOf(b)) : a.localeCompare(b));
    return labels.map(label=>{
      const c=currList.find(g=>g.label===label);
      const p=prevMap[label];
      return {label, n:c.n, scores:c.scores, prevScores:p?p.scores:null};
    });
  };
  const deptPairs=pairGroups(deptCurr, deptPrev, null);
  const tenurePairs=pairGroups(tenureCurr, tenurePrev, TENURE_ORDER_SR);
  const levelPairs=pairGroups(levelCurr, levelPrev, LEVEL_ORDER_SR);

  // One score cell: progress bar (visual) + pill (number) + delta vs previous quarter.
  const deltaHtmlSR=(val,prevVal)=>{
    if(val===null||val===undefined||prevVal===null||prevVal===undefined) return `<span class="sr-delta na">No prev qtr</span>`;
    const d=val-prevVal;
    if(Math.abs(d)<0.05) return `<span class="sr-delta na">= 0pt</span>`;
    const up=d>0;
    return `<span class="sr-delta ${up?'up':'dn'}">${up?'▲':'▼'} ${dp(Math.abs(d))}pt</span>`;
  };
  const scoreCell=(val,prevVal)=>{
    const has = val!==null && val!==undefined;
    const barW = has ? Math.max(0,Math.min(100,val)) : 0;
    return `<div class="sr-score-cell">
      <div class="sr-score-bar"><div class="sr-score-bar-fill" style="width:0%" data-w="${barW}%"></div></div>
      <div class="sr-pill sr-pill-single">${has?pct(val):'—'}</div>
      ${deltaHtmlSR(val,prevVal)}
    </div>`;
  };

  // Small colored avatar shown before each row's name — reuses the exact same
  // dept color/icon system as "Open Feedback by Department" for departments;
  // for tenure/level, the same icon shifts through progressively darker shades
  // (and swaps to a "senior" icon partway through) to hint at seniority.
  const TENURE_SHADES=['#dbeafe','#bfdbfe','#93c5fd','#60a5fa','#3b82f6','#2563eb','#1d4ed8'];
  const LEVEL_SHADES=['#fdecd2','#fbe0b8','#f6d9a8','#f0c785','#e8b563','#dba13d'];
  const srAvatarHtml=(kind,label)=>{
    if(kind==='dept'){
      const style=deptStyle(label), icon=deptIcon(label);
      return `<div class="sr-row-avatar" style="background:${style.bg}"><i class="ti ${icon}" style="color:${style.fg}"></i></div>`;
    }
    if(kind==='tenure'){
      const idx=TENURE_ORDER_SR.indexOf(label);
      const shade=TENURE_SHADES[idx>=0?idx:0];
      return `<div class="sr-row-avatar" style="background:${shade}"><i class="ti ti-clock" style="color:${idx>=4?'#fff':'#1d4ed8'}"></i></div>`;
    }
    if(kind==='level'){
      const idx=LEVEL_ORDER_SR.indexOf(label);
      const shade=LEVEL_SHADES[idx>=0?idx:0];
      const icon=idx>=2?'ti-user-star':'ti-user';
      return `<div class="sr-row-avatar" style="background:${shade}"><i class="ti ${icon}" style="color:${idx>=4?'#fff':'#c97a00'}"></i></div>`;
    }
    return '';
  };

  const breakdownCol=(pairs,key,kind)=>{
    if(!pairs.length) return `<div class="sr-bd-na">No data</div>`;
    // Highest score first, specific to THIS area's value — so Culture and Workplace
    // Support can (and often will) show departments/tenure/levels in a different
    // order, since each column ranks by its own score, not a shared fixed order.
    const sorted=[...pairs].sort((a,b)=>{
      const av=a.scores?.[key], bv=b.scores?.[key];
      const aOk=av!==null&&av!==undefined, bOk=bv!==null&&bv!==undefined;
      if(!aOk&&!bOk) return 0;
      if(!aOk) return 1;   // no-data rows sink to the bottom
      if(!bOk) return -1;
      return bv-av;
    });
    return sorted.map(g=>`<div class="sr-bd-row">${srAvatarHtml(kind,g.label)}<span class="sr-bd-label">${g.label}</span>${scoreCell(g.scores?.[key], g.prevScores?.[key])}</div>`).join('');
  };

  // Header (badge + title) for one area — rendered once per column, above the shared grid.
  const areaHeader=(area)=>`<div class="dr-section-header-static" style="margin-bottom:10px">
      <div class="dr-section-badge-wrap" style="width:44px;height:44px">
        <div class="dr-section-badge-ring"></div>
        <div class="dr-section-badge" style="width:44px;height:44px;font-size:.9rem"><i class="ti ${ICONS[area.key]||'ti-chart-bar'}"></i></div>
      </div>
      <div class="dr-section-header-text" style="margin-left:12px;padding-left:12px">
        <div class="dr-section-title" style="font-size:.88rem">${area.label}</div>
        <div class="dr-section-sub">${area.items.length} questions</div>
      </div>
    </div>`;

  // One area's question rows and its Overall row, kept SEPARATE (not one flat
  // array) — the question rows get padded to equal length first, and the two
  // Overall rows are appended only after that, so "Overall" always lands on the
  // same final grid row for both columns regardless of how many questions each
  // area has. (Padding a single combined list at the end, like before, made the
  // shorter area's Overall row float up next to the longer area's last question.)
  const areaRows=(area)=>{
    const qRows=area.items.map(idx=>{
      const label=(THI.QUESTION_LABELS&&THI.QUESTION_LABELS[idx])||`Question ${idx+1}`;
      const val=scoreForQuestion(resp, idx+1, method);
      const prevVal=prevResp.length ? scoreForQuestion(prevResp, idx+1, method) : null;
      return `<div class="sr-q-row"><div class="sr-q-text">${idx+1}. ${label}</div>${scoreCell(val,prevVal)}</div>`;
    });
    const overall=`<div class="sr-q-row sr-overall-row"><div class="sr-q-text">Overall — ${area.label}</div>${scoreCell(currAll[area.key], prevAll?prevAll[area.key]:null)}</div>`;
    return {qRows, overall};
  };

  const areaA=areaRows(areas[0]);
  const areaB=areas[1] ? areaRows(areas[1]) : {qRows:[], overall:''};
  const maxQRows=Math.max(areaA.qRows.length, areaB.qRows.length);
  let gridRowsHtml='';
  for(let i=0;i<maxQRows;i++) gridRowsHtml += (areaA.qRows[i]||'<div class="sr-q-row-empty"></div>') + (areaB.qRows[i]||'<div class="sr-q-row-empty"></div>');
  gridRowsHtml += areaA.overall + (areaB.overall || '<div class="sr-q-row-empty"></div>');

  // Each breakdown type (Dept/Tenure/Level) is its own card now — the title lives
  // inside the card (icon + label), both areas side by side underneath it.
  const breakdownCard=(id,icon,title,pairs,kind)=>`
    <div class="card sr-block-card" id="${id}">
      <div class="sr-block-title"><i class="ti ${icon}"></i> ${title}</div>
      <div class="sr-breakdown-grid">
        ${areas.map(area=>`<div><div class="sr-bd-col-title">${area.label}</div>${breakdownCol(pairs,area.key,kind)}</div>`).join('')}
      </div>
    </div>`;

  // Curated Open Feedback — read from THI.srFeedback (loaded from the "SR
  // Feedback" Google Sheet, see data-loader.js loadSRFeedback()). NOT computed
  // live from keyword-matching against raw text — each quarter's Q45/Q46
  // answers are read and manually curated (topic classification, grammar
  // cleanup, translation to English, and removal of any personal names)
  // once that quarter's data is final, then added as rows to the sheet.
  // Adding a new quarter, or a new location breakdown, is just adding rows
  // to that sheet — no code change or redeploy needed.
  const q = THI.quarters[THI.activeQuarter];
  const srForQuarter = THI.srFeedback?.[q?.label] || {};
  // Structure: Jakarta (IDN HQ) and Surabaya each get their own curated
  // breakdown; every other city (Jogja, Palangkaraya, etc.) falls back to a
  // single combined "Regional" bucket — none of those individually has
  // enough responses yet for its own reliable summary. "All" is the default
  // when no location filter is applied.
  let srLocationKey = 'All', srFallbackNote = '';
  if(STATE.city!=='all'){
    if(srForQuarter[STATE.city]){
      srLocationKey = STATE.city;
    }else if(srForQuarter['REGIONAL']){
      srLocationKey = 'REGIONAL';
      srFallbackNote = `<strong>${STATE.city}</strong> doesn't have enough responses yet for its own breakdown — showing the combined Regional summary instead.`;
    }else{
      srLocationKey = 'All';
      srFallbackNote = `<strong>${STATE.city}</strong> doesn't have enough responses yet for its own breakdown — showing the all-locations summary instead.`;
    }
  }
  const curatedForQuarter = srForQuarter[srLocationKey];

  const srListOrEmpty=(list)=>(list&&list.length)
    ? list.map(t=>`<li>${t}</li>`).join('')
    : `<li class="sr-fb-empty">Not curated for this quarter/location yet.</li>`;
  // Split into 3 separate stacked grids (title, keywords, well, improve) instead
  // of one block per area — each grid auto-sizes its row to the taller of the
  // two columns, so "What we need to improve" always starts at the same Y
  // position on both sides, no matter how long "What we did well" runs.
  const feedbackTitleCol=(area)=>`<div class="sr-bd-col-title">${area.label}</div>`;
  const feedbackKeywordsCol=(area)=>{
    const fb = curatedForQuarter?.[area.key];
    return fb?.keywords?.length ? `<div class="sr-fb-keywords">${fb.keywords.map(k=>`<span class="sr-fb-kw">${k}</span>`).join('')}</div>` : `<div></div>`;
  };
  const feedbackWellCol=(area)=>{
    const fb = curatedForQuarter?.[area.key];
    return `<div class="sr-fb-block">
      <div class="sr-fb-block-title sr-fb-good">What we did well</div>
      <ul class="sr-fb-list">${srListOrEmpty(fb?.well)}</ul>
    </div>`;
  };
  const feedbackImproveCol=(area)=>{
    const fb = curatedForQuarter?.[area.key];
    return `<div class="sr-fb-block">
      <div class="sr-fb-block-title sr-fb-bad">What we need to improve</div>
      <ul class="sr-fb-list">${srListOrEmpty(fb?.improve)}</ul>
    </div>`;
  };

  const html=`
    <div class="card sr-methodology-card">
      <div class="sr-methodology-panels">
        <div class="sr-method-box sr-method-box-avg">
          <svg class="sr-method-illus" viewBox="0 0 100 100" aria-hidden="true">
            <rect x="15" y="10" width="70" height="85" rx="8" fill="none" stroke="#1d4ed8" stroke-width="4"/>
            <rect x="25" y="20" width="50" height="16" rx="2" fill="#1d4ed8"/>
            <circle cx="32" cy="50" r="5" fill="#1d4ed8"/><circle cx="50" cy="50" r="5" fill="#1d4ed8"/><circle cx="68" cy="50" r="5" fill="#1d4ed8"/>
            <circle cx="32" cy="65" r="5" fill="#1d4ed8"/><circle cx="50" cy="65" r="5" fill="#1d4ed8"/><circle cx="68" cy="65" r="5" fill="#1d4ed8"/>
            <circle cx="32" cy="80" r="5" fill="#1d4ed8"/><circle cx="50" cy="80" r="5" fill="#1d4ed8"/><circle cx="68" cy="80" r="5" fill="#1d4ed8"/>
          </svg>
          <div class="sr-method-icon"><i class="ti ti-calculator"></i></div>
          <div class="sr-method-name">Average Score Method</div>
          <div class="sr-method-desc">Among 100 Timmy responded to the survey on this particular item, the score will be average of actual score (1,2 …7) divided by target score (7).</div>
        </div>
        <div class="sr-method-divider">
          <svg viewBox="0 0 150 200" preserveAspectRatio="none" aria-hidden="true">
            <circle cx="20" cy="30" r="2" fill="#FCA311" opacity=".5"/>
            <circle cx="130" cy="170" r="2" fill="#FCA311" opacity=".5"/>
            <path d="M15 160 q10 -8 20 0" stroke="#8B5CF6" stroke-width="1.5" fill="none" opacity=".4"/>
            <path d="M115 40 q10 8 20 0" stroke="#8B5CF6" stroke-width="1.5" fill="none" opacity=".4"/>
          </svg>
          <div class="sr-method-divider-text">Differences in<br><strong>Scoring<br>Methodology</strong></div>
        </div>
        <div class="sr-method-box sr-method-box-pop">
          <svg class="sr-method-illus" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="40" fill="none" stroke="#c97a00" stroke-width="4"/>
            <path d="M50 10 A40 40 0 0 1 88 60 L50 50 Z" fill="#c97a00"/>
            <path d="M50 50 L88 60 A40 40 0 0 1 62 88 Z" fill="#c97a00" opacity=".6"/>
          </svg>
          <div class="sr-method-icon"><i class="ti ti-chart-donut"></i></div>
          <div class="sr-method-name">Population Distribution Method</div>
          <div class="sr-method-desc">The score refers to % population who provide rating 5, 6 and 7.</div>
        </div>
      </div>
    </div>

    <div class="card sr-block-card" id="srAreas">
      <div class="sr-block-title"><i class="ti ti-list-details"></i> Questions</div>
      <div class="sr-areas-headers-grid">${areas.map(areaHeader).join('')}</div>
      <div class="sr-areas-headrow-grid">
        <div class="sr-q-head"><div class="sr-q-text">Question</div><div class="sr-score-head">Score</div></div>
        <div class="sr-q-head"><div class="sr-q-text">Question</div><div class="sr-score-head">Score</div></div>
      </div>
      <div class="sr-areas-rows-grid">${gridRowsHtml}</div>
    </div>

    ${breakdownCard('srByDept','ti-building-community','By Department', deptPairs,'dept')}
    ${breakdownCard('srByTenure','ti-clock','By Tenure', tenurePairs,'tenure')}
    ${breakdownCard('srByLevel','ti-stairs-up','By Level', levelPairs,'level')}

    <div class="card sr-block-card" id="srOpenFeedback">
      <div class="sr-block-title"><i class="ti ti-message-circle"></i> Open Feedback</div>
      <div class="sr-fb-note"><i class="ti ti-sparkles"></i> A manually-curated summary of this quarter's actual Question 45/46 responses — grammar cleaned up, translated to English, and any personal names removed.${
        srFallbackNote ? ` ${srFallbackNote}` : (STATE.city!=='all' ? ` Showing the <strong>${STATE.city}</strong>-specific summary.` : '')
      }</div>
      <div class="sr-breakdown-grid">${areas.map(feedbackTitleCol).join('')}</div>
      <div class="sr-breakdown-grid">${areas.map(feedbackKeywordsCol).join('')}</div>
      <div class="sr-breakdown-grid">${areas.map(feedbackWellCol).join('')}</div>
      <div class="sr-breakdown-grid">${areas.map(feedbackImproveCol).join('')}</div>
    </div>`;

  const srMainEl = document.getElementById('srMain');
  // Slower, calmer fade (matches the dept report's Section C pace) + a short
  // delay before the bars start growing, so the two animations don't fight —
  // the content settles into view first, then the bars fill in right after.
  refreshHTML(srMainEl, html, ()=>{ setTimeout(()=>growBars(srMainEl), 90); setupSrAnchorObserver(); }, 320);
}

async function initSpecialRole(){
  document.getElementById('sidebar').style.display='none';
  document.getElementById('mainWrap').style.display='none';
  document.getElementById('deptReportWrap').style.display='none';

  const nameEl=document.getElementById('srBrandName');
  if(nameEl) nameEl.textContent=THI.specialRole;
  const roleEl=document.getElementById('srRoleName');
  if(roleEl) roleEl.textContent=THI.specialRole;
  document.title=`${THI.specialRole} · Timmy Happiness Index`;

  // Sidebar nav — one shortcut per section (the 2 areas, then each breakdown group).
  const nav=document.getElementById('srSidebarNav');
  const navItems=[
    {id:'srAreas', icon:'ti-list-details', label:'Questions'},
    {id:'srByDept', icon:'ti-building-community', label:'By Department'},
    {id:'srByTenure', icon:'ti-clock', label:'By Tenure'},
    {id:'srByLevel', icon:'ti-stairs-up', label:'By Level'},
    {id:'srOpenFeedback', icon:'ti-message-circle', label:'Open Feedback'},
  ];
  navItems.forEach(item=>{
    const btn=document.createElement('button');
    btn.className='sb-item';
    btn.dataset.drAnchor=item.id;
    btn.innerHTML=`<i class="ti ${item.icon}"></i><span>${item.label}</span>`;
    nav.appendChild(btn);
  });
  document.querySelectorAll('#srSidebar .sb-item[data-dr-anchor]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const el=document.getElementById(btn.dataset.drAnchor);
      if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
    });
  });

  const sel=document.getElementById('srFilterQuarter');
  THI.quarters.forEach((q,i)=>{const o=document.createElement('option');o.value=i;o.textContent=q.label;if(!q.sheetId)o.disabled=true;sel.appendChild(o)});
  sel.value=THI.activeQuarter.toString();
  sel.addEventListener('change',e=>{THI.activeQuarter=+e.target.value;populateSpecialRoleCityOptions();renderSpecialRoleReport()});

  populateSpecialRoleCityOptions();
  document.getElementById('srFilterCity').addEventListener('change',e=>{STATE.city=e.target.value;renderSpecialRoleReport()});
  document.getElementById('srFilterMethod').addEventListener('change',renderSpecialRoleReport);
  document.getElementById('srDecimalsToggle').addEventListener('click',()=>{STATE.decimals=!STATE.decimals;document.getElementById('srDecimalsToggle').classList.toggle('on',STATE.decimals);renderSpecialRoleReport()});
  enhanceAllSelects();

  document.getElementById('loadingState').style.display='none';
  document.getElementById('specialRoleWrap').style.display='block';
  renderSpecialRoleReport();
  DASHBOARD_READY=true;
}

// ══════════════════════════════════════════════════════════════════════
// AMBIENT SOUND WIDGET — hidden YouTube IFrame player (official embed API,
// not a ripped/downloaded audio file) used purely as a background loop.
// ══════════════════════════════════════════════════════════════════════
const AMBIENT_VIDEO_ID = '1Q3s6zlpEeg';
let ambientPlayer = null;
let ambientReady = false;
let ambientWasPlayingBeforeHide = false;

function loadYouTubeAPI(cb){
  if(window.YT && window.YT.Player){ cb(); return; }
  if(window._ambientApiLoading){ window._ambientApiCallbacks.push(cb); return; }
  window._ambientApiLoading = true;
  window._ambientApiCallbacks = [cb];
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
  window.onYouTubeIframeAPIReady = ()=>{ window._ambientApiCallbacks.forEach(f=>f()); };
}

function initAmbientSound(){
  const btn = document.getElementById('ambientBtn');
  const sub = document.getElementById('ambientSub');
  if(!btn) return;

  function setPlayingUI(isPlaying){
    btn.classList.toggle('playing', isPlaying);
    sub.textContent = isPlaying ? 'Now playing' : 'Click to play';
  }

  function createPlayer(){
    loadYouTubeAPI(()=>{
      ambientPlayer = new YT.Player('ambientPlayerHost', {
        height:'1', width:'1', videoId: AMBIENT_VIDEO_ID,
        playerVars:{ autoplay:1, loop:1, playlist:AMBIENT_VIDEO_ID, controls:0, disablekb:1 },
        events:{
          onReady:()=>{ ambientReady = true; ambientPlayer.playVideo(); },
          onStateChange:(e)=>{
            if(e.data===YT.PlayerState.PLAYING) setPlayingUI(true);
            else if(e.data===YT.PlayerState.PAUSED||e.data===YT.PlayerState.ENDED) setPlayingUI(false);
          }
        }
      });
    });
  }

  btn.addEventListener('click', ()=>{
    if(!ambientPlayer){ createPlayer(); return; }
    if(!ambientReady) return;
    if(ambientPlayer.getPlayerState()===YT.PlayerState.PLAYING) ambientPlayer.pauseVideo();
    else ambientPlayer.playVideo();
  });

  document.addEventListener('visibilitychange', ()=>{
    if(!ambientPlayer || !ambientReady) return;
    if(document.hidden){
      ambientWasPlayingBeforeHide = ambientPlayer.getPlayerState()===YT.PlayerState.PLAYING;
      if(ambientWasPlayingBeforeHide) ambientPlayer.pauseVideo();
    }else{
      if(ambientWasPlayingBeforeHide) ambientPlayer.playVideo();
    }
  });
}

document.addEventListener('DOMContentLoaded', initAmbientSound);
document.addEventListener('DOMContentLoaded',init);
