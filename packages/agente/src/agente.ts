/**
 * agente.ts — El ciclo del agente (tareas 6.2, 6.3 y 6.5).
 *
 *   mensaje → interpretar → ¿falta algo? una sola pregunta → geocodificar → buscar_avisos → redactar → verificar → respuesta
 *
 * El modelo de lenguaje es opcional y reemplazable: la interfaz `Proveedor` solo le deja escribir el texto final a partir de lo que devolvieron
 * las herramientas. Todo texto suyo pasa por `verificarRespuesta`; si cita una cifra o un enlace que las herramientas no dieron, se descarta y
 * se usa la redacción determinista. Sin proveedor (modo «reglas») la respuesta siempre es la determinista.
 */
import { interpretar, loQueFalta, PREGUNTA, type Consulta, type Faltante } from './consulta.ts';
import { ejecutar, type Contexto, type Salida } from './herramientas.ts';
import { LIMITES } from './criterios.ts';
import { redactarAvisos } from './redactar.ts';
import { verificarRespuesta } from './verificar.ts';

/** Lo que recuerda el ciclo entre turnos de una misma conversación. */
export interface EstadoConversacion {
  consulta: Consulta | null;
  pendiente: Faltante | null;
}
export const ESTADO_INICIAL: EstadoConversacion = { consulta: null, pendiente: null };

export interface Proveedor {
  nombre: string;
  /** Escribe la respuesta final a partir de lo que dijeron las herramientas. No debe agregar cifras ni enlaces. */
  redactar(entrada: { mensaje: string; consulta: Consulta; salidas: unknown[]; borrador: string }): Promise<string>;
}

export interface Respuesta {
  texto: string;
  /** 'pregunta': se pidió un dato; 'resultado': hay avisos o sectores; 'vacio': sin resultados; 'info': saludo/fuente/ayuda. */
  tipo: 'pregunta' | 'resultado' | 'vacio' | 'info';
  estado: EstadoConversacion;
  consulta: Consulta | null;
  herramientas: { nombre: string; entrada: unknown; salida: unknown }[];
  avisos: Salida<'buscar_avisos'>['avisos'];
  /** true si el texto de un proveedor se descartó por citar algo que las herramientas no dieron. */
  descartadoPorVerificacion: boolean;
  fallo?: string;
}

const AYUDA = 'Puedo buscar avisos de venta en Arequipa y medir qué tan cerca están de lo que te importa (colegio, universidad, mall, salud, paradero, trabajo), si tienen agua y luz, y si la zona es de comercio. Dime, por ejemplo: «un departamento en Cayma, cerca de un colegio, con agua y luz, hasta 400 mil soles».';

export async function responder(mensaje: string, estado: EstadoConversacion, ctx: Contexto, proveedor: Proveedor | null = null): Promise<Respuesta> {
  const herramientas: Respuesta['herramientas'] = [];
  const usar = async <N extends Parameters<typeof ejecutar>[0]>(nombre: N, entrada: unknown): Promise<Salida<N>> => {
    const salida = await ejecutar(nombre, entrada, ctx);
    herramientas.push({ nombre, entrada, salida });
    return salida;
  };
  const base = (extra: Partial<Respuesta> & Pick<Respuesta, 'texto' | 'tipo'>): Respuesta => ({ estado, consulta: null, herramientas, avisos: [], descartadoPorVerificacion: false, ...extra });

  const distritos = (await ctx.base.consulta('SELECT nombre FROM distrito ORDER BY orden')).map((f) => String(f.nombre));
  const c = interpretar(mensaje, { distritos, previa: estado.consulta, pendiente: estado.pendiente });

  try {
    if (c.intencion === 'saludo' || c.intencion === 'otra') return base({ texto: AYUDA, tipo: 'info', consulta: c, estado: { consulta: estado.consulta, pendiente: estado.pendiente } });

    if (c.intencion === 'fuente') {
      const r = await usar('explicar_fuente', { tema: c.tema ?? 'avisos' });
      const texto = r.fuentes.length ? r.fuentes.map((f) => `• ${f.nombre}${f.fecha ? ` — datos del ${f.fecha}` : ''}${f.licencia ? ` — licencia: ${f.licencia}${f.licenciaVerificada ? '' : ' (sin verificar)'}` : ''}${f.limite ? ` — límite: ${f.limite}` : ''}${f.url ? `\n  ${f.url}` : ''}`).join('\n') : 'No tengo registrada una fuente para ese tema.';
      return base({ texto, tipo: 'info', consulta: c });
    }

    if (c.intencion === 'buscar_zonas') {
      const ZONA: Record<string, 'salud' | 'colegio' | 'transporte' | 'lejosQuebrada'> = { salud: 'salud', colegio: 'colegio', paradero: 'transporte', lejos_de_cauce: 'lejosQuebrada' };
      const ids = [...new Set(c.criterios.map((x) => ZONA[x.id]).filter(Boolean))];
      if (ids.length === 0) return base({ texto: '¿Qué quieres tener cerca en la zona: salud, colegio, transporte, áreas verdes o lejos de quebradas?', tipo: 'pregunta', consulta: c, estado: { consulta: c, pendiente: null } });
      const r = await usar('buscar_zonas', { criterios: ids, distrito: c.distrito });
      return base({ texto: r.sectores.length ? r.texto : 'No encontré sectores que cumplan todo a la vez.', tipo: r.sectores.length ? 'resultado' : 'vacio', consulta: c, estado: { consulta: c, pendiente: null } });
    }

    // buscar_avisos — una sola pregunta por turno
    const falta = loQueFalta(c);
    if (falta) return base({ texto: PREGUNTA[falta], tipo: 'pregunta', consulta: c, estado: { consulta: c, pendiente: falta } });

    let trabajo: { lat: number; lon: number; nombre: string } | null = null;
    if (c.trabajoLugar) {
      const g = await usar('geocodificar_lugar', { texto: c.trabajoLugar });
      const util = g.candidatos.filter((x) => x.sirveParaMedir);
      if (util.length === 0) return base({ texto: `${g.nota ?? 'No ubiqué ese lugar.'} ${PREGUNTA.trabajo}`, tipo: 'pregunta', consulta: { ...c, trabajoLugar: null }, estado: { consulta: { ...c, trabajoLugar: null }, pendiente: 'trabajo' } });
      trabajo = { lat: util[0].lat, lon: util[0].lon, nombre: util[0].nombre };
    }
    let lugar: { lat: number; lon: number; nombre: string } | null = null;
    if (c.lugarCerca) {
      const g = await usar('geocodificar_lugar', { texto: c.lugarCerca });
      const util = g.candidatos.find((x) => x.sirveParaMedir);
      if (util) lugar = { lat: util.lat, lon: util.lon, nombre: util.nombre };
    }
    const criterios = c.criterios.filter((x) => (x.id === 'trabajo' ? trabajo : x.id === 'lugar' ? lugar : true));
    const r = await usar('buscar_avisos', { tipo: c.tipo, precioMax: c.precioMax, moneda: c.moneda, distrito: c.distrito, dormitoriosMin: c.dormitoriosMin, areaMinM2: c.areaMinM2, criterios, trabajo, lugar, sinTrasbordo: c.sinTrasbordo });

    const aparte: string[] = [];
    if (trabajo) aparte.push(`Tomé como trabajo «${trabajo.nombre}».`);
    if (c.lugarCerca && !lugar) aparte.push(`No ubiqué «${c.lugarCerca}» con precisión; no lo medí.`);
    if (c.noDisponible.length) aparte.push(`No tengo datos de: ${c.noDisponible.join(', ')}; no lo usé para filtrar.`);
    let texto = [redactarAvisos(r), ...aparte].join('\n\n');
    let descartado = false;
    if (proveedor) {
      try {
        const propuesto = await proveedor.redactar({ mensaje, consulta: c, salidas: herramientas.map((h) => h.salida), borrador: texto });
        const v = verificarRespuesta(propuesto, herramientas.map((h) => h.salida), [mensaje, ...LIMITES]);
        if (v.ok) texto = propuesto;
        else descartado = true;
      } catch {
        descartado = true;
      }
    }
    return base({ texto, tipo: r.avisos.length ? 'resultado' : 'vacio', consulta: c, estado: { consulta: c, pendiente: null }, avisos: r.avisos, descartadoPorVerificacion: descartado });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return base({ texto: `No pude completar la búsqueda: ${msg}`, tipo: 'info', consulta: c, fallo: msg });
  }
}
