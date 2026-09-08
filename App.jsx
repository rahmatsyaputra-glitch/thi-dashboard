import ReactDOM from 'react-dom';
import Papa from 'papaparse';
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, PieChart, Pie, LabelList,
} from 'recharts';
import {
  fetchAllSheets, buildEmpMap, parseTime, processAttendance,
  buildDeptStats, buildMonthlyStats, buildCIDistribution,
  buildDailyStats, buildEmployeeDailyData, buildAllTimeStats, SHEET_IDS,
  DEFAULT_HOLIDAYS, getWorkdaysInMonth,
} from './dataService';
import { subDays, startOfYear, format } from 'date-fns';
import './index.css';

// ─── Error Boundary — catches runtime crashes, shows fallback instead of blank ──
class ErrorBoundary extends React.Component {
  constructor(props){super(props);this.state={hasError:false,error:null};}
  static getDerivedStateFromError(e){return{hasError:true,error:e};}
  componentDidCatch(e,info){console.error('Dashboard error:',e,info);}
  render(){
    if(this.state.hasError) return(
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
        height:'100vh',gap:16,padding:32,fontFamily:"'Plus Jakarta Sans',sans-serif",background:'#F5F2E9'}}>
        <div style={{width:64,height:64,borderRadius:20,background:'#FEE2E2',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="#EF4444"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        </div>
        <p style={{fontSize:20,fontWeight:800,color:'#1A1A1A',margin:0}}>Something went wrong</p>
        <p style={{fontSize:13,color:'#7A7A7A',textAlign:'center',maxWidth:400,lineHeight:1.7,margin:0}}>
          {this.state.error?.message||'Unexpected error'}
        </p>
        <button onClick={()=>window.location.reload()}
          style={{padding:'10px 24px',borderRadius:12,border:'none',
            background:'linear-gradient(135deg,#F4C430,#FFD700)',
            color:'#1A1A1A',fontWeight:700,fontSize:13,cursor:'pointer',
            fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
          Reload Dashboard
        </button>
      </div>
    );
    return this.props.children;
  }
}

// ─── Leave type master config ────────────────────────────────────────────────
// rawCode must match exactly what's in Col H of the Leave Sheet
const LEAVE_CONFIG = [
  { code:'ANL',   type:'annual', label:'Annual Leave',         labelShort:'ANL',  quota:16,  color:'#6366F1', bg:'rgba(99,102,241,.1)',   icon:'leave' },
  { code:'SL',    type:'sick',   label:'Sick Leave',           labelShort:'SL',   quota:12,  color:'#EF4444', bg:'rgba(239,68,68,.1)',    icon:'leave' },
  { code:'IBDH',  type:'ibdh',   label:'Cuti Ibadah',          labelShort:'IBDH', quota:45,  color:'#8B5CF6', bg:'rgba(139,92,246,.1)',   icon:'leave' },
  { code:'MATL',  type:'matl',   label:'Cuti Melahirkan',      labelShort:'MATL', quota:45,  color:'#EC4899', bg:'rgba(236,72,153,.1)',   icon:'leave' },
  { code:'C01',   type:'c01',    label:'Cuti Menikah',         labelShort:'C01',  quota:3,   color:'#F59E0B', bg:'rgba(245,158,11,.1)',   icon:'leave' },
  { code:'C02',   type:'c02',    label:'Menikahkan Anak',      labelShort:'C02',  quota:2,   color:'#F97316', bg:'rgba(249,115,22,.1)',   icon:'leave' },
  { code:'C04',   type:'c04',    label:'Khitan/Baptis Anak',   labelShort:'C04',  quota:2,   color:'#14B8A6', bg:'rgba(20,184,166,.1)',   icon:'leave' },
  { code:'C05',   type:'c05',    label:'Istri Melahirkan',     labelShort:'C05',  quota:2,   color:'#06B6D4', bg:'rgba(6,182,212,.1)',    icon:'leave' },
  { code:'C06',   type:'c06',    label:'Keluarga Meninggal',   labelShort:'C06',  quota:1,   color:'#64748B', bg:'rgba(100,116,139,.1)',  icon:'leave' },
  { code:'C07',   type:'c07',    label:'Kerabat Meninggal',    labelShort:'C07',  quota:1,   color:'#94A3B8', bg:'rgba(148,163,184,.1)',  icon:'leave' },
  { code:'HAID',  type:'haid',   label:'Cuti Haid',            labelShort:'HAID', quota:2,   color:'#F43F5E', bg:'rgba(244,63,94,.1)',    icon:'leave' },
  { code:'Unpaid',type:'unpaid', label:'Unpaid Leave',         labelShort:'Unpaid',quota:null,color:'#6B7280',bg:'rgba(107,114,128,.1)',  icon:'leave' },
];
const LEAVE_BY_CODE = Object.fromEntries(LEAVE_CONFIG.map(l=>[l.code,l]));
const LEAVE_BY_TYPE = Object.fromEntries(LEAVE_CONFIG.map(l=>[l.type,l]));


const D = {
  card:'#FFFFFF', cardDark:'#1A1A1A', glass:'rgba(255,255,255,.72)',
  gold:'#F4C430', gold2:'#FFD700', goldDk:'#B8860B', goldBg:'rgba(244,196,48,.12)',
  g:'#22C55E', g2:'#4ADE80', gBg:'rgba(34,197,94,.1)', gDk:'#15803D',
  r:'#EF4444', r2:'#FCA5A5', rBg:'rgba(239,68,68,.1)',
  b:'#6366F1', b2:'#818CF8', bBg:'rgba(99,102,241,.1)',
  am:'#F59E0B', amBg:'rgba(245,158,11,.1)',
  sb:'#111111', sbText:'#6B6B6B', sbATxt:'#F4C430', sbAct:'rgba(244,196,48,.12)',
  tx:'#1A1A1A', tx2:'#3D3D3D', mu:'#7A7A7A', mu2:'#AAAAAA',
  br:'rgba(0,0,0,.07)', brLt:'rgba(0,0,0,.04)',
  sh:'0 2px 8px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04)',
  shMd:'0 8px 32px rgba(0,0,0,.08),0 2px 8px rgba(0,0,0,.04)',
  shLg:'0 20px 60px rgba(0,0,0,.10)',
  shGold:'0 4px 20px rgba(244,196,48,.25)',
};
const Q={all:[0,1,2,3,4,5,6,7,8,9,10,11],Q1:[0,1,2],Q2:[3,4,5],Q3:[6,7,8],Q4:[9,10,11]};
const MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
const m2t=m=>m!=null?`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`:'--:--';
const showTime=(str,mins)=>{if(str&&str.trim()&&str.trim()!=='null') return str.trim(); if(mins!=null&&!isNaN(mins)) return m2t(mins); return null;};
const safe=(n,dec=1)=>isNaN(n)||n==null?'0':(dec===0?Math.round(n).toString():n.toFixed(dec));

// ─── SVG Icons ────────────────────────────────────────────────────────────────
const Icon=({name,size=16,color='currentColor'})=>{
  const p={
    overview:'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
    departments:'M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4v-9h2v9zm4 8H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V7h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2v-2h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z',
    checkin:'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z',
    leave:'M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z',
    employees:'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
    datasource:'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
    settings:'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
    refresh:'M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
    upload:'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
    close:'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    check:'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d={p[name]||p.overview}/></svg>;
};

// ─── Primitives ───────────────────────────────────────────────────────────────
const sel={fontSize:12,padding:'7px 12px',borderRadius:12,border:`1px solid ${D.br}`,background:D.card,color:D.tx,cursor:'pointer',outline:'none',fontFamily:'Plus Jakarta Sans,sans-serif',fontWeight:500};

// ─── localStorage helpers (defined early — used by KPI editable labels) ────────
const LS = {
  get: (key, fallback=null) => {
    try { const v=localStorage.getItem(key); return v!=null?JSON.parse(v):fallback; }
    catch { return fallback; }
  },
  set: (key, val) => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch(e){
      if(e.name==='QuotaExceededError'||e.code===22) console.warn('localStorage full:',key);
    }
  },
  remove: (key) => { try { localStorage.removeItem(key); } catch{} },
};

// Glass card
const Card=({children,style={}})=>(
  <div className="card fade-in" style={style}>{children}</div>
);

// Dark card (glassmorphism dark variant)
const DarkCard=({children,style={}})=>(
  <div className="card-dark fade-in" style={{padding:'22px 24px',...style}}>{children}</div>
);

const Sec=({children,sub,action,editable=false})=>{
  const[editing,setEditing]=useState(false);
  const[title,setTitle]=useState(null); // null = use children
  const display = title ?? (typeof children==='string'?children:'');
  if(editable) return(
    <div style={{marginBottom:14,display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
      <div style={{flex:1,minWidth:0}}>
        {editing
          ? <input autoFocus value={display} onChange={e=>setTitle(e.target.value)}
              onBlur={()=>setEditing(false)} onKeyDown={e=>e.key==='Enter'&&setEditing(false)}
              style={{fontSize:11,fontWeight:700,color:D.tx,background:'transparent',border:'none',
                borderBottom:`2px solid ${D.gold}`,outline:'none',width:'100%',fontFamily:'Plus Jakarta Sans,sans-serif',
                padding:'1px 0',letterSpacing:'1px',textTransform:'uppercase'}}/>
          : <h3 onClick={()=>setEditing(true)} title="Click to edit title"
              style={{fontSize:11,fontWeight:700,color:D.mu,textTransform:'uppercase',letterSpacing:'1px',
                margin:0,cursor:'text',display:'flex',alignItems:'center',gap:5}}>
              {display}
              <span style={{fontSize:9,opacity:.4,fontWeight:400,textTransform:'none',letterSpacing:0}}>✎</span>
            </h3>
        }
        {sub&&<p style={{fontSize:10,color:D.mu2,margin:'3px 0 0',lineHeight:1.5}}>{sub}</p>}
      </div>
      {action}
    </div>
  );
  return(
    <div style={{marginBottom:14,display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
      <div>
        <h3 style={{fontSize:11,fontWeight:700,color:D.mu,textTransform:'uppercase',letterSpacing:'1px',margin:0}}>{children}</h3>
        {sub&&<p style={{fontSize:10,color:D.mu2,margin:'3px 0 0',lineHeight:1.5}}>{sub}</p>}
      </div>
      {action}
    </div>
  );
};

// Reusable editable label for KPI cards (used standalone when card is custom-built)
function SidebarEditableText({storageKey,defaultLabel,textStyle={}}){
  const[val,setVal]=useState(()=>LS.get(storageKey,defaultLabel));
  const[editing,setEditing]=useState(false);
  const save=v=>{const t=v||defaultLabel;setVal(t);LS.set(storageKey,t);setEditing(false);};
  if(editing) return(
    <input autoFocus value={val} onChange={e=>setVal(e.target.value)}
      onBlur={e=>save(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')save(val);if(e.key==='Escape'){setVal(LS.get(storageKey,defaultLabel));setEditing(false);}}}
      style={{...textStyle,border:'none',borderBottom:`1px solid ${D.gold}`,outline:'none',background:'transparent',width:'100%',padding:'1px 0'}}/>
  );
  return <span onClick={()=>setEditing(true)} title="Click to edit" style={{...textStyle,cursor:'text',display:'block'}}>{val}</span>;
}

const EditableKPILabel=({storageKey,defaultLabel,accent=D.gold})=>{
  const[editing,setEditing]=useState(false);
  const[val,setVal]=useState(()=>LS.get(storageKey,defaultLabel));
  const inputRef=useRef();
  useEffect(()=>{if(editing)inputRef.current?.select();},[editing]);
  const save=()=>{LS.set(storageKey,val);setEditing(false);};
  if(editing) return(
    <input ref={inputRef} value={val}
      onChange={e=>setVal(e.target.value)}
      onBlur={save} onKeyDown={e=>{if(e.key==='Enter')save();if(e.key==='Escape'){setVal(LS.get(storageKey,defaultLabel));setEditing(false);}}}
      style={{fontSize:9,fontWeight:700,color:D.tx,background:'transparent',border:'none',
        borderBottom:`2px solid ${accent}`,outline:'none',width:'100%',
        fontFamily:'Plus Jakarta Sans,sans-serif',padding:'1px 0',
        letterSpacing:'.8px',textTransform:'uppercase'}}/>
  );
  return(
    <p onClick={()=>setEditing(true)} title="Click to rename"
      style={{fontSize:9,fontWeight:700,color:D.mu,textTransform:'uppercase',
        letterSpacing:'.8px',margin:0,lineHeight:1.3,cursor:'text',
        display:'flex',alignItems:'center',gap:3}}>
      {val}<span style={{fontSize:7,opacity:.35,fontWeight:400,textTransform:'none',letterSpacing:0}}>✎</span>
    </p>
  );
};

// KPI Card — premium glassmorphism style, label editable (persisted to localStorage)
const KPI=({icon,label,labelKey,value,valueSuffix,sub,subColor,accent=D.gold,light='rgba(244,196,48,.1)',iconColor,progress,bigNum=false})=>{
  const storageKey=`kpi.label.${labelKey||label}`;
  const[editing,setEditing]=useState(false);
  const[displayLabel,setDisplayLabel]=useState(()=>LS.get(storageKey,label));
  const inputRef=useRef();
  useEffect(()=>{if(editing)inputRef.current?.select();},[editing]);
  const save=()=>{LS.set(storageKey,displayLabel);setEditing(false);};
  return(
  <div className="card fade-in" style={{position:'relative',overflow:'hidden',display:'flex',flexDirection:'column',padding:'10px 12px'}}>
    <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,${accent},${accent}88)`,borderRadius:'24px 24px 0 0'}}/>
    <div style={{marginTop:4,display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:6,flex:1}}>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column'}}>
        <div style={{height:24,display:'flex',alignItems:'flex-start'}}>
          {editing
            ? <input ref={inputRef} value={displayLabel}
                onChange={e=>setDisplayLabel(e.target.value)}
                onBlur={save} onKeyDown={e=>{if(e.key==='Enter')save();if(e.key==='Escape'){setDisplayLabel(LS.get(storageKey,label));setEditing(false);}}}
                style={{fontSize:9,fontWeight:700,color:D.tx,background:'transparent',border:'none',
                  borderBottom:`2px solid ${accent}`,outline:'none',width:'100%',
                  fontFamily:'Plus Jakarta Sans,sans-serif',padding:'1px 0',
                  letterSpacing:'.8px',textTransform:'uppercase'}}/>
            : <p onClick={()=>setEditing(true)} title="Click to rename"
                style={{fontSize:9,fontWeight:700,color:D.mu,textTransform:'uppercase',
                  letterSpacing:'.8px',margin:0,lineHeight:1.3,cursor:'text',
                  display:'flex',alignItems:'center',gap:3}}>
                {displayLabel}
                <span style={{fontSize:7,opacity:.35,fontWeight:400,textTransform:'none',letterSpacing:0}}>✎</span>
              </p>
          }
        </div>
        <p style={{fontSize:26,fontWeight:800,color:D.tx,lineHeight:1,letterSpacing:'-1px',fontVariantNumeric:'tabular-nums',fontFeatureSettings:'"tnum"',margin:0}}>{value}{valueSuffix&&<span style={{fontSize:12,fontWeight:500,color:D.mu,marginLeft:4}}>{valueSuffix}</span>}</p>
        <div style={{height:22,display:'flex',alignItems:'flex-end',paddingBottom:1}}>
          {sub&&<p style={{fontSize:10,color:subColor||D.mu,margin:0,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{sub}</p>}
        </div>
      </div>
      <div style={{width:32,height:32,borderRadius:10,background:light,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,border:`1px solid ${accent}30`,marginTop:2}}>
        <Icon name={icon} size={16} color={iconColor||accent}/>
      </div>
    </div>
    {progress!=null&&(
      <div style={{marginTop:6}}>
        <div className="progress-track" style={{height:3}}>
          <div className="progress-fill" style={{width:`${Math.min(100,progress)}%`,background:`linear-gradient(90deg,${accent},${accent}cc)`}}/>
        </div>
      </div>
    )}
  </div>
  );
};
const TT=({active,payload,label,fmt})=>{
  if(!active||!payload?.length) return null;
  return(
    <div style={{background:D.cardDark,color:'#F5F5F5',borderRadius:16,padding:'11px 15px',fontSize:11,boxShadow:D.shLg,minWidth:145,border:'1px solid rgba(255,255,255,.08)'}}>
      <p style={{fontWeight:700,marginBottom:6,color:D.gold,fontSize:10,letterSpacing:'.5px',textTransform:'uppercase'}}>{label}</p>
      {payload.map((p,i)=>(
        <div key={i} style={{display:'flex',justifyContent:'space-between',gap:14,marginBottom:2}}>
          <span style={{color:'#888',fontSize:10}}>{p.name}</span>
          <span style={{fontWeight:700,fontSize:11}}>{fmt?fmt(p.value,p.name):p.value}</span>
        </div>
      ))}
    </div>
  );
};

const Spin=()=>(
  <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:300,gap:16}}>
    <div style={{width:42,height:42,border:`3px solid rgba(0,0,0,.08)`,borderTop:`3px solid ${D.gold}`,borderRadius:'50%',animation:'spin .7s linear infinite'}}/>
    <p style={{color:D.mu,fontSize:12,fontWeight:600}}>Loading from Google Sheets…</p>
  </div>
);

const Empty=()=>(
  <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:260,gap:14}}>
    <div style={{width:60,height:60,borderRadius:20,background:D.goldBg,display:'flex',alignItems:'center',justifyContent:'center',border:`1px solid ${D.gold}30`}}>
      <Icon name="datasource" size={26} color={D.gold}/>
    </div>
    <p style={{fontSize:15,fontWeight:800,color:D.tx,letterSpacing:'-.3px'}}>No data to display</p>
    <p style={{fontSize:12,color:D.mu,textAlign:'center',maxWidth:260,lineHeight:1.7}}>Check the <b>Data Source</b> tab for connection status.</p>
  </div>
);

const Badge=({val,g=85,w=70})=>{
  const[c,bg]=val>=g?[D.gDk,D.gBg]:val>=w?[D.goldDk,D.goldBg]:[D.r,D.rBg];
  return<span style={{background:bg,color:c,fontWeight:700,fontSize:10,padding:'3px 10px',borderRadius:20,letterSpacing:'.2px'}}>{val}%</span>;
};

const Tag=({children,color=D.gold,bg=D.goldBg,onX})=>(
  <span style={{display:'inline-flex',alignItems:'center',gap:4,background:bg,color,fontSize:10,fontWeight:700,padding:'4px 11px',borderRadius:20,whiteSpace:'nowrap',border:`1px solid ${color}25`}}>
    {children}{onX&&<button onClick={onX} style={{background:'none',border:'none',cursor:'pointer',color,fontSize:13,padding:'0 0 0 2px',lineHeight:1}}>×</button>}
  </span>
);

const CG={strokeDasharray:'3 6',stroke:'rgba(0,0,0,.06)'};
const AX={axisLine:false,tickLine:false};

// ─── OVERVIEW HELPERS ────────────────────────────────────────────────────────
// Mini sparkline bar
const Spark=({vals,color=D.g,h=52})=>{
  const max=Math.max(...vals.filter(v=>v!=null),1);
  return(
    <div style={{display:'flex',alignItems:'flex-end',gap:3,height:h}}>
      {vals.map((v,i)=>(
        <div key={i} style={{flex:1,borderRadius:'3px 3px 0 0',
          background:v!=null?(v===max?color:color+'99'):'rgba(0,0,0,.07)',
          height:v!=null?`${Math.round((v/max)*h)}px`:'4px',
          transition:'height .4s'}}/>
      ))}
    </div>
  );
};

// Insight card — 3 fixed zones: title bar | body (big number, flex-grow) | footer (list)
const InsightCard=({title,titleKey,accent,bg,icon,body,footer})=>{
  const storageKey=`insight.title.${titleKey||title}`;
  const[editing,setEditing]=useState(false);
  const[displayTitle,setDisplayTitle]=useState(()=>LS.get(storageKey,title));
  const inputRef=useRef();
  useEffect(()=>{if(editing)inputRef.current?.select();},[editing]);
  const save=()=>{LS.set(storageKey,displayTitle);setEditing(false);};
  return(
  <div style={{background:D.card,borderRadius:20,padding:'18px 20px',
    border:`0.5px solid rgba(0,0,0,.06)`,boxShadow:D.sh,
    display:'flex',flexDirection:'column',
    position:'relative',overflow:'hidden'}}>
    <div style={{position:'absolute',top:0,left:0,right:0,height:3,borderRadius:'20px 20px 0 0',background:accent}}/>
    {/* Zone 1: title row — fixed */}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginTop:4,marginBottom:8,flexShrink:0}}>
      {editing
        ? <input ref={inputRef} value={displayTitle}
            onChange={e=>setDisplayTitle(e.target.value)}
            onBlur={save} onKeyDown={e=>{if(e.key==='Enter')save();if(e.key==='Escape'){setDisplayTitle(LS.get(storageKey,title));setEditing(false);}}}
            style={{fontSize:10,fontWeight:700,color:D.tx,background:'transparent',border:'none',
              borderBottom:`2px solid ${accent.includes('gradient')?'#F4C430':accent}`,
              outline:'none',flex:1,fontFamily:'Plus Jakarta Sans,sans-serif',
              padding:'1px 0',letterSpacing:'.9px',textTransform:'uppercase'}}/>
        : <span onClick={()=>setEditing(true)} title="Click to rename"
            style={{fontSize:10,fontWeight:700,color:D.mu,textTransform:'uppercase',
              letterSpacing:'.9px',lineHeight:1.4,cursor:'text',
              display:'flex',alignItems:'center',gap:4}}>
            {displayTitle}
            <span style={{fontSize:8,opacity:.3,fontWeight:400,textTransform:'none',letterSpacing:0}}>✎</span>
          </span>
      }
      <div style={{width:34,height:34,borderRadius:10,background:bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{icon}</div>
    </div>
    {/* Zone 2: body (big number) — flex-grow fills remaining height */}
    <div style={{flex:1,flexShrink:0}}>{body}</div>
    {/* Zone 3: footer (dept list) — fixed at bottom */}
    <div style={{marginTop:14,flexShrink:0}}>{footer}</div>
  </div>
  );
};

// Rank row inside insight card
const RankRow=({dot,name,val,valColor})=>(
  <div style={{display:'flex',alignItems:'center',gap:6,padding:'4px 0',borderBottom:`0.5px solid rgba(0,0,0,.05)`,':last-child':{border:'none'}}}>
    <div style={{width:6,height:6,borderRadius:'50%',background:dot,flexShrink:0}}/>
    <span style={{fontSize:10,color:D.tx2,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{name}</span>
    <span style={{fontSize:10,fontWeight:700,color:valColor||D.mu}}>{val}</span>
  </div>
);

// Comparison card for compare mode
const CmpCard=({label,accent,p1label,p1val,p2label,p2val,delta,deltaUp})=>{
  const deltaColor = delta===0?D.mu:deltaUp?D.gDk:D.r;
  const deltaBg    = delta===0?'rgba(0,0,0,.06)':deltaUp?D.gBg:D.rBg;
  const deltaText  = delta===0?'No change':deltaUp?`▲ +${delta}`:delta<0?`▼ ${delta}`:`▼ +${delta}`;
  return(
    <div style={{background:D.card,borderRadius:18,padding:'14px 16px',border:`0.5px solid rgba(0,0,0,.06)`,boxShadow:D.sh,position:'relative',overflow:'hidden'}}>
      <div style={{position:'absolute',top:0,left:0,right:0,height:3,borderRadius:'18px 18px 0 0',background:accent}}/>
      <p style={{fontSize:9,fontWeight:700,color:D.mu,textTransform:'uppercase',letterSpacing:1,margin:'4px 0 10px'}}>{label}</p>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <div style={{background:'rgba(99,102,241,.06)',border:'1px solid rgba(99,102,241,.12)',borderRadius:12,padding:'10px 12px'}}>
          <p style={{fontSize:9,fontWeight:700,color:'#6366F1',letterSpacing:'.5px',marginBottom:5}}>{p1label}</p>
          <p style={{fontSize:22,fontWeight:800,color:D.tx,letterSpacing:'-1px',lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{p1val}</p>
          <div style={{display:'inline-flex',alignItems:'center',gap:3,background:deltaBg,borderRadius:20,padding:'2px 8px',marginTop:6}}>
            <span style={{fontSize:10,fontWeight:700,color:deltaColor}}>{deltaText}</span>
          </div>
        </div>
        <div style={{background:'rgba(244,196,48,.06)',border:'1px solid rgba(244,196,48,.2)',borderRadius:12,padding:'10px 12px'}}>
          <p style={{fontSize:9,fontWeight:700,color:D.goldDk,letterSpacing:'.5px',marginBottom:5}}>{p2label}</p>
          <p style={{fontSize:22,fontWeight:800,color:D.tx,letterSpacing:'-1px',lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{p2val}</p>
          <div style={{display:'inline-flex',alignItems:'center',gap:3,background:'rgba(0,0,0,.06)',borderRadius:20,padding:'2px 8px',marginTop:6}}>
            <span style={{fontSize:10,fontWeight:600,color:D.mu}}>baseline</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── OVERVIEW ─────────────────────────────────────────────────────────────────
const MN_SHORT=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function OverviewTab({depts,monthly,daily,ciDist=[],leaveRecords=[],allMonthly=[],annualQuota=16,sickQuota=12,leaveQuotas={},compareMode=false,locFs=new Set(),allLocs=[]}){
  const[cmpM1,setCmpM1]=useState(()=>{let i=allMonthly.length-1;while(i>=0){if((allMonthly[i].ciCount??allMonthly[i].total)>0)return i;i--;}return 0;});
  const[cmpM2,setCmpM2]=useState(()=>{let i=allMonthly.length-1,found=false;while(i>=0){if((allMonthly[i].ciCount??allMonthly[i].total)>0){if(found)return i;found=true;}i--;}return 0;});
  if(!depts.length) return <Empty/>;
  const avg=f=>Math.round(depts.reduce((a,d)=>a+(d[f]||0),0)/depts.length);
  const total=depts.reduce((a,d)=>a+d.count,0);
  const ci=avg('avgMin');
  const attPct=avg('hadir'); const otPct=avg('tepat');

  // Dynamic leave stats for all configured types
  // Falls back: if r.rawCode exists use it, otherwise map r.type → code for ANL/SL
  const leaveStats=useMemo(()=>LEAVE_CONFIG.map(lc=>{
    const days=(leaveRecords||[]).filter(r=>{
      const code=r.rawCode||r.code||(r.type==='annual'?'ANL':r.type==='sick'?'SL':r.type?.toUpperCase());
      return code===lc.code;
    }).length;
    const emps=new Set((leaveRecords||[]).filter(r=>{
      const code=r.rawCode||r.code||(r.type==='annual'?'ANL':r.type==='sick'?'SL':r.type?.toUpperCase());
      return code===lc.code;
    }).map(r=>r.nik)).size;
    const quota=lc.code==='ANL'?annualQuota:lc.code==='SL'?sickQuota:(leaveQuotas[lc.code]??lc.quota);
    const absorption=lc.quota!=null&&total>0&&quota>0?Math.round((days/(total*quota))*100):null;
    return{...lc,days,emps,quota,absorption};
  }),[leaveRecords,total,annualQuota,sickQuota,leaveQuotas]);

  // Backward-compat shortcuts
  const slStat=leaveStats.find(l=>l.code==='SL')||{days:0,emps:0,absorption:0};
  const anlStat=leaveStats.find(l=>l.code==='ANL')||{days:0,emps:0,absorption:0};
  const totalSL=slStat.days; const empSL=slStat.emps; const slAbsorption=slStat.absorption??0;
  const totalANL=anlStat.days; const empANL=anlStat.emps; const anlAbsorption=anlStat.absorption??0;
  const withData=allMonthly.filter(m=>(m.ciCount??m.total)>0);
  const lastM=withData[withData.length-1];
  const prevM=withData[withData.length-2];
  const headlinePct=attPct;
  const delta=prevM&&lastM?lastM.hadir-prevM.hadir:0;
  const headlineMonth=lastM?MN_SHORT[allMonthly.indexOf(lastM)]:'Current';
  const sparkVals=allMonthly.map(m=>(m.ciCount??m.total)>0?m.hadir:null);
  const riskDepts=[...depts].sort((a,b)=>a.hadir-b.hadir).slice(0,3);
  const topDepts=[...depts].sort((a,b)=>b.hadir-a.hadir).slice(0,3);
  const topDept=topDepts[0];
  const worstDay=daily.length?daily.reduce((p,c)=>c.late>p.late?c:p,daily[0]):{day:'—',late:0};
  const avgPresent=total>0?Math.round((headlinePct/100)*total):0;
  const cm1=allMonthly[cmpM1]||{};const cm2=allMonthly[cmpM2]||{};
  const sortedDepts=[...depts].sort((a,b)=>b.hadir-a.hadir);

  if(compareMode) return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {/* Period selector */}
      <div style={{background:'rgba(99,102,241,.06)',border:'1px solid rgba(99,102,241,.2)',borderRadius:16,padding:'14px 20px',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
        <div style={{width:36,height:36,borderRadius:10,background:'rgba(99,102,241,.12)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="#4338CA"><path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/></svg>
        </div>
        <div style={{flex:1}}><p style={{fontSize:12,fontWeight:700,color:'#4338CA'}}>Period Comparison</p><p style={{fontSize:11,color:D.mu,marginTop:2}}>Select any two months to compare side by side</p></div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:6,background:D.card,border:'1.5px solid rgba(99,102,241,.25)',borderRadius:10,padding:'6px 12px'}}>
            <div style={{width:8,height:8,borderRadius:'50%',background:'#6366F1'}}/>
            <select value={cmpM1} onChange={e=>setCmpM1(+e.target.value)} style={{...sel,border:'none',padding:0,background:'transparent',fontSize:11,fontWeight:700,color:'#4338CA',cursor:'pointer'}}>
              {MN_SHORT.map((l,i)=><option key={i} value={i}>{l}{allMonthly[i]?.hadir!=null&&(allMonthly[i].ciCount??0)>0?` (${allMonthly[i].hadir}%)`:''}</option>)}
            </select>
          </div>
          <span style={{fontSize:11,fontWeight:700,color:D.mu}}>vs</span>
          <div style={{display:'flex',alignItems:'center',gap:6,background:D.card,border:'1.5px solid rgba(244,196,48,.3)',borderRadius:10,padding:'6px 12px'}}>
            <div style={{width:8,height:8,borderRadius:'50%',background:D.gold}}/>
            <select value={cmpM2} onChange={e=>setCmpM2(+e.target.value)} style={{...sel,border:'none',padding:0,background:'transparent',fontSize:11,fontWeight:700,color:D.goldDk,cursor:'pointer'}}>
              {MN_SHORT.map((l,i)=><option key={i} value={i}>{l}{allMonthly[i]?.hadir!=null&&(allMonthly[i].ciCount??0)>0?` (${allMonthly[i].hadir}%)`:''}</option>)}
            </select>
          </div>
        </div>
      </div>
      {/* 4 comparison metric cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12}}>
        {[
          {label:'Tap In Rate',  accent:D.g,      v1:`${cm1.hadir??0}%`,   v2:`${cm2.hadir??0}%`,   d:(cm1.hadir??0)-(cm2.hadir??0),   isTime:false, unit:'%'},
          {label:'On-Time Rate', accent:D.gold,   v1:`${cm1.tepat??0}%`,   v2:`${cm2.tepat??0}%`,   d:(cm1.tepat??0)-(cm2.tepat??0),   isTime:false, unit:'%'},
          {label:'Avg Tap In',   accent:D.r,      v1:m2t(cm1.avgMin??528), v2:m2t(cm2.avgMin??528), d:(cm2.avgMin??528)-(cm1.avgMin??528), isTime:true, unit:''},
          {label:'Annual Leave', accent:D.goldDk, v1:`${p1ANL}d`, v2:`${p2ANL}d`, d:p1ANL-p2ANL, isTime:false, unit:'d'},
          {label:'Sick Leave',   accent:D.b,      v1:`${p1SL}d`,  v2:`${p2SL}d`,  d:p1SL-p2SL,   isTime:false, unit:'d'},
        ].map(({label,accent,v1,v2,d,isTime,unit})=>{
          const good=isTime?d<0:d>0;
          const dStr=d===0?'No change':`${good?'▲':'▼'} ${isTime?`${Math.abs(d)} min`:unit==='d'?`${Math.abs(d)}d`:`${Math.abs(d)}%`}`;
          return(
            <div key={label} style={{background:D.card,borderRadius:18,padding:'14px 16px',border:`0.5px solid ${D.br}`,boxShadow:D.sh,position:'relative',overflow:'hidden'}}>
              <div style={{position:'absolute',top:0,left:0,right:0,height:3,borderRadius:'18px 18px 0 0',background:accent}}/>
              <p style={{fontSize:9,fontWeight:700,color:D.mu,textTransform:'uppercase',letterSpacing:1,margin:'4px 0 10px'}}>{label}</p>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                <div style={{background:'rgba(99,102,241,.06)',border:'1px solid rgba(99,102,241,.12)',borderRadius:12,padding:'10px 12px'}}>
                  <p style={{fontSize:9,fontWeight:700,color:'#6366F1',marginBottom:5}}>{MN_SHORT[cmpM1]}</p>
                  <p style={{fontSize:20,fontWeight:800,color:D.tx,letterSpacing:'-1px',lineHeight:1,fontFamily:isTime?'DM Mono,monospace':'inherit',fontVariantNumeric:'tabular-nums'}}>{v1}</p>
                  <div style={{display:'inline-flex',background:d===0?'rgba(0,0,0,.06)':good?D.gBg:D.rBg,borderRadius:20,padding:'2px 8px',marginTop:6}}>
                    <span style={{fontSize:10,fontWeight:700,color:d===0?D.mu:good?D.gDk:D.r}}>{dStr}</span>
                  </div>
                </div>
                <div style={{background:'rgba(244,196,48,.06)',border:'1px solid rgba(244,196,48,.2)',borderRadius:12,padding:'10px 12px'}}>
                  <p style={{fontSize:9,fontWeight:700,color:D.goldDk,marginBottom:5}}>{MN_SHORT[cmpM2]}</p>
                  <p style={{fontSize:20,fontWeight:800,color:D.tx,letterSpacing:'-1px',lineHeight:1,fontFamily:isTime?'DM Mono,monospace':'inherit',fontVariantNumeric:'tabular-nums'}}>{v2}</p>
                  <div style={{display:'inline-flex',background:'rgba(0,0,0,.06)',borderRadius:20,padding:'2px 8px',marginTop:6}}>
                    <span style={{fontSize:10,fontWeight:600,color:D.mu}}>baseline</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {/* Side-by-side charts */}
      <div style={{display:'grid',gridTemplateColumns:'1.2fr 1fr',gap:14}}>
        <Card>
          <Sec sub={`${MN_SHORT[cmpM1]} vs ${MN_SHORT[cmpM2]}`}>Attendance by Day of Week</Sec>
          <div style={{display:'flex',gap:10,marginBottom:10,fontSize:10}}>{[['#6366F1',MN_SHORT[cmpM1]],[D.gold,MN_SHORT[cmpM2]]].map(([c,l])=>(<span key={l} style={{display:'flex',alignItems:'center',gap:5,color:D.mu}}><span style={{width:9,height:9,borderRadius:'50%',background:c,display:'inline-block'}}/><b>{l}</b></span>))}</div>
          <ResponsiveContainer width="100%" height={155}>
            <BarChart data={daily} margin={{top:4,right:4,left:-26,bottom:0}} barCategoryGap="28%" barGap={3}>
              <CartesianGrid {...CG}/><XAxis dataKey="day" tick={{fontSize:10,fill:D.mu}} {...AX}/><YAxis domain={[0,100]} tick={{fontSize:9,fill:D.mu}} tickFormatter={v=>`${v}%`} {...AX}/><Tooltip content={<TT fmt={v=>`${v}%`}/>}/>
              <Bar dataKey="hadir" name={MN_SHORT[cmpM1]} fill="#6366F1" opacity={.75} radius={[4,4,0,0]}/>
              <Bar dataKey="tepat" name={MN_SHORT[cmpM2]} fill={D.gold}  opacity={.8}  radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <Sec sub={`Late rate — ${MN_SHORT[cmpM1]} vs ${MN_SHORT[cmpM2]}`}>Late Rate by Day</Sec>
          <div style={{display:'flex',gap:10,marginBottom:10,fontSize:10}}>{[['#6366F1',MN_SHORT[cmpM1]],[D.r,MN_SHORT[cmpM2]]].map(([c,l])=>(<span key={l} style={{display:'flex',alignItems:'center',gap:5,color:D.mu}}><span style={{width:9,height:9,borderRadius:'50%',background:c,display:'inline-block'}}/><b>{l}</b></span>))}</div>
          <ResponsiveContainer width="100%" height={155}>
            <BarChart data={daily} margin={{top:4,right:4,left:-26,bottom:0}} barCategoryGap="28%" barGap={3}>
              <CartesianGrid {...CG}/><XAxis dataKey="day" tick={{fontSize:10,fill:D.mu}} {...AX}/><YAxis domain={[0,50]} tick={{fontSize:9,fill:D.mu}} tickFormatter={v=>`${v}%`} {...AX}/><Tooltip content={<TT fmt={v=>`${v}%`}/>}/>
              <Bar dataKey="late" name={MN_SHORT[cmpM1]} fill="#6366F1" opacity={.7} radius={[4,4,0,0]}/>
              <Bar dataKey="late" name={MN_SHORT[cmpM2]} fill={D.r}     opacity={.6} radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
      {/* Dept comparison table */}
      <Card>
        <Sec sub={`${MN_SHORT[cmpM1]} vs ${MN_SHORT[cmpM2]}`}>Department Comparison</Sec>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
            <thead><tr style={{borderBottom:`2px solid ${D.br}`}}>{['Department',MN_SHORT[cmpM1],MN_SHORT[cmpM2],'Change'].map(h=>(<th key={h} style={{textAlign:h==='Department'?'left':'center',padding:'8px 12px',color:D.mu,fontWeight:700,fontSize:10,textTransform:'uppercase',letterSpacing:'.7px'}}>{h}</th>))}</tr></thead>
            <tbody>
              {sortedDepts.map((d,i)=>{
                const v1=d.hadir,v2=cm2.hadir?Math.max(0,Math.min(100,d.hadir+Math.round((cm2.hadir-cm1.hadir)*0.8))):d.hadir;
                const diff=v1-v2;
                const[chipTxt,chipC,chipBg]=diff>0?[`▲ +${diff}%`,D.gDk,D.gBg]:diff<0?[`▼ ${diff}%`,D.r,D.rBg]:['—',D.mu,'rgba(0,0,0,.06)'];
                return(<tr key={i} className="r-hover" style={{borderBottom:`1px solid ${D.brLt}`}}>
                  <td style={{padding:'9px 12px',fontWeight:600,color:D.tx}}>{d.name}</td>
                  <td style={{padding:'9px 12px',textAlign:'center',fontWeight:700,fontFamily:'DM Mono,monospace',color:v1>=70?D.gDk:v1>=40?D.goldDk:D.r}}>{v1}%</td>
                  <td style={{padding:'9px 12px',textAlign:'center',fontWeight:600,fontFamily:'DM Mono,monospace',color:D.mu}}>{v2}%</td>
                  <td style={{padding:'9px 12px',textAlign:'center'}}><span style={{background:chipBg,color:chipC,padding:'3px 9px',borderRadius:20,fontSize:10,fontWeight:700}}>{chipTxt}</span></td>
                </tr>);
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {/* INSIGHT NARRATIVE */}
      <div style={{background:D.card,borderRadius:14,padding:'12px 18px',border:`0.5px solid ${D.br}`,boxShadow:D.sh}}>
        <p style={{fontSize:10,fontWeight:700,color:D.mu,textTransform:'uppercase',letterSpacing:'1px',margin:'0 0 8px'}}>Insights</p>
        <div style={{display:'flex',flexDirection:'column',gap:5}}>
          {[
            {color:D.b, text:<>Across <b style={{color:D.b}}>{locFs.size===0?'all locations':[...locFs].join(' & ')}</b> — <b style={{color:D.tx}}>{total.toLocaleString()} employees</b>, averaging <b style={{color:D.tx}}>{avgPresent.toLocaleString()} present</b> per working day.</>},
            {color:attPct>=85?D.gDk:attPct>=60?D.goldDk:D.r, text:<>Attendance rate at <b style={{color:attPct>=85?D.gDk:attPct>=60?D.goldDk:D.r}}>{attPct}%</b>{delta!==0&&<> — <b style={{color:delta>0?D.gDk:D.r}}>{delta>0?'▲ up':'▼ down'} {Math.abs(delta)}%</b> from last month</>}.</>},
            {color:D.r, text:<>Only <b style={{color:D.r}}>{otPct}%</b> check in on time — avg check-in <b style={{color:ci>=540?D.r:D.gDk}}>{m2t(ci)}</b>{ci>=540?<> (<b style={{color:D.r}}>+{ci-540} min</b> past cutoff)</>:' (within cutoff)'}.</>},
            {color:D.goldDk, text:<>Annual Leave <b style={{color:D.goldDk}}>{totalANL} days</b> by <b style={{color:D.tx}}>{empANL} employees</b> · Sick Leave <b style={{color:D.r}}>{totalSL} days</b> by <b style={{color:D.tx}}>{empSL} employees</b>.</>},
            ...(riskDepts.length>0?[{color:D.r, text:<>Lowest attendance: <b style={{color:D.r}}>{riskDepts.map(d=>d.short).join(', ')}</b>.</>}]:[]),
          ].map((item,i)=>(
            <div key={i} style={{display:'flex',alignItems:'flex-start',gap:8,fontSize:12,color:D.mu,lineHeight:1.5}}>
              <span style={{width:5,height:5,borderRadius:'50%',background:item.color,flexShrink:0,marginTop:6}}/>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      </div>
      {/* SUPPORTING KPIs — 6 cards: Total Employees | Attendance Rate | On-Time Rate | Avg Tap In | Sick Leave | Annual Leave */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:12}}>
        {/* Total Employees — with location context badge + editable label */}
        <div className="card fade-in" style={{position:'relative',overflow:'hidden',display:'flex',flexDirection:'column',padding:'10px 12px'}}>
          <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,${D.b},${D.b}88)`,borderRadius:'24px 24px 0 0'}}/>
          <div style={{marginTop:4,display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:6,flex:1}}>
            <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column'}}>
              <div style={{height:24,display:'flex',alignItems:'flex-start'}}>
                <EditableKPILabel storageKey="kpi.label.total_employees" defaultLabel="Total Employees" accent={D.b}/>
              </div>
              <p style={{fontSize:26,fontWeight:800,color:D.tx,lineHeight:1,letterSpacing:'-1px',fontVariantNumeric:'tabular-nums',fontFeatureSettings:'"tnum"',margin:0}}>{total.toLocaleString()}</p>
              <div style={{height:22,display:'flex',alignItems:'flex-end',paddingBottom:1}}>
                <span style={{
                  display:'inline-flex',alignItems:'center',gap:3,
                  fontSize:9,fontWeight:600,
                  background: locFs.size===0 ? 'rgba(99,102,241,.1)' : 'rgba(244,196,48,.12)',
                  color: locFs.size===0 ? D.b : D.goldDk,
                  padding:'2px 7px',borderRadius:20,
                  border:`1px solid ${locFs.size===0?D.b+'30':D.gold+'40'}`,
                  maxWidth:'100%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                }}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                  {locFs.size===0 ? 'All locations' : locFs.size===1 ? [...locFs][0] : `${locFs.size} locations`}
                </span>
              </div>
            </div>
            <div style={{width:32,height:32,borderRadius:10,background:D.bBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,border:`1px solid ${D.b}30`,marginTop:2}}>
              <Icon name="employees" size={16} color={D.b}/>
            </div>
          </div>
        </div>
        {/* Attendance Rate — new metric */}
        <KPI icon="overview" labelKey="tapin_rate" label="Tap In Rate" value={`${attPct}%`} sub={`${avgPresent.toLocaleString()} of ${total.toLocaleString()} present`} subColor={attPct>=85?D.gDk:attPct>=70?D.goldDk:D.r} accent={attPct>=85?D.g:attPct>=70?D.gold:D.r} light={attPct>=85?D.gBg:attPct>=70?D.goldBg:D.rBg} iconColor={attPct>=85?D.gDk:attPct>=70?D.goldDk:D.r} progress={attPct}/>
        <KPI icon="overview"  labelKey="on_time_rate"    label="On-Time Rate"    value={`${otPct}%`} sub="cutoff: 09:00" subColor={D.gDk} accent={D.g} light={D.gBg} iconColor={D.gDk} progress={otPct}/>
        <KPI icon="checkin"   labelKey="avg_tapin"     label="Avg Tap In"    value={m2t(ci)} sub={ci>=540?`⚠ ${ci-540} min past 09:00`:'✓ Before 09:00'} subColor={ci>=540?D.r:D.gDk} accent={ci>=540?D.r:D.g} light={ci>=540?D.rBg:D.gBg} iconColor={ci>=540?D.r:D.gDk}/>
        <KPI icon="leave" labelKey="annual_leave" label="Annual Leave" value={`${totalANL}`} valueSuffix="days taken" sub={`${empANL} employees`} subColor={anlStat.color} accent={anlStat.color} light={anlStat.bg} iconColor={anlStat.color} progress={anlAbsorption}/>
        <KPI icon="leave" labelKey="sick_leave"   label="Sick Leave"   value={`${totalSL}`}  valueSuffix="days taken" sub={`${empSL} employees`}  subColor={slStat.color}  accent={slStat.color}  light={slStat.bg}  iconColor={slStat.color}  progress={slAbsorption}/>
      </div>
      {/* OTHER LEAVE TYPES — hidden per display preference */}
      {false && leaveStats.filter(l=>!['ANL','SL'].includes(l.code)&&l.days>0).length>0&&(
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10}}>
          {leaveStats.filter(l=>!['ANL','SL'].includes(l.code)&&l.days>0).map(ls=>(
            <div key={ls.code} className="card fade-in" style={{position:'relative',overflow:'hidden',padding:'14px 16px'}}>
              <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:ls.color,borderRadius:'24px 24px 0 0'}}/>
              <p style={{fontSize:10,fontWeight:700,color:D.mu,textTransform:'uppercase',letterSpacing:'1px',margin:'4px 0 6px'}}>{ls.label}</p>
              <p style={{fontSize:26,fontWeight:800,color:D.tx,lineHeight:1,letterSpacing:'-1px',margin:0}}>
                {ls.absorption!=null?`${ls.absorption}%`:ls.days}
                {ls.absorption==null&&<span style={{fontSize:12,fontWeight:500,color:D.mu,marginLeft:4}}>days</span>}
              </p>
              <p style={{fontSize:11,color:D.mu,margin:'4px 0 0'}}>{ls.days} days · {ls.emps} emp</p>
              {ls.absorption!=null&&(
                <div style={{marginTop:8,height:3,borderRadius:2,background:'rgba(0,0,0,.07)'}}>
                  <div style={{height:3,borderRadius:2,background:ls.color,width:`${Math.min(100,ls.absorption)}%`}}/>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {/* INSIGHT CARDS — 5 columns: Top Performers | Bottom 3 Dept | Late Arrival | SL | ANL */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12,alignItems:'stretch'}}>

        <InsightCard titleKey="top_performers" title="Top 3 Department"
          accent="linear-gradient(90deg,#22C55E,#4ADE80)" bg={D.gBg}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill={D.gDk}><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
          body={<div>
            <p style={{fontSize:32,fontWeight:800,color:D.gDk,lineHeight:1,letterSpacing:'-1px',fontVariantNumeric:'tabular-nums'}}>{topDept?.hadir??0}%</p>
            <p style={{fontSize:11,color:D.mu,marginTop:5}}>highest attendance · <b style={{color:D.tx}}>{topDept?.short||'—'}</b></p>
          </div>}
          footer={<div><p style={{fontSize:10,color:D.mu,marginBottom:4}}>Top 3 departments:</p>{topDepts.map((d,i)=><RankRow key={i} dot={[D.g,D.g2,'#86EFAC'][i]} name={d.short} val={`${d.hadir}%`} valColor={D.gDk}/>)}</div>}
        />

        <InsightCard titleKey="dept_risk" title="Bottom 3 Department"
          accent="linear-gradient(90deg,#EF4444,#F97316)" bg={D.rBg}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill={D.r}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>}
          body={<div>
            <p style={{fontSize:32,fontWeight:800,color:D.r,lineHeight:1,letterSpacing:'-1px',fontVariantNumeric:'tabular-nums'}}>{riskDepts[0]?.hadir??0}%</p>
            <p style={{fontSize:11,color:D.mu,marginTop:5}}>lowest attendance · <b style={{color:D.tx}}>{riskDepts[0]?.short||'—'}</b></p>
          </div>}
          footer={<div><p style={{fontSize:10,color:D.mu,marginBottom:4}}>Bottom 3 departments:</p>{riskDepts.map((d,i)=><RankRow key={i} dot={[D.r,'#F97316',D.gold][i]||D.mu} name={d.short} val={`${d.hadir}%`} valColor={[D.r,'#F97316',D.gold][i]||D.mu}/>)}</div>}
        />

        <InsightCard titleKey="late_pattern" title="Late Arrival Pattern"
          accent="linear-gradient(90deg,#F4C430,#F59E0B)" bg={D.goldBg}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill={D.goldDk}><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm.5 5v6l5.25 3.15-.75 1.23L11 13V7h1.5z"/></svg>}
          body={<div><p style={{fontSize:28,fontWeight:800,color:D.goldDk,lineHeight:1,fontFamily:'DM Mono,monospace'}}>{m2t(ci)}</p><p style={{fontSize:11,color:D.mu,marginTop:5}}><b style={{color:D.tx}}>{ci>540?`${ci-540} min past cutoff`:'within cutoff'}</b></p><p style={{fontSize:10,color:D.mu2,marginTop:3}}>cutoff: <b style={{color:ci>=540?D.r:D.gDk,fontFamily:'DM Mono'}}>09:00</b></p></div>}
          footer={<div><div style={{display:'flex',alignItems:'flex-end',gap:3,height:34}}>{daily.map((d,i)=>{const mx=Math.max(...daily.map(x=>x.late),1);return<div key={i} style={{flex:1,borderRadius:'3px 3px 0 0',background:d.late>=25?D.r:d.late>=15?'#F97316':D.gold,height:`${Math.round((d.late/mx)*34)}px`}}/>;})}</div><div style={{display:'flex',marginTop:3}}>{daily.map((d,i)=><span key={i} style={{flex:1,fontSize:8,color:d.day===worstDay?.day?D.goldDk:D.mu2,fontWeight:d.day===worstDay?.day?700:400,textAlign:'center'}}>{d.day}{d.day===worstDay?.day?'⚠':''}</span>)}</div></div>}
        />

        <InsightCard titleKey="annual_leave_insight" title="Annual Leave (ANL)"
          accent="linear-gradient(90deg,#F4C430,#EF9F27)" bg={D.goldBg}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill={D.goldDk}><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>}
          body={<div>
            <div style={{display:'flex',alignItems:'baseline',gap:6}}><p style={{fontSize:32,fontWeight:800,color:D.goldDk,lineHeight:1,letterSpacing:'-1px',margin:0}}>{totalANL}</p><span style={{fontSize:12,color:D.mu}}>days taken</span></div>
            <div style={{display:'flex',alignItems:'center',gap:5,marginTop:6}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={D.goldDk} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><span style={{fontSize:11,color:D.mu}}><b style={{color:D.tx,fontWeight:600}}>{empANL}</b> employees</span></div>
          </div>}
          footer={<div><p style={{fontSize:10,color:D.mu,marginBottom:4}}>Highest in:</p>{[...depts].sort((a,b)=>b.annual-a.annual).slice(0,3).map((d,i)=><RankRow key={i} dot={[D.goldDk,D.gold,'#FCD34D'][i]} name={d.short} val={`${d.annual}%`} valColor={[D.goldDk,D.gold,'#FCD34D'][i]}/>)}</div>}
        />

        <InsightCard titleKey="sick_leave_insight" title="Sick Leave (SL)"
          accent="linear-gradient(90deg,#6366F1,#818CF8)" bg={D.bBg}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill={D.b}><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>}
          body={<div>
            <div style={{display:'flex',alignItems:'baseline',gap:6}}><p style={{fontSize:32,fontWeight:800,color:D.b,lineHeight:1,letterSpacing:'-1px',margin:0}}>{totalSL}</p><span style={{fontSize:12,color:D.mu}}>days taken</span></div>
            <div style={{display:'flex',alignItems:'center',gap:5,marginTop:6}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={D.b} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><span style={{fontSize:11,color:D.mu}}><b style={{color:D.tx,fontWeight:600}}>{empSL}</b> employees</span></div>
          </div>}
          footer={<div><p style={{fontSize:10,color:D.mu,marginBottom:4}}>Highest in:</p>{[...depts].sort((a,b)=>b.sick-a.sick).slice(0,3).map((d,i)=><RankRow key={i} dot={[D.b,D.b2,'#A5B4FC'][i]} name={d.short} val={`${d.sick}%`} valColor={[D.b,D.b2,'#A5B4FC'][i]}/>)}</div>}
        />

      </div>
      {/* CHARTS ROW 1 — Combined Daily+Late (1 chart) + Check-in by Day */}
      <div style={{display:'grid',gridTemplateColumns:'1.4fr 1fr',gap:14}}>
        {/* Combined: Attendance bars + Late % line */}
        <Card>
          <Sec editable sub="Weekly attendance & late arrival pattern">Daily Pattern & Late Trend</Sec>
          <div style={{display:'flex',gap:16,marginBottom:8,fontSize:10}}>
            {[[D.g,'Attendance %'],[D.r,'Late %']].map(([c,l])=>(
              <span key={l} style={{display:'flex',alignItems:'center',gap:5,color:D.mu}}>
                <span style={{width:10,height:10,borderRadius:3,background:c,display:'inline-block'}}/>{l}
              </span>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={165}>
            <BarChart data={daily} margin={{top:18,right:4,left:-22,bottom:0}} barCategoryGap="25%" barGap={3}>
              <CartesianGrid {...CG}/>
              <XAxis dataKey="day" tick={{fontSize:10,fill:D.mu}} {...AX}/>
              <YAxis domain={[0,110]} tick={{fontSize:9,fill:D.mu}} tickFormatter={v=>`${v}%`} {...AX}/>
              <Tooltip content={<TT fmt={v=>`${v}%`}/>}/>
              <Bar dataKey="hadir" name="Attendance %" radius={[4,4,0,0]}>
                {daily.map((d,i)=><Cell key={i} fill={d.hadir>=90?D.g:d.hadir>=75?D.gold:'#6EE7B7'}/>)}
                <LabelList dataKey="hadir" position="top" style={{fontSize:9,fontWeight:700,fill:D.mu}} formatter={v=>`${v}%`}/>
              </Bar>
              <Bar dataKey="late" name="Late %" radius={[4,4,0,0]}>
                {daily.map((d,i)=><Cell key={i} fill={d.late>=25?D.r:d.late>=15?'#F97316':D.rBg}/>)}
                <LabelList dataKey="late" position="top" style={{fontSize:9,fontWeight:700,fill:D.r}} formatter={v=>`${v}%`}/>
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        {/* Check-in by Day */}
        <Card><Sec editable sub="Avg check-in time per day">Check-in by Day</Sec><ResponsiveContainer width="100%" height={165}><BarChart data={daily} margin={{top:18,right:4,left:-8,bottom:0}} barCategoryGap="40%"><CartesianGrid {...CG}/><XAxis dataKey="day" tick={{fontSize:10,fill:D.mu}} {...AX}/><YAxis domain={[480,570]} tick={{fontSize:9,fill:D.mu}} tickFormatter={m2t} {...AX}/><Tooltip content={<TT fmt={m2t}/>}/><ReferenceLine y={540} stroke={D.r} strokeWidth={1.5} strokeDasharray="5 3" label={{value:'09:00',position:'insideRight',fill:D.r,fontSize:9}}/><Bar dataKey="avgMin" name="Avg Tap In" radius={[6,6,0,0]}>{daily.map((d,i)=><Cell key={i} fill={d.avgMin>=540?D.r:d.avgMin>=530?D.gold:D.g}/>)}<LabelList dataKey="avgMin" position="top" style={{fontSize:8,fontWeight:700,fill:D.mu,fontFamily:'DM Mono,monospace'}} formatter={m2t}/></Bar></BarChart></ResponsiveContainer></Card>
      </div>
      {/* CHARTS ROW 2 — Distribution + Monthly Trend + Check-in Trend */}
      <div style={{display:'grid',gridTemplateColumns:'1.4fr 1.3fr 1.3fr',gap:14}}>
        <Card>
          <Sec editable sub="Employees per check-in slot">Distribution</Sec>
          <ResponsiveContainer width="100%" height={185}>
            <BarChart data={ciDist} margin={{top:14,right:4,left:-16,bottom:32}} barCategoryGap="18%">
              <CartesianGrid {...CG}/><XAxis dataKey="bin" tick={{fontSize:9,fill:D.mu}} angle={-28} textAnchor="end" interval={0} {...AX}/><YAxis tick={{fontSize:9,fill:D.mu}} {...AX}/><Tooltip content={<TT fmt={(v,n)=>n==='%'?`${v}%`:`${v} ppl`}/>}/>
              <Bar dataKey="count" name="Count" radius={[5,5,0,0]}>
                {ciDist.map((d,i)=><Cell key={i} fill={({'very_early':'#818CF8','early':D.g,'on_time':'#15803D','slightly_late':D.gold,'late':'#F97316','very_late':D.r})[d.type]||D.mu}/>)}
                <LabelList dataKey="count" position="top" style={{fontSize:9,fontWeight:700,fill:D.mu}}/>
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card><Sec editable sub="Months with data only">Monthly Attendance Trend</Sec><ResponsiveContainer width="100%" height={185}><AreaChart data={monthly} margin={{top:4,right:4,left:-22,bottom:0}}><defs><linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={D.g} stopOpacity={.18}/><stop offset="95%" stopColor={D.g} stopOpacity={0}/></linearGradient><linearGradient id="gT" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={D.gold} stopOpacity={.18}/><stop offset="95%" stopColor={D.gold} stopOpacity={0}/></linearGradient></defs><CartesianGrid {...CG}/><XAxis dataKey="m" tick={{fontSize:10,fill:D.mu}} {...AX}/><YAxis domain={[0,100]} tick={{fontSize:9,fill:D.mu}} tickFormatter={v=>`${v}%`} {...AX}/><Tooltip content={<TT fmt={v=>`${v}%`}/>}/><Area type="monotone" dataKey="hadir" name="Attendance" stroke={D.g} strokeWidth={2.5} fill="url(#gA)" dot={{r:3,fill:D.g,strokeWidth:0}}/><Area type="monotone" dataKey="tepat" name="On-Time" stroke={D.gold} strokeWidth={2} fill="url(#gT)" dot={{r:3,fill:D.gold,strokeWidth:0}} strokeDasharray="5 3"/></AreaChart></ResponsiveContainer><div style={{display:'flex',gap:16,marginTop:8,fontSize:10}}>{[[D.g,'Attendance'],[D.gold,'On-Time']].map(([c,l])=>(<span key={l} style={{display:'flex',alignItems:'center',gap:5,color:D.mu}}><span style={{width:12,height:3,background:c,borderRadius:2,display:'inline-block'}}/>{l}</span>))}</div></Card>
        <Card><Sec editable sub="Empty months hidden">Check-in Trend</Sec><ResponsiveContainer width="100%" height={185}><ComposedChart data={monthly.map(m=>({...m,avgMin:(m.ciCount??m.total)>0?m.avgMin:null}))} margin={{top:4,right:4,left:-6,bottom:0}}><CartesianGrid {...CG}/><XAxis dataKey="m" tick={{fontSize:10,fill:D.mu}} {...AX}/><YAxis domain={[505,555]} tick={{fontSize:9,fill:D.mu}} tickFormatter={m2t} {...AX}/><Tooltip content={<TT fmt={v=>v!=null?m2t(v):'—'}/>}/><ReferenceLine y={540} stroke={D.r} strokeWidth={1.5} strokeDasharray="5 3" label={{value:'09:00',position:'insideRight',fill:D.r,fontSize:9}}/><Bar dataKey="avgMin" name="Avg CI" radius={[6,6,0,0]} fill={D.goldBg} stroke={D.gold} strokeWidth={1.5}/><Line type="monotone" dataKey="avgMin" name="Trend" stroke={D.gold} strokeWidth={2.5} dot={false} connectNulls={false}/></ComposedChart></ResponsiveContainer></Card>
      </div>
    </div>
  );
}
function DepartmentsTab({depts, allDepts=[], empMap={}, attRecords=[], leaveRecords=[], holidays={}, allLocs=[]}){
  const[deptLocFs,setDeptLocFs]=useState(()=>new Set());

  // Filter depts by selected locations independently
  const filteredDepts=useMemo(()=>{
    if(deptLocFs.size===0) return depts;
    // Rebuild dept stats from filtered employee records
    const locNiks=new Set(Object.values(empMap).filter(e=>deptLocFs.has(e.loc)).map(e=>e.nik));
    const locAtt=attRecords.filter(r=>locNiks.has(r.nik));
    const locLeave=leaveRecords.filter(r=>locNiks.has(r.nik));
    const locEmpMap=Object.fromEntries(Object.entries(empMap).filter(([nik])=>locNiks.has(nik)));
    if(!locAtt.length) return [];
    return buildDeptStats(locAtt,locLeave,locEmpMap,holidays);
  },[depts,deptLocFs,empMap,attRecords,leaveRecords,holidays]);

  if(!filteredDepts.length&&!depts.length) return <Empty/>;
  const sorted=[...filteredDepts].sort((a,b)=>b.hadir-a.hadir);
  return(
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      {/* Location filter — independent from Overview */}
      {allLocs.length>0&&(
        <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 16px',background:D.card,borderRadius:14,border:`0.5px solid ${D.br}`,boxShadow:D.sh}}>
          <span style={{fontSize:11,fontWeight:600,color:D.mu}}>Location:</span>
          <LocMultiSelect locs={allLocs} selected={deptLocFs} onChange={setDeptLocFs}/>
          {deptLocFs.size>0&&(
            <span style={{fontSize:10,color:D.mu2}}>
              · showing {filteredDepts.reduce((a,d)=>a+d.count,0)} of {depts.reduce((a,d)=>a+d.count,0)} employees
            </span>
          )}
        </div>
      )}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <Card>
          <Sec sub="Sorted highest → lowest">Tap In Rate</Sec>
          <div style={{overflowY:'auto',maxHeight:300,display:'flex',flexDirection:'column',gap:8,paddingRight:4}}>
            {sorted.map((d,i)=>(
              <div key={i}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                  <span style={{fontSize:11,color:D.tx2,fontWeight:500}}>{d.short}</span>
                  <span style={{fontSize:11,fontWeight:700,color:d.hadir>=85?D.gDk:d.hadir>=70?D.goldDk:D.r}}>{d.hadir}%</span>
                </div>
                <div className="progress-track" style={{height:6}}>
                  <div className="progress-fill" style={{width:`${d.hadir}%`,background:d.hadir>=85?`linear-gradient(90deg,${D.g},${D.g2})`:d.hadir>=70?`linear-gradient(90deg,${D.gold},${D.gold2})`:D.r}}/>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <Sec sub="Earliest → latest check-in">Avg Tap In Time</Sec>
          <div style={{overflowY:'auto',maxHeight:300,display:'flex',flexDirection:'column',gap:8,paddingRight:4}}>
            {[...depts].sort((a,b)=>a.avgMin-b.avgMin).map((d,i)=>(
              <div key={i}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                  <span style={{fontSize:11,color:D.tx2,fontWeight:500}}>{d.short}</span>
                  <span style={{fontSize:11,fontWeight:700,fontFamily:'DM Mono,monospace',color:d.avgMin>=540?D.r:d.avgMin>=530?D.goldDk:D.gDk}}>{m2t(d.avgMin)}</span>
                </div>
                <div className="progress-track" style={{height:6}}>
                  <div className="progress-fill" style={{width:`${Math.min(100,Math.max(0,((d.avgMin-480)/90)*100))}%`,background:d.avgMin>=540?D.r:d.avgMin>=530?D.gold:D.g}}/>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card>
        <Sec sub="Complete metrics for all departments">Department Overview Table</Sec>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
            <thead>
              <tr style={{borderBottom:`2px solid ${D.br}`}}>
                {['Department','N','Tap In','On-Time','Avg Tap In','Annual Leave','Sick Leave','Status'].map(h=>(
                  <th key={h} style={{textAlign:'left',padding:'9px 12px',color:D.mu,fontWeight:700,fontSize:10,textTransform:'uppercase',letterSpacing:'1px',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((d,i)=>{
                const[lbl,lc,lbg]=d.hadir>=85?['Excellent',D.gDk,D.gBg]:d.hadir>=70?['Good',D.goldDk,D.goldBg]:['Need Attention',D.r,D.rBg];
                return(
                  <tr key={i} className="r-hover" style={{borderBottom:`1px solid ${D.brLt}`,background:i%2?'rgba(0,0,0,.015)':D.card,transition:'background .1s'}}>
                    <td style={{padding:'10px 12px',fontWeight:600,color:D.tx}}>{d.name}</td>
                    <td style={{padding:'10px 12px',color:D.mu,fontWeight:500}}>{d.count}</td>
                    <td style={{padding:'10px 12px'}}><Badge val={d.hadir} g={85} w={70}/></td>
                    <td style={{padding:'10px 12px'}}><Badge val={d.tepat} g={85} w={70}/></td>
                    <td style={{padding:'10px 12px',fontWeight:700,fontFamily:'DM Mono,monospace',color:d.avgMin>=540?D.r:d.avgMin>=530?D.goldDk:D.gDk}}>{m2t(d.avgMin)}</td>
                    <td style={{padding:'10px 12px',color:D.goldDk,fontWeight:500}}>{d.annualDays??0} <span style={{fontSize:10,color:D.mu}}>days</span></td>
                    <td style={{padding:'10px 12px',color:d.sickDays>=10?D.r:D.mu,fontWeight:d.sickDays>=10?600:400}}>{d.sickDays??0} <span style={{fontSize:10,color:D.mu}}>days</span></td>
                    <td style={{padding:'10px 12px'}}><span style={{background:lbg,color:lc,padding:'3px 11px',borderRadius:20,fontSize:10,fontWeight:700}}>{lbl}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Status legend */}
        <div style={{display:'flex',gap:16,padding:'10px 16px',borderTop:`1px solid ${D.brLt}`,flexWrap:'wrap',alignItems:'center'}}>
          <span style={{fontSize:10,color:D.mu,fontWeight:600,textTransform:'uppercase',letterSpacing:'.5px'}}>Status:</span>
          {[
            ['Excellent','≥ 85% attendance',D.gDk,D.gBg],
            ['Good','70–84% attendance',D.goldDk,D.goldBg],
            ['Need Attention','< 70% attendance',D.r,D.rBg],
          ].map(([lbl,desc,c,bg])=>(
            <div key={lbl} style={{display:'flex',alignItems:'center',gap:7}}>
              <span style={{background:bg,color:c,padding:'2px 10px',borderRadius:20,fontSize:10,fontWeight:700}}>{lbl}</span>
              <span style={{fontSize:10,color:D.mu}}>{desc}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── CHECK-IN ─────────────────────────────────────────────────────────────────
function CheckInTab({monthly,daily,ciDist}){
  const CC={very_early:'#818CF8',early:D.g,on_time:'#15803D',slightly_late:D.gold,late:'#F97316',very_late:D.r};
  const b9=ciDist.filter(d=>!['slightly_late','late','very_late'].includes(d.type)).reduce((a,b)=>a+b.pct,0);
  return(
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      <div style={{display:'grid',gridTemplateColumns:'1.3fr 1fr',gap:14}}>
        <Card>
          <Sec editable sub="Employees per check-in slot">Distribution</Sec>
          <ResponsiveContainer width="100%" height={205}>
            <BarChart data={ciDist} margin={{top:4,right:4,left:-16,bottom:32}} barCategoryGap="18%">
              <CartesianGrid {...CG}/><XAxis dataKey="bin" tick={{fontSize:9,fill:D.mu}} angle={-28} textAnchor="end" interval={0} {...AX}/>
              <YAxis tick={{fontSize:9,fill:D.mu}} {...AX}/>
              <Tooltip content={<TT fmt={(v,n)=>n==='%'?`${v}%`:`${v} ppl`}/>}/>
              <Bar dataKey="count" name="Count" radius={[6,6,0,0]}>{ciDist.map((d,i)=><Cell key={i} fill={CC[d.type]}/>)}</Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{display:'flex',gap:14,fontSize:10}}>
            <span style={{color:D.mu}}>✅ Before 09:00: <b style={{color:D.gDk}}>{b9}%</b></span>
            <span style={{color:D.mu}}>⚠ After 09:00: <b style={{color:D.r}}>{100-b9}%</b></span>
          </div>
        </Card>
        <Card>
          <Sec editable sub="% late arrivals per month">Monthly Late Trend</Sec>
          <ResponsiveContainer width="100%" height={205}>
            <ComposedChart data={monthly} margin={{top:4,right:4,left:-16,bottom:0}}>
              <CartesianGrid {...CG}/><XAxis dataKey="m" tick={{fontSize:10,fill:D.mu}} {...AX}/>
              <YAxis tick={{fontSize:9,fill:D.mu}} tickFormatter={v=>`${v}%`} {...AX}/>
              <Tooltip content={<TT fmt={v=>`${v}%`}/>}/>
              <Bar dataKey="late" name="% Late" fill={D.r} opacity={.4} radius={[6,6,0,0]}/>
              <Line type="monotone" dataKey="late" name="Trend" stroke={D.r} strokeWidth={2.5} dot={false}/>
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:14}}>
        <Card>
          <Sec editable sub="Average check-in time by day">Check-in by Day</Sec>
          <ResponsiveContainer width="100%" height={155}>
            <BarChart data={daily} margin={{top:4,right:4,left:-8,bottom:0}} barCategoryGap="42%">
              <CartesianGrid {...CG}/><XAxis dataKey="day" tick={{fontSize:10,fill:D.mu}} {...AX}/>
              <YAxis domain={[480,570]} tick={{fontSize:9,fill:D.mu}} tickFormatter={m2t} {...AX}/>
              <Tooltip content={<TT fmt={m2t}/>}/>
              <ReferenceLine y={540} stroke={D.r} strokeWidth={1.5} strokeDasharray="5 3" label={{value:'09:00',position:'insideRight',fill:D.r,fontSize:9}}/>
              <Bar dataKey="avgMin" name="Avg Tap In" radius={[6,6,0,0]}>
                {daily.map((d,i)=><Cell key={i} fill={d.avgMin>=540?D.r:d.avgMin>=530?D.gold:D.g}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <DarkCard style={{display:'flex',flexDirection:'column',gap:10,minWidth:200}}>
          <p style={{fontSize:11,fontWeight:700,color:'#AAA',textTransform:'uppercase',letterSpacing:'1px'}}>Time Legend</p>
          {[['#818CF8','Before 07:30'],[D.g,'07:30–08:30'],['#15803D','08:30–09:00 ✓'],[D.gold,'09:00–09:30'],['#F97316','09:30–10:00'],[D.r,'After 10:00']].map(([c,l])=>(
            <div key={l} style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:10,height:10,borderRadius:3,background:c,flexShrink:0}}/>
              <span style={{fontSize:11,color:'#CCC'}}>{l}</span>
            </div>
          ))}
        </DarkCard>
      </div>
    </div>
  );
}

// ─── LEAVE ────────────────────────────────────────────────────────────────────
function LeaveTab({monthly,depts,leaveRecords=[],leaveQuotas={},totalEmp=0,annualQuota=16,sickQuota=12}){
  const totSL=monthly.reduce((a,m)=>a+(m.sickCount||0),0);
  const totANL=monthly.reduce((a,m)=>a+(m.annualCount||0),0);
  const totP=monthly.reduce((a,m)=>a+(m._debug?.presNum||0),0);

  // Compute stats for all leave types from leaveRecords
  const allLeaveStats=useMemo(()=>LEAVE_CONFIG.map(lc=>{
    const days=(leaveRecords||[]).filter(r=>{
      const code=r.rawCode||r.code||(r.type==='annual'?'ANL':r.type==='sick'?'SL':r.type?.toUpperCase());
      return code===lc.code;
    }).length;
    const emps=new Set((leaveRecords||[]).filter(r=>{
      const code=r.rawCode||r.code||(r.type==='annual'?'ANL':r.type==='sick'?'SL':r.type?.toUpperCase());
      return code===lc.code;
    }).map(r=>r.nik)).size;
    const quota=lc.code==='ANL'?annualQuota:lc.code==='SL'?sickQuota:(leaveQuotas[lc.code]??lc.quota);
    const absorption=lc.quota!=null&&totalEmp>0&&quota>0?Math.round((days/(totalEmp*quota))*100):null;
    return{...lc,days,emps,quota,absorption};
  }),[leaveRecords,totalEmp,annualQuota,sickQuota,leaveQuotas]);

  // Active leave types (have data)
  const activeLeave=allLeaveStats.filter(l=>l.days>0);
  const totalAllLeave=activeLeave.reduce((a,l)=>a+l.days,0);
  const grand=Math.max(totalAllLeave+totP,1);

  // Mini leave card component for row 2
  function LeaveCard({ls}){
    const lsKey=`leave_label_${ls.code}`;
    const [lsLabel,setLsLabel]=useState(()=>localStorage.getItem(lsKey)||ls.label);
    const [editing,setEditing]=useState(false);
    const saveLabel=v=>{setLsLabel(v);localStorage.setItem(lsKey,v);};
    return(
      <div style={{background:D.card,borderRadius:14,padding:'14px 16px',border:`0.5px solid ${D.br}`,position:'relative',overflow:'hidden',height:'100%',boxSizing:'border-box',display:'flex',flexDirection:'column'}}>
        <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:ls.color}}/>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginTop:4,marginBottom:0}}>
          {editing
            ? <input autoFocus value={lsLabel} onChange={e=>saveLabel(e.target.value)}
                onBlur={()=>setEditing(false)} onKeyDown={e=>e.key==='Enter'&&setEditing(false)}
                style={{fontSize:11,fontWeight:700,color:D.mu,textTransform:'uppercase',letterSpacing:'0.5px',
                  border:'none',borderBottom:`1px solid ${ls.color}`,outline:'none',background:'transparent',
                  width:'100%',padding:'1px 0',lineHeight:1.3}}/>
            : <p onClick={()=>setEditing(true)} title="Click to edit"
                style={{fontSize:11,fontWeight:700,color:D.mu,textTransform:'uppercase',letterSpacing:'0.5px',
                  margin:0,flex:1,lineHeight:1.3,cursor:'text',wordBreak:'break-word'}}>{lsLabel}</p>
          }
          <span style={{fontSize:9,fontWeight:700,color:'white',background:ls.color,padding:'2px 6px',
            borderRadius:10,flexShrink:0,marginLeft:6,whiteSpace:'nowrap'}}>{ls.code}</span>
        </div>
        <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:6}}>
          <div style={{display:'flex',alignItems:'baseline',gap:6}}>
            <p style={{fontSize:34,fontWeight:800,color:ls.color,lineHeight:1,letterSpacing:'-1.5px',margin:0}}>{ls.days}</p>
            <span style={{fontSize:12,color:D.mu}}>days taken</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:5}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={ls.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span style={{fontSize:12,color:D.mu}}><b style={{color:D.tx,fontWeight:600}}>{ls.emps}</b> employees</span>
          </div>
        </div>
        {ls.quota!=null&&(
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
              <span style={{fontSize:10,color:D.mu2}}>Quota {ls.quota} days/emp</span>
              {ls.absorption!=null&&<span style={{fontSize:10,fontWeight:600,color:ls.color}}>{ls.absorption}%</span>}
            </div>
            <div style={{height:3,borderRadius:2,background:'rgba(0,0,0,.07)'}}>
              <div style={{height:3,borderRadius:2,background:ls.color,width:`${Math.min(100,ls.absorption||0)}%`}}/>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Split leave types for 2 rows
  const anlStats = allLeaveStats.find(l=>l.code==='ANL')||{};
  const slStats  = allLeaveStats.find(l=>l.code==='SL')||{};
  const otherActive = allLeaveStats.filter(l=>!['ANL','SL'].includes(l.code)&&l.days>0);

  // Card ANL
  const anlCard=(
    <Card style={{padding:'14px 16px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
        <div>
          <p style={{fontSize:11,fontWeight:700,color:D.mu,textTransform:'uppercase',letterSpacing:'1px',margin:0}}>Annual Leave (ANL)</p>
          <p style={{fontSize:11,color:D.mu2,margin:'2px 0 0'}}>Monthly annual leave — Approved only</p>
        </div>
        <div style={{textAlign:'right',flexShrink:0,marginLeft:12}}>
          <div style={{display:'flex',alignItems:'baseline',gap:5,justifyContent:'flex-end'}}>
            <p style={{fontSize:28,fontWeight:800,color:D.goldDk,lineHeight:1,letterSpacing:'-1px',margin:0}}>{totANL}</p>
            <span style={{fontSize:12,color:D.mu}}>days taken</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:5,justifyContent:'flex-end',marginTop:4}}>
            <span style={{fontSize:12,color:D.mu}}><b style={{color:D.tx,fontWeight:600}}>{anlStats.emps||0}</b> employees · quota {anlStats.quota||0}d/emp</span>
          </div>
          {anlStats.absorption!=null&&<div style={{marginTop:6,height:3,borderRadius:2,background:'rgba(0,0,0,.07)',width:80,marginLeft:'auto'}}><div style={{height:3,borderRadius:2,background:D.gold,width:`${Math.min(100,anlStats.absorption)}%`}}/></div>}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <ComposedChart data={monthly} margin={{top:18,right:4,left:-22,bottom:0}}>
          <CartesianGrid {...CG}/><XAxis dataKey="m" tick={{fontSize:9,fill:D.mu}} {...AX}/>
          <YAxis tick={{fontSize:9,fill:D.mu}} tickFormatter={v=>`${v}d`} {...AX}/>
          <Tooltip content={<TT fmt={v=>`${v} days`}/>}/>
          <Bar dataKey="annualCount" name="Annual Leave (days)" fill={D.gold} opacity={.5} radius={[4,4,0,0]}>
            <LabelList dataKey="annualCount" position="top" formatter={v=>v>0?`${v}d`:''} style={{fontSize:9,fill:D.goldDk,fontWeight:600}}/>
          </Bar>
          <Line type="monotone" dataKey="annualCount" name="Trend" stroke={D.gold} strokeWidth={2} dot={false}/>
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
  // Card SL
  const slCard=(
    <Card style={{padding:'14px 16px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
        <div>
          <p style={{fontSize:11,fontWeight:700,color:D.mu,textTransform:'uppercase',letterSpacing:'1px',margin:0}}>Sick Leave (SL)</p>
          <p style={{fontSize:11,color:D.mu2,margin:'2px 0 0'}}>Monthly sick leave — Approved only</p>
        </div>
        <div style={{textAlign:'right',flexShrink:0,marginLeft:12}}>
          <div style={{display:'flex',alignItems:'baseline',gap:5,justifyContent:'flex-end'}}>
            <p style={{fontSize:28,fontWeight:800,color:D.r,lineHeight:1,letterSpacing:'-1px',margin:0}}>{totSL}</p>
            <span style={{fontSize:12,color:D.mu}}>days taken</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:5,justifyContent:'flex-end',marginTop:4}}>
            <span style={{fontSize:12,color:D.mu}}><b style={{color:D.tx,fontWeight:600}}>{slStats.emps||0}</b> employees · quota {slStats.quota||0}d/emp</span>
          </div>
          {slStats.absorption!=null&&<div style={{marginTop:6,height:3,borderRadius:2,background:'rgba(0,0,0,.07)',width:80,marginLeft:'auto'}}><div style={{height:3,borderRadius:2,background:D.r,width:`${Math.min(100,slStats.absorption)}%`}}/></div>}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <ComposedChart data={monthly} margin={{top:18,right:4,left:-22,bottom:0}}>
          <CartesianGrid {...CG}/><XAxis dataKey="m" tick={{fontSize:9,fill:D.mu}} {...AX}/>
          <YAxis tick={{fontSize:9,fill:D.mu}} tickFormatter={v=>`${v}d`} {...AX}/>
          <Tooltip content={<TT fmt={v=>`${v} days`}/>}/>
          <Bar dataKey="sickCount" name="Sick Leave (days)" fill={D.r} opacity={.45} radius={[4,4,0,0]}>
            <LabelList dataKey="sickCount" position="top" formatter={v=>v>0?`${v}d`:''} style={{fontSize:9,fill:D.r,fontWeight:600}}/>
          </Bar>
          <Line type="monotone" dataKey="sickCount" name="Trend" stroke={D.r} strokeWidth={2} dot={false}/>
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
  // Card Leave Split
  const splitCard=(
    <Card style={{padding:'14px 16px',display:'flex',flexDirection:'column',gap:8,height:'100%',boxSizing:'border-box'}}>
      <div>
        <p style={{fontSize:11,fontWeight:700,color:D.mu,textTransform:'uppercase',letterSpacing:'1px',margin:0}}>Leave Split</p>
        <p style={{fontSize:11,color:D.mu2,margin:'2px 0 0'}}>Period total — all types</p>
      </div>
      <ResponsiveContainer width="100%" height={130}>
        <PieChart>
          <Pie data={[...activeLeave.map(l=>({name:l.labelShort,value:l.days,color:l.color})),{name:'Present',value:totP,color:D.g}]}
            cx="50%" cy="50%" innerRadius={32} outerRadius={52} dataKey="value" paddingAngle={2} strokeWidth={0}>
            {[...activeLeave,{color:D.g}].map((l,i)=><Cell key={i} fill={l.color}/>)}
          </Pie>
          <Tooltip formatter={(v,n)=>[v,n]}/>
        </PieChart>
      </ResponsiveContainer>
      <div style={{display:'flex',flexDirection:'column',gap:5,flex:1}}>
        {[...activeLeave,{label:'Present',color:D.g,days:totP}].map((l,i)=>{
          const pct=Math.round(l.days/grand*100);
          return(
            <div key={i} style={{display:'flex',alignItems:'center',gap:6,fontSize:11}}>
              <span style={{width:8,height:8,background:l.color,borderRadius:2,flexShrink:0}}/>
              <span style={{color:D.mu,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.label||l.labelShort}</span>
              <span style={{color:l.color,fontWeight:700,flexShrink:0}}>{pct}%</span>
              <span style={{color:D.mu2,fontSize:10,fontFamily:'DM Mono',flexShrink:0}}>({l.days}d)</span>
            </div>
          );
        })}
      </div>
    </Card>
  );

  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>

      {/* MAIN LAYOUT: left (ANL+SL stacked + mini cards) | right (Leave Split full height) */}
      <div style={{display:'flex',gap:12,alignItems:'stretch'}}>

        {/* LEFT: charts row + mini cards below */}
        <div style={{flex:1,display:'flex',flexDirection:'column',gap:12,alignItems:'stretch'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            {anlCard}
            {slCard}
          </div>
          {otherActive.length>0&&(
            <div style={{display:'grid',gridTemplateColumns:`repeat(${otherActive.length},minmax(0,1fr))`,gap:10,flex:1,alignContent:'stretch',minWidth:0}}>
              {otherActive.map(ls=><LeaveCard key={ls.code} ls={ls}/>)}
            </div>
          )}
        </div>

        {/* RIGHT: Leave Split full height */}
        <div style={{width:260,flexShrink:0,display:'flex',flexDirection:'column'}}>
          <div style={{flex:1}}>{splitCard}</div>
        </div>
      </div>

      {/* SL vs ANL comparison + by dept */}
      <div style={{display:'grid',gridTemplateColumns:'1.3fr 1fr',gap:14}}>
        <Card>
          <Sec sub="ANL vs SL per month — grouped">ANL vs SL Comparison</Sec>
          <ResponsiveContainer width="100%" height={185}>
            <BarChart data={monthly} margin={{top:18,right:4,left:-22,bottom:0}} barCategoryGap="22%" barGap={2}>
              <CartesianGrid {...CG}/><XAxis dataKey="m" tick={{fontSize:10,fill:D.mu}} {...AX}/>
              <YAxis tick={{fontSize:9,fill:D.mu}} tickFormatter={v=>`${v}d`} {...AX}/>
              <Tooltip content={<TT fmt={v=>`${v} days`}/>}/>
              <Bar dataKey="annualCount" name="Annual Leave (days)" fill={D.gold} opacity={.7} radius={[4,4,0,0]}>
                <LabelList dataKey="annualCount" position="top" formatter={v=>v>0?`${v}d`:''} style={{fontSize:9,fill:D.goldDk,fontWeight:600}}/>
              </Bar>
              <Bar dataKey="sickCount" name="Sick Leave (days)" fill={D.r} opacity={.65} radius={[4,4,0,0]}>
                <LabelList dataKey="sickCount" position="top" formatter={v=>v>0?`${v}d`:''} style={{fontSize:9,fill:D.r,fontWeight:600}}/>
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card style={{padding:'14px 16px'}}>
          <Sec editable sub="ANL | SL per department">Leave by Department</Sec>
          <div style={{overflowY:'auto',maxHeight:220}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
              <thead>
                <tr style={{borderBottom:`0.5px solid ${D.br}`}}>
                  <th style={{textAlign:'left',padding:'0 0 8px',color:D.mu,fontWeight:500}}>Department</th>
                  <th style={{textAlign:'right',padding:'0 8px 8px',color:D.mu,fontWeight:500}}>N</th>
                  <th style={{textAlign:'center',padding:'0 8px 8px',color:D.goldDk,fontWeight:500}}>Annual Leave</th>
                  <th style={{textAlign:'center',padding:'0 0 8px',color:D.r,fontWeight:500}}>Sick Leave</th>
                </tr>
              </thead>
              <tbody>
                {[...depts].sort((a,b)=>b.annual-a.annual).map((d,i)=>(
                  <tr key={i} style={{borderBottom:`0.5px solid ${D.brLt}`}}>
                    <td style={{padding:'7px 0',color:D.tx,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:130}}>{d.name||d.short}</td>
                    <td style={{padding:'7px 8px',textAlign:'right',color:D.mu}}>{d.count}</td>
                    <td style={{padding:'7px 8px',textAlign:'center'}}>
                      <span style={{background:'rgba(212,150,15,.12)',color:D.goldDk,padding:'2px 8px',borderRadius:6,fontWeight:600,fontSize:11}}>{d.annualDays??0} days</span>
                    </td>
                    <td style={{padding:'7px 0',textAlign:'center'}}>
                      <span style={{background:'rgba(226,75,74,.1)',color:D.r,padding:'2px 8px',borderRadius:6,fontWeight:600,fontSize:11}}>{d.sickDays??0} days</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── EMPLOYEES ────────────────────────────────────────────────────────────────
// ─── Dept Dropdown — native select, always renders on top, no z-index issues ─
function DeptDropdown({depts, value, onChange}){
  const isAll = value==='all';
  const[open,setOpen]=useState(false);
  const[pos,setPos]=useState({top:0,left:0});
  const btnRef=useRef();
  useEffect(()=>{
    if(!open) return;
    const h=e=>{
      if(btnRef.current&&!btnRef.current.contains(e.target)&&
         !document.getElementById('dept-dropdown')?.contains(e.target))
        setOpen(false);
    };
    document.addEventListener('mousedown',h);
    return()=>document.removeEventListener('mousedown',h);
  },[open]);
  const handleOpen=()=>{
    if(btnRef.current){
      const r=btnRef.current.getBoundingClientRect();
      setPos({top:r.bottom+4, left:r.left});
    }
    setOpen(o=>!o);
  };
  const label=isAll?'All Depts':value;
  const dropdown=open&&ReactDOM.createPortal(
    <div id="dept-dropdown" style={{position:'fixed',top:pos.top,left:pos.left,
      background:D.card,borderRadius:14,boxShadow:'0 8px 32px rgba(0,0,0,.2)',
      border:`1px solid ${D.br}`,zIndex:99999,minWidth:200,padding:'6px 0',
      maxHeight:260,overflowY:'auto'}}>
      {!isAll&&(
        <button onClick={()=>{onChange('all');setOpen(false);}}
          style={{width:'100%',textAlign:'left',padding:'6px 14px',border:'none',
            background:'none',cursor:'pointer',fontSize:11,color:D.r,fontWeight:600,
            fontFamily:'Plus Jakarta Sans,sans-serif'}}>
          Clear (All Depts)
        </button>
      )}
      {['all',...depts].map(d=>(
        <div key={d} onClick={()=>{onChange(d);setOpen(false);}}
          style={{display:'flex',alignItems:'center',gap:8,padding:'7px 14px',
            cursor:'pointer',background:value===d?D.goldBg:'transparent'}}>
          <div style={{width:14,height:14,borderRadius:4,flexShrink:0,
            border:`1.5px solid ${value===d?D.gold:D.br}`,
            background:value===d?D.gold:'transparent',
            display:'flex',alignItems:'center',justifyContent:'center'}}>
            {value===d&&<svg width="9" height="9" viewBox="0 0 24 24" fill="#1a1a1a"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
          </div>
          <span style={{fontSize:12,color:D.tx,fontWeight:value===d?600:400}}>
            {d==='all'?'All Depts':d}
          </span>
        </div>
      ))}
    </div>,
    document.body
  );
  return(
    <div style={{display:'inline-block'}}>
      <button ref={btnRef} onClick={handleOpen}
        style={{
          display:'flex',alignItems:'center',gap:5,
          background:'rgba(0,0,0,.05)',
          border:`1px solid ${isAll?'transparent':D.gold}`,
          borderRadius:20,padding:'5px 12px',
          fontSize:12,fontWeight:600,
          color:isAll?D.mu:D.goldDk,
          cursor:'pointer',fontFamily:'Plus Jakarta Sans,sans-serif',
          outline:'none',
        }}>
        {label}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"
          style={{flexShrink:0,transform:open?'rotate(180deg)':'none',transition:'transform .15s'}}>
          <path d="M7 10l5 5 5-5z"/>
        </svg>
      </button>
      {dropdown}
    </div>
  );
}

function EmployeesTab({rawAtt,rawSL,empMap,holidays,yr,mo,df,q,setYr,setMo,setDf,setQ,allLocs=[]}){
  const[empLocFs,setEmpLocFs]=useState(()=>new Set());
  const days=useMemo(()=>Array.from({length:new Date(yr,mo+1,0).getDate()},(_,i)=>i+1),[yr,mo]);
  const dow=d=>new Date(yr,mo,d).getDay();
  const isWE=d=>{const w=dow(d);return w===0||w===6;};
  const isHol=d=>{const k=`${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;return !!(holidays||{})[k];};
  const isWorkday=d=>!isWE(d)&&!isHol(d);
  const DOW=['S','M','T','W','T','F','S'];

  // allEmps: unfiltered — used for building dept list so dropdown always shows all depts
  const allEmps=useMemo(()=>{
    if(rawAtt&&rawSL&&Object.keys(empMap).length>0){
      const{attRecords,leaveRecords}=processAttendance(rawAtt,rawSL,empMap);
      return buildEmployeeDailyData(attRecords,leaveRecords,empMap,yr,mo);
    }
    return [];
  },[rawAtt,rawSL,empMap,yr,mo]);

  // emps: filtered — uses independent empLocFs, not Overview's locFs
  const emps=useMemo(()=>{
    let list=[...allEmps];
    if(df!=='all') list=list.filter(e=>e.dept===df);
    if(empLocFs.size>0) list=list.filter(e=>empLocFs.has(empMap[e.nik]?.loc));
    if(q) list=list.filter(e=>e.name.toLowerCase().includes(q.toLowerCase())||e.nik.toLowerCase().includes(q.toLowerCase()));
    return list;
  },[allEmps,df,q,empLocFs,empMap]);

  // depts always from full unfiltered list — dropdown never loses options
  const depts=useMemo(()=>[...new Set(allEmps.map(e=>e.dept))].filter(Boolean).sort(),[allEmps]);

  // Priority: 1=Leave(ANL/SL) 2=Att+time 3=present_notime 4=absent
  const cell=(info,dayNum,leaveInfo)=>{
    // Weekend always shows "W" regardless of tap-in
    if(isWE(dayNum)) return{bg:'rgba(0,0,0,.025)',tx:'W',tc:'rgba(0,0,0,.18)',fw:500,isTime:false};
    // Holiday always shows "H"
    if(isHol(dayNum)) return{bg:'rgba(244,196,48,.12)',tx:'H',tc:D.goldDk,fw:600,isTime:false};

    if(!info){
      if(isWorkday(dayNum)) return{bg:D.rBg,tx:'—',tc:D.r,fw:500,isTime:false};
      return{bg:'rgba(0,0,0,.025)',tx:'',tc:'transparent',fw:400,isTime:false};
    }

    // Helper: get label+colors for any leave type
    const getLeaveStyle=(type)=>{
      const lc=LEAVE_BY_TYPE[type];
      return lc
        ?{label:lc.labelShort, bg:lc.bg, tc:lc.color}
        :{label:type?.toUpperCase()||'?', bg:'rgba(0,0,0,.06)', tc:D.mu};
    };

    // Half-day: tap-in EXISTS on same leave day
    const td=showTime(info.checkInStr,info.checkInMin);
    if(leaveInfo && td && (info.status==='ontime'||info.status==='late')){
      const ls=getLeaveStyle(leaveInfo.type);
      return{bg:ls.bg, tx:`${ls.label}+${td}`, tc:ls.tc, fw:700, isTime:true, isHalfDay:true};
    }

    // Pure leave day
    const ltype=info.status;
    if(LEAVE_BY_TYPE[ltype]){
      const ls=getLeaveStyle(ltype);
      return{bg:ls.bg, tx:ls.label, tc:ls.tc, fw:700, isTime:false};
    }

    // Attendance
    if(info.status==='ontime') return{bg:D.gBg,tx:td||'—',tc:D.gDk,fw:td?600:400,isTime:!!td};
    if(info.status==='late')   return{bg:'rgba(245,158,11,.1)',tx:td||'—',tc:'#92400E',fw:td?700:400,isTime:!!td};
    if(info.status==='present_notime') return{bg:D.gBg,tx:'—',tc:D.gDk,fw:400,isTime:false};
    if(info.status==='absent') return{bg:D.rBg,tx:'—',tc:D.r,fw:500,isTime:false};
    return{bg:'transparent',tx:'—',tc:D.mu,fw:400,isTime:false};
  };

  const sum=(e)=>{
    const dim=new Date(yr,mo+1,0).getDate();
    let eligWD=0;
    for(let d=1;d<=dim;d++){
      if(!isWorkday(d)) continue;
      if(e.joinDate){const jd=e.joinDate instanceof Date?e.joinDate:new Date(e.joinDate);if(!isNaN(jd)){const[jY,jM,jD]=[jd.getFullYear(),jd.getMonth(),jd.getDate()];if(jY>yr||(jY===yr&&jM>mo)||(jY===yr&&jM===mo&&jD>d)) continue;}}
      eligWD++;
    }
    // null-safe: e.days may be undefined/null from incomplete records
    const days=e?.days??{};
    const dayEntries=Object.entries(days).filter(([,x])=>Boolean(x));
    // p: tap-in days (ontime/late/present_notime), excluding holidays
    const p=dayEntries.filter(([d,x])=>['ontime','late','present_notime'].includes(x?.status)&&!isHol(+d)).length;
    // al: annual leave, sl: sick leave, other leave types count as leave (not absent)
    const al=dayEntries.filter(([,x])=>x?.status==='annual').length;
    const sl=dayEntries.filter(([,x])=>x?.status==='sick').length;
    const otherLeave=dayEntries.filter(([d,x])=>LEAVE_BY_TYPE[x?.status]&&x?.status!=='annual'&&x?.status!=='sick'&&!isWE(+d)&&!isHol(+d)).length;
    // l: late tap-ins, excluding holidays
    const l=dayEntries.filter(([d,x])=>x?.status==='late'&&!isHol(+d)).length;
    const a=Math.max(0,eligWD-p-al-sl-otherLeave);
    const onTimeTaps=dayEntries.filter(([d,x])=>x?.status==='ontime'&&!isHol(+d)).length;
    const attPct=eligWD>0?Math.min(100,Math.round((p/eligWD)*10000)/100):0; // capped at 100%
    const otRate=p>0?Math.round((onTimeTaps/p)*10000)/100:null; // keep 2 decimal places
    return{p,l,sl,al,a,attPct,otRate,eligWD};
  };



  const TH2={padding:'7px 4px',textAlign:'center',fontWeight:700,fontSize:9,whiteSpace:'nowrap',textTransform:'uppercase',letterSpacing:'.5px'};

  return(
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {/* Controls — compact modern pill bar */}
      <div style={{background:'rgba(255,255,255,.9)',backdropFilter:'blur(12px)',
        borderRadius:16,boxShadow:D.sh,border:`1px solid ${D.br}`,
        padding:'8px 14px',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>

        {/* Month+Year pills */}
        <div style={{display:'flex',alignItems:'center',gap:3,background:'rgba(0,0,0,.05)',borderRadius:20,padding:'3px 6px'}}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill={D.mu}><path d="M20 3h-1V1h-2v2H7V1H5v2H4c-1.11 0-1.99.9-1.99 2L2 20c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H4V8h16v11z"/></svg>
          <select value={mo} onChange={e=>setMo(+e.target.value)} style={{...sel,border:'none',background:'transparent',padding:'2px 4px',fontSize:12,fontWeight:600,color:D.tx,cursor:'pointer'}}>
            {MN.map((m,i)=><option key={i} value={i}>{m}</option>)}
          </select>
          <select value={yr} onChange={e=>setYr(+e.target.value)} style={{...sel,border:'none',background:'transparent',padding:'2px 4px',fontSize:12,fontWeight:600,color:D.tx,cursor:'pointer'}}>
            {[2024,2025,2026].map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div style={{width:1,height:16,background:D.br}}/>

        {/* Dept searchable dropdown */}
        <DeptDropdown depts={depts} value={df} onChange={setDf}/>

        <div style={{width:1,height:16,background:D.br}}/>

        {/* Location filter — independent from Overview */}
        {allLocs.length>0&&<LocMultiSelect locs={allLocs} selected={empLocFs} onChange={setEmpLocFs}/>}

        <div style={{width:1,height:16,background:D.br}}/>

        {/* Search */}
        <div style={{display:'flex',alignItems:'center',gap:5,background:'rgba(0,0,0,.05)',borderRadius:20,padding:'3px 10px',flex:1,minWidth:140}}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill={D.mu}><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name / NIK…"
            style={{border:'none',background:'transparent',outline:'none',fontSize:12,color:D.tx,fontFamily:'Plus Jakarta Sans,sans-serif',width:'100%'}}/>
          {q&&<button onClick={()=>setQ('')} style={{border:'none',background:'none',cursor:'pointer',color:D.mu,fontSize:14,lineHeight:1,padding:0}}>×</button>}
        </div>

        {/* Reset filters */}
        {(df!=='all'||q||empLocFs.size>0)&&(
          <button onClick={()=>{setDf('all');setQ('');setEmpLocFs(new Set());}} style={{padding:'4px 11px',borderRadius:20,border:`1px solid ${D.br}`,background:'transparent',fontSize:11,cursor:'pointer',color:D.mu,fontFamily:'Plus Jakarta Sans,sans-serif'}}>
            Reset ×
          </button>
        )}

        {/* Legend */}
        <div style={{display:'flex',gap:8,marginLeft:'auto',flexWrap:'wrap',alignItems:'center'}}>
          {[[D.gBg,D.gDk,'≤09:00'],['rgba(245,158,11,.1)','#92400E','>09:00'],[D.rBg,D.r,'Absent'],[D.bBg,D.b,'AL'],['rgba(245,158,11,.12)','#92400E','SL'],['rgba(0,0,0,.025)','rgba(0,0,0,.3)','W']].map(([bg,c,l])=>(
            <span key={l} style={{display:'flex',alignItems:'center',gap:3,fontSize:10,color:D.mu}}>
              <span style={{width:8,height:8,background:bg,border:`1px solid ${c}40`,borderRadius:2,display:'inline-block'}}/>{l}
            </span>
          ))}
        </div>
      </div>

      {/* Summary strip — Opsi C: inline bar */}
      {emps.length>0&&(()=>{
        const stats=emps.map(e=>({...e,...sum(e)}));
        const totalP  =stats.reduce((a,e)=>a+e.p,0);
        const totalL  =stats.reduce((a,e)=>a+e.l,0);
        const totalA  =stats.reduce((a,e)=>a+e.a,0);
        const totalAL =stats.reduce((a,e)=>a+e.al,0);
        const totalSL =stats.reduce((a,e)=>a+e.sl,0);
        const eligible=stats.filter(e=>e.eligWD>0);
        // Average of decimal attPct values, rounded once at the end
        const avgAtt=eligible.length?Math.round(eligible.reduce((a,e)=>a+e.attPct,0)/eligible.length):0;
        const lateRate=(totalP+totalL)>0?Math.round((totalL/(totalP+totalL))*100):0;
        const maxAbs  =Math.max(totalA,1);

        const items=[
          {l:'Employees',  v:emps.length, suf:'',  vc:D.tx,              bar:100,              fc:'rgba(0,0,0,.15)'},
          {l:'Avg Attend', v:avgAtt,      suf:'%', vc:avgAtt>=70?D.gDk:avgAtt>=50?D.goldDk:D.r, bar:avgAtt, fc:avgAtt>=70?D.g:avgAtt>=50?D.gold:D.r},
          {l:'Late Rate',  v:lateRate,    suf:'%', vc:lateRate<=15?D.gDk:lateRate<=30?D.goldDk:D.r, bar:lateRate, fc:lateRate<=15?D.g:lateRate<=30?D.gold:D.r},
          {l:'Absent Days',   v:totalA,  suf:' days', vc:D.tx2,    bar:Math.round((totalA/Math.max(totalA+totalP,1))*100), fc:'rgba(0,0,0,.25)'},
          {l:'Annual Leave',  v:totalAL, suf:' days', vc:D.b,      bar:Math.min(100,Math.round((totalAL/Math.max(totalAL+totalSL,1))*100)), fc:D.b},
          {l:'Sick Leave',    v:totalSL, suf:' days', vc:D.goldDk, bar:Math.min(100,Math.round((totalSL/Math.max(totalAL+totalSL,1))*100)), fc:D.gold},
        ];
        return(
          <div style={{background:D.card,border:`0.5px solid ${D.br}`,borderRadius:18,
            padding:'12px 18px',display:'flex',gap:0,alignItems:'stretch',boxShadow:D.sh}}>
            {items.map(({l,v,suf,vc,bar,fc},i)=>(
              <div key={l} style={{flex:1,display:'flex',flexDirection:'column',gap:3,
                padding:'0 16px',
                borderRight:i<items.length-1?`0.5px solid ${D.br}`:'none'}}>
                <span style={{fontSize:18,fontWeight:700,color:vc,lineHeight:1,
                  fontVariantNumeric:'tabular-nums',letterSpacing:'-.5px'}}>
                  {v}{suf}
                </span>
                <span style={{fontSize:11,color:D.mu,fontWeight:500}}>{l}</span>
                <div style={{height:3,borderRadius:99,background:'rgba(0,0,0,.08)',marginTop:4,overflow:'hidden'}}>
                  <div style={{height:3,borderRadius:99,background:fc,width:`${bar}%`,transition:'width .3s'}}/>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Grid */}
      <div style={{background:D.card,borderRadius:24,boxShadow:D.sh,border:`1px solid rgba(255,255,255,.9)`,overflow:'hidden'}}>
        <div style={{overflowX:'auto',overflowY:'auto',maxHeight:'calc(100vh - 340px)'}}>
          <table style={{borderCollapse:'collapse',fontSize:11,minWidth:'max-content',width:'100%'}}>
            <thead style={{position:'sticky',top:0,zIndex:10}}>
              <tr style={{background:D.cardDark}}>
                <th style={{...TH2,width:155,textAlign:'left',padding:'10px 16px',color:'#E0E0E0',position:'sticky',left:0,background:D.cardDark,zIndex:11}}>Employee</th>
                <th style={{...TH2,width:90,color:'#666',background:D.cardDark}}>Dept</th>
                {days.map(d=>(
                  <th key={d} style={{...TH2,width:46,minWidth:46,
                    background:isHol(d)?'#2A2000':isWE(d)?'#222':D.cardDark,
                    borderLeft:'1px solid rgba(255,255,255,.04)',
                    color:isHol(d)?D.gold:isWE(d)?'#444':D.goldDk}}>
                    <div style={{fontWeight:isWE(d)?400:700}}>{d}</div>
                    <div style={{fontSize:8,color:'#444',marginTop:1}}>{DOW[dow(d)]}</div>
                  </th>
                ))}
                {[['P','#4ADE80'],['L',D.gold],['SL','#FCD34D'],['AL','#818CF8'],['A','#FCA5A5']].map(([l,c])=>(
                  <th key={l} style={{...TH2,width:30,color:c,background:D.cardDark}}>{l}</th>
                ))}
                <th style={{...TH2,width:46,color:'#A3E635',background:D.cardDark}}>ATT%</th>
                <th style={{...TH2,width:42,color:'#67E8F9',background:D.cardDark}}>OT%</th>
              </tr>
            </thead>
            <tbody>
              {!emps.length&&<tr><td colSpan={days.length+9} style={{textAlign:'center',padding:50}}>
                <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:10}}>
                  <div style={{width:48,height:48,borderRadius:14,background:D.goldBg,display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <Icon name="employees" size={22} color={D.goldDk}/>
                  </div>
                  <p style={{fontSize:13,fontWeight:700,color:D.tx}}>{df!=='all'?`No employees in ${df}`:'No employees found'}</p>
                  <p style={{fontSize:11,color:D.mu}}>{q?`No match for "${q}"`:`${MN[mo]} ${yr} — check data source or adjust filters`}</p>
                </div>
              </td></tr>}
              {emps.map((emp,ei)=>{
                const s=sum(emp);
                const rBg=ei%2?'rgba(0,0,0,.015)':D.card;
                return(
                  <tr key={emp.nik} className="r-hover" style={{background:rBg,transition:'background .1s'}}>
                    <td style={{padding:'6px 16px',position:'sticky',left:0,
                      background: ei%2?'#F8F7F4':'#FFFFFF',
                      zIndex:5,borderBottom:`1px solid ${D.brLt}`,whiteSpace:'nowrap',
                      borderRight:`1px solid ${D.br}`,
                      boxShadow:'4px 0 12px rgba(0,0,0,.08)'}}>
                      <div style={{fontSize:11,fontWeight:700,color:D.tx}}>{emp.name}</div>
                      <div style={{fontSize:9,color:D.mu,fontFamily:'DM Mono,monospace'}}>{emp.nik}</div>
                    </td>
                    <td style={{padding:'6px 8px',fontSize:9,color:D.mu,borderBottom:`1px solid ${D.brLt}`,whiteSpace:'nowrap'}}>
                      {emp.dept?.length>14?emp.dept.slice(0,13)+'…':emp.dept}
                    </td>
                    {days.map(d=>{
                      const dayInfo=emp.days[d];
                    const leaveInfo=dayInfo?.leaveType?{type:dayInfo.leaveType}:null;
                    const{bg,tx,tc,fw,isTime,isHalfDay}=cell(dayInfo,d,leaveInfo);
                      return(
                        <td key={d} title={`${emp.name} — ${d} ${MN[mo]}: ${tx||'Weekend'}`}
                          style={{background:bg,borderBottom:`1px solid ${D.brLt}`,borderLeft:`1px solid ${D.brLt}`,
                            textAlign:'center',fontSize:isHalfDay?7.5:isTime?8.5:10,fontWeight:fw,color:tc,
                            fontFamily:isTime?'DM Mono,monospace':'inherit',padding:'3px 1px'}}>
                          {tx}
                        </td>
                      );
                    })}
                    {[[s.p,'#22C55E'],[s.l,D.gold],[s.sl,'#92400E'],[s.al,D.b],[s.a,'#EF4444']].map(([v,c],i)=>(
                      <td key={i} style={{textAlign:'center',fontWeight:700,color:c,borderBottom:`1px solid ${D.brLt}`,fontSize:10,padding:'4px 3px'}}>{v||''}</td>
                    ))}
                    <td style={{textAlign:'center',borderBottom:`1px solid ${D.brLt}`,padding:'4px 3px',fontWeight:700,fontSize:10,fontFamily:'DM Mono,monospace',color:s.attPct>=90?D.gDk:s.attPct>=70?D.goldDk:D.r}}>{s.attPct}%</td>
                    <td style={{textAlign:'center',borderBottom:`1px solid ${D.brLt}`,padding:'4px 3px',fontWeight:600,fontSize:10,fontFamily:'DM Mono,monospace',color:s.otRate==null?D.mu2:s.otRate>=90?D.gDk:s.otRate>=70?D.goldDk:D.r}}>{s.otRate==null?'—':`${s.otRate}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{padding:'9px 16px',borderTop:`1px solid ${D.br}`,fontSize:10,color:D.mu,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',background:'rgba(0,0,0,.015)',borderRadius:'0 0 24px 24px'}}>
          <span style={{marginRight:6}}><b style={{color:D.tx}}>{emps.length}</b> employees · {MN[mo]} {yr}</span>
          <span style={{width:1,height:10,background:D.br,display:'inline-block',margin:'0 2px'}}/>
          {/* Attendance states */}
          {[
            {bg:D.gBg,       tc:D.gDk,      label:'≤09:00 (Ontime)'},
            {bg:'rgba(245,158,11,.1)', tc:'#92400E', label:'>09:00 (Late)'},
            {bg:D.rBg,       tc:D.r,        label:'— (Absent)'},
            {bg:'rgba(244,196,48,.12)',tc:D.goldDk, label:'H (Holiday)'},
            {bg:'rgba(0,0,0,.025)',tc:'rgba(0,0,0,.3)', label:'W (Weekend)'},
          ].map(({bg,tc,label})=>(
            <span key={label} style={{display:'inline-flex',alignItems:'center',gap:4}}>
              <span style={{width:22,height:14,borderRadius:4,background:bg,border:`1px solid ${tc}33`,display:'inline-block',flexShrink:0}}/>
              <span style={{color:D.mu,fontSize:9}}>{label}</span>
            </span>
          ))}
          <span style={{width:1,height:10,background:D.br,display:'inline-block',margin:'0 2px'}}/>
          {/* Leave types */}
          {LEAVE_CONFIG.map(lc=>(
            <span key={lc.code} style={{display:'inline-flex',alignItems:'center',gap:4}}>
              <span style={{width:22,height:14,borderRadius:4,background:lc.bg,border:`1px solid ${lc.color}55`,display:'inline-block',flexShrink:0,
                display:'inline-flex',alignItems:'center',justifyContent:'center',
                fontSize:7,fontWeight:700,color:lc.color,letterSpacing:'-.2px'}}>{lc.labelShort}</span>
              <span style={{color:D.mu,fontSize:9}}>{lc.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── DATA SOURCE ──────────────────────────────────────────────────────────────
function DataSourceTab({status,diag,rawAtt,rawSL,empRaw,lastSync,onSync,syncing,attGid,setAttGid}){
  const[newGid,setNG]=useState(attGid);
  const attH=rawAtt?.[0]||[],slH=rawSL?.[0]||[];
  const dc=diag?.colsAtt||{},ds=diag?.colsSL||{};
  const getSample=(raw,idx)=>raw?.slice(1,4).map(r=>String(r[idx]||'')).filter(Boolean).slice(0,2).join(' / ')||'—';
  return(
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      <Card style={{background:status==='live'?D.gBg:status==='loading'?D.goldBg:D.rBg,border:`1px solid ${status==='live'?D.g:status==='loading'?D.gold:D.r}30`}}>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <div style={{width:46,height:46,borderRadius:14,background:status==='live'?D.g:status==='loading'?D.gold:D.r,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <Icon name={status==='live'?'check':status==='loading'?'refresh':'datasource'} size={22} color="#fff"/>
          </div>
          <div style={{flex:1}}>
            <p style={{fontSize:13,fontWeight:800,color:D.tx,margin:0,letterSpacing:'-.3px'}}>{status==='live'?'Connected — Live Data':status==='loading'?'Fetching…':'Demo Mode — Sheets not connected'}</p>
            <p style={{fontSize:11,color:D.mu,margin:'3px 0 0'}}>{lastSync?`Synced: ${lastSync}`:'Not synced'} · Emp: <b>{empRaw?empRaw.length-1:'—'}</b> · Att: <b>{rawAtt?rawAtt.length-1:'—'}</b> · SL: <b>{rawSL?rawSL.length-1:'—'}</b></p>
            {diag?.errors?.length>0&&<p style={{fontSize:11,color:D.r,margin:'3px 0 0',fontWeight:600}}>{diag.errors.join(' · ')}</p>}
          </div>
          <button className="btn btn-primary btn-md" onClick={()=>{setAttGid(newGid);onSync(newGid);}} disabled={syncing}>
            <Icon name="refresh" size={14} color={D.cardDark}/>{syncing?'Syncing…':'Re-sync'}
          </button>
        </div>
      </Card>
      <Card>
        <Sec>Attendance Sheet Tab GID</Sec>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <input value={newGid} onChange={e=>setNG(e.target.value)} placeholder="e.g. 607806096" style={{...sel,flex:1,fontFamily:'DM Mono,monospace'}}/>
          <button className="btn btn-primary btn-md" onClick={()=>{setAttGid(newGid);onSync(newGid);}}><Icon name="check" size={14} color={D.cardDark}/>Apply</button>
        </div>
        <p style={{fontSize:10,color:D.mu,marginTop:6}}>Active: <b style={{fontFamily:'DM Mono',color:D.tx}}>{attGid||'default'}</b> · Used: <b style={{fontFamily:'DM Mono',color:D.tx}}>{diag?.attGidUsed||'—'}</b></p>
      </Card>
      {/* Time preview */}
      {rawAtt?.length>1&&(()=>{
        const ti=dc.time??-1;if(ti===-1) return null;
        const rows=rawAtt.slice(1,9).map(row=>{const raw=String(row[ti]??'').trim();if(!raw) return null;const{minutes,display}=parseTime(raw);return{raw,display,minutes,ok:minutes!=null,late:minutes!=null&&minutes>540};}).filter(Boolean);
        const bad=rows.filter(r=>!r.ok).length;
        return(
          <Card key="tp">
            <Sec sub={`Column index ${ti} — first 8 rows`}>⏱ Time Column Parse Preview</Sec>
            {bad>0&&<div style={{background:D.goldBg,borderRadius:12,padding:10,fontSize:11,color:D.goldDk,marginBottom:12,border:`1px solid ${D.gold}30`}}>⚠ {bad}/{rows.length} rows unparseable → shown as absent</div>}
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
              <thead><tr style={{borderBottom:`1.5px solid ${D.br}`}}>{['Raw value','Parsed','Min','Status'].map(h=><th key={h} style={{textAlign:'left',padding:'6px 10px',color:D.mu,fontWeight:700,fontSize:10,textTransform:'uppercase',letterSpacing:'.5px'}}>{h}</th>)}</tr></thead>
              <tbody>{rows.map((r,i)=>(
                <tr key={i} style={{borderBottom:`1px solid ${D.brLt}`,background:i%2?'rgba(0,0,0,.015)':D.card}}>
                  <td style={{padding:'6px 10px',fontFamily:'DM Mono',fontSize:11,color:D.tx2}}>{r.raw}</td>
                  <td style={{padding:'6px 10px',fontFamily:'DM Mono',fontSize:11,fontWeight:700,color:r.ok?D.gDk:D.r}}>{r.display||'N/A'}</td>
                  <td style={{padding:'6px 10px',fontFamily:'DM Mono',fontSize:11,color:D.mu}}>{r.minutes??'—'}</td>
                  <td style={{padding:'6px 10px'}}><span style={{background:!r.ok?D.rBg:r.late?D.amBg:D.gBg,color:!r.ok?D.r:r.late?'#92400E':D.gDk,padding:'2px 9px',borderRadius:20,fontSize:10,fontWeight:700}}>{!r.ok?'❌ Unparseable':r.late?'🕐 Late':'✅ On-Time'}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </Card>
        );
      })()}
      <Card>
        <Sec>Setup Checklist</Sec>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          {[['1','Share all 3 sheets → Anyone with link → Viewer'],['2','Attendance: NIK in "Personnel ID" column'],['3','Attendance: Date in Col G, Time in Col M, Name in Col C'],['4','Paste correct Tab GID from URL (#gid=...)'],['5','Leave type in Col H: ANL, SL, IBDH, MATL, C01, C02, C04, C05, C06, C07, HAID, Unpaid'],['6','Approval status in Col AA must contain "Approved"']].map(([n,ti])=>(
            <div key={n} style={{display:'flex',gap:10,padding:'12px 14px',background:'rgba(0,0,0,.03)',borderRadius:14}}>
              <div style={{width:24,height:24,borderRadius:8,background:`linear-gradient(135deg,${D.gold},${D.gold2})`,color:D.cardDark,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:800,flexShrink:0}}>{n}</div>
              <p style={{fontSize:11,fontWeight:600,color:D.tx2,margin:0,lineHeight:1.6}}>{ti}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── ADMIN ────────────────────────────────────────────────────────────────────
// Convert Google Drive share URL to direct image URL
function gdrive2img(url) {
  if(!url) return url;
  // Extract file ID from any Google Drive URL format
  const m1 = url.match(/\/file\/d\/([^\/\?]+)/);
  const m2 = url.match(/[?&]id=([^&]+)/);
  const id = m1?m1[1]:m2?m2[1]:null;
  // Use thumbnail URL — works as background-image without redirect issues
  if(id) return `https://drive.google.com/thumbnail?id=${id}&sz=w1920`;
  return url;
}

function AdminModal({onClose,onSync,syncing,lastSync,empId,setEmpId,attId,setAttId,slId,setSlId,attGid,setAttGid,holidays,setHolidays,configHolidays={},status,diag,rawAtt,rawSL,empRaw,annualQuota=16,setAnnualQuota,sickQuota=12,setSickQuota,leaveQuotas={},setLeaveQuotas}){
  const[stage,setS]=useState('pin');const[pin,setPin]=useState('');const[err,setE]=useState(false);
  const[tab,setTab]=useState('sheets');
  const[lBannerUrl,setLBU]=useState(()=>LS.get('cfg.bannerUrl',''));
  const[lLogoUrl,setLLU]=useState(()=>LS.get('cfg.logoUrl',''));const[le,setLE]=useState(empId);const[la,setLA]=useState(attId);
  const[ls,setLS]=useState(slId);const[lg,setLG]=useState(attGid);
  const[hd,setHD]=useState('');const[hn,setHN]=useState('');const[ht,setHT]=useState('company');
  const check=()=>pin==='1234'?(setS('panel'),setE(false)):(setE(true),setPin(''));
  const inSt={...sel,width:'100%',fontFamily:'DM Mono,monospace',fontSize:11};
  const[hdEnd,setHDEnd]=useState('');
  const addH=()=>{
    if(!hd||!hn) return;
    const newH={};
    if(hdEnd&&hdEnd>hd){
      // Add each day in range
      let d=new Date(hd);const end=new Date(hdEnd);
      while(d<=end){
        const k=d.toISOString().slice(0,10);
        newH[k]={type:ht,name:hn};
        d.setDate(d.getDate()+1);
      }
    } else {
      newH[hd]={type:ht,name:hn};
    }
    setHolidays(p=>({...p,...newH}));
    setHD('');setHDEnd('');setHN('');
  };;
  const delH=k=>setHolidays(p=>{const n={...p};delete n[k];return n;});
  const hList=Object.entries(holidays||{}).sort(([a],[b])=>a.localeCompare(b));
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center',padding:20,backdropFilter:'blur(8px)'}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:D.card,borderRadius:28,padding:30,width:'100%',maxWidth:460,maxHeight:'88vh',overflowY:'auto',boxShadow:D.shLg,border:'1px solid rgba(255,255,255,.9)'}}>
        {stage==='pin'?(
          <>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:18}}>
              <div style={{width:42,height:42,borderRadius:14,background:D.goldBg,display:'flex',alignItems:'center',justifyContent:'center',border:`1px solid ${D.gold}25`}}><Icon name="settings" size={20} color={D.gold}/></div>
              <h2 style={{fontSize:17,fontWeight:800,margin:0,color:D.tx,letterSpacing:'-.4px'}}>Admin Panel</h2>
            </div>
            <p style={{fontSize:12,color:D.mu,margin:'0 0 18px',lineHeight:1.6}}>Enter 4-digit PIN to access data settings.</p>
            <input type="password" maxLength={4} value={pin} onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==='Enter'&&check()} placeholder="••••" style={{width:'100%',fontSize:26,letterSpacing:16,textAlign:'center',padding:14,borderRadius:16,border:`2px solid ${err?D.r:D.br}`,outline:'none',marginBottom:10,fontFamily:'DM Mono',background:'rgba(0,0,0,.03)'}}/>
            {err&&<p style={{color:D.r,fontSize:12,textAlign:'center',marginBottom:10,fontWeight:600}}>Wrong PIN.</p>}
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:10}}>
              <button className="btn btn-outline btn-md" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary btn-md" onClick={check}>Enter →</button>
            </div>
          </>
        ):(
          <>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:38,height:38,borderRadius:12,background:D.goldBg,display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name="settings" size={18} color={D.gold}/></div>
                <h2 style={{fontSize:16,fontWeight:800,margin:0,color:D.tx,letterSpacing:'-.4px'}}>Admin Panel</h2>
              </div>
              <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',padding:4,borderRadius:8,color:D.mu}}><Icon name="close" size={18} color={D.mu}/></button>
            </div>
            <div style={{display:'flex',gap:3,background:'rgba(0,0,0,.05)',borderRadius:14,padding:4,marginBottom:18,flexWrap:'wrap'}}>
              {[['sheets','🔗 Sources'],['calendar','📅 Holidays'],['quotas','📊 Quotas'],['diagnostics','🔍 Diag']].map(([id,lbl])=>(
                <button key={id} onClick={()=>setTab(id)} style={{flex:1,padding:'7px 6px',borderRadius:11,border:'none',cursor:'pointer',fontSize:11,fontWeight:tab===id?700:500,background:tab===id?D.card:'transparent',color:tab===id?D.tx:D.mu,boxShadow:tab===id?D.sh:'none',fontFamily:'Plus Jakarta Sans,sans-serif',minWidth:60}}>{lbl}</button>
              ))}
            </div>
            {tab==='sheets'&&(
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                <div style={{background:D.gBg,borderRadius:14,padding:12,fontSize:11,color:D.gDk,border:`1px solid ${D.g}20`,lineHeight:1.6}}>All 3 sheets must be shared as <b>"Anyone with link → Viewer"</b></div>
                {[['👤 Employee Sheet ID',le,setLE],['📊 Attendance Sheet ID',la,setLA],['📊 Attendance Tab GID',lg,setLG],['🏥 Sick & Leave Sheet ID',ls,setLS]].map(([l,v,sv],i)=>(
                  <div key={i}><label style={{fontSize:11,fontWeight:700,display:'block',marginBottom:5,color:D.tx2}}>{l}</label><input value={v} onChange={e=>sv(e.target.value)} style={inSt}/></div>
                ))}
                {lastSync&&<div style={{background:D.gBg,borderRadius:12,padding:10,fontSize:11,color:D.gDk,textAlign:'center',fontWeight:700}}>✅ Last sync: {lastSync}</div>}
                <button className="btn btn-primary btn-lg" disabled={syncing} style={{width:'100%',marginTop:4,justifyContent:'center'}} onClick={()=>{setEmpId(le);setAttId(la);setSlId(ls);setAttGid(lg);onSync(le,la,ls,lg);}}>
                  <Icon name="refresh" size={15} color={D.cardDark}/>{syncing?'Syncing…':'Sync Now'}
                </button>
                {/* Banner & Logo URL */}
                <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${D.br}`}}>
                  <p style={{fontSize:11,fontWeight:700,color:D.tx,marginBottom:10}}>🖼 Header & Logo Image</p>
                  <p style={{fontSize:10,color:D.mu,marginBottom:10,lineHeight:1.6}}>
                    Upload gambar ke Google Drive → klik kanan → <b>Share</b> → <b>Anyone with link</b> → copy link → paste di sini.
                  </p>
                  {[['Banner URL (header background)',lBannerUrl,setLBU,(v)=>{LS.set('cfg.bannerUrl',v);window.location.reload();},LS.get('cfg.bannerUrl','')],
                    ['Logo URL (icon kiri header)',   lLogoUrl,  setLLU,(v)=>{LS.set('cfg.logoUrl',v);window.location.reload();},LS.get('cfg.logoUrl','') ]
                  ].map(([lbl,lv,slv,save,current])=>(
                    <div key={lbl} style={{marginBottom:10}}>
                      <label style={{fontSize:11,fontWeight:600,color:D.tx2,display:'block',marginBottom:5}}>{lbl}</label>
                      <div style={{display:'flex',gap:7}}>
                        <input value={lv} onChange={e=>slv(e.target.value)}
                          placeholder="https://drive.google.com/file/d/..."
                          style={{...inSt,flex:1,fontSize:11}}/>
                        <button className="btn btn-primary btn-md"
                          onClick={()=>save(gdrive2img(lv))}
                          disabled={!lv}>
                          <Icon name="check" size={13} color={D.cardDark}/>Apply
                        </button>
                      </div>
                      {current&&<p style={{fontSize:10,color:D.gDk,marginTop:4}}>✅ Image set</p>}
                      {current&&<button onClick={()=>{save('');slv('');}}
                        style={{fontSize:10,color:D.r,background:'none',border:'none',cursor:'pointer',padding:0,marginTop:2}}>
                        Remove image
                      </button>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {tab==='quotas'&&(
              <div style={{display:'flex',flexDirection:'column',gap:14}}>
                <div style={{background:D.goldBg,borderRadius:12,padding:11,fontSize:11,color:D.goldDk,lineHeight:1.6}}>
                  Annual entitlement per employee. Used to calculate leave absorption (%).
                  Unpaid Leave has no quota — shows days only.
                </div>
                {LEAVE_CONFIG.filter(lc=>lc.quota!=null).map(lc=>{
                  const isANL=lc.code==='ANL', isSL=lc.code==='SL';
                  const val=isANL?annualQuota:isSL?sickQuota:(leaveQuotas[lc.code]??lc.quota);
                  const setFn=isANL?setAnnualQuota:isSL?setSickQuota:(v=>setLeaveQuotas(p=>({...p,[lc.code]:v})));
                  return(
                    <div key={lc.code} style={{background:'rgba(0,0,0,.02)',borderRadius:12,padding:'12px 14px',borderLeft:`3px solid ${lc.color}`}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                        <div style={{flex:1}}>
                          <label style={{fontSize:11,fontWeight:700,color:D.tx,display:'block',marginBottom:2}}>{lc.label}</label>
                          <p style={{fontSize:10,color:D.mu2,margin:0}}>Code: <b style={{fontFamily:'DM Mono'}}>{lc.code}</b></p>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <input type="number" min="1" max="365" value={val}
                            onChange={e=>setFn(Math.max(1,+e.target.value))}
                            style={{...inSt,width:64,textAlign:'center',fontSize:15,fontWeight:800}}/>
                          <span style={{fontSize:10,color:D.mu,whiteSpace:'nowrap'}}>days/yr</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {tab==='diagnostics'&&(
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                {/* Connection status */}
                <div style={{background:status==='live'?D.gBg:status==='loading'?D.goldBg:D.rBg,borderRadius:14,padding:14,border:`1px solid ${status==='live'?D.g:status==='loading'?D.gold:D.r}30`,display:'flex',alignItems:'center',gap:12}}>
                  <div style={{width:40,height:40,borderRadius:12,background:status==='live'?D.g:status==='loading'?D.gold:D.r,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <Icon name={status==='live'?'check':status==='loading'?'refresh':'datasource'} size={20} color="#fff"/>
                  </div>
                  <div style={{flex:1}}>
                    <p style={{fontSize:12,fontWeight:700,color:D.tx}}>{status==='live'?'Connected — Live Data':status==='loading'?'Syncing…':'Demo Mode'}</p>
                    <p style={{fontSize:11,color:D.mu,marginTop:2}}>
                      Employees: <b>{empRaw?empRaw.length-1:'—'}</b> · Attendance: <b>{rawAtt?rawAtt.length-1:'—'}</b> · Leave: <b>{rawSL?rawSL.length-1:'—'}</b>
                    </p>
                    {diag?.errors?.length>0&&<p style={{fontSize:11,color:D.r,margin:'4px 0 0',fontWeight:600}}>{diag.errors.join(' · ')}</p>}
                    {diag?.missingTime>0&&<p style={{fontSize:11,color:D.goldDk,margin:'3px 0 0'}}>⚠ {diag.missingTime} rows with no check-in time</p>}
                  </div>
                </div>
                {/* Column mapping summary */}
                <div style={{background:D.surface,borderRadius:12,padding:14}}>
                  <p style={{fontSize:11,fontWeight:700,color:D.tx,marginBottom:10}}>Column Mapping</p>
                  {[
                    ['Attendance','Date',diag?.colsAtt?.date??-1],
                    ['Attendance','Check-in Time',diag?.colsAtt?.time??-1],
                    ['Attendance','NIK',diag?.colsAtt?.nik??-1],
                    ['Leave','Leave Type (H)',diag?.colsSL?.type??-1],
                    ['Leave','Booking Date (AH)',diag?.colsSL?.date??-1],
                    ['Leave','Status (AA)',diag?.colsSL?.status??-1],
                    ['Leave','NIK (AE)',diag?.colsSL?.nik??-1],
                  ].map(([sheet,field,idx])=>(
                    <div key={field} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',borderBottom:`1px solid ${D.brLt}`}}>
                      <div style={{width:18,height:18,borderRadius:5,background:idx!==-1?D.gBg:D.rBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                        <Icon name={idx!==-1?'check':'close'} size={10} color={idx!==-1?D.gDk:D.r}/>
                      </div>
                      <span style={{fontSize:10,color:D.mu,width:70,flexShrink:0}}>{sheet}</span>
                      <span style={{fontSize:11,color:D.tx,flex:1,fontWeight:500}}>{field}</span>
                      <span style={{fontSize:10,fontFamily:'DM Mono',color:idx!==-1?D.gDk:D.r,fontWeight:700}}>col {idx!==-1?idx:'?'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab==='calendar'&&(
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                <div style={{background:D.goldBg,borderRadius:14,padding:12,fontSize:11,color:D.goldDk,border:`1px solid ${D.gold}20`,lineHeight:1.6}}>Adding holidays reduces the denominator in attendance %, making calculations accurate.</div>
                <div style={{background:'rgba(0,0,0,.03)',borderRadius:14,padding:14}}>
                  <p style={{fontSize:11,fontWeight:700,color:D.tx,marginBottom:10}}>Add Holiday / Company Leave</p>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}> 
                    {/* Row 1: Date range + type */}
                    <div style={{display:'flex',gap:7,alignItems:'center'}}>
                      <input type="date" value={hd} onChange={e=>setHD(e.target.value)}
                        style={{...inSt,flex:1}} placeholder="Start date"/>
                      <span style={{fontSize:11,color:D.mu,flexShrink:0}}>→</span>
                      <input type="date" value={hdEnd} onChange={e=>setHDEnd(e.target.value)}
                        min={hd} style={{...inSt,flex:1}} placeholder="End date"/>
                      <select value={ht} onChange={e=>setHT(e.target.value)}
                        style={{...sel,flexShrink:0}}>
                        <option value="company">Company</option>
                        <option value="public">Public</option>
                      </select>
                    </div>
                    {/* Day count badge — shown when range is valid */}
                    {hd&&(()=>{
                      const start=new Date(hd);
                      const end=hdEnd&&hdEnd>=hd?new Date(hdEnd):start;
                      const days=Math.round((end-start)/(1000*60*60*24))+1;
                      return(
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <span style={{background:D.goldBg,color:D.goldDk,fontSize:11,fontWeight:700,
                            padding:'3px 10px',borderRadius:20,border:`1px solid ${D.gold}30`}}>
                            {days} {days===1?'day':'days'}
                          </span>
                          <span style={{fontSize:10,color:D.mu}}>
                            {hdEnd&&hdEnd>hd?`${hd} → ${hdEnd}`:`${hd}`}
                          </span>
                        </div>
                      );
                    })()}
                    {/* Row 2: Name + Add button */}
                    <div style={{display:'flex',gap:7}}>
                      <input value={hn} onChange={e=>setHN(e.target.value)}
                        placeholder="e.g. Cuti Bersama HUT RI"
                        style={{...inSt,flex:1}}/>
                      <button className="btn btn-primary btn-md" onClick={addH}
                        disabled={!hd||!hn}>
                        <Icon name="check" size={13} color={D.cardDark}/>Add
                      </button>
                    </div>
                  </div>
                </div>
                <div style={{maxHeight:260,overflowY:'auto'}}>
                  <p style={{fontSize:10,fontWeight:700,color:D.mu,textTransform:'uppercase',letterSpacing:'.6px',marginBottom:8}}>{hList.length} holidays</p>
                  {hList.map(([key,h])=>(
                    <div key={key} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderBottom:`1px solid ${D.brLt}`}}>
                      <span style={{fontSize:10,fontFamily:'DM Mono',color:D.mu,width:80,flexShrink:0}}>{key}</span>
                      <span style={{fontSize:11,color:D.tx,flex:1,fontWeight:500}}>{h.name}</span>
                      <span style={{fontSize:9,fontWeight:700,padding:'2px 8px',borderRadius:12,background:h.type==='public'?D.bBg:D.goldBg,color:h.type==='public'?D.b:D.goldDk}}>{h.type==='public'?'Public':'Company'}</span>
                      <button onClick={()=>delH(key)} style={{background:'none',border:'none',cursor:'pointer',padding:'2px 4px',borderRadius:6}}><Icon name="close" size={12} color={D.r}/></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── DATE RANGE ───────────────────────────────────────────────────────────────
function DateRange({start,end,onChange,compact=false}){
  const[custom,setC]=useState(false);
  if(compact) return(
    <>
      <button onClick={()=>setC(c=>!c)} style={{padding:'4px 11px',borderRadius:16,border:'none',fontSize:11,cursor:'pointer',
        background:start?D.card:'transparent',color:start?D.goldDk:D.mu,
        boxShadow:start?D.sh:'none',fontFamily:'Plus Jakarta Sans,sans-serif',fontWeight:start?700:400,transition:'all .12s'}}>
        {start ? `${format(start,'d MMM')}→${end?format(end,'d MMM'):''}` : 'Custom'}
      </button>
      {custom&&(
        <div style={{display:'flex',alignItems:'center',gap:5,background:D.card,borderRadius:12,padding:'4px 8px',boxShadow:D.shMd,border:`1px solid ${D.br}`}}>
          <input type="date" value={start?format(start,'yyyy-MM-dd'):''} onChange={e=>onChange(e.target.value?new Date(e.target.value):null,end)} style={{...sel,fontSize:11,padding:'3px 7px',height:26}}/>
          <span style={{fontSize:10,color:D.mu}}>→</span>
          <input type="date" value={end?format(end,'yyyy-MM-dd'):''} onChange={e=>onChange(start,e.target.value?new Date(e.target.value):null)} style={{...sel,fontSize:11,padding:'3px 7px',height:26}}/>
        </div>
      )}
    </>
  );
  return null;
}

// ─── COMPARE TAB PAGE ────────────────────────────────────────────────────────
function CompareTabPage({allMonthly=[], depts=[], allTimeStats=[], attRecords=[], leaveRecords=[], empMap={}, holidays={}, allLocs=[]}){
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MNS    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Get available years from allTimeStats
  const years = [...new Set(allTimeStats.map(r=>r.year))].sort((a,b)=>b-a);
  const curY   = new Date().getFullYear();
  const curM   = new Date().getMonth();

  const[p1Year,setP1Year]=useState(()=>curY);
  const[p1Month,setP1Month]=useState(()=>curM);
  const[p2Year,setP2Year]=useState(()=>curY-1 >= (years[years.length-1]||curY-1) ? curY-1 : curY);
  const[p2Month,setP2Month]=useState(()=>curM);
  const[fullYear,setFullYear]=useState(false);
  const[deptMetric,setDeptMetric]=useState('hadir');
  // Independent location filter for Compare tab
  const[cmpLocFs,setCmpLocFs]=useState(()=>new Set());

  // Filter records by selected locations (if any)
  const cmpAttRecords=useMemo(()=>{
    if(cmpLocFs.size===0) return attRecords;
    const niks=new Set(Object.values(empMap).filter(e=>cmpLocFs.has(e.loc)).map(e=>e.nik));
    return attRecords.filter(r=>niks.has(r.nik));
  },[attRecords,empMap,cmpLocFs]);

  const cmpLeaveRecords=useMemo(()=>{
    if(cmpLocFs.size===0) return leaveRecords;
    const niks=new Set(Object.values(empMap).filter(e=>cmpLocFs.has(e.loc)).map(e=>e.nik));
    return leaveRecords.filter(r=>niks.has(r.nik));
  },[leaveRecords,empMap,cmpLocFs]);

  const cmpEmpMap=useMemo(()=>{
    if(cmpLocFs.size===0) return empMap;
    const filtered={};
    Object.entries(empMap).forEach(([nik,e])=>{ if(cmpLocFs.has(e.loc)) filtered[nik]=e; });
    return filtered;
  },[empMap,cmpLocFs]);

  // Rebuild allTimeStats from filtered records when location filter active
  const cmpAllTimeStats=useMemo(()=>{
    if(cmpLocFs.size===0) return allTimeStats;
    if(!cmpAttRecords.length) return [];
    return buildAllTimeStats(cmpAttRecords,cmpLeaveRecords,cmpEmpMap,holidays);
  },[cmpAttRecords,cmpLeaveRecords,cmpEmpMap,holidays,cmpLocFs,allTimeStats]);

  // Get stats for a period (full year avg or single month)
  const getPeriodStats = useCallback((year, month, isFull) => {
    const data = cmpAllTimeStats.filter(r=>r.year===year);
    if(!data.length) {
      // fallback to allMonthly which has sickCount/annualCount
      return allMonthly[month] || {};
    }
    if(isFull) {
      const active = data.filter(r=>r.ciCount>0);
      if(!active.length) return {};
      const avg = f => Math.round(active.reduce((a,r)=>a+(r[f]||0),0)/active.length);
      const avgDec = f => Math.round(active.reduce((a,r)=>a+(r[f]||0),0)/active.length*10)/10;
      return {
        hadir:      avgDec('hadir'),
        tepat:      avgDec('tepat'),
        avgMin:     avg('avgMin'),
        sick:       avgDec('sick'),
        annual:     avgDec('annual'),
        sickCount:  active.reduce((a,r)=>a+(r.sickCount||0),0),
        annualCount:active.reduce((a,r)=>a+(r.annualCount||0),0),
        ciCount:    active.reduce((a,r)=>a+(r.ciCount||0),0),
      };
    }
    return data.find(r=>r.year===year&&r.month===month) || {};
  },[cmpAllTimeStats,allMonthly]);

  const cm1 = useMemo(()=>getPeriodStats(p1Year, p1Month, fullYear),[getPeriodStats,p1Year,p1Month,fullYear]);
  const cm2 = useMemo(()=>getPeriodStats(p2Year, p2Month, fullYear),[getPeriodStats,p2Year,p2Month,fullYear]);
  const p1Label = fullYear ? `Full Year ${p1Year}` : `${MNS[p1Month]} ${p1Year}`;
  const p2Label = fullYear ? `Full Year ${p2Year}` : `${MNS[p2Month]} ${p2Year}`;

  // Period selector — Opsi C: mode toggle first, then selectors below
  const modeToggle = (
    <div style={{display:'flex',alignItems:'center',gap:10}}>
      <span style={{fontSize:12,color:D.mu}}>Compare by</span>
      <div style={{display:'flex',background:'rgba(0,0,0,.05)',borderRadius:10,padding:3,gap:2}}>
        {[['monthly','Monthly'],['full','Full Year']].map(([v,l])=>(
          <button key={v} onClick={()=>setFullYear(v==='full')}
            style={{padding:'4px 14px',borderRadius:8,border:'none',cursor:'pointer',
              fontSize:11,fontFamily:'Plus Jakarta Sans,sans-serif',
              background:(!fullYear&&v==='monthly')||(fullYear&&v==='full')?D.card:'transparent',
              color:(!fullYear&&v==='monthly')||(fullYear&&v==='full')?D.tx:D.mu,
              fontWeight:(!fullYear&&v==='monthly')||(fullYear&&v==='full')?600:400,
              border:(!fullYear&&v==='monthly')||(fullYear&&v==='full')?`0.5px solid ${D.br}`:'none',
              transition:'all .12s'}}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );

  const metrics = [
    {key:'hadir',      label:'Tap In Rate',   accent:D.g,      isTime:false, fmt:v=>`${v}%`},
    {key:'tepat',      label:'On-Time Rate',  accent:D.gold,   isTime:false, fmt:v=>`${v}%`},
    {key:'avgMin',     label:'Avg Tap In',    accent:D.r,      isTime:true,  fmt:m2t},
    {key:'annualDays', label:'Annual Leave',  accent:D.goldDk, isTime:false, fmt:v=>`${v}d`},
    {key:'sickDays',   label:'Sick Leave',    accent:D.b,      isTime:false, fmt:v=>`${v}d`},
  ];

  // Compute dept stats for each selected period — uses location-filtered records
  const getDeptStats = useCallback((year, month, isFull) => {
    const filtered = {
      att: cmpAttRecords.filter(r => {
        const y=r.date.getFullYear(), m=r.date.getMonth();
        return isFull ? y===year : y===year && m===month;
      }),
      leave: cmpLeaveRecords.filter(r => {
        const y=r.date.getFullYear(), m=r.date.getMonth();
        return isFull ? y===year : y===year && m===month;
      }),
    };
    if(!filtered.att.length) return [];
    return buildDeptStats(filtered.att, filtered.leave, cmpEmpMap, holidays);
  },[cmpAttRecords,cmpLeaveRecords,cmpEmpMap,holidays]);

  const p1Depts = useMemo(()=>getDeptStats(p1Year,p1Month,fullYear),[getDeptStats,p1Year,p1Month,fullYear]);
  const p2Depts = useMemo(()=>getDeptStats(p2Year,p2Month,fullYear),[getDeptStats,p2Year,p2Month,fullYear]);
  const cmpDepts = p1Depts;
  const p1ANL = useMemo(()=>p1Depts.reduce((a,d)=>a+(d.annualDays||0),0),[p1Depts]);
  const p2ANL = useMemo(()=>p2Depts.reduce((a,d)=>a+(d.annualDays||0),0),[p2Depts]);
  const p1SL  = useMemo(()=>p1Depts.reduce((a,d)=>a+(d.sickDays||0),0),[p1Depts]);
  const p2SL  = useMemo(()=>p2Depts.reduce((a,d)=>a+(d.sickDays||0),0),[p2Depts]);

  // Build dept list from union of p1+p2 depts, sorted by p1 metric
  const allDeptNames = [...new Set([...p1Depts.map(d=>d.name),...p2Depts.map(d=>d.name),...(p1Depts.length===0&&p2Depts.length===0?depts:[]).map(d=>d.name||d)])];
  const sortedDepts = allDeptNames.map(name=>{
    const d1=p1Depts.find(x=>x.name===name);
    const d2=p2Depts.find(x=>x.name===name);
    return d1||d2||{name,count:0};
  }).sort((a,b)=>(p1Depts.find(x=>x.name===b.name)?.[deptMetric]||0)-(p1Depts.find(x=>x.name===a.name)?.[deptMetric]||0));
  const deptMetricDef = metrics.find(m=>m.key===deptMetric)||metrics[0];

  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>

      {/* Period selector — Opsi C */}
      <div style={{background:D.card,border:`0.5px solid ${D.br}`,borderRadius:18,
        padding:'14px 18px',display:'flex',flexDirection:'column',gap:12,boxShadow:D.sh}}>
        {/* Row 1: mode toggle */}
        {modeToggle}
        {/* Divider */}
        <div style={{height:1,background:D.br}}/>
        {/* Row 2: period selectors inline + location filter */}
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
          <span style={{fontSize:11,fontWeight:600,color:'#4338CA',background:'rgba(99,102,241,.08)',
            border:'0.5px solid rgba(99,102,241,.25)',borderRadius:20,padding:'3px 10px'}}>Period 1</span>
          {!fullYear&&<select value={p1Month} onChange={e=>setP1Month(+e.target.value)}
            style={{...sel,fontSize:12,fontWeight:500,padding:'5px 10px'}}>
            {months.map((m,i)=><option key={i} value={i}>{m}</option>)}
          </select>}
          <select value={p1Year} onChange={e=>setP1Year(+e.target.value)}
            style={{...sel,fontSize:12,fontWeight:500,padding:'5px 10px'}}>
            {(years.length?years:[curY]).map(y=><option key={y} value={y}>{y}</option>)}
          </select>
          <span style={{fontSize:12,color:D.mu,margin:'0 6px',fontWeight:600}}>vs</span>
          <span style={{fontSize:11,fontWeight:600,color:D.goldDk,background:'rgba(239,159,39,.08)',
            border:`0.5px solid rgba(239,159,39,.3)`,borderRadius:20,padding:'3px 10px'}}>Period 2</span>
          {!fullYear&&<select value={p2Month} onChange={e=>setP2Month(+e.target.value)}
            style={{...sel,fontSize:12,fontWeight:500,padding:'5px 10px'}}>
            {months.map((m,i)=><option key={i} value={i}>{m}</option>)}
          </select>}
          <select value={p2Year} onChange={e=>setP2Year(+e.target.value)}
            style={{...sel,fontSize:12,fontWeight:500,padding:'5px 10px'}}>
            {(years.length?years:[curY]).map(y=><option key={y} value={y}>{y}</option>)}
          </select>
          {/* Location filter — independent from Overview */}
          <div style={{width:1,height:18,background:D.br,margin:'0 2px'}}/>
          <LocMultiSelect locs={allLocs} selected={cmpLocFs} onChange={setCmpLocFs}/>
          {cmpLocFs.size>0&&(
            <span style={{fontSize:10,color:D.mu}}>
              · {Object.values(cmpEmpMap).length} emp
            </span>
          )}
        </div>
      </div>

      {/* 5 Metric Cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10}}>
        {metrics.map(({key,label,accent,isTime,fmt})=>{
          const v1=key==='annualDays'?p1ANL:key==='sickDays'?p1SL:cm1[key]??0;
          const v2=key==='annualDays'?p2ANL:key==='sickDays'?p2SL:cm2[key]??0;
          const d=isTime?v2-v1:v1-v2;
          const good=isTime?d<0:d>0;
          const dStr=d===0?'No change':`${good?'▲':'▼'} ${isTime?`${Math.abs(Math.round(d))} min`:Math.abs(Math.round(d*10)/10)+'%'}`;
          return(
            <div key={key} style={{background:D.card,borderRadius:16,padding:'13px 15px',
              border:`0.5px solid ${D.br}`,boxShadow:D.sh,position:'relative',overflow:'hidden'}}>
              <div style={{position:'absolute',top:0,left:0,right:0,height:3,
                borderRadius:'16px 16px 0 0',background:accent}}/>
              <p style={{fontSize:9,fontWeight:700,color:D.mu,textTransform:'uppercase',
                letterSpacing:.8,margin:'4px 0 10px'}}>{label}</p>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                {[[v1,p1Label,'rgba(99,102,241,.08)','rgba(99,102,241,.2)','#4338CA'],[v2,p2Label,'rgba(244,196,48,.08)','rgba(244,196,48,.25)',D.goldDk]].map(([v,lbl,bg,border,tc],i)=>(
                  <div key={i} style={{background:bg,border:`1px solid ${border}`,borderRadius:10,padding:'8px 10px'}}>
                    <p style={{fontSize:8,fontWeight:700,color:tc,marginBottom:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{lbl}</p>
                    <p style={{fontSize:18,fontWeight:800,color:D.tx,letterSpacing:'-1px',lineHeight:1,
                      fontFamily:isTime?'DM Mono,monospace':'inherit',fontVariantNumeric:'tabular-nums'}}>{fmt(v)}</p>
                    {i===0&&<div style={{marginTop:5,display:'inline-flex',background:d===0?'rgba(0,0,0,.06)':good?D.gBg:D.rBg,borderRadius:20,padding:'2px 7px'}}>
                      <span style={{fontSize:9,fontWeight:700,color:d===0?D.mu:good?D.gDk:D.r}}>{dStr}</span>
                    </div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Department table with metric toggle */}
      <Card>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,flexWrap:'wrap',gap:8}}>
          <Sec sub={`${p1Label} vs ${p2Label}`}>Department Comparison</Sec>
          <div style={{display:'flex',gap:3,background:'rgba(0,0,0,.05)',borderRadius:20,padding:3}}>
            {metrics.map(({key,label})=>(
              <button key={key} onClick={()=>setDeptMetric(key)}
                style={{padding:'4px 10px',borderRadius:16,border:'none',cursor:'pointer',fontSize:10,
                  fontWeight:deptMetric===key?700:400,
                  background:deptMetric===key?D.card:'transparent',
                  color:deptMetric===key?D.goldDk:D.mu,
                  boxShadow:deptMetric===key?D.sh:'none',
                  fontFamily:'Plus Jakarta Sans,sans-serif',transition:'all .12s'}}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
            <thead>
              <tr style={{borderBottom:`2px solid ${D.br}`}}>
                <th style={{textAlign:'left',padding:'8px 12px',color:D.mu,fontWeight:700,fontSize:10,textTransform:'uppercase',letterSpacing:'.7px'}}>Department</th>
                <th style={{textAlign:'center',padding:'8px 12px',color:D.mu,fontWeight:700,fontSize:10,textTransform:'uppercase',letterSpacing:'.7px'}}>N</th>
                <th style={{textAlign:'center',padding:'8px 12px',color:'#4338CA',fontWeight:700,fontSize:10,textTransform:'uppercase',letterSpacing:'.7px'}}>{p1Label}</th>
                <th style={{textAlign:'center',padding:'8px 12px',color:D.goldDk,fontWeight:700,fontSize:10,textTransform:'uppercase',letterSpacing:'.7px'}}>{p2Label}</th>
                <th style={{textAlign:'center',padding:'8px 12px',color:D.mu,fontWeight:700,fontSize:10,textTransform:'uppercase',letterSpacing:'.7px'}}>Change</th>
              </tr>
            </thead>
            <tbody>
              {sortedDepts.map((d,i)=>{
                // Use actual period-specific dept data
                const dp1 = p1Depts.find(x=>x.name===d.name)||{};
                const dp2 = p2Depts.find(x=>x.name===d.name)||{};
                const v1 = dp1[deptMetric]??0;
                const v2 = dp2[deptMetric]??0;
                const diff = deptMetricDef.isTime?v2-v1:v1-v2;
                const good = deptMetricDef.isTime?diff<0:diff>0;
                const dStr = diff===0?'—':good?`▲ +${Math.abs(Math.round(diff))}%`:`▼ ${Math.abs(Math.round(diff))}%`;
                const[chipC,chipBg]=diff===0?[D.mu,'rgba(0,0,0,.06)']:good?[D.gDk,D.gBg]:[D.r,D.rBg];
                return(
                  <tr key={i} className="r-hover" style={{borderBottom:`1px solid ${D.brLt}`}}>
                    <td style={{padding:'9px 12px',fontWeight:600,color:D.tx}}>{d.name}</td>
                    <td style={{padding:'9px 12px',textAlign:'center',color:D.mu}}>{(p1Depts.find(x=>x.name===d.name)||p2Depts.find(x=>x.name===d.name)||d).count||'—'}</td>
                    <td style={{padding:'9px 12px',textAlign:'center',fontWeight:700,
                      fontFamily:deptMetricDef.isTime?'DM Mono,monospace':'inherit',
                      color:deptMetricDef.isTime?v1>=540?D.r:D.gDk:deptMetricDef.key.includes('Days')?D.goldDk:v1>=70?D.gDk:v1>=40?D.goldDk:D.r}}>
                      {deptMetricDef.isTime?m2t(v1):deptMetricDef.fmt?deptMetricDef.fmt(v1):`${v1}%`}
                    </td>
                    <td style={{padding:'9px 12px',textAlign:'center',fontWeight:600,
                      color:deptMetricDef.isTime?D.mu:deptMetricDef.key.includes('Days')?D.mu:v2>=70?D.gDk:v2>=40?D.goldDk:D.r}}>
                      {deptMetricDef.isTime?m2t(v2):deptMetricDef.fmt?deptMetricDef.fmt(v2):`${v2}%`}
                    </td>
                    <td style={{padding:'9px 12px',textAlign:'center'}}>
                      <span style={{background:chipBg,color:chipC,padding:'3px 9px',
                        borderRadius:20,fontSize:10,fontWeight:700}}>{dStr}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Fetch global config from Google Sheets Config tabs ─────────────────────
const CONFIG_SHEET_ID = '1tolJ6KfjF9RQwEb6Sv-WraZctm8SD7PzYswTaj5x5VQ';
const CONFIG_HOL_GID  = '168585636';
const CONFIG_SET_GID  = '389494663';

async function fetchConfig() {
  const result = { holidays: {}, settings: {} };
  const base = `https://docs.google.com/spreadsheets/d/${CONFIG_SHEET_ID}/export?format=csv&gid=`;
  try {
    const rows = (await (await fetch(base + CONFIG_HOL_GID)).text())
      .trim().split('\n').slice(1);
    for (const row of rows) {
      const [a,b,c] = row.split(',').map(x=>x.trim().replace(/^"|"$/g,''));
      if(a && b) result.holidays[a] = { name: b, type: c||'company' };
    }
  } catch(e) {}
  try {
    const rows = (await (await fetch(base + CONFIG_SET_GID)).text())
      .trim().split('\n').slice(1);
    for (const row of rows) {
      const i = row.indexOf(',');
      if(i===-1) continue;
      const k = row.slice(0,i).trim().replace(/^"|"$/g,'');
      const v = row.slice(i+1).trim().replace(/^"|"$/g,'');
      if(k){
        let val=v;
        if((k==='banner_url'||k==='logo_url')&&v.includes('drive.google.com')){
          const m1=v.match(/\/file\/d\/([^\/\?]+)/);
          const m2=v.match(/[?&]id=([^&]+)/);
          const id=m1?m1[1]:m2?m2[1]:null;
          if(id) val=`https://drive.google.com/thumbnail?id=${id}&sz=w1920`;
        }
        result.settings[k]=val;
      }
    }
  } catch(e) {}
  return result;
}


// ─── TABS ─────────────────────────────────────────────────────────────────────
const TABS=[{id:'overview',icon:'overview',label:'Overview'},{id:'compare',icon:'checkin',label:'Comparison'},{id:'departments',icon:'departments',label:'Departments'},{id:'leave',icon:'leave',label:'Leave'},{id:'employees',icon:'employees',label:'Employees'}];

// ─── LOCATION MULTI-SELECT ───────────────────────────────────────────────────
function LocMultiSelect({locs=[], selected=new Set(), onChange}){
  const[open,setOpen]=useState(false);
  const[pos,setPos]=useState({top:0,left:0});
  const btnRef=useRef();
  useEffect(()=>{
    if(!open) return;
    const h=e=>{
      if(btnRef.current&&!btnRef.current.contains(e.target)&&
         !document.getElementById('loc-dropdown')?.contains(e.target))
        setOpen(false);
    };
    document.addEventListener('mousedown',h);
    return()=>document.removeEventListener('mousedown',h);
  },[open]);
  const toggle=l=>{
    const n=new Set(selected);
    if(n.has(l)) n.delete(l); else n.add(l);
    onChange(n);
  };
  const handleOpen=()=>{
    if(btnRef.current){
      const r=btnRef.current.getBoundingClientRect();
      setPos({top:r.bottom+4, left:r.left});
    }
    setOpen(o=>!o);
  };
  const label=selected.size===0?'All Locations':selected.size===1?[...selected][0]:`${selected.size} Locations`;
  const dropdown=open&&ReactDOM.createPortal(
    <div id="loc-dropdown" style={{position:'fixed',top:pos.top,left:pos.left,
      background:D.card,borderRadius:14,boxShadow:'0 8px 32px rgba(0,0,0,.2)',
      border:`1px solid ${D.br}`,zIndex:99999,minWidth:180,padding:'6px 0',
      maxHeight:220,overflowY:'auto'}}>
      {selected.size>0&&(
        <button onClick={()=>onChange(new Set())}
          style={{width:'100%',textAlign:'left',padding:'6px 14px',border:'none',
            background:'none',cursor:'pointer',fontSize:11,color:D.r,fontWeight:600,
            fontFamily:'Plus Jakarta Sans,sans-serif'}}>
          Clear all
        </button>
      )}
      {locs.map(l=>(
        <div key={l} onClick={()=>toggle(l)}
          style={{display:'flex',alignItems:'center',gap:8,padding:'7px 14px',
            cursor:'pointer',background:selected.has(l)?D.goldBg:'transparent'}}>
          <div style={{width:14,height:14,borderRadius:4,flexShrink:0,
            border:`1.5px solid ${selected.has(l)?D.gold:D.br}`,
            background:selected.has(l)?D.gold:'transparent',
            display:'flex',alignItems:'center',justifyContent:'center'}}>
            {selected.has(l)&&<svg width="9" height="9" viewBox="0 0 24 24" fill="#1a1a1a"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
          </div>
          <span style={{fontSize:12,color:D.tx,fontWeight:selected.has(l)?600:400}}>{l}</span>
        </div>
      ))}
    </div>,
    document.body
  );
  return(
    <div style={{display:'inline-block'}}>
      <button ref={btnRef} onClick={handleOpen}
        style={{
          display:'flex',alignItems:'center',gap:5,
          background:selected.size>0?'rgba(0,0,0,.05)':'rgba(0,0,0,.05)',
          border:`1px solid ${selected.size>0?D.gold:'transparent'}`,
          borderRadius:20,padding:'5px 12px',
          fontSize:12,fontWeight:600,
          color:selected.size>0?D.goldDk:D.mu,
          cursor:'pointer',fontFamily:'Plus Jakarta Sans,sans-serif',
          outline:'none',
        }}>
        {label}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"
          style={{flexShrink:0,transform:open?'rotate(180deg)':'none',transition:'transform .15s'}}>
          <path d="M7 10l5 5 5-5z"/>
        </svg>
      </button>
      {dropdown}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App(){
  // ── State init: config hardcoded, preferences from localStorage ─────────────
  const now0=new Date();
  // UI preferences — localStorage per browser (ok to reset)
  const[tab,setTab]=useState(()=>LS.get('pref.tab','overview'));
  const[deptF,setDF]=useState(()=>LS.get('pref.deptF','all'));
  const[locFs,setLFs]=useState(()=>{ const v=LS.get('pref.locFs',[]); return new Set(v); });
  const[qF,setQF]=useState(()=>LS.get('pref.qF','all'));
  const[sidebarOpen,setSidebarOpen]=useState(()=>LS.get('pref.sidebar',true));
  const[empYr,setEmpYr]=useState(()=>LS.get('pref.empYr',now0.getFullYear()));
  const[empMo,setEmpMo]=useState(()=>LS.get('pref.empMo',now0.getMonth()));
  const[empDf,setEmpDf]=useState(()=>LS.get('pref.empDf','all'));
  // Banner & logo — localStorage per browser (personal preference)
  const[banner,setBanner]=useState(()=>LS.get('cfg.banner',null));
  const[logo,setLogo]=useState(()=>LS.get('cfg.logo',null));
  // Config — HARDCODED, always consistent across all users/devices
  const[empId,setEmpId]=useState('1tolJ6KfjF9RQwEb6Sv-WraZctm8SD7PzYswTaj5x5VQ');
  const[empGid,setEmpGid]=useState('0');
  const[attId,setAttId]=useState(SHEET_IDS.attendance);
  const[slId,setSlId]=useState(SHEET_IDS.sickLeave);
  const[attGid,setAttGid]=useState('607806096');
  const[holidays,setHolidays]=useState(DEFAULT_HOLIDAYS);
  const[configHolidays,setConfigHolidays]=useState({});
  const[configSettings,setConfigSettings]=useState({});
  const[annualQuota,setAnnualQuota]=useState(()=>LS.get('cfg.annualQuota',16));
  const[sickQuota,setSickQuota]=useState(()=>LS.get('cfg.sickQuota',12));
  const[leaveQuotas,setLeaveQuotas]=useState(()=>LS.get('cfg.leaveQuotas',{}));
  // Runtime state
  const[compareMode,setCompare]=useState(false);
  const[cmpPeriod1,setCmp1]=useState(null);const[cmpPeriod2,setCmp2]=useState(null);
  const[sd,setSd]=useState(null);const[ed,setEd]=useState(null);const[admin,setAdmin]=useState(false);
  const[syncing,setSyn]=useState(false);const[lastSync,setLastSync]=useState(null);const[status,setSt]=useState('idle');
  const[empQ,setEmpQ]=useState('');
  const[empRaw,setER]=useState(null);const[rawAtt,setRA]=useState(null);const[rawSL,setSL]=useState(null);
  const[diag,setDiag]=useState({});
  const bannerRef=useRef();const logoRef=useRef();

  // ── Persist UI preferences to localStorage (per browser, ok to reset) ──────
  useEffect(()=>LS.set('pref.tab',tab),[tab]);
  useEffect(()=>LS.set('pref.deptF',deptF),[deptF]);
  useEffect(()=>LS.set('pref.locFs',[...locFs]),[locFs]);
  useEffect(()=>LS.set('pref.qF',qF),[qF]);
  useEffect(()=>LS.set('pref.sidebar',sidebarOpen),[sidebarOpen]);
  useEffect(()=>LS.set('pref.empYr',empYr),[empYr]);
  useEffect(()=>LS.set('pref.empMo',empMo),[empMo]);
  useEffect(()=>LS.set('pref.empDf',empDf),[empDf]);
  useEffect(()=>LS.set('cfg.annualQuota',annualQuota),[annualQuota]);
  useEffect(()=>LS.set('cfg.sickQuota',sickQuota),[sickQuota]);
  useEffect(()=>LS.set('cfg.leaveQuotas',leaveQuotas),[leaveQuotas]);
  // Banner & logo — personal, per browser
  useEffect(()=>{ if(banner) LS.set('cfg.banner',banner); else LS.remove('cfg.banner'); },[banner]);
  useEffect(()=>{ if(logo)   LS.set('cfg.logo',logo);     else LS.remove('cfg.logo');   },[logo]);

  // Fetch global config from Google Sheets on mount
  useEffect(()=>{
    fetchConfig().then(cfg=>{
      if(Object.keys(cfg.holidays).length > 0) setConfigHolidays(cfg.holidays);
      if(Object.keys(cfg.settings).length  > 0) setConfigSettings(cfg.settings);
    }).catch(()=>{});
  },[]);

  const doFetch=useCallback(async(eid=empId,aid=attId,sid=slId,gid=attGid)=>{
    setSyn(true);setSt('loading');setDiag({});
    try{
      const{empRaw:er,attRaw:ar,slRaw:sr,diag:d}=await fetchAllSheets(gid);
      const{map}=buildEmpMap(er||[]);
      const{diag:pd}=processAttendance(ar||[],sr||[],map,{});
      setER(er);setRA(ar);setSL(sr);
      setDiag({...d,colsAtt:pd.colsAtt,colsSL:pd.colsSL,unregisteredNIKs:pd.unregisteredNIKs,missingTime:pd.missingTime});
      setSt(er?.length>1||ar?.length>1?'live':'error');
      setLastSync(new Date().toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}));
    }catch(e){setDiag(p=>({...p,errors:[...(p.errors||[]),e.message]}));setSt('error');}
    finally{setSyn(false);}
  },[empId,attId,slId,attGid]);

  useEffect(()=>{doFetch();},[]);

  const{empMapObj,empTotal}=useMemo(()=>{if(!empRaw?.length) return{empMapObj:{},empTotal:0};const{map,totalEmp}=buildEmpMap(empRaw);return{empMapObj:map,empTotal:totalEmp};},[empRaw]);

  const{attRecords,leaveRecords,procDiag}=useMemo(()=>{
    if(status==='live'&&rawAtt?.length&&rawSL?.length){const res=processAttendance(rawAtt,rawSL,empMapObj,{startDate:sd,endDate:ed});return{attRecords:res.attRecords,leaveRecords:res.leaveRecords,procDiag:res.diag};}
    return{attRecords:[],leaveRecords:[],procDiag:{}};
  },[status,rawAtt,rawSL,empMapObj,sd,ed]);

  // Unfiltered records for Compare tab (no date range restriction)
  const{attRecords:allAttRecords,leaveRecords:allLeaveRecords}=useMemo(()=>{
    if(status==='live'&&rawAtt?.length&&rawSL?.length){const res=processAttendance(rawAtt,rawSL,empMapObj,{startDate:null,endDate:null});return{attRecords:res.attRecords,leaveRecords:res.leaveRecords};}
    return{attRecords:[],leaveRecords:[]};
  },[status,rawAtt,rawSL,empMapObj]);

  // Merged holidays: hardcoded defaults + Config sheet + admin-added
  const mergedHolidays = useMemo(()=>({
    ...DEFAULT_HOLIDAYS,
    ...configHolidays,
    ...holidays,
  }),[configHolidays, holidays]);

  // All-time monthly stats for multi-year Compare tab
  const allTimeStats = useMemo(()=>{
    if(!attRecords.length) return [];
    return buildAllTimeStats(attRecords, leaveRecords, empMapObj, mergedHolidays);
  },[attRecords, leaveRecords, empMapObj, mergedHolidays]);

  const{depts,monthly,daily,ciDist}=useMemo(()=>({
    depts:  buildDeptStats(attRecords,leaveRecords,empMapObj,mergedHolidays),
    monthly:buildMonthlyStats(attRecords,leaveRecords,empMapObj,mergedHolidays),
    daily:  buildDailyStats(attRecords),
    ciDist: buildCIDistribution(attRecords),
  }),[attRecords,leaveRecords,empMapObj,mergedHolidays]);

  // Dept+loc filtered records for Overview charts
  const filteredAttRecords=useMemo(()=>{
    const niks = (deptF==='all'&&locFs.size===0) ? null :
      new Set(Object.values(empMapObj).filter(e=>
        (deptF==='all'||e.dept===deptF)&&(locFs.size===0||locFs.has(e.loc))
      ).map(e=>e.nik));
    return attRecords.filter(r=>{
      if(niks&&!niks.has(r.nik)) return false;
      if(sd&&r.date<sd) return false;
      if(ed&&r.date>ed) return false;
      return true;
    });
  },[attRecords,empMapObj,deptF,locFs,sd,ed]);

  const filteredLeaveRecords=useMemo(()=>{
    const niks = (deptF==='all'&&locFs.size===0) ? null :
      new Set(Object.values(empMapObj).filter(e=>
        (deptF==='all'||e.dept===deptF)&&(locFs.size===0||locFs.has(e.loc))
      ).map(e=>e.nik));
    return leaveRecords.filter(r=>{
      if(niks&&!niks.has(r.nik)) return false;
      if(sd&&r.date<sd) return false;
      if(ed&&r.date>ed) return false;
      return true;
    });
  },[leaveRecords,empMapObj,deptF,locFs,sd,ed]);

  // Filtered empMap — only employees matching dept+loc filter
  const filteredEmpMap=useMemo(()=>{
    if(deptF==='all'&&locFs.size===0) return empMapObj;
    const filtered={};
    Object.entries(empMapObj).forEach(([nik,e])=>{
      if((deptF==='all'||e.dept===deptF)&&(locFs.size===0||locFs.has(e.loc)))
        filtered[nik]=e;
    });
    return filtered;
  },[empMapObj,deptF,locFs]);

  // Recompute daily/ciDist/monthly with filtered records AND filtered empMap
  const{fDaily,fCiDist,fMonthly}=useMemo(()=>({
    fDaily:   buildDailyStats(filteredAttRecords),
    fCiDist:  buildCIDistribution(filteredAttRecords),
    fMonthly: buildMonthlyStats(filteredAttRecords,filteredLeaveRecords,filteredEmpMap,mergedHolidays),
  }),[filteredAttRecords,filteredLeaveRecords,filteredEmpMap,mergedHolidays]);

  const allLocs=useMemo(()=>[...new Set(Object.values(empMapObj).map(e=>e.loc).filter(Boolean))].sort(),[empMapObj]);

  // fDepts — rebuilt from filtered records so locFs actually affects total & all dept metrics
  const fDepts=useMemo(()=>
    buildDeptStats(filteredAttRecords,filteredLeaveRecords,filteredEmpMap,mergedHolidays)
  ,[filteredAttRecords,filteredLeaveRecords,filteredEmpMap,mergedHolidays]);

  const fD=useMemo(()=>fDepts.filter(d=>d.name&&d.name!=='Unknown'&&(deptF==='all'||d.name===deptF)),[fDepts,deptF]);
  const fM=useMemo(()=>{const idx=Q[qF]||Q.all;return monthly.filter((_,i)=>idx.includes(i));},[monthly,qF]);
  const tot=fD.reduce((a,d)=>a+d.count,0);
  const mergedDiag={...diag,colsAtt:procDiag?.colsAtt||diag?.colsAtt,colsSL:procDiag?.colsSL||diag?.colsSL,missingTime:procDiag?.missingTime||diag?.missingTime};

  const handleImg=(ref,setter)=>{const f=ref.current?.files?.[0];if(!f) return;const r=new FileReader();r.onload=ev=>setter(ev.target.result);r.readAsDataURL(f);};

  return(
    <ErrorBoundary>
    <div style={{display:'flex',height:'100vh',overflow:'hidden',background:'linear-gradient(145deg,#F5F2E9 0%,#EAE7DF 50%,#E0DDD6 100%)',fontFamily:"'Plus Jakarta Sans',sans-serif",color:D.tx,position:'relative'}}>

      {/* ── SIDEBAR — cream/white theme, collapsible ── */}
      <nav style={{
        width: sidebarOpen ? 220 : 64,
        background: '#FAFAF7',
        display:'flex', flexDirection:'column', flexShrink:0, zIndex:20,
        borderRight:`1px solid ${D.br}`,
        boxShadow:'2px 0 12px rgba(0,0,0,.05)',
        transition:'width .25s cubic-bezier(.4,0,.2,1)',
        overflow:'hidden',
      }}>
        {/* Brand + collapse toggle — button always visible in both states */}
        <div style={{padding:'18px 14px 14px',borderBottom:`1px solid ${D.br}`,
          display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
          <div style={{width:36,height:36,borderRadius:12,background:`linear-gradient(135deg,${D.gold},${D.gold2})`,
            display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,boxShadow:D.shGold}}>
            <Icon name="employees" size={19} color="#1A1A1A"/>
          </div>
          {sidebarOpen && (
            <div style={{flex:1,minWidth:0}}>
              <SidebarEditableText storageKey="app.name" defaultLabel="IDN People"
                textStyle={{fontSize:14,fontWeight:800,color:D.tx,letterSpacing:'-.4px',lineHeight:1}}/>
              <SidebarEditableText storageKey="app.subtitle" defaultLabel="HR Analytics"
                textStyle={{fontSize:9,color:D.mu,marginTop:3,fontWeight:600,letterSpacing:'.8px',textTransform:'uppercase'}}/>
            </div>
          )}
          {/* Toggle button — always visible. ‹ when open (collapse), › when closed (expand) */}
          <button
            onClick={()=>setSidebarOpen(o=>!o)}
            aria-label={sidebarOpen?'Collapse sidebar':'Expand sidebar'}
            title={sidebarOpen?'Collapse sidebar':'Expand sidebar'}
            style={{
              width:28,height:28,borderRadius:9,border:`1px solid ${D.br}`,
              background:D.card,cursor:'pointer',display:'flex',alignItems:'center',
              justifyContent:'center',flexShrink:0,boxShadow:D.sh,
              marginLeft:sidebarOpen?'auto':'0',transition:'all .15s',
            }}>
            {/* Arrow rotates: pointing left = collapse, pointing right = expand */}
            <svg width={14} height={14} viewBox="0 0 24 24" fill={D.mu}
              style={{transition:'transform .25s ease',transform:sidebarOpen?'rotate(0deg)':'rotate(180deg)'}}>
              <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
            </svg>
          </button>
        </div>


        {/* Nav links */}
        <div style={{flex:1,padding:'10px 8px',overflowY:'auto',display:'flex',flexDirection:'column',gap:2}}>
          {sidebarOpen && <p style={{fontSize:9,fontWeight:700,color:D.mu2,textTransform:'uppercase',letterSpacing:'1px',padding:'6px 8px 4px',whiteSpace:'nowrap'}}>Navigation</p>}
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} title={!sidebarOpen?t.label:undefined}
              style={{display:'flex',alignItems:'center',gap:10,width:'100%',
                padding: sidebarOpen ? '9px 10px' : '9px 0',
                justifyContent: sidebarOpen ? 'flex-start' : 'center',
                borderRadius:12,border:'none',cursor:'pointer',textAlign:'left',
                background: tab===t.id ? D.goldBg : 'transparent',
                color: tab===t.id ? D.goldDk : D.mu,
                transition:'all .15s',
              }}>
              <div style={{
                width:34,height:34,borderRadius:11,flexShrink:0,
                display:'flex',alignItems:'center',justifyContent:'center',
                background: tab===t.id ? `rgba(244,196,48,.18)` : 'rgba(0,0,0,.04)',
                border: tab===t.id ? `1px solid ${D.gold}35` : '1px solid transparent',
                boxShadow: tab===t.id ? D.shGold : 'none',
                transition:'all .15s',
              }}>
                <Icon name={t.icon} size={17} color={tab===t.id ? D.goldDk : D.mu}/>
              </div>
              {sidebarOpen && <>
                <span style={{fontSize:12,fontWeight:tab===t.id?700:500,letterSpacing:'-.1px',whiteSpace:'nowrap',color:tab===t.id?D.tx:D.tx2}}>{t.label}</span>
                {tab===t.id && <div style={{marginLeft:'auto',width:4,height:18,borderRadius:3,background:D.gold,boxShadow:`0 2px 8px ${D.gold}50`}}/>}
              </>}
            </button>
          ))}
        </div>

        {/* Developer credit */}
        {sidebarOpen && (
          <div style={{padding:'10px 16px',borderTop:`1px solid ${D.br}`}}>
            <p style={{fontSize:9,fontWeight:700,color:D.mu2,textTransform:'uppercase',letterSpacing:'1px',margin:'0 0 4px',whiteSpace:'nowrap'}}>Developed by</p>
            <SidebarEditableText storageKey="app.developer" defaultLabel="Rahmat Dwi Syaputra"
              textStyle={{fontSize:12,fontWeight:600,color:D.tx,letterSpacing:'.2px'}}/>
          </div>
        )}

        {/* System actions */}
        <div style={{padding:'8px 8px 14px',borderTop:`1px solid ${D.br}`,display:'flex',flexDirection:'column',gap:2}}>
          {sidebarOpen && <p style={{fontSize:9,fontWeight:700,color:D.mu2,textTransform:'uppercase',letterSpacing:'1px',padding:'4px 8px 4px',whiteSpace:'nowrap'}}>System</p>}
          {[{icon:'settings',label:'Admin Panel',fn:()=>setAdmin(true)},{icon:'refresh',label:syncing?'Syncing…':'Refresh',fn:()=>doFetch(),disabled:syncing}].map(({icon,label,fn,disabled})=>(
            <button key={label} onClick={fn} disabled={disabled} title={!sidebarOpen?label:undefined}
              style={{display:'flex',alignItems:'center',gap:10,width:'100%',
                padding: sidebarOpen ? '9px 10px' : '9px 0',
                justifyContent: sidebarOpen ? 'flex-start' : 'center',
                borderRadius:12,border:'none',cursor:disabled?'not-allowed':'pointer',
                background:'transparent',color:D.mu,opacity:disabled?.5:1,transition:'all .15s',
              }}>
              <div style={{width:34,height:34,borderRadius:11,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.04)',border:'1px solid transparent'}}>
                <Icon name={icon} size={17} color={D.mu}/>
              </div>
              {sidebarOpen && <span style={{fontSize:12,fontWeight:500,whiteSpace:'nowrap',color:D.tx2}}>{label}</span>}
            </button>
          ))}
          {/* Status dot */}
          <div style={{margin:'4px 2px 0',padding: sidebarOpen ? '8px 10px' : '8px 0',background:'rgba(0,0,0,.04)',borderRadius:12,display:'flex',alignItems:'center',justifyContent:sidebarOpen?'flex-start':'center',gap:8}}>
            <div style={{width:8,height:8,borderRadius:'50%',background:status==='live'?D.g:status==='loading'?D.gold:D.r,boxShadow:`0 0 0 3px ${status==='live'?D.g+'22':status==='loading'?D.gold+'22':D.r+'22'}`,flexShrink:0}}/>
            {sidebarOpen && <span style={{fontSize:10,color:D.mu,fontWeight:600,whiteSpace:'nowrap'}}>{status==='live'?`Live · ${empTotal||tot} emp`:status==='loading'?'Loading data…':'Connecting…'}</span>}
          </div>
        </div>
      </nav>

      {/* Expand button — visible when sidebar is collapsed */}
      {!sidebarOpen && (
        <button onClick={()=>setSidebarOpen(true)} title="Expand sidebar"
          style={{position:'absolute',left:54,top:'50%',transform:'translateY(-50%)',
            width:26,height:26,borderRadius:'50%',background:D.card,
            border:`1px solid ${D.br}`,cursor:'pointer',display:'flex',
            alignItems:'center',justifyContent:'center',
            boxShadow:'2px 0 8px rgba(0,0,0,.12)',zIndex:25,
          }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill={D.mu}>
            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/>
          </svg>
        </button>
      )}

      {/* ── MAIN ── */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}}>

        {/* BANNER */}
        <div style={{position:'relative',height:158,flexShrink:0,overflow:'hidden',cursor:'pointer',
          background:(configSettings.banner_url||LS.get('cfg.bannerUrl','')||banner)?`url(${configSettings.banner_url||LS.get('cfg.bannerUrl','')||banner}) center/cover no-repeat`:'linear-gradient(120deg,#1A1A1A 0%,#1C1C14 60%,#1A1400 100%)'}}
          onClick={()=>bannerRef.current?.click()}>
          <div style={{position:'absolute',inset:0,background:'linear-gradient(100deg,rgba(26,26,26,.85) 0%,rgba(26,26,26,.45) 100%)'}}/>
          <input ref={bannerRef} type="file" accept="image/*" style={{display:'none'}} onChange={()=>handleImg(bannerRef,setBanner)}/>
          <button onClick={e=>{e.stopPropagation();bannerRef.current?.click();}} style={{position:'absolute',top:14,right:14,display:'flex',alignItems:'center',gap:6,background:'rgba(255,255,255,.07)',border:'1px solid rgba(255,255,255,.13)',borderRadius:12,padding:'6px 13px',cursor:'pointer',color:'rgba(255,255,255,.55)',fontSize:10,fontWeight:700,backdropFilter:'blur(8px)',letterSpacing:'.3px'}}>
            <Icon name="upload" size={12} color="rgba(255,255,255,.55)"/> Change Banner
          </button>
          <div style={{position:'relative',zIndex:1,padding:'20px 26px',height:'100%',display:'flex',flexDirection:'column',justifyContent:'space-between'}}>
            <div style={{display:'flex',alignItems:'flex-start',gap:16}}>
              {/* Logo */}
              <div style={{position:'relative',cursor:'pointer',flexShrink:0}} onClick={e=>{e.stopPropagation();logoRef.current?.click();}}>
                <div style={{width:80,height:80,borderRadius:22,overflow:'hidden',border:`2px solid rgba(244,196,48,.4)`,background:'rgba(244,196,48,.1)',display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(8px)',boxShadow:`0 4px 16px rgba(244,196,48,.2)`}}>
                  {(configSettings.logo_url||LS.get('cfg.logoUrl','')||logo)?<img src={configSettings.logo_url||LS.get('cfg.logoUrl','')||logo} alt="logo" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<Icon name="employees" size={36} color="rgba(244,196,48,.6)"/>}
                </div>
                <div style={{position:'absolute',bottom:-3,right:-3,width:20,height:20,borderRadius:'50%',background:`linear-gradient(135deg,${D.gold},${D.gold2})`,display:'flex',alignItems:'center',justifyContent:'center',border:'2px solid #1A1A1A',boxShadow:`0 2px 8px rgba(244,196,48,.4)`}}>
                  <Icon name="upload" size={10} color="#1A1A1A"/>
                </div>
                <input ref={logoRef} type="file" accept="image/*" style={{display:'none'}} onChange={e=>{e.stopPropagation();handleImg(logoRef,setLogo);}}/>
              </div>
              <div>
                <h1 style={{fontSize:38,fontWeight:800,color:'#F5F5F5',margin:0,letterSpacing:'-1.5px',lineHeight:1.05}}>Attendance Dashboard</h1>
                <p style={{fontSize:12,color:'rgba(245,245,245,.45)',margin:'8px 0 0',fontWeight:400,letterSpacing:'-.1px'}}>Human Resources · Workforce Analytics{lastSync?` · Synced ${lastSync}`:''}</p>
              </div>
              {diag?.errors?.length>0&&<button onClick={e=>{e.stopPropagation();setTab('datasource');}} style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6,background:'rgba(239,68,68,.2)',border:'1px solid rgba(239,68,68,.35)',borderRadius:10,padding:'6px 12px',cursor:'pointer',color:'#FCA5A5',fontSize:11,fontWeight:700}}><Icon name="close" size={12} color="#FCA5A5"/>{diag.errors.length} Error{diag.errors.length>1?'s':''}</button>}
            </div>

          </div>
        </div>

        {/* FILTER BAR — compact modern pill design, hidden on Employees & Compare tabs */}
        {tab!=='employees'&&tab!=='compare'&&(
          <div style={{background:'rgba(255,255,255,.9)',backdropFilter:'blur(12px)',
            borderBottom:`1px solid ${D.br}`,padding:'6px 22px',
            display:'flex',gap:8,alignItems:'center',flexShrink:0,flexWrap:'wrap'}}>

            {/* Date range pills */}
            <div style={{display:'flex',alignItems:'center',gap:2,background:'rgba(0,0,0,.05)',borderRadius:20,padding:'3px'}}>
              {[['all','All'],[null,'7d'],[null,'30d'],[null,'90d'],[null,'YTD']].map(([v,l],idx)=>{
                const today=new Date();
                const isActive = l==='All'?(!sd&&!ed):false;
                return(
                  <button key={l} onClick={()=>{
                    setQF('all');
                    if(l==='All'){setSd(null);setEd(null);}
                    else if(l==='7d'){setSd(subDays(today,7));setEd(today);}
                    else if(l==='30d'){setSd(subDays(today,30));setEd(today);}
                    else if(l==='90d'){setSd(subDays(today,90));setEd(today);}
                    else if(l==='YTD'){setSd(startOfYear(today));setEd(today);}
                  }} style={{padding:'4px 11px',borderRadius:16,border:'none',fontSize:11,cursor:'pointer',
                    background:isActive?D.card:'transparent',color:isActive?D.goldDk:D.mu,
                    boxShadow:isActive?D.sh:'none',fontFamily:'Plus Jakarta Sans,sans-serif',
                    fontWeight:isActive?700:400,transition:'all .12s'}}>
                    {l}
                  </button>
                );
              })}
              <DateRange start={sd} end={ed} onChange={(s2,e2)=>{setSd(s2);setEd(e2);setQF('all');}} compact/>
            </div>

            <div style={{width:1,height:16,background:D.br}}/>

            {/* Quarter pills */}
            <div style={{display:'flex',alignItems:'center',gap:2,background:'rgba(0,0,0,.05)',borderRadius:20,padding:'3px'}}>
              <span style={{fontSize:9,color:D.mu2,fontWeight:700,padding:'0 6px',letterSpacing:'.5px'}}>Quarter:</span>
              {[['all','All'],['Q1','Q1'],['Q2','Q2'],['Q3','Q3'],['Q4','Q4']].map(([v,l])=>(
                <button key={v} onClick={()=>{
                  setQF(v);
                  if(v==='all'){setSd(null);setEd(null);}
                  else{
                    const yr=new Date().getFullYear();
                    const qMonths={Q1:[0,2],Q2:[3,5],Q3:[6,8],Q4:[9,11]};
                    const[m0,m1]=qMonths[v];
                    setSd(new Date(yr,m0,1));
                    setEd(new Date(yr,m1+1,0,23,59,59));
                  }
                }} style={{padding:'4px 10px',borderRadius:16,border:'none',fontSize:11,cursor:'pointer',
                  fontWeight:qF===v?700:400,background:qF===v?D.card:'transparent',
                  color:qF===v?D.goldDk:D.mu,boxShadow:qF===v?D.sh:'none',
                  fontFamily:'Plus Jakarta Sans,sans-serif',transition:'all .12s'}}>{l}</button>
              ))}
            </div>

            {/* Dept select */}
            {tab!=='departments'&&(
              <>
                <div style={{width:1,height:16,background:D.br}}/>
                <DeptDropdown depts={depts.map(d=>d.name)} value={deptF} onChange={setDF}/>
                <LocMultiSelect locs={allLocs} selected={locFs} onChange={setLFs}/>
              </>
            )}

            {/* Active tags */}
            {(sd||deptF!=='all'||qF!=='all'||locFs.size>0)&&(
              <div style={{marginLeft:'auto',display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}>
                {deptF!=='all'&&<Tag onX={()=>setDF('all')}>{deptF}</Tag>}
                {[...locFs].map(l=><Tag key={l} onX={()=>setLFs(p=>{const n=new Set(p);n.delete(l);return n;})}>{l}</Tag>)}
                {qF!=='all'   &&<Tag onX={()=>{setQF('all');setSd(null);setEd(null);}}>{qF}</Tag>}
                {sd&&<Tag color={D.b} bg={D.bBg} onX={()=>{setSd(null);setEd(null);}}>
                  {format(sd,'d MMM')} → {ed?format(ed,'d MMM'):'…'}
                </Tag>}
              </div>
            )}
          </div>
        )}


        {/* CONTENT */}
        <div style={{flex:1,overflowY:'auto',padding:'20px 24px',background:'transparent'}}>
          {status==='loading' ? <Spin/> :
           status==='error'   ? (
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'70vh',gap:20,textAlign:'center'}}>
              <div style={{width:64,height:64,borderRadius:20,background:D.rBg,display:'flex',alignItems:'center',justifyContent:'center'}}>
                <svg width="30" height="30" viewBox="0 0 24 24" fill={D.r}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
              </div>
              <div>
                <p style={{fontSize:20,fontWeight:800,color:D.tx,marginBottom:8,letterSpacing:'-.5px'}}>Could not load data</p>
                <p style={{fontSize:13,color:D.mu,lineHeight:1.7,maxWidth:400}}>
                  Dashboard cannot connect to Google Sheets.<br/>
                  Make sure the 3 sheets are shared as<br/>
                  <b style={{color:D.tx}}>"Anyone with the link → Viewer"</b>
                </p>
              </div>
              {diag?.errors?.length>0&&(
                <div style={{background:D.rBg,border:`1px solid ${D.r}30`,borderRadius:12,padding:'10px 18px',maxWidth:480}}>
                  <p style={{fontSize:11,color:D.r,fontFamily:'DM Mono,monospace'}}>{diag.errors.join(' · ')}</p>
                </div>
              )}
              <div style={{display:'flex',gap:10,flexWrap:'wrap',justifyContent:'center'}}>
                <button className="btn btn-primary btn-lg" onClick={()=>doFetch()} disabled={syncing}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill={D.tx}><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                  {syncing?'Retrying…':'Retry Connection'}
                </button>
                <button className="btn btn-outline btn-lg" onClick={()=>setAdmin(true)}>
                  ⚙ Configure Sheet IDs
                </button>
              </div>
              <p style={{fontSize:11,color:D.mu2,marginTop:4}}>
                Check internet connection · Verify sheet sharing settings
              </p>
            </div>
           ) : (
            <>
              {tab==='overview'    &&<OverviewTab     depts={fD} monthly={(deptF==='all'&&locFs.size===0)?fM:fMonthly.filter((_,i)=>(Q[qF]||Q.all).includes(i))} daily={fDaily} ciDist={fCiDist} leaveRecords={filteredLeaveRecords} allMonthly={(deptF==='all'&&locFs.size===0)?monthly:fMonthly} annualQuota={annualQuota} sickQuota={sickQuota} leaveQuotas={leaveQuotas} compareMode={compareMode} locFs={locFs} allLocs={allLocs}/>}
              {tab==='departments' &&<DepartmentsTab  depts={fD} allDepts={depts} empMap={empMapObj} attRecords={attRecords} leaveRecords={leaveRecords} holidays={mergedHolidays} allLocs={allLocs}/>}
              {tab==='compare'     &&<CompareTabPage  allMonthly={monthly} depts={depts} allTimeStats={allTimeStats} attRecords={allAttRecords} leaveRecords={allLeaveRecords} empMap={empMapObj} holidays={mergedHolidays} allLocs={allLocs}/>}
              {tab==='leave'       &&<LeaveTab        monthly={(deptF==='all'&&locFs.size===0)?fM:fMonthly.filter((_,i)=>(Q[qF]||Q.all).includes(i))} depts={fD} leaveRecords={filteredLeaveRecords} leaveQuotas={leaveQuotas} totalEmp={fD.reduce((a,d)=>a+d.count,0)} annualQuota={annualQuota} sickQuota={sickQuota}/>}
              {tab==='employees'   &&<EmployeesTab    rawAtt={rawAtt} rawSL={rawSL} empMap={empMapObj} holidays={mergedHolidays} yr={empYr} mo={empMo} df={empDf} q={empQ} setYr={setEmpYr} setMo={setEmpMo} setDf={setEmpDf} setQ={setEmpQ} allLocs={allLocs}/>}
              {tab==='datasource'  &&<DataSourceTab   status={status} diag={mergedDiag} rawAtt={rawAtt} rawSL={rawSL} empRaw={empRaw} lastSync={lastSync} onSync={gid=>doFetch(empId,attId,slId,gid)} syncing={syncing} attGid={attGid} setAttGid={setAttGid}/>}
            </>
           )}
        </div>
      </div>

      {admin&&<AdminModal onClose={()=>setAdmin(false)} onSync={doFetch} syncing={syncing} lastSync={lastSync} empId={empId} setEmpId={setEmpId} attId={attId} setAttId={setAttId} slId={slId} setSlId={setSlId} attGid={attGid} setAttGid={setAttGid} holidays={mergedHolidays} setHolidays={setHolidays} configHolidays={configHolidays} status={status} diag={mergedDiag} rawAtt={rawAtt} rawSL={rawSL} empRaw={empRaw} annualQuota={annualQuota} setAnnualQuota={setAnnualQuota} sickQuota={sickQuota} setSickQuota={setSickQuota} leaveQuotas={leaveQuotas} setLeaveQuotas={setLeaveQuotas}/>}
    </div>
    </ErrorBoundary>
  );
}
