import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';

const MIN_DIAS = 10;
const TARGET_GENERAL = { TODOS: 362, TARDE: 398, NOCHE: 354 };
const TARGET_CANCHA = {
  TARDE: { C1: 461, C2: 258, C3: 258, C4: 409, C5: 488 },
  NOCHE: { C1: 372, C2: 212, C3: 224, C4: 328, C5: 461 }
};

const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const txt = value => String(value ?? '').trim();
const norm = value => txt(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().toUpperCase();
const fmt = value => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(n(value));
const pct = value => `${n(value).toFixed(1)}%`;
const iso = value => txt(value).slice(0, 10);
const fechaAR = value => { const [y,m,d] = iso(value).split('-'); return y && m && d ? `${d}/${m}/${y}` : txt(value); };

const canonTurno = value => {
  const t = norm(value);
  if (t.includes('NOCHE') || t === 'TN' || t === 'N') return 'NOCHE';
  if (t.includes('TARDE') || t === 'TT' || t === 'T') return 'TARDE';
  return t || 'SIN TURNO';
};
const nombreTurno = value => canonTurno(value) === 'NOCHE' ? 'Noche' : canonTurno(value) === 'TARDE' ? 'Tarde' : txt(value);
const operatorKey = row => txt(row.empleado_id || row.legajo || row.datos_originales?.operador || 'SIN OPERADOR');
const dias = rows => new Set(rows.map(r => iso(r.fecha)).filter(Boolean)).size;
const paletas = rows => rows.reduce((s,r) => s + n(r.pallets), 0);
const bultos = rows => rows.reduce((s,r) => s + n(r.packs), 0);
const productividad = rows => {
  if (!rows.length) return 0;
  const packs = bultos(rows);
  const segundos = rows.reduce((s,r) => s + n(r.duracion_segundos), 0);
  return packs > 0 && segundos > 0 ? packs / (segundos / 3600) : rows.reduce((s,r) => s + n(r.productividad), 0) / rows.length;
};
const targetFila = row => {
  const cargado = n(row.target);
  if (cargado > 0) return cargado;
  return TARGET_CANCHA[canonTurno(row.turno)]?.[txt(row.cancha).toUpperCase()] || 0;
};
const cumplimientoFilas = rows => {
  if (!rows.length) return 0;
  const valores = rows.map(r => ({ prod: n(r.productividad), target: targetFila(r) })).filter(x => x.target > 0);
  return valores.length ? valores.reduce((s,x) => s + (x.prod / x.target) * 100, 0) / valores.length : 0;
};
const noEsError = row => {
  const motivo = norm(row.motivo || row.descripcion || row.comentario);
  const cantidad = n(row.total_errores ?? row.cantidad ?? row.errores ?? 0);
  return cantidad <= 0 || motivo === 'OK' || motivo.includes('SIN NOVEDAD') || motivo.includes('SIN ERROR');
};
const errorCantidad = () => 1;
const paletaErrorKey = row => txt(row.numero_paleta || row.paleta || `${row.__origen}-${row.id || ''}-${row.empleado_id || ''}-${row.fecha || ''}`);

function resumenErrores(rows) {
  const validos = rows.filter(r => !noEsError(r));
  const voice = validos.filter(r => r.__origen === 'VOICE').reduce((s,r) => s + errorCantidad(r), 0);
  const gatera = validos.filter(r => r.__origen === 'GATERA').reduce((s,r) => s + errorCantidad(r), 0);
  return { validos, voice, gatera, total: voice + gatera, paletasConError: new Set(validos.map(paletaErrorKey)).size };
}

function resumen(rows, errorRows, targetGeneral = 0) {
  const p = paletas(rows);
  const prod = productividad(rows);
  const target = targetGeneral || (rows.length ? rows.reduce((s,r) => s + targetFila(r), 0) / rows.length : 0);
  const cum = target > 0 ? prod / target * 100 : cumplimientoFilas(rows);
  const err = resumenErrores(errorRows);
  const tasaError = p > 0 ? err.total / p * 100 : 0;
  const calidad = p > 0 ? Math.max(0, 100 - tasaError) : null;
  const verificadas = new Set(errorRows.filter(r => r.__origen === 'VOICE').map(r => txt(r.numero_paleta || r.id))).size;
  return { productividad: prod, target, cumplimiento: cum, paletas: p, bultos: bultos(rows), dias: dias(rows), tasaError, calidad, verificadas, tasaControl: p > 0 ? verificadas / p * 100 : 0, ...err };
}

const Stat = ({ title, value, detail, detail2 }) => <div><span>{title}</span><b>{value}</b><small>{detail}</small>{detail2 && <small>{detail2}</small>}</div>;
const NoData = ({ children = 'Sin datos para el período seleccionado.' }) => <div className="notice">{children}</div>;


async function cargarTablaCompleta(tabla) {
  const pagina = 1000;
  let desde = 0;
  let resultado = [];
  while (true) {
    const { data, error } = await supabase.from(tabla).select('*').order('id', { ascending: true }).range(desde, desde + pagina - 1);
    if (error) throw error;
    const filas = data || [];
    resultado = resultado.concat(filas);
    if (filas.length < pagina) break;
    desde += pagina;
  }
  return resultado;
}

export default function AnalisisOperativoV3() {
  const [tab,setTab] = useState('dashboard');
  const [periodo,setPeriodo] = useState('mes');
  const [year,setYear] = useState('2026');
  const [month,setMonth] = useState('1');
  const [turno,setTurno] = useState('');
  const [fecha,setFecha] = useState('');
  const [rankingTurno,setRankingTurno] = useState('TARDE');
  const [search,setSearch] = useState('');
  const [selected,setSelected] = useState('');
  const [assistant,setAssistant] = useState(null);
  const [picking,setPicking] = useState([]);
  const [errors,setErrors] = useState([]);
  const [employees,setEmployees] = useState([]);
  const [loading,setLoading] = useState(true);
  const [message,setMessage] = useState('');
  const [showExcluded,setShowExcluded] = useState(false);
  const [returnToRanking,setReturnToRanking] = useState(false);
  const [selectedCourt,setSelectedCourt] = useState(null);
  const [courtMode,setCourtMode] = useState('');
  const [selectedSku,setSelectedSku] = useState('');
  const detailRef = useRef(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [p,g,v,e] = await Promise.all([cargarTablaCompleta('picking'),cargarTablaCompleta('errores_gatera'),cargarTablaCompleta('errores_voice'),cargarTablaCompleta('empleados')]);
        setPicking(p);
        setErrors([...g.map(r => ({...r,__origen:'GATERA'})),...v.map(r => ({...r,__origen:'VOICE'}))]);
        setEmployees(e);
      } catch (error) {
        setMessage(error.message || 'No se pudieron cargar todos los datos.');
      } finally { setLoading(false); }
    })();
  },[]);

  useEffect(() => { setAssistant(null); }, [periodo,year,month,turno,fecha]);
  useEffect(() => { if(selectedCourt && detailRef.current) detailRef.current.scrollIntoView({behavior:'smooth',block:'start'}); }, [selectedCourt,courtMode]);

  const empMap = useMemo(() => new Map(employees.map(e => [txt(e.id),e])),[employees]);
  const inRange = row => {
    const f = iso(row.fecha);
    if (!f) return false;
    if (periodo === 'anio') return f.startsWith(`${year}-`);
    if (periodo === 'mes') return f.startsWith(`${year}-${String(month).padStart(2,'0')}-`);
    if (periodo === 'dia') return f === fecha;
    if (!fecha) return false;
    const end = new Date(`${fecha}T00:00:00`); const start = new Date(end);
    start.setDate(start.getDate() - (periodo === 'semana' ? 6 : 14));
    const d = new Date(`${f}T00:00:00`); return d >= start && d <= end;
  };
  const byTurno = (rows,t = turno) => !t ? rows : rows.filter(r => canonTurno(r.turno) === t);
  const pPeriod = useMemo(() => picking.filter(inRange),[picking,periodo,year,month,fecha]);
  const ePeriod = useMemo(() => errors.filter(inRange),[errors,periodo,year,month,fecha]);
  const pFiltered = useMemo(() => byTurno(pPeriod),[pPeriod,turno]);
  const eFiltered = useMemo(() => byTurno(ePeriod),[ePeriod,turno]);
  const generalTarget = turno ? TARGET_GENERAL[turno] : TARGET_GENERAL.TODOS;
  const general = useMemo(() => resumen(pFiltered,eFiltered,generalTarget),[pFiltered,eFiltered,generalTarget]);
  const tarde = useMemo(() => resumen(byTurno(pPeriod,'TARDE'),byTurno(ePeriod,'TARDE'),TARGET_GENERAL.TARDE),[pPeriod,ePeriod]);
  const noche = useMemo(() => resumen(byTurno(pPeriod,'NOCHE'),byTurno(ePeriod,'NOCHE'),TARGET_GENERAL.NOCHE),[pPeriod,ePeriod]);

  const operatorsBase = useMemo(() => {
    const map = new Map();
    pPeriod.forEach(r => {
      const key = operatorKey(r); if (!map.has(key)) map.set(key,{key,employeeId:txt(r.empleado_id),rows:[],errors:[]}); map.get(key).rows.push(r);
    });
    ePeriod.forEach(r => { const item = map.get(txt(r.empleado_id)); if (item && !noEsError(r)) item.errors.push(r); });
    return [...map.values()].map(item => {
      const emp = empMap.get(item.employeeId);
      const data = resumen(item.rows,item.errors,0);
      return {...item,...data,name:txt(emp?.apellido_nombre || item.rows[0]?.datos_originales?.operador || 'SIN NOMBRE'),legajo:txt(emp?.legajo),turnos:[...new Set(item.rows.map(r => canonTurno(r.turno)))]};
    });
  },[pPeriod,ePeriod,empMap]);

  const ranking = useMemo(() => {
    const base = operatorsBase.map(op => {
      const rows = byTurno(op.rows,rankingTurno); const errs = byTurno(op.errors,rankingTurno); const data = resumen(rows,errs,0);
      return {...op,...data,rows,errors:errs,elegible:data.dias >= MIN_DIAS && data.paletas > 0};
    }).filter(x => x.elegible);
    const maxPal = Math.max(1,...base.map(x => x.paletas));
    return base.map(x => {
      const ability = Math.min(x.cumplimiento,120)/120*35;
      const quality = x.tasaError <= 0 ? 40 : x.tasaError <= 1 ? 38 : x.tasaError <= 2 ? 32 : x.tasaError <= 3 ? 22 : x.tasaError <= 4 ? 10 : 0;
      const volume = x.paletas/maxPal*25;
      return {...x,score:ability+quality+volume,blocked:x.total>24 || x.tasaError>4};
    }).sort((a,b) => b.score-a.score);
  },[operatorsBase,rankingTurno]);
  const eligibleTop = ranking.filter(x => !x.blocked);
  const excluded = useMemo(() => operatorsBase.map(op => { const data=resumen(byTurno(op.rows,rankingTurno),byTurno(op.errors,rankingTurno),0); return {...op,...data}; }).filter(x => x.dias>0 && x.dias<MIN_DIAS),[operatorsBase,rankingTurno]);

  const courts = t => {
    const map = new Map(); byTurno(pPeriod,t).forEach(r => { const c=txt(r.cancha||'SIN CANCHA').toUpperCase(); if(!map.has(c))map.set(c,[]);map.get(c).push(r); });
    return [...map.entries()].map(([cancha,rows]) => {
      const errs=byTurno(ePeriod,t).filter(e=>txt(e.cancha).toUpperCase()===cancha); const data=resumen(rows,errs,TARGET_CANCHA[t]?.[cancha]||0);
      return {cancha,turno:t,operators:new Set(rows.map(operatorKey)).size,rows,errors:errs,...data};
    }).sort((a,b)=>b.cumplimiento-a.cumplimiento);
  };
  const courtsTarde=useMemo(()=>courts('TARDE'),[pPeriod,ePeriod]);
  const courtsNoche=useMemo(()=>courts('NOCHE'),[pPeriod,ePeriod]);

  const options = useMemo(() => { const q=norm(search); return q ? operatorsBase.filter(o=>norm(o.name).includes(q)||o.legajo.includes(search.trim())).slice(0,15) : []; },[search,operatorsBase]);
  const ficha = operatorsBase.find(o=>o.key===selected) || (options.length===1?options[0]:null);
  const fichaCourts = useMemo(() => {
    if(!ficha)return[]; const map=new Map(); ficha.rows.forEach(r=>{const k=`${canonTurno(r.turno)}|${txt(r.cancha).toUpperCase()}`;if(!map.has(k))map.set(k,[]);map.get(k).push(r);});
    return [...map.entries()].map(([k,rows])=>{const[t,c]=k.split('|');const errs=ficha.errors.filter(e=>canonTurno(e.turno)===t&&txt(e.cancha).toUpperCase()===c);return{turno:t,cancha:c,rows,errors:errs,...resumen(rows,errs,TARGET_CANCHA[t]?.[c]||0)};}).sort((a,b)=>b.paletas-a.paletas);
  },[ficha]);
  const fichaErrors = useMemo(() => {
    if(!ficha)return[]; const map=new Map(); ficha.errors.forEach(e=>{const sku=txt(e.sku||e.codigo||e.material||'SIN SKU');const motivo=txt(e.motivo||'SIN MOTIVO');const k=`${sku}|${motivo}`;if(!map.has(k))map.set(k,{sku,motivo,total:0,voice:0,gatera:0,dates:new Set(),courts:new Set()});const x=map.get(k);const c=errorCantidad(e);x.total+=c;x[e.__origen==='VOICE'?'voice':'gatera']+=c;x.dates.add(iso(e.fecha));x.courts.add(txt(e.cancha));});return[...map.values()].map(x=>({...x,dates:[...x.dates].sort(),courts:[...x.courts].filter(Boolean)})).sort((a,b)=>b.total-a.total);
  },[ficha]);
  const dayDetails = useMemo(() => {
    if(!ficha)return[];const map=new Map();ficha.rows.forEach(r=>{const d=iso(r.fecha);if(!map.has(d))map.set(d,[]);map.get(d).push(r);});return[...map.entries()].map(([date,rows])=>{const errs=ficha.errors.filter(e=>iso(e.fecha)===date);const main=rows.slice().sort((a,b)=>n(b.pallets)-n(a.pallets))[0];return{date,cancha:txt(main?.cancha),...resumen(rows,errs,targetFila(main||{}))};}).sort((a,b)=>a.date.localeCompare(b.date));
  },[ficha]);

  const analizarErrores = rows => {
    const validos = rows.filter(r => !noEsError(r));
    const sku = new Map(), fechas = new Map(), motivos = new Map(), operadores = new Map();
    validos.forEach(e => {
      const sk = txt(e.sku || e.codigo || e.material || 'SIN SKU');
      const fe = iso(e.fecha) || 'SIN FECHA';
      const mo = txt(e.motivo || 'SIN MOTIVO');
      const op = txt(empMap.get(txt(e.empleado_id))?.apellido_nombre || 'SIN OPERADOR');
      sku.set(sk,(sku.get(sk)||0)+1); fechas.set(fe,(fechas.get(fe)||0)+1); motivos.set(mo,(motivos.get(mo)||0)+1); operadores.set(op,(operadores.get(op)||0)+1);
    });
    const top = map => [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
    return { validos, sku:top(sku), fechas:top(fechas), motivos:top(motivos), operadores:top(operadores) };
  };

  const MiniBars = ({titulo,items,total,onSelect}) => <section className="panel" style={{padding:14}}><h3 style={{marginTop:0}}>{titulo}</h3>{items.length?items.map(([label,value],i)=><button key={`${label}-${i}`} onClick={()=>onSelect?.(label)} style={{display:'grid',gridTemplateColumns:'110px 1fr 70px',alignItems:'center',gap:8,width:'100%',border:0,background:'transparent',padding:'5px 0',textAlign:'left',cursor:onSelect?'pointer':'default'}}><b>{label}</b><span style={{height:10,borderRadius:6,background:'#eee',overflow:'hidden'}}><span style={{display:'block',height:'100%',width:`${Math.max(5,value/Math.max(1,items[0][1])*100)}%`,background:'#f0c400'}}/></span><small>{value} · {pct(value/Math.max(1,total)*100)}</small></button>):<p>Sin errores reales.</p>}</section>;

  const courtDetail = useMemo(() => {
    if(!selectedCourt)return null;
    return (selectedCourt.turno==='TARDE'?courtsTarde:courtsNoche).find(x=>x.cancha===selectedCourt.cancha)||null;
  },[selectedCourt,courtsTarde,courtsNoche]);
  const courtAnalysis = useMemo(()=>analizarErrores(courtDetail?.errors||[]),[courtDetail,empMap]);
  const courtOperators = useMemo(()=>{
    if(!courtDetail)return[];
    return [...new Set(courtDetail.rows.map(operatorKey))].map(key=>{const base=operatorsBase.find(x=>x.key===key);if(!base)return null;const rows=courtDetail.rows.filter(r=>operatorKey(r)===key);const errs=courtDetail.errors.filter(e=>txt(e.empleado_id)===base.employeeId);return{...base,...resumen(rows,errs,courtDetail.target)}}).filter(Boolean).sort((a,b)=>b.paletas-a.paletas);
  },[courtDetail,operatorsBase]);
  const courtErrors = useMemo(()=>{
    let rows=courtAnalysis.validos;
    if(selectedSku)rows=rows.filter(e=>txt(e.sku||e.codigo||e.material||'SIN SKU')===selectedSku);
    return rows;
  },[courtAnalysis,selectedSku]);

  const assistantQuestions=[['op','¿Quién tuvo más errores?'],['turn','¿Qué turno tuvo mayor tasa de error?'],['court','¿Qué cancha necesita revisión?'],['sku','¿Qué SKU se repitió más?'],['best','¿Quién produjo más paletas con menos errores?'],['today','¿Qué ocurrió en la fecha seleccionada?'],['why','¿Dónde conviene realizar un 5 Why?'],['adf','¿Qué caso requiere un ADF?']];
  const answer = id => {
    if(!pFiltered.length)return{title:'Sin datos',lines:['No hay información para el período y turno seleccionados.']};
    if(id==='op'){const x=operatorsBase.slice().sort((a,b)=>b.total-a.total)[0];return{title:'Operador con más errores',lines:x?[`${x.name}: ${x.total} errores reales.`,`Voice ${x.voice} · Gatera ${x.gatera}.`,`${fmt(x.paletas)} paletas armadas · tasa ${pct(x.tasaError)}.`]:['Sin errores reales.'],details:x?.errors||[]};}
    if(id==='turn'){const a=[{name:'Tarde',...tarde},{name:'Noche',...noche}].filter(x=>x.paletas);const x=a.sort((a,b)=>b.tasaError-a.tasaError)[0];return{title:'Turno con mayor tasa de error',lines:x?[`${x.name}: ${pct(x.tasaError)}.`,`${x.total} errores totales sobre ${fmt(x.paletas)} paletas.`,`Target ${fmt(x.target)} · cumplimiento ${pct(x.cumplimiento)}.`]:['Información insuficiente.']};}
    if(id==='court'){const all=[...courtsTarde,...courtsNoche];const x=all.sort((a,b)=>(b.tasaError*2+Math.max(0,100-b.cumplimiento))-(a.tasaError*2+Math.max(0,100-a.cumplimiento)))[0];if(!x)return{title:'Información insuficiente',lines:[]};const level=x.tasaError>4||x.total>24?'Crítica':x.tasaError>2||x.cumplimiento<100?'Requiere revisión':x.tasaError>1?'Seguimiento preventivo':'Sin alerta';return{title:`Cancha ${x.cancha} · Turno ${nombreTurno(x.turno)}`,lines:[`Nivel: ${level}.`,`Productividad ${fmt(x.productividad)} / Target ${fmt(x.target)} · cumplimiento ${pct(x.cumplimiento)}.`,`${fmt(x.paletas)} paletas · ${x.total} errores totales · tasa ${pct(x.tasaError)}.`]};}
    if(id==='sku'){const all=errors.filter(inRange).filter(e=>!noEsError(e));const map=new Map();all.forEach(e=>{const sku=txt(e.sku||e.codigo||e.material||'SIN SKU');map.set(sku,(map.get(sku)||0)+errorCantidad(e));});const x=[...map.entries()].sort((a,b)=>b[1]-a[1])[0];return{title:'SKU más repetido',lines:x?[`SKU ${x[0]}: ${x[1]} errores totales.`]:['No hay SKU con errores reales.']};}
    if(id==='best'){const x=operatorsBase.filter(o=>o.dias>=MIN_DIAS).sort((a,b)=>(b.paletas*(1-b.tasaError/100))-(a.paletas*(1-a.tasaError/100)))[0];return{title:'Más paletas con menos errores',lines:x?[`${x.name}: ${fmt(x.paletas)} paletas.`,`${x.total} errores totales · tasa ${pct(x.tasaError)}.`,`Productividad ${fmt(x.productividad)}.`]:['No hay operadores elegibles.']};}
    if(id==='today'){if(!fecha)return{title:'Elegí una fecha',lines:['La pregunta diaria usa la fecha seleccionada.']};const rows=picking.filter(r=>iso(r.fecha)===fecha);const errs=errors.filter(r=>iso(r.fecha)===fecha);const x=resumen(byTurno(rows),byTurno(errs),turno?TARGET_GENERAL[turno]:TARGET_GENERAL.TODOS);return{title:`Resumen del ${fechaAR(fecha)}`,lines:rows.length?[`${fmt(x.paletas)} paletas · ${fmt(x.bultos)} bultos.`,`Productividad ${fmt(x.productividad)} / Target ${fmt(x.target)} · cumplimiento ${pct(x.cumplimiento)}.`,`${x.total} errores totales · calidad de armado ${pct(x.calidad)}.`]:['Sin datos para esa fecha y turno.']};}
    if(id==='why'){const skuAns=answer('sku');const opAns=answer('op');return{title:'Caso sugerido para 5 Why',lines:[...skuAns.lines,...opAns.lines,'1. ¿Por qué ocurrió?','2. ¿Por qué se generó esa condición?','3. ¿Por qué no fue detectado antes?','4. ¿Por qué el control no lo evitó?','5. ¿Cuál es la causa raíz?']};}
    const x=operatorsBase.find(o=>o.total>24||o.tasaError>4);return{title:x?'Caso sugerido para ADF':'Sin caso crítico para ADF',lines:x?[`${x.name}: ${x.total} errores totales y tasa ${pct(x.tasaError)}.`,`Productividad ${fmt(x.productividad)} · cumplimiento ${pct(x.cumplimiento)}.`,'Documentar evidencia, causa, acción y seguimiento.']:['Ningún operador supera los umbrales definidos.']};
  };

  const hasData=pFiltered.length>0;
  return <section className="panel people-analysis">
    <div className="analysis-title"><div><small>INTELIGENCIA OPERATIVA V3</small><h2>Centro de Inteligencia Operativa</h2><p>Productividad, paletas armadas, bultos, calidad de armado y análisis por turno.</p></div></div>
    <div className="analysis-filters">
      <label>Año<input value={year} onChange={e=>setYear(e.target.value)}/></label>
      <label>Mes<select value={month} onChange={e=>setMonth(e.target.value)}>{Array.from({length:12},(_,i)=><option key={i+1} value={String(i+1)}>{i+1}</option>)}</select></label>
      <label>Turno<select value={turno} onChange={e=>setTurno(e.target.value)}><option value="">Todos</option><option value="TARDE">Tarde</option><option value="NOCHE">Noche</option></select></label>
      <label>Período<select value={periodo} onChange={e=>setPeriodo(e.target.value)}><option value="mes">Mes</option><option value="dia">Día</option><option value="semana">Semana</option><option value="quincena">Quincena</option><option value="anio">Año</option></select></label>
      {['dia','semana','quincena'].includes(periodo)&&<label>Fecha de referencia<input type="date" value={fecha} onChange={e=>setFecha(e.target.value)}/></label>}
    </div>
    <div className="analysis-nav">{[['dashboard','Dashboard'],['ranking','Ranking Operativo'],['operator','Ficha Operador'],['courts','Canchas'],['assistant','Asistente Operativo']].map(([id,label])=><button key={id} className={tab===id?'sel':''} onClick={()=>setTab(id)}>{label}</button>)}</div>
    {loading&&<div className="notice">Cargando datos reales...</div>}{message&&<div className="notice">{message}</div>}

    {tab==='dashboard'&&(!hasData?<NoData/>:<><div className="analysis-kpis">
      <Stat title="📈 PRODUCTIVIDAD PROMEDIO" value={fmt(general.productividad)} detail={`Target ${fmt(general.target)} · Cumplimiento ${pct(general.cumplimiento)}`} detail2={`${pct(Math.abs(general.cumplimiento-100))} ${general.cumplimiento>=100?'por encima':'debajo'} del objetivo`}/>
      <Stat title="✅ CALIDAD DE ARMADO" value={general.calidad===null?'Sin datos':pct(general.calidad)} detail={`${fmt(general.paletas)} paletas · ${general.total} errores totales`} detail2={`Voice ${general.voice} · Gatera ${general.gatera} · tasa ${pct(general.tasaError)}`}/>
      <Stat title="📦 PALETAS ARMADAS" value={fmt(general.paletas)} detail={`${general.dias} días con actividad`} detail2={`Promedio ${fmt(general.paletas/Math.max(1,general.dias))} por día`}/>
      <Stat title="📦 BULTOS" value={fmt(general.bultos)} detail={`Promedio ${fmt(general.bultos/Math.max(1,general.dias))} por día`}/>
    </div><div className="analysis-kpis">
      {(!turno||turno==='TARDE')&&<Stat title="TURNO TARDE" value={tarde.paletas?fmt(tarde.productividad):'Sin datos'} detail={tarde.paletas?`Target 398 · Cumplimiento ${pct(tarde.cumplimiento)}`:'Sin actividad'} detail2={tarde.paletas?`${fmt(tarde.paletas)} paletas · ${tarde.total} errores · calidad ${pct(tarde.calidad)}`:''}/>} 
      {(!turno||turno==='NOCHE')&&<Stat title="TURNO NOCHE" value={noche.paletas?fmt(noche.productividad):'Sin datos'} detail={noche.paletas?`Target 354 · Cumplimiento ${pct(noche.cumplimiento)}`:'Sin actividad'} detail2={noche.paletas?`${fmt(noche.paletas)} paletas · ${noche.total} errores · calidad ${pct(noche.calidad)}`:''}/>} 
      <Stat title="🔎 CONTROL VOICE" value={pct(general.tasaControl)} detail={`${general.verificadas} paletas verificadas de ${fmt(general.paletas)} armadas`} detail2={`${general.voice} errores Voice`}/>
    </div></>)}

    {tab==='ranking'&&<section><h2>🏆 Ranking Operativo</h2><div className="notice">Mínimo 10 días. Score: 35% cumplimiento contra target + 40% calidad de armado + 25% paletas armadas. Más de 24 errores o tasa mayor al 4% impide ser Mejor Operador.</div><div className="analysis-nav">{['TARDE','NOCHE'].map(t=><button key={t} className={rankingTurno===t?'sel':''} onClick={()=>setRankingTurno(t)}>Turno {nombreTurno(t)}</button>)}</div>
      {!ranking.length?<NoData>No hay operadores con {MIN_DIAS} días o más en el Turno {nombreTurno(rankingTurno)}.</NoData>:<><div className="analysis-kpis"><Stat title="🏆 MEJOR OPERADOR" value={eligibleTop[0]?.name||'Sin elegible'} detail={eligibleTop[0]?`Score ${eligibleTop[0].score.toFixed(1)} · ${eligibleTop[0].dias} días · ${fmt(eligibleTop[0].paletas)} paletas`:'Todos presentan alertas críticas'} detail2={eligibleTop[0]?`${eligibleTop[0].total} errores totales · tasa ${pct(eligibleTop[0].tasaError)}`:''}/><Stat title="🥈 SEGUNDO OPERADOR" value={eligibleTop[1]?.name||'Sin elegible'} detail={eligibleTop[1]?`Score ${eligibleTop[1].score.toFixed(1)} · ${eligibleTop[1].dias} días · ${fmt(eligibleTop[1].paletas)} paletas`:'Sin segundo elegible'} detail2={eligibleTop[1]?`${eligibleTop[1].total} errores totales · calidad ${pct(eligibleTop[1].calidad)}`:''}/></div><div className="scroll" style={{maxHeight:560}}><table><thead style={{position:'sticky',top:0,zIndex:2}}><tr><th>#</th><th style={{position:'sticky',left:0,zIndex:3}}>Operador</th><th>Días</th><th>Paletas armadas</th><th>Productividad</th><th>Cumplimiento</th><th>Errores Voice</th><th>Errores Gatera</th><th>Errores totales</th><th>Paletas afectadas</th><th>Tasa de error</th><th>Calidad de armado</th><th>Score</th><th>Ver ficha</th></tr></thead><tbody>{ranking.map((x,i)=><tr key={x.key}><td>{i+1}</td><td style={{position:'sticky',left:0,background:'white'}}>{x.name}</td><td>{x.dias}</td><td>{fmt(x.paletas)}</td><td>{fmt(x.productividad)}</td><td>{pct(x.cumplimiento)}</td><td>{x.voice}</td><td>{x.gatera}</td><td>{x.total}</td><td>{x.paletasConError}</td><td>{pct(x.tasaError)}</td><td>{pct(x.calidad)}</td><td>{x.score.toFixed(1)}</td><td><button onClick={()=>{setSelected(x.key);setSearch(x.name);setReturnToRanking(true);setTab('operator')}}>Ver ficha</button></td></tr>)}</tbody></table></div></>}
      {!!excluded.length&&<div className="notice"><b>{excluded.length} operadores no elegibles por tener menos de {MIN_DIAS} días.</b><button onClick={()=>setShowExcluded(!showExcluded)}>{showExcluded?'Ocultar listado':'Ver listado'}</button>{showExcluded&&<div>{excluded.map(x=><p key={x.key}>{x.name} · {x.dias} días · {fmt(x.paletas)} paletas</p>)}</div>}</div>}
    </section>}

    {tab==='operator'&&<section>{returnToRanking&&<button onClick={()=>{setReturnToRanking(false);setTab('ranking')}}>← Volver al Ranking</button>}<h2>🔍 Ficha completa del operador</h2><input value={search} onChange={e=>{setSearch(e.target.value);setSelected('')}} placeholder="Buscar por legajo, nombre o apellido..."/>{options.length>0&&!selected&&<div className="notice">{options.map(o=><button key={o.key} onClick={()=>{setSelected(o.key);setSearch(o.name)}}>{o.name} · {o.legajo||'Sin legajo'}</button>)}</div>}
      {!ficha?<NoData>Escribí un nombre o legajo y seleccioná un operador.</NoData>:<><div className="analysis-kpis"><Stat title="👤 OPERADOR" value={ficha.name} detail={`Legajo ${ficha.legajo||'--'}`} detail2={`${ficha.dias} días trabajados`}/><Stat title="📈 PRODUCTIVIDAD PROMEDIO" value={fmt(ficha.productividad)} detail={`Cumplimiento global ${pct(ficha.cumplimiento)}`} detail2="El target fijo de cada cancha se detalla debajo"/><Stat title="📦 PALETAS ARMADAS" value={fmt(ficha.paletas)} detail={`Promedio ${fmt(ficha.paletas/Math.max(1,ficha.dias))} paletas por día`} detail2={`${fmt(ficha.bultos)} bultos · promedio ${fmt(ficha.bultos/Math.max(1,ficha.dias))} por día`}/><Stat title="✅ CALIDAD DE ARMADO" value={pct(ficha.calidad)} detail={`${ficha.total} errores totales · ${ficha.paletasConError} paletas afectadas`} detail2={`Voice ${ficha.voice} · Gatera ${ficha.gatera} · tasa ${pct(ficha.tasaError)}`}/></div>
      <div className="analysis-kpis">{dayDetails.length>0&&<><Stat title="📅 MEJOR JORNADA" value={fechaAR([...dayDetails].sort((a,b)=>b.productividad-a.productividad)[0].date)} detail={`Cancha ${[...dayDetails].sort((a,b)=>b.productividad-a.productividad)[0].cancha} · Productividad ${fmt([...dayDetails].sort((a,b)=>b.productividad-a.productividad)[0].productividad)}`} detail2={`${fmt([...dayDetails].sort((a,b)=>b.productividad-a.productividad)[0].paletas)} paletas · ${[...dayDetails].sort((a,b)=>b.productividad-a.productividad)[0].total} errores`}/><Stat title="📉 JORNADA A REVISAR" value={fechaAR([...dayDetails].sort((a,b)=>a.productividad-b.productividad)[0].date)} detail={`Cancha ${[...dayDetails].sort((a,b)=>a.productividad-b.productividad)[0].cancha} · Productividad ${fmt([...dayDetails].sort((a,b)=>a.productividad-b.productividad)[0].productividad)}`} detail2={`${fmt([...dayDetails].sort((a,b)=>a.productividad-b.productividad)[0].paletas)} paletas · ${[...dayDetails].sort((a,b)=>a.productividad-b.productividad)[0].total} errores`}/></>}</div>
      <div><section className="panel"><h3>🎯 Desempeño por cancha y turno</h3><div className="scroll"><table><thead><tr><th>Cancha</th><th>Turno</th><th>Días</th><th>Paletas</th><th>Bultos</th><th>Productividad</th><th>Target fijo</th><th>Cumplimiento</th><th>Errores Voice</th><th>Errores Gatera</th><th>Errores totales</th><th>Paletas afectadas</th><th>Calidad de armado</th></tr></thead><tbody>{fichaCourts.map(x=><tr key={`${x.turno}-${x.cancha}`}><td>{x.cancha}</td><td>{nombreTurno(x.turno)}</td><td>{x.dias}</td><td>{fmt(x.paletas)}</td><td>{fmt(x.bultos)}</td><td>{fmt(x.productividad)}</td><td>{fmt(x.target)}</td><td>{pct(x.cumplimiento)}</td><td>{x.voice}</td><td>{x.gatera}</td><td>{x.total}</td><td>{x.paletasConError}</td><td>{pct(x.calidad)}</td></tr>)}</tbody></table></div></section><section className="panel"><h3>⚠ Errores, SKU y motivos</h3>{fichaErrors.length?fichaErrors.slice(0,15).map(x=><div className="trend-row" key={`${x.sku}-${x.motivo}`}><span>SKU {x.sku} · {x.motivo}<small>{x.dates.length===1?`${x.total} errores el mismo día: ${fechaAR(x.dates[0])}`:`${x.total} errores distribuidos en ${x.dates.length} días: ${x.dates.map(fechaAR).join(', ')}`} · Canchas {x.courts.join(', ')}</small></span><b>Total {x.total} · Voice {x.voice} / Gatera {x.gatera}</b></div>):<p>Sin errores reales en el período.</p>}</section></div></>}
    </section>}

    {tab==='courts'&&<section><h2>🎯 Análisis de canchas por turno</h2>{[['TARDE',courtsTarde],['NOCHE',courtsNoche]].map(([t,list])=><section className="panel" key={t}><h3>Turno {nombreTurno(t)} · Target general {TARGET_GENERAL[t]}</h3>{!list.length?<NoData/>:<table style={{width:'100%',fontSize:13,tableLayout:'fixed'}}><thead><tr><th>#</th><th>Cancha</th><th>Días</th><th>Operadores</th><th>Paletas</th><th>Productividad</th><th>Target</th><th>Cumplimiento</th><th>Errores</th><th>Calidad</th></tr></thead><tbody>{list.map((x,i)=><tr key={`${t}-${x.cancha}`}><td>{i+1}</td><td>{x.cancha}</td><td>{x.dias}</td><td><button className="compact" onClick={()=>{setSelectedCourt({turno:t,cancha:x.cancha});setCourtMode('operators');setSelectedSku('')}}>{x.operators} · Ver</button></td><td>{fmt(x.paletas)}</td><td>{fmt(x.productividad)}</td><td>{fmt(x.target)}</td><td>{pct(x.cumplimiento)}</td><td><button className="compact" onClick={()=>{setSelectedCourt({turno:t,cancha:x.cancha});setCourtMode('errors');setSelectedSku('')}}>{x.total} · Ver</button></td><td>{pct(x.calidad)}</td></tr>)}</tbody></table>}</section>)}
      {courtDetail&&<section className="panel" ref={detailRef}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h3>Detalle {courtDetail.cancha} · Turno {nombreTurno(courtDetail.turno)}</h3><button className="compact" onClick={()=>{setSelectedCourt(null);setSelectedSku('')}}>Cerrar detalle</button></div><p>{courtDetail.total} errores reales: {courtDetail.voice} Voice + {courtDetail.gatera} Gatera.</p>
        {courtMode==='operators'&&<table style={{width:'100%',fontSize:13}}><thead><tr><th>Operador</th><th>Días</th><th>Paletas</th><th>Productividad</th><th>Cumplimiento</th><th>Errores</th><th>Calidad</th><th>Ficha</th></tr></thead><tbody>{courtOperators.map(x=><tr key={x.key}><td>{x.name}</td><td>{x.dias}</td><td>{fmt(x.paletas)}</td><td>{fmt(x.productividad)}</td><td>{pct(x.cumplimiento)}</td><td>{x.total}</td><td>{pct(x.calidad)}</td><td><button className="compact" onClick={()=>{setSelected(x.key);setSearch(x.name);setTab('operator')}}>Ver</button></td></tr>)}</tbody></table>}
        {courtMode==='errors'&&<><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:10}}><MiniBars titulo="Top 10 SKU" items={courtAnalysis.sku} total={courtDetail.total} onSelect={setSelectedSku}/><MiniBars titulo="Días con más errores" items={courtAnalysis.fechas.map(([d,v])=>[fechaAR(d),v])} total={courtDetail.total}/><MiniBars titulo="Motivos repetidos" items={courtAnalysis.motivos} total={courtDetail.total}/><MiniBars titulo="Operadores con más errores" items={courtAnalysis.operadores} total={courtDetail.total}/></div><h3>{selectedSku?`Detalle SKU ${selectedSku}`:'Detalle completo'}</h3>{selectedSku&&<button className="compact" onClick={()=>setSelectedSku('')}>Ver todos</button>}<table style={{width:'100%',fontSize:13}}><thead><tr><th>Fecha</th><th>Paleta</th><th>Operador</th><th>SKU</th><th>Motivo</th><th>Origen</th></tr></thead><tbody>{courtErrors.map((e,i)=><tr key={e.id||i}><td>{fechaAR(e.fecha)}</td><td>{txt(e.numero_paleta||e.paleta)||'Sin dato'}</td><td>{txt(empMap.get(txt(e.empleado_id))?.apellido_nombre)||'Sin dato'}</td><td>{txt(e.sku||e.codigo||e.material)||'Sin SKU'}</td><td>{txt(e.motivo)||'Sin motivo'}</td><td>{e.__origen==='VOICE'?'Voice':'Gatera'}</td></tr>)}</tbody></table></>}
      </section>}
    </section>}

    {tab==='assistant'&&<section><h2>🤖 Asistente Operativo</h2><p>Respuestas calculadas con datos reales del período y turno seleccionados.</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(250px,1fr))',gap:8}}>{assistantQuestions.map(([id,label])=><button key={id} onClick={()=>setAssistant(answer(id))}>{label}</button>)}</div>{assistant?<section className="panel"><h3>{assistant.title}</h3>{assistant.lines.map((line,i)=><p key={i}>• {line}</p>)}{assistant.details?.length>0&&<><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:10}}><MiniBars titulo="Top 10 SKU" items={analizarErrores(assistant.details).sku} total={assistant.details.length}/><MiniBars titulo="Días con más errores" items={analizarErrores(assistant.details).fechas.map(([d,v])=>[fechaAR(d),v])} total={assistant.details.length}/><MiniBars titulo="Motivos repetidos" items={analizarErrores(assistant.details).motivos} total={assistant.details.length}/></div><table style={{width:'100%',fontSize:13}}><thead><tr><th>Fecha</th><th>Paleta</th><th>Cancha</th><th>SKU</th><th>Motivo</th><th>Origen</th></tr></thead><tbody>{assistant.details.map((e,i)=><tr key={e.id||i}><td>{fechaAR(e.fecha)}</td><td>{txt(e.numero_paleta||e.paleta)||'Sin dato'}</td><td>{txt(e.cancha)||'Sin dato'}</td><td>{txt(e.sku||e.codigo||e.material)||'Sin SKU'}</td><td>{txt(e.motivo)||'Sin motivo'}</td><td>{e.__origen==='VOICE'?'Voice':'Gatera'}</td></tr>)}</tbody></table></>}</section>:<NoData>Elegí una pregunta para generar el análisis.</NoData>}</section>}
  </section>;
}
