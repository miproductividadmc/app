import { useState } from 'react';

export default function AnalisisOperativoV3() {

  const [tab, setTab] = useState('dashboard');

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
            <b>--</b>
            <small>Promedio general</small>
          </div>

          <div>
            <span>🎯 CUMPLIMIENTO</span>
            <b>--</b>
            <small>Cumplimiento general</small>
          </div>

          <div>
            <span>✅ CALIDAD</span>
            <b>--</b>
            <small>Calidad general</small>
          </div>

          <div>
            <span>📦 ACTIVIDAD</span>
            <b>--</b>
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
