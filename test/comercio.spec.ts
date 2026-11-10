/**
 * Mercados, supermercados y malls (centros comerciales): tres categorías nuevas, SOLO INFORMATIVAS (sin umbral). Aquí: la clasificación
 * de las etiquetas de OpenStreetMap, la distancia al borde de un polígono, la lógica pura de scripts/lib/comercio.js (consulta única,
 * conversión, deduplicación, malls verificados y cobertura frente al CENAMA 2016). Sin red.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Calculos = require('../public/js/calculos.js');
const Comercio = require('../scripts/lib/comercio.js');

const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const LAT = -16.409;
const LON = -71.5375;
const dLat = (m: number) => m / M_POR_GRADO_LAT;
const dLon = (m: number) => m / (M_POR_GRADO_LAT * Math.cos((LAT * Math.PI) / 180));
const P = { lat: LAT, lon: LON };
const punto = (osm: string, nombre: string | null, mNorte: number, mEste: number, tags: Record<string, string>) => ({
  type: 'Feature',
  properties: { osm, nombre, tags },
  geometry: { type: 'Point', coordinates: [LON + dLon(mEste), LAT + dLat(mNorte)] },
});
/** Cuadrado de `lado` m cuyo borde oeste queda a `mEste` m del punto y cuyo borde sur queda a `mNorte` m. */
const cuadrado = (osm: string, nombre: string | null, mNorte: number, mEste: number, lado: number, tags: Record<string, string>) => {
  const x0 = LON + dLon(mEste);
  const x1 = LON + dLon(mEste + lado);
  const y0 = LAT + dLat(mNorte);
  const y1 = LAT + dLat(mNorte + lado);
  return { type: 'Feature', properties: { osm, nombre, tags }, geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } };
};

describe('clasificación de etiquetas de comercio', () => {
  it('amenity=marketplace es mercado; shop=supermarket, supermercado; shop=mall, mall', () => {
    expect(Calculos.categoriasDe({ amenity: 'marketplace' })).toEqual(['mercados']);
    expect(Calculos.categoriasDe({ shop: 'supermarket' })).toEqual(['supermercados']);
    expect(Calculos.categoriasDe({ shop: 'mall' })).toEqual(['malls']);
  });
  it('landuse=retail solo es mall si tiene un nombre que lo diga (mall, centro comercial…)', () => {
    expect(Calculos.categoriasDe({ landuse: 'retail' }, 'Mall Aventura')).toEqual(['malls']);
    expect(Calculos.categoriasDe({ landuse: 'retail' }, 'CENTRO COMERCIAL Los Portales')).toEqual(['malls']);
    expect(Calculos.categoriasDe({ landuse: 'retail' }, 'Centro Comercial')).toEqual(['malls']);
    expect(Calculos.categoriasDe({ landuse: 'retail' })).toEqual([]);
    expect(Calculos.categoriasDe({ landuse: 'retail' }, 'Tiendas de la Av. Ejército')).toEqual([]);
    expect(Calculos.categoriasDe({ building: 'retail' }, 'Real Plaza Arequipa')).toEqual(['malls']);
    expect(Calculos.categoriasDe({ building: 'retail' }, 'OutletArauco Arequipa')).toEqual(['malls']);
    expect(Calculos.categoriasDe({ building: 'retail' })).toEqual([]);
    expect(Calculos.categoriasDe({ building: 'retail' }, 'Farmacia Inkafarma')).toEqual([]);
  });
  it('no confunde con otras categorías ni con tiendas', () => {
    expect(Calculos.categoriasDe({ shop: 'convenience' })).toEqual([]);
    expect(Calculos.categoriasDe({ shop: 'department_store' })).toEqual([]);
    expect(Calculos.categoriasDe({ amenity: 'bank' })).toEqual([]);
  });
  it('selectoresOverpass de comercio (shop=mall, landuse=retail con nombre)', () => {
    expect(Calculos.selectoresOverpass('mercados')).toEqual(['["amenity"="marketplace"]']);
    expect(Calculos.selectoresOverpass('supermercados')).toEqual(['["shop"="supermarket"]']);
    const malls = Calculos.selectoresOverpass('malls');
    expect(malls[0]).toBe('["shop"="mall"]');
    expect(malls[1]).toMatch(/^\["landuse"="retail"\]\["name"~"/);
    expect(malls[1]).toMatch(/,i\]$/);
    expect(malls[2]).toMatch(/^\["building"~"\^\(retail\|commercial\)\$"\]\["name"~"/);
  });
  it('osmAFeatures conserva la etiqueta shop', () => {
    const f = Calculos.osmAFeatures([{ type: 'node', id: 1, lat: LAT, lon: LON, tags: { shop: 'supermarket', name: 'Super X' } }], 'puntos');
    expect(f[0].properties.tags.shop).toBe('supermarket');
  });
});

describe('evaluarMasCercanoForma: el más cercano, midiendo al borde del polígono', () => {
  const op = { umbralM: null, fuente: 'OSM', fecha: '2026-11-10', metodo: 'm' };
  it('con puntos mide la distancia en línea recta y es INFORMATIVO sin umbral', () => {
    const r = Calculos.evaluarMasCercanoForma(P, [punto('node/1', 'Lejos', 1000, 0, {}), punto('node/2', 'Cerca', 300, 0, {})], op);
    expect(r.estado).toBe('INFORMATIVO');
    expect(r.nombre).toBe('Cerca');
    expect(r.distanciaM).toBeGreaterThan(299);
    expect(r.distanciaM).toBeLessThan(301);
    expect(r.umbralM).toBeNull();
    expect(r.osm).toBe('node/2');
    expect(r.forma).toBeNull();
  });
  it('mide al BORDE del polígono, no al centro: un polígono grande cercano le gana a un punto más cerca de su centro', () => {
    const grande = cuadrado('way/1', 'Mall Grande', 200, -500, 1000, { shop: 'mall' }); // 200 m al norte del punto, su centro queda a 700 m
    const r = Calculos.evaluarMasCercanoForma(P, [grande, punto('node/9', 'Puntual', 400, 0, {})], op);
    expect(r.nombre).toBe('Mall Grande');
    expect(r.distanciaM).toBeGreaterThan(199);
    expect(r.distanciaM).toBeLessThan(201);
    expect(r.forma.type).toBe('Polygon');
    expect(r.lat).not.toBeNull();
  });
  it('si el punto está dentro del polígono la distancia es 0', () => {
    const r = Calculos.evaluarMasCercanoForma(P, [cuadrado('way/1', 'Mall', -100, -100, 200, { shop: 'mall' })], op);
    expect(r.distanciaM).toBe(0);
    expect(r.estado).toBe('INFORMATIVO');
  });
  it('con un umbral numérico dice CUMPLE o NO CUMPLE (hoy ninguna categoría lo tiene)', () => {
    const f = [punto('node/2', 'A', 300, 0, {})];
    expect(Calculos.evaluarMasCercanoForma(P, f, { ...op, umbralM: 500 }).estado).toBe('CUMPLE');
    expect(Calculos.evaluarMasCercanoForma(P, f, { ...op, umbralM: 100 }).estado).toBe('NO CUMPLE');
  });
  it('sin candidatos es SIN DATO y no inventa una distancia', () => {
    const r = Calculos.evaluarMasCercanoForma(P, [], op);
    expect(r.estado).toBe('SIN DATO');
    expect(r.distanciaM).toBeNull();
    expect(r.nombre).toBeNull();
  });
  it('trae la fuente del elemento y un nombre por omisión', () => {
    const f = punto('node/2', null, 300, 0, {});
    (f.properties as any).fuente = 'OSM';
    const r = Calculos.evaluarMasCercanoForma(P, [f], op);
    expect(r.nombre).toBe('Sin nombre en OSM');
    expect(r.fuenteElemento).toBe('OSM');
  });
});

describe('Comercio.construirConsulta: una sola consulta a Overpass', () => {
  const q = Comercio.construirConsulta([-16.6, -71.75, -16.2, -71.35]);
  it('es una sola consulta con las tres categorías y geometría completa', () => {
    expect(q).toMatch(/^\[out:json\]\[timeout:\d+\]/);
    expect(q.match(/\[out:json\]/g)).toHaveLength(1);
    expect(q).toContain('nwr["amenity"="marketplace"](-16.6,-71.75,-16.2,-71.35);');
    expect(q).toContain('nwr["shop"="supermarket"](-16.6,-71.75,-16.2,-71.35);');
    expect(q).toContain('nwr["shop"="mall"](-16.6,-71.75,-16.2,-71.35);');
    expect(q).toContain('nwr["landuse"="retail"]["name"~');
    expect(q).toMatch(/out geom tags;\s*$/);
  });
});

describe('Comercio.convertirElementos', () => {
  const nodo = { type: 'node', id: 1, lat: LAT, lon: LON, tags: { amenity: 'marketplace', name: 'Mercado A' } };
  const via = {
    type: 'way', id: 2, tags: { shop: 'mall', name: 'Mall B' },
    geometry: [{ lat: LAT, lon: LON }, { lat: LAT, lon: LON + 0.001 }, { lat: LAT + 0.001, lon: LON + 0.001 }, { lat: LAT, lon: LON }],
  };
  const viaAbierta = { type: 'way', id: 3, tags: { shop: 'supermarket', name: 'Super C' }, geometry: [{ lat: LAT, lon: LON }, { lat: LAT, lon: LON + 0.001 }, { lat: LAT + 0.001, lon: LON + 0.001 }] };
  const r = Comercio.convertirElementos([nodo, via, viaAbierta]);
  it('un nodo es un punto y una vía cerrada es un polígono, cada uno con su categoría', () => {
    expect(r.features.map((f: any) => [f.properties.osm, f.geometry.type, f.properties.categoria])).toEqual([
      ['node/1', 'Point', 'mercados'],
      ['way/2', 'Polygon', 'malls'],
    ]);
  });
  it('lo que no tiene geometría utilizable se cuenta, no se inventa', () => {
    expect(r.sinGeometria).toBe(1);
  });
});

describe('Comercio.deduplicar: el mismo lugar mapeado dos veces cuenta una', () => {
  it('con el mismo nombre y a pocos metros, deja el polígono y anota el otro elemento', () => {
    const poli = cuadrado('way/10', 'Supermercado Tottus', 0, 300, 60, { shop: 'supermarket' });
    const nodo = punto('node/11', 'Tottus', 30, 330, { shop: 'supermarket' });
    const lejos = punto('node/12', 'Tottus', 3000, 0, { shop: 'supermarket' });
    const r = Comercio.deduplicar([nodo, poli, lejos], { radioM: 150 });
    expect(r.features.map((f: any) => f.properties.osm).sort()).toEqual(['node/12', 'way/10']);
    expect(r.features.find((f: any) => f.properties.osm === 'way/10').properties.osm_asociados).toEqual(['node/11']);
    expect(r.descartados).toBe(1);
  });
  it('con nombres distintos conserva ambos aunque estén juntos', () => {
    const a = punto('node/1', 'Mercado Central', 0, 0, { amenity: 'marketplace' });
    const b = punto('node/2', 'Mercado Modelo', 20, 0, { amenity: 'marketplace' });
    expect(Comercio.deduplicar([a, b], { radioM: 150 }).features).toHaveLength(2);
  });
  it('en un mall, el edificio shop=mall manda sobre el terreno landuse=retail del mismo nombre', () => {
    const terreno = cuadrado('way/20', 'Mall Aventura', -50, -50, 400, { landuse: 'retail' });
    const edificio = cuadrado('way/21', 'Mall Aventura Plaza', 40, 40, 100, { shop: 'mall' });
    const r = Comercio.deduplicar([terreno, edificio], { radioM: 300, preferir: (f: any) => (f.properties.tags.shop === 'mall' ? 2 : 1) });
    expect(r.features).toHaveLength(1);
    expect(r.features[0].properties.osm).toBe('way/21');
    expect(r.features[0].properties.osm_asociados).toEqual(['way/20']);
  });
  it('un elemento sin nombre solo se junta con otro sin nombre a menos de 30 m', () => {
    const a = punto('node/1', null, 0, 0, { shop: 'supermarket' });
    const b = punto('node/2', null, 10, 0, { shop: 'supermarket' });
    const c = punto('node/3', null, 500, 0, { shop: 'supermarket' });
    expect(Comercio.deduplicar([a, b, c], { radioM: 150 }).features).toHaveLength(2);
  });
});

describe('Comercio.enDistritos', () => {
  const dentro = (_lat: number, lon: number) => lon > LON;
  it('deja lo que tiene algún vértice o su centro dentro de los distritos', () => {
    const fuera = punto('node/1', 'F', 0, -500, {});
    const dentroP = punto('node/2', 'D', 0, 500, {});
    const cruza = cuadrado('way/3', 'C', 0, -100, 300, {});
    expect(Comercio.enDistritos([fuera, dentroP, cruza], dentro).map((f: any) => f.properties.osm)).toEqual(['node/2', 'way/3']);
  });
});

describe('Comercio.verificarCurados: los malls conocidos se contrastan con OpenStreetMap, sin inventar geometría', () => {
  const curados = [
    { id: 'aventura', nombre: 'Mall Aventura Arequipa', patron: 'aventura', url: 'https://ejemplo.pe/aventura', entidad: 'Parque Arauco' },
    { id: 'inexistente', nombre: 'Mall Imaginario', patron: 'imaginario', url: 'https://ejemplo.pe/x', entidad: 'X' },
  ];
  const malls = [cuadrado('way/1', 'Mall Aventura Plaza', 0, 0, 100, { shop: 'mall' }), punto('node/2', 'Otro Mall', 500, 0, { shop: 'mall' })];
  const r = Comercio.verificarCurados(malls, curados);
  it('marca el elemento de OSM que coincide con el nombre y guarda la verificación con su enlace', () => {
    const f = r.features.find((x: any) => x.properties.osm === 'way/1');
    expect(f.properties.verificado).toEqual({ id: 'aventura', nombre: 'Mall Aventura Arequipa', url: 'https://ejemplo.pe/aventura', entidad: 'Parque Arauco' });
    expect(r.features.find((x: any) => x.properties.osm === 'node/2').properties.verificado).toBeUndefined();
  });
  it('dice qué mall curado no está en OpenStreetMap, en vez de inventarle una ubicación', () => {
    expect(r.sinOsm.map((c: any) => c.id)).toEqual(['inexistente']);
    expect(r.features).toHaveLength(2);
  });
});

describe('Comercio.leerCenama y cobertura por distrito', () => {
  const csv = [
    'id_anonimo_cenama|anio|ubigeo|departamento|provincia|distrito|ano_inicio_op|tipo_mercado|nro_puestos_fijos|nro_puestos_funcionando|nro_socios_titular|alumbrado_publico|agua_red_publica|alcantarillado_publico|contenedor_residuos_solido|nro_trabajadores|ingreso_mercado|fec_creacion',
    'A|2016|040104|AREQUIPA|AREQUIPA|CAYMA|2000|MINORISTA|100|90|1|Si|Si|Si|Si|3|100|20241231',
    'B|2016|040104|AREQUIPA|AREQUIPA|CAYMA|2001|MIXTO|50|40|1|Si|Si|Si|Si|3|100|20241231',
    'C|2016|040101|AREQUIPA|AREQUIPA|AREQUIPA|1990|MAYORISTA|300|290|1|Si|Si|Si|Si|3|100|20241231',
    'D|2016|040201|AREQUIPA|CAMANA|CAMANA|1990|MINORISTA|30|29|1|Si|Si|Si|Si|3|100|20241231',
    'E|2016|150101|LIMA|LIMA|LIMA|1990|MINORISTA|30|29|1|Si|Si|Si|Si|3|100|20241231',
  ].join('\n');
  it('lee el CSV con barra vertical y se queda con la provincia de Arequipa', () => {
    const c = Comercio.leerCenama(csv);
    expect(c.totalPais).toBe(5);
    expect(c.registros.map((r: any) => r.distrito)).toEqual(['CAYMA', 'CAYMA', 'AREQUIPA']);
    expect(c.porTipo).toEqual({ MINORISTA: 1, MIXTO: 1, MAYORISTA: 1 });
  });
  it('compara por distrito el conteo del CENAMA con el de OpenStreetMap', () => {
    const c = Comercio.leerCenama(csv);
    const osm = [punto('node/1', 'M1', 0, 0, {}), punto('node/2', 'M2', 0, 100, {}), punto('node/3', 'M3', 0, 200, {})];
    const dist = (_lat: number, lon: number) => (lon > LON + dLon(150) ? 'AREQUIPA' : 'CAYMA');
    const cob = Comercio.cobertura(c.registros, osm, dist);
    expect(cob.filas).toEqual([
      { distrito: 'AREQUIPA', cenama: 1, osm: 1 },
      { distrito: 'CAYMA', cenama: 2, osm: 2 },
    ]);
    expect(cob.totales).toEqual({ cenama: 3, osm: 3 });
  });
  it('un distrito de OSM que el CENAMA no tiene (o al revés) aparece con 0', () => {
    const c = Comercio.leerCenama(csv);
    const cob = Comercio.cobertura(c.registros, [punto('node/1', 'M1', 0, 0, {})], () => 'YURA');
    expect(cob.filas.find((f: any) => f.distrito === 'YURA')).toEqual({ distrito: 'YURA', cenama: 0, osm: 1 });
    expect(cob.filas.find((f: any) => f.distrito === 'CAYMA')).toEqual({ distrito: 'CAYMA', cenama: 2, osm: 0 });
  });
});
