'use client';
import { ReactNode, useEffect, useState } from 'react';
import { apiBase, Operations } from './lib';

const nav = [['/','대시보드'],['/alerts','이상 징후'],['/trends','시장 추이'],['/items','아이템'],['/rules','탐지 규칙'],['/operations','운영 협업']];

export function AppShell({ active, children, action }: { active:string; children:ReactNode; action?:ReactNode }) {
  return <div className="app-shell"><header className="site-header"><div className="nav-shell">
    <a className="brand" href="/"><span className="brand-mark">S</span><span><strong>Sentinel</strong><small>DNF tracker</small></span></a>
    <nav className="top-nav">{nav.map(([href,label])=><a key={href} href={href} className={active===href?'active':''}>{label}</a>)}</nav>
  </div></header><main className="main"><section className="content route-content">{children}</section></main></div>;
}

export function PageTitle({ eyebrow, title, description, action }: {eyebrow:string;title:string;description:string;action?:ReactNode}) {
  return <div className="route-title"><div><p>{eyebrow}</p><h1>{title}</h1><span>{description}</span></div>{action}</div>;
}

export function Modal({ open, onClose, title, children }: {open:boolean;onClose:()=>void;title:string;children:ReactNode}) {
  if(!open) return null;
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal-card" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e)=>e.stopPropagation()}><header><div><small>DNF MARKET SENTINEL</small><h2>{title}</h2></div><button onClick={onClose} aria-label="닫기">×</button></header>{children}</section></div>;
}

export function useOperations(range='24시간') {
  const [data,setData]=useState<Operations|null>(null); const [error,setError]=useState('');
  const reload=()=>fetch(`${apiBase}/operations/dashboard?range=${encodeURIComponent(range)}`).then(async r=>{const b=await r.json();if(!r.ok)throw new Error(b.message);return b}).then(setData).catch(e=>setError(e.message));
  useEffect(()=>{reload();const timer=window.setInterval(reload,60000);return()=>window.clearInterval(timer)},[range]);
  return {data,error,reload};
}

export function MiniChart({ values }: {values:number[]}) {
  const pointsData=values.length>1?values:[0,0], max=Math.max(1,...pointsData);
  const points=pointsData.map((v,i)=>`${(i/(pointsData.length-1))*720},${190-(v/max)*150}`).join(' ');
  return <div className="chart-wrap"><svg className="line-chart" viewBox="0 0 720 200" preserveAspectRatio="none"><defs><linearGradient id="routeArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4d7cff" stopOpacity=".4"/><stop offset="1" stopColor="#4d7cff" stopOpacity="0"/></linearGradient></defs>{[28,68,108,148,188].map(y=><line key={y} x1="0" y1={y} x2="720" y2={y} className="grid-line"/>)}<polygon points={`0,200 ${points} 720,200`} fill="url(#routeArea)"/><polyline points={points} className="trend-line"/></svg><div className="chart-x"><span>시작</span><span>중간</span><span>현재</span></div></div>;
}
