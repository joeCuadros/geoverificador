/**
 * avisos.ts — Avisos en la base (fase 3): ingesta de una corrida del recolector, historial de precios, ciclo de vida, duplicados entre portales,
 * ficha de entorno precalculada y búsqueda.
 *
 * La ingesta recibe los avisos tal como los escribe `pnpm datos:avisos` (esquema de scripts/lib/avisos/esquema.js). No lee de la red por su cuenta:
 * el tipo de cambio y el geocodificador se le entregan.
 */
import {
  agruparDuplicados,
  equivalenteEnSoles,
  inferirTipo,
  motivoDescarte,
  resumirCorrida,
  type AvisoComparable,
  type AvisoRecolectado,
  type ReporteCorrida,
  type TipoCambio,
} from '@geoverificador/dominio/avisos';
import type { Base, Fila } from './cliente.ts';
import { lugarMasCercano, type Punto } from './consultas.ts';
import { fichaDePunto } from './ficha.ts';
import { PRECISION_UTIL_M, textoDeAviso, type LugarHallado } from './geocodificar.ts';

/** Un aviso que una fuente dejó de mostrar durante estos días se marca como caído. */
export const DIAS_PARA_CAER = 14;

export interface OpcionesIngesta {
  ahora: Date;
  /** Fuentes que corrieron completas en esta corrida: solo de ellas se marcan avisos caídos. */
  fuentes: string[];
  tipoCambio: TipoCambio | null;
  /** Geocodificador de direcciones para los avisos sin coordenadas (tarea 3.2). Sin él, quedan sin coordenadas. */
  geocodificar?: (texto: string) => Promise<LugarHallado | null>;
  gastoUsd?: number;
  topeUsd?: number | null;
  diasParaCaer?: number;
}

export interface ResultadoIngesta extends ReporteCorrida {
  corridaId: number;
  nuevos: number;
  actualizados: number;
  cambiosDePrecio: number;
  caidos: number;
  geocodificados: number;
  sinPrecioEnSoles: number;
  duplicadosEntrePortales: number;
  conEntorno: number;
}

const area = (a: { area_construida_m2: number | null; area_total_m2: number | null }): number | null => a.area_construida_m2 ?? a.area_total_m2 ?? null;

/** Guarda una corrida del recolector. Todo o nada: si algo falla, la base queda como estaba. */
export async function ingerirCorrida(base: Base, recibidos: AvisoRecolectado[], opciones: OpcionesIngesta): Promise<ResultadoIngesta> {
  const ahora = opciones.ahora.toISOString();
  const hoy = ahora.slice(0, 10);
  const aceptados = recibidos.filter((a) => motivoDescarte(a) === null);
  const reporte = resumirCorrida(recibidos, aceptados);

  // La geocodificación va fuera de la transacción: es lenta (una consulta por segundo) y no toca la base.
  const ubicacion = new Map<string, { lat: number; lon: number; origen: 'portal' | 'geocodificada'; precisionM: number | null }>();
  let geocodificados = 0;
  for (const a of aceptados) {
    const clave = `${a.fuente}\u0000${a.id_fuente}`;
    if (a.lat !== null && a.lon !== null) ubicacion.set(clave, { lat: a.lat, lon: a.lon, origen: 'portal', precisionM: null });
    else if (opciones.geocodificar) {
      const texto = textoDeAviso(a);
      const h = texto ? await opciones.geocodificar(texto).catch(() => null) : null;
      if (h && h.precisionM <= PRECISION_UTIL_M) {
        ubicacion.set(clave, { lat: h.lat, lon: h.lon, origen: 'geocodificada', precisionM: h.precisionM });
        geocodificados++;
      }
    }
  }

  return base.transaccion(async (tx) => {
    const corridaId = Number(
      (await tx.consulta('INSERT INTO corrida_avisos (iniciada_en, fuentes, recibidos, aceptados, descartados, gasto_usd, tope_usd) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id', [
        ahora,
        opciones.fuentes,
        reporte.recibidos,
        reporte.aceptados,
        reporte.descartados,
        opciones.gastoUsd ?? 0,
        opciones.topeUsd ?? null,
      ]))[0].id,
    );
    let nuevos = 0;
    let actualizados = 0;
    let cambiosDePrecio = 0;
    let sinPrecioEnSoles = 0;
    const porRecalcular: { id: number; punto: Punto }[] = [];

    for (const a of aceptados) {
      const { tipo, inferido } = inferirTipo(a);
      const pen = equivalenteEnSoles(a.precio, a.moneda, hoy, opciones.tipoCambio);
      if (a.precio !== null && pen.precioPen === null) sinPrecioEnSoles++;
      const u = ubicacion.get(`${a.fuente}\u0000${a.id_fuente}`) ?? null;
      const previo = (await tx.consulta('SELECT id, precio, moneda, ST_Y(punto) AS lat, ST_X(punto) AS lon, origen_coordenada FROM aviso WHERE fuente_id = $1 AND id_fuente = $2', [a.fuente, a.id_fuente]))[0];
      // Un aviso que ya tenía coordenada no la pierde porque esta corrida vino en modo lista.
      const punto = u ?? (previo?.lat != null ? { lat: previo.lat, lon: previo.lon, origen: previo.origen_coordenada, precisionM: null } : null);
      const valores = [
        a.url, a.titulo, tipo, inferido, a.tipo_portal, a.es_proyecto, a.precio, a.precio_max, a.moneda, pen.precioPen, pen.tipoCambio, pen.tipoCambioFecha,
        a.area_total_m2, a.area_construida_m2, a.dormitorios, a.dormitorios_max, a.banos, a.estacionamientos, a.distrito, a.zona, a.direccion,
        punto?.lon ?? null, punto?.lat ?? null, punto?.origen ?? null, u?.precisionM ?? null, a.fecha_publicacion, ahora, corridaId,
      ];
      const columnas = `url = $3, titulo = $4, tipo_inmueble = $5, tipo_inferido = $6, tipo_portal = $7, es_proyecto = $8, precio = $9, precio_max = $10, moneda = $11, precio_pen = $12,
        tipo_cambio = $13, tipo_cambio_fecha = $14, area_total_m2 = $15, area_construida_m2 = $16, dormitorios = $17, dormitorios_max = $18, banos = $19, estacionamientos = $20,
        distrito = $21, zona = $22, direccion = $23, punto = CASE WHEN $24::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($24::float8, $25::float8), 4326) END,
        origen_coordenada = $26, precision_m = $27, fecha_publicacion = $28, ultima_vez_visto = $29, corrida_id = $30, estado = 'vigente', caido_en = NULL`;
      let id: number;
      if (previo) {
        id = Number(previo.id);
        await tx.consulta(`UPDATE aviso SET ${columnas} WHERE fuente_id = $1 AND id_fuente = $2`, [a.fuente, a.id_fuente, ...valores]);
        actualizados++;
      } else {
        const ins = `INSERT INTO aviso (fuente_id, id_fuente, url, titulo, tipo_inmueble, tipo_inferido, tipo_portal, es_proyecto, precio, precio_max, moneda, precio_pen, tipo_cambio, tipo_cambio_fecha,
            area_total_m2, area_construida_m2, dormitorios, dormitorios_max, banos, estacionamientos, distrito, zona, direccion, punto, origen_coordenada, precision_m, fecha_publicacion,
            primera_vez_visto, ultima_vez_visto, corrida_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
            CASE WHEN $24::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($24::float8, $25::float8), 4326) END, $26, $27, $28, $29, $29, $30) RETURNING id`;
        id = Number((await tx.consulta(ins, [a.fuente, a.id_fuente, ...valores]))[0].id);
        nuevos++;
      }
      const cambioPrecio = a.precio !== null && a.moneda !== null && (!previo || Number(previo.precio) !== a.precio || previo.moneda !== a.moneda);
      if (cambioPrecio) {
        await tx.consulta('INSERT INTO aviso_precio (aviso_id, visto_en, precio, moneda, precio_pen, tipo_cambio) VALUES ($1, $2, $3, $4, $5, $6)', [id, ahora, a.precio, a.moneda, pen.precioPen, pen.tipoCambio]);
        if (previo) cambiosDePrecio++;
      }
      const seMovio = punto && (!previo || previo.lat == null || Math.abs(previo.lat - punto.lat) > 1e-6 || Math.abs(previo.lon - punto.lon) > 1e-6);
      if (punto && (seMovio || !(await tx.consulta('SELECT 1 FROM aviso_entorno WHERE aviso_id = $1', [id])).length)) porRecalcular.push({ id, punto: { lat: punto.lat, lon: punto.lon } });
      if (!punto) await tx.consulta('DELETE FROM aviso_entorno WHERE aviso_id = $1', [id]);
    }

    // Ciclo de vida (3.6): lo que una fuente que corrió dejó de mostrar hace DIAS_PARA_CAER días o más.
    const dias = opciones.diasParaCaer ?? DIAS_PARA_CAER;
    const caidos = (
      await tx.consulta(
        `UPDATE aviso SET estado = 'caido', caido_en = $1 WHERE estado = 'vigente' AND fuente_id = ANY ($2::text[]) AND ultima_vez_visto <= $1::timestamptz - make_interval(days => $3) RETURNING id`,
        [ahora, opciones.fuentes, dias],
      )
    ).length;

    // Duplicados entre portales (3.5), sobre todos los avisos vigentes.
    const vigentes = await tx.consulta(`SELECT id, fuente_id, tipo_inmueble, es_proyecto, precio_pen, COALESCE(area_construida_m2, area_total_m2) AS area, dormitorios, distrito, titulo, ST_Y(punto) AS lat, ST_X(punto) AS lon FROM aviso WHERE estado = 'vigente'`);
    const comparables: AvisoComparable[] = vigentes.map((v) => ({ id: Number(v.id), fuente: v.fuente_id, tipo: v.tipo_inmueble, esProyecto: v.es_proyecto, precioPen: v.precio_pen === null ? null : Number(v.precio_pen), areaM2: v.area, dormitorios: v.dormitorios, distrito: v.distrito, titulo: v.titulo, lat: v.lat, lon: v.lon }));
    const grupos = agruparDuplicados(comparables);
    await tx.consulta('UPDATE aviso SET grupo_id = NULL WHERE grupo_id IS NOT NULL');
    for (const [id, grupo] of grupos) await tx.consulta('UPDATE aviso SET grupo_id = $2 WHERE id = $1', [id, grupo]);

    // Ficha de entorno (3.7).
    for (const x of porRecalcular) await guardarEntorno(tx, x.id, x.punto, opciones.ahora);

    const resultado: ResultadoIngesta = { ...reporte, corridaId, nuevos, actualizados, cambiosDePrecio, caidos, geocodificados, sinPrecioEnSoles, duplicadosEntrePortales: grupos.size, conEntorno: porRecalcular.length };
    await tx.consulta(
      `UPDATE corrida_avisos SET terminada_en = $2, nuevos = $3, actualizados = $4, caidos = $5, sin_coordenadas = $6, sin_distrito = $7, sin_precio_pen = $8, duplicados_entre_portales = $9, reporte = $10::jsonb WHERE id = $1`,
      [corridaId, new Date().toISOString(), nuevos, actualizados, caidos, aceptados.length - [...ubicacion.keys()].length, reporte.sinDistrito, sinPrecioEnSoles, grupos.size, JSON.stringify(resultado)],
    );
    return resultado;
  });
}

export interface Criterio {
  /** Valor medido: metros, porcentaje, código de zona o sí/no. null si no hay dato. */
  valor: number | string | boolean | null;
  unidad: 'm' | '%' | 'zona' | 'booleano' | 'nivel';
  /** A qué se midió: el nombre del colegio, del mall, de la manzana… */
  referencia: string | null;
  fuente: string | null;
  fecha: string | null;
  /** El límite del dato, en una frase. */
  nota: string | null;
}

const NOTA_RECTA = 'Distancia en línea recta, no recorrido a pie.';
const mide = (r: any, nota: string = NOTA_RECTA): Criterio => ({ valor: r && Number.isFinite(r.distanciaM) ? Math.round(r.distanciaM) : null, unidad: 'm', referencia: r?.nombre ?? null, fuente: r?.fuente ?? null, fecha: r?.fecha ?? null, nota });

/** Los criterios de entorno de un punto, cada uno con su valor medido, el dato y su fecha. */
export async function entornoDePunto(base: Base, p: Punto): Promise<Record<string, Criterio>> {
  const [ficha, universidad] = await Promise.all([fichaDePunto(base, p), lugarMasCercano(base, p, 'educacion_superior', { grupo: 'universidad' })]);
  const e = ficha.entorno;
  const niveles = ['inicial', 'primaria', 'secundaria'].map((n) => ({ nivel: n, r: e.educacion?.[n] })).filter((x) => Number.isFinite(x.r?.distanciaM));
  const colegio = niveles.sort((a, b) => a.r.distanciaM - b.r.distanciaM)[0];
  const censo = e.censo ?? {};
  const pct = (v: any) => (v && Number.isFinite(v.pct) ? Math.round(v.pct) : null);
  const notaCenso = `Cobertura de la manzana en el censo de ${censo.anio ?? 2017}, no del predio ni de hoy.`;
  const servicio = (v: any): Criterio => ({ valor: pct(v), unidad: '%', referencia: censo.manzana ? `manzana ${censo.manzana}` : null, fuente: censo.fuente ?? null, fecha: censo.fecha ?? null, nota: notaCenso });
  const volcan = ficha.peligros.filter((x) => x.clase === 'volcanico');
  const orden = ['alto', 'moderado', 'medio', 'bajo'];
  const peor = volcan.map((x) => String(x.nivel ?? '').toLowerCase()).sort((a, b) => (orden.indexOf(a) + 99) % 99 - ((orden.indexOf(b) + 99) % 99))[0] ?? null;
  const cauce = ficha.peligros.find((x) => x.clase === 'cauce') ?? null;
  return {
    colegio: { ...mide(colegio?.r), referencia: colegio ? `${colegio.r.nombre ?? 'colegio sin nombre'} (${colegio.nivel})` : null },
    universidad: universidad
      ? { valor: Math.round(universidad.distanciaM), unidad: 'm', referencia: universidad.nombre, fuente: 'OpenStreetMap y lista de SUNEDU', fecha: universidad.fecha, nota: `${NOTA_RECTA} Las sedes salen de OpenStreetMap: puede faltar alguna.` }
      : { valor: null, unidad: 'm', referencia: null, fuente: null, fecha: null, nota: 'No hay universidades cargadas.' },
    mall: mide(e.compras_ocio, `${NOTA_RECTA} Solo cuentan los centros comerciales; las galerías son otra categoría.`),
    salud: mide(e.salud),
    paradero: mide(e.transporte),
    mercado: mide(e.abastecimiento),
    agua: servicio(censo.agua),
    luz: servicio(censo.luz),
    desague: servicio(censo.desague),
    concesion_electrica: { valor: typeof e.electricidad?.dentro === 'boolean' ? e.electricidad.dentro : null, unidad: 'booleano', referencia: e.electricidad?.nombre ?? null, fuente: e.electricidad?.fuente ?? null, fecha: e.electricidad?.fecha ?? null, nota: 'Estar dentro de un área de concesión no es tener una conexión.' },
    zona: { valor: ficha.zona?.codigo ?? null, unidad: 'zona', referencia: ficha.zona?.regla?.nombre ?? null, fuente: 'Plano de zonificación del PDM 2016-2025', fecha: null, nota: 'La vigencia del plan está cumplida: confirme con un Certificado de Zonificación y Vías.' },
    peligro_volcanico: { valor: volcan.length ? peor : 'fuera', unidad: 'nivel', referencia: volcan[0]?.tipo ?? null, fuente: 'IGP (CENVUL)', fecha: null, nota: 'El mapa del IGP no trae fecha de elaboración.' },
    cauce: { valor: cauce ? Math.round(cauce.distanciaM) : null, unidad: 'm', referencia: cauce?.nombre ?? null, fuente: 'ANA, IGP y OpenStreetMap', fecha: null, nota: 'Distancia a la línea del cauce en el mapa; null si no hay ninguno a 500 m.' },
  };
}

async function guardarEntorno(base: Base, avisoId: number, p: Punto, ahora: Date): Promise<void> {
  const c = await entornoDePunto(base, p);
  const n = (k: string) => (typeof c[k].valor === 'number' ? c[k].valor : null);
  await base.consulta(
    `INSERT INTO aviso_entorno (aviso_id, calculado_en, colegio_m, universidad_m, mall_m, salud_m, paradero_m, mercado_m, zona_codigo, agua_pct, luz_pct, desague_pct, en_concesion_electrica, peligro_volcanico, cauce_m, criterios)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
     ON CONFLICT (aviso_id) DO UPDATE SET calculado_en = EXCLUDED.calculado_en, colegio_m = EXCLUDED.colegio_m, universidad_m = EXCLUDED.universidad_m, mall_m = EXCLUDED.mall_m, salud_m = EXCLUDED.salud_m,
       paradero_m = EXCLUDED.paradero_m, mercado_m = EXCLUDED.mercado_m, zona_codigo = EXCLUDED.zona_codigo, agua_pct = EXCLUDED.agua_pct, luz_pct = EXCLUDED.luz_pct, desague_pct = EXCLUDED.desague_pct,
       en_concesion_electrica = EXCLUDED.en_concesion_electrica, peligro_volcanico = EXCLUDED.peligro_volcanico, cauce_m = EXCLUDED.cauce_m, criterios = EXCLUDED.criterios`,
    [avisoId, ahora.toISOString(), n('colegio'), n('universidad'), n('mall'), n('salud'), n('paradero'), n('mercado'), c.zona.valor, n('agua'), n('luz'), n('desague'), c.concesion_electrica.valor, c.peligro_volcanico.valor, n('cauce'), JSON.stringify(c)],
  );
}

export interface FiltrosAvisos {
  tipo?: string | null;
  /** Precio máximo ya llevado a soles. */
  precioMaxPen?: number | null;
  distrito?: string | null;
  dormitoriosMin?: number | null;
  areaMinM2?: number | null;
  /** Solo avisos a `radioM` metros o menos de este punto (en línea recta). */
  cerca?: { lat: number; lon: number; radioM: number } | null;
  limite?: number;
  /** 'ninguna' (por omisión, ADR 0002) | 'permitidas' (solo fuentes con permite_publicar) | 'todas' (desarrollo). */
  publicar?: 'ninguna' | 'permitidas' | 'todas';
}

export interface AvisoHallado {
  id: number;
  fuente: string;
  fuenteNombre: string;
  url: string;
  titulo: string | null;
  tipo: string | null;
  tipoInferido: boolean;
  esProyecto: boolean;
  precio: number | null;
  moneda: string | null;
  precioPen: number | null;
  tipoCambio: number | null;
  tipoCambioFecha: string | null;
  areaM2: number | null;
  dormitorios: number | null;
  banos: number | null;
  distrito: string | null;
  zona: string | null;
  lat: number | null;
  lon: number | null;
  origenCoordenada: string | null;
  primeraVezVisto: string;
  ultimaVezVisto: string;
  /** Otros portales donde está el mismo inmueble. */
  tambienEn: string[];
  distanciaM: number | null;
  criterios: Record<string, Criterio> | null;
}

/** Avisos vigentes que cumplen los filtros. Sin `publicar` no devuelve ninguno: mostrar avisos de terceros es una decisión pendiente (ADR 0002). */
export async function buscarAvisos(base: Base, filtros: FiltrosAvisos = {}): Promise<{ avisos: AvisoHallado[]; total: number; motivoVacio: string | null }> {
  const publicar = filtros.publicar ?? 'ninguna';
  if (publicar === 'ninguna') return { avisos: [], total: 0, motivoVacio: 'La publicación de avisos de terceros no está activada (ADR 0002).' };
  const cond: string[] = ["a.estado = 'vigente'", '(a.grupo_id IS NULL OR a.grupo_id = a.id)'];
  const p: unknown[] = [];
  const param = (v: unknown) => `$${p.push(v)}`;
  if (publicar === 'permitidas') cond.push('f.permite_publicar');
  if (filtros.tipo) cond.push(`a.tipo_inmueble = ${param(filtros.tipo)}`);
  if (filtros.precioMaxPen != null) cond.push(`a.precio_pen <= ${param(filtros.precioMaxPen)}`);
  if (filtros.distrito) cond.push(`a.distrito = ${param(filtros.distrito)}`);
  if (filtros.dormitoriosMin != null) cond.push(`COALESCE(a.dormitorios_max, a.dormitorios) >= ${param(filtros.dormitoriosMin)}`);
  if (filtros.areaMinM2 != null) cond.push(`COALESCE(a.area_total_m2, a.area_construida_m2) >= ${param(filtros.areaMinM2)}`);
  let distancia = 'NULL::float8';
  if (filtros.cerca) {
    const pt = `ST_SetSRID(ST_MakePoint(${param(filtros.cerca.lon)}, ${param(filtros.cerca.lat)}), 4326)::geography`;
    cond.push(`a.punto IS NOT NULL AND ST_DWithin(a.punto::geography, ${pt}, ${param(filtros.cerca.radioM)})`);
    distancia = `ST_Distance(a.punto::geography, ${pt})`;
  }
  const donde = cond.join(' AND ');
  const total = Number((await base.consulta(`SELECT count(*)::int AS n FROM aviso a JOIN fuente f ON f.id = a.fuente_id WHERE ${donde}`, p))[0].n);
  const filas = await base.consulta(
    `SELECT a.*, ST_Y(a.punto) AS lat, ST_X(a.punto) AS lon, f.nombre AS fuente_nombre, e.criterios, ${distancia} AS distancia_m,
            ARRAY(SELECT DISTINCT o.fuente_id FROM aviso o WHERE o.grupo_id = a.id AND o.id <> a.id AND o.estado = 'vigente') AS tambien_en
     FROM aviso a JOIN fuente f ON f.id = a.fuente_id LEFT JOIN aviso_entorno e ON e.aviso_id = a.id
     WHERE ${donde} ORDER BY a.ultima_vez_visto DESC, a.id LIMIT ${param(Math.min(Math.max(filtros.limite ?? 50, 1), 200))}`,
    p,
  );
  const fecha = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    total,
    motivoVacio: total === 0 ? 'Ningún aviso vigente cumple los filtros.' : null,
    avisos: filas.map((a: Fila) => ({
      id: Number(a.id), fuente: a.fuente_id, fuenteNombre: a.fuente_nombre, url: a.url, titulo: a.titulo, tipo: a.tipo_inmueble, tipoInferido: a.tipo_inferido, esProyecto: a.es_proyecto,
      precio: num(a.precio), moneda: a.moneda, precioPen: num(a.precio_pen), tipoCambio: num(a.tipo_cambio), tipoCambioFecha: a.tipo_cambio_fecha ? fecha(a.tipo_cambio_fecha).slice(0, 10) : null,
      areaM2: a.area_construida_m2 ?? a.area_total_m2 ?? null, dormitorios: a.dormitorios, banos: a.banos, distrito: a.distrito, zona: a.zona, lat: a.lat, lon: a.lon, origenCoordenada: a.origen_coordenada,
      primeraVezVisto: fecha(a.primera_vez_visto), ultimaVezVisto: fecha(a.ultima_vez_visto), tambienEn: a.tambien_en ?? [], distanciaM: num(a.distancia_m), criterios: a.criterios ?? null,
    })),
  };
}

/** Un aviso por id con sus criterios de entorno, o null. Respeta la misma regla de publicación que buscarAvisos. */
export async function avisoPorId(base: Base, id: number, publicar: FiltrosAvisos['publicar'] = 'ninguna'): Promise<AvisoHallado | null> {
  if (publicar === 'ninguna' || !Number.isInteger(id)) return null;
  const fila = (await base.consulta(`SELECT a.fuente_id, a.id_fuente, f.permite_publicar FROM aviso a JOIN fuente f ON f.id = a.fuente_id WHERE a.id = $1`, [id]))[0];
  if (!fila || (publicar === 'permitidas' && !fila.permite_publicar)) return null;
  const filas = await base.consulta(
    `SELECT a.*, ST_Y(a.punto) AS lat, ST_X(a.punto) AS lon, f.nombre AS fuente_nombre, e.criterios FROM aviso a JOIN fuente f ON f.id = a.fuente_id LEFT JOIN aviso_entorno e ON e.aviso_id = a.id WHERE a.id = $1`,
    [id],
  );
  const a = filas[0];
  const fecha = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: Number(a.id), fuente: a.fuente_id, fuenteNombre: a.fuente_nombre, url: a.url, titulo: a.titulo, tipo: a.tipo_inmueble, tipoInferido: a.tipo_inferido, esProyecto: a.es_proyecto,
    precio: num(a.precio), moneda: a.moneda, precioPen: num(a.precio_pen), tipoCambio: num(a.tipo_cambio), tipoCambioFecha: a.tipo_cambio_fecha ? fecha(a.tipo_cambio_fecha).slice(0, 10) : null,
    areaM2: a.area_construida_m2 ?? a.area_total_m2 ?? null, dormitorios: a.dormitorios, banos: a.banos, distrito: a.distrito, zona: a.zona, lat: a.lat, lon: a.lon, origenCoordenada: a.origen_coordenada,
    primeraVezVisto: fecha(a.primera_vez_visto), ultimaVezVisto: fecha(a.ultima_vez_visto), tambienEn: [], distanciaM: null, criterios: a.criterios ?? null,
  };
}

/** El tipo de cambio más reciente que no sea posterior a `dia`, o null. */
export async function tipoCambioVigente(base: Base, dia: string): Promise<TipoCambio | null> {
  const f = (await base.consulta(`SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, venta, fuente FROM tipo_cambio WHERE fecha <= $1::date ORDER BY fecha DESC LIMIT 1`, [dia]))[0];
  return f ? { fecha: f.fecha, venta: Number(f.venta), fuente: f.fuente } : null;
}

export async function guardarTipoCambio(base: Base, tc: TipoCambio & { url?: string }): Promise<void> {
  await base.consulta(`INSERT INTO tipo_cambio (fecha, venta, fuente, url) VALUES ($1, $2, $3, $4) ON CONFLICT (fecha) DO UPDATE SET venta = EXCLUDED.venta, fuente = EXCLUDED.fuente, url = EXCLUDED.url`, [tc.fecha, tc.venta, tc.fuente, tc.url ?? null]);
}

/** Estado de la base de avisos frente al criterio de «hecho» de la fase 3. */
export async function estadoDeAvisos(base: Base): Promise<{ vigentes: number; caidos: number; distritos: number; pctConCoordenadas: number | null; pctConEntorno: number | null; ultimaCorrida: string | null }> {
  const r = (
    await base.consulta(
      `SELECT count(*) FILTER (WHERE estado = 'vigente')::int AS vigentes, count(*) FILTER (WHERE estado = 'caido')::int AS caidos,
              count(DISTINCT distrito) FILTER (WHERE estado = 'vigente' AND distrito IN (SELECT nombre FROM distrito))::int AS distritos,
              count(*) FILTER (WHERE estado = 'vigente' AND punto IS NOT NULL)::int AS con_punto,
              (SELECT count(*) FROM aviso_entorno e JOIN aviso a2 ON a2.id = e.aviso_id WHERE a2.estado = 'vigente')::int AS con_entorno,
              (SELECT max(iniciada_en) FROM corrida_avisos) AS ultima
       FROM aviso`,
    )
  )[0];
  const pct = (n: number) => (r.vigentes ? Math.round((n / r.vigentes) * 1000) / 10 : null);
  return { vigentes: r.vigentes, caidos: r.caidos, distritos: r.distritos, pctConCoordenadas: pct(r.con_punto), pctConEntorno: pct(r.con_entorno), ultimaCorrida: r.ultima ? new Date(r.ultima).toISOString() : null };
}
