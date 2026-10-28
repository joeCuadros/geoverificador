/**
 * Pruebas de public/js/calculos.js: las funciones puras detrás de las 5 variables del alcance
 * (zonificación, salud, educación, transporte y área verde).
 * El módulo es JavaScript de navegador que también se exporta como CommonJS, así que se carga con require.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Calculos = require('../public/js/calculos.js');

type Punto = { lat: number; lon: number };
const P: Punto = { lat: -16.409, lon: -71.5375 }; // Plaza de Armas de Arequipa (aprox.)

// Metros → grados en el punto P (aproximación local, suficiente para armar casos de prueba).
const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const dLat = (m: number) => m / M_POR_GRADO_LAT;
const dLon = (m: number, lat = P.lat) =>
  m / (M_POR_GRADO_LAT * Math.cos((lat * Math.PI) / 180));

// Cuadrado de `lado` metros con la esquina suroeste en (lat, lon), como anillo GeoJSON [lon, lat].
const cuadrado = (lat: number, lon: number, lado: number) => {
  const a = lat + dLat(lado);
  const o = lon + dLon(lado, lat);
  return [
    [lon, lat],
    [o, lat],
    [o, a],
    [lon, a],
    [lon, lat],
  ];
};

describe('haversine', () => {
  it('es 0 entre el mismo punto', () => {
    expect(Calculos.haversine(P.lat, P.lon, P.lat, P.lon)).toBe(0);
  });

  it('un grado de latitud mide 2·π·R/360 con R = 6 371 008,8 m', () => {
    const esperado = (2 * Math.PI * 6371008.8) / 360;
    expect(Calculos.haversine(0, 0, 1, 0)).toBeCloseTo(esperado, 3);
  });

  it('es simétrica y coincide con un desplazamiento conocido de 500 m al norte', () => {
    const d1 = Calculos.haversine(P.lat, P.lon, P.lat + dLat(500), P.lon);
    const d2 = Calculos.haversine(P.lat + dLat(500), P.lon, P.lat, P.lon);
    expect(d1).toBeCloseTo(500, 3);
    expect(d2).toBeCloseTo(d1, 9);
  });
});

describe('areaAnilloM2 / areaPoligonoM2 (geodésica)', () => {
  it('un cuadrado de 100 m × 100 m mide ≈ 1 ha (±0,5 %)', () => {
    const anillo = cuadrado(P.lat, P.lon, 100);
    const area = Calculos.areaAnilloM2(anillo);
    expect(area / 10000).toBeGreaterThan(0.995);
    expect(area / 10000).toBeLessThan(1.005);
  });

  it('no depende del sentido del anillo', () => {
    const anillo = cuadrado(P.lat, P.lon, 100);
    const alReves = [...anillo].reverse();
    expect(Calculos.areaAnilloM2(alReves)).toBeCloseTo(Calculos.areaAnilloM2(anillo), 6);
  });

  it('resta los huecos del polígono', () => {
    const exterior = cuadrado(P.lat, P.lon, 200);
    const hueco = cuadrado(P.lat + dLat(50), P.lon + dLon(50), 100);
    const total = Calculos.areaAnilloM2(exterior);
    const h = Calculos.areaAnilloM2(hueco);
    expect(Calculos.areaPoligonoM2([exterior, hueco])).toBeCloseTo(total - h, 3);
  });

  it('suma los polígonos de un MultiPolygon', () => {
    const a = cuadrado(P.lat, P.lon, 100);
    const b = cuadrado(P.lat + dLat(500), P.lon, 100);
    const geometria = { type: 'MultiPolygon', coordinates: [[a], [b]] };
    expect(Calculos.areaGeometriaM2(geometria)).toBeCloseTo(
      Calculos.areaAnilloM2(a) + Calculos.areaAnilloM2(b),
      3,
    );
  });

  it('devuelve 0 para geometrías que no son polígonos', () => {
    expect(Calculos.areaGeometriaM2({ type: 'Point', coordinates: [0, 0] })).toBe(0);
    expect(Calculos.areaGeometriaM2(null)).toBe(0);
  });
});

describe('distanciaAPoligonoM', () => {
  const lado = 100;
  const sw = { lat: P.lat, lon: P.lon };
  const anillo = cuadrado(sw.lat, sw.lon, lado);

  it('es 0 si el punto está dentro', () => {
    const dentro = { lat: sw.lat + dLat(50), lon: sw.lon + dLon(50) };
    expect(Calculos.distanciaAPoligonoM(dentro.lat, dentro.lon, [anillo])).toBe(0);
  });

  it('mide hasta el borde más cercano si está fuera (50 m al oeste del lado oeste)', () => {
    const fuera = { lat: sw.lat + dLat(50), lon: sw.lon - dLon(50) };
    expect(Calculos.distanciaAPoligonoM(fuera.lat, fuera.lon, [anillo])).toBeCloseTo(50, 0);
  });

  it('mide hasta la esquina más cercana en diagonal', () => {
    const fuera = { lat: sw.lat - dLat(30), lon: sw.lon - dLon(40) };
    expect(Calculos.distanciaAPoligonoM(fuera.lat, fuera.lon, [anillo])).toBeCloseTo(50, 0);
  });

  it('si el punto cae en un hueco, la distancia es hasta el borde del hueco', () => {
    const grande = cuadrado(sw.lat, sw.lon, 200);
    const hueco = cuadrado(sw.lat + dLat(50), sw.lon + dLon(50), 100);
    const enHueco = { lat: sw.lat + dLat(100), lon: sw.lon + dLon(60) };
    expect(Calculos.distanciaAPoligonoM(enHueco.lat, enHueco.lon, [grande, hueco])).toBeCloseTo(10, 0);
  });

  it('toma el mínimo entre los polígonos de un MultiPolygon', () => {
    const lejos = cuadrado(sw.lat + dLat(1000), sw.lon, lado);
    const geometria = { type: 'MultiPolygon', coordinates: [[lejos], [anillo]] };
    const fuera = { lat: sw.lat + dLat(50), lon: sw.lon - dLon(70) };
    expect(Calculos.distanciaAGeometriaM(fuera.lat, fuera.lon, geometria)).toBeCloseTo(70, 0);
  });
});

describe('evaluarMasCercano (salud, transporte, cada nivel educativo)', () => {
  const opciones = {
    umbralM: 1000,
    fuente: 'OpenStreetMap (ODbL)',
    fecha: '2026-10-28',
    metodo: 'Distancia en línea recta (haversine) al más cercano.',
  };
  const en = (m: number, nombre: string | null, extra = {}) => ({
    nombre,
    lat: P.lat + dLat(m),
    lon: P.lon,
    ...extra,
  });

  it('elige el más cercano y devuelve CUMPLE si está dentro del umbral', () => {
    const r = Calculos.evaluarMasCercano(P, [en(900, 'Lejano'), en(300, 'Posta Central'), en(700, 'Medio')], opciones);
    expect(r.estado).toBe('CUMPLE');
    expect(r.nombre).toBe('Posta Central');
    expect(r.distanciaM).toBeCloseTo(300, 0);
    expect(r.umbralM).toBe(1000);
    expect(r.fuente).toBe('OpenStreetMap (ODbL)');
    expect(r.fecha).toBe('2026-10-28');
    expect(r.metodo).toBe(opciones.metodo);
  });

  it('devuelve NO CUMPLE si el más cercano supera el umbral', () => {
    const r = Calculos.evaluarMasCercano(P, [en(1500, 'Hospital Regional')], opciones);
    expect(r.estado).toBe('NO CUMPLE');
    expect(r.distanciaM).toBeCloseTo(1500, 0);
  });

  it('el umbral es inclusivo: a exactamente el umbral cumple', () => {
    const c = en(1000, 'En el límite');
    const d = Calculos.haversine(P.lat, P.lon, c.lat, c.lon);
    expect(Calculos.evaluarMasCercano(P, [c], { ...opciones, umbralM: d }).estado).toBe('CUMPLE');
    expect(Calculos.evaluarMasCercano(P, [c], { ...opciones, umbralM: d - 0.01 }).estado).toBe('NO CUMPLE');
  });

  it('devuelve SIN DATO si no hay candidatos', () => {
    const r = Calculos.evaluarMasCercano(P, [], opciones);
    expect(r.estado).toBe('SIN DATO');
    expect(r.nombre).toBeNull();
    expect(r.distanciaM).toBeNull();
    expect(r.umbralM).toBe(1000);
  });

  it('si la búsqueda cubrió un alcance mayor que el umbral y no halló nada, es NO CUMPLE sin distancia', () => {
    const r = Calculos.evaluarMasCercano(P, [], { ...opciones, alcanceM: 5000 });
    expect(r.estado).toBe('NO CUMPLE');
    expect(r.distanciaM).toBeNull();
  });

  it('un establecimiento sin nombre se identifica como tal', () => {
    const r = Calculos.evaluarMasCercano(P, [en(100, null)], opciones);
    expect(r.nombre).toBe('Sin nombre en OSM');
  });

  it('ignora candidatos sin coordenadas', () => {
    const r = Calculos.evaluarMasCercano(P, [{ nombre: 'Roto' }, en(200, 'Bueno')], opciones);
    expect(r.nombre).toBe('Bueno');
  });
});

describe('nivelesEducativos (reglas por etiquetas de OSM)', () => {
  it('amenity=kindergarten es inicial', () => {
    expect(Calculos.nivelesEducativos({ amenity: 'kindergarten' })).toEqual(['inicial']);
  });

  it('amenity=school sin etiquetas de nivel es candidato a primaria y secundaria', () => {
    expect(Calculos.nivelesEducativos({ amenity: 'school' })).toEqual(['primaria', 'secundaria']);
  });

  it('usa isced:level: 0 inicial, 1 primaria, 2 y 3 secundaria', () => {
    expect(Calculos.nivelesEducativos({ amenity: 'school', 'isced:level': '0' })).toEqual(['inicial']);
    expect(Calculos.nivelesEducativos({ amenity: 'school', 'isced:level': '1' })).toEqual(['primaria']);
    expect(Calculos.nivelesEducativos({ amenity: 'school', 'isced:level': '2;3' })).toEqual(['secundaria']);
    expect(Calculos.nivelesEducativos({ amenity: 'school', 'isced:level': '1;2;3' })).toEqual(['primaria', 'secundaria']);
    expect(Calculos.nivelesEducativos({ amenity: 'school', 'isced:level': '0;1' })).toEqual(['inicial', 'primaria']);
  });

  it('usa school=kindergarten|primary|secondary', () => {
    expect(Calculos.nivelesEducativos({ amenity: 'school', school: 'kindergarten' })).toEqual(['inicial']);
    expect(Calculos.nivelesEducativos({ amenity: 'school', school: 'primary' })).toEqual(['primaria']);
    expect(Calculos.nivelesEducativos({ amenity: 'school', school: 'secondary' })).toEqual(['secundaria']);
  });

  it('un colegio etiquetado solo con niveles superiores (isced:level ≥ 4) no es educación básica', () => {
    expect(Calculos.nivelesEducativos({ amenity: 'school', 'isced:level': '6' })).toEqual([]);
    expect(Calculos.nivelesEducativos({ amenity: 'school', 'isced:level': '4;5' })).toEqual([]);
    expect(Calculos.nivelesEducativos({ amenity: 'school', 'isced:level': '3;6' })).toEqual(['secundaria']);
  });

  it('si el valor de nivel no es interpretable, aplica la regla por defecto', () => {
    expect(Calculos.nivelesEducativos({ amenity: 'school', 'isced:level': 'superior artística' })).toEqual(['primaria', 'secundaria']);
  });

  it('otros elementos no son educación escolar', () => {
    expect(Calculos.nivelesEducativos({ amenity: 'university' })).toEqual([]);
    expect(Calculos.nivelesEducativos({})).toEqual([]);
  });
});

describe('clasificación de etiquetas y consulta Overpass', () => {
  it('reconoce salud: hospital, clinic, doctors y healthcare=*', () => {
    expect(Calculos.categoriasDe({ amenity: 'hospital' })).toContain('salud');
    expect(Calculos.categoriasDe({ amenity: 'clinic' })).toContain('salud');
    expect(Calculos.categoriasDe({ amenity: 'doctors' })).toContain('salud');
    expect(Calculos.categoriasDe({ healthcare: 'centre' })).toContain('salud');
  });

  it('healthcare=pharmacy, dentist o laboratory no cuentan como establecimiento de salud', () => {
    expect(Calculos.categoriasDe({ amenity: 'pharmacy', healthcare: 'pharmacy' })).not.toContain('salud');
    expect(Calculos.categoriasDe({ healthcare: 'dentist' })).not.toContain('salud');
    expect(Calculos.categoriasDe({ healthcare: 'laboratory' })).not.toContain('salud');
  });

  it('reconoce educación, transporte y áreas verdes', () => {
    expect(Calculos.categoriasDe({ amenity: 'school' })).toContain('educacion');
    expect(Calculos.categoriasDe({ amenity: 'kindergarten' })).toContain('educacion');
    expect(Calculos.categoriasDe({ highway: 'bus_stop' })).toContain('transporte');
    expect(Calculos.categoriasDe({ public_transport: 'platform' })).toContain('transporte');
    expect(Calculos.categoriasDe({ public_transport: 'stop_position' })).toContain('transporte');
    expect(Calculos.categoriasDe({ leisure: 'park' })).toContain('areasVerdes');
    expect(Calculos.categoriasDe({ leisure: 'garden' })).toContain('areasVerdes');
    expect(Calculos.categoriasDe({ landuse: 'recreation_ground' })).toContain('areasVerdes');
  });

  it('no clasifica el mercado ni otras etiquetas fuera del alcance', () => {
    expect(Calculos.categoriasDe({ amenity: 'marketplace' })).toEqual([]);
    expect(Calculos.categoriasDe({ leisure: 'pitch' })).toEqual([]);
    expect(Calculos.categoriasDe({ amenity: 'bus_station' })).toEqual([]);
  });

  it('arma selectores Overpass a partir de los mismos filtros', () => {
    const sel = Calculos.selectoresOverpass('salud');
    expect(sel).toContain('["amenity"~"^(hospital|clinic|doctors)$"]');
    expect(sel.some((s: string) => s.startsWith('["healthcare"]'))).toBe(true);
  });
});

describe('etiquetaDe (etiqueta de OSM que clasificó el elemento)', () => {
  it('devuelve clave=valor de la primera regla que coincide', () => {
    expect(Calculos.etiquetaDe({ amenity: 'hospital', healthcare: 'hospital' }, 'salud')).toBe('amenity=hospital');
    expect(Calculos.etiquetaDe({ healthcare: 'centre' }, 'salud')).toBe('healthcare=centre');
    expect(Calculos.etiquetaDe({ public_transport: 'platform' }, 'transporte')).toBe('public_transport=platform');
  });

  it('devuelve null si no coincide', () => {
    expect(Calculos.etiquetaDe({ amenity: 'cafe' }, 'salud')).toBeNull();
  });
});

describe('evaluarAreaVerde (V5: ≥ 5000 m² a ≤ 300 m)', () => {
  const opciones = {
    areaMinM2: 5000,
    distanciaMaxM: 300,
    areaGrandeM2: 10000,
    fuente: 'OpenStreetMap (ODbL)',
    fecha: '2026-10-28',
    metodo: 'Área geodésica y distancia al borde.',
  };
  // Parque cuadrado de `lado` m, centrado en la latitud del punto, con su borde oeste `aEsteM` metros al este del punto.
  const parque = (lado: number, aEsteM: number, nombre = 'Parque') => ({
    type: 'Feature',
    properties: { nombre, tags: { leisure: 'park' }, osm: 'way/1' },
    geometry: {
      type: 'Polygon',
      coordinates: [cuadrado(P.lat - dLat(lado / 2), P.lon + dLon(aEsteM), lado)],
    },
  });

  it('CUMPLE con un parque de ≥ 5000 m² a ≤ 300 m', () => {
    const r = Calculos.evaluarAreaVerde(P, [parque(80, 200, 'Parque Selva Alegre')], opciones); // 6400 m²
    expect(r.estado).toBe('CUMPLE');
    expect(r.nombre).toBe('Parque Selva Alegre');
    expect(r.distanciaM).toBeCloseTo(200, 0);
    expect(r.umbralM).toBe(300);
    expect(r.areaM2).toBeGreaterThan(6300);
    expect(r.areaM2).toBeLessThan(6500);
    expect(r.cumple1ha).toBe(false);
  });

  it('un parque de menos de 5000 m² no basta aunque esté al lado', () => {
    const r = Calculos.evaluarAreaVerde(P, [parque(60, 10, 'Plazuela')], opciones); // 3600 m²
    expect(r.estado).toBe('NO CUMPLE');
  });

  it('un parque grande pero a más de 300 m no cumple, y se informa el más cercano que califica', () => {
    const r = Calculos.evaluarAreaVerde(P, [parque(120, 500, 'Parque Lejano')], opciones);
    expect(r.estado).toBe('NO CUMPLE');
    expect(r.nombre).toBe('Parque Lejano');
    expect(r.distanciaM).toBeCloseTo(500, 0);
  });

  it('distancia 0 si el punto está dentro del parque', () => {
    const r = Calculos.evaluarAreaVerde(P, [parque(200, -100, 'Parque Grande')], opciones);
    expect(r.estado).toBe('CUMPLE');
    expect(r.distanciaM).toBe(0);
  });

  it('informa por separado si hay uno de ≥ 1 ha dentro de 300 m (sensibilidad)', () => {
    const r = Calculos.evaluarAreaVerde(P, [parque(80, 50, 'Chico'), parque(120, 250, 'Grande')], opciones);
    expect(r.estado).toBe('CUMPLE');
    expect(r.nombre).toBe('Chico'); // el más cercano que califica
    expect(r.cumple1ha).toBe(true);
    expect(r.nombre1ha).toBe('Grande');
  });

  it('SIN DATO si no hay polígonos', () => {
    const r = Calculos.evaluarAreaVerde(P, [], opciones);
    expect(r.estado).toBe('SIN DATO');
    expect(r.distanciaM).toBeNull();
  });
});

describe('alertaBorde (V1a: otra zona a ≤ 20 m)', () => {
  // Zona A contiene al punto (llega 10 m al este de él) y la zona B empieza `aM` metros al este del punto.
  const zonaA = { codigo: 'RDM-2', polys: [[cuadrado(P.lat - dLat(100), P.lon - dLon(190), 200)]] };
  const zonaB = (aM: number, codigo = 'CZ') => ({
    codigo,
    polys: [[cuadrado(P.lat - dLat(100), P.lon + dLon(aM), 200)]],
  });

  it('avisa si otra zona está a ≤ umbral del punto', () => {
    const r = Calculos.alertaBorde(P, [zonaA, zonaB(15)], 'RDM-2', 20);
    expect(r.alerta).toBe(true);
    expect(r.codigo).toBe('CZ');
    expect(r.distanciaM).toBeCloseTo(15, 0);
  });

  it('no avisa si la otra zona está más lejos que el umbral', () => {
    const r = Calculos.alertaBorde(P, [zonaA, zonaB(60)], 'RDM-2', 20);
    expect(r.alerta).toBe(false);
  });

  it('ignora los polígonos de la misma zona', () => {
    const otraDeLaMisma = { codigo: 'RDM-2', polys: [[cuadrado(P.lat - dLat(100), P.lon + dLon(5), 200)]] };
    const r = Calculos.alertaBorde(P, [zonaA, otraDeLaMisma], 'RDM-2', 20);
    expect(r.alerta).toBe(false);
  });

  it('elige la zona vecina más cercana', () => {
    const r = Calculos.alertaBorde(P, [zonaA, zonaB(18, 'ZA'), zonaB(8, 'CZ')], 'RDM-2', 20);
    expect(r.codigo).toBe('CZ');
  });

  it('si el punto no tiene zona (null), no hay alerta', () => {
    const r = Calculos.alertaBorde(P, [zonaB(5)], null, 20);
    expect(r.alerta).toBe(false);
  });
});

describe('avisoPDMProyectado (V1b: solo con fuente y fecha)', () => {
  const completo = {
    fuente: 'Diario Correo',
    fecha: '2026-10-24',
    texto: 'El nuevo PDM no está aprobado; la zonificación puede cambiar.',
    url: 'https://diariocorreo.pe/ejemplo',
  };

  it('devuelve el aviso cuando hay fuente y fecha', () => {
    expect(Calculos.avisoPDMProyectado(completo)).toEqual(completo);
  });

  it.each([null, undefined, {}, { fuente: 'Diario Correo' }, { fecha: '2026-10-24', texto: 'x' }, { ...completo, fuente: '' }, { ...completo, fecha: '  ' }])(
    'no muestra nada si falta fuente o fecha (%j)',
    (estado) => {
      expect(Calculos.avisoPDMProyectado(estado)).toBeNull();
    },
  );

  it('no muestra nada si no hay texto que mostrar', () => {
    expect(Calculos.avisoPDMProyectado({ fuente: 'X', fecha: '2026-01-01' })).toBeNull();
  });
});

describe('modulosEfectivos (bandera de módulos fuera de alcance)', () => {
  const base = { seguridad: false, desastre: false, riesgos: false, sismica: false };

  it('respeta CONFIG.modulos por defecto', () => {
    expect(Calculos.modulosEfectivos(base, '')).toEqual(base);
    expect(Calculos.modulosEfectivos(base, '?otra=1')).toEqual(base);
  });

  it('?modulos=todos los activa todos sin borrar la configuración', () => {
    expect(Calculos.modulosEfectivos(base, '?modulos=todos')).toEqual({
      seguridad: true,
      desastre: true,
      riesgos: true,
      sismica: true,
    });
    expect(base.seguridad).toBe(false);
  });

  it('sin configuración, los módulos recortados quedan ocultos', () => {
    expect(Calculos.modulosEfectivos(undefined, '')).toEqual(base);
  });
});

describe('osmAFeatures (Overpass → GeoJSON)', () => {
  it('convierte nodos y centros de vías/relaciones en puntos con solo las etiquetas necesarias', () => {
    const fs = Calculos.osmAFeatures(
      [
        { type: 'node', id: 1, lat: -16.4, lon: -71.5, tags: { amenity: 'hospital', name: 'H1', phone: '123' } },
        { type: 'way', id: 2, center: { lat: -16.41, lon: -71.51 }, tags: { amenity: 'clinic' } },
        { type: 'way', id: 3, tags: { amenity: 'clinic' } },
      ],
      'puntos',
    );
    expect(fs).toHaveLength(2);
    expect(fs[0].geometry).toEqual({ type: 'Point', coordinates: [-71.5, -16.4] });
    expect(fs[0].properties.osm).toBe('node/1');
    expect(fs[0].properties.nombre).toBe('H1');
    expect(fs[0].properties.tags).toEqual({ amenity: 'hospital' });
    expect(fs[1].geometry.coordinates).toEqual([-71.51, -16.41]);
  });

  it('convierte una vía cerrada en Polygon', () => {
    const geometry = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 1 },
      { lat: 0, lon: 0 },
    ];
    const fs = Calculos.osmAFeatures([{ type: 'way', id: 9, geometry, tags: { leisure: 'park' } }], 'poligonos');
    expect(fs).toHaveLength(1);
    expect(fs[0].geometry.type).toBe('Polygon');
    expect(fs[0].geometry.coordinates[0][0]).toEqual([0, 0]);
  });

  it('ensambla una relación multipolígono (exterior en dos tramos + hueco)', () => {
    const el = {
      type: 'relation',
      id: 7,
      tags: { leisure: 'park', type: 'multipolygon' },
      members: [
        { type: 'way', role: 'outer', geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 4 }, { lat: 4, lon: 4 }] },
        { type: 'way', role: 'outer', geometry: [{ lat: 4, lon: 4 }, { lat: 4, lon: 0 }, { lat: 0, lon: 0 }] },
        { type: 'way', role: 'inner', geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }, { lat: 2, lon: 1 }, { lat: 1, lon: 1 }] },
      ],
    };
    const fs = Calculos.osmAFeatures([el], 'poligonos');
    expect(fs).toHaveLength(1);
    expect(fs[0].geometry.type).toBe('Polygon');
    expect(fs[0].geometry.coordinates).toHaveLength(2);
    const [ext] = fs[0].geometry.coordinates;
    expect(ext[0]).toEqual(ext[ext.length - 1]);
  });

  it('descarta relaciones cuyos anillos no se pueden cerrar', () => {
    const el = {
      type: 'relation',
      id: 8,
      tags: { leisure: 'park' },
      members: [{ type: 'way', role: 'outer', geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 4 }] }],
    };
    expect(Calculos.osmAFeatures([el], 'poligonos')).toHaveLength(0);
  });
});
