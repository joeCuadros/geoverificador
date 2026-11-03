/**
 * pintado.js: Pintar el mapa según el criterio que eligió la persona (sin DOM, sin red).
 *
 * Cada celda de la cuadrícula del asistente (250 m sobre las zonas construibles del plano) se clasifica en CUMPLE,
 * NO CUMPLE o SIN DATO con los MISMOS cálculos de la búsqueda (Asistente.evaluarCelda) y los mismos umbrales de CONFIG.
 * Con varios criterios a la vez se pinta la INTERSECCIÓN («cumple todos»). Nada aquí pondera ni suma: pintar no da un
 * puntaje global ni señala una «mejor zona»; solo muestra qué celdas cumplen lo que la persona pidió y cuántas son.
 *
 *   chips(…)         → los criterios que se pueden pintar, en orden estable
 *   evaluar(…)       → estado de cada celda, conteo por criterio y conteo total
 *   leyenda(…)       → estados (icono, texto, patrón) y, por criterio, su umbral y su fuente
 *   textoResumen(…)  → «N de T celdas cumplen …»
 *   rectDeCelda(…)   → el cuadrado que se dibuja
 *
 * Se carga como script del navegador (define `Pintado`) y también como módulo CommonJS para las pruebas (test/pintado.spec.ts).
 */
const Pintado = (() => {
  const A = typeof Asistente !== 'undefined' ? Asistente : require('./asistente.js'); // eslint-disable-line no-undef
  const M_POR_GRADO = (Math.PI / 180) * 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const esNumero = (n) => typeof n === 'number' && Number.isFinite(n);

  /** Orden de los chips: primero lo que sale de los servicios, luego lo que sale del plano de zonificación. */
  const ORDEN = ['salud', 'inicial', 'primaria', 'secundaria', 'colegio', 'transporte', 'areaVerde', 'residencial', 'tranquilo', 'campina', 'comercial', 'historico'];

  /** Los tres estados. Cada uno tiene icono, texto y un patrón propio: ninguno depende solo del color. */
  const ESTADOS = [
    { id: 'cumple', texto: 'Cumple', icono: 'cumple', patron: 'solido', explicacion: 'El centro de la celda cumple el criterio.' },
    { id: 'nocumple', texto: 'No cumple', icono: 'nocumple', patron: 'rayas', explicacion: 'El centro de la celda no cumple el criterio.' },
    { id: 'sindato', texto: 'Sin dato', icono: 'sindato', patron: 'puntos', explicacion: 'No hay datos para decidirlo. No significa que no exista.' },
  ];

  const etiquetaCorta = (id) => (A.CRITERIOS[id] ? A.CRITERIOS[id].etiqueta.split(' (')[0] : String(id));

  const fmtDistancia = (m) => (m < 1000 ? `${Math.round(m)} m` : `${String(m / 1000).replace('.', ',')} km`);

  /** Separa los miles con un espacio que no se parte («2 358»). */
  function fmtMiles(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  const listaEs = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);

  /** Los criterios que se pueden pintar. «Lejos de quebradas» solo aparece si la persona dio su distancia mínima. */
  function chips({ distanciaQuebradaM = null } = {}) {
    const lista = ORDEN.filter((id) => A.CRITERIOS[id]).map((id) => ({ id, etiqueta: etiquetaCorta(id), grupo: A.CRITERIOS[id].tipo === 'zona' ? 'zona' : 'servicio' }));
    if (esNumero(distanciaQuebradaM) && distanciaQuebradaM > 0) {
      lista.push({ id: 'lejosQuebrada', etiqueta: `Lejos de quebradas (más de ${fmtDistancia(distanciaQuebradaM)})`, grupo: 'cauce' });
    }
    return lista;
  }

  /** ¿Hay datos de base para decidir este criterio? Sin ellos, toda celda es «sin dato» (nunca «cumple» ni «no cumple»). */
  function hayDatos(id, datos) {
    const d = datos || {};
    const def = A.CRITERIOS[id];
    if (!def) return false;
    if (def.tipo === 'zona') return true; // sale del plano de zonificación
    if (def.tipo === 'cauce') return Array.isArray(d.cauces) && d.cauces.length > 0;
    if (id === 'salud') return Array.isArray(d.salud) && d.salud.length > 0;
    if (id === 'transporte') return Array.isArray(d.transporte) && d.transporte.length > 0;
    if (id === 'areaVerde') return Array.isArray(d.verdes) && d.verdes.length > 0;
    const niveles = def.niveles || (def.nivel ? [def.nivel] : []);
    return niveles.some((n) => d.colegios && Array.isArray(d.colegios[n]) && d.colegios[n].length > 0);
  }

  /** Estado de una celda para UN criterio, a partir de lo que devuelve Asistente.evaluarCelda. */
  function clasificar(ev, hayBase = true) {
    if (!hayBase || !ev || ev.sinDato === true) return 'sindato';
    return ev.cumple ? 'cumple' : 'nocumple';
  }

  /** Varios criterios a la vez: cumple solo si todos cumplen; si alguno falla, no cumple; si ninguno falla pero falta un dato, sin dato. */
  function combinar(estados) {
    if (!estados || estados.length === 0) return 'sindato';
    if (estados.includes('nocumple')) return 'nocumple';
    if (estados.includes('sindato')) return 'sindato';
    return 'cumple';
  }

  /**
   * Criterios listos para evaluar a partir de los ids elegidos. Pintar no pondera: la prioridad es siempre 1. Conserva la
   * distancia propia de un criterio que ya estaba (por ejemplo, una que la persona dijo en el chat) y descarta «lejos de
   * quebradas» si no hay distancia, porque ninguna norma la fija.
   */
  function criteriosDe(ids, { previos = [], distanciaQuebradaM = null } = {}) {
    const vistos = new Set();
    const out = [];
    (Array.isArray(ids) ? ids : []).forEach((id) => {
      if (vistos.has(id) || !A.CRITERIOS[id]) return;
      vistos.add(id);
      if (id === 'lejosQuebrada') {
        if (esNumero(distanciaQuebradaM) && distanciaQuebradaM > 0) out.push({ id, umbralM: distanciaQuebradaM, prioridad: 1 });
        return;
      }
      const antes = (previos || []).find((c) => c.id === id);
      out.push({ id, umbralM: antes && esNumero(antes.umbralM) ? antes.umbralM : null, prioridad: 1 });
    });
    return out;
  }

  const contar = (estados) => {
    const r = { total: estados.length, cumple: 0, nocumple: 0, sindato: 0 };
    estados.forEach((e) => { r[e] += 1; });
    return r;
  };

  /**
   * Evalúa cada celda con cada criterio y las combina.
   * Devuelve { estados: ['cumple'|'nocumple'|'sindato'] (en el orden de las celdas), porCriterio: { id: conteo }, resumen: conteo }.
   */
  function evaluar({ celdas, datos, criterios, umbrales, radioGlobalM = null }) {
    const lista = Array.isArray(celdas) ? celdas : [];
    const crit = (criterios || []).filter((c) => A.CRITERIOS[c.id]);
    if (crit.length === 0) return { estados: [], porCriterio: {}, resumen: contar([]) };
    const base = Object.fromEntries(crit.map((c) => [c.id, hayDatos(c.id, datos)]));
    const porId = Object.fromEntries(crit.map((c) => [c.id, []]));
    const estados = lista.map((celda) => {
      const ev = A.evaluarCelda(celda, datos, crit, umbrales, radioGlobalM);
      const cada = crit.map((c) => {
        const e = clasificar(ev[c.id], base[c.id]);
        porId[c.id].push(e);
        return e;
      });
      return combinar(cada);
    });
    return { estados, porCriterio: Object.fromEntries(crit.map((c) => [c.id, contar(porId[c.id])])), resumen: contar(estados) };
  }

  /** «N de T celdas cumplen X.» (un criterio) o «… cumplen todos: X y Y.» (varios). */
  function textoResumen(resumen, criterios) {
    const nombres = (criterios || []).map((c) => etiquetaCorta(c.id));
    const cuenta = `${fmtMiles(resumen.cumple)} de ${fmtMiles(resumen.total)} celdas cumplen`;
    if (nombres.length <= 1) return `${cuenta}${nombres.length ? ` ${nombres[0]}` : ''}.`;
    return `${cuenta} todos: ${listaEs(nombres)}.`;
  }

  const FUENTE_PLANO = 'Plano del PDM 2016-2025';
  const FUENTE_ELEGIDA = 'Distancia que tú elegiste';

  /** Fuente corta del umbral de un criterio, sin inventar nada: sale de CONFIG o dice que la puso la persona. */
  function fuenteDe(c, { radioGlobalM, config, umbrales }) {
    const def = A.CRITERIOS[c.id];
    const fuentes = (config && config.fuentesUmbral) || {};
    const elegida = esNumero(c.umbralM) || esNumero(radioGlobalM);
    if (def.tipo === 'cauce') return `${FUENTE_ELEGIDA}. Red de la ANA (2018): no incluye todas las quebradas urbanas`;
    if (def.tipo === 'zona') {
      const dist = def.umbralClave ? `; la distancia ${elegida ? 'la elegiste tú' : 'es convención del proyecto'}` : '';
      return `${FUENTE_PLANO}${def.aproximado ? ' (aproximación, no un dato medido)' : ''}${dist}`;
    }
    if (elegida) return `${FUENTE_ELEGIDA}. Datos de OpenStreetMap`;
    if (c.id === 'areaVerde') {
      const min = umbrales && umbrales.areaVerde ? umbrales.areaVerde.areaMinM2 : null;
      return `OMS Europa (2016)${min ? `: parque de al menos ${fmtMiles(min)} m²` : ''}. Datos de OpenStreetMap`;
    }
    if (def.nivel || def.niveles) return 'MINEDU (Instructivo FTE, Cuadro N.° 1). Datos de OpenStreetMap';
    return `${fuentes[c.id] || 'Convención del proyecto'}. Datos de OpenStreetMap`;
  }

  /**
   * La leyenda del mapa pintado.
   *   estados: los tres estados con icono, texto y patrón; interseccion: true si hay más de un criterio.
   *   filas:   por criterio, su descripción con el umbral (la misma frase del chat), su fuente y si es una aproximación.
   */
  function leyenda({ criterios, umbrales, radioGlobalM = null, config = null }) {
    const crit = (criterios || []).filter((c) => A.CRITERIOS[c.id]);
    return {
      estados: ESTADOS.map((e) => ({ ...e })),
      interseccion: crit.length > 1,
      filas: crit.map((c) => ({
        id: c.id,
        etiqueta: etiquetaCorta(c.id),
        descripcion: A.describirCriterio({ ...c, prioridad: 1 }, umbrales, radioGlobalM),
        fuente: fuenteDe(c, { radioGlobalM, config, umbrales }),
        aproximado: Boolean(A.CRITERIOS[c.id].aproximado),
      })),
    };
  }

  /** Límites del cuadrado de `pasoM` metros centrado en la celda. */
  function rectDeCelda(celda, pasoM) {
    const mitad = pasoM / 2;
    const dLat = mitad / M_POR_GRADO;
    const dLon = mitad / (M_POR_GRADO * Math.cos(rad(celda.lat)));
    return { sur: celda.lat - dLat, norte: celda.lat + dLat, oeste: celda.lon - dLon, este: celda.lon + dLon };
  }

  return { ORDEN, ESTADOS, etiquetaCorta, fmtMiles, chips, hayDatos, clasificar, combinar, criteriosDe, evaluar, textoResumen, leyenda, rectDeCelda };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Pintado;
