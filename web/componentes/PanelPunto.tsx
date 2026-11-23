'use client';
import { useEffect, useState } from 'react';
import ui from './ui.module.css';
import estilos from './PanelPunto.module.css';
import Buscador from './Buscador.tsx';
import Umbrales from '@geoverificador/dominio/nucleo/umbrales';
import type { Contexto } from '../lib/contexto.ts';
import type { Dato, Etiquetado, Ficha, Punto } from '../lib/tipos.ts';
import { fechaCorta, metros, tonoDe } from '../lib/formato.ts';

const CRITERIOS: { clave: string; etiqueta: string; ruta?: string[] }[] = [
  { clave: 'salud', etiqueta: 'Salud' },
  { clave: 'educacion.inicial', etiqueta: 'Colegio inicial' },
  { clave: 'educacion.primaria', etiqueta: 'Colegio primaria' },
  { clave: 'educacion.secundaria', etiqueta: 'Colegio secundaria' },
  { clave: 'transporte', etiqueta: 'Paradero' },
  { clave: 'areaVerde', etiqueta: 'Área verde' },
  { clave: 'compras_ocio', etiqueta: 'Mall' },
  { clave: 'abastecimiento', etiqueta: 'Mercado o supermercado' },
  { clave: 'comercio_barrio', etiqueta: 'Comercio de barrio' },
  { clave: 'finanzas', etiqueta: 'Bancos y cajeros' },
  { clave: 'comida_fuera', etiqueta: 'Restaurantes y cafés' },
  { clave: 'recreacion', etiqueta: 'Juegos infantiles' },
  { clave: 'consultorio', etiqueta: 'Consultorio médico' },
];

const leer = (obj: any, ruta: string) => ruta.split('.').reduce((o, k) => (o ? o[k] : undefined), obj) as Dato | undefined;

function Fila({ etiqueta, dato }: { etiqueta: string; dato?: Dato }) {
  if (!dato) return null;
  const { tono, texto } = tonoDe(dato.estado);
  const hay = dato.distanciaM != null;
  return (
    <div className={ui.fila}>
      <div className={ui.filaEtiqueta}>
        {etiqueta}
        <div className={ui.sub}>{dato.nombre ?? (hay ? '' : 'Sin dato en esta zona')}</div>
      </div>
      <div className={ui.filaValor}>
        {hay ? metros(dato.distanciaM) : '—'}
        <div>
          <span className={`${ui.chip} ${ui[tono]}`}>{texto}</span>
        </div>
      </div>
      <details className={ui.filaDetalle}>
        <summary>
          {dato.umbralM ? `Referencia: ${metros(dato.umbralM)} · ` : ''}
          {dato.fuente ?? 'Sin fuente'}{dato.fecha ? ` · ${fechaCorta(dato.fecha)}` : ''}
        </summary>
        {dato.metodo && <p>{dato.metodo}</p>}
      </details>
    </div>
  );
}

function Servicio({ etiqueta, dato }: { etiqueta: string; dato?: { pct: number | null } | null }) {
  const pct = dato?.pct ?? null;
  return (
    <div className={estilos.servicio}>
      <div className={estilos.servicioCab}>
        <span>{etiqueta}</span>
        <strong>{pct == null ? 'Sin cifra' : `${Math.round(pct)} %`}</strong>
      </div>
      <div className={ui.barra} role="img" aria-label={`${etiqueta}: ${pct == null ? 'sin cifra' : Math.round(pct) + ' por ciento'}`}>
        <span style={{ width: `${pct ?? 0}%` }} />
      </div>
    </div>
  );
}

interface PropsPanel {
  punto: Etiquetado | null;
  ficha: Ficha | null;
  cargando: boolean;
  error: string | null;
  destino: Etiquetado | null;
  onDestino: (d: Etiquetado | null) => void;
  guardado: boolean;
  onGuardar: () => void;
  onElegir: (p: Etiquetado) => void;
  contexto: Contexto | null;
}

interface Viaje { distanciaM: number; hayRuta: boolean; mejor: { minutos: number | null; trasbordos: number; lineas: string[]; caminarM: number } | null; nota: string }

export default function PanelPunto(p: PropsPanel) {
  const [viaje, setViaje] = useState<Viaje | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [umbral, setUmbral] = useState<number | null>(null);
  useEffect(() => { try { setUmbral(Umbrales.leer(window.localStorage).quebradaMinM); } catch { setUmbral(null); } }, []);
  const fijarUmbral = (v: string) => { const g = Umbrales.guardar(window.localStorage, { quebradaMinM: v }); setUmbral(g.quebradaMinM); };

  useEffect(() => {
    setViaje(null);
    if (!p.punto || !p.destino) return;
    let vivo = true;
    setCalculando(true);
    fetch('/api/viaje', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origen: { lat: p.punto.lat, lon: p.punto.lon }, destino: { lat: p.destino.lat, lon: p.destino.lon } }) })
      .then((r) => r.json())
      .then((j) => vivo && setViaje(j.error ? null : j))
      .catch(() => undefined)
      .finally(() => vivo && setCalculando(false));
    return () => { vivo = false; };
  }, [p.punto, p.destino]);

  if (!p.punto) {
    return (
      <div className={ui.vacio}>
        <strong>Toca un punto del mapa</strong>
        Te muestro qué hay cerca: colegios, salud, paraderos, servicios de la manzana, zonificación y peligros, cada dato con su fuente y su fecha.
      </div>
    );
  }
  const f = p.ficha;
  const e = f?.entorno ?? {};
  const censo = e.censo;
  return (
    <div>
      <section className={ui.tarjeta}>
        <p className={ui.tit}>Punto elegido</p>
        <h2 className={ui.h2}>{p.punto.nombre ?? `${p.punto.lat.toFixed(5)}, ${p.punto.lon.toFixed(5)}`}</h2>
        <p className={ui.sub}>{f?.distrito ? `Distrito de ${f.distrito.nombre.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())}` : p.cargando ? 'Buscando…' : ''}</p>
        <div className={estilos.acciones}>
          <button type="button" className={`${ui.boton} ${p.guardado ? ui.suave : ''}`} onClick={p.onGuardar}>{p.guardado ? '✓ Guardado para comparar' : '+ Guardar para comparar'}</button>
          <button type="button" className={ui.boton} onClick={() => window.print()} disabled={!f}>Imprimir reporte</button>
        </div>
      </section>

      {p.cargando && !f && (
        <section className={ui.tarjeta} aria-busy="true">
          <div className={ui.esqueleto} style={{ width: '60%' }} />
          <div className={ui.esqueleto} style={{ width: '90%', marginTop: 10 }} />
          <div className={ui.esqueleto} style={{ width: '75%', marginTop: 10 }} />
        </section>
      )}
      {p.error && <section className={ui.tarjeta}><p className={ui.nota}>{p.error}</p></section>}

      {f && (
        <>
          <section className={ui.tarjeta}>
            <p className={ui.tit}>Qué hay cerca</p>
            {CRITERIOS.map((c) => <Fila key={c.clave} etiqueta={c.etiqueta} dato={leer(e, c.clave)} />)}
          </section>

          <section className={ui.tarjeta}>
            <p className={ui.tit}>Servicios de la manzana</p>
            {censo?.tieneCifras ? (
              <>
                <Servicio etiqueta="Luz eléctrica" dato={censo.luz} />
                <Servicio etiqueta="Agua por red pública" dato={censo.agua} />
                <Servicio etiqueta="Desagüe por red pública" dato={censo.desague} />
                <p className={ui.nota}>Censo {censo.anio}, {censo.ocupadas} viviendas ocupadas. Es la cobertura de la manzana, no una garantía del servicio en el predio. Fuente: INEI, {fechaCorta(censo.fecha)}.</p>
              </>
            ) : (
              <p className={ui.nota}>No hay cifras del censo para esta manzana ({censo?.motivo?.replace(/_/g, ' ') ?? 'sin dato'}). No se asume que tenga o no tenga servicio.</p>
            )}
            {e.electricidad && (
              <p className={ui.nota}>Concesión eléctrica: {e.electricidad.dentro ? `dentro del área de ${e.electricidad.concesionaria ?? e.electricidad.nombre}` : 'fuera de un área de concesión conocida'}. Fuente: MINEM-DGE.</p>
            )}
          </section>

          <section className={ui.tarjeta}>
            <p className={ui.tit}>Zonificación</p>
            {f.zona ? (
              <>
                <div className={estilos.zona}>
                  <span className={estilos.muestra} style={{ background: f.zona.color ?? '#ccc' }} />
                  <div>
                    <strong>{f.zona.codigo}</strong> — {f.zona.regla?.nombre ?? 'Sin reglamento cargado'}
                    <div className={ui.sub}>{f.zona.regla?.edificable ? `Edificable: ${f.zona.regla.edificable}` : ''}{f.zona.regla?.pisos_max ? ` · hasta ${f.zona.regla.pisos_max} pisos` : ''}</div>
                  </div>
                </div>
                <p className={ui.nota}>Plano del PDM 2016-2025, de vigencia cumplida: confirma con un Certificado de Zonificación y Vías.</p>
              </>
            ) : (
              <p className={ui.nota}>El punto queda fuera del plano de zonificación.</p>
            )}
          </section>

          <section className={ui.tarjeta}>
            <p className={ui.tit}>Seguridad y sismos</p>
            {p.contexto?.delito ? (
              <div className={ui.fila}>
                <div className={ui.filaEtiqueta}>Denuncias de robo y hurto<div className={ui.sub}>a {p.contexto.delito.radio} m, últimos {p.contexto.delito.meta.meses} meses</div></div>
                <div className={ui.filaValor}>{p.contexto.delito.conteo.total}<div className={ui.sub}>{p.contexto.delito.conteo.ROBO ?? 0} robos · {p.contexto.delito.conteo.HURTO ?? 0} hurtos</div></div>
                <details className={ui.filaDetalle}><summary>MININTER · SIDPOL (PNP)</summary><p>Son denuncias con ubicación, no todos los delitos: mucha gente no denuncia. Se cuentan en un radio, nunca como puntos individuales.</p></details>
              </div>
            ) : <p className={ui.nota}>{p.contexto ? 'No pude leer las denuncias para este punto.' : 'Cargando denuncias…'}</p>}
            {p.contexto?.distrito?.zona != null && (
              <div className={ui.fila}>
                <div className={ui.filaEtiqueta}>Zona sísmica<div className={ui.sub}>Norma E.030 (MVCS), por distrito</div></div>
                <div className={ui.filaValor}>Zona {p.contexto.distrito.zona}<div className={ui.sub}>Z = {String(p.contexto.distrito.z).replace('.', ',')}</div></div>
                <details className={ui.filaDetalle}><summary>Qué significa</summary><p>Es regional: no considera el suelo del predio. Todo proyecto de edificación requiere un Estudio de Mecánica de Suelos.</p></details>
              </div>
            )}
            {p.contexto?.peligro && (
              <div className={ui.fila}>
                <div className={ui.filaEtiqueta}>Peligros geológicos<div className={ui.sub}>INGEMMET, a {p.contexto.peligro.radio} m</div></div>
                <div className={ui.filaValor}>{p.contexto.peligro.total}<div className={ui.sub}>{p.contexto.peligro.porTipo.map(([t, n]) => `${t} ${n}`).join(', ') || 'ninguno'}</div></div>
              </div>
            )}
          </section>

          <section className={ui.tarjeta}>
            <p className={ui.tit}>Mercado y riesgo del distrito</p>
            {p.contexto?.precio?.estado === 'INFORMATIVO' && p.contexto.precio.precioM2 ? (
              <div className={ui.fila}>
                <div className={ui.filaEtiqueta}>Precio de oferta por m²<div className={ui.sub}>mediana de {p.contexto.precio.nAvisos?.venta} avisos de venta en el distrito</div></div>
                <div className={ui.filaValor}>S/ {Math.round(p.contexto.precio.precioM2.venta).toLocaleString('es-PE').replace(/,/g, ' ')}</div>
                <details className={ui.filaDetalle}><summary>{p.contexto.precio.atribucion ?? p.contexto.precio.fuente}</summary><p>Es lo que piden los vendedores, no el valor de este inmueble ni un precio de cierre. No dice si un precio es caro o barato. Licencia {p.contexto.precio.licencia}.</p></details>
              </div>
            ) : <p className={ui.nota}>{p.contexto?.precio?.causa ?? (p.contexto ? 'Sin dato de precio para este distrito.' : 'Cargando…')}</p>}
            {p.contexto?.cenepred?.lineas?.map((l) => (
              <div className={ui.fila} key={l.fenomeno}>
                <div className={ui.filaEtiqueta}>{l.texto.split(':')[0]}<div className={ui.sub}>CENEPRED, escenario El Niño 2027, por distrito</div></div>
                <div className={ui.filaValor}><span className={`${ui.chip} ${/muy alto|alto/i.test(l.nivel) ? ui.mal : /medio/i.test(l.nivel) ? ui.aviso : ui.info}`}>{l.nivel}</span></div>
                <details className={ui.filaDetalle}><summary>Detalle</summary><p>{l.texto}</p></details>
              </div>
            ))}
            <p className={ui.nota}>Informativo: son estimaciones para todo el distrito, no una evaluación de tu predio.</p>
          </section>

          <section className={ui.tarjeta}>
            <p className={ui.tit}>Mis umbrales</p>
            <label className={estilos.umbral}>Distancia mínima a una quebrada o río (m)
              <input className={ui.campo} inputMode="numeric" placeholder="Sin umbral" value={umbral ?? ''} onChange={(x) => fijarUmbral(x.target.value.replace(/\D/g, ''))} />
            </label>
            {(() => {
              const cauces = f.peligros.filter((h) => h.clase === 'cauce' && h.distanciaM != null);
              const cerca = cauces.length ? Math.min(...cauces.map((h) => h.distanciaM as number)) : null;
              if (umbral == null) return <p className={ui.nota}>Ninguna norma fija esa distancia. Si escribes la tuya, la quebrada más cercana pasa a «cumple» o «no cumple» según tu umbral.</p>;
              if (cerca == null) return <p className={ui.nota}>No hay cauces mapeados a 500 m: <span className={`${ui.chip} ${ui.ok}`}>Cumple según tu umbral</span></p>;
              return <p className={ui.nota}>Cauce más cercano a {metros(cerca)}: <span className={`${ui.chip} ${cerca >= umbral ? ui.ok : ui.mal}`}>{cerca >= umbral ? 'Cumple' : 'No cumple'} según tu umbral de {metros(umbral)}</span></p>;
            })()}
          </section>

          <section className={ui.tarjeta}>
            <p className={ui.tit}>Peligros cercanos</p>
            {f.peligros.length === 0 ? (
              <p className={ui.nota}>No hay peligros mapeados a 500 m.</p>
            ) : (
              f.peligros.slice(0, 6).map((h, i) => (
                <div className={ui.fila} key={i}>
                  <div className={ui.filaEtiqueta}>{h.props?.detalle ?? h.nombre ?? h.tipo}<div className={ui.sub}>{h.clase} · {h.fuenteId}</div></div>
                  <div className={ui.filaValor}>{h.distanciaM ? metros(h.distanciaM) : 'aquí'}<div>{h.nivel && <span className={`${ui.chip} ${h.nivel === 'alto' ? ui.mal : h.nivel === 'moderado' ? ui.aviso : ui.info}`}>{h.nivel}</span>}</div></div>
                </div>
              ))
            )}
          </section>

          <section className={ui.tarjeta}>
            <p className={ui.tit}>Cómo llegar a mi trabajo</p>
            <Buscador placeholder="¿A dónde vas? (UNSA, Parque Industrial…)" onElegir={(d) => p.onDestino(d)} />
            {p.destino && <p className={ui.sub}>Destino: <strong>{p.destino.nombre}</strong> <button type="button" className={estilos.enlace} onClick={() => p.onDestino(null)}>quitar</button></p>}
            {calculando && <div className={ui.esqueleto} style={{ width: '70%', marginTop: 10 }} />}
            {viaje && (
              <div className={estilos.viaje}>
                {viaje.hayRuta && viaje.mejor ? (
                  <>
                    <strong>{viaje.mejor.minutos != null ? `${viaje.mejor.minutos} min` : 'Con ruta'}</strong> en {viaje.mejor.lineas.join(' + ')}
                    <span className={ui.sub}> · {viaje.mejor.trasbordos === 0 ? 'directo' : '1 trasbordo'} · caminas {metros(viaje.mejor.caminarM)} · {metros(viaje.distanciaM)} en línea recta</span>
                  </>
                ) : (
                  <>No encontré una ruta directa ni con un trasbordo en los datos. Distancia en línea recta: {metros(viaje.distanciaM)}.</>
                )}
                <p className={ui.nota}>{viaje.nota}</p>
              </div>
            )}
          </section>

          <section className={ui.tarjeta}>
            <p className={ui.tit}>De dónde sale cada dato</p>
            <p className={ui.nota}>Salud: RENIPRESS (SUSALUD) · Colegios: ESCALE (MINEDU) · Universidades: Sunedu · Censo: INEI 2017 · Zonificación: PDM 2016-2025 · Concesiones: MINEM · Peligros: IGP y cauces · Paraderos, malls y mercados: OpenStreetMap (ODbL). Las distancias son en línea recta. Esto no es asesoría legal ni financiera.</p>
          </section>
        </>
      )}
    </div>
  );
}

export type { Punto };
