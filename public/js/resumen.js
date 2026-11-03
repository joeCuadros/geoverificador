/**
 * resumen.js — El punto elegido, dicho en palabras de todos los días (sin DOM, sin red).
 *
 * Reordena lo que la ficha ya calculó (zona, servicios cercanos, cauce más cercano) en un resumen corto que sirve a quien va
 * a comprar: dónde está, qué se puede construir, qué tiene cerca, qué queda más lejos de lo recomendado y qué hay en riesgo
 * cerca. No agrega datos ni calcula nada nuevo: cada cifra sale de la ficha. Lo usan el chat y el inicio de la ficha.
 *
 *   punto({ distrito, zona, entorno, cauce }) → { texto, lineas: [3 líneas], aviso }
 *   verificar(items)                          → texto con los trámites que conviene comprobar antes de comprar
 *
 * Se carga como script del navegador (define `Resumen`) y también como módulo CommonJS para las pruebas.
 */
const Resumen = (() => {
  const D = () => (typeof Distritos !== 'undefined' ? Distritos : require('./distritos.js')); // eslint-disable-line no-undef

  /** «351 m», «1,04 km» (dos decimales: así se compara con la ficha). */
  const fmt = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2).replace('.', ',')} km`);
  /** La distancia de referencia: «400 m», «1,5 km», «3 km». */
  const fmtRef = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2).replace(/0+$/, '').replace(/[.,]$/, '').replace('.', ',')} km`);
  const minuscula = (t) => String(t).charAt(0).toLowerCase() + String(t).slice(1);
  const lista = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);

  const AVISO = 'Es referencial: no reemplaza el Certificado de Parámetros Urbanísticos y Edificatorios ni el de Zonificación y Vías.';

  function queConstruir(zona) {
    const r = zona.regla;
    if (!r) return 'esa zona no tiene reglas en la tabla del proyecto';
    if (r.edificable === 'no') return 'aquí no se puede construir';
    if (r.edificable === 'condicionado') return 'lo que se puede construir depende del plan específico o de la zona vecina: consúltalo en la municipalidad';
    if (typeof r.pisos_base !== 'number') return 'se puede construir; la altura la fija el reglamento';
    const masAlto = typeof r.pisos_max === 'number' && r.pisos_max > r.pisos_base;
    const cuando = /multifamiliar/i.test(r.nota || '') ? 'si es multifamiliar' : 'en el caso máximo del reglamento';
    return `puedes construir hasta ${r.pisos_base} pisos${masAlto ? ` (${r.pisos_max} ${cuando})` : ''}`;
  }

  function dondeEstas({ distrito, zona }) {
    const lugar = distrito ? `Estás en ${D().titulo(distrito)}` : 'Estás en este punto';
    if (!zona) return `${lugar}, fuera del área zonificada del plano.`;
    const nombre = zona.regla ? ` (${minuscula(zona.regla.nombre)})` : '';
    return `${lugar}, zona ${zona.codigo}${nombre}: ${queConstruir(zona)}.`;
  }

  /** Los servicios como lista de { nombre, r } en el orden de la ficha. */
  function servicios(e) {
    const niveles = [['inicial', 'colegio inicial'], ['primaria', 'colegio de primaria'], ['secundaria', 'colegio de secundaria']];
    return {
      salud: { nombre: 'posta', r: e.salud },
      niveles: niveles.map(([k, nombre]) => ({ nombre, r: e.educacion[k] })),
      transporte: { nombre: 'paradero', r: e.transporte },
      areaVerde: { nombre: 'parque', r: e.areaVerde },
    };
  }

  const cumple = (r) => r && r.estado === 'CUMPLE' && typeof r.distanciaM === 'number';
  const sinDato = (r) => !r || r.estado === 'SIN DATO' || r.error;

  /**
   * El resumen de un punto. `entorno` es el resultado de Equipamiento.evaluar; `cauce`, el de Contexto.quebradas; `zona`, el de
   * Zonificacion.lookup (o null fuera del plano).
   */
  function punto({ distrito = null, zona = null, entorno, cauce = null }) {
    const s = servicios(entorno);
    const cerca = [];
    const lejos = [];
    const faltan = [];
    const clasificar = (item, etiquetaCerca = item.nombre) => {
      if (sinDato(item.r)) faltan.push(item.nombre);
      else if (cumple(item.r)) cerca.push(item);
      else if (item.r.distanciaM === null) lejos.push(`${item.nombre} (ninguno en los datos cercanos, ref. ${fmtRef(item.r.umbralM)})`);
      else lejos.push(`${etiquetaCerca} (${fmt(item.r.distanciaM)}, ref. ${fmtRef(item.r.umbralM)})`);
    };
    clasificar(s.salud);
    const colegiosCerca = [];
    s.niveles.forEach((n) => {
      if (sinDato(n.r)) faltan.push(n.nombre);
      else if (cumple(n.r)) colegiosCerca.push(n);
      else if (n.r.distanciaM === null) lejos.push(`${n.nombre} (ninguno en los datos cercanos, ref. ${fmtRef(n.r.umbralM)})`);
      else lejos.push(`${n.nombre} (${fmt(n.r.distanciaM)}, ref. ${fmtRef(n.r.umbralM)})`);
    });
    clasificar(s.transporte);
    clasificar(s.areaVerde);

    const partesCerca = [];
    if (cumple(s.salud.r)) partesCerca.push(`${s.salud.nombre} a ${fmt(s.salud.r.distanciaM)} ✓`);
    if (colegiosCerca.length === 3) partesCerca.push('colegios de los 3 niveles ✓');
    else colegiosCerca.forEach((c) => partesCerca.push(`${c.nombre} ✓`));
    [s.transporte, s.areaVerde].forEach((i) => { if (cumple(i.r)) partesCerca.push(`${i.nombre} a ${fmt(i.r.distanciaM)} ✓`); });

    const l0 = dondeEstas({ distrito, zona });
    const l1 = partesCerca.length ? `Cerca tienes: ${partesCerca.join(', ')}.` : 'No tienes ninguno de los servicios a la distancia de referencia.';
    const partes2 = [];
    if (lejos.length) partes2.push(`Más lejos de lo recomendado: ${lejos.join(', ')}.`);
    if (faltan.length) partes2.push(`Sin dato de: ${lista(faltan)}; eso no significa que no existan.`);
    if (cauce && typeof cauce.distanciaM === 'number' && cauce.nombre) partes2.push(`Lo más cercano en riesgo: ${cauce.nombre} a ${fmt(cauce.distanciaM)}.`);
    const l2 = partes2.join(' ');
    const lineas = [l0, l1, l2].filter(Boolean);
    return { texto: lineas.join(' '), lineas, aviso: AVISO };
  }

  /** Los trámites que conviene comprobar antes de comprar, en texto para el chat. */
  function verificar(items) {
    return ['Antes de comprar, verifica por tu cuenta:', ...(items || []).map((i) => `• ${i.titulo} (${i.entidad})`), 'GeoVerificador es referencial y no reemplaza ninguno de estos trámites.'].join('\n');
  }

  return { punto, verificar, fmt, AVISO };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Resumen;
