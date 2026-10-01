import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';

const MIN_DIAS = 10;
const TARGET_GENERAL = { TODOS: 362, TARDE: 398, NOCHE: 354 };
const TARGET_CANCHA = {
  TARDE: { C1: 461, C2: 258, C3: 258, C4: 409, C5: 488 },
  NOCHE: { C1: 372, C2: 212, C3: 224, C4: 328, C5: 461 }
};
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const txt = v => String(v ?? '').trim();
const norm = v => txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9]+/g,' ').trim().toUpperCase();
const fmt = v => new Intl.NumberFormat('es-AR',{maximumFractionDigits:1}).format(n(v));
const pct = v => `${n(v).toFixed(1)}%`;
const iso = v => txt(v).slice(0,10);
const fechaAR = v => { const [y,m,d]=iso(v).split('-'); return y&&m&&d?`${d}/${m}/${y}`:txt(v); };
const turnoCanon = v => { const t=norm(v); if(t.includes('NOCHE')||t==='TN'||t==='N')return'NOCHE'; if(t.includes('TARDE')||t==='TT'||t==='T')return'TARDE'; return t||'SIN TURNO'; };
const nombreTurno = v => turnoCanon(v)==='NOCHE'?'Noche':turnoCanon(v)==='TARDE'?'Tarde':txt(v);
const operadorKey = r => txt(r.empleado_id||r.legajo||r.datos_originales?.operador||'SIN OPERADOR');
const diasUnicos = rows => new Set(rows.map(r=>iso(r.fecha)).filter(Boolean)).size;
const suma = (rows,key) => rows.reduce((s,r)=>s+n(r[key]),0);
const paletas = rows => suma(rows,'pallets');
const bultos = rows => suma(rows,'packs');
const productividad = rows => { if(!rows.length)return 0; const packs=bultos(rows), seg=suma(rows,'duracion_segundos'); return packs>0&&seg>0?packs/(seg/3600):rows.reduce((s,r)=>s+n(r.productividad),0)/rows.length; };
const targetCancha = r => TARGET_CANCHA[turnoCanon(r.turno)]?.[txt(r.cancha).toUpperCase()]||n(r.target)||0;
const noEsError = r => { const m=norm(r.motivo||r.descripcion||r.comentario); return m==='OK'||m.includes('SIN NOVEDAD')||m.includes('SIN ERROR')||n(r.total_errores??r.cantidad??r.errores??1)===0; };
const paletaId = r => txt(r.numero_paleta||r.paleta);
const tipoAdministrativo = r => {
  const base = norm([r.cancha,r.operador,r.pickero,r.transporte,r.transportista,r.datos_originales?.operador,r.comentario].map(txt).join(' '));
  if(base.includes('CARRIER')) return 'E.Carrier';
  if(base.includes('TADA')) return 'TADA';
  if(norm(r.cancha)==='CARGA' || norm(r.operador)==='CARGA' || norm(r.pickero)==='CARGA' || norm(r.datos_originales?.operador)==='CARGA') return 'Carga';
  return '';
};
const esAdministrativo = r => Boolean(tipoAdministrativo(r));
const skuEtiqueta = r => txt(r.sku||r.codigo||r.material) || (r.__origen==='VOICE'?'SKU no disponible en Voice':'SKU no informado');

async function cargarCompleto(tabla){
  let desde=0, todas=[]; const pagina=1000;
  while(true){
    const {data,error}=await supabase.from(tabla).select('*').order('id',{ascending:true}).range(desde,desde+pagina-1);
    if(error)throw error;
    const filas=data||[]; todas=todas.concat(filas);
    if(filas.length<pagina)break; desde+=pagina;
  }
  return todas;
}

function resumen(rows, errorRows, targetFijo=0){
  const validos=errorRows.filter(r=>!noEsError(r));
  const voice=validos.filter(r=>r.__origen==='VOICE').length;
  const gatera=validos.filter(r=>r.__origen==='GATERA').length;
  const total=voice+gatera;
  const ids=validos.map(paletaId).filter(Boolean);
  const paletasAfectadas=ids.length===validos.length?new Set(ids).size:null;
  const p=paletas(rows), prod=productividad(rows);
  const target=targetFijo||0;
  const cumplimiento=target>0?prod/target*100:(rows.length?rows.reduce((s,r)=>s+(targetCancha(r)>0?n(r.productividad)/targetCancha(r)*100:0),0)/rows.length:0);
  const tasaError=p>0?total/p*100:0;
  return {rows,errorRows:validos,paletas:p,bultos:bultos(rows),dias:diasUnicos(rows),productividad:prod,target,cumplimiento,voice,gatera,total,paletasAfectadas,tasaError,calidad:p>0?Math.max(0,100-tasaError):null};
}

const Card=({title,value,line1,line2})=><div style={{background:'#050505',color:'#fff',borderRadius:14,padding:16,display:'grid',gap:7,minWidth:0}}><small style={{color:'#ffd400',fontWeight:800}}>{title}</small><b style={{fontSize:28,lineHeight:1.05,overflowWrap:'anywhere'}}>{value}</b>{line1&&<small style={{lineHeight:1.35}}>{line1}</small>}{line2&&<small style={{lineHeight:1.35}}>{line2}</small>}</div>;
const Empty=({children='Sin datos para el período seleccionado.'})=><div className="notice">{children}</div>;
const Pill=({children,onClick,active=false})=><button onClick={onClick} style={{border:'1px solid #ddd',borderRadius:999,padding:'8px 12px',fontWeight:800,background:active?'#050505':'#fff',color:active?'#ffd400':'#111',cursor:'pointer'}}>{children}</button>;

function ErrorExplorer({ rows, empMap, title='Detalle de errores' }){
  const [filtro,setFiltro]=useState(null);
  const validos=useMemo(()=>rows.filter(r=>!noEsError(r)),[rows]);
  const agrupar=(fn)=>{const m=new Map();validos.forEach(e=>{const k=fn(e);m.set(k,(m.get(k)||0)+1)});return[...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10)};
  const grupos={
    sku:agrupar(skuEtiqueta),
    fecha:agrupar(e=>iso(e.fecha)||'Sin fecha'),
    motivo:agrupar(e=>txt(e.motivo)||'Sin motivo'),
    operador:agrupar(e=>txt(empMap.get(txt(e.empleado_id))?.apellido_nombre||e.operador||e.pickero)||'Sin operador')
  };
  const filtrados=validos.filter(e=>{
    if(!filtro)return true;
    if(filtro.tipo==='sku')return skuEtiqueta(e)===filtro.valor;
    if(filtro.tipo==='fecha')return iso(e.fecha)===filtro.valor;
    if(filtro.tipo==='motivo')return (txt(e.motivo)||'Sin motivo')===filtro.valor;
    if(filtro.tipo==='operador')return (txt(empMap.get(txt(e.empleado_id))?.apellido_nombre||e.operador||e.pickero)||'Sin operador')===filtro.valor;
    return true;
  });
  const Bars=({tipo,titulo,items,format=x=>x})=><section style={{border:'1px solid #e5e5e5',borderRadius:12,padding:12,background:'#fff'}}><b>{titulo}</b>{items.length?items.map(([label,value])=><button key={label} onClick={()=>setFiltro({tipo,valor:label})} style={{display:'grid',gridTemplateColumns:'minmax(92px,1fr) 72px',gap:8,alignItems:'center',width:'100%',border:0,background:filtro?.tipo===tipo&&filtro?.valor===label?'#fff7cf':'transparent',padding:'6px',borderRadius:7,textAlign:'left',cursor:'pointer'}}><span><small>{format(label)}</small><span style={{display:'block',height:7,background:'#eee',borderRadius:5,overflow:'hidden',marginTop:4}}><span style={{display:'block',height:'100%',width:`${Math.max(6,value/Math.max(1,items[0][1])*100)}%`,background:'#f0c400'}}/></span></span><small><b>{value}</b> · {pct(value/Math.max(1,validos.length)*100)}</small></button>):<small>Sin errores.</small>}</section>;
  return <section className="panel"><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}><div><h3 style={{marginBottom:4}}>{title}</h3><small>{filtro?`Mostrando ${filtrados.length} de ${validos.length} errores · Filtro: ${filtro.tipo} = ${filtro.tipo==='fecha'?fechaAR(filtro.valor):filtro.valor}`:`Mostrando todos: ${validos.length} de ${validos.length} errores`}</small></div>{filtro&&<button onClick={()=>setFiltro(null)}>Limpiar filtro · Ver todos</button>}</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10,marginTop:12}}><Bars tipo="sku" titulo="Top SKU" items={grupos.sku}/><Bars tipo="fecha" titulo="Días con más errores" items={grupos.fecha} format={fechaAR}/><Bars tipo="motivo" titulo="Motivos" items={grupos.motivo}/><Bars tipo="operador" titulo="Operadores" items={grupos.operador}/></div><div style={{overflowX:'auto',marginTop:14}}><table style={{width:'100%',fontSize:13}}><thead><tr><th>Fecha</th><th>Hora</th><th>Paleta</th><th>Operador</th><th>Turno</th><th>Cancha</th><th>SKU</th><th>Motivo</th><th>Origen</th></tr></thead><tbody>{filtrados.map((e,i)=><tr key={e.id||i}><td>{fechaAR(e.fecha)}</td><td>{txt(e.hora||e.created_at).slice(11,16)||'--'}</td><td>{paletaId(e)||'Sin dato'}</td><td>{txt(empMap.get(txt(e.empleado_id))?.apellido_nombre||e.operador||e.pickero)||'Sin dato'}</td><td>{nombreTurno(e.turno)||'Sin dato'}</td><td>{txt(e.cancha)||'Sin dato'}</td><td>{skuEtiqueta(e)}</td><td>{txt(e.motivo)||'Sin motivo'}</td><td>{e.__origen==='VOICE'?'Voice':'Gatera'}</td></tr>)}</tbody></table></div></section>;
}

export default function AnalisisOperativoV3(){
  const [tab,setTab]=useState('dashboard');
  const [year,setYear]=useState('2026');
  const [month,setMonth]=useState('1');
  const [turno,setTurno]=useState('');
  const [periodo,setPeriodo]=useState('mes');
  const [fecha,setFecha]=useState('');
  const [rankingTurno,setRankingTurno]=useState('TARDE');
  const [canchaTurno,setCanchaTurno]=useState('TARDE');
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState('');
  const [returnTab,setReturnTab]=useState('');
  const [assistant,setAssistant]=useState(null);
  const [auditMetric,setAuditMetric]=useState('productividad');
  const [selectedMonth,setSelectedMonth]=useState(null);
  const [detail,setDetail]=useState(null);
  const [picking,setPicking]=useState([]);
  const [errors,setErrors]=useState([]);
  const [employees,setEmployees]=useState([]);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const detailRef=useRef(null);

  useEffect(()=>{(async()=>{try{setLoading(true);const[p,g,v,e]=await Promise.all([cargarCompleto('picking'),cargarCompleto('errores_gatera'),cargarCompleto('errores_voice'),cargarCompleto('empleados')]);setPicking(p);setErrors([...g.map(x=>({...x,__origen:'GATERA'})),...v.map(x=>({...x,__origen:'VOICE'}))]);setEmployees(e);}catch(err){setMessage(err.message||'No se pudieron cargar los datos.');}finally{setLoading(false);}})();},[]);
  useEffect(()=>{setAssistant(null);setDetail(null);},[year,month,turno,periodo,fecha]);
  useEffect(()=>{if(detail&&detailRef.current)detailRef.current.scrollIntoView({behavior:'smooth',block:'start'});},[detail]);

  const empMap=useMemo(()=>new Map(employees.map(e=>[txt(e.id),e])),[employees]);
  const enRango=r=>{const f=iso(r.fecha);if(!f)return false;if(periodo==='anio')return f.startsWith(`${year}-`);if(periodo==='mes')return f.startsWith(`${year}-${String(month).padStart(2,'0')}-`);if(periodo==='dia')return f===fecha;if(!fecha)return false;const fin=new Date(`${fecha}T00:00:00`),ini=new Date(fin);ini.setDate(ini.getDate()-(periodo==='semana'?6:14));const d=new Date(`${f}T00:00:00`);return d>=ini&&d<=fin;};
  const porTurno=(rows,t=turno)=>!t?rows:rows.filter(r=>turnoCanon(r.turno)===t);
  const pPeriodo=useMemo(()=>picking.filter(enRango),[picking,year,month,periodo,fecha]);
  const ePeriodo=useMemo(()=>errors.filter(enRango),[errors,year,month,periodo,fecha]);
  const eAdministrativos=useMemo(()=>ePeriodo.filter(esAdministrativo),[ePeriodo]);
  const eOperativos=useMemo(()=>ePeriodo.filter(e=>!esAdministrativo(e)),[ePeriodo]);
  const pFiltrado=useMemo(()=>porTurno(pPeriodo),[pPeriodo,turno]);
  const eFiltrado=useMemo(()=>porTurno(eOperativos),[eOperativos,turno]);
  const targetGeneral=turno?TARGET_GENERAL[turno]:TARGET_GENERAL.TODOS;
  const general=useMemo(()=>resumen(pFiltrado,eFiltrado,targetGeneral),[pFiltrado,eFiltrado,targetGeneral]);
  const tarde=useMemo(()=>resumen(porTurno(pPeriodo,'TARDE'),porTurno(eOperativos,'TARDE'),TARGET_GENERAL.TARDE),[pPeriodo,ePeriodo]);
  const noche=useMemo(()=>resumen(porTurno(pPeriodo,'NOCHE'),porTurno(eOperativos,'NOCHE'),TARGET_GENERAL.NOCHE),[pPeriodo,ePeriodo]);

  const operadores=useMemo(()=>{const map=new Map();pPeriodo.forEach(r=>{const k=operadorKey(r);if(!map.has(k))map.set(k,{key:k,employeeId:txt(r.empleado_id),rows:[],errors:[]});map.get(k).rows.push(r);});eOperativos.forEach(e=>{const x=map.get(txt(e.empleado_id));if(x&&!noEsError(e))x.errors.push(e);});return[...map.values()].map(x=>{const emp=empMap.get(x.employeeId);return{...x,...resumen(x.rows,x.errors,0),name:txt(emp?.apellido_nombre||x.rows[0]?.datos_originales?.operador||'SIN NOMBRE'),legajo:txt(emp?.legajo)};});},[pPeriodo,eOperativos,empMap]);

  const ranking=useMemo(()=>operadores.map(o=>{const rows=porTurno(o.rows,rankingTurno),errs=porTurno(o.errors,rankingTurno);return{...o,...resumen(rows,errs,0),rows,errors:errs};}).filter(o=>o.dias>=MIN_DIAS&&o.paletas>0).sort((a,b)=>{const va=a.paletas*(1-a.tasaError/100)*Math.min(a.cumplimiento,120)/100;const vb=b.paletas*(1-b.tasaError/100)*Math.min(b.cumplimiento,120)/100;return vb-va;}),[operadores,rankingTurno]);
  const excluidos=useMemo(()=>operadores.map(o=>({...o,...resumen(porTurno(o.rows,rankingTurno),porTurno(o.errors,rankingTurno),0)})).filter(o=>o.dias>0&&o.dias<MIN_DIAS),[operadores,rankingTurno]);

  const canchas=useMemo(()=>{const t=canchaTurno,map=new Map();porTurno(pPeriodo,t).forEach(r=>{const c=txt(r.cancha).toUpperCase()||'SIN CANCHA';if(!map.has(c))map.set(c,[]);map.get(c).push(r);});return[...map.entries()].map(([cancha,rows])=>{const errs=porTurno(eOperativos,t).filter(e=>txt(e.cancha).toUpperCase()===cancha);return{cancha,turno:t,operadores:new Set(rows.map(operadorKey)).size,...resumen(rows,errs,TARGET_CANCHA[t]?.[cancha]||0)};}).sort((a,b)=>b.cumplimiento-a.cumplimiento);},[pPeriodo,eOperativos,canchaTurno]);

  const options=useMemo(()=>{const q=norm(search);return q?operadores.filter(o=>norm(o.name).includes(q)||o.legajo.includes(search.trim())).slice(0,12):[];},[search,operadores]);
  const ficha=operadores.find(o=>o.key===selected)||(options.length===1?options[0]:null);
  const fichaCanchas=useMemo(()=>{if(!ficha)return[];const map=new Map();ficha.rows.forEach(r=>{const k=`${turnoCanon(r.turno)}|${txt(r.cancha).toUpperCase()}`;if(!map.has(k))map.set(k,[]);map.get(k).push(r);});return[...map.entries()].map(([k,rows])=>{const[t,c]=k.split('|');const errs=ficha.errors.filter(e=>turnoCanon(e.turno)===t&&txt(e.cancha).toUpperCase()===c);return{turno:t,cancha:c,...resumen(rows,errs,TARGET_CANCHA[t]?.[c]||0)};});},[ficha]);

  const analizarErrores=rows=>{const validos=rows.filter(r=>!noEsError(r));const maps={sku:new Map(),fechas:new Map(),motivos:new Map(),operadores:new Map()};validos.forEach(e=>{const vals={sku:skuEtiqueta(e),fechas:iso(e.fecha)||'SIN FECHA',motivos:txt(e.motivo||'SIN MOTIVO'),operadores:txt(empMap.get(txt(e.empleado_id))?.apellido_nombre||'SIN OPERADOR')};Object.entries(vals).forEach(([k,v])=>maps[k].set(v,(maps[k].get(v)||0)+1));});const top=m=>[...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);return{validos,...Object.fromEntries(Object.entries(maps).map(([k,m])=>[k,top(m)]))};};
  const MiniBars=({title,items,total,onClick})=><section style={{border:'1px solid #e5e5e5',borderRadius:12,padding:12}}><b>{title}</b>{items.length?items.map(([label,value])=><button key={label} onClick={()=>onClick?.(label)} style={{display:'grid',gridTemplateColumns:'100px 1fr 66px',gap:8,alignItems:'center',width:'100%',border:0,background:'transparent',padding:'5px 0',textAlign:'left'}}><small>{label}</small><span style={{height:9,background:'#eee',borderRadius:6,overflow:'hidden'}}><span style={{display:'block',height:'100%',width:`${Math.max(5,value/items[0][1]*100)}%`,background:'#f0c400'}}/></span><small>{value} · {pct(value/Math.max(1,total)*100)}</small></button>):<small>Sin errores.</small>}</section>;

  const evol=useMemo(()=>Array.from({length:12},(_,i)=>{const pref=`${year}-${String(i+1).padStart(2,'0')}-`,rows=porTurno(picking.filter(r=>iso(r.fecha).startsWith(pref))),errs=porTurno(errors.filter(r=>iso(r.fecha).startsWith(pref)&&!esAdministrativo(r)));return rows.length?{mes:i+1,...resumen(rows,errs,turno?TARGET_GENERAL[turno]:TARGET_GENERAL.TODOS)}:{mes:i+1,sinDatos:true};}),[picking,errors,year,turno]);
  const audit=useMemo(()=>{const ev=errors.filter(e=>!noEsError(e));const alerts=[];const push=(title,count,detail)=>count&&alerts.push({title,count,detail});push('Errores sin empleado',ev.filter(e=>!txt(e.empleado_id)).length,'No pueden asignarse a una ficha.');push('Errores sin fecha',ev.filter(e=>!iso(e.fecha)).length,'No pueden filtrarse por período.');push('Errores sin número de paleta',ev.filter(e=>!paletaId(e)).length,'Paletas afectadas se mostrará como Sin datos.');push('Picking sin turno',picking.filter(r=>turnoCanon(r.turno)==='SIN TURNO').length,'No puede separarse Tarde y Noche.');push('Picking sin cancha',picking.filter(r=>!txt(r.cancha)).length,'No puede aplicarse target fijo.');return{alerts,picking:picking.length,errors:ev.length,months:evol.filter(x=>!x.sinDatos).length};},[picking,errors,evol]);

  const preguntas=[['op','¿Quién tuvo más errores?'],['turno','¿Qué turno tuvo mayor tasa de error?'],['cancha','¿Qué cancha necesita revisión?'],['sku','¿Qué SKU se repitió más?'],['mejor','¿Quién produjo más paletas con menos errores?'],['dia','¿Qué ocurrió en la fecha seleccionada?'],['why','¿Dónde conviene realizar un 5 Why?'],['adf','¿Qué caso requiere un ADF?']];
  const responder=id=>{if(!pFiltrado.length)return{title:'Sin datos',lines:['No existe información para el período y turno seleccionados.']};if(id==='op'){const x=[...operadores].sort((a,b)=>b.total-a.total)[0];return{title:'Operador con más errores',lines:[`${x.name}: ${x.total} errores reales.`,`Voice ${x.voice} · Gatera ${x.gatera}.`,`${fmt(x.paletas)} paletas · tasa ${pct(x.tasaError)}.`],errors:x.errors};}if(id==='turno'){const x=[{name:'Tarde',...tarde},{name:'Noche',...noche}].filter(a=>a.paletas).sort((a,b)=>b.tasaError-a.tasaError)[0];return{title:'Turno con mayor tasa de error',lines:[`${x.name}: ${pct(x.tasaError)}.`,`${x.total} errores en ${fmt(x.paletas)} paletas.`,`Target ${fmt(x.target)} · cumplimiento ${pct(x.cumplimiento)}.`],errors:x.errorRows};}if(id==='sku'){const a=analizarErrores(eFiltrado);const x=a.sku[0];return{title:'SKU más repetido',lines:x?[`SKU ${x[0]}: ${x[1]} errores reales.`]:['Sin SKU repetidos.'],errors:a.validos};}if(id==='mejor'){const x=[...operadores].filter(o=>o.dias>=MIN_DIAS).sort((a,b)=>(b.paletas*(1-b.tasaError/100))-(a.paletas*(1-a.tasaError/100)))[0];return{title:'Mayor producción con menor error',lines:x?[`${x.name}: ${fmt(x.paletas)} paletas.`,`${x.total} errores · tasa ${pct(x.tasaError)}.`,`Productividad ${fmt(x.productividad)}.`]:['Sin elegibles.'],errors:x?.errors||[]};}if(id==='dia'){if(!fecha)return{title:'Elegí una fecha',lines:['La consulta diaria necesita una fecha.']};const rows=porTurno(picking.filter(r=>iso(r.fecha)===fecha)),errs=porTurno(errors.filter(r=>iso(r.fecha)===fecha)),x=resumen(rows,errs,turno?TARGET_GENERAL[turno]:TARGET_GENERAL.TODOS);return{title:`Resumen ${fechaAR(fecha)}`,lines:rows.length?[`${fmt(x.paletas)} paletas · Prod. ${fmt(x.productividad)} · Cumpl. ${pct(x.cumplimiento)}.`,`${x.total} errores · Calidad ${pct(x.calidad)}.`]:['Sin datos.'],errors:x.errorRows};}const a=analizarErrores(eFiltrado),topSku=a.sku[0],topOp=[...operadores].sort((a,b)=>b.total-a.total)[0];if(id==='why')return{title:'Caso sugerido para 5 Why',lines:topSku?[`SKU ${topSku[0]} repitió ${topSku[1]} errores.`,`Operador con más errores: ${topOp?.name||'Sin dato'}.`,'1. ¿Por qué ocurrió?','2. ¿Por qué se generó esa condición?','3. ¿Por qué no se detectó antes?','4. ¿Por qué el control no lo evitó?','5. ¿Cuál es la causa raíz?']:['Sin patrón suficiente.'],errors:a.validos};const crit=[...operadores].find(o=>o.total>24||o.tasaError>4);return{title:crit?'Caso sugerido para ADF':'Sin caso crítico',lines:crit?[`${crit.name}: ${crit.total} errores · tasa ${pct(crit.tasaError)}.`,'Documentar evidencia, causa, acción y seguimiento.']:['Nadie supera los umbrales.'],errors:crit?.errors||[]};};

  const Evolucion=()=>{
    const cfg={
      paletas:{value:x=>x.paletas,label:x=>`${fmt(x.paletas)} paletas`,color:'#111',target:null},
      productividad:{value:x=>x.productividad,label:x=>`${fmt(x.productividad)} bultos/h`,color:'#118542',target:turno?TARGET_GENERAL[turno]:TARGET_GENERAL.TODOS},
      errores:{value:x=>x.total,label:x=>`${x.total} errores`,color:'#c62828',target:null},
      calidad:{value:x=>x.calidad||0,label:x=>pct(x.calidad),color:'#d9a900',target:99}
    }[auditMetric];
    const vals=evol.filter(x=>!x.sinDatos), max=Math.max(cfg.target||0,1,...vals.map(cfg.value)), min=Math.min(...vals.map(cfg.value),cfg.target||Infinity);
    const W=900,H=270,pad=42; const scaleX=m=>pad+(m-1)*(W-pad*2)/11; const scaleY=v=>H-pad-(v-Math.min(0,min*.96))/(max-Math.min(0,min*.96)||1)*(H-pad*2);
    const points=vals.map(x=>`${scaleX(x.mes)},${scaleY(cfg.value(x))}`).join(' ');
    const prev=selectedMonth&&evol[selectedMonth.mes-2]&&!evol[selectedMonth.mes-2].sinDatos?evol[selectedMonth.mes-2]:null;
    const variacion=prev&&cfg.value(prev)!==0?(cfg.value(selectedMonth)-cfg.value(prev))/cfg.value(prev)*100:null;
    return <section className="panel"><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}><div><h3>📊 Evolución mensual {year}</h3><small>Seleccioná una métrica. Tocá un punto para ver el resumen del mes.</small></div><select value={auditMetric} onChange={e=>{setAuditMetric(e.target.value);setSelectedMonth(null)}}><option value="productividad">Productividad</option><option value="paletas">Paletas armadas</option><option value="errores">Errores reales</option><option value="calidad">Calidad de armado</option></select></div><div style={{overflowX:'auto'}}><svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',minWidth:650,height:300}} aria-label="Evolución mensual"><defs><linearGradient id="areaV3" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={cfg.color} stopOpacity=".28"/><stop offset="100%" stopColor={cfg.color} stopOpacity="0"/></linearGradient></defs>{[0,1,2,3,4].map(i=><line key={i} x1={pad} x2={W-pad} y1={pad+i*(H-pad*2)/4} y2={pad+i*(H-pad*2)/4} stroke="#e8e8e8"/>)}{cfg.target&&<><line x1={pad} x2={W-pad} y1={scaleY(cfg.target)} y2={scaleY(cfg.target)} stroke="#f0c400" strokeWidth="3" strokeDasharray="8 8"/><text x={W-pad-90} y={scaleY(cfg.target)-8} fill="#8b7100" fontSize="13">Target {fmt(cfg.target)}</text></>} {vals.length>1&&<polygon points={`${scaleX(vals[0].mes)},${H-pad} ${points} ${scaleX(vals[vals.length-1].mes)},${H-pad}`} fill="url(#areaV3)"/>}<polyline points={points} fill="none" stroke={cfg.color} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round"/>{evol.map(x=>x.sinDatos?<text key={x.mes} x={scaleX(x.mes)} y={H-12} textAnchor="middle" fontSize="12" fill="#999">{MESES[x.mes-1].slice(0,3)}</text>:<g key={x.mes} onClick={()=>setSelectedMonth(x)} style={{cursor:'pointer'}}><circle cx={scaleX(x.mes)} cy={scaleY(cfg.value(x))} r="7" fill="#fff" stroke={cfg.color} strokeWidth="4"/><text x={scaleX(x.mes)} y={scaleY(cfg.value(x))-14} textAnchor="middle" fontSize="12" fontWeight="700">{cfg.label(x)}</text><text x={scaleX(x.mes)} y={H-12} textAnchor="middle" fontSize="12" fontWeight="700">{MESES[x.mes-1].slice(0,3)}</text></g>)}</svg></div>{selectedMonth&&<article style={{border:'1px solid #ddd',borderTop:'5px solid #f0c400',borderRadius:12,padding:16,background:'#fff'}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h3>{MESES[selectedMonth.mes-1]} {year}</h3><button onClick={()=>setSelectedMonth(null)}>Cerrar</button></div><p><b>{cfg.label(selectedMonth)}</b>{variacion!==null&&` · ${variacion>=0?'Subió':'Bajó'} ${pct(Math.abs(variacion))} frente a ${MESES[selectedMonth.mes-2]}`}</p><p>Productividad {fmt(selectedMonth.productividad)} · Target {fmt(selectedMonth.target)} · Cumplimiento {pct(selectedMonth.cumplimiento)}.</p><p>{fmt(selectedMonth.paletas)} paletas · {fmt(selectedMonth.bultos)} bultos · {selectedMonth.total} errores · Calidad {pct(selectedMonth.calidad)}.</p></article>}</section>;
  };
  const nav=[['dashboard','Dashboard'],['ranking','Ranking'],['ficha','Ficha operador'],['canchas','Canchas'],['asistente','Asistente'],['auditoria','Auditoría']];
  return <section className="panel people-analysis"><div style={{display:'grid',gridTemplateColumns:'156px minmax(0,1fr)',gap:18}}><aside style={{background:'#111',borderRadius:14,padding:12,alignSelf:'start',position:'sticky',top:12}}><h3 style={{color:'#ffd400',padding:'8px'}}>ANÁLISIS V3</h3>{nav.map(([id,label])=><button key={id} onClick={()=>setTab(id)} style={{display:'block',width:'100%',textAlign:'left',padding:'9px 10px',border:0,borderRadius:9,marginBottom:6,fontWeight:800,background:tab===id?'#ffd400':'transparent',color:tab===id?'#111':'#fff'}}>{label}</button>)}</aside><main style={{minWidth:0}}><div className="analysis-title"><small>INTELIGENCIA OPERATIVA V3</small><h2>Centro de Inteligencia Operativa</h2></div><div className="analysis-filters" style={{position:'sticky',top:0,zIndex:6}}><label>Año<input value={year} onChange={e=>setYear(e.target.value)}/></label><label>Mes<select value={month} onChange={e=>setMonth(e.target.value)}>{MESES.map((m,i)=><option key={m} value={i+1}>{m}</option>)}</select></label><label>Turno<select value={turno} onChange={e=>setTurno(e.target.value)}><option value="">Todos</option><option value="TARDE">Tarde</option><option value="NOCHE">Noche</option></select></label><label>Período<select value={periodo} onChange={e=>setPeriodo(e.target.value)}><option value="mes">Mes</option><option value="dia">Día</option><option value="semana">Semana</option><option value="quincena">Quincena</option><option value="anio">Año</option></select></label>{['dia','semana','quincena'].includes(periodo)&&<label>Fecha<input type="date" value={fecha} onChange={e=>setFecha(e.target.value)}/></label>}</div>{loading&&<div className="notice">Cargando todos los datos...</div>}{message&&<div className="notice">{message}</div>}

  {tab==='dashboard'&&<>{!pFiltrado.length?<Empty/>:<><div className="analysis-kpis"><Card title="PRODUCTIVIDAD" value={fmt(general.productividad)} line1={`Target ${general.target} · Cumplimiento ${pct(general.cumplimiento)}`} line2={`${pct(Math.abs(general.cumplimiento-100))} ${general.cumplimiento>=100?'sobre':'debajo'} del objetivo`}/><Card title="CALIDAD DE ARMADO" value={pct(general.calidad)} line1={`${general.total} errores reales · tasa ${pct(general.tasaError)}`} line2={`Voice ${general.voice} · Gatera ${general.gatera}`}/><Card title="PALETAS ARMADAS" value={fmt(general.paletas)} line1={`${general.dias} días · Promedio ${fmt(general.paletas/Math.max(1,general.dias))}/día`}/><Card title="BULTOS" value={fmt(general.bultos)} line1={`Promedio ${fmt(general.bultos/Math.max(1,general.dias))}/día`}/></div><Evolucion/></>}</>}

  {tab==='ranking'&&<section><h2>🏆 Ranking operativo</h2><div style={{display:'flex',gap:8,marginBottom:12}}>{['TARDE','NOCHE'].map(t=><Pill key={t} active={rankingTurno===t} onClick={()=>setRankingTurno(t)}>{nombreTurno(t)}</Pill>)}</div>{!ranking.length?<Empty>No hay operadores con {MIN_DIAS} días o más.</Empty>:<table style={{width:'100%',fontSize:13}}><thead style={{position:'sticky',top:92,zIndex:4}}><tr><th>#</th><th>Operador</th><th>Días</th><th>Paletas</th><th>Productividad</th><th>Cumpl.</th><th>Errores</th><th>Tasa</th><th>Calidad</th><th>Ficha</th></tr></thead><tbody>{ranking.map((x,i)=><tr key={x.key}><td>{i+1}</td><td>{x.name}</td><td>{x.dias}</td><td>{fmt(x.paletas)}</td><td>{fmt(x.productividad)}</td><td>{pct(x.cumplimiento)}</td><td>{x.total}</td><td>{pct(x.tasaError)}</td><td>{pct(x.calidad)}</td><td><button onClick={()=>{setSelected(x.key);setSearch(x.name);setReturnTab('ranking');setTab('ficha')}}>Ver</button></td></tr>)}</tbody></table>}<details className="notice"><summary>{excluidos.length} operadores no elegibles por tener menos de {MIN_DIAS} días</summary>{excluidos.map(x=><p key={x.key}>{x.name} · {x.dias} días · {fmt(x.paletas)} paletas</p>)}</details></section>}

  {tab==='ficha'&&<section>{returnTab&&<button onClick={()=>setTab(returnTab)}>← Volver</button>}<h2>🔍 Ficha completa del operador</h2><input value={search} onChange={e=>{setSearch(e.target.value);setSelected('')}} placeholder="Buscar por nombre o legajo"/>{options.length>0&&!selected&&<div className="notice">{options.map(o=><button key={o.key} onClick={()=>{setSelected(o.key);setSearch(o.name)}}>{o.name} · {o.legajo}</button>)}</div>}{!ficha?<Empty>Seleccioná un operador.</Empty>:<><div className="analysis-kpis"><Card title="OPERADOR" value={ficha.name} line1={`Legajo ${ficha.legajo}`} line2={`${ficha.dias} días trabajados`}/><Card title="PRODUCTIVIDAD" value={fmt(ficha.productividad)} line1={`Cumplimiento global ${pct(ficha.cumplimiento)}`} line2="Targets fijos detallados por cancha"/><Card title="PALETAS" value={fmt(ficha.paletas)} line1={`Promedio ${fmt(ficha.paletas/Math.max(1,ficha.dias))}/día`} line2={`${fmt(ficha.bultos)} bultos`}/><Card title="CALIDAD DE ARMADO" value={pct(ficha.calidad)} line1={`${ficha.total} errores · tasa ${pct(ficha.tasaError)}`} line2={`Voice ${ficha.voice} · Gatera ${ficha.gatera}`}/></div><section className="panel"><h3>Desempeño por cancha y turno</h3><table style={{width:'100%',fontSize:13}}><thead><tr><th>Cancha</th><th>Turno</th><th>Días</th><th>Paletas</th><th>Prod.</th><th>Target</th><th>Cumpl.</th><th>Errores</th><th>Calidad</th></tr></thead><tbody>{fichaCanchas.map(x=><tr key={`${x.turno}-${x.cancha}`}><td>{x.cancha}</td><td>{nombreTurno(x.turno)}</td><td>{x.dias}</td><td>{fmt(x.paletas)}</td><td>{fmt(x.productividad)}</td><td>{x.target}</td><td>{pct(x.cumplimiento)}</td><td>{x.total}</td><td>{pct(x.calidad)}</td></tr>)}</tbody></table></section><ErrorExplorer rows={ficha.errors} empMap={empMap} title="Errores, SKU y motivos"/></>}</section>}

  {tab==='canchas'&&<section><h2>🎯 Canchas</h2><div style={{display:'flex',gap:8,marginBottom:12}}>{['TARDE','NOCHE'].map(t=><Pill key={t} active={canchaTurno===t} onClick={()=>{setCanchaTurno(t);setDetail(null)}}>{nombreTurno(t)}</Pill>)}</div><table style={{width:'100%',fontSize:13}}><thead><tr><th>Cancha</th><th>Días</th><th>Paletas</th><th>Productividad</th><th>Target</th><th>Cumpl.</th><th>Errores</th><th>Calidad</th><th>Detalle</th></tr></thead><tbody>{canchas.map(x=><tr key={x.cancha}><td>{x.cancha}</td><td>{x.dias}</td><td>{fmt(x.paletas)}</td><td>{fmt(x.productividad)}</td><td>{x.target}</td><td>{pct(x.cumplimiento)}</td><td>{x.total}</td><td>{pct(x.calidad)}</td><td><button onClick={()=>setDetail(x)}>Abrir</button></td></tr>)}</tbody></table>{detail&&<section className="panel" ref={detailRef}><div style={{display:'flex',justifyContent:'space-between'}}><h3>{detail.cancha} · {nombreTurno(detail.turno)}</h3><button onClick={()=>setDetail(null)}>Cerrar</button></div><ErrorExplorer rows={detail.errorRows} empMap={empMap} title="Detalle de errores de la cancha"/></section>}</section>}

  {tab==='asistente'&&<section><h2>🤖 Asistente operativo</h2><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:8}}>{preguntas.map(([id,label])=><button key={id} onClick={()=>setAssistant(responder(id))}>{label}</button>)}</div>{assistant&&<section className="panel"><h3>{assistant.title}</h3>{assistant.lines.map((l,i)=><p key={i}>• {l}</p>)}{assistant.errors?.length>0&&<ErrorExplorer rows={assistant.errors} empMap={empMap} title="Evidencia y detalle de errores"/>}</section>}</section>}

  {tab==='auditoria'&&<section><h2>🛡️ Auditoría de datos</h2><p>Validación estructural. No reemplaza la revisión operativa.</p><div className="analysis-kpis"><Card title="PICKING" value={fmt(audit.picking)} line1="Filas cargadas, no paletas"/><Card title="ERRORES REALES" value={fmt(audit.errors)} line1="Filas válidas Voice + Gatera"/><Card title="MESES" value={audit.months} line1={`Con datos en ${year}`}/><Card title="INCONSISTENCIAS" value={audit.alerts.length} line1="Campos o relaciones a revisar"/></div>{audit.alerts.length?audit.alerts.map((a,i)=><article className="panel" key={i}><b>{a.title}</b><h3>{a.count}</h3><p>{a.detail}</p></article>):<div className="notice">Sin inconsistencias estructurales detectadas. Esto no garantiza que todos los cálculos operativos sean correctos.</div>}<section className="panel"><h3>Errores administrativos separados</h3><p>E.Carrier, TADA y Carga no afectan ranking, ficha ni calidad del pickero.</p><div className="analysis-kpis">{['E.Carrier','TADA','Carga'].map(tipo=>{const rows=eAdministrativos.filter(e=>tipoAdministrativo(e)===tipo);return <Card key={tipo} title={tipo.toUpperCase()} value={rows.length} line1="Registros administrativos"/>})}</div><ErrorExplorer rows={eAdministrativos} empMap={empMap} title="Detalle administrativo"/></section></section>}
  </main></div></section>;
}
