import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export default function AnalisisOperativoV3() {

  const [tab, setTab] = useState('dashboard');
const [productividadGeneral, setProductividadGeneral] = useState('--');
const [cumplimientoGeneral, setCumplimientoGeneral] = useState('--');
const [calidadGeneral, setCalidadGeneral] = useState('--');
const [actividadGeneral, setActividadGeneral] = useState('--');

const [mejorOperador, setMejorOperador] = useState('--');
const [segundoOperador, setSegundoOperador] = useState('--');
const [requiereAtencion, setRequiereAtencion] = useState('--');
const [mejorCancha, setMejorCancha] = useState('--');
  useEffect(() => {

  async function cargarDatos() {

    const { data, error } = await supabase
      .from('picking')
      .select('cancha, productividad, target, datos_originales');

    if (error || !data?.length) return;

    const productividadPromedio =
      data.reduce(
        (a, r) => a + Number(r.productividad || 0),
        0
      ) / data.length;

    const targetPromedio =
      data.reduce(
        (a, r) => a + Number(r.target || 0),
        0
      ) / data.length;

    setProductividadGeneral(
      productividadPromedio.toFixed(1)
    );

    setActividadGeneral(
      data.length.toString()
    );

    if (targetPromedio > 0) {

      const cumplimiento =
        (productividadPromedio /
          targetPromedio) * 100;

      setCumplimientoGeneral(
        cumplimiento.toFixed(1) + '%'
      );
    }

    setCalidadGeneral('100.0%');

    const operadores = {};

    data.forEach(r => {

      const nombre =
        r.datos_originales?.operador || 'SIN NOMBRE';

      if (!operadores[nombre]) {
        operadores[nombre] = {
          nombre,
          total: 0,
          cantidad: 0
        };
      }

      operadores[nombre].total +=
        Number(r.productividad || 0);

      operadores[nombre].cantidad += 1;

    });

    const ranking =
      Object.values(operadores)
        .map(o => ({
          ...o,
          promedio: o.total / o.cantidad
        }))
        .sort((a, b) => b.promedio - a.promedio);

    if (ranking[0])
      setMejorOperador(ranking[0].nombre);

    if (ranking[1])
      setSegundoOperador(ranking[1].nombre);

    if (ranking[ranking.length - 1])
      setRequiereAtencion(
        ranking[ranking.length - 1].nombre
      );

    const canchas = {};

    data.forEach(r => {

      const cancha =
        r.cancha || 'SIN CANCHA';

      if (!canchas[cancha]) {

        canchas[cancha] = {
          cancha,
          total: 0,
          cantidad: 0
        };
      }

      canchas[cancha].total +=
        Number(r.productividad || 0);

      canchas[cancha].cantidad += 1;
    });

    const rankingCanchas =
      Object.values(canchas)
        .map(c => ({
          ...c,
          promedio: c.total / c.cantidad
        }))
        .sort((a, b) => b.promedio - a.promedio);

    if (rankingCanchas[0])
      setMejorCancha(
        rankingCanchas[0].cancha
      );

  }

  cargarDatos();

}, []);
  return (
    <section className="panel people-analysis">

      <div className="analysis-title">
        <div>
          <small>INTELIGENCIA OPERATIVA V3</small>
          <h2>Centro de Inteligencia Operativa</h2>
          <p>
            Score operativo, ranking real y ficha completa del operador.
          </p>
        </div>
      </div>

      <div className="analysis-nav">

        <button
          className={tab === 'dashboard' ? 'sel' : ''}
          onClick={() => setTab('dashboard')}
        >
          Dashboard
        </button>

        <button
          className={tab === 'ranking' ? 'sel' : ''}
          onClick={() => setTab('ranking')}
        >
          Ranking Operativo
        </button>

        <button
          className={tab === 'operador' ? 'sel' : ''}
          onClick={() => setTab('operador')}
        >
          Ficha Operador
        </button>

        <button
          className={tab === 'canchas' ? 'sel' : ''}
          onClick={() => setTab('canchas')}
        >
          Canchas
        </button>

        <button
          className={tab === 'alertas' ? 'sel' : ''}
          onClick={() => setTab('alertas')}
        >
          Alertas
        </button>

      </div>

      {tab === 'dashboard' && (
        <div className="analysis-kpis">

          <div>
            <span>📈 PRODUCTIVIDAD</span>
           <b>{productividadGeneral}</b>
            <small>Promedio general</small>
          </div>

          <div>
            <span>🎯 CUMPLIMIENTO</span>
           <b>{cumplimientoGeneral}</b>   
            <small>Cumplimiento general</small>
          </div>

          <div>
            <span>✅ CALIDAD</span>
         <b>{calidadGeneral}</b>
            <small>Calidad general</small>
          </div>

          <div>
            <span>📦 ACTIVIDAD</span>
            <b>{actividadGeneral}</b>
            <small>Volumen total</small>
          </div>

        </div>
      )}

      {tab === 'ranking' && (
        <section>

          <h2>🏆 Ranking Operativo</h2>

          <div className="notice">
            <b>Regla del Ranking</b>

            <p>
              Mínimo 10 días trabajados
            </p>

            <p>
              Score Operativo
            </p>

            <ul>
              <li>40% Productividad</li>
              <li>40% Calidad</li>
              <li>20% Volumen</li>
            </ul>
          </div>

        </section>
      )}

      {tab === 'operador' && (
        <section>

          <h2>🔍 Ficha Operador</h2>

          <input
            placeholder="Buscar por legajo o nombre..."
          />

        </section>
      )}

      {tab === 'canchas' && (
        <section>
          <h2>🎯 Análisis de Canchas</h2>
        </section>
      )}

      {tab === 'alertas' && (
        <section>
          <h2>🚨 Alertas Operativas</h2>
        </section>
      )}

    </section>
  );
}
