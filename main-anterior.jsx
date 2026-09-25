import React,{useEffect,useMemo,useState} from 'react';
import{createRoot}from'react-dom/client';
import{supabase}from'./supabase';
import{UserRound,ShieldCheck,ChevronRight,LogOut,PackageCheck,TrendingUp,FileSpreadsheet,CheckCircle2,Upload,CalendarDays,Target,AlertTriangle}from'lucide-react';
import*as XLSX from'xlsx';
import'./styles.css';
const fmt=n=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:2}).format(Number(n||0));
const dur=s=>{const m=Math.round(Number(s||0)/60),h=Math.floor(m/60);return h?`${h} h ${String(m%60).padStart(2,'0')} min`:`${m} min`};
const normal=s=>(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9]+/g,' ').trim().toUpperCase();
function App(){const[session,setSession]=useState(null),[profile,setProfile]=useState(null),[loading,setLoading]=useState(true);useEffect(()=>{supabase.auth.getSession().then(({data})=>{setSession(data.session);setLoading(false)});const{data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>subscription.unsubscribe()},[]);useEffect(()=>{if(!session){setProfile(null);return}supabase.from('perfiles').select('*,empleados(*)').eq('auth_user_id',session.user.id).single().then(({data})=>setProfile(data))},[session]);if(loading)return <Center text="Cargando..."/>;if(!session)return <Login/>;if(!profile)return <Center text="Preparando perfil..."/>;return profile.rol==='administrador'?<Admin profile={profile}/>:<Personal profile={profile}/>}
function Center({text}){return <div className="center"><b>{text}</b></div>}
function Login(){const[role,setRole]=useState('personal'),[user,setUser]=useState('29027047'),[pass,setPass]=useState(''),[err,setErr]=useState(''),[busy,setBusy]=useState(false);async function go(){setBusy(true);setErr('');const email=role==='personal'?`${user.trim()}@personal.local`:user.trim();const{error}=await supabase.auth.signInWithPassword({email,password:pass});if(error)setErr('Usuario o contraseña incorrectos.');setBusy(false)}return <div className="login"><section className="hero"><small>CD MERCADO CENTRAL</small><h1>Mi productividad,<br/><span>día a día.</span></h1><p>Clasificación manual, picking y control de errores en un solo lugar.</p></section><section className="form"><div className="box"><small>BIENVENIDO</small><h2>Ingresar</h2><div className="roles"><button className={role==='personal'?'active':''} onClick={()=>{setRole('personal');setUser('29027047')}}><UserRound/>Personal</button><button className={role==='admin'?'active':''} onClick={()=>{setRole('admin');setUser('')}}><ShieldCheck/>Administrador</button></div><label>{role==='personal'?'Número de legajo':'Correo del administrador'}</label><input value={user} onChange={e=>setUser(e.target.value)}/><label>Contraseña</label><input type="password" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==='Enter'&&go()}/>{err&&<div className="error">{err}</div>}<button className="primary" onClick={go} disabled={busy}>{busy?'Ingresando...':<>Ingresar <ChevronRight/></>}</button></div></section></div>}
function Header({profile}){return <header><div><b>Mi Productividad</b><small>CD Mercado Central · DPO</small></div><div className="headright"><span>{profile.rol==='administrador'?'Administrador':profile.empleados?.apellido_nombre}</span><button onClick={()=>supabase.auth.signOut()}><LogOut/></button></div></header>}
function Personal({profile}){const[mod,setMod]=useState('manual'),[periods,setPeriods]=useState([]),[period,setPeriod]=useState('');useEffect(()=>{supabase.from('periodos').select('*').eq('publicado',true).order('anio',{ascending:false}).order('mes',{ascending:false}).then(({data})=>{setPeriods(data||[]);if(data?.[0])setPeriod(data[0].id)})},[]);return <><Header profile={profile}/><main><div className="title"><small>PANEL PERSONAL</small><h1>Hola, {profile.empleados?.apellido_nombre?.split(',')[0]}</h1><p>Legajo {profile.empleados?.legajo} · Turno {profile.empleados?.turno}</p><select value={period} onChange={e=>setPeriod(e.target.value)}>{periods.length?periods.map(p=><option key={p.id} value={p.id}>{String(p.mes).padStart(2,'0')}/{p.anio}</option>):<option>Sin períodos publicados</option>}</select></div><nav>{[['manual',PackageCheck,'Clasificación manual'],['picking',TrendingUp,'Picking'],['gatera',FileSpreadsheet,'Errores en gatera'],['voice',ShieldCheck,'Errores Voice Picking']].map(([id,I,t])=><button key={id} className={mod===id?'sel':''} onClick={()=>setMod(id)}><I/>{t}</button>)}</nav>{period?<Modulo tipo={mod} periodo={period}/>:<Empty text="No hay períodos publicados todavía."/>}</main></>}
function Modulo({tipo,periodo}){const map={manual:'clasificacion_manual',picking:'picking',gatera:'errores_gatera',voice:'errores_voice'},[rows,setRows]=useState(null);useEffect(()=>{setRows(null);supabase.from(map[tipo]).select('*').eq('periodo_id',periodo).order('fecha',{ascending:false}).then(({data})=>setRows(data||[]))},[tipo,periodo]);if(rows===null)return <Center text="Cargando información..."/>;if(!rows.length)return <Empty text="Sin actividad registrada en este período."/>;if(tipo==='manual')return <Table title="Clasificación manual" heads={['Fecha','Objetivo','Real','Diferencia','Cumplimiento']} rows={rows.map(r=>[r.fecha,fmt(r.objetivo),fmt(r.real),fmt(r.diferencia),`${fmt(Number(r.cumplimiento)*100)}%`])}/>;if(tipo==='picking')return <Table title="Picking" heads={['Fecha','Cancha','Packs','Pallets','Duración','Bultos/h','Target']} rows={rows.map(r=>[r.fecha,r.cancha,fmt(r.packs),fmt(r.pallets),dur(r.duracion_segundos),fmt(r.productividad),fmt(r.target)])}/>;if(tipo==='gatera')return <Table title="Errores detectados en gatera" heads={['Fecha','Cancha','Motivo','Cantidad','SKU','Comentario']} rows={rows.map(r=>[r.fecha,r.cancha,r.motivo,fmt(r.cantidad),r.sku,r.comentario])}/>;return <Table title="Errores Voice Picking" heads={['Fecha','Cancha','Paleta','Bultos','Motivo','Errores']} rows={rows.map(r=>[r.fecha,r.cancha,r.numero_paleta,fmt(r.bultos),r.motivo||'Sin novedad',fmt(r.total_errores)])}/>}
function Empty({text}){return <div className="empty"><CheckCircle2/><h3>{text}</h3></div>}
function Table({title,heads,rows}){return <section className="panel"><h2>{title}</h2><div className="scroll"><table><thead><tr>{heads.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j}>{v??''}</td>)}</tr>)}</tbody></table></div></section>}
function Admin({profile}){
 const[type,setType]=useState('picking'),[year,setYear]=useState(2026),[month,setMonth]=useState(9),[file,setFile]=useState(null),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
 async function inspect(){
  if(!file){setMsg('Seleccioná un archivo Excel.');return}
  setBusy(true);setMsg('Procesando el archivo. Puede demorar unos segundos...');
  await new Promise(r=>setTimeout(r,100));
  try{
   const buf=await file.arrayBuffer();
   const wb=XLSX.read(buf,{type:'array',cellStyles:false,cellNF:false,cellHTML:false});
   const monthNames=[['ENERO','ENE'],['FEBRERO','FEB'],['MARZO','MAR'],['ABRIL','ABR'],['MAYO','MAY'],['JUNIO','JUN'],['JULIO','JUL'],['AGOSTO','AGO'],['SEPTIEMBRE','SEPT','SEP'],['OCTUBRE','OCT'],['NOVIEMBRE','NOV'],['DICIEMBRE','DIC']];
   let sheet=null;
   if(type==='picking')sheet=wb.SheetNames.find(n=>normal(n)==='BAJADA GENERAL');
   if(type==='voice')sheet=wb.SheetNames.find(n=>normal(n)==='ARCHIVEWORKUNIT');
   if(type==='manual')sheet=wb.SheetNames.find(n=>['CARGA DATOS','CARGA DE DATOS'].includes(normal(n)));
   if(type==='gatera'){const aliases=monthNames[month-1]||[];sheet=wb.SheetNames.find(n=>aliases.some(a=>normal(n)===a));}
   if(!sheet||!wb.Sheets[sheet])throw new Error(`No se encontró la hoja esperada para ${type}. Hojas disponibles: ${wb.SheetNames.join(', ')}`);
   const ws=wb.Sheets[sheet];
   let rows=0;
   if(type==='gatera'){
    for(const address of Object.keys(ws)){
     if(address[0]==='!')continue;
     const pos=XLSX.utils.decode_cell(address);
     if(pos.c!==2)continue;
     const cell=ws[address];
     let d=null;
     if(cell?.t==='n'){const x=XLSX.SSF.parse_date_code(cell.v);if(x)d={y:x.y,m:x.m}}
     else if(cell?.v){const text=String(cell.v);const m=text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);if(m)d={y:+(m[3].length===2?'20'+m[3]:m[3]),m:+m[1]}}
     if(d&&d.y===year&&d.m===month)rows++;
    }
   }else{
    const range=XLSX.utils.decode_range(ws['!ref']||'A1:A1');
    rows=Math.max(0,range.e.r-range.s.r);
   }
   setMsg(`Archivo reconocido. Hoja: ${sheet}. Registros reales detectados: ${rows}.`);
  }catch(e){setMsg(`No se pudo revisar el archivo: ${e.message}`)}finally{setBusy(false)}
 }
 return <><Header profile={profile}/><main><div className="title"><small>PANEL ADMINISTRADOR</small><h1>Carga mensual</h1><p>Revisá el archivo antes de publicarlo.</p></div><section className="panel admin"><div><label>Tipo de archivo</label><select value={type} onChange={e=>{setType(e.target.value);setMsg('');setFile(null)}}><option value="manual">Clasificación manual</option><option value="picking">Picking</option><option value="gatera">Errores en gatera</option><option value="voice">Errores Voice Picking</option></select></div><div className="twocol"><div><label>Mes</label><input type="number" min="1" max="12" value={month} onChange={e=>setMonth(+e.target.value)}/></div><div><label>Año</label><input type="number" value={year} onChange={e=>setYear(+e.target.value)}/></div></div><label className="upload"><Upload/>Seleccionar Excel<input type="file" accept=".xlsx,.xls" onChange={e=>{setFile(e.target.files[0]);setMsg('')}}/></label>{file&&<p><b>{file.name}</b></p>}<button className="primary" onClick={inspect} disabled={busy}>{busy?'Procesando...':'Revisar archivo'}</button>{msg&&<div className="notice"><AlertTriangle/>{msg}</div>}<p className="note">La última carga válida reemplazará únicamente el mismo módulo, mes y año.</p></section></main></>}
createRoot(document.getElementById('root')).render(<App/>);
