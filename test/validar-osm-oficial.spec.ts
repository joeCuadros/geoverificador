/**
 * Pruebas de la validación K2 (scripts/lib/validacion-oficial.js): lectura de los CSV de RENIPRESS y ESCALE con filtros, deduplicación
 * por código de local, emparejamiento por nombre y distancia con barrido de radios, métricas (exhaustividad, precisión, desfase) y
 * cambio de CUMPLE / NO CUMPLE en una malla de puntos. Con archivos CSV pequeños de test/fixtures; sin red ni datos oficiales reales.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const V = require('../scripts/lib/validacion-oficial.js');

const fixture = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const dLat = (m: number) => m / M_POR_GRADO_LAT;
const dLon = (m: number, lat: number) => m / (M_POR_GRADO_LAT * Math.cos((lat * Math.PI) / 180));

describe('parsearCsv', () => {
  it('lee comillas, comas dentro del campo, comillas dobles y saltos de línea de Windows', () => {
    const { columnas, filas } = V.parsearCsv('A,B\r\n"uno, dos","dice ""hola"""\r\nx,y\r\n');
    expect(columnas).toEqual(['a', 'b']);
    expect(filas).toEqual([{ a: 'uno, dos', b: 'dice "hola"' }, { a: 'x', b: 'y' }]);
  });
  it('detecta el punto y coma y quita el BOM y las tildes de los encabezados', () => {
    const { columnas } = V.parsearCsv('﻿Código Único;Nombre del establecimiento\n1;X\n');
    expect(columnas).toEqual(['codigo_unico', 'nombre_del_establecimiento']);
  });
  it('ignora las líneas vacías', () => {
    expect(V.parsearCsv('a,b\n\n1,2\n\n').filas).toHaveLength(1);
  });
});

describe('leerRenipress', () => {
  const r = V.leerRenipress(fixture('renipress_muestra.csv'));
  it('deja solo los establecimientos activos de Arequipa metropolitana con coordenadas, sin consultorios ni repetidos', () => {
    expect(r.registros.map((x: { id: string }) => x.id)).toEqual(['00001', '00002', '00003']);
    expect(r.descartados).toMatchObject({ total: 9, sinCoordenadas: 1, otraProvincia: 1, fueraDeZona: 1, inactivos: 1, consultorios: 1, repetidos: 1 });
  });
  it('lee coordenadas con coma decimal y deja el distrito sin tildes y en mayúsculas', () => {
    expect(r.registros[0]).toMatchObject({ nombre: 'HOSPITAL REGIONAL HONORIO DELGADO', lat: -16.4075, lon: -71.5275, distrito: 'AREQUIPA' });
  });
  it('con incluirConsultorios los deja', () => {
    expect(V.leerRenipress(fixture('renipress_muestra.csv'), { incluirConsultorios: true }).registros).toHaveLength(4);
  });
  it('un archivo sin latitud y longitud (solo UTM) se rechaza diciendo qué falta', () => {
    expect(() => V.leerRenipress('Nombre del establecimiento;Norte;Este\nX;8000000;230000\n')).toThrow(/faltan columnas.*latitud/);
  });
});

describe('leerEscale', () => {
  const e = V.leerEscale(fixture('escale_muestra.csv'));
  it('deduplica por código de local: dos IIEE del mismo local son un local con sus dos niveles y su nombre', () => {
    const glorioso = e.locales.find((l: { codLocal: string }) => l.codLocal === '100001');
    expect(glorioso.niveles).toEqual(['primaria', 'secundaria']);
    expect(glorioso.nombres).toEqual(['40001 GLORIOSO COLEGIO NACIONAL, DE VARONES']);
    expect(e.locales.filter((l: { codLocal: string }) => l.codLocal === '100001')).toHaveLength(1);
  });
  it('solo inicial, primaria y secundaria, activos, con coordenadas y de Arequipa metropolitana', () => {
    expect(e.locales.map((l: { codLocal: string }) => l.codLocal).sort()).toEqual(['100001', '100002', '100009']);
    expect(e.iies).toBe(4); // las dos IIEE del local 100001 más el jardín y la primaria de Yanahuara
    expect(e.descartados).toMatchObject({ total: 10, sinCoordenadas: 1, otraProvincia: 1, fueraDeZona: 1, inactivas: 1, otroNivel: 2, repetidosPorLocal: 1 });
  });
  it('el programa no escolarizado y la básica alternativa no cuentan como colegio', () => {
    const codigos = e.locales.map((l: { codLocal: string }) => l.codLocal);
    expect(codigos).not.toContain('100003');
    expect(codigos).not.toContain('100004');
  });
  it('si solo trae el código de nivel (A2, B0, F0) lo interpreta', () => {
    const t = 'COD_LOCAL,CEN_EDU,NIV_MOD,NLAT_IE,NLONG_IE\n1,A,A2,-16.4,-71.5\n2,B,B0,-16.41,-71.5\n3,C,F0,-16.42,-71.5\n';
    expect(V.leerEscale(t).locales.map((l: { niveles: string[] }) => l.niveles)).toEqual([['inicial'], ['primaria'], ['secundaria']]);
  });
  it('sin código de local se rechaza', () => {
    expect(() => V.leerEscale('CEN_EDU,NLAT_IE,NLONG_IE\nA,-16.4,-71.5\n')).toThrow(/código de local/);
  });
});

describe('normalizarNombre y similitud', () => {
  it('quita tildes, signos y palabras vacías', () => {
    expect(V.normalizarNombre('I.E. N° 40001 "Glorioso Colegio Nacional" de Varones')).toBe('40001 glorioso nacional varones'.replace('nacional ', '')); // «colegio» y «nacional» son vacías
  });
  it('mismo nombre escrito distinto: 1 o casi 1', () => {
    expect(V.similitud('CENTRO DE SALUD MARIANO MELGAR', 'Mariano Melgar')).toBe(1);
    expect(V.similitud('Puesto de Salud Sachaca', 'PUESTO DE SALUD DE SACHACA')).toBe(1);
    expect(V.similitud('I.E. 40001 Glorioso Colegio Nacional de Varones', '40001 GLORIOSO COLEGIO NACIONAL DE VARONES')).toBeGreaterThanOrEqual(0.9);
  });
  it('el orden de las palabras no pesa', () => {
    expect(V.similitud('Honorio Delgado Hospital', 'Hospital Honorio Delgado')).toBe(1);
  });
  it('nombres distintos quedan por debajo de 0,9', () => {
    expect(V.similitud('Colegio Santa Rosa', 'Colegio Santa María')).toBeLessThan(0.9);
    expect(V.similitud('Clínica Vallesur', 'Clínica Arequipa')).toBeLessThan(0.9);
  });
  it('un nombre vacío no se parece a nada', () => {
    expect(V.similitud('', 'Hospital')).toBe(0);
  });
});

describe('emparejar: nombre y distancia, uno a uno', () => {
  const lat = -16.4;
  const oficial = (id: string, nombre: string, metrosAlEste: number) => ({ id, nombre, lat, lon: -71.53 + dLon(metrosAlEste, lat) });
  const osm = (id: string, nombre: string, metrosAlEste: number) => ({ id, nombre, lat, lon: -71.53 + dLon(metrosAlEste, lat) });

  it('empareja con el mismo nombre dentro del radio y no fuera de él (barrido de 50, 100 y 200 m)', () => {
    const of = [oficial('a', 'Posta Cayma', 0)];
    const e = [osm('x', 'Posta de Cayma', 80)];
    expect(V.emparejar(of, e, { radioM: 50 }).pares).toHaveLength(0);
    expect(V.emparejar(of, e, { radioM: 100 }).pares).toHaveLength(1);
    expect(V.emparejar(of, e, { radioM: 200 }).pares[0].distanciaM).toBeCloseTo(80, 0);
  });
  it('no empareja nombres distintos aunque estén pegados', () => {
    expect(V.emparejar([oficial('a', 'Colegio Santa Rosa', 0)], [osm('x', 'Colegio Santa María', 5)], { radioM: 200 }).pares).toHaveLength(0);
  });
  it('es uno a uno: dos elementos de OSM con el mismo nombre no usan el mismo registro y gana el más cercano', () => {
    const r = V.emparejar([oficial('a', 'Posta Cayma', 0)], [osm('lejos', 'Posta Cayma', 90), osm('cerca', 'Posta Cayma', 10)], { radioM: 100 });
    expect(r.pares).toHaveLength(1);
    expect(r.pares[0].osm.id).toBe('cerca');
  });
  it('un local con varios nombres se empareja por el más parecido', () => {
    const o = { id: 'l', nombre: 'Primaria 1', nombres: ['Inicial 215', 'Glorioso Colegio'], lat, lon: -71.53 };
    expect(V.emparejar([o], [osm('x', 'Glorioso Colegio', 3)], { radioM: 50 }).pares).toHaveLength(1);
  });
  it('los elementos de OSM sin nombre no se emparejan y se cuentan aparte', () => {
    const r = V.emparejar([oficial('a', 'Posta Cayma', 0)], [osm('x', '', 1), osm('y', 'Posta Cayma', 2)], { radioM: 50 });
    expect(r.pares).toHaveLength(1);
    expect(r.osmSinNombre).toBe(1);
    expect(r.osmConNombre).toBe(1);
  });
});

describe('metricas: exhaustividad, precisión y desfase', () => {
  const lat = -16.4;
  const en = (nombre: string, m: number) => ({ id: nombre, nombre, lat, lon: -71.53 + dLon(m, lat) });
  const oficiales = [en('Alfa', 0), en('Bravo', 1000), en('Charlie', 2000), en('Delta', 3000)];
  const osm = [en('Alfa', 20), en('Bravo', 1120), en('Charlie', 2400), en('Eco', 5000), { id: 'sn', nombre: '', lat, lon: -71.53 + dLon(2000, lat) }];
  const m = V.metricas(oficiales, osm, [50, 100, 200]);

  it('la exhaustividad crece con el radio', () => {
    expect(m.map((x: { emparejados: number }) => x.emparejados)).toEqual([1, 1, 2]);
    expect(m[0].exhaustividad).toBeCloseTo(0.25, 5);
    expect(m[2].exhaustividad).toBeCloseTo(0.5, 5);
  });
  it('la precisión es sobre los elementos de OSM con nombre (4) y deja aparte los sin nombre', () => {
    expect(m[2].osmConNombre).toBe(4);
    expect(m[2].osmSinNombre).toBe(1);
    expect(m[2].precision).toBeCloseTo(0.5, 5);
  });
  it('el desfase es la mediana y el percentil 90 de la distancia de los pares', () => {
    expect(m[2].desfaseMedianaM).toBeCloseTo(70, 0); // 20 y 120 m
    expect(m[2].desfaseP90M).toBeCloseTo(110, 0);
  });
  it('sin registros oficiales no inventa una exhaustividad', () => {
    expect(V.metricas([], osm, [100])[0].exhaustividad).toBeNull();
  });
  it('porDistrito cuenta cuántos oficiales de cada distrito aparecen emparejados', () => {
    const of = [{ ...en('Alfa', 0), distrito: 'CAYMA' }, { ...en('Bravo', 1000), distrito: 'CAYMA' }, { ...en('Charlie', 2000), distrito: 'YURA' }];
    const pares = V.emparejar(of, osm, { radioM: 200 }).pares;
    expect(V.porDistrito(of, pares)).toEqual([
      { distrito: 'CAYMA', oficiales: 2, emparejados: 2, exhaustividad: 1 },
      { distrito: 'YURA', oficiales: 1, emparejados: 0, exhaustividad: 0 },
    ]);
  });
});

describe('impacto: cuántos puntos cambian de CUMPLE a NO CUMPLE', () => {
  const lat = -16.4;
  const e = (m: number) => ({ lat, lon: -71.53 + dLon(m, lat) });
  const punto = (m: number) => ({ lat, lon: -71.53 + dLon(m, lat) });

  it('cuenta los puntos donde la clasificación frente al umbral difiere y en qué dirección', () => {
    // Umbral de 1000 m. OSM tiene un establecimiento en x = 0; el registro oficial, uno en x = 3000.
    const puntos = [punto(0), punto(900), punto(1500), punto(2500), punto(3200)];
    const r = V.impacto(puntos, [e(0)], [e(3000)], 1000);
    expect(r).toMatchObject({ puntos: 5, cambian: 4, osmCumpleOficialNo: 2, oficialCumpleOsmNo: 2 });
    expect(r.porcentajeCambian).toBeCloseTo(0.8, 5);
  });
  it('si ambos coinciden no cambia nada y la diferencia es 0', () => {
    const r = V.impacto([punto(0), punto(2000)], [e(10)], [e(10)], 1000);
    expect(r.cambian).toBe(0);
    expect(r.diferenciaMedianaM).toBe(0);
  });
  it('sin elementos en una fuente, esa fuente nunca cumple (como en la ficha)', () => {
    const r = V.impacto([punto(0)], [], [e(0)], 1000);
    expect(r).toMatchObject({ cambian: 1, oficialCumpleOsmNo: 1 });
  });
  it('la malla se limita a donde dice «dentro»', () => {
    const caja = [-71.53, -16.41, -71.52, -16.4];
    const todos = V.malla(caja, 500);
    const mitad = V.malla(caja, 500, (_la: number, lo: number) => lo < -71.525);
    expect(todos.length).toBeGreaterThan(mitad.length);
    expect(mitad.length).toBeGreaterThan(0);
  });
});

describe('validar e informe, de punta a punta con los CSV de muestra', () => {
  const renipress = V.leerRenipress(fixture('renipress_muestra.csv'));
  const escale = V.leerEscale(fixture('escale_muestra.csv'));
  // OSM de prueba: el hospital y la clínica bien puestos (5 y 30 m), el centro de Mariano Melgar a 300 m, y un colegio con su nivel.
  const mover = (p: { lat: number; lon: number }, mE: number, mN = 0) => ({ lat: p.lat + dLat(mN), lon: p.lon + dLon(mE, p.lat) });
  const osmSalud = [
    { id: 'n1', nombre: 'Hospital Regional Honorio Delgado', ...mover(renipress.registros[0], 5) },
    { id: 'n2', nombre: 'Centro de Salud Mariano Melgar', ...mover(renipress.registros[1], 300) },
    { id: 'n3', nombre: 'Clínica San Juan de Dios', ...mover(renipress.registros[2], 0, 30) },
    { id: 'n4', nombre: 'Farmacia que no está en RENIPRESS', lat: -16.41, lon: -71.52 },
  ];
  const glorioso = escale.locales.find((l: { codLocal: string }) => l.codLocal === '100001');
  const osmEducacion = [
    { id: 'w1', nombre: 'I.E. 40001 Glorioso Colegio Nacional de Varones', niveles: ['primaria', 'secundaria'], ...mover(glorioso, 10) },
    { id: 'w2', nombre: 'Jardín 215', niveles: ['inicial'], lat: -16.5, lon: -71.6 },
  ];
  const umbrales = { salud: 1000, educacion: { inicial: 500, primaria: 1500, secundaria: 3000 } };
  const puntos = V.malla([-71.56, -16.43, -71.48, -16.37], 400);
  const r = V.validar({ renipress, escale, osmSalud, osmEducacion, puntos, umbrales, radiosM: [50, 100, 200] });

  it('mide la salud en los tres radios: el centro de Mariano Melgar (300 m) no se empareja con ninguno', () => {
    expect(r.salud.metricas.map((m: { emparejados: number }) => m.emparejados)).toEqual([2, 2, 2]);
    expect(r.salud.metricas[0].exhaustividad).toBeCloseTo(2 / 3, 5);
    expect(r.salud.metricas[0].precision).toBeCloseTo(2 / 4, 5);
  });
  it('mide la educación por nivel con los niveles de OSM', () => {
    expect(r.educacion.oficiales).toBe(3);
    expect(r.educacion.porNivel.primaria.oficiales).toBe(2);
    expect(r.educacion.porNivel.primaria.metricas[0].emparejados).toBe(1);
    expect(r.educacion.porNivel.inicial.metricas[0].emparejados).toBe(0); // el jardín de OSM está muy lejos
  });
  it('mide el cambio de CUMPLE / NO CUMPLE con los umbrales de la ficha', () => {
    expect(r.salud.impacto.umbralM).toBe(1000);
    expect(r.salud.impacto.puntos).toBe(puntos.length);
    expect(r.educacion.porNivel.inicial.impacto.umbralM).toBe(500);
    expect(r.salud.impacto.cambian).toBe(r.salud.impacto.osmCumpleOficialNo + r.salud.impacto.oficialCumpleOsmNo);
  });
  it('el informe trae todo lo que pide el protocolo y recuerda fijar los criterios antes', () => {
    const t = V.informe(r, { renipress, escale, meta: { renipress: 'renipress.csv (2026-09)', escale: 'escale.csv', osm: 'OSM congelado' } });
    expect(t).toMatch(/VALIDACIÓN DE OPENSTREETMAP CONTRA REGISTROS OFICIALES/);
    expect(t).toMatch(/exhaustividad 66,7 % \(2 de 3\), precisión 50,0 % \(2 de 4 de OSM con nombre\)/);
    expect(t).toMatch(/desfase mediana/);
    expect(t).toMatch(/p90/);
    expect(t).toMatch(/Nivel primaria/);
    expect(t).toMatch(/Exhaustividad por distrito/);
    expect(t).toMatch(/cambian \d+/);
    expect(t).toMatch(/deduplicadas por código de local/);
    expect(t).toMatch(/fija los criterios de aceptación ANTES/);
    expect(t).toContain('RENIPRESS: renipress.csv (2026-09)');
  });
});
