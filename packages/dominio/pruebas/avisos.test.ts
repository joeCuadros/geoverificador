import { describe, expect, it } from 'vitest';
import { agruparDuplicados, enArequipa, equivalenteEnSoles, inferirTipo, mismoInmueble, motivoDescarte, parecidoDeTitulos, resumirCorrida, type AvisoComparable, type AvisoRecolectado } from '../src/avisos.ts';
import { decirDistancia, decirSoles, lista, normalizar } from '../src/texto.ts';

const TC = { fecha: '2026-11-12', venta: 3.75, fuente: 'prueba' };

describe('inferirTipo (3.3)', () => {
  it('respeta el tipo del portal', () => {
    expect(inferirTipo({ tipo_inmueble: 'casa', titulo: 'Departamento', tipo_portal: null })).toEqual({ tipo: 'casa', inferido: false });
  });
  it('lo saca del título de un proyecto y lo marca como inferido', () => {
    expect(inferirTipo({ tipo_inmueble: null, titulo: 'Edificio Mirador de Cayma', tipo_portal: null })).toEqual({ tipo: 'departamento', inferido: true });
    expect(inferirTipo({ tipo_inmueble: null, titulo: 'Lotes en Habilitación Urbana El Sol', tipo_portal: null })).toEqual({ tipo: 'terreno', inferido: true });
    expect(inferirTipo({ tipo_inmueble: null, titulo: 'Condominio Las Casuarinas', tipo_portal: 'Proyecto' }).tipo).toBe('departamento');
  });
  it('no adivina: título ambiguo o sin pista', () => {
    expect(inferirTipo({ tipo_inmueble: null, titulo: 'Casas y departamentos en Sachaca', tipo_portal: null })).toEqual({ tipo: null, inferido: false });
    expect(inferirTipo({ tipo_inmueble: null, titulo: 'Proyecto Altos del Misti', tipo_portal: null })).toEqual({ tipo: null, inferido: false });
    expect(inferirTipo({ tipo_inmueble: null, titulo: null, tipo_portal: null }).tipo).toBeNull();
  });
});

describe('equivalenteEnSoles (3.4)', () => {
  it('soles quedan igual, sin tipo de cambio', () => {
    expect(equivalenteEnSoles(450000, 'PEN', '2026-11-12', null)).toEqual({ precioPen: 450000, tipoCambio: null, tipoCambioFecha: null });
  });
  it('dólares por la cotización de venta, con su fecha', () => {
    expect(equivalenteEnSoles(120000, 'USD', '2026-11-14', TC)).toEqual({ precioPen: 450000, tipoCambio: 3.75, tipoCambioFecha: '2026-11-12' });
  });
  it('sin cotización, o con una de hace más de 7 días, no convierte', () => {
    expect(equivalenteEnSoles(120000, 'USD', '2026-11-12', null).precioPen).toBeNull();
    expect(equivalenteEnSoles(120000, 'USD', '2026-11-20', TC).precioPen).toBeNull();
    expect(equivalenteEnSoles(120000, 'USD', '2026-11-19', TC).precioPen).toBe(450000);
  });
  it('sin precio o sin moneda no hay equivalente', () => {
    expect(equivalenteEnSoles(null, 'PEN', '2026-11-12', TC).precioPen).toBeNull();
    expect(equivalenteEnSoles(100, null, '2026-11-12', TC).precioPen).toBeNull();
    expect(equivalenteEnSoles(0, 'PEN', '2026-11-12', TC).precioPen).toBeNull();
  });
});

const c = (extra: Partial<AvisoComparable>): AvisoComparable => ({ id: 1, fuente: 'urbania', tipo: 'departamento', esProyecto: false, precioPen: 500000, areaM2: 100, dormitorios: 3, distrito: 'CAYMA', titulo: 'Departamento con vista en Cayma', lat: -16.38, lon: -71.55, ...extra });

describe('mismoInmueble y agruparDuplicados (3.5)', () => {
  it('mismo tipo, precio ±2 %, área ±3 % y a 100 m o menos en otro portal', () => {
    expect(mismoInmueble(c({}), c({ id: 2, fuente: 'adondevivir', precioPen: 505000, areaM2: 102, lat: -16.3803, lon: -71.5502 }))).toBe(true);
  });
  it('no lo es si es la misma fuente, otro tipo, otro precio, otra área, lejos o con otros dormitorios', () => {
    const b = c({ id: 2, fuente: 'adondevivir' });
    expect(mismoInmueble(c({}), { ...b, fuente: 'urbania' })).toBe(false);
    expect(mismoInmueble(c({}), { ...b, tipo: 'casa' })).toBe(false);
    expect(mismoInmueble(c({}), { ...b, precioPen: 530000 })).toBe(false);
    expect(mismoInmueble(c({}), { ...b, areaM2: 110 })).toBe(false);
    expect(mismoInmueble(c({}), { ...b, lat: -16.39 })).toBe(false);
    expect(mismoInmueble(c({}), { ...b, dormitorios: 2 })).toBe(false);
    expect(mismoInmueble(c({}), { ...b, esProyecto: true })).toBe(false);
  });
  it('sin precio o sin área no afirma nada', () => {
    expect(mismoInmueble(c({ precioPen: null }), c({ id: 2, fuente: 'adondevivir', precioPen: null }))).toBe(false);
    expect(mismoInmueble(c({ areaM2: null }), c({ id: 2, fuente: 'adondevivir' }))).toBe(false);
  });
  it('sin coordenadas exige el mismo distrito y títulos parecidos', () => {
    const a = c({ lat: null, lon: null });
    expect(mismoInmueble(a, c({ id: 2, fuente: 'adondevivir', lat: null, lon: null, titulo: 'Departamento con vista, Cayma' }))).toBe(true);
    expect(mismoInmueble(a, c({ id: 2, fuente: 'adondevivir', lat: null, lon: null, titulo: 'Dúplex de estreno cerca al puente' }))).toBe(false);
    expect(mismoInmueble(a, c({ id: 2, fuente: 'adondevivir', lat: null, lon: null, distrito: 'YANAHUARA' }))).toBe(false);
  });
  it('agrupa por transitividad y deja fuera a los que no tienen duplicado', () => {
    const grupos = agruparDuplicados([c({ id: 10 }), c({ id: 11, fuente: 'adondevivir', precioPen: 505000 }), c({ id: 12, fuente: 'nexo', precioPen: 508000 }), c({ id: 13, fuente: 'nexo', precioPen: 900000 })]);
    expect([...grupos.entries()].sort()).toEqual([[10, 10], [11, 10], [12, 10]]);
    expect(agruparDuplicados([])).toEqual(new Map());
  });
  it('parecido de títulos', () => {
    expect(parecidoDeTitulos('Vendo lindo departamento en Cayma', 'Departamento Cayma')).toBe(1);
    expect(parecidoDeTitulos('Casa', null)).toBe(0);
  });
});

const r = (extra: Partial<AvisoRecolectado>): AvisoRecolectado => ({
  fuente: 'nexo', id_fuente: '1', url: 'https://nexoinmobiliario.pe/proyecto/1', titulo: 'Edificio A', tipo_inmueble: null, tipo_portal: null, es_proyecto: true, precio: 300000, precio_max: null, moneda: 'PEN',
  area_total_m2: 80, area_construida_m2: null, dormitorios: 2, dormitorios_max: 3, banos: 2, estacionamientos: null, distrito: 'CAYMA', zona: 'Cayma', direccion: null, lat: -16.38, lon: -71.55, fecha_publicacion: null, fecha_captura: '2026-11-12T10:00:00.000Z', ...extra,
});

describe('reporte de corrida (3.8)', () => {
  it('motivos de descarte', () => {
    expect(motivoDescarte(r({}))).toBeNull();
    expect(motivoDescarte(r({ id_fuente: '' }))).toBe('sin identificador o enlace');
    expect(motivoDescarte(r({ url: 'ftp://x' }))).toBe('enlace no válido');
    expect(motivoDescarte(r({ lat: 25.7, lon: -80.2 }))).toBe('coordenada fuera de Arequipa');
    expect(motivoDescarte(r({ moneda: null }))).toBe('precio sin moneda');
    expect(enArequipa(-16.4, -71.54)).toBe(true);
  });
  it('cuenta recibidos, descartados, sin coordenadas, sin distrito y por fuente', () => {
    const recibidos = [r({}), r({ id_fuente: '2', lat: null, lon: null }), r({ id_fuente: '3', distrito: null, fuente: 'urbania', titulo: 'Proyecto X' }), r({ id_fuente: '4', lat: 25.7, lon: -80.2 })];
    const rep = resumirCorrida(recibidos, recibidos.filter((a) => motivoDescarte(a) === null));
    expect(rep).toMatchObject({ recibidos: 4, aceptados: 3, descartados: 1, sinCoordenadas: 1, sinDistrito: 1, sinTipo: 1, distritos: ['CAYMA'], pctConCoordenadas: 66.7 });
    expect(rep.porFuente).toEqual({ nexo: { recibidos: 3, aceptados: 2, sinCoordenadas: 1 }, urbania: { recibidos: 1, aceptados: 1, sinCoordenadas: 0 } });
    expect(resumirCorrida([], []).pctConCoordenadas).toBeNull();
  });
});

describe('texto', () => {
  it('normaliza, lista y dice cifras', () => {
    expect(normalizar('  Universidad Católica,  San Pablo ')).toBe('universidad catolica san pablo');
    expect(lista(['a'])).toBe('a');
    expect(lista(['a', 'b', 'c'])).toBe('a, b y c');
    expect(decirDistancia(349.6)).toBe('350 m');
    expect(decirDistancia(1240)).toBe('1,2 km');
    expect(decirSoles(450000)).toBe('S/ 450 000');
  });
});
