/**
 * Integración contra PostGIS (tarea 7.2): migraciones, cargadores, consultas espaciales base, capas por recorte y verificación base ↔ archivos.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Calculos from '@geoverificador/dominio/nucleo/calculos';
import { abrirBase, type Base } from '../src/cliente.ts';
import { capaRecortada, tolerancia, validarCaja } from '../src/capas.ts';
import { cargarArchivo, listarArchivos } from '../src/cargar.ts';
import { definicionDe } from '../src/catalogo.ts';
import { concesionesDe, distritoDe, fuente, fuentes, lugarMasCercano, lugaresCerca, manzanaDe, peligrosDe, zonaDe } from '../src/consultas.ts';
import { leerMigraciones, migrar } from '../src/migrar.ts';
import { verificarBase } from '../src/verificar.ts';
import { DATOS, baseDePrueba, leerDato } from './apoyo.ts';

const PLAZA = { lat: -16.39883, lon: -71.53697 };
let base: Base;
beforeAll(async () => {
  base = await baseDePrueba();
});
afterAll(() => base?.cerrar());

describe('migraciones', () => {
  it('aplicarlas dos veces no hace nada la segunda vez', async () => {
    expect(await migrar(base)).toEqual([]);
  });
  it('se niega a seguir si una migración aplicada cambió', async () => {
    const ms = leerMigraciones();
    await expect(migrar(base, [{ ...ms[0], sha256: 'otro' }])).rejects.toThrow(/ya se aplicó y su contenido cambió/);
  });
  it('una migración que falla no deja nada escrito', async () => {
    const memoria = await abrirBase('pglite://memoria');
    await expect(migrar(memoria, [{ nombre: '0001_mala.sql', sql: 'CREATE TABLE a (x int); SELECT esto_no_existe();', sha256: 'x' }])).rejects.toThrow();
    expect(await memoria.consulta("SELECT 1 FROM information_schema.tables WHERE table_name = 'a'")).toEqual([]);
    await memoria.cerrar();
  });
});

describe('cargadores', () => {
  it('todos los archivos de apps/estatica/public/data están en el catálogo y en la base', async () => {
    const rutas = listarArchivos(DATOS);
    expect(rutas.filter((r) => !definicionDe(r))).toEqual([]);
    const enBase = (await base.consulta('SELECT ruta FROM archivo_dato')).map((r) => r.ruta).sort();
    expect(enBase).toEqual(rutas);
  });
  it('la base coincide con los archivos (lo mismo que comprueba datos:verificar)', async () => {
    const r = await verificarBase(base, DATOS);
    expect(r.filter((c) => !c.ok)).toEqual([]);
    expect(r.length).toBeGreaterThan(listarArchivos(DATOS).length);
  });
  it('volver a cargar un archivo sin cambios no lo toca; forzarlo lo deja igual', async () => {
    expect((await cargarArchivo(base, DATOS, 'equipamiento/malls.geojson')).estado).toBe('sin_cambios');
    const r = await cargarArchivo(base, DATOS, 'equipamiento/malls.geojson', { forzar: true });
    expect(r).toMatchObject({ estado: 'cargado', registros: leerDato('equipamiento/malls.geojson').features.length });
    expect((await base.consulta("SELECT count(*)::int AS n FROM lugar WHERE categoria = 'malls'"))[0].n).toBe(r.registros);
  });
  it('un archivo que no está en el catálogo se rechaza', async () => {
    await expect(cargarArchivo(base, DATOS, 'no_existe.geojson')).rejects.toThrow(/no está en el catálogo/);
  });
  it('los colegios guardan sus niveles como grupos', async () => {
    const filas = await base.consulta("SELECT grupos, props FROM lugar WHERE categoria = 'educacion' ORDER BY orden LIMIT 50");
    for (const f of filas) expect(f.grupos).toEqual(Calculos.nivelesDe(f.props));
  });
  it('no hay ningún dato de SmartBus en la base (ADR 0005)', async () => {
    expect(await base.consulta("SELECT ruta FROM archivo_dato WHERE ruta ILIKE '%smartbus%'")).toEqual([]);
  });
});

describe('consultas espaciales base', () => {
  it('lugares a menos de N metros: los mismos que da la fuerza bruta sobre el archivo', async () => {
    const radio = 800;
    const deArchivo = leerDato('equipamiento/salud.geojson')
      .features.map((f: any) => ({ nombre: f.properties.nombre, d: Calculos.haversine(PLAZA.lat, PLAZA.lon, f.geometry.coordinates[1], f.geometry.coordinates[0]) }))
      .filter((x: any) => x.d <= radio)
      .sort((a: any, b: any) => a.d - b.d);
    const deBase = await lugaresCerca(base, PLAZA, 'salud', radio, { limite: 1000 });
    expect(deBase.map((l) => [l.nombre, l.distanciaM])).toEqual(deArchivo.map((x: any) => [x.nombre, x.d]));
    expect(deBase.length).toBeGreaterThan(0);
  });
  it('el más cercano de un nivel educativo coincide con la fuerza bruta', async () => {
    for (const nivel of ['inicial', 'primaria', 'secundaria']) {
      const mejor = leerDato('equipamiento/educacion.geojson')
        .features.filter((f: any) => Calculos.nivelesDe(f.properties).includes(nivel))
        .map((f: any) => Calculos.haversine(PLAZA.lat, PLAZA.lon, f.geometry.coordinates[1], f.geometry.coordinates[0]))
        .sort((a: number, b: number) => a - b)[0];
      expect((await lugarMasCercano(base, PLAZA, 'educacion', { grupo: nivel }))?.distanciaM).toBe(mejor);
    }
  });
  it('la distancia a un polígono es al borde y 0 si el punto está dentro', async () => {
    const parque = (await base.consulta("SELECT ST_Y(punto) AS lat, ST_X(punto) AS lon FROM lugar WHERE categoria = 'areasVerdes' AND area_m2 > 20000 ORDER BY orden LIMIT 1"))[0];
    const cerca = await lugaresCerca(base, parque, 'areasVerdes', 50);
    expect(cerca[0].distanciaM).toBe(0);
    expect(cerca[0].forma.type).toMatch(/Polygon/);
  });
  it('universidades: la UNSA está en el mapa y marcada como licenciada', async () => {
    const u = await lugaresCerca(base, PLAZA, 'educacion_superior', 5000, { grupo: 'universidad', limite: 100 });
    expect(u.some((x) => x.props.sunedu === 'Universidad Nacional de San Agustín')).toBe(true);
    expect(u.every((x) => x.fuenteId === 'sunedu_osm' && x.fecha)).toBe(true);
  });
  it('distrito, zona con su regla y manzana de la Plaza de Armas', async () => {
    expect((await distritoDe(base, PLAZA))?.nombre).toBe('AREQUIPA');
    const zona = await zonaDe(base, PLAZA);
    expect(zona?.codigo).toBeTruthy();
    expect(zona?.fuenteId).toBe('pdm_2016_2025');
    const m = await manzanaDe(base, { lat: -16.4012, lon: -71.5355 });
    if (m) expect(m.ubigeo).toMatch(/^0401\d\d$/);
  });
  it('un punto en el mar no tiene distrito, zona ni manzana', async () => {
    const mar = { lat: -17.2, lon: -72.5 };
    expect(await distritoDe(base, mar)).toBeNull();
    expect(await zonaDe(base, mar)).toBeNull();
    expect(await manzanaDe(base, mar)).toBeNull();
    expect(await lugaresCerca(base, mar, 'salud', 1000)).toEqual([]);
  });
  it('peligros de un punto: zonas volcánicas que lo contienen y cauces a 500 m', async () => {
    const p = await peligrosDe(base, PLAZA);
    for (const x of p) {
      expect(['volcanico', 'cauce', 'geologico']).toContain(x.clase);
      if (x.clase !== 'volcanico') expect(x.distanciaM).toBeLessThanOrEqual(500);
    }
    const lejos = await peligrosDe(base, PLAZA, { radioM: 20000, clases: ['cauce'] });
    expect(lejos.length).toBeGreaterThan(p.filter((x) => x.clase === 'cauce').length);
    expect(lejos.map((x) => x.distanciaM)).toEqual([...lejos.map((x) => x.distanciaM)].sort((a, b) => a - b));
  });
  it('concesión eléctrica: la Plaza de Armas está dentro de una', async () => {
    expect((await concesionesDe(base, PLAZA, 'electrica')).length).toBeGreaterThan(0);
  });
  it('rechaza un punto que no es un punto', async () => {
    await expect(lugaresCerca(base, { lat: Number.NaN, lon: 0 }, 'salud', 100)).rejects.toThrow(RangeError);
    await expect(distritoDe(base, { lat: 91, lon: 0 })).rejects.toThrow(RangeError);
  });
  it('cada fuente con datos tiene límite, y las abiertas tienen la licencia marcada', async () => {
    const todas = await fuentes(base);
    const osm = await fuente(base, 'osm');
    expect(osm).toMatchObject({ licencia: 'ODbL', licencia_verificada: true });
    expect((await fuente(base, 'escale'))?.licencia_verificada).toBe(false); // tarea 4.5: sin verificar
    expect((await fuente(base, 'nexo'))?.permite_publicar).toBe(false); // ADR 0002
    expect(todas.filter((f) => f.archivos > 0 && !f.limite)).toEqual([]);
    expect(await fuente(base, 'no_existe')).toBeNull();
  });
});

describe('capas por recorte', () => {
  const VENTANA: [number, number, number, number] = [-71.56, -16.42, -71.51, -16.38];
  it('las zonas de una ventana son muchas menos que el archivo y pesan menos', async () => {
    const total = leerDato('zonas_aqp.geojson').features.length;
    const r = await capaRecortada(base, 'zonas', VENTANA, 14);
    expect(r.features.length).toBeGreaterThan(0);
    expect(r.features.length).toBeLessThan(total);
    expect(JSON.stringify(r).length).toBeLessThan(700_000);
    expect(r.features[0].properties.codigo).toBeTruthy();
  });
  it('lejos no se sirve el censo: pide acercarse', async () => {
    expect(await capaRecortada(base, 'censo', VENTANA, 12)).toMatchObject({ recortada: true, requiereZoom: 15, features: [] });
    const cerca = await capaRecortada(base, 'censo', [-71.54, -16.402, -71.533, -16.396], 16);
    expect(cerca.features.length).toBeGreaterThan(0);
    expect(typeof cerca.features[0].properties.con_datos).toBe('boolean');
  });
  it('rutas, paraderos y lugares por categoría', async () => {
    expect((await capaRecortada(base, 'rutas', VENTANA, 13)).features.length).toBeGreaterThan(0);
    expect((await capaRecortada(base, 'paraderos', VENTANA, 14)).features.every((f) => f.geometry.type === 'Point')).toBe(true);
    const colegios = await capaRecortada(base, 'lugar:educacion', VENTANA, 14);
    expect(colegios.features.length).toBeGreaterThan(0);
    expect(colegios.features[0].properties.categoria).toBe('educacion');
  });
  it('entradas no válidas', async () => {
    await expect(capaRecortada(base, 'no_existe', VENTANA, 14)).rejects.toThrow(/desconocida/);
    await expect(capaRecortada(base, "lugar:x'; DROP TABLE lugar;--", VENTANA, 14)).rejects.toThrow(/no válida/);
    expect(() => validarCaja([1, 2, 3])).toThrow();
    expect(() => validarCaja([-71, -16, -72, -15])).toThrow();
    expect(() => validarCaja([-75, -20, -70, -15])).toThrow(/grande/);
    expect(tolerancia(16)).toBe(0);
    expect(tolerancia(10)).toBeGreaterThan(tolerancia(14));
  });
});
