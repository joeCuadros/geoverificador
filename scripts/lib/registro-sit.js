/**
 * registro-sit.js — Lógica pura (sin red ni archivos) detrás de scripts/extraer-registro-sit.mjs: el registro OFICIAL del Sistema Integrado de Transporte (SIT) de
 * Arequipa que publica la Municipalidad Provincial de Arequipa (MPA) en https://www.muniarequipa.gob.pe/sistema_transporte/ y su comparación con las rutas de
 * OpenStreetMap. La usan ese script, scripts/verificar-datos.mjs y test/registro-sit.spec.ts.
 *
 *   rutasPorUnidad(texto)     → { C2: ['A25', …] }  de la tabla «rutas que componen cada unidad de negocio» del anexo de las bases (2017)
 *   longitudesDeRutas(texto)  → { A25: { unidad, longitud_km, vehiculo } }  de la matriz de cada unidad
 *   armarUnidades(texto)      → [{ codigo, nombre, concesionario, claves, rutas: [{ codigo, longitud_km, vehiculo }] }]
 *   comparar(unidades, rutasOsm) → unidades con línea en OSM, empresa que etiqueta OSM frente al concesionario, ramales de OSM frente a rutas oficiales
 *
 * Qué es y qué no: es el registro de 2017 (bases de la tercera licitación de operación de rutas y contratos de concesión): unidades de negocio C-1A a C-11 con las
 * rutas (códigos A#, T#, BT#) que las componen. NO es la lista vigente: el Plan de Optimización de Rutas (Ordenanza N.° 1355-MPA, 26 de diciembre de 2024, 97 circuitos
 * según la prensa) reemplazó los recorridos, pero su texto y sus anexos no están publicados en el portal de la MPA ni en El Peruano (la ordenanza solo lo aprueba).
 * Los códigos A#/T# no son los nombres de ramal de OSM («Enace», «Cettar»): por eso las rutas se comparan por cantidad y la comparación fina se hace por unidad (C2 a C11).
 */
const { clavesEmpresa } = require('./paradas-osm.js');

/** Nombre de cada unidad de negocio, de la tabla «Unidad de Negocio / Código» del anexo de las bases (colores de buses). */
const NOMBRES = {
  C1A: 'Troncal 1', C1B: 'Troncal 2', C2: 'Cono Norte', C3: 'Cayma', C4: 'Alto Selva Alegre - Miraflores', C5: 'Mariano Melgar', C6: 'Paucarpata - Miguel Grau',
  C7: 'Paucarpata - Ciudad Blanca', C8: 'Sabandía', C9: 'Socabaya', C10: 'Hunter', C11: 'Pachacútec',
};

/**
 * Concesionario de cada unidad según los documentos que la MPA publica en la misma página (contratos de concesión y adendas). `claves` son las empresas del SIT
 * (clavesEmpresa) con las que se compara la etiqueta `operator` de OSM. C1B no tiene un concesionario identificado en esos documentos.
 */
const CONCESIONARIOS = {
  C1A: { nombre: 'Integra Arequipa S.A.C.', claves: ['integra'], documento: 'contratos/CONTRATO INTEGRA AREQUIPA SAC.pdf' },
  C2: { nombre: 'Empresa de Transportes Cono Norte S.A.C.', claves: ['conorte'], documento: 'contratos/EMPRESA DE TRANSPORTES CONO NORTE S.A.C. C-2.pdf' },
  C3: { nombre: 'Empresa de Transportes Transcayma S.A.', claves: ['transcayma'], documento: 'contratos/C3 CAYMA.pdf' },
  C4: { nombre: 'Empresa de Transportes Unión AQP S.A.', claves: ['unionaqp'], documento: 'contratos/EMPRESA DE TRANSPORTES UNION AQP S.A. C-4.pdf' },
  C5: { nombre: 'Empresa de Transportes Buses Mariano Melgar S.A. (ETRABUS S.A.)', claves: ['etrabus'], documento: 'contratos/C5 MARIANO MELGAR.pdf' },
  C6: { nombre: 'Empresa de Transportes Unión Grau S.A.C.', claves: ['uniongrau'], documento: 'contratos/EMPRESA DE TRANSPORTES UNION GRAU S.A.C. C-6.pdf' },
  C7: { nombre: 'Empresa de Transportes AQP Masivo Arequipa S.A.C.', claves: ['aqpmasivo'], documento: 'contratos/EMPRESA DE TRANSPORTES AQP MASIVO AREQUIPA S.A.C. C-7.pdf' },
  C8: { nombre: 'Empresa de Transportes Characato Sabandía C-8 S.A.', claves: ['characato'], documento: 'contratos/EMPRESA DE TRANSPORTES CHARACATO SABANDIA C-8 S.A.pdf' },
  C9: { nombre: 'Empresarios Arequipeños Emarsistran S.A.', claves: ['emarsistran'], documento: 'contratos/C9 SOCABAYA.pdf' },
  C10: { nombre: 'Empresa de Transportes Megabus AQP S.A.C.', claves: ['megabus'], documento: 'contratos/EMPRESA DE TRANSPORTES MEGABUS AQP S.A.C. C-10.pdf' },
  C11: { nombre: 'COTUM Express S.A.C. (contrato original: Gran Pachacútec S.A.C.)', claves: ['cotum'], documento: 'contratos/GRAN PACHACUTEC S.A.C C11.pdf; adendas/C11.pdf' },
};

const ORDEN = ['C1A', 'C1B', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11'];

/** La tabla «rutas que componen cada unidad de negocio»: filas «3 C2 A25 A27 A28». Sin tabla, {}. */
function rutasPorUnidad(texto) {
  const out = {};
  if (typeof texto !== 'string') return out;
  const a = texto.search(/RUTAS QUE COMPONEN CADA UNIDAD DE NEGOCIO/i);
  if (a < 0) return out;
  const trozo = texto.slice(a, a + 6000);
  for (const linea of trozo.split('\n')) {
    const m = /^\s*\d{1,2}\s+(C\d{1,2}[AB]?)\s+((?:(?:A|T|BT)\d{1,2}\s*)+)\s*$/.exec(linea);
    if (m) out[m[1]] = m[2].trim().split(/\s+/);
  }
  return out;
}

/** La matriz «UNIDAD DE NEGOCIO C2 …»: por ruta, longitud en km y tipo de vehículo. Lo que no se puede leer no se incluye. */
function longitudesDeRutas(texto) {
  const out = {};
  if (typeof texto !== 'string') return out;
  let unidad = null;
  for (const linea of texto.split('\n')) {
    const u = /UNIDAD DE NEGOCIO\s+(C\d{1,2}[AB]?)\b/.exec(linea);
    if (u) { unidad = u[1]; continue; }
    // Una fila solo vale si sus pasajeros por día (2.ª columna) vuelven a aparecer como «EMB-G» (11.ª): en algunas matrices el texto del PDF desalinea las filas
    // (C-8, C-10) y una longitud que no es de esa ruta sería un dato falso; esas filas se descartan.
    const m = /^\s*((?:A|T)\d{1,2})\s+([\d,]+)\s+[\d,]+\s+\d+\s+(Bus \d+)\s+[\d.]+\s+\d+\s+([\d.]+)\s+\d+\s+[\d,]+\s+[\d,]+\s+([\d,]+)(?:\s|$)/.exec(linea);
    if (m && unidad && m[2] === m[5]) out[m[1]] = { unidad, longitud_km: Number(m[4]), vehiculo: m[3] };
  }
  return out;
}

function armarUnidades(texto) {
  const lista = rutasPorUnidad(texto);
  const largos = longitudesDeRutas(texto);
  return ORDEN.filter((c) => lista[c]).map((codigo) => {
    const co = CONCESIONARIOS[codigo];
    return {
      codigo,
      nombre: NOMBRES[codigo],
      concesionario: co ? co.nombre : null,
      claves: co ? co.claves : [],
      documento: co ? co.documento : null,
      rutas: lista[codigo].map((r) => ({ codigo: r, longitud_km: largos[r] && largos[r].unidad === codigo ? largos[r].longitud_km : null, vehiculo: largos[r] && largos[r].unidad === codigo ? largos[r].vehiculo : null })),
    };
  });
}

/**
 * Compara las rutas de OSM (Features con properties { linea, operador, ramal }) con el registro.
 * Devuelve { unidades: { oficiales, enOsm, faltanEnOsm }, lineasOsmFueraDelRegistro, empresa: { C2: { rutasOsm, coincide, sinEmpresa }, total }, rutas: { C2: { oficiales, ramalesOsm } } }.
 */
function comparar(unidades, rutasOsm) {
  const rutas = (rutasOsm || []).map((f) => f.properties || f).filter((p) => p.tipo === undefined || p.tipo === 'ruta');
  const porLinea = new Map();
  rutas.forEach((p) => { if (!porLinea.has(p.linea)) porLinea.set(p.linea, []); porLinea.get(p.linea).push(p); });
  const codigos = new Set((unidades || []).map((u) => u.codigo));
  const enOsm = (unidades || []).filter((u) => porLinea.has(u.codigo));
  const out = {
    unidades: { oficiales: (unidades || []).length, enOsm: enOsm.length, faltanEnOsm: (unidades || []).filter((u) => !porLinea.has(u.codigo)).map((u) => u.codigo) },
    lineasOsmFueraDelRegistro: [...porLinea.keys()].filter((l) => !codigos.has(l)).sort(),
    empresa: {},
    rutas: {},
  };
  let total = 0;
  let coincide = 0;
  enOsm.forEach((u) => {
    const rs = porLinea.get(u.codigo);
    let c = 0;
    let sin = 0;
    rs.forEach((p) => {
      const claves = clavesEmpresa(p.operador);
      if (claves.size === 0) sin++;
      else if (u.claves.some((k) => claves.has(k))) c++;
    });
    out.empresa[u.codigo] = { rutasOsm: rs.length, coincide: c, sinEmpresa: sin };
    out.rutas[u.codigo] = { oficiales: u.rutas.length, ramalesOsm: new Set(rs.map((p) => p.ramal)).size };
    total += rs.length;
    coincide += c;
  });
  out.empresa.total = { rutasOsm: total, coincide };
  return out;
}

module.exports = { NOMBRES, CONCESIONARIOS, rutasPorUnidad, longitudesDeRutas, armarUnidades, comparar };
