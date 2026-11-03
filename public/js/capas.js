/**
 * capas.js — Qué se dibuja en el mapa (sin DOM, sin red): las entidades reales, no una cuadrícula.
 *
 * Cada cosa que la persona pide tiene su propia forma en el mapa:
 *   colegios    → los colegios mismos, con un icono por nivel (y un círculo tenue con la distancia de referencia si son pocos)
 *   salud       → los establecimientos de salud (círculo de 1000 m si son pocos)
 *   paraderos   → los paraderos (círculo de 400 m si son pocos)
 *   parques     → los parques, como polígonos rellenos
 *   residencial, tranquilo, campina, comercial, historico → solo los polígonos de esas zonas del plano
 *   quebradas   → líneas (red hidrográfica de la ANA)
 *   sismos      → círculos pequeños, más grandes cuanto mayor la magnitud
 * Con una búsqueda se dibujan las entidades que hacen que cada sector cumpla, y UNA región resaltada: los sectores donde se
 * cumple todo lo que pidió. No se pinta lo que no cumple y no se ve la cuadrícula.
 *
 * Se carga como script del navegador (define `Capas`) y también como módulo CommonJS para las pruebas.
 */
const Capas = (() => {
  const A = () => (typeof Asistente !== 'undefined' ? Asistente : require('./asistente.js')); // eslint-disable-line no-undef
  const E = () => (typeof Entidades !== 'undefined' ? Entidades : require('./entidades.js')); // eslint-disable-line no-undef
  const C = typeof Calculos !== 'undefined' ? Calculos : require('./calculos.js'); // eslint-disable-line no-undef
  const M_POR_GRADO = (Math.PI / 180) * C.RADIO_TIERRA_M;
  const NIVELES = ['inicial', 'primaria', 'secundaria'];

  /** Las capas que se pueden pedir, en el orden en que se ofrecen. */
  const CAPAS = [
    { id: 'colegios', etiqueta: 'Colegios', grupo: 'servicio' },
    { id: 'salud', etiqueta: 'Salud', grupo: 'servicio' },
    { id: 'paraderos', etiqueta: 'Paraderos', grupo: 'servicio' },
    { id: 'parques', etiqueta: 'Parques', grupo: 'servicio' },
    { id: 'residencial', etiqueta: 'Zona residencial', grupo: 'zona' },
    { id: 'tranquilo', etiqueta: 'Zona tranquila', grupo: 'zona' },
    { id: 'campina', etiqueta: 'Campiña', grupo: 'zona' },
    { id: 'comercial', etiqueta: 'Zona comercial', grupo: 'zona' },
    { id: 'historico', etiqueta: 'Centro histórico', grupo: 'zona' },
    { id: 'quebradas', etiqueta: 'Quebradas y ríos', grupo: 'riesgo' },
    { id: 'sismos', etiqueta: 'Sismos', grupo: 'riesgo' },
  ];
  const ZONAS = ['residencial', 'tranquilo', 'campina', 'comercial', 'historico'];

  // ----------------------------------------------------------- Criterios → capas

  /**
   * Traduce los criterios de una búsqueda (o del conteo) a capas. Los de colegio se juntan en una sola capa con sus niveles
   * («colegio» a secas son inicial y primaria, como en la búsqueda). Conserva las distancias ya resueltas si vienen.
   */
  function deCriterios(criterios) {
    const out = [];
    const capa = (id) => {
      let c = out.find((x) => x.id === id);
      if (!c) { c = { id }; out.push(c); }
      return c;
    };
    (criterios || []).forEach((c) => {
      if (NIVELES.includes(c.id) || c.id === 'colegio') {
        const k = capa('colegios');
        const niveles = c.id === 'colegio' ? ['inicial', 'primaria'] : [c.id];
        k.niveles = NIVELES.filter((n) => (k.niveles || []).includes(n) || niveles.includes(n));
        k.umbralPorNivel = { ...(k.umbralPorNivel || {}), ...(c.umbralPorNivel || {}) };
        if (!c.umbralPorNivel && typeof c.umbralEfectivoM === 'number') niveles.forEach((n) => { k.umbralPorNivel[n] = c.umbralEfectivoM; });
      } else if (c.id === 'salud') capa('salud').umbralM = c.umbralEfectivoM;
      else if (c.id === 'transporte') capa('paraderos').umbralM = c.umbralEfectivoM;
      else if (c.id === 'areaVerde') capa('parques').umbralM = c.umbralEfectivoM;
      else if (ZONAS.includes(c.id)) capa(c.id).umbralM = c.umbralEfectivoM;
      else if (c.id === 'lejosQuebrada') capa('quebradas').umbralM = c.umbralM;
    });
    return out;
  }

  // ------------------------------------------------------------------- Auxiliares

  const listaEs = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);

  const bboxDe = (puntos) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    puntos.forEach(([x, y]) => {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    });
    return b;
  };
  const bboxDePolys = (polys) => bboxDe(polys.flatMap((anillos) => anillos[0] || []));
  const unir = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  const valido = (b) => Array.isArray(b) && b[0] !== Infinity;
  const coordsDe = (geometry) => {
    if (!geometry) return [];
    const g = geometry.type;
    if (g === 'Polygon') return geometry.coordinates[0] || [];
    if (g === 'MultiPolygon') return geometry.coordinates.flatMap((p) => p[0] || []);
    if (g === 'LineString') return geometry.coordinates;
    if (g === 'MultiLineString') return geometry.coordinates.flat();
    return [];
  };

  /** Radio en píxeles de un círculo de sismo: crece con la magnitud, entre 3 y 16. */
  function sismoRadioPx(magnitud) {
    return Math.round(Math.min(16, Math.max(3, 3 + (magnitud - 2) * 2.4)));
  }

  const cercaDe = (centros, lat, lon, u) => {
    for (const [la, lo] of centros) {
      if (Math.abs(la - lat) * M_POR_GRADO > u) continue;
      if (C.haversine(lat, lon, la, lo) <= u) return true;
    }
    return false;
  };

  const tituloColegio = (c) => c.nombre || 'Colegio sin nombre en OpenStreetMap';
  const NOMBRE_NIVEL = { inicial: 'inicial', primaria: 'primaria', secundaria: 'secundaria' };

  // -------------------------------------------------------------------- Construir

  /**
   * Arma lo que hay que dibujar.
   *   capas:    [{ id, niveles?, umbralM?, umbralPorNivel? }] (ver deCriterios)
   *   datos:    Asistente.prepararDatos; zonas: Zonificacion.zonas(); cauces: [{ nombre, tipo, geometry }] o null; sismos: [{ lat, lon, magnitud, … }] o null
   *   area:     { polys } (un distrito), { bbox } o null (todo el mapa)
   *   sectores: los de Asistente.formatearBusqueda (con `centros`); si hay, solo se dibujan las entidades que los hacen cumplir
   * Devuelve { puntos, circulos, poligonos, lineas, sismos, sectores, leyenda, vacias, sinDatos, resumen, limites }.
   */
  function construir({ capas, datos, zonas, cauces, sismos, area = null, umbrales, sectores = null, maxCirculos = 12 }) {
    const polys = area && area.polys ? area.polys : null;
    const cajaArea = polys ? bboxDePolys(polys) : area && area.bbox ? area.bbox : null;
    const dentroPoligonos = polys ? E().contenedor(polys) : null;
    const enArea = (lat, lon) => {
      if (dentroPoligonos) return dentroPoligonos(lat, lon);
      if (cajaArea) return lon >= cajaArea[0] && lon <= cajaArea[2] && lat >= cajaArea[1] && lat <= cajaArea[3];
      return true;
    };
    const centros = sectores && sectores.length ? sectores.flatMap((s) => s.centros || [[s.centro.lat, s.centro.lon]]) : null;
    const cajaCentros = centros ? bboxDe(centros.map(([la, lo]) => [lo, la])) : null;
    const u = umbrales;

    const puntos = [];
    const circulos = [];
    const poligonos = [];
    const lineas = [];
    const sism = [];
    const leyenda = [];
    const vacias = [];
    const sinDatos = [];
    let limites = null;

    // Cómo se nombra cada capa en el resumen: [singular, plural].
    const NOMBRES = {
      colegios: ['colegio', 'colegios'], salud: ['establecimiento de salud', 'establecimientos de salud'], paraderos: ['paradero', 'paraderos'], parques: ['parque', 'parques'],
      residencial: ['zona residencial', 'zonas residenciales'], tranquilo: ['zona tranquila', 'zonas tranquilas'], campina: ['zona de campiña', 'zonas de campiña'],
      comercial: ['zona comercial', 'zonas comerciales'], historico: ['zona del centro histórico', 'zonas del centro histórico'],
      quebradas: ['tramo de quebrada o río', 'tramos de quebradas y ríos'], sismos: ['sismo', 'sismos'], sectores: ['sector', 'sectores'],
    };
    const nombreDe = (capa, n) => NOMBRES[capa][n === 1 ? 0 : 1];
    const cuenta = (capa, n, texto) => {
      if (n === 0) { vacias.push(capa); return; }
      leyenda.push({ capa, texto, n });
    };

    (capas || []).forEach((capa) => {
      const id = capa.id;
      if (id === 'colegios') {
        const niveles = capa.niveles && capa.niveles.length ? capa.niveles : NIVELES;
        const umbralDe = (n) => (capa.umbralPorNivel && typeof capa.umbralPorNivel[n] === 'number' ? capa.umbralPorNivel[n] : u.educacion[n]);
        const elegidos = (datos.colegiosLista || []).filter((c) => {
          const propios = c.niveles.filter((n) => niveles.includes(n));
          if (propios.length === 0 || !enArea(c.lat, c.lon)) return false;
          return !centros || propios.some((n) => cercaDe(centros, c.lat, c.lon, umbralDe(n)));
        });
        elegidos.forEach((c) => {
          const propios = c.niveles.filter((n) => niveles.includes(n));
          const subtipo = propios.length === 1 ? propios[0] : propios[0];
          puntos.push({
            capa: 'colegios', tipo: 'colegio', subtipo, niveles: propios, lat: c.lat, lon: c.lon, nombre: c.nombre, osm: c.osm,
            titulo: tituloColegio(c), detalle: `Colegio de ${propios.map((n) => NOMBRE_NIVEL[n]).join(' y ')}`, radioM: umbralDe(subtipo),
          });
        });
        cuenta('colegios', elegidos.length, `Colegios (${niveles.join(', ')}): ${elegidos.length}`);
      } else if (id === 'salud' || id === 'paraderos') {
        const lista = id === 'salud' ? datos.salud : datos.transporte;
        const umbral = typeof capa.umbralM === 'number' ? capa.umbralM : id === 'salud' ? u.salud : u.transporte;
        const elegidos = (lista || []).filter((p) => enArea(p.lat, p.lon) && (!centros || cercaDe(centros, p.lat, p.lon, umbral)));
        elegidos.forEach((p) => puntos.push({
          capa: id, tipo: id === 'salud' ? 'salud' : 'paradero', subtipo: id, lat: p.lat, lon: p.lon, nombre: p.nombre, osm: p.osm,
          titulo: p.nombre || (id === 'salud' ? 'Establecimiento de salud sin nombre en OpenStreetMap' : 'Paradero'), detalle: id === 'salud' ? 'Establecimiento de salud' : 'Paradero de transporte público', radioM: umbral,
        }));
        cuenta(id, elegidos.length, `${id === 'salud' ? 'Establecimientos de salud' : 'Paraderos'}: ${elegidos.length}`);
      } else if (id === 'parques') {
        const umbral = typeof capa.umbralM === 'number' ? capa.umbralM : u.areaVerde.distanciaM;
        const elegidos = (datos.verdes || []).filter((v) => {
          if (!v.centro || !enArea(v.centro.lat, v.centro.lon)) return false;
          if (!centros) return true;
          return centros.some(([la, lo]) => {
            const b = v.bbox;
            const m = umbral / M_POR_GRADO;
            if (la < b[1] - m || la > b[3] + m || lo < b[0] - m * 1.1 || lo > b[2] + m * 1.1) return false;
            return C.distanciaAGeometriaM(la, lo, v.geometry) <= umbral;
          });
        });
        elegidos.forEach((v) => poligonos.push({
          capa: 'parques', geometry: v.geometry, nombre: v.nombre, osm: v.osm, areaM2: v.areaM2,
          titulo: v.nombre || 'Parque sin nombre en OpenStreetMap', detalle: `Parque de ${Math.round(v.areaM2 / 100) / 100} ha`,
        }));
        cuenta('parques', elegidos.length, `Parques de media hectárea o más: ${elegidos.length}`);
      } else if (ZONAS.includes(id)) {
        const def = A().CRITERIOS[id];
        const dentro = (z) => {
          const caja = z.bbox;
          if (cajaArea && (caja[2] < cajaArea[0] || caja[0] > cajaArea[2] || caja[3] < cajaArea[1] || caja[1] > cajaArea[3])) return false;
          if (cajaCentros && (caja[2] < cajaCentros[0] - 0.02 || caja[0] > cajaCentros[2] + 0.02 || caja[3] < cajaCentros[1] - 0.02 || caja[1] > cajaCentros[3] + 0.02)) return false;
          if (!dentroPoligonos) return true;
          const anillo = (z.polys[0] && z.polys[0][0]) || [];
          const pasos = Math.max(1, Math.floor(anillo.length / 12));
          const muestras = [[(caja[0] + caja[2]) / 2, (caja[1] + caja[3]) / 2]];
          for (let k = 0; k < anillo.length; k += pasos) muestras.push(anillo[k]);
          return muestras.some(([x, y]) => dentroPoligonos(y, x));
        };
        const elegidas = (zonas || []).filter((z) => z.regla && z.bbox && ((def.codigos && def.codigos.includes(z.codigo)) || (def.grupos && def.grupos.includes(z.regla.grupo))) && dentro(z));
        elegidas.forEach((z) => poligonos.push({
          capa: id, codigo: z.codigo, geometry: { type: 'MultiPolygon', coordinates: z.polys }, nombre: z.regla.nombre, titulo: `Zona ${z.codigo}`, detalle: z.regla.nombre,
        }));
        cuenta(id, elegidas.length, `${def.etiqueta.split(' (')[0]}: ${elegidas.length} ${elegidas.length === 1 ? 'zona' : 'zonas'} del plano`);
      } else if (id === 'quebradas') {
        if (!Array.isArray(cauces) || cauces.length === 0) { sinDatos.push('quebradas'); return; }
        const elegidos = cauces.filter((q) => coordsDe(q.geometry).some(([x, y]) => enArea(y, x)));
        elegidos.forEach((q) => lineas.push({ capa: 'quebradas', geometry: q.geometry, nombre: q.nombre, tipo: q.tipo, titulo: q.nombre || 'Cauce sin nombre', detalle: q.tipo || 'Red hidrográfica de la ANA' }));
        cuenta('quebradas', elegidos.length, `Quebradas y ríos (red de la ANA): ${elegidos.length} ${elegidos.length === 1 ? 'tramo' : 'tramos'}`);
      } else if (id === 'sismos') {
        if (!Array.isArray(sismos)) { sinDatos.push('sismos'); return; }
        sismos.forEach((s) => sism.push({ ...s, radioPx: sismoRadioPx(s.magnitud) }));
        cuenta('sismos', sism.length, `Sismos reportados por el IGP (cuanto mayor la magnitud, más grande el círculo): ${sism.length}`);
      }
    });

    if (puntos.length > 0 && puntos.length <= maxCirculos) {
      puntos.forEach((p) => { if (p.radioM) circulos.push({ capa: p.capa, lat: p.lat, lon: p.lon, radioM: p.radioM, nivel: p.tipo === 'colegio' ? p.subtipo : null }); });
    }

    const regiones = (sectores || []).map((s) => ({ n: s.n, centro: s.centro, hectareas: s.hectareas, distrito: s.distrito, nombre: s.nombre || null, contorno: s.contorno }));
    if (regiones.length > 0) leyenda.push({ capa: 'sectores', texto: `Sectores donde se cumple todo lo que pediste: ${regiones.length}`, n: regiones.length });

    // Encuadre: los sectores si los hay; si no, el área (distrito); si no, lo que se dibujó.
    if (regiones.length > 0) {
      limites = bboxDe(regiones.flatMap((s) => s.contorno.flatMap((a) => a)));
      limites = unir(limites, bboxDe(puntos.map((p) => [p.lon, p.lat])));
    } else if (cajaArea) limites = cajaArea;
    else {
      const todos = [...puntos.map((p) => [p.lon, p.lat]), ...poligonos.flatMap((p) => coordsDe(p.geometry))];
      limites = todos.length ? bboxDe(todos) : null;
    }
    if (limites && !valido(limites)) limites = null;

    const resumen = !leyenda.length && !vacias.length && !sinDatos.length
      ? (cajaArea ? 'Marqué el distrito en el mapa. Elige arriba qué quieres ver dentro de él.' : '')
      : vacias.length && !leyenda.length
      ? `En esta zona no hay ${vacias.map((v) => ({ colegios: 'colegios', salud: 'establecimientos de salud', paraderos: 'paraderos', parques: 'parques' }[v] || v)).join(' ni ')} en los datos.`
      : `Muestro ${listaEs(leyenda.map((l) => `${l.n} ${nombreDe(l.capa, l.n)}`))}.${vacias.length ? ` No hay ${listaEs(vacias.map((v) => nombreDe(v, 2)))} en esta zona.` : ''}`;
    return { puntos, circulos, poligonos, lineas, sismos: sism, sectores: regiones, leyenda, vacias, sinDatos, resumen, limites };
  }

  /** Los sismos del archivo GeoJSON del IGP como lista simple { lat, lon, magnitud, fecha, profundidadKm, ref }; ignora lo que no es un punto con magnitud. */
  function sismosDeFeatures(features) {
    return (features || [])
      .filter((f) => f && f.geometry && f.geometry.type === 'Point' && f.properties && typeof f.properties.magnitud === 'number')
      .map((f) => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], magnitud: f.properties.magnitud, fecha: f.properties.fecha || null, profundidadKm: f.properties.profundidadKm ?? null, ref: f.properties.ref || null }));
  }

  return { CAPAS, ZONAS, NIVELES, deCriterios, construir, sismoRadioPx, sismosDeFeatures };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Capas;
