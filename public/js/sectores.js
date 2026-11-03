/**
 * sectores.js — De celdas sueltas a sectores que una persona entiende.
 *
 * La búsqueda del asistente evalúa una cuadrícula de celdas de 250 m (asistente.js). Eso es un andamio interno: a la persona
 * no se le habla de celdas. Aquí las celdas que cumplen todo se juntan en SECTORES (zonas continuas), se les dibuja un
 * contorno suave y se les pone el nombre del elemento con nombre más cercano (un colegio, un parque, una posta), nunca un
 * nombre inventado. Sin DOM ni red.
 *
 *   agrupar(celdas, { pasoM })              → sectores [{ n, celdas, centro, hectareas, distrito, distritos }] del más grande al más chico
 *   contorno(celdas, { suavizar })          → anillos [lon, lat] del borde de la unión de celdas (los huecos son anillos aparte)
 *   nombrar(centro, datos, tipos, { maxM }) → { nombre, tipo, distanciaM } del elemento con nombre más cercano, o null
 *
 * Se carga como script del navegador (define `Sectores`) y también como módulo CommonJS para las pruebas.
 */
const Sectores = (() => {
  const C = typeof Calculos !== 'undefined' ? Calculos : require('./calculos.js'); // eslint-disable-line no-undef
  const M_POR_GRADO = (Math.PI / 180) * C.RADIO_TIERRA_M;
  const rad = (d) => (d * Math.PI) / 180;

  // ------------------------------------------------------------------ Agrupar

  /**
   * Junta las celdas que se tocan (también por una esquina). Cada celda trae sus índices `i`, `j` (Asistente.generarCeldas).
   * El sector 1 es el más extenso; el número solo sirve para ubicarlos, no es un orden de calidad.
   */
  function agrupar(celdas, { pasoM = 250 } = {}) {
    const lista = (celdas || []).filter((c) => Number.isInteger(c.i) && Number.isInteger(c.j));
    const porClave = new Map(lista.map((c) => [`${c.i},${c.j}`, c]));
    const visto = new Set();
    const grupos = [];
    lista.forEach((c) => {
      const k0 = `${c.i},${c.j}`;
      if (visto.has(k0)) return;
      const grupo = [];
      const pila = [c];
      visto.add(k0);
      while (pila.length) {
        const a = pila.pop();
        grupo.push(a);
        for (let di = -1; di <= 1; di += 1) {
          for (let dj = -1; dj <= 1; dj += 1) {
            const k = `${a.i + di},${a.j + dj}`;
            if ((di || dj) && porClave.has(k) && !visto.has(k)) { visto.add(k); pila.push(porClave.get(k)); }
          }
        }
      }
      grupos.push(grupo);
    });
    const haPorCelda = (pasoM / 100) ** 2;
    return grupos
      .map((g) => {
        const lat = g.reduce((s, x) => s + x.lat, 0) / g.length;
        const lon = g.reduce((s, x) => s + x.lon, 0) / g.length;
        const cercana = g.reduce((m, x) => (C.haversine(lat, lon, x.lat, x.lon) < C.haversine(lat, lon, m.lat, m.lon) ? x : m), g[0]);
        const distritos = {};
        g.forEach((x) => { if (x.distrito) distritos[x.distrito] = (distritos[x.distrito] || 0) + 1; });
        const principal = Object.entries(distritos).sort((a, b) => b[1] - a[1])[0];
        return {
          celdas: g,
          centro: { lat: cercana.lat, lon: cercana.lon, zona: cercana.zona || null },
          hectareas: g.length * haPorCelda,
          distrito: principal ? principal[0] : null,
          distritos,
        };
      })
      .sort((a, b) => b.celdas.length - a.celdas.length)
      .map((s, k) => ({ ...s, n: k + 1 }));
  }

  // ----------------------------------------------------------------- Contorno

  /** Corta las esquinas del anillo cerrado (Chaikin): redondea el contorno sin salirse de la caja del sector. */
  function suavizarAnillo(anillo, veces) {
    let pts = anillo.slice(0, -1);
    for (let v = 0; v < veces; v += 1) {
      const nuevo = [];
      pts.forEach((p, k) => {
        const q = pts[(k + 1) % pts.length];
        nuevo.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]], [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
      });
      pts = nuevo;
    }
    return [...pts, pts[0]];
  }

  /**
   * Borde de la unión de las celdas: cada celda aporta sus 4 aristas en sentido antihorario y las aristas compartidas se
   * anulan; las que quedan se encadenan en anillos. Cada anillo es una lista de [lon, lat] que repite el primer punto al final.
   * Un hueco dentro del sector sale como un anillo más.
   */
  function contorno(celdas, { suavizar = 2, pasoM = 250 } = {}) {
    const coord = new Map(); // «I,J» → [lon, lat]
    const aristas = new Map(); // «a|b» → [a, b]
    const poner = (a, b) => {
      const inversa = `${b}|${a}`;
      if (aristas.has(inversa)) aristas.delete(inversa);
      else aristas.set(`${a}|${b}`, [a, b]);
    };
    (celdas || []).forEach((c) => {
      const dLat = pasoM / M_POR_GRADO;
      const dLon = pasoM / (M_POR_GRADO * Math.cos(rad(c.lat)));
      const v = (I, J) => {
        const k = `${I},${J}`;
        if (!coord.has(k)) coord.set(k, [c.lon + (J - c.j - 0.5) * dLon, c.lat + (I - c.i - 0.5) * dLat]);
        return k;
      };
      const sw = v(c.i, c.j); const se = v(c.i, c.j + 1); const ne = v(c.i + 1, c.j + 1); const nw = v(c.i + 1, c.j);
      poner(sw, se); poner(se, ne); poner(ne, nw); poner(nw, sw);
    });
    const salen = new Map();
    aristas.forEach(([a, b]) => { if (!salen.has(a)) salen.set(a, []); salen.get(a).push(b); });
    const anillos = [];
    salen.forEach((_, inicio) => {
      while (salen.get(inicio) && salen.get(inicio).length) {
        const ruta = [inicio];
        let actual = inicio;
        for (;;) {
          const siguientes = salen.get(actual);
          if (!siguientes || siguientes.length === 0) break;
          actual = siguientes.pop();
          ruta.push(actual);
          if (actual === inicio) break;
        }
        if (ruta.length >= 4 && ruta[ruta.length - 1] === inicio) {
          const anillo = ruta.map((k) => coord.get(k));
          anillos.push(suavizar > 0 ? suavizarAnillo(anillo, suavizar) : anillo);
        }
      }
    });
    return anillos;
  }

  // ------------------------------------------------------------------- Nombrar

  const MAYUSCULAS = /^[^a-záéíóúñ]*$/;
  /** «COLEGIO NACIONAL SAN JOSE» → «Colegio Nacional San Jose»; lo que ya viene con minúsculas no se toca. */
  function nombreLegible(n) {
    const t = String(n).trim();
    if (!MAYUSCULAS.test(t) || t.length < 5) return t;
    return t.toLowerCase().replace(/(^|[\s.-])\S/g, (c) => c.toUpperCase()).replace(/\b(De|Del|La|Las|Los|Y)\b/g, (m, _x, pos) => (pos === 0 ? m : m.toLowerCase()));
  }

  // Qué tipo de entidad corresponde a cada criterio de la búsqueda.
  const TIPO_DE_CRITERIO = { inicial: 'colegio', primaria: 'colegio', secundaria: 'colegio', colegio: 'colegio', salud: 'salud', transporte: 'paradero', areaVerde: 'parque' };

  /**
   * Nombre de un sector: el elemento CON NOMBRE más cercano al punto representativo, dentro de `maxM` (500 m por defecto).
   * Si la persona pidió ciertos tipos (colegio, parque…), un elemento de esos tipos gana a uno más cercano de otro tipo.
   * Devuelve null si no hay nada con nombre cerca: el sector se queda sin nombre, no con uno inventado.
   *   datos: salida de Asistente.prepararDatos; criterios: ids de la búsqueda.
   */
  function nombrar(centro, datos, criterios = [], { maxM = 500 } = {}) {
    const candidatos = [];
    const punto = (lista, tipo) => (lista || []).forEach((p) => {
      if (p.nombre) candidatos.push({ nombre: nombreLegible(p.nombre), tipo, distanciaM: C.haversine(centro.lat, centro.lon, p.lat, p.lon) });
    });
    punto(datos.colegiosLista, 'colegio');
    punto(datos.salud, 'salud');
    punto(datos.transporte, 'paradero');
    (datos.verdesTodos || []).forEach((v) => {
      if (!v.nombre || !v.centro) return;
      candidatos.push({ nombre: nombreLegible(v.nombre), tipo: 'parque', distanciaM: C.distanciaAGeometriaM(centro.lat, centro.lon, v.geometry) });
    });
    const cerca = candidatos.filter((c) => c.distanciaM <= maxM).sort((a, b) => a.distanciaM - b.distanciaM);
    if (cerca.length === 0) return null;
    const pedidos = new Set((criterios || []).map((id) => TIPO_DE_CRITERIO[id]).filter(Boolean));
    return cerca.find((c) => pedidos.has(c.tipo)) || cerca[0];
  }

  return { agrupar, contorno, nombrar, nombreLegible, TIPO_DE_CRITERIO };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Sectores;
