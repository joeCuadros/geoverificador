import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AvisoRecolectado } from '@geoverificador/dominio/avisos';
import type { Base } from '@geoverificador/datos/cliente';
import { guardarTipoCambio, ingerirCorrida } from '@geoverificador/datos/avisos';
import { baseDePrueba } from '../../datos/pruebas/apoyo.ts';
import { ESTADO_INICIAL, responder, type Proveedor } from '../src/agente.ts';
import { ejecutar, olvidarMemoria } from '../src/herramientas.ts';

const HOY = '2026-11-12';
const DIA = new Date('2026-11-12T10:00:00.000Z');
let n = 0;
const aviso = (extra: Partial<AvisoRecolectado>): AvisoRecolectado => ({
  fuente: 'urbania', id_fuente: `agente-${++n}`, url: `https://urbania.pe/inmueble/agente-${n}`, titulo: `Departamento ${n}`, tipo_inmueble: 'departamento', tipo_portal: 'Departamento', es_proyecto: false,
  precio: 400000, precio_max: null, moneda: 'PEN', area_total_m2: 90, area_construida_m2: 90, dormitorios: 3, dormitorios_max: null, banos: 2, estacionamientos: 1, distrito: 'YANAHUARA', zona: 'Yanahuara',
  direccion: null, lat: -16.3905, lon: -71.5435, fecha_publicacion: '2026-11-01', fecha_captura: DIA.toISOString(), ...extra,
});

let base: Base;
const ctx = () => ({ base, hoy: HOY, publicar: 'todas' as const });
beforeAll(async () => {
  olvidarMemoria();
  base = await baseDePrueba();
  await base.consulta('DELETE FROM aviso');
  await base.consulta('DELETE FROM corrida_avisos');
  await guardarTipoCambio(base, { fecha: HOY, venta: 3.75, fuente: 'doble de prueba' });
  await ingerirCorrida(base, [aviso({ precio: 400000 }), aviso({ precio: 900000 }), aviso({ tipo_inmueble: 'casa', precio: 300000 })], { ahora: DIA, fuentes: ['urbania'], tipoCambio: { fecha: HOY, venta: 3.75, fuente: 'doble de prueba' } });
});
afterAll(() => base?.cerrar());

describe('herramientas', () => {
  it('rechaza una entrada que no cumple el esquema', async () => {
    await expect(ejecutar('geocodificar_lugar', { texto: '' }, ctx())).rejects.toThrow();
  });
  it('exige la moneda cuando hay precio máximo', async () => {
    await expect(ejecutar('buscar_avisos', { tipo: 'departamento', precioMax: 500000, criterios: [] }, ctx())).rejects.toThrow(/moneda/i);
  });
  it('geocodifica un lugar conocido', async () => {
    const r = await ejecutar('geocodificar_lugar', { texto: 'Plaza de Armas' }, ctx());
    expect(r.candidatos.length).toBeGreaterThan(0);
  });
});

describe('el ciclo del agente', () => {
  it('saluda y explica qué puede hacer', async () => {
    const r = await responder('hola', ESTADO_INICIAL, ctx());
    expect(r.tipo).toBe('info');
    expect(r.herramientas).toHaveLength(0);
  });
  it('pregunta una sola cosa cuando falta el trabajo', async () => {
    const r = await responder('Quiero un departamento cerca de mi trabajo y que no cueste más de medio millón', ESTADO_INICIAL, ctx());
    expect(r.tipo).toBe('pregunta');
    expect(r.estado.pendiente).toBe('trabajo');
    expect(r.herramientas).toHaveLength(0);
  });
  it('busca avisos y cada cifra del texto sale de una herramienta', async () => {
    const r = await responder('un departamento en Yanahuara cerca de un colegio hasta 450 mil soles', ESTADO_INICIAL, ctx());
    expect(r.tipo).toBe('resultado');
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0].precio).toBe(400000);
    expect(r.herramientas.some((h) => h.nombre === 'buscar_avisos')).toBe(true);
    for (const a of r.avisos) expect(r.texto).toContain(a.url);
  });
  it('descarta el texto de un modelo que inventa una cifra', async () => {
    const mentiroso: Proveedor = { nombre: 'mentiroso', redactar: async () => 'Hay un departamento perfecto a 123 m del colegio por S/ 777 777.' };
    const r = await responder('un departamento en Yanahuara hasta 450 mil soles', ESTADO_INICIAL, ctx(), mentiroso);
    expect(r.descartadoPorVerificacion).toBe(true);
    expect(r.texto).not.toContain('777');
  });
});
