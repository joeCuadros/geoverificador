/**
 * volcan.js — Peligro volcánico del Misti para un punto o un distrito (sin DOM, sin red).
 *
 * Trabaja con el archivo congelado public/data/peligro_volcanico_misti.geojson (zonas del IGP, ver
 * scripts/descargar-peligro-volcanico.mjs). Es INFORMATIVO: dice en qué zonas del mapa cae el punto, nunca «cumple» ni
 * «no cumple» y nunca un puntaje. Un mapa de peligros es de escala regional: cerca de un borde, la zona no es exacta.
 *
 *   indexar(features)                       → zonas listas para consultar (con su caja)
 *   enZonas(lat, lon, zonas)                → [{ tipo, nivel, capa, escenario, detalle, etiqueta }] una por polígono que contiene el punto
 *   resumirPunto(lista)                     → [{ tipo, nivel, escenarios, capas, detalle }] el nivel más alto de cada fenómeno
 *   frasePunto(resumen)                     → «Tu punto está en zona de peligro bajo por lahares del Misti, según el IGP.»
 *   porDistrito(zonas, polys, { pasoM })    → { muestras, porTipo: { lahar: { alto, moderado, bajo, ninguno } } } en % del área
 *   fraseDistrito(titulo, r)                → frase con la parte del distrito en cada nivel
 *   leyenda(zonas, { tipos })               → una línea por nivel con los fenómenos que se dibujan
 *
 * Se carga como script del navegador (define `Volcan`) y también como módulo CommonJS para las pruebas.
 */
const Volcan = (() => {
  const C = typeof Calculos !== 'undefined' ? Calculos : require('./calculos.js'); // eslint-disable-line no-undef
  const M_POR_GRADO = (Math.PI / 180) * C.RADIO_TIERRA_M;

  /** Los fenómenos, en el orden en que se dicen. `mapa`: si se dibuja (la ceniza cubre toda la ciudad: no se dibuja). */
  const TIPOS = {
    lahar: { plural: 'lahares', orden: 1, mapa: true },
    flujo_piroclastico: { plural: 'flujos piroclásticos', orden: 2, mapa: true },
    lava: { plural: 'flujos de lava', orden: 3, mapa: true },
    avalancha: { plural: 'avalanchas de escombros', orden: 4, mapa: true },
    ceniza: { plural: 'ceniza volcánica', orden: 5, mapa: false },
  };
  const NIVELES = ['bajo', 'moderado', 'alto']; // de menor a mayor
  const RANGO = { bajo: 1, moderado: 2, alto: 3 };
  const NIVEL_TEXTO = { bajo: 'bajo', moderado: 'moderado', alto: 'alto' };

  const lista = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);
  const nombreTipo = (t) => (TIPOS[t] ? TIPOS[t].plural : String(t));
  const pct = (n) => (n > 0 && n < 1 ? 'menos del 1 %' : `${Math.round(n)} %`);

  /** Caja [oeste, sur, este, norte] de una geometría Polygon o MultiPolygon. */
  function cajaDe(geometry) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    const polis = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
    polis.forEach((anillos) => (anillos[0] || []).forEach(([x, y]) => {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }));
    return b;
  }

  /** Deja solo los polígonos con tipo y nivel conocidos y les calcula la caja una sola vez. */
  function indexar(features) {
    return (features || [])
      .filter((f) => f && f.geometry && /Polygon/.test(f.geometry.type) && f.properties && TIPOS[f.properties.tipo] && RANGO[f.properties.nivel])
      .map((f) => ({
        tipo: f.properties.tipo,
        nivel: f.properties.nivel,
        etiqueta: f.properties.etiqueta || null,
        escenario: f.properties.escenario || null,
        detalle: f.properties.detalle || null,
        deposito: f.properties.deposito || null,
        capa: f.properties.capa || null,
        geometry: f.geometry,
        bbox: cajaDe(f.geometry),
      }));
  }

  const polisDe = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

  /** ¿El punto cae dentro del polígono (un MultiPolygon cuenta si cae en alguna de sus partes; los huecos quedan fuera)? */
  function contiene(zona, lat, lon) {
    const b = zona.bbox;
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) return false;
    return polisDe(zona.geometry).some((anillos) => C.puntoEnPoligono(lat, lon, anillos));
  }

  /** Todas las zonas que contienen el punto: cada una con su fenómeno (`tipo`) y su nivel (alto, moderado o bajo). */
  function enZonas(lat, lon, zonas) {
    return (zonas || []).filter((z) => contiene(z, lat, lon)).map((z) => ({ tipo: z.tipo, nivel: z.nivel, etiqueta: z.etiqueta, escenario: z.escenario, detalle: z.detalle, deposito: z.deposito, capa: z.capa }));
  }

  /** El nivel más alto de cada fenómeno, con los escenarios y las capas que lo dicen. En el orden de TIPOS. */
  function resumirPunto(items) {
    const por = new Map();
    for (const it of items || []) {
      const p = por.get(it.tipo) || { tipo: it.tipo, nivel: it.nivel, escenarios: [], capas: [], detalle: null, detalles: [] };
      if (RANGO[it.nivel] > RANGO[p.nivel]) { p.nivel = it.nivel; p.detalle = null; }
      if (RANGO[it.nivel] === RANGO[p.nivel] && it.detalle && !p.detalle) p.detalle = it.detalle;
      if (it.escenario && !p.escenarios.includes(it.escenario)) p.escenarios.push(it.escenario);
      if (it.capa && !p.capas.includes(it.capa)) p.capas.push(it.capa);
      p.detalles.push({ nivel: it.nivel, escenario: it.escenario, detalle: it.detalle, deposito: it.deposito || null });
      por.set(it.tipo, p);
    }
    return [...por.values()].sort((a, b) => TIPOS[a.tipo].orden - TIPOS[b.tipo].orden);
  }

  /**
   * «Tu punto está en zona de peligro alto por ceniza volcánica y bajo por lahares del Misti, según el IGP.» Agrupa por nivel,
   * del más alto al más bajo. Sin zonas: lo dice, sin afirmar que no haya peligro.
   */
  function frasePunto(resumen, { sujeto = 'Tu punto', tipos = [] } = {}) {
    if (!resumen || resumen.length === 0) {
      const de = tipos.length ? `zona de ${lista(tipos.map(nombreTipo))}` : 'zona de peligro volcánico';
      return `${sujeto} no cae dentro de ninguna ${de} del Misti que mapeó el IGP. Eso no significa que no haya peligro.`;
    }
    // The IGP ash layers do not state which volcano they model, so ash is never attributed to the Misti.
    const CENIZA = 'ceniza volcánica (según el escenario de erupción)';
    const AVISO_CENIZA = 'la capa de ceniza no indica de qué volcán es.';
    const partesDe = (filas, etiqueta) => {
      const partes = [];
      for (const nivel of [...NIVELES].reverse()) {
        const tipos = filas.filter((r) => r.nivel === nivel).map(etiqueta);
        if (tipos.length) partes.push(`${NIVEL_TEXTO[nivel]} por ${lista(tipos)}`);
      }
      return partes;
    };
    const misti = partesDe(resumen.filter((r) => r.tipo !== 'ceniza'), (r) => nombreTipo(r.tipo));
    const ceniza = partesDe(resumen.filter((r) => r.tipo === 'ceniza'), () => CENIZA);
    if (misti.length === 0) return `${sujeto} está en zona de peligro ${lista(ceniza)}, según el IGP; ${AVISO_CENIZA}`;
    const frase = `${sujeto} está en zona de peligro ${lista(misti)} del Misti, según el IGP.`;
    return ceniza.length ? `${frase} También está en zona de peligro ${lista(ceniza)}; ${AVISO_CENIZA}` : frase;
  }

  /**
   * Una línea por fenómeno para la ficha, el informe y el chat: «Lahares: peligro moderado.»; la ceniza dice el nivel de cada
   * escenario de erupción con el espesor del depósito: «Ceniza volcánica: peligro alto (erupción vulcaniana: alto, ≤ 5 cm; …)».
   */
  function lineasPunto(resumen) {
    return (resumen || []).map((r) => {
      let texto = `${nombreTipo(r.tipo).charAt(0).toUpperCase()}${nombreTipo(r.tipo).slice(1)}: peligro ${NIVEL_TEXTO[r.nivel]}`;
      if (r.tipo === 'ceniza') {
        const porEscenario = new Map();
        for (const d of r.detalles) {
          const previo = porEscenario.get(d.escenario);
          if (!previo || RANGO[d.nivel] > RANGO[previo.nivel]) porEscenario.set(d.escenario, d);
        }
        const partes = [...porEscenario].map(([esc, d]) => `erupción ${esc}: ${NIVEL_TEXTO[d.nivel]}${d.deposito ? `, depósito ${d.deposito}` : ''}`);
        if (partes.length) texto += ` (${partes.join('; ')})`;
      } else if (r.detalle) texto += ` (${r.detalle.charAt(0).toLowerCase()}${r.detalle.slice(1).replace(/(\d)\.(\d)/g, '$1,$2')})`;
      return { tipo: r.tipo, nivel: r.nivel, texto: `${texto}.` };
    });
  }

  /**
   * Qué parte del distrito cae en cada nivel de cada fenómeno. Se prueba un punto cada `pasoM` metros dentro del distrito y,
   * por fenómeno, se cuenta el nivel más alto de ese punto. Es una muestra, no un cálculo exacto de áreas: el resultado se
   * da en porcentaje redondeado.
   *   polys: los polígonos del distrito como Distritos.poligonos (lista de polígonos con sus anillos [lon, lat]).
   */
  function porDistrito(zonas, polys, { pasoM = 250 } = {}) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    (polys || []).forEach((anillos) => (anillos[0] || []).forEach(([x, y]) => {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }));
    const tipos = [...new Set((zonas || []).map((z) => z.tipo))].sort((x, y) => TIPOS[x].orden - TIPOS[y].orden);
    if (b[0] === Infinity || tipos.length === 0) return { muestras: 0, porTipo: {}, tipos };
    const cuentas = Object.fromEntries(tipos.map((t) => [t, { alto: 0, moderado: 0, bajo: 0, ninguno: 0 }]));
    const dLat = pasoM / M_POR_GRADO;
    let muestras = 0;
    for (let lat = b[1] + dLat / 2; lat < b[3]; lat += dLat) {
      const dLon = pasoM / (M_POR_GRADO * Math.cos((lat * Math.PI) / 180));
      for (let lon = b[0] + dLon / 2; lon < b[2]; lon += dLon) {
        if (!polys.some((anillos) => C.puntoEnPoligono(lat, lon, anillos))) continue;
        muestras += 1;
        const mejor = {};
        for (const z of zonas) {
          if (mejor[z.tipo] === 'alto') continue;
          if (contiene(z, lat, lon) && (!mejor[z.tipo] || RANGO[z.nivel] > RANGO[mejor[z.tipo]])) mejor[z.tipo] = z.nivel;
        }
        for (const t of tipos) cuentas[t][mejor[t] || 'ninguno'] += 1;
      }
    }
    const porTipo = {};
    for (const t of tipos) {
      porTipo[t] = Object.fromEntries(Object.entries(cuentas[t]).map(([k, n]) => [k, muestras ? (100 * n) / muestras : 0]));
    }
    return { muestras, porTipo, tipos };
  }

  /** «Lahares: 12 % en peligro alto, 20 % moderado y 8 % bajo»; solo los fenómenos y niveles que alcanzan el distrito. */
  function fraseDistrito(titulo, r, { tipos = [] } = {}) {
    if (!r || !r.muestras) return `No pude medir el peligro volcánico de ${titulo} con los datos del IGP.`;
    const lineas = [];
    const pedidos = tipos.length ? r.tipos.filter((t) => tipos.includes(t)) : r.tipos;
    for (const t of pedidos) {
      const p = r.porTipo[t];
      const niveles = [...NIVELES].reverse().filter((n) => p[n] > 0).map((n, i) => `${pct(p[n])} ${i === 0 ? 'en peligro ' : ''}${NIVEL_TEXTO[n]}`);
      if (niveles.length) lineas.push(`• ${nombreTipo(t).charAt(0).toUpperCase()}${nombreTipo(t).slice(1)}: ${lista(niveles)}.`);
    }
    if (lineas.length === 0) return `Ninguna parte de ${titulo} cae en las zonas de ${tipos.length ? lista(tipos.map(nombreTipo)) : 'peligro volcánico'} del Misti que mapeó el IGP. Eso no significa que no haya peligro.`;
    return [`Parte de ${titulo} en cada zona de peligro volcánico del Misti, según el IGP (muestra de ${r.muestras} puntos en el distrito):`, ...lineas].join('\n');
  }

  /** Los fenómenos que se pueden dibujar (la ceniza no: cubre toda la ciudad). */
  const dibujables = () => Object.keys(TIPOS).filter((t) => TIPOS[t].mapa);

  /**
   * Una línea por nivel con los fenómenos que se dibujan en ese nivel, del más alto al más bajo.
   * `tipos`: cuáles se piden (por defecto todos los dibujables). Devuelve [{ nivel, texto, tipos }].
   */
  function leyenda(zonas, { tipos = null } = {}) {
    const pedidos = (tipos && tipos.length ? tipos : dibujables()).filter((t) => TIPOS[t] && TIPOS[t].mapa);
    const filas = [];
    for (const nivel of [...NIVELES].reverse()) {
      const hay = pedidos.filter((t) => (zonas || []).some((z) => z.tipo === t && z.nivel === nivel));
      if (hay.length) filas.push({ nivel, tipos: hay, texto: `Peligro ${NIVEL_TEXTO[nivel]}: ${lista(hay.map(nombreTipo))}` });
    }
    return filas;
  }

  return { TIPOS, NIVELES, indexar, enZonas, resumirPunto, frasePunto, lineasPunto, porDistrito, fraseDistrito, leyenda, dibujables, nombreTipo };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Volcan;
