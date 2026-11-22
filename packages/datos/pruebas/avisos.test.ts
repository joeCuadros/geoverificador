/**
 * Fase 3: ingesta de avisos contra PostGIS. La muestra de Nexo es real (test/fixtures/avisos/nexo-arequipa-muestra.html, recortada);
 * los avisos de `aviso()` son dobles escritos aquí para ejercitar duplicados, moneda y ciclo de vida.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enArequipa, type AvisoRecolectado } from '@geoverificador/dominio/avisos';
import type { Base } from '../src/cliente.ts';
import { avisoPorId, buscarAvisos, entornoDePunto, estadoDeAvisos, guardarTipoCambio, ingerirCorrida, tipoCambioVigente } from '../src/avisos.ts';
import { geocodificarLocal, geocodificarNominatim, textoDeAviso } from '../src/geocodificar.ts';
import { RAIZ, baseDePrueba, leerDato } from './apoyo.ts';

const require = createRequire(import.meta.url);
const Nexo = require(path.join(RAIZ, 'scripts/lib/avisos/fuentes/nexo.js'));
const DISTRITOS: string[] = leerDato('distritos_aqp.geojson').features.map((f: any) => f.properties.distrito);
const TC = { fecha: '2026-11-12', venta: 3.75, fuente: 'doble de prueba' };
const DIA1 = new Date('2026-11-12T10:00:00.000Z');

let n = 0;
const aviso = (extra: Partial<AvisoRecolectado>): AvisoRecolectado => ({
  fuente: 'urbania', id_fuente: `prueba-${++n}`, url: `https://urbania.pe/inmueble/prueba-${n}`, titulo: 'Departamento en venta en Yanahuara', tipo_inmueble: 'departamento', tipo_portal: 'Departamento',
  es_proyecto: false, precio: 420000, precio_max: null, moneda: 'PEN', area_total_m2: 95, area_construida_m2: 95, dormitorios: 3, dormitorios_max: null, banos: 2, estacionamientos: 1,
  distrito: 'YANAHUARA', zona: 'Yanahuara', direccion: null, lat: -16.3905, lon: -71.5435, fecha_publicacion: '2026-11-01', fecha_captura: DIA1.toISOString(), ...extra,
});

let base: Base;
beforeAll(async () => {
  base = await baseDePrueba();
  await base.consulta('DELETE FROM aviso');
  await base.consulta('DELETE FROM corrida_avisos');
  await guardarTipoCambio(base, TC);
});
afterAll(() => base?.cerrar());

describe('ingesta de la muestra real de Nexo', () => {
  it('guarda los proyectos, infiere su tipo y deja el reporte de la corrida', async () => {
    const html = fs.readFileSync(path.join(RAIZ, 'test/fixtures/avisos/nexo-arequipa-muestra.html'), 'utf8');
    const avisos: AvisoRecolectado[] = Nexo.parsear(html, { distritosConocidos: DISTRITOS, ahora: DIA1 });
    const r = await ingerirCorrida(base, avisos, { ahora: DIA1, fuentes: ['nexo'], tipoCambio: TC });
    expect(r).toMatchObject({ recibidos: avisos.length, aceptados: avisos.length, descartados: 0, nuevos: avisos.length, actualizados: 0, caidos: 0 });
    expect(r.porFuente.nexo.recibidos).toBe(avisos.length);
    const filas = await base.consulta("SELECT id_fuente, es_proyecto, primera_vez_visto, ultima_vez_visto, estado, url FROM aviso WHERE fuente_id = 'nexo'");
    expect(filas).toHaveLength(avisos.length);
    for (const f of filas) expect(f).toMatchObject({ es_proyecto: true, estado: 'vigente' });
    const corrida = (await base.consulta('SELECT recibidos, aceptados, reporte FROM corrida_avisos WHERE id = $1', [r.corridaId]))[0];
    expect(corrida.reporte.pctConCoordenadas).toBe(r.pctConCoordenadas);
    // Nexo no se publica mientras no haya respaldo legal (ADR 0002).
    expect((await buscarAvisos(base, {})).avisos).toEqual([]);
    expect((await buscarAvisos(base, { publicar: 'permitidas' })).avisos).toEqual([]);
    expect((await buscarAvisos(base, { publicar: 'todas' })).total).toBe(avisos.length);
  });
});

describe('moneda, historial y ciclo de vida', () => {
  it('guarda el precio original y su equivalente en soles con el tipo de cambio fechado', async () => {
    const a = aviso({ precio: 120000, moneda: 'USD' });
    await ingerirCorrida(base, [a], { ahora: DIA1, fuentes: ['urbania'], tipoCambio: TC });
    const f = (await base.consulta('SELECT precio, moneda, precio_pen, tipo_cambio, tipo_cambio_fecha::text AS fecha FROM aviso WHERE id_fuente = $1', [a.id_fuente]))[0];
    expect(f).toMatchObject({ moneda: 'USD', fecha: '2026-11-12' });
    expect(Number(f.precio)).toBe(120000);
    expect(Number(f.precio_pen)).toBe(450000);
    expect(Number(f.tipo_cambio)).toBe(3.75);
  });
  it('sin tipo de cambio que sirva, el equivalente en soles queda vacío y el aviso no entra a una búsqueda por precio', async () => {
    const a = aviso({ precio: 99000, moneda: 'USD' });
    const r = await ingerirCorrida(base, [a], { ahora: DIA1, fuentes: ['urbania'], tipoCambio: { ...TC, fecha: '2026-09-01' } });
    expect(r.sinPrecioEnSoles).toBe(1);
    const hallados = await buscarAvisos(base, { publicar: 'todas', precioMaxPen: 10_000_000 });
    expect(hallados.avisos.some((x) => x.url === a.url)).toBe(false);
  });
  it('un cambio de precio agrega una fila al historial y conserva la primera vez visto', async () => {
    const a = aviso({ precio: 400000 });
    await ingerirCorrida(base, [a], { ahora: DIA1, fuentes: ['urbania'], tipoCambio: TC });
    const dia5 = new Date('2026-11-16T10:00:00.000Z');
    const r = await ingerirCorrida(base, [{ ...a, precio: 385000 }], { ahora: dia5, fuentes: ['urbania'], tipoCambio: TC });
    expect(r).toMatchObject({ nuevos: 0, actualizados: 1, cambiosDePrecio: 1 });
    const f = (await base.consulta('SELECT id, precio, primera_vez_visto, ultima_vez_visto FROM aviso WHERE id_fuente = $1', [a.id_fuente]))[0];
    expect(new Date(f.primera_vez_visto).toISOString()).toBe(DIA1.toISOString());
    expect(new Date(f.ultima_vez_visto).toISOString()).toBe(dia5.toISOString());
    const historial = await base.consulta('SELECT precio FROM aviso_precio WHERE aviso_id = $1 ORDER BY visto_en', [f.id]);
    expect(historial.map((h) => Number(h.precio))).toEqual([400000, 385000]);
    // La misma corrida otra vez no duplica el historial.
    await ingerirCorrida(base, [{ ...a, precio: 385000 }], { ahora: dia5, fuentes: ['urbania'], tipoCambio: TC });
    expect(await base.consulta('SELECT 1 FROM aviso_precio WHERE aviso_id = $1', [f.id])).toHaveLength(2);
  });
  it('lo que una fuente deja de mostrar 14 días se marca caído; lo de otra fuente no se toca; si reaparece, vuelve a vigente', async () => {
    const dia20 = new Date('2026-12-02T10:00:00.000Z');
    const nuevo = aviso({});
    const r = await ingerirCorrida(base, [nuevo], { ahora: dia20, fuentes: ['urbania'], tipoCambio: null });
    expect(r.caidos).toBeGreaterThan(0);
    expect((await base.consulta("SELECT count(*)::int AS n FROM aviso WHERE fuente_id = 'nexo' AND estado = 'caido'"))[0].n).toBe(0);
    const caido = (await base.consulta("SELECT id_fuente, url FROM aviso WHERE fuente_id = 'urbania' AND estado = 'caido' LIMIT 1"))[0];
    expect((await buscarAvisos(base, { publicar: 'todas' })).avisos.some((x) => x.url === caido.url)).toBe(false);
    await ingerirCorrida(base, [aviso({ id_fuente: caido.id_fuente, url: caido.url })], { ahora: new Date('2026-12-03T10:00:00.000Z'), fuentes: ['urbania'], tipoCambio: null });
    expect((await base.consulta('SELECT estado, caido_en FROM aviso WHERE id_fuente = $1', [caido.id_fuente]))[0]).toMatchObject({ estado: 'vigente', caido_en: null });
  });
  it('descarta lo que no puede ser un aviso de Arequipa y lo cuenta en el reporte', async () => {
    const r = await ingerirCorrida(base, [aviso({ lat: 25.76, lon: -80.19 }), aviso({ url: 'javascript:alert(1)' }), aviso({ moneda: null })], { ahora: DIA1, fuentes: [], tipoCambio: TC });
    expect(r).toMatchObject({ recibidos: 3, aceptados: 0, descartados: 3 });
    expect(r.motivosDescarte).toEqual({ 'coordenada fuera de Arequipa': 1, 'enlace no válido': 1, 'precio sin moneda': 1 });
  });
  it('una corrida que falla a la mitad no deja nada escrito', async () => {
    const antes = (await base.consulta('SELECT count(*)::int AS n FROM aviso'))[0].n;
    const malo = aviso({ dormitorios: 'tres' as any });
    await expect(ingerirCorrida(base, [aviso({}), malo], { ahora: DIA1, fuentes: ['urbania'], tipoCambio: TC })).rejects.toThrow();
    expect((await base.consulta('SELECT count(*)::int AS n FROM aviso'))[0].n).toBe(antes);
  });
});

describe('duplicados entre portales, coordenadas y entorno', () => {
  const HOY = new Date('2026-12-10T10:00:00.000Z');
  it('el mismo inmueble en dos portales sale una sola vez, con el otro portal anotado', async () => {
    const a = aviso({ fuente: 'urbania', precio: 515000, area_construida_m2: 110, area_total_m2: 110, lat: -16.3921, lon: -71.5449 });
    const b = aviso({ fuente: 'adondevivir', url: 'https://www.adondevivir.com/propiedades/prueba-x', precio: 518000, area_construida_m2: 111, area_total_m2: 111, lat: -16.3922, lon: -71.545 });
    const r = await ingerirCorrida(base, [a, b], { ahora: HOY, fuentes: ['urbania', 'adondevivir'], tipoCambio: null });
    expect(r.duplicadosEntrePortales).toBeGreaterThanOrEqual(2);
    const hallados = (await buscarAvisos(base, { publicar: 'todas', precioMaxPen: 520000, limite: 200 })).avisos.filter((x) => [a.url, b.url].includes(x.url));
    expect(hallados).toHaveLength(1);
    expect(hallados[0].tambienEn).toHaveLength(1);
  });
  it('un aviso con coordenadas queda con su ficha de entorno: cada criterio con valor, fuente y nota', async () => {
    const a = aviso({ lat: -16.3988, lon: -71.537 });
    await ingerirCorrida(base, [a], { ahora: HOY, fuentes: ['urbania'], tipoCambio: null });
    const hallado = (await buscarAvisos(base, { publicar: 'todas', cerca: { lat: -16.3988, lon: -71.537, radioM: 50 } })).avisos.find((x) => x.url === a.url)!;
    expect(hallado.distanciaM).toBeLessThan(5);
    const c = hallado.criterios!;
    expect(Object.keys(c)).toEqual(expect.arrayContaining(['colegio', 'universidad', 'mall', 'salud', 'paradero', 'agua', 'luz', 'zona', 'peligro_volcanico']));
    for (const k of ['colegio', 'universidad', 'mall', 'salud', 'paradero']) {
      expect(typeof c[k].valor).toBe('number');
      expect(c[k].referencia).toBeTruthy();
      expect(c[k].nota).toMatch(/línea recta/);
    }
    expect(c.agua.nota).toMatch(/censo de 2017/);
    expect(await avisoPorId(base, hallado.id)).toBeNull(); // sin permiso de publicación no se entrega
    expect((await avisoPorId(base, hallado.id, 'todas'))?.criterios?.colegio.valor).toBe(c.colegio.valor);
    const directo = await entornoDePunto(base, { lat: -16.3988, lon: -71.537 });
    expect(directo.colegio.valor).toBe(c.colegio.valor);
  });
  it('sin coordenadas se geocodifica la dirección; si la precisión no alcanza, queda sin punto y sin entorno', async () => {
    const conDireccion = aviso({ lat: null, lon: null, direccion: 'Calle Misti 300', zona: 'Yanahuara' });
    const soloZona = aviso({ lat: null, lon: null, direccion: null, zona: 'Heresi, Cayma', distrito: 'CAYMA' });
    const geocodificar = async (texto: string) =>
      texto.startsWith('Calle Misti') ? { nombre: texto, lat: -16.3899, lon: -71.5412, precisionM: 30, origen: 'nominatim' as const, categoria: 'house', distrito: null, fuenteId: 'osm' } : { nombre: texto, lat: -16.36, lon: -71.55, precisionM: 1200, origen: 'nominatim' as const, categoria: 'suburb', distrito: null, fuenteId: 'osm' };
    const r = await ingerirCorrida(base, [conDireccion, soloZona], { ahora: HOY, fuentes: ['urbania'], tipoCambio: null, geocodificar });
    expect(r.geocodificados).toBe(1);
    const f1 = (await base.consulta('SELECT origen_coordenada, precision_m, zona, (SELECT count(*) FROM aviso_entorno e WHERE e.aviso_id = aviso.id)::int AS entorno FROM aviso WHERE id_fuente = $1', [conDireccion.id_fuente]))[0];
    expect(f1).toMatchObject({ origen_coordenada: 'geocodificada', precision_m: 30, entorno: 1 });
    const f2 = (await base.consulta('SELECT punto, zona, (SELECT count(*) FROM aviso_entorno e WHERE e.aviso_id = aviso.id)::int AS entorno FROM aviso WHERE id_fuente = $1', [soloZona.id_fuente]))[0];
    expect(f2).toMatchObject({ punto: null, zona: 'Heresi, Cayma', entorno: 0 }); // la zona se conserva tal como la publica el portal (3.3)
  });
  it('estado frente al criterio de «hecho» de la fase 3', async () => {
    const e = await estadoDeAvisos(base);
    expect(e.vigentes).toBeGreaterThan(0);
    expect(e.pctConCoordenadas).toBeGreaterThan(0);
    expect(e.ultimaCorrida).toBeTruthy();
    expect(await tipoCambioVigente(base, '2026-11-11')).toBeNull();
    expect(await tipoCambioVigente(base, '2026-11-20')).toMatchObject({ fecha: '2026-11-12', venta: 3.75 });
  });
});

describe('geocodificación', () => {
  it('la caja de Arequipa contiene a los 25 distritos', () => {
    const ver = (c: any): void => (typeof c[0] === 'number' ? expect(enArequipa(c[1], c[0])).toBe(true) : c.forEach(ver));
    for (const f of leerDato('distritos_aqp.geojson').features) ver(f.geometry.coordinates);
  });
  it('por nombre, con los datos locales: destino, universidad, mall, distrito', async () => {
    expect((await geocodificarLocal(base, 'Parque Industrial'))[0]).toMatchObject({ origen: 'destino', lat: -16.4179, lon: -71.5497 });
    const ucsp = await geocodificarLocal(base, 'Universidad Católica San Pablo');
    expect(ucsp[0]).toMatchObject({ origen: 'lugar', categoria: 'educacion_superior', nombre: 'Universidad Católica San Pablo' });
    expect(ucsp[0].precisionM).toBeLessThanOrEqual(500);
    expect((await geocodificarLocal(base, 'UNSA')).length).toBeGreaterThan(0);
    const cayma = await geocodificarLocal(base, 'Cayma');
    expect(cayma.find((x) => x.origen === 'distrito')?.precisionM).toBeGreaterThan(500); // un distrito no ubica un inmueble
    expect(await geocodificarLocal(base, 'zzzz qqqq')).toEqual([]);
    expect(await geocodificarLocal(base, "x'; DROP TABLE lugar; --")).toEqual([]);
  });
  it('Nominatim: restringe a Arequipa, se identifica y descarta lo que cae fuera', async () => {
    const llamadas: any[] = [];
    const fetch = (respuesta: any) => async (url: string, init: any) => {
      llamadas.push({ url, init });
      return { ok: true, status: 200, json: async () => respuesta };
    };
    const r = await geocodificarNominatim('Calle Misti 300, Yanahuara', { fetch: fetch([{ lat: '-16.3899', lon: '-71.5412', addresstype: 'building', display_name: 'Calle Misti 300, Yanahuara, Arequipa', address: { city_district: 'Yanahuara' } }]) });
    expect(r).toMatchObject({ lat: -16.3899, lon: -71.5412, precisionM: 30, origen: 'nominatim', distrito: 'Yanahuara' });
    expect(llamadas[0].url).toMatch(/bounded=1/);
    expect(llamadas[0].url).toMatch(/viewbox=-71\.92,-15\.92,-70\.8,-16\.79/);
    expect(llamadas[0].init.headers['User-Agent']).toMatch(/geoverificador/);
    expect(await geocodificarNominatim('Brickell Avenue', { fetch: fetch([{ lat: '25.76', lon: '-80.19' }]) })).toBeNull();
    expect(await geocodificarNominatim('nada', { fetch: fetch([]) })).toBeNull();
    await expect(geocodificarNominatim('Calle Misti', { fetch: async () => ({ ok: false, status: 429, json: async () => ({}) }) })).rejects.toThrow(/429/);
  });
  it('texto que se geocodifica para un aviso', () => {
    expect(textoDeAviso({ direccion: 'Calle Misti 300', zona: 'Heresi, Cayma', distrito: 'CAYMA' })).toBe('Calle Misti 300, Heresi, Cayma');
    expect(textoDeAviso({ direccion: null, zona: 'Umacollo', distrito: 'YANAHUARA' })).toBe('Umacollo, YANAHUARA');
    expect(textoDeAviso({ direccion: null, zona: null, distrito: 'CAYMA' })).toBeNull();
  });
});
