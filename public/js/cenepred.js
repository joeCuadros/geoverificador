/**
 * cenepred.js — Escenario de riesgo del CENEPRED ante El Niño 2026-2027, por distrito (informativo, sin DOM).
 *
 * Fuente: servicio SIGRID del CENEPRED (capas «Riesgos a inundación» y «Riesgos a movimientos en masa»), congelado con
 * scripts/descargar-riesgo-cenepred.mjs en data/riesgo_cenepred_fen2027.json. Metodología: «Estudio de escenarios de riesgo por
 * inundaciones y movimientos en masa ante lluvias intensas asociadas al Fenómeno El Niño» (CENEPRED, mayo de 2026).
 *
 * Lo que es: un nivel de riesgo (bajo, medio, alto o muy alto) por distrito y por fenómeno, para un escenario de lluvias como las de
 * los veranos de 1983, 1998, 2017 y 2023, y cuántas viviendas, locales educativos y establecimientos de salud del distrito están en
 * áreas de mayor susceptibilidad. Lo que NO es: una evaluación del predio, un pronóstico ni una predicción de que vaya a llover así.
 * Nunca produce CUMPLE / NO CUMPLE ni puntaje: el estado es INFORMATIVO o SIN DATO (con su causa).
 *
 * Pura: recibe el contenido del JSON (objeto) y el distrito (ubigeo o nombre). `load` es la única función con red.
 * Se carga como script del navegador (define `Cenepred`) y también como módulo CommonJS para las pruebas.
 *
 *   buscar(datos, distrito)             → { estado: 'INFORMATIVO', distrito, titulo, ubigeo, inundacion, movimientos_masa, … } | SIN DATO
 *   frase(r, { fenomenos })             → «Según el CENEPRED, el distrito de Sachaca tiene riesgo muy alto ante inundaciones …»
 *   lineas(r, { fenomenos })            → una línea por fenómeno con las viviendas, locales educativos y establecimientos de salud
 *   porNivel(datos, fenomeno)           → cuántos distritos hay en cada nivel (para la leyenda del mapa)
 */
const Cenepred = (() => {
  const Dist = () => (typeof Distritos !== 'undefined' ? Distritos : require('./distritos.js')); // eslint-disable-line no-undef

  const NIVELES = ['Bajo', 'Medio', 'Alto', 'Muy alto'];
  const FENOMENOS = {
    inundacion: { id: 'inundacion', nombre: 'inundaciones', corto: 'inundación', suscept: 'a inundaciones' },
    movimientos_masa: { id: 'movimientos_masa', nombre: 'movimientos en masa', corto: 'movimientos en masa', suscept: 'a movimientos en masa' },
  };
  const IDS = Object.keys(FENOMENOS);

  /** Una explicación corta de «movimientos en masa» para quien no conoce el término. */
  const EXPLICA_MM = 'deslizamientos, huaicos y derrumbes';

  /** Qué quiere decir «mayor susceptibilidad» (el estudio la define como la predisposición de una zona a ser afectada por el evento). */
  const SUSCEPTIBILIDAD = 'Una zona de mayor susceptibilidad es donde el terreno es más propenso a que ocurra el fenómeno.';

  /** Texto estándar de lo que no cubre. */
  const QUE_NO_CUBRE = 'Es una estimación por distrito para un escenario de lluvias como las de El Niño de 1983, 1998, 2017 y 2023, no una predicción ni una evaluación de tu predio: dentro de un mismo distrito el riesgo cambia mucho de una calle a otra. Para decidir, pide la evaluación de riesgos de la municipalidad y consulta el SIGRID del CENEPRED.';

  const sinTildes = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const clave = (s) => sinTildes(s).replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();

  const sinDato = (distrito, causa, motivo) => ({ estado: 'SIN DATO', distrito: distrito || null, causa, motivo });

  const esNivel = (n) => NIVELES.includes(n);
  const esBloque = (b) => b && esNivel(b.nivel) && ['viviendas', 'instituciones_educativas', 'establecimientos_salud'].every((k) => Number.isInteger(b[k]) && b[k] >= 0);

  /** El ubigeo del distrito que se pide (ubigeo de 6 dígitos, nombre, o un objeto con `ubigeo` / `distrito`), o null. */
  function ubigeoDe(datos, entrada) {
    const filas = Object.entries(datos.distritos);
    const texto = entrada && typeof entrada === 'object' ? entrada.ubigeo || entrada.distrito : entrada;
    if (typeof texto !== 'string' || !texto.trim()) return null;
    if (/^\d{6}$/.test(texto.trim())) return filas.some(([u]) => u === texto.trim()) ? texto.trim() : null;
    const k = clave(texto);
    const directo = filas.find(([, d]) => clave(d.distrito) === k);
    if (directo) return directo[0];
    // Un apodo o un error de tipeo («cercado», «bustamante»): el buscador de nombres de distritos.
    const hit = Dist().buscarNombre(texto, { admitirCiudad: true });
    if (!hit) return null;
    const porHit = filas.find(([, d]) => clave(d.distrito) === clave(hit.distrito));
    return porHit ? porHit[0] : null;
  }

  /**
   * Los niveles y conteos del distrito: INFORMATIVO, o SIN DATO con su causa.
   * `datos` es el contenido de data/riesgo_cenepred_fen2027.json (o null si no se pudo leer).
   * motivo: 'sin_archivo' | 'sin_distrito' | 'fuera_de_datos' (un distrito de la provincia que no está en los datos) | 'sin_nivel'.
   */
  function buscar(datos, distrito) {
    if (!datos || typeof datos !== 'object' || !datos.distritos || typeof datos.distritos !== 'object') {
      return sinDato(null, 'No se pudo leer el archivo del escenario de riesgo del CENEPRED (riesgo_cenepred_fen2027.json).', 'sin_archivo');
    }
    const pedido = distrito && typeof distrito === 'object' ? distrito.distrito || distrito.ubigeo : distrito;
    if (!pedido) return sinDato(null, 'No se pudo determinar el distrito del punto, así que no hay escenario de riesgo del CENEPRED.', 'sin_distrito');
    const ubigeo = ubigeoDe(datos, distrito);
    if (!ubigeo) return sinDato(String(pedido), 'El escenario de riesgo del CENEPRED que tengo cubre los distritos de Arequipa Metropolitana; este distrito no está en los datos.', 'fuera_de_datos');
    const d = datos.distritos[ubigeo];
    if (!esBloque(d.inundacion) || !esBloque(d.movimientos_masa)) return sinDato(d.distrito, 'El archivo no trae un nivel de riesgo válido para este distrito.', 'sin_nivel');
    return {
      estado: 'INFORMATIVO',
      distrito: d.distrito,
      titulo: Dist().titulo(d.distrito),
      ubigeo,
      inundacion: { ...d.inundacion },
      movimientos_masa: { ...d.movimientos_masa },
      fuente: datos.fuente || null,
      url: datos.url || null,
      urlVisor: datos.url_visor || null,
      estudio: datos.estudio || null,
      escenario: datos.escenario || null,
      nota: datos.nota || null,
      fechaDescarga: datos.fecha_descarga || null,
    };
  }

  const minus = (nivel) => String(nivel).toLowerCase();
  const lista = (partes) => (partes.length <= 1 ? partes.join('') : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`);
  const fenomenosDe = (opciones) => {
    const f = opciones && Array.isArray(opciones.fenomenos) ? opciones.fenomenos.filter((x) => IDS.includes(x)) : [];
    return f.length ? IDS.filter((x) => f.includes(x)) : IDS;
  };
  const num = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  /**
   * La frase corta del distrito. Con los dos fenómenos y el mismo nivel, un solo «riesgo alto ante inundaciones y movimientos en masa».
   *   «Según el CENEPRED, el distrito de Sachaca tiene riesgo muy alto ante inundaciones y alto ante movimientos en masa en un escenario
   *    El Niño (estimación por distrito, no del predio).»
   */
  function frase(r, opciones = {}) {
    if (!r || r.estado !== 'INFORMATIVO') return null;
    const fs = fenomenosDe(opciones);
    const niveles = fs.map((f) => r[f].nivel);
    const distinto = new Set(niveles).size > 1;
    const cuerpo = distinto
      ? fs.map((f, i) => `${i === 0 ? 'riesgo ' : ''}${minus(r[f].nivel)} ante ${FENOMENOS[f].nombre}`).join(' y ')
      : `riesgo ${minus(niveles[0])} ante ${lista(fs.map((f) => FENOMENOS[f].nombre))}`;
    return `Según el CENEPRED, el distrito de ${r.titulo} tiene ${cuerpo} en un escenario El Niño (estimación por distrito, no del predio).`;
  }

  /** Versión corta para una celda de tabla o un resumen: «inundaciones: muy alto; movimientos en masa: alto». */
  function niveles(r, opciones = {}) {
    if (!r || r.estado !== 'INFORMATIVO') return null;
    return fenomenosDe(opciones).map((f) => `${FENOMENOS[f].nombre}: ${minus(r[f].nivel)}`).join('; ');
  }

  /** Una línea por fenómeno con los conteos confirmados: «Inundaciones: 7 926 viviendas, 50 locales educativos y 6 establecimientos de salud …». */
  function lineas(r, opciones = {}) {
    if (!r || r.estado !== 'INFORMATIVO') return [];
    return fenomenosDe(opciones).map((f) => {
      const b = r[f];
      const cuenta = (n, uno, varios) => `${num(n)} ${n === 1 ? uno : varios}`;
      const partes = [cuenta(b.viviendas, 'vivienda', 'viviendas'), cuenta(b.instituciones_educativas, 'local educativo', 'locales educativos'), cuenta(b.establecimientos_salud, 'establecimiento de salud', 'establecimientos de salud')];
      return {
        fenomeno: f,
        nivel: b.nivel,
        texto: `${FENOMENOS[f].nombre.charAt(0).toUpperCase()}${FENOMENOS[f].nombre.slice(1)}: riesgo ${minus(b.nivel)}. En zonas de mayor susceptibilidad ${FENOMENOS[f].suscept}: ${lista(partes)}.`,
      };
    });
  }

  /** Cuántos distritos del archivo hay en cada nivel del fenómeno: [{ nivel, n }] en el orden de NIVELES (solo los que tienen alguno). */
  function porNivel(datos, fenomeno) {
    if (!datos || !datos.distritos || !IDS.includes(fenomeno)) return [];
    const cuenta = new Map(NIVELES.map((n) => [n, 0]));
    Object.values(datos.distritos).forEach((d) => { if (d[fenomeno] && cuenta.has(d[fenomeno].nivel)) cuenta.set(d[fenomeno].nivel, cuenta.get(d[fenomeno].nivel) + 1); });
    return NIVELES.map((n) => ({ nivel: n, n: cuenta.get(n) })).filter((x) => x.n > 0);
  }

  /** Los distritos del archivo con su nivel en el fenómeno, para colorear el mapa: [{ distrito, ubigeo, nivel, viviendas, … }]. */
  function distritosPorFenomeno(datos, fenomeno) {
    if (!datos || !datos.distritos || !IDS.includes(fenomeno)) return [];
    return Object.entries(datos.distritos)
      .filter(([, d]) => d[fenomeno] && esNivel(d[fenomeno].nivel))
      .map(([ubigeo, d]) => ({ ubigeo, distrito: d.distrito, ...d[fenomeno] }));
  }

  /** Fecha ISO (AAAA-MM-DD) → «3 de noviembre de 2026». Devuelve el texto original si no es una fecha ISO. */
  function fechaLarga(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return iso || '';
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return meses[Number(m[2]) - 1] ? `${Number(m[3])} de ${meses[Number(m[2]) - 1]} de ${m[1]}` : iso;
  }

  /** Cómo se calculó, en una frase (para «Método» de la tarjeta, el informe y el chat). */
  const METODO = 'Se busca el distrito del punto en el escenario del CENEPRED, que da un nivel de riesgo por distrito y fenómeno. El nivel combina la susceptibilidad del distrito ante lluvias como las de El Niño con la vulnerabilidad de sus viviendas, locales educativos, establecimientos de salud, vías y cultivos. Datos congelados.';

  let ready = null;
  /** Carga el archivo (una sola vez). Si falla, la siguiente llamada lo reintenta. Solo para el navegador. */
  function load() {
    if (!ready) {
      ready = (async () => {
        const url = CONFIG.cenepred.jsonUrl; // eslint-disable-line no-undef
        let res;
        try {
          res = await fetch(url);
        } catch (_) {
          throw new Error(`No se pudo leer el archivo del escenario de riesgo del CENEPRED (${url}).`);
        }
        if (!res.ok) throw new Error(`No se encontró ${url} (HTTP ${res.status}). Genera el archivo con: node scripts/descargar-riesgo-cenepred.mjs`);
        let datos;
        try {
          datos = await res.json();
        } catch (_) {
          throw new Error(`${url} no es un JSON válido.`);
        }
        if (!datos || typeof datos.distritos !== 'object') throw new Error('El archivo del CENEPRED no tiene el formato esperado (falta `distritos`).');
        return datos;
      })().catch((err) => {
        ready = null;
        throw err;
      });
    }
    return ready;
  }

  return { NIVELES, FENOMENOS, IDS, EXPLICA_MM, SUSCEPTIBILIDAD, QUE_NO_CUBRE, METODO, buscar, frase, niveles, lineas, porNivel, distritosPorFenomeno, fechaLarga, load };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Cenepred;
