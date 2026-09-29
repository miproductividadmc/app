import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';

const MIN_DIAS = 10;

const numero = valor => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

const texto = valor => String(valor ?? '').trim();

const normalizar = valor =>
  texto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toUpperCase();

const formatoNumero = valor =>
  new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(numero(valor));

const formatoPorcentaje = valor => `${numero(valor).toFixed(1)}%`;

const fechaISO = valor => {
  if (!valor) return '';
  const base = texto(valor).slice(0, 10);
  const fecha = new Date(`${base}T00:00:00`);
  return Number.isNaN(fecha.getTime()) ? base : fecha.toISOString().slice(0, 10);
};

const fechaAR = valor => {
  const [anio, mes, dia] = fechaISO(valor).split('-');
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : texto(valor);
};

const turnoCanonico = valor => {
  const n = normalizar(valor);
  if (n.includes('NOCHE') || n === 'TN' || n === 'N') return 'NOCHE';
  if (n.includes('TARDE') || n === 'TT' || n === 'T') return 'TARDE';
  if (n.includes('MANANA') || n === 'TM' || n === 'M') return 'MANANA';
  return n || 'SIN TURNO';
};

const nombreTurno = valor => {
  const turno = turnoCanonico(valor);
  if (turno === 'NOCHE') return 'Noche';
  if (turno === 'TARDE') return 'Tarde';
  if (turno === 'MANANA') return 'Mañana';
  return turno === 'SIN TURNO' ? 'Sin turno' : texto(valor);
};

const esSinNovedad = fila => {
  const motivo = normalizar(fila.motivo || fila.descripcion || fila.comentario);
  const cantidad = numero(
    fila.total_errores ?? fila.cantidad ?? fila.errores ?? fila.total ?? 0
  );
  return (
    cantidad <= 0 ||
    motivo === 'OK' ||
    motivo.includes('SIN NOVEDAD') ||
    motivo.includes('SIN ERROR') ||
    motivo.includes('NO APLICA')
  );
};

const claveOperador = fila =>
  texto(fila.empleado_id || fila.legajo || fila.datos_originales?.operador || 'SIN OPERADOR');

const nombreOperador = (fila, empleadosPorId) => {
  const empleado = empleadosPorId.get(texto(fila.empleado_id));
  return texto(
    empleado?.apellido_nombre ||
      fila.datos_originales?.operador ||
      fila.operador ||
      'SIN NOMBRE'
  );
};

const diasUnicos = filas =>
  new Set(filas.map(fila => fechaISO(fila.fecha)).filter(Boolean)).size;

const sumaPaletas = filas => filas.reduce((total, fila) => total + numero(fila.pallets), 0);
const sumaPacks = filas => filas.reduce((total, fila) => total + numero(fila.packs), 0);
const sumaSegundos = filas =>
  filas.reduce((total, fila) => total + numero(fila.duracion_segundos), 0);

const productividadPonderada = filas => {
  if (!filas.length) return 0;
  const packs = sumaPacks(filas);
  const segundos = sumaSegundos(filas);
  if (packs > 0 && segundos > 0) return packs / (segundos / 3600);
  return filas.reduce((total, fila) => total + numero(fila.productividad), 0) / filas.length;
};

const targetPonderado = filas => {
  if (!filas.length) return 0;
  const segundos = sumaSegundos(filas);
  if (segundos > 0) {
    return (
      filas.reduce(
        (total, fila) =>
          total + numero(fila.target) * numero(fila.duracion_segundos),
        0
      ) / segundos
    );
  }
  return filas.reduce((total, fila) => total + numero(fila.target), 0) / filas.length;
};

const rangoAnterior = ({ desde, hasta }) => {
  const inicio = new Date(desde);
  const fin = new Date(hasta);
  const duracion = fin.getTime() - inicio.getTime();
  const finAnterior = new Date(inicio.getTime() - 86400000);
  const inicioAnterior = new Date(finAnterior.getTime() - duracion);
  return { desde: inicioAnterior, hasta: finAnterior };
};

const calcularRango = (fechas, periodo, mes, anio, fechaReferencia) => {
  if (!fechas.length) return null;
  const ultima = new Date(
    Math.max(...fechas.map(valor => new Date(`${fechaISO(valor)}T00:00:00`).getTime()))
  );
  const referencia = fechaReferencia
    ? new Date(`${fechaReferencia}T00:00:00`)
    : ultima;
  const year = anio ? Number(anio) : referencia.getFullYear();
  const month = mes ? Number(mes) - 1 : referencia.getMonth();
  let desde;
  let hasta;

  if (periodo === 'dia') {
    desde = new Date(referencia);
    hasta = new Date(referencia);
  } else if (periodo === 'semana') {
    hasta = new Date(referencia);
    desde = new Date(referencia);
    desde.setDate(desde.getDate() - 6);
  } else if (periodo === 'quincena') {
    hasta = new Date(referencia);
    desde = new Date(referencia);
    desde.setDate(desde.getDate() - 14);
  } else if (periodo === 'anio') {
    desde = new Date(year, 0, 1);
    hasta = new Date(year, 11, 31);
  } else {
    desde = new Date(year, month, 1);
    hasta = new Date(year, month + 1, 0);
  }

  desde.setHours(0, 0, 0, 0);
  hasta.setHours(23, 59, 59, 999);
  return { desde, hasta };
};

const dentroDelRango = (fila, rango) => {
  if (!rango) return false;
  const fecha = new Date(`${fechaISO(fila.fecha)}T00:00:00`);
  return !Number.isNaN(fecha.getTime()) && fecha >= rango.desde && fecha <= rango.hasta;
};

const identificarOrigen = fila => (fila.__origen === 'VOICE' ? 'Voice' : 'Gatera');

const identificadorPaletaError = fila =>
  texto(
    fila.numero_paleta ||
      fila.paleta ||
      `${fila.__origen}-${fila.id || ''}-${fila.empleado_id || ''}-${fila.fecha || ''}`
  );

const cantidadError = fila => {
  if (fila.__origen === 'VOICE') return numero(fila.total_errores);
  return 1;
};

const cantidadImpactada = fila => {
  if (fila.__origen === 'VOICE') return numero(fila.total_errores);
  return numero(fila.cantidad) || 1;
};

const resumenErrores = filas => {
  const reales = filas.filter(fila => !esSinNovedad(fila));
  const voice = reales.filter(fila => fila.__origen === 'VOICE');
  const gatera = reales.filter(fila => fila.__origen === 'GATERA');
  const paletasConError = new Set(reales.map(identificadorPaletaError)).size;
  return {
    filas: reales,
    eventos: reales.length,
    paletasConError,
    erroresVoice: voice.reduce((total, fila) => total + cantidadError(fila), 0),
    erroresGatera: gatera.length,
    cantidadImpactada: reales.reduce((total, fila) => total + cantidadImpactada(fila), 0)
  };
};

const resumenActividad = (filasPicking, filasErrores) => {
  const productividad = productividadPonderada(filasPicking);
  const target = targetPonderado(filasPicking);
  const cumplimiento = target > 0 ? (productividad / target) * 100 : 0;
  const paletas = sumaPaletas(filasPicking);
  const packs = sumaPacks(filasPicking);
  const dias = diasUnicos(filasPicking);
  const errores = resumenErrores(filasErrores);
  const verificadasVoice = new Set(
    filasErrores
      .filter(fila => fila.__origen === 'VOICE')
      .map(fila => texto(fila.numero_paleta || `${fila.id}-${fila.fecha}`))
  ).size;
  const tasaControl = paletas > 0 ? (verificadasVoice / paletas) * 100 : 0;
  const tasaError = paletas > 0 ? (errores.paletasConError / paletas) * 100 : 0;
  const calidad = paletas > 0 ? Math.max(0, 100 - tasaError) : null;
  return {
    productividad,
    target,
    cumplimiento,
    paletas,
    packs,
    dias,
    verificadasVoice,
    tasaControl,
    tasaError,
    calidad,
    ...errores
  };
};

const puntosCalidad = tasaError => {
  if (tasaError <= 0) return 40;
  if (tasaError <= 1) return 38;
  if (tasaError <= 2) return 32;
  if (tasaError <= 3) return 22;
  if (tasaError <= 4) return 10;
  return 0;
};

function Tarjeta({ titulo, valor, detalle, detalle2, onClick }) {
  return (
    <div onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <span>{titulo}</span>
      <b>{valor}</b>
      <small>{detalle}</small>
      {detalle2 && <small>{detalle2}</small>}
    </div>
  );
}

function SinDatos({ texto = 'Sin datos para el período seleccionado.' }) {
  return <div className="notice">{texto}</div>;
}

export default function AnalisisOperativoV3() {
  const [tab, setTab] = useState('dashboard');
  const [periodo, setPeriodo] = useState('mes');
  const [mes, setMes] = useState('');
  const [anio, setAnio] = useState('');
  const [turno, setTurno] = useState('');
  const [fechaReferencia, setFechaReferencia] = useState('');
  const [rankingTurno, setRankingTurno] = useState('TARDE');
  const [busqueda, setBusqueda] = useState('');
  const [seleccionado, setSeleccionado] = useState('');
  const [pregunta, setPregunta] = useState('');
  const [respuesta, setRespuesta] = useState(null);
  const [picking, setPicking] = useState([]);
  const [errores, setErrores] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    async function cargarDatos() {
      setCargando(true);
      setMensaje('');
      const [p, g, v, e] = await Promise.all([
        supabase.from('picking').select('*'),
        supabase.from('errores_gatera').select('*'),
        supabase.from('errores_voice').select('*'),
        supabase.from('empleados').select('*')
      ]);
      const error = p.error || g.error || v.error || e.error;
      if (error) setMensaje(error.message || 'No fue posible cargar todos los datos.');
      setPicking(p.data || []);
      setErrores([
        ...(g.data || []).map(fila => ({ ...fila, __origen: 'GATERA' })),
        ...(v.data || []).map(fila => ({ ...fila, __origen: 'VOICE' }))
      ]);
      setEmpleados(e.data || []);
      setCargando(false);
    }
    cargarDatos();
  }, []);

  const empleadosPorId = useMemo(
    () => new Map(empleados.map(empleado => [texto(empleado.id), empleado])),
    [empleados]
  );

  const fechasDisponibles = useMemo(
    () => picking.map(fila => fila.fecha).filter(Boolean),
    [picking]
  );

  const ultimaFecha = useMemo(() => {
    if (!fechasDisponibles.length) return '';
    return fechaISO(
      fechasDisponibles.sort().slice(-1)[0]
    );
  }, [fechasDisponibles]);

  useEffect(() => {
    if (!ultimaFecha) return;
    const fecha = new Date(`${ultimaFecha}T00:00:00`);
    if (!mes) setMes(String(fecha.getMonth() + 1));
    if (!anio) setAnio(String(fecha.getFullYear()));
    if (!fechaReferencia) setFechaReferencia(ultimaFecha);
  }, [ultimaFecha, mes, anio, fechaReferencia]);

  const rango = useMemo(
    () => calcularRango(fechasDisponibles, periodo, mes, anio, fechaReferencia),
    [fechasDisponibles, periodo, mes, anio, fechaReferencia]
  );

  const rangoPrevio = useMemo(() => (rango ? rangoAnterior(rango) : null), [rango]);

  const pickingPeriodo = useMemo(
    () => picking.filter(fila => dentroDelRango(fila, rango)),
    [picking, rango]
  );

  const erroresPeriodo = useMemo(
    () => errores.filter(fila => dentroDelRango(fila, rango)),
    [errores, rango]
  );

  const pickingPrevio = useMemo(
    () => picking.filter(fila => dentroDelRango(fila, rangoPrevio)),
    [picking, rangoPrevio]
  );

  const erroresPrevios = useMemo(
    () => errores.filter(fila => dentroDelRango(fila, rangoPrevio)),
    [errores, rangoPrevio]
  );

  const filtrarTurno = (filas, valorTurno) =>
    !valorTurno
      ? filas
      : filas.filter(fila => turnoCanonico(fila.turno) === valorTurno);

  const pickingFiltrado = useMemo(
    () => filtrarTurno(pickingPeriodo, turno),
    [pickingPeriodo, turno]
  );

  const erroresFiltrados = useMemo(
    () => filtrarTurno(erroresPeriodo, turno),
    [erroresPeriodo, turno]
  );

  const resumenGeneral = useMemo(
    () => resumenActividad(pickingFiltrado, erroresFiltrados),
    [pickingFiltrado, erroresFiltrados]
  );

  const resumenTarde = useMemo(
    () =>
      resumenActividad(
        filtrarTurno(pickingPeriodo, 'TARDE'),
        filtrarTurno(erroresPeriodo, 'TARDE')
      ),
    [pickingPeriodo, erroresPeriodo]
  );

  const resumenNoche = useMemo(
    () =>
      resumenActividad(
        filtrarTurno(pickingPeriodo, 'NOCHE'),
        filtrarTurno(erroresPeriodo, 'NOCHE')
      ),
    [pickingPeriodo, erroresPeriodo]
  );

  const resumenGeneralPrevio = useMemo(
    () => resumenActividad(pickingPrevio, erroresPrevios),
    [pickingPrevio, erroresPrevios]
  );

  const construirOperadores = useMemo(() => {
    const mapa = new Map();
    pickingPeriodo.forEach(fila => {
      const key = claveOperador(fila);
      if (!mapa.has(key)) {
        mapa.set(key, {
          key,
          empleadoId: texto(fila.empleado_id),
          nombre: nombreOperador(fila, empleadosPorId),
          filas: [],
          errores: []
        });
      }
      mapa.get(key).filas.push(fila);
    });
    erroresPeriodo.forEach(fila => {
      const item = mapa.get(texto(fila.empleado_id));
      if (item && !esSinNovedad(fila)) item.errores.push(fila);
    });
    return [...mapa.values()];
  }, [pickingPeriodo, erroresPeriodo, empleadosPorId]);

  const agregarMetricasOperador = (item, turnoFiltro = '') => {
    const filas = filtrarTurno(item.filas, turnoFiltro);
    const erroresItem = filtrarTurno(item.errores, turnoFiltro);
    const resumen = resumenActividad(filas, erroresItem);
    const empleado = empleadosPorId.get(item.empleadoId);
    const canchas = [...new Set(filas.map(fila => texto(fila.cancha)).filter(Boolean))];
    const turnos = [...new Set(filas.map(fila => turnoCanonico(fila.turno)).filter(Boolean))];
    return {
      ...item,
      ...resumen,
      filas,
      errores: erroresItem,
      empleado,
      legajo: texto(empleado?.legajo),
      turnos,
      canchas,
      elegible: resumen.dias >= MIN_DIAS
    };
  };

  const operadoresGeneral = useMemo(
    () => construirOperadores.map(item => agregarMetricasOperador(item)),
    [construirOperadores, empleadosPorId]
  );

  const ranking = useMemo(() => {
    const base = construirOperadores
      .map(item => agregarMetricasOperador(item, rankingTurno))
      .filter(item => item.elegible && item.paletas > 0);

    const maxPaletas = Math.max(1, ...base.map(item => item.paletas));
    return base
      .map(item => {
        const puntosCumplimiento =
          Math.min(Math.max(item.cumplimiento, 0), 120) / 120 * 35;
        const puntosVolumen = item.paletas / maxPaletas * 25;
        const calidadPuntos = puntosCalidad(item.tasaError);
        const score = puntosCumplimiento + puntosVolumen + calidadPuntos;
        const bloqueadoComoMejor = item.paletasConError > 24 || item.tasaError > 4;
        const estado =
          item.tasaError > 4 || item.paletasConError > 24
            ? 'Calidad crítica'
            : item.tasaError > 2
            ? 'Productivo con errores'
            : item.cumplimiento < 100
            ? 'Debajo del target'
            : item.tasaError <= 1
            ? 'Excelente'
            : 'Buen desempeño';
        return { ...item, score, bloqueadoComoMejor, estado };
      })
      .sort((a, b) => b.score - a.score);
  }, [construirOperadores, rankingTurno, empleadosPorId]);

  const mejorElegible = useMemo(
    () => ranking.find(item => !item.bloqueadoComoMejor) || null,
    [ranking]
  );

  const segundoElegible = useMemo(
    () =>
      ranking.filter(item => !item.bloqueadoComoMejor && item.key !== mejorElegible?.key)[0] ||
      null,
    [ranking, mejorElegible]
  );

  const requiereAtencion = useMemo(
    () => [...ranking].sort((a, b) => a.score - b.score)[0] || null,
    [ranking]
  );

  const noElegibles = useMemo(
    () =>
      construirOperadores
        .map(item => agregarMetricasOperador(item, rankingTurno))
        .filter(item => item.dias > 0 && item.dias < MIN_DIAS),
    [construirOperadores, rankingTurno, empleadosPorId]
  );

  const construirCanchas = turnoFiltro => {
    const mapa = new Map();
    filtrarTurno(pickingPeriodo, turnoFiltro).forEach(fila => {
      const cancha = texto(fila.cancha || 'SIN CANCHA');
      if (!mapa.has(cancha)) mapa.set(cancha, []);
      mapa.get(cancha).push(fila);
    });
    return [...mapa.entries()]
      .map(([cancha, filas]) => {
        const erroresCancha = filtrarTurno(erroresPeriodo, turnoFiltro).filter(
          error => texto(error.cancha) === cancha
        );
        const resumen = resumenActividad(filas, erroresCancha);
        return {
          cancha,
          turno: turnoFiltro,
          ...resumen,
          operadores: new Set(filas.map(claveOperador)).size,
          filas,
          errores: erroresCancha
        };
      })
      .sort((a, b) => b.cumplimiento - a.cumplimiento);
  };

  const canchasTarde = useMemo(
    () => construirCanchas('TARDE'),
    [pickingPeriodo, erroresPeriodo]
  );

  const canchasNoche = useMemo(
    () => construirCanchas('NOCHE'),
    [pickingPeriodo, erroresPeriodo]
  );

  const opcionesOperador = useMemo(() => {
    const consulta = normalizar(busqueda);
    if (!consulta) return [];
    return operadoresGeneral
      .filter(
        item =>
          normalizar(item.nombre).includes(consulta) ||
          texto(item.legajo).includes(busqueda.trim())
      )
      .slice(0, 15);
  }, [busqueda, operadoresGeneral]);

  const ficha = useMemo(() => {
    if (seleccionado) return operadoresGeneral.find(item => item.key === seleccionado) || null;
    return opcionesOperador.length === 1 ? opcionesOperador[0] : null;
  }, [seleccionado, operadoresGeneral, opcionesOperador]);

  const datosPreviosFicha = useMemo(() => {
    if (!ficha) return null;
    const filas = pickingPrevio.filter(fila => claveOperador(fila) === ficha.key);
    const errs = erroresPrevios.filter(
      fila => texto(fila.empleado_id) === ficha.empleadoId && !esSinNovedad(fila)
    );
    return resumenActividad(filas, errs);
  }, [ficha, pickingPrevio, erroresPrevios]);

  const detalleCanchasFicha = useMemo(() => {
    if (!ficha) return [];
    const mapa = new Map();
    ficha.filas.forEach(fila => {
      const key = `${turnoCanonico(fila.turno)}|${texto(fila.cancha)}`;
      if (!mapa.has(key)) mapa.set(key, []);
      mapa.get(key).push(fila);
    });
    return [...mapa.entries()]
      .map(([key, filas]) => {
        const [turnoItem, cancha] = key.split('|');
        const erroresItem = ficha.errores.filter(
          error =>
            turnoCanonico(error.turno) === turnoItem && texto(error.cancha) === cancha
        );
        return {
          cancha,
          turno: turnoItem,
          ...resumenActividad(filas, erroresItem),
          filas,
          errores: erroresItem
        };
      })
      .sort((a, b) => b.paletas - a.paletas);
  }, [ficha]);

  const detalleErroresFicha = useMemo(() => {
    if (!ficha) return [];
    const mapa = new Map();
    ficha.errores.forEach(error => {
      const sku = texto(error.sku || error.codigo || error.material || 'SIN SKU');
      const motivo = texto(error.motivo || 'SIN MOTIVO');
      const key = `${sku}|${motivo}`;
      if (!mapa.has(key)) {
        mapa.set(key, {
          sku,
          motivo,
          cantidad: 0,
          voice: 0,
          gatera: 0,
          fechas: new Set(),
          canchas: new Set()
        });
      }
      const item = mapa.get(key);
      item.cantidad += cantidadImpactada(error);
      item[error.__origen === 'VOICE' ? 'voice' : 'gatera'] += cantidadImpactada(error);
      item.fechas.add(fechaISO(error.fecha));
      item.canchas.add(texto(error.cancha));
    });
    return [...mapa.values()]
      .map(item => ({
        ...item,
        fechas: [...item.fechas].sort(),
        canchas: [...item.canchas].filter(Boolean)
      }))
      .sort((a, b) => b.cantidad - a.cantidad);
  }, [ficha]);

  const diasFicha = useMemo(() => {
    if (!ficha) return [];
    const mapa = new Map();
    ficha.filas.forEach(fila => {
      const fecha = fechaISO(fila.fecha);
      if (!mapa.has(fecha)) mapa.set(fecha, []);
      mapa.get(fecha).push(fila);
    });
    return [...mapa.entries()]
      .map(([fecha, filas]) => {
        const erroresDia = ficha.errores.filter(error => fechaISO(error.fecha) === fecha);
        return { fecha, ...resumenActividad(filas, erroresDia) };
      })
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [ficha]);

  const diagnosticoFicha = useMemo(() => {
    if (!ficha) return [];
    const resultados = [];
    if (ficha.cumplimiento >= 100)
      resultados.push(`Cumple el target en ${formatoPorcentaje(ficha.cumplimiento)}.`);
    else resultados.push(`Está ${formatoPorcentaje(100 - ficha.cumplimiento)} debajo del target.`);
    if (ficha.tasaError <= 1) resultados.push('Mantiene una tasa de error excelente.');
    else if (ficha.tasaError > 4) resultados.push('La tasa de error es crítica y requiere intervención.');
    const topError = detalleErroresFicha[0];
    if (topError)
      resultados.push(
        `El patrón principal es SKU ${topError.sku}, motivo ${topError.motivo}, con ${topError.cantidad} repeticiones.`
      );
    const canchaError = [...detalleCanchasFicha].sort(
      (a, b) => b.paletasConError - a.paletasConError
    )[0];
    if (canchaError?.paletasConError)
      resultados.push(
        `La mayor concentración de errores aparece en ${canchaError.cancha}, Turno ${nombreTurno(
          canchaError.turno
        )}.`
      );
    return resultados;
  }, [ficha, detalleErroresFicha, detalleCanchasFicha]);

  const resumenTurno = valorTurno =>
    valorTurno === 'TARDE' ? resumenTarde : resumenNoche;

  const preguntaRapida = consulta => {
    const operadores = operadoresGeneral.filter(item => item.dias > 0);
    const porErrores = [...operadores].sort(
      (a, b) => b.paletasConError - a.paletasConError
    );
    const turnos = [
      { nombre: 'Tarde', clave: 'TARDE', ...resumenTarde },
      { nombre: 'Noche', clave: 'NOCHE', ...resumenNoche }
    ].filter(item => item.paletas > 0);
    const canchas = [...canchasTarde, ...canchasNoche];
    const todosErrores = resumenErrores(erroresPeriodo).filas;
    const agrupar = campo => {
      const mapa = new Map();
      todosErrores.forEach(error => {
        const key = texto(campo(error) || 'SIN DATO');
        mapa.set(key, (mapa.get(key) || 0) + cantidadImpactada(error));
      });
      return [...mapa.entries()].sort((a, b) => b[1] - a[1]);
    };

    if (consulta === 'operadorErrores') {
      const item = porErrores[0];
      return item
        ? {
            titulo: 'Operador con más errores',
            resumen: `${item.nombre} registró ${item.paletasConError} paletas con error sobre ${formatoNumero(
              item.paletas
            )} paletas armadas.`,
            datos: [
              `Tasa de error: ${formatoPorcentaje(item.tasaError)}`,
              `Voice: ${item.erroresVoice}`,
              `Gatera: ${item.erroresGatera}`,
              `Días trabajados: ${item.dias}`
            ]
          }
        : { titulo: 'Información insuficiente', resumen: 'No hay errores reales en el período.', datos: [] };
    }

    if (consulta === 'turnoErrores') {
      const item = [...turnos].sort((a, b) => b.tasaError - a.tasaError)[0];
      return item
        ? {
            titulo: 'Turno con mayor tasa de error',
            resumen: `El Turno ${item.nombre} tuvo ${formatoPorcentaje(
              item.tasaError
            )} de error.`,
            datos: [
              `${formatoNumero(item.paletas)} paletas armadas`,
              `${item.paletasConError} paletas con error`,
              `Calidad de armado: ${formatoPorcentaje(item.calidad)}`
            ]
          }
        : { titulo: 'Información insuficiente', resumen: 'No hay datos por turno.', datos: [] };
    }

    if (consulta === 'canchaRevision') {
      const item = [...canchas].sort((a, b) => {
        const riesgoA = a.tasaError * 2 + Math.max(0, 100 - a.cumplimiento);
        const riesgoB = b.tasaError * 2 + Math.max(0, 100 - b.cumplimiento);
        return riesgoB - riesgoA;
      })[0];
      return item
        ? {
            titulo: 'Cancha que necesita revisión',
            resumen: `${item.cancha}, Turno ${nombreTurno(item.turno)}, combina ${formatoPorcentaje(
              item.cumplimiento
            )} de cumplimiento y ${formatoPorcentaje(item.tasaError)} de error.`,
            datos: [
              `Productividad ${formatoNumero(item.productividad)} / Target ${formatoNumero(
                item.target
              )}`,
              `${formatoNumero(item.paletas)} paletas armadas`,
              `${item.paletasConError} paletas con error`
            ]
          }
        : { titulo: 'Información insuficiente', resumen: 'No hay datos de canchas.', datos: [] };
    }

    if (consulta === 'skuRepetido') {
      const top = agrupar(error => error.sku || error.codigo || error.material)[0];
      return top
        ? {
            titulo: 'SKU más repetido',
            resumen: `El SKU ${top[0]} concentra ${top[1]} repeticiones.`,
            datos: ['Abrí la ficha del operador o el detalle de cancha para ver fechas, motivos y origen.']
          }
        : { titulo: 'Información insuficiente', resumen: 'No hay SKU asociados a errores reales.', datos: [] };
    }

    if (consulta === 'paletasSinErrores') {
      const item = operadores
        .filter(op => op.dias >= MIN_DIAS)
        .sort((a, b) => {
          const valorA = a.paletas * (1 - a.tasaError / 100);
          const valorB = b.paletas * (1 - b.tasaError / 100);
          return valorB - valorA;
        })[0];
      return item
        ? {
            titulo: 'Mayor producción con menor error',
            resumen: `${item.nombre} armó ${formatoNumero(item.paletas)} paletas con una tasa de error de ${formatoPorcentaje(
              item.tasaError
            )}.`,
            datos: [
              `Productividad ${formatoNumero(item.productividad)}`,
              `Target ${formatoNumero(item.target)}`,
              `Cumplimiento ${formatoPorcentaje(item.cumplimiento)}`
            ]
          }
        : { titulo: 'Información insuficiente', resumen: 'No hay operadores elegibles.', datos: [] };
    }

    if (consulta === 'bajoProductividad') {
      const actual = resumenGeneral.productividad;
      const anterior = resumenGeneralPrevio.productividad;
      const cambio = anterior ? ((actual - anterior) / anterior) * 100 : null;
      return cambio === null
        ? { titulo: 'Información insuficiente', resumen: 'No hay período anterior comparable.', datos: [] }
        : {
            titulo: 'Variación de productividad',
            resumen: `La productividad ${cambio >= 0 ? 'mejoró' : 'bajó'} ${formatoPorcentaje(
              Math.abs(cambio)
            )} contra el período anterior.`,
            datos: [
              `Actual: ${formatoNumero(actual)}`,
              `Anterior: ${formatoNumero(anterior)}`
            ]
          };
    }

    if (consulta === 'hoy') {
      const hoy = ultimaFecha;
      const filas = picking.filter(fila => fechaISO(fila.fecha) === hoy);
      const errs = errores.filter(fila => fechaISO(fila.fecha) === hoy);
      const resumen = resumenActividad(filas, errs);
      return filas.length
        ? {
            titulo: `Resumen del ${fechaAR(hoy)}`,
            resumen: `${formatoNumero(resumen.paletas)} paletas armadas con ${resumen.paletasConError} paletas con error.`,
            datos: [
              `Productividad: ${formatoNumero(resumen.productividad)}`,
              `Target: ${formatoNumero(resumen.target)}`,
              `Cumplimiento: ${formatoPorcentaje(resumen.cumplimiento)}`,
              `Calidad: ${formatoPorcentaje(resumen.calidad)}`
            ]
          }
        : { titulo: 'Información insuficiente', resumen: 'No hay datos para la última fecha.', datos: [] };
    }

    if (consulta === 'mesAnterior') {
      const tasaActual = resumenGeneral.tasaError;
      const tasaAnterior = resumenGeneralPrevio.tasaError;
      return resumenGeneralPrevio.paletas
        ? {
            titulo: 'Comparación contra el período anterior',
            resumen: `La productividad pasó de ${formatoNumero(
              resumenGeneralPrevio.productividad
            )} a ${formatoNumero(resumenGeneral.productividad)}.`,
            datos: [
              `Paletas: ${formatoNumero(resumenGeneralPrevio.paletas)} → ${formatoNumero(
                resumenGeneral.paletas
              )}`,
              `Tasa de error: ${formatoPorcentaje(tasaAnterior)} → ${formatoPorcentaje(
                tasaActual
              )}`,
              `Calidad: ${formatoPorcentaje(resumenGeneralPrevio.calidad)} → ${formatoPorcentaje(
                resumenGeneral.calidad
              )}`
            ]
          }
        : { titulo: 'Información insuficiente', resumen: 'No hay período anterior comparable.', datos: [] };
    }

    if (consulta === 'fiveWhy') {
      const topSku = agrupar(error => error.sku || error.codigo || error.material)[0];
      const topCancha = agrupar(error => error.cancha)[0];
      const topOperador = porErrores[0];
      return topSku && topCancha && topOperador
        ? {
            titulo: 'Caso sugerido para 5 Why',
            resumen: `Analizar el SKU ${topSku[0]} por repetición de ${topSku[1]} errores.`,
            datos: [
              `Operador con más errores: ${topOperador.nombre}`,
              `Cancha más repetida: ${topCancha[0]}`,
              '1. ¿Por qué ocurrió el error?',
              '2. ¿Por qué se generó esa condición?',
              '3. ¿Por qué no fue detectada antes?',
              '4. ¿Por qué el control no lo evitó?',
              '5. ¿Cuál es la causa raíz?'
            ]
          }
        : { titulo: 'Información insuficiente', resumen: 'No hay patrón repetitivo suficiente.', datos: [] };
    }

    const casoADF = porErrores.find(
      item => item.paletasConError > 24 || item.tasaError > 4
    );
    return casoADF
      ? {
          titulo: 'Caso sugerido para ADF',
          resumen: `${casoADF.nombre} supera el umbral de control.`,
          datos: [
            `${casoADF.paletasConError} paletas con error`,
            `Tasa de error: ${formatoPorcentaje(casoADF.tasaError)}`,
            `Productividad: ${formatoNumero(casoADF.productividad)}`,
            `Cumplimiento: ${formatoPorcentaje(casoADF.cumplimiento)}`,
            'Se recomienda documentar evento, evidencia, causa, acción y seguimiento.'
          ]
        }
      : {
          titulo: 'Sin casos críticos para ADF',
          resumen: 'Ningún operador supera los umbrales definidos.',
          datos: []
        };
  };

  const preguntas = [
    ['operadorErrores', '¿Quién tuvo más errores?'],
    ['turnoErrores', '¿Qué turno tuvo mayor tasa de error?'],
    ['canchaRevision', '¿Qué cancha necesita revisión?'],
    ['skuRepetido', '¿Qué SKU se repitió más?'],
    ['paletasSinErrores', '¿Quién produjo más paletas con menos errores?'],
    ['bajoProductividad', '¿Dónde bajó la productividad?'],
    ['hoy', '¿Qué ocurrió hoy?'],
    ['mesAnterior', '¿Qué cambió contra el período anterior?'],
    ['fiveWhy', '¿Dónde conviene realizar un 5 Why?'],
    ['adf', '¿Qué caso requiere un ADF?']
  ];

  const hayDatos = pickingFiltrado.length > 0;
  const variacionProductividad = resumenGeneralPrevio.productividad
    ? ((resumenGeneral.productividad - resumenGeneralPrevio.productividad) /
        resumenGeneralPrevio.productividad) *
      100
    : null;

  return (
    <section className="panel people-analysis">
      <div className="analysis-title">
        <div>
          <small>INTELIGENCIA OPERATIVA V3</small>
          <h2>Centro de Inteligencia Operativa</h2>
          <p>
            Productividad, paletas armadas, calidad, turnos, ranking y análisis detallado.
          </p>
        </div>
      </div>

      <div className="analysis-filters">
        <label>
          Período
          <select value={periodo} onChange={event => setPeriodo(event.target.value)}>
            <option value="dia">Día</option>
            <option value="semana">Semana</option>
            <option value="quincena">Quincena</option>
            <option value="mes">Mes</option>
            <option value="anio">Año</option>
          </select>
        </label>
        <label>
          Fecha de referencia
          <input
            type="date"
            value={fechaReferencia}
            onChange={event => setFechaReferencia(event.target.value)}
          />
        </label>
        <label>
          Mes
          <select value={mes} onChange={event => setMes(event.target.value)}>
            <option value="">Último</option>
            {Array.from({ length: 12 }, (_, index) => (
              <option key={index + 1} value={String(index + 1)}>
                {index + 1}
              </option>
            ))}
          </select>
        </label>
        <label>
          Año
          <input value={anio} onChange={event => setAnio(event.target.value)} />
        </label>
        <label>
          Turno
          <select value={turno} onChange={event => setTurno(event.target.value)}>
            <option value="">Todos</option>
            <option value="TARDE">Tarde</option>
            <option value="NOCHE">Noche</option>
          </select>
        </label>
      </div>

      <div className="analysis-nav">
        {[
          ['dashboard', 'Dashboard'],
          ['ranking', 'Ranking Operativo'],
          ['operador', 'Ficha Operador'],
          ['canchas', 'Canchas'],
          ['asistente', 'Asistente Operativo']
        ].map(([id, etiqueta]) => (
          <button
            key={id}
            className={tab === id ? 'sel' : ''}
            onClick={() => setTab(id)}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {cargando && <div className="notice">Cargando datos reales...</div>}
      {mensaje && <div className="notice">{mensaje}</div>}

      {tab === 'dashboard' &&
        (!hayDatos ? (
          <SinDatos
            texto={`Sin datos para el período seleccionado (${periodo}, mes ${mes || 'último'}, año ${
              anio || 'último'
            }).`}
          />
        ) : (
          <>
            <div className="analysis-kpis">
              <Tarjeta
                titulo="📈 PRODUCTIVIDAD PROMEDIO"
                valor={formatoNumero(resumenGeneral.productividad)}
                detalle={`Target ${formatoNumero(resumenGeneral.target)} · Cumplimiento ${formatoPorcentaje(
                  resumenGeneral.cumplimiento
                )}`}
                detalle2={
                  resumenGeneral.cumplimiento >= 100
                    ? `${formatoPorcentaje(
                        resumenGeneral.cumplimiento - 100
                      )} por encima del objetivo`
                    : `${formatoPorcentaje(
                        100 - resumenGeneral.cumplimiento
                      )} debajo del objetivo`
                }
              />
              <Tarjeta
                titulo="🎯 CUMPLIMIENTO DEL TARGET"
                valor={formatoPorcentaje(resumenGeneral.cumplimiento)}
                detalle={`Productividad ${formatoNumero(
                  resumenGeneral.productividad
                )} / Target ${formatoNumero(resumenGeneral.target)}`}
              />
              <Tarjeta
                titulo="✅ CALIDAD DE ARMADO"
                valor={
                  resumenGeneral.calidad === null
                    ? 'Sin datos'
                    : formatoPorcentaje(resumenGeneral.calidad)
                }
                detalle={`${formatoNumero(resumenGeneral.paletas)} paletas armadas · ${
                  resumenGeneral.paletasConError
                } con error`}
                detalle2={`Tasa de error ${formatoPorcentaje(
                  resumenGeneral.tasaError
                )} · Voice ${resumenGeneral.erroresVoice} / Gatera ${
                  resumenGeneral.erroresGatera
                }`}
              />
              <Tarjeta
                titulo="📦 PALETAS ARMADAS"
                valor={formatoNumero(resumenGeneral.paletas)}
                detalle={`${resumenGeneral.dias} días con actividad`}
                detalle2={`${formatoNumero(resumenGeneral.packs)} packs procesados`}
              />
            </div>

            <div className="analysis-kpis">
              {[
                ['TARDE', resumenTarde],
                ['NOCHE', resumenNoche]
              ].map(([clave, resumen]) => (
                <Tarjeta
                  key={clave}
                  titulo={`TURNO ${nombreTurno(clave).toUpperCase()}`}
                  valor={resumen.paletas ? formatoNumero(resumen.productividad) : 'Sin datos'}
                  detalle={
                    resumen.paletas
                      ? `Target ${formatoNumero(resumen.target)} · Cumplimiento ${formatoPorcentaje(
                          resumen.cumplimiento
                        )}`
                      : 'Sin actividad en el período'
                  }
                  detalle2={
                    resumen.paletas
                      ? `${formatoNumero(resumen.paletas)} paletas · ${
                          resumen.paletasConError
                        } con error · Calidad ${formatoPorcentaje(resumen.calidad)}`
                      : ''
                  }
                />
              ))}
              <Tarjeta
                titulo="📊 VARIACIÓN VS. PERÍODO ANTERIOR"
                valor={
                  variacionProductividad === null
                    ? 'Sin comparación'
                    : `${variacionProductividad >= 0 ? '+' : ''}${formatoPorcentaje(
                        variacionProductividad
                      )}`
                }
                detalle={`Anterior ${formatoNumero(
                  resumenGeneralPrevio.productividad
                )} · Actual ${formatoNumero(resumenGeneral.productividad)}`}
              />
              <Tarjeta
                titulo="🔎 CONTROL VOICE"
                valor={formatoPorcentaje(resumenGeneral.tasaControl)}
                detalle={`${resumenGeneral.verificadasVoice} paletas verificadas de ${formatoNumero(
                  resumenGeneral.paletas
                )} armadas`}
              />
            </div>
          </>
        ))}

      {tab === 'ranking' && (
        <section>
          <h2>🏆 Ranking Operativo</h2>
          <div className="notice">
            Mínimo {MIN_DIAS} días. Score = 35% cumplimiento contra target + 40% calidad +
            25% paletas armadas. Más de 24 paletas con error o tasa superior al 4% impide
            ser Mejor Operador.
          </div>
          <div className="analysis-nav">
            {['TARDE', 'NOCHE'].map(valor => (
              <button
                key={valor}
                className={rankingTurno === valor ? 'sel' : ''}
                onClick={() => setRankingTurno(valor)}
              >
                Turno {nombreTurno(valor)}
              </button>
            ))}
          </div>

          {!ranking.length ? (
            <SinDatos
              texto={`No hay operadores con ${MIN_DIAS} días o más en el Turno ${nombreTurno(
                rankingTurno
              )}.`}
            />
          ) : (
            <>
              <div className="analysis-kpis">
                <Tarjeta
                  titulo="🏆 MEJOR OPERADOR"
                  valor={mejorElegible?.nombre || 'Sin elegible'}
                  detalle={
                    mejorElegible
                      ? `Score ${mejorElegible.score.toFixed(1)} · ${mejorElegible.dias} días · ${formatoNumero(
                          mejorElegible.paletas
                        )} paletas`
                      : 'Todos los operadores presentan alertas críticas'
                  }
                  detalle2={
                    mejorElegible
                      ? `${mejorElegible.paletasConError} con error · Tasa ${formatoPorcentaje(
                          mejorElegible.tasaError
                        )}`
                      : ''
                  }
                />
                <Tarjeta
                  titulo="🥈 SEGUNDO OPERADOR"
                  valor={segundoElegible?.nombre || 'Sin elegible'}
                  detalle={
                    segundoElegible
                      ? `Score ${segundoElegible.score.toFixed(1)} · ${segundoElegible.dias} días · ${formatoNumero(
                          segundoElegible.paletas
                        )} paletas`
                      : 'Sin segundo operador elegible'
                  }
                  detalle2={
                    segundoElegible
                      ? `${segundoElegible.paletasConError} con error · Calidad ${formatoPorcentaje(
                          segundoElegible.calidad
                        )}`
                      : ''
                  }
                />
                <Tarjeta
                  titulo="🚨 REQUIERE ATENCIÓN"
                  valor={requiereAtencion?.nombre || 'Sin datos'}
                  detalle={
                    requiereAtencion
                      ? `${requiereAtencion.estado} · Score ${requiereAtencion.score.toFixed(1)}`
                      : 'Sin operadores elegibles'
                  }
                  detalle2={
                    requiereAtencion
                      ? `${requiereAtencion.paletasConError} errores · Cumplimiento ${formatoPorcentaje(
                          requiereAtencion.cumplimiento
                        )}`
                      : ''
                  }
                />
              </div>

              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Operador</th>
                      <th>Turno</th>
                      <th>Días</th>
                      <th>Paletas</th>
                      <th>Productividad</th>
                      <th>Target</th>
                      <th>Cumplimiento</th>
                      <th>Voice</th>
                      <th>Gatera</th>
                      <th>Con error</th>
                      <th>Tasa error</th>
                      <th>Calidad</th>
                      <th>Score</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((item, indice) => (
                      <tr key={item.key}>
                        <td>{indice + 1}</td>
                        <td>
                          <button
                            onClick={() => {
                              setSeleccionado(item.key);
                              setBusqueda(item.nombre);
                              setTab('operador');
                            }}
                          >
                            {item.nombre}
                          </button>
                        </td>
                        <td>{nombreTurno(rankingTurno)}</td>
                        <td>{item.dias}</td>
                        <td>{formatoNumero(item.paletas)}</td>
                        <td>{formatoNumero(item.productividad)}</td>
                        <td>{formatoNumero(item.target)}</td>
                        <td>{formatoPorcentaje(item.cumplimiento)}</td>
                        <td>{item.erroresVoice}</td>
                        <td>{item.erroresGatera}</td>
                        <td>{item.paletasConError}</td>
                        <td>{formatoPorcentaje(item.tasaError)}</td>
                        <td>{formatoPorcentaje(item.calidad)}</td>
                        <td>{item.score.toFixed(1)}</td>
                        <td>{item.estado}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!!noElegibles.length && (
            <div className="notice">
              <b>No elegibles por tener menos de {MIN_DIAS} días:</b>{' '}
              {noElegibles.map(item => `${item.nombre} (${item.dias} días)`).join(' · ')}
            </div>
          )}
        </section>
      )}

      {tab === 'operador' && (
        <section>
          <h2>🔍 Ficha completa del operador</h2>
          <input
            value={busqueda}
            onChange={event => {
              setBusqueda(event.target.value);
              setSeleccionado('');
            }}
            placeholder="Buscar por legajo, nombre o apellido..."
          />
          {!!opcionesOperador.length && !seleccionado && (
            <div className="notice">
              {opcionesOperador.map(item => (
                <button
                  key={item.key}
                  onClick={() => {
                    setSeleccionado(item.key);
                    setBusqueda(item.nombre);
                  }}
                >
                  {item.nombre} · {item.legajo || 'Sin legajo'}
                </button>
              ))}
            </div>
          )}

          {!ficha ? (
            <SinDatos texto="Escribí un nombre o legajo y seleccioná un operador." />
          ) : (
            <>
              <div className="analysis-kpis">
                <Tarjeta
                  titulo="👤 OPERADOR"
                  valor={ficha.nombre}
                  detalle={`Legajo ${ficha.legajo || '--'} · ${ficha.turnos
                    .map(nombreTurno)
                    .join(' / ')}`}
                  detalle2={
                    ficha.elegible
                      ? `Elegible: ${ficha.dias} días`
                      : `No elegible: ${ficha.dias} de ${MIN_DIAS} días requeridos`
                  }
                />
                <Tarjeta
                  titulo="📈 PRODUCTIVIDAD"
                  valor={formatoNumero(ficha.productividad)}
                  detalle={`Target ${formatoNumero(ficha.target)} · Cumplimiento ${formatoPorcentaje(
                    ficha.cumplimiento
                  )}`}
                  detalle2={
                    ficha.cumplimiento >= 100
                      ? `${formatoPorcentaje(
                          ficha.cumplimiento - 100
                        )} sobre el objetivo`
                      : `${formatoPorcentaje(
                          100 - ficha.cumplimiento
                        )} debajo del objetivo`
                  }
                />
                <Tarjeta
                  titulo="📦 PALETAS ARMADAS"
                  valor={formatoNumero(ficha.paletas)}
                  detalle={`${ficha.dias} días · Promedio ${formatoNumero(
                    ficha.paletas / Math.max(1, ficha.dias)
                  )} por día`}
                  detalle2={`${formatoNumero(ficha.packs)} packs procesados`}
                />
                <Tarjeta
                  titulo="✅ CALIDAD DE ARMADO"
                  valor={formatoPorcentaje(ficha.calidad)}
                  detalle={`${ficha.paletasConError} paletas con error · Tasa ${formatoPorcentaje(
                    ficha.tasaError
                  )}`}
                  detalle2={`Voice ${ficha.erroresVoice} · Gatera ${ficha.erroresGatera}`}
                />
              </div>

              <div className="analysis-kpis">
                <Tarjeta
                  titulo="📅 MEJOR DÍA"
                  valor={
                    diasFicha.length
                      ? fechaAR([...diasFicha].sort((a, b) => b.productividad - a.productividad)[0].fecha)
                      : '--'
                  }
                  detalle={
                    diasFicha.length
                      ? `Productividad ${formatoNumero(
                          [...diasFicha].sort((a, b) => b.productividad - a.productividad)[0]
                            .productividad
                        )}`
                      : 'Sin datos'
                  }
                />
                <Tarjeta
                  titulo="📉 PEOR DÍA"
                  valor={
                    diasFicha.length
                      ? fechaAR([...diasFicha].sort((a, b) => a.productividad - b.productividad)[0].fecha)
                      : '--'
                  }
                  detalle={
                    diasFicha.length
                      ? `Productividad ${formatoNumero(
                          [...diasFicha].sort((a, b) => a.productividad - b.productividad)[0]
                            .productividad
                        )}`
                      : 'Sin datos'
                  }
                />
                <Tarjeta
                  titulo="🔄 VS. PERÍODO ANTERIOR"
                  valor={
                    datosPreviosFicha?.productividad
                      ? formatoPorcentaje(
                          ((ficha.productividad - datosPreviosFicha.productividad) /
                            datosPreviosFicha.productividad) *
                            100
                        )
                      : 'Sin comparación'
                  }
                  detalle={
                    datosPreviosFicha?.productividad
                      ? `${formatoNumero(datosPreviosFicha.productividad)} → ${formatoNumero(
                          ficha.productividad
                        )}`
                      : 'No hay registros anteriores'
                  }
                />
                <Tarjeta
                  titulo="🔎 CONTROL VOICE"
                  valor={formatoPorcentaje(ficha.tasaControl)}
                  detalle={`${ficha.verificadasVoice} verificadas de ${formatoNumero(
                    ficha.paletas
                  )} armadas`}
                />
              </div>

              <div className="executive-grid">
                <section>
                  <h3>🎯 Desempeño por cancha y turno</h3>
                  <div className="scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Cancha</th>
                          <th>Turno</th>
                          <th>Días</th>
                          <th>Paletas</th>
                          <th>Productividad</th>
                          <th>Target</th>
                          <th>Cumplimiento</th>
                          <th>Errores</th>
                          <th>Calidad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detalleCanchasFicha.map(item => (
                          <tr key={`${item.turno}-${item.cancha}`}>
                            <td>{item.cancha}</td>
                            <td>{nombreTurno(item.turno)}</td>
                            <td>{item.dias}</td>
                            <td>{formatoNumero(item.paletas)}</td>
                            <td>{formatoNumero(item.productividad)}</td>
                            <td>{formatoNumero(item.target)}</td>
                            <td>{formatoPorcentaje(item.cumplimiento)}</td>
                            <td>{item.paletasConError}</td>
                            <td>{formatoPorcentaje(item.calidad)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section>
                  <h3>⚠ Errores, SKU y motivos</h3>
                  {!detalleErroresFicha.length ? (
                    <p>Sin errores reales en el período.</p>
                  ) : (
                    detalleErroresFicha.slice(0, 15).map(item => (
                      <div className="trend-row" key={`${item.sku}-${item.motivo}`}>
                        <span>
                          SKU {item.sku} · {item.motivo}
                          <small>
                            {item.fechas.map(fechaAR).join(', ')} · Canchas{' '}
                            {item.canchas.join(', ')}
                          </small>
                        </span>
                        <b>
                          {item.cantidad} · V {item.voice} / G {item.gatera}
                        </b>
                      </div>
                    ))
                  )}
                </section>
              </div>

              <section className="panel">
                <h3>🧠 Diagnóstico operativo</h3>
                {diagnosticoFicha.map((item, indice) => (
                  <p key={indice}>• {item}</p>
                ))}
              </section>
            </>
          )}
        </section>
      )}

      {tab === 'canchas' && (
        <section>
          <h2>🎯 Análisis de canchas por turno</h2>
          {[
            ['TARDE', canchasTarde],
            ['NOCHE', canchasNoche]
          ].map(([clave, lista]) => (
            <section className="panel" key={clave}>
              <h3>Turno {nombreTurno(clave)}</h3>
              {!lista.length ? (
                <SinDatos texto={`Sin datos para el Turno ${nombreTurno(clave)}.`} />
              ) : (
                <div className="scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Cancha</th>
                        <th>Días</th>
                        <th>Operadores</th>
                        <th>Paletas</th>
                        <th>Productividad</th>
                        <th>Target</th>
                        <th>Cumplimiento</th>
                        <th>Voice</th>
                        <th>Gatera</th>
                        <th>Con error</th>
                        <th>Tasa error</th>
                        <th>Calidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map((item, indice) => (
                        <tr key={`${clave}-${item.cancha}`}>
                          <td>{indice + 1}</td>
                          <td>{item.cancha}</td>
                          <td>{item.dias}</td>
                          <td>{item.operadores}</td>
                          <td>{formatoNumero(item.paletas)}</td>
                          <td>{formatoNumero(item.productividad)}</td>
                          <td>{formatoNumero(item.target)}</td>
                          <td>{formatoPorcentaje(item.cumplimiento)}</td>
                          <td>{item.erroresVoice}</td>
                          <td>{item.erroresGatera}</td>
                          <td>{item.paletasConError}</td>
                          <td>{formatoPorcentaje(item.tasaError)}</td>
                          <td>{formatoPorcentaje(item.calidad)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </section>
      )}

      {tab === 'asistente' && (
        <section>
          <h2>🤖 Asistente Operativo</h2>
          <p>
            Las respuestas se calculan con datos reales del período seleccionado. Si la
            información no alcanza, el asistente lo indica expresamente.
          </p>
          <div className="analysis-nav">
            {preguntas.map(([id, etiqueta]) => (
              <button
                key={id}
                onClick={() => {
                  setPregunta(id);
                  setRespuesta(preguntaRapida(id));
                }}
              >
                {etiqueta}
              </button>
            ))}
          </div>

          {respuesta ? (
            <section className="panel">
              <h3>{respuesta.titulo}</h3>
              <p>{respuesta.resumen}</p>
              {respuesta.datos.map((dato, indice) => (
                <p key={indice}>• {dato}</p>
              ))}
              {pregunta === 'fiveWhy' && (
                <div className="notice">
                  Contexto generado automáticamente. Las respuestas del 5 Why deben ser
                  completadas y validadas por el equipo operativo.
                </div>
              )}
              {pregunta === 'adf' && (
                <div className="notice">
                  La recomendación de ADF se basa en los umbrales definidos; requiere
                  validación del supervisor.
                </div>
              )}
            </section>
          ) : (
            <SinDatos texto="Elegí una pregunta para generar el análisis." />
          )}
        </section>
      )}
    </section>
  );
}
