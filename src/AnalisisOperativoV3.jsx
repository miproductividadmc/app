import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';

const n = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const text = value => String(value ?? '').trim();
const norm = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const pct = value => `${n(value).toFixed(1)}%`;
const num = value => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(n(value));
const iso = value => {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? text(value).slice(0, 10) : d.toISOString().slice(0, 10);
};
const uniqueDays = rows => new Set(rows.map(r => iso(r.fecha)).filter(Boolean)).size;
const operatorName = row => text(row.empleado?.apellido_nombre || row.datos_originales?.operador || row.operador || row.nombre || 'SIN NOMBRE');
const operatorKey = row => text(row.empleado_id || row.legajo || operatorName(row));
const activity = row => n(row.pallets) || n(row.packs) || n(row.cantidad) || 0;
const errorQuantity = row => Math.max(1, n(row.cantidad) || n(row.total_errores) || n(row.errores) || 1);

function Stat({ title, value, detail }) {
  return <div><span>{title}</span><b>{value}</b><small>{detail}</small></div>;
}

export default function AnalisisOperativoV3() {
  const [tab, setTab] = useState('dashboard');
  const [periodo, setPeriodo] = useState('mes');
  const [mes, setMes] = useState('');
  const [anio, setAnio] = useState('');
  const [turno, setTurno] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [seleccionado, setSeleccionado] = useState('');
  const [picking, setPicking] = useState([]);
  const [errores, setErrores] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    async function cargar() {
      setCargando(true);
      setMensaje('');
      const [p, g, v, e] = await Promise.all([
        supabase.from('picking').select('*'),
        supabase.from('errores_gatera').select('*'),
        supabase.from('errores_voice').select('*'),
        supabase.from('empleados').select('*')
      ]);
      const error = p.error || g.error || v.error || e.error;
      if (error) setMensaje(error.message || 'No se pudieron cargar todos los datos.');
      setPicking(p.data || []);
      setErrores([...(g.data || []), ...(v.data || [])]);
      setEmpleados(e.data || []);
      setCargando(false);
    }
    cargar();
  }, []);

  const empleadoPorId = useMemo(() => new Map(empleados.map(e => [text(e.id), e])), [empleados]);

  const pickingFiltrado = useMemo(() => {
    if (!picking.length) return [];
    const fechas = picking.map(r => new Date(r.fecha)).filter(d => !Number.isNaN(d.getTime()));
    const ultima = fechas.length ? new Date(Math.max(...fechas)) : new Date();
    const year = anio ? Number(anio) : ultima.getFullYear();
    const month = mes ? Number(mes) - 1 : ultima.getMonth();
    const hasta = ultima;
    let desde = new Date(hasta);
    if (periodo === 'dia') desde.setHours(0, 0, 0, 0);
    if (periodo === 'semana') desde.setDate(hasta.getDate() - 6);
    if (periodo === 'quincena') desde.setDate(hasta.getDate() - 14);
    if (periodo === 'mes') desde = new Date(year, month, 1);
    if (periodo === 'anio') desde = new Date(year, 0, 1);
    const limite = periodo === 'mes' ? new Date(year, month + 1, 0, 23, 59, 59) : periodo === 'anio' ? new Date(year, 11, 31, 23, 59, 59) : hasta;
    return picking.filter(r => {
      const d = new Date(r.fecha);
      if (Number.isNaN(d.getTime()) || d < desde || d > limite) return false;
      return !turno || norm(r.turno) === norm(turno);
    });
  }, [picking, periodo, mes, anio, turno]);

  const erroresFiltrados = useMemo(() => {
    const fechasValidas = new Set(pickingFiltrado.map(r => iso(r.fecha)));
    return errores.filter(r => fechasValidas.has(iso(r.fecha)) && (!turno || !r.turno || norm(r.turno) === norm(turno)));
  }, [errores, pickingFiltrado, turno]);

  const ranking = useMemo(() => {
    const map = new Map();
    for (const row of pickingFiltrado) {
      const key = operatorKey(row);
      if (!map.has(key)) map.set(key, { key, nombre: operatorName({ ...row, empleado: empleadoPorId.get(text(row.empleado_id)) }), empleadoId: text(row.empleado_id), rows: [], errores: 0 });
      map.get(key).rows.push(row);
    }
    for (const err of erroresFiltrados) {
      const key = text(err.empleado_id);
      const item = map.get(key);
      if (item) item.errores += errorQuantity(err);
    }
    const base = [...map.values()].map(item => {
      const dias = uniqueDays(item.rows);
      const productividad = item.rows.reduce((s, r) => s + n(r.productividad), 0) / Math.max(1, item.rows.length);
      const target = item.rows.reduce((s, r) => s + n(r.target), 0) / Math.max(1, item.rows.length);
      const volumen = item.rows.reduce((s, r) => s + activity(r), 0);
      const calidad = volumen > 0 ? Math.max(0, ((volumen - item.errores) / volumen) * 100) : (item.errores ? 0 : 100);
      return { ...item, dias, productividad, target, volumen, calidad, cumplimiento: target > 0 ? productividad / target * 100 : 0 };
    });
    const elegibles = base.filter(x => x.dias >= 10);
    const fuente = elegibles.length ? elegibles : base;
    const maxProd = Math.max(1, ...fuente.map(x => x.productividad));
    const maxVol = Math.max(1, ...fuente.map(x => x.volumen));
    return fuente.map(x => ({ ...x, score: (x.productividad / maxProd) * 40 + (x.calidad / 100) * 40 + (x.volumen / maxVol) * 20 }))
      .sort((a, b) => b.score - a.score);
  }, [pickingFiltrado, erroresFiltrados, empleadoPorId]);

  const canchas = useMemo(() => {
    const map = new Map();
    pickingFiltrado.forEach(r => {
      const cancha = text(r.cancha || 'SIN CANCHA');
      if (!map.has(cancha)) map.set(cancha, { cancha, rows: [] });
      map.get(cancha).rows.push(r);
    });
    return [...map.values()].map(c => ({
      cancha: c.cancha,
      productividad: c.rows.reduce((s, r) => s + n(r.productividad), 0) / Math.max(1, c.rows.length),
      volumen: c.rows.reduce((s, r) => s + activity(r), 0),
      dias: uniqueDays(c.rows),
      operadores: new Set(c.rows.map(operatorKey)).size
    })).sort((a, b) => b.productividad - a.productividad);
  }, [pickingFiltrado]);

  const resumen = useMemo(() => {
    const productividad = pickingFiltrado.reduce((s, r) => s + n(r.productividad), 0) / Math.max(1, pickingFiltrado.length);
    const target = pickingFiltrado.reduce((s, r) => s + n(r.target), 0) / Math.max(1, pickingFiltrado.length);
    const volumen = pickingFiltrado.reduce((s, r) => s + activity(r), 0);
    const totalErrores = erroresFiltrados.reduce((s, r) => s + errorQuantity(r), 0);
    const calidad = volumen > 0 ? Math.max(0, (volumen - totalErrores) / volumen * 100) : (totalErrores ? 0 : 100);
    return { productividad, cumplimiento: target > 0 ? productividad / target * 100 : 0, volumen, errores: totalErrores, calidad };
  }, [pickingFiltrado, erroresFiltrados]);

  const opciones = useMemo(() => {
    const q = norm(busqueda);
    if (!q) return [];
    return ranking.filter(x => norm(x.nombre).includes(q) || text(empleadoPorId.get(x.empleadoId)?.legajo).includes(busqueda.trim())).slice(0, 12);
  }, [busqueda, ranking, empleadoPorId]);
  const ficha = ranking.find(x => x.key === seleccionado) || opciones[0] || null;

  const detalleCancha = useMemo(() => {
    if (!ficha) return [];
    const map = new Map();
    ficha.rows.forEach(r => {
      const c = text(r.cancha || 'SIN CANCHA');
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(r);
    });
    return [...map.entries()]
      .map(([cancha, rows]) => ({
        cancha,
        productividad:
          rows.reduce((s, r) => s + n(r.productividad), 0) / rows.length,
        volumen: rows.reduce((s, r) => s + activity(r), 0)
      }))
      .sort((a, b) => b.productividad - a.productividad);
  }, [ficha]);

  const erroresFicha = useMemo(() => {
    if (!ficha) return [];
    const map = new Map();
    erroresFiltrados.filter(e => text(e.empleado_id) === ficha.empleadoId).forEach(e => {
      const clave = text(e.sku || e.codigo || e.material || e.motivo || 'SIN DETALLE');
      map.set(clave, (map.get(clave) || 0) + errorQuantity(e));
    });
    return [...map.entries()].map(([detalle, cantidad]) => ({ detalle, cantidad })).sort((a, b) => b.cantidad - a.cantidad);
  }, [ficha, erroresFiltrados]);

  const top = ranking[0];
  const segundo = ranking[1];
  const atencion = ranking[ranking.length - 1];

  return (
    <section className="panel people-analysis">
      <div className="analysis-title"><div><small>INTELIGENCIA OPERATIVA V3</small><h2>Centro de Inteligencia Operativa</h2><p>Ranking por desempeño, mínimo 10 días, buscador y ficha del operador.</p></div></div>

      <div className="analysis-filters">
        <label>Período<select value={periodo} onChange={e => setPeriodo(e.target.value)}><option value="dia">Día</option><option value="semana">Semana</option><option value="quincena">Quincena</option><option value="mes">Mes</option><option value="anio">Año</option></select></label>
        <label>Mes<input type="number" min="1" max="12" value={mes} onChange={e => setMes(e.target.value)} placeholder="Último" /></label>
        <label>Año<input type="number" value={anio} onChange={e => setAnio(e.target.value)} placeholder="Último" /></label>
        <label>Turno<select value={turno} onChange={e => setTurno(e.target.value)}><option value="">Todos</option><option value="MAÑANA">Mañana</option><option value="TARDE">Tarde</option><option value="NOCHE">Noche</option></select></label>
      </div>

      <div className="analysis-nav">
        {['dashboard','ranking','operador','canchas','alertas'].map(x => <button key={x} className={tab === x ? 'sel' : ''} onClick={() => setTab(x)}>{x === 'dashboard' ? 'Dashboard' : x === 'ranking' ? 'Ranking Operativo' : x === 'operador' ? 'Ficha Operador' : x === 'canchas' ? 'Canchas' : 'Alertas'}</button>)}
      </div>

      {cargando && <div className="notice">Cargando información...</div>}
      {mensaje && <div className="notice">{mensaje}</div>}

      {tab === 'dashboard' && <>
        <div className="analysis-kpis">
          <Stat title="📈 PRODUCTIVIDAD" value={num(resumen.productividad)} detail="Promedio de los registros filtrados" />
          <Stat title="🎯 CUMPLIMIENTO" value={pct(resumen.cumplimiento)} detail="Productividad promedio / target promedio" />
          <Stat title="✅ CALIDAD" value={pct(resumen.calidad)} detail={`${num(resumen.volumen)} de volumen y ${num(resumen.errores)} errores`} />
          <Stat title="📦 ACTIVIDAD" value={num(resumen.volumen)} detail="Pallets; si falta, packs o cantidad" />
        </div>
        <div className="analysis-kpis">
          <Stat title="🏆 MEJOR OPERADOR" value={top?.nombre || '--'} detail={top ? `Score ${top.score.toFixed(1)} · ${top.dias} días · ${num(top.volumen)} volumen · ${top.errores} errores` : 'Requiere datos'} />
          <Stat title="🥈 SEGUNDO OPERADOR" value={segundo?.nombre || '--'} detail={segundo ? `Score ${segundo.score.toFixed(1)} · ${segundo.dias} días` : 'Requiere datos'} />
          <Stat title="🚨 REQUIERE ATENCIÓN" value={atencion?.nombre || '--'} detail={atencion ? `Score ${atencion.score.toFixed(1)} · calidad ${pct(atencion.calidad)}` : 'Requiere datos'} />
          <Stat title="🎯 MEJOR CANCHA" value={canchas[0]?.cancha || '--'} detail={canchas[0] ? `Productividad ${num(canchas[0].productividad)} · ${num(canchas[0].volumen)} volumen` : 'Requiere datos'} />
        </div>
      </>}

      {tab === 'ranking' && <section><h2>🏆 Ranking Operativo</h2><div className="notice"><b>Criterio:</b> mínimo 10 días. Score = 40% productividad normalizada + 40% calidad + 20% volumen normalizado.</div><div className="scroll"><table><thead><tr><th>#</th><th>Operador</th><th>Score</th><th>Días</th><th>Productividad</th><th>Volumen</th><th>Errores</th><th>Calidad</th></tr></thead><tbody>{ranking.map((r, i) => <tr key={r.key}><td>{i + 1}</td><td>{r.nombre}</td><td><b>{r.score.toFixed(1)}</b></td><td>{r.dias}</td><td>{num(r.productividad)}</td><td>{num(r.volumen)}</td><td>{r.errores}</td><td>{pct(r.calidad)}</td></tr>)}</tbody></table></div></section>}

      {tab === 'operador' && <section><h2>🔍 Ficha Operador</h2><input value={busqueda} onChange={e => { setBusqueda(e.target.value); setSeleccionado(''); }} placeholder="Buscar por legajo o nombre..." />{opciones.length > 1 && <div>{opciones.map(o => <button key={o.key} onClick={() => { setSeleccionado(o.key); setBusqueda(o.nombre); }}>{o.nombre}</button>)}</div>}{ficha && <><div className="analysis-kpis"><Stat title="👤 OPERADOR" value={ficha.nombre} detail={`Legajo ${empleadoPorId.get(ficha.empleadoId)?.legajo || '--'}`} /><Stat title="📅 DÍAS" value={ficha.dias} detail="Días con registros" /><Stat title="📈 PRODUCTIVIDAD" value={num(ficha.productividad)} detail={`Cumplimiento ${pct(ficha.cumplimiento)}`} /><Stat title="✅ CALIDAD" value={pct(ficha.calidad)} detail={`${ficha.errores} errores / ${num(ficha.volumen)} volumen`} /></div><div className="executive-grid"><section><h3>🎯 Canchas</h3>{detalleCancha.map((c, i) => <div className="trend-row" key={c.cancha}><span>{c.cancha}{i === 0 ? ' · Mejor' : i === detalleCancha.length - 1 ? ' · A revisar' : ''}</span><b>{num(c.productividad)} · {num(c.volumen)}</b></div>)}</section><section><h3>⚠ Errores / SKU</h3>{erroresFicha.length ? erroresFicha.slice(0, 10).map(e => <div className="trend-row" key={e.detalle}><span>{e.detalle}</span><b>{e.cantidad}</b></div>) : <p>Sin errores registrados.</p>}</section></div></>}</section>}

      {tab === 'canchas' && <section><h2>🎯 Análisis de Canchas</h2><div className="scroll"><table><thead><tr><th>#</th><th>Cancha</th><th>Productividad</th><th>Volumen</th><th>Días</th><th>Operadores</th></tr></thead><tbody>{canchas.map((c, i) => <tr key={c.cancha}><td>{i + 1}</td><td>{c.cancha}</td><td>{num(c.productividad)}</td><td>{num(c.volumen)}</td><td>{c.dias}</td><td>{c.operadores}</td></tr>)}</tbody></table></div></section>}

      {tab === 'alertas' && <section><h2>🚨 Alertas Operativas</h2><div className="executive-grid"><section><h3>Ranking insuficiente</h3><p>Los operadores con menos de 10 días no participan del ranking principal.</p><b>{Math.max(0, new Set(pickingFiltrado.map(operatorKey)).size - ranking.length)} operadores excluidos</b></section><section><h3>Calidad</h3><p>Operadores elegibles con calidad menor al 99%.</p><b>{ranking.filter(r => r.calidad < 99).length} casos</b></section><section><h3>Cumplimiento</h3><p>Operadores elegibles debajo del target.</p><b>{ranking.filter(r => r.cumplimiento < 100).length} casos</b></section></div></section>}
    </section>
  );
}
