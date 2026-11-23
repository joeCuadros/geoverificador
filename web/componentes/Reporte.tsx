import type { Etiquetado, Ficha } from '../lib/tipos.ts';
import type { Contexto } from '../lib/contexto.ts';
import { fechaCorta, metros, tonoDe } from '../lib/formato.ts';

const FILAS: [string, string][] = [
  ['salud', 'Salud'],
  ['educacion.inicial', 'Colegio inicial'],
  ['educacion.primaria', 'Colegio primaria'],
  ['educacion.secundaria', 'Colegio secundaria'],
  ['transporte', 'Paradero'],
  ['areaVerde', 'Área verde'],
  ['compras_ocio', 'Mall'],
  ['abastecimiento', 'Mercado o supermercado'],
];
const leer = (o: any, r: string) => r.split('.').reduce((a, k) => (a ? a[k] : undefined), o);

/** Reporte del punto para imprimir o guardar como PDF (Ctrl+P). Solo se ve al imprimir; mismos datos que el panel. */
export default function Reporte({ punto, ficha, contexto }: { punto: Etiquetado | null; ficha: Ficha | null; contexto: Contexto | null }) {
  if (!punto || !ficha) return null;
  const e = ficha.entorno;
  const censo = e.censo;
  return (
    <article className="solo-impresion reporte" aria-hidden="true">
      <h1>GeoVerificador — Reporte del punto</h1>
      <p>
        {punto.nombre ?? 'Punto elegido'} · {punto.lat.toFixed(6)}, {punto.lon.toFixed(6)} · Distrito de {ficha.distrito?.nombre ?? 'sin dato'} · Generado el {fechaCorta(new Date().toISOString())}
      </p>
      <h2>Qué hay cerca</h2>
      <table>
        <thead><tr><th>Criterio</th><th>Más cercano</th><th>Distancia</th><th>Estado</th><th>Fuente y fecha</th></tr></thead>
        <tbody>
          {FILAS.map(([k, t]) => {
            const d = leer(e, k);
            if (!d) return null;
            return (
              <tr key={k}>
                <td>{t}</td><td>{d.nombre ?? '—'}</td><td>{metros(d.distanciaM)}</td><td>{tonoDe(d.estado).texto}</td><td>{d.fuente ?? ''}{d.fecha ? ` · ${fechaCorta(d.fecha)}` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h2>Servicios de la manzana (censo {censo?.anio ?? 2017})</h2>
      <p>
        {censo?.tieneCifras
          ? `Luz ${Math.round(censo.luz.pct)} %, agua ${Math.round(censo.agua.pct)} %, desagüe ${Math.round(censo.desague.pct)} % de ${censo.ocupadas} viviendas ocupadas. Son cifras de la manzana, no del predio ni de hoy. Fuente: INEI.`
          : 'No hay cifras del censo para esta manzana.'}
      </p>
      <h2>Zonificación</h2>
      <p>{ficha.zona ? `${ficha.zona.codigo} — ${ficha.zona.regla?.nombre ?? 'sin reglamento'}. Plano del PDM 2016-2025 (vigencia cumplida): confirmar con un Certificado de Zonificación y Vías.` : 'Fuera del plano de zonificación.'}</p>
      <h2>Seguridad y peligros</h2>
      <p>
        {contexto?.delito ? `${contexto.delito.conteo.total} denuncias de robo y hurto a ${contexto.delito.radio} m en ${contexto.delito.meta.meses} meses (denuncias, no todos los delitos). Fuente: MININTER, SIDPOL.` : 'Sin dato de denuncias.'}{' '}
        {contexto?.distrito?.zona ? `Zona sísmica ${contexto.distrito.zona} (Z = ${contexto.distrito.z}), Norma E.030. ` : ''}
        {contexto?.peligro ? `${contexto.peligro.total} peligros geológicos registrados a ${contexto.peligro.radio} m (INGEMMET).` : ''}
      </p>
      <p className="nota-impresion">Las distancias son en línea recta. Este reporte no es asesoría legal, técnica ni financiera: confirma cada dato con las entidades y con un profesional.</p>
    </article>
  );
}
