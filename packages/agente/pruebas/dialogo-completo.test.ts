/**
 * La conversación completa contra la base de pruebas: herramientas nuevas, erratas, respuestas vagas, seguimientos, sin resultados,
 * el punto del mapa y la comparación. Los tres avisos de prueba: dos departamentos en Yanahuara (S/ 400 000 y S/ 900 000) y una casa (S/ 300 000).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AvisoRecolectado } from '@geoverificador/dominio/avisos';
import type { Base } from '@geoverificador/datos/cliente';
import { guardarTipoCambio, ingerirCorrida } from '@geoverificador/datos/avisos';
import { baseDePrueba } from '../../datos/pruebas/apoyo.ts';
import { ESTADO_INICIAL, responder } from '../src/agente.ts';
import { ejecutar, olvidarMemoria } from '../src/herramientas.ts';

const HOY = '2026-11-12';
const DIA = new Date('2026-11-12T10:00:00.000Z');
let n = 0;
const aviso = (extra: Partial<AvisoRecolectado>): AvisoRecolectado => ({
  fuente: 'urbania', id_fuente: `dialogo-${++n}`, url: `https://urbania.pe/inmueble/dialogo-${n}`, titulo: `Departamento ${n}`, tipo_inmueble: 'departamento', tipo_portal: 'Departamento', es_proyecto: false,
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
  await ingerirCorrida(base, [aviso({ precio: 400000 }), aviso({ precio: 900000, lat: -16.3935, lon: -71.5465 }), aviso({ tipo_inmueble: 'casa', precio: 300000 })], { ahora: DIA, fuentes: ['urbania'], tipoCambio: { fecha: HOY, venta: 3.75, fuente: 'doble de prueba' } });
});
afterAll(() => base?.cerrar());

describe('las herramientas nuevas', () => {
  it('cobertura_avisos dice cuántos avisos y distritos hay y desde cuándo, y no cuenta nada si la publicación está apagada', async () => {
    const c = await ejecutar('cobertura_avisos', {}, ctx());
    expect(c.publicacionActiva).toBe(true);
    expect(c.vigentes).toBe(3);
    expect(c.distritos).toEqual([{ nombre: 'YANAHUARA', total: 3 }]);
    expect(c.tipos.map((t) => t.tipo).sort()).toEqual(['casa', 'departamento']);
    expect(c.ultimaVez).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const apagada = await ejecutar('cobertura_avisos', {}, { ...ctx(), publicar: 'ninguna' });
    expect(apagada).toMatchObject({ publicacionActiva: false, vigentes: 0, distritos: [] });
  });
  it('diagnosticar_filtros dice cuántos avisos habría al quitar cada filtro y cuánto cuesta el más barato', async () => {
    const d = await ejecutar('diagnosticar_filtros', { tipo: 'casa', distrito: 'YANAHUARA', precioMax: 100000, moneda: 'PEN' }, ctx());
    expect(d.total).toBe(0);
    const sinPrecio = d.sinFiltro.find((x) => x.filtro === 'precio')!;
    expect(sinPrecio.total).toBe(1);
    expect(sinPrecio.precioMinimoPen).toBe(300000);
    expect(d.sinFiltro.find((x) => x.filtro === 'tipo')!.total).toBe(0);
    expect(d.sinFiltro.find((x) => x.filtro === 'distrito')!.total).toBe(0);
  });
  it('ficha_de_punto trae lo medido en el punto con su fuente y su fecha', async () => {
    const f = await ejecutar('ficha_de_punto', { lat: -16.39883, lon: -71.53697 }, ctx());
    expect(f.distrito).toBe('AREQUIPA');
    const salud = f.filas.find((x) => x.etiqueta === 'Salud')!;
    expect(salud).toMatchObject({ estado: 'cumple' });
    expect(salud.distanciaM).toBeGreaterThan(0);
    expect(salud.fuente).toContain('RENIPRESS');
    expect(salud.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(f.zona?.codigo).toBeTruthy();
  });
});

describe('la conversación de punta a punta', () => {
  const dicho = (r: Awaited<ReturnType<typeof responder>>) => `${r.titular}\n${r.texto}`;

  it('el mensaje de la persona que se quejó: entiende las erratas, ubica los dos lugares y busca', async () => {
    const r = await responder('quiero un aprtamente cerca a la unsa y a mi trabajo en  el parquie idnustrial', ESTADO_INICIAL, ctx());
    expect(r.tipo).toBe('resultado');
    expect(r.consulta?.tipo).toBe('departamento');
    const busqueda = r.herramientas.find((h) => h.nombre === 'buscar_avisos')!;
    expect((busqueda.entrada as any).trabajo.nombre).toBe('Parque Industrial');
    expect((busqueda.entrada as any).lugar.nombre).toMatch(/San Agust/i);
    expect(r.correcciones).toEqual(expect.arrayContaining([{ dicho: 'aprtamente', entendido: 'apartamento' }, { dicho: 'parquie idnustrial', entendido: 'Parque Industrial' }]));
    expect(r.titular).toContain('Entendí «parquie idnustrial» como «Parque Industrial»');
    expect(r.entendido.map((c) => c.clave)).toEqual(expect.arrayContaining(['tipo', 'trabajo', 'lugar']));
    expect(r.resultados?.tarjetas.length).toBeGreaterThan(0);
    expect(r.estado.consulta?.trabajoLugar).toBe('Parque Industrial');
  });

  it('el chat de la queja, turno por turno: nada se pierde y siempre avanza', async () => {
    const t1 = await responder('quiero algo cerca a la unsa y a mi trabajo en  el parquie idnustrial', ESTADO_INICIAL, ctx());
    expect(t1.tipo).toBe('pregunta');
    expect(t1.estado.pendiente).toBe('tipo');
    expect(t1.sugerencias.map((s) => s.texto)).toEqual(expect.arrayContaining(['Departamento', 'Casa', 'Cualquiera']));
    const t2 = await responder('departamente', t1.estado, ctx());
    expect(t2.tipo).toBe('resultado');
    expect(t2.consulta?.tipo).toBe('departamento');
    expect(t2.entendido.map((c) => c.clave)).toEqual(expect.arrayContaining(['tipo', 'trabajo', 'lugar']));
    expect(t2.estado.pendiente).toBeNull();
    expect(t2.avisos.length).toBeGreaterThan(0);
  });

  it('«cualquiera» como tipo busca de todos los tipos y lo dice', async () => {
    const t1 = await responder('quiero algo en Yanahuara', ESTADO_INICIAL, ctx());
    expect(t1.estado.pendiente).toBe('tipo');
    const t2 = await responder('cualquiera', t1.estado, ctx());
    expect(t2.tipo).toBe('resultado');
    expect(t2.avisos).toHaveLength(3);
    expect(t2.entendido.find((c) => c.clave === 'tipo')?.valor).toBe('Cualquier tipo');
  });

  it('jamás contesta dos veces seguidas con el mismo texto de ayuda y siempre ofrece opciones', async () => {
    let estado = ESTADO_INICIAL;
    const vistos = new Set<string>();
    for (const m of ['asdf qwer', 'zxcv uiop', 'qwerty']) {
      const r = await responder(m, estado, ctx());
      expect(r.tipo).toBe('info');
      expect(r.sugerencias.length).toBeGreaterThanOrEqual(3);
      expect(r.titular).toMatch(/entend|interpret|concret/i);
      expect(vistos.has(r.titular), r.titular).toBe(false);
      vistos.add(r.titular);
      estado = r.estado;
    }
  });

  it('cuando no entiende, dice lo que sí entendió hasta ahora', async () => {
    const t1 = await responder('un departamento en Yanahuara cerca de un colegio hasta 450 mil soles', ESTADO_INICIAL, ctx());
    const t2 = await responder('xxxx yyyy', t1.estado, ctx());
    expect(t2.tipo).toBe('info');
    expect(t2.titular).toMatch(/Departamento/i);
    expect(t2.titular).toMatch(/Yanahuara/i);
    expect(t2.estado.consulta).toEqual(t1.estado.consulta);
  });

  it('una respuesta que no sirve repite la pregunta con otras palabras y ofrece las opciones', async () => {
    const t1 = await responder('quiero algo en Yanahuara', ESTADO_INICIAL, ctx());
    const t2 = await responder('pues eso mismo', t1.estado, ctx());
    expect(t2.tipo).toBe('pregunta');
    expect(t2.estado.pendiente).toBe('tipo');
    expect(t2.titular).not.toBe(t1.titular);
    expect(t2.sugerencias.map((s) => s.texto)).toContain('Departamento');
  });

  it('sin resultados dice qué filtro los excluyó y ofrece quitarlo con un toque', async () => {
    const r = await responder('una casa en Yanahuara hasta 100 mil soles', ESTADO_INICIAL, ctx());
    expect(r.tipo).toBe('vacio');
    expect(r.avisos).toEqual([]);
    expect(r.titular).toMatch(/tope de precio/i);
    expect(r.titular).toContain('S/ 300 000');
    expect(r.texto).toContain('Ningún aviso vigente cumple los filtros');
    const alivio = r.sugerencias.find((s) => s.ajuste?.accion === 'quitar' && s.ajuste.campo === 'precio');
    expect(alivio).toBeTruthy();
    const siguiente = await responder(alivio!.texto, r.estado, ctx(), null, { ajuste: alivio!.ajuste });
    expect(siguiente.tipo).toBe('resultado');
    expect(siguiente.avisos.map((a) => a.precio)).toEqual([300000]);
  });

  it('el seguimiento «y más barato» con tope baja el tope; sin tope lo pregunta', async () => {
    const t1 = await responder('un departamento en Yanahuara hasta 500 mil soles', ESTADO_INICIAL, ctx());
    expect(t1.avisos).toHaveLength(1);
    const t2 = await responder('y más barato', t1.estado, ctx());
    expect(t2.consulta?.precioMax).toBe(400000);
    const sinTope = await responder('un departamento en Yanahuara', ESTADO_INICIAL, ctx());
    const t3 = await responder('más barato', sinTope.estado, ctx());
    expect(t3.tipo).toBe('pregunta');
    expect(t3.estado.pendiente).toBe('precio');
  });

  it('«sin el colegio» y «¿y en Cayma?» conservan lo demás', async () => {
    const t1 = await responder('un departamento en Yanahuara cerca de un colegio y de un mercado', ESTADO_INICIAL, ctx());
    const t2 = await responder('sin el colegio', t1.estado, ctx());
    expect(t2.consulta?.criterios.map((c) => c.id)).toEqual(['mercado']);
    expect(t2.titular).toMatch(/Quité/i);
    const t3 = await responder('¿y en Cayma?', t2.estado, ctx());
    expect(t3.consulta?.distrito).toBe('CAYMA');
    expect(t3.consulta?.tipo).toBe('departamento');
    expect(t3.consulta?.criterios.map((c) => c.id)).toEqual(['mercado']);
  });

  it('un ajuste de la interfaz quita un criterio y vuelve a buscar', async () => {
    const t1 = await responder('un departamento en Yanahuara cerca de un colegio', ESTADO_INICIAL, ctx());
    const t2 = await responder('Quitar colegio', t1.estado, ctx(), null, { ajuste: { accion: 'quitar_criterio', id: 'colegio' } });
    expect(t2.consulta?.criterios).toEqual([]);
    expect(t2.tipo).toBe('resultado');
    // Un ajuste inválido se ignora y no rompe nada.
    const t3 = await responder('hola', t1.estado, ctx(), null, { ajuste: { accion: 'borrar_todo' } });
    expect(t3.tipo).toBe('info');
  });

  it('el saludo dice cuántos avisos hay y qué tan frescos son, con datos de la base', async () => {
    const r = await responder('hola', ESTADO_INICIAL, ctx());
    expect(r.texto).toContain('Puedo buscar avisos de venta en Arequipa');
    expect(r.titular).toMatch(/3 avisos vigentes/);
    expect(r.titular).toMatch(/1 distrito/);
    expect(r.cobertura?.vigentes).toBe(3);
    expect(r.sugerencias.length).toBeGreaterThanOrEqual(3);
  });

  it('lo que el punto del mapa tiene sale de la ficha, con fuente y fecha', async () => {
    const r = await responder('¿qué hay en este punto?', ESTADO_INICIAL, ctx(), null, { punto: { lat: -16.39883, lon: -71.53697, etiqueta: null } });
    expect(r.tipo).toBe('info');
    expect(r.ficha?.filas.find((f) => f.etiqueta === 'Salud')?.fuente).toContain('RENIPRESS');
    expect(r.texto).toMatch(/Salud/);
    expect(r.texto).toMatch(/RENIPRESS/);
    expect(r.texto).not.toMatch(/puntaje|ganador|la mejor/i);
    expect(r.herramientas.map((h) => h.nombre)).toContain('ficha_de_punto');
  });

  it('sin un punto elegido en el mapa, dice cómo elegirlo en vez de inventar', async () => {
    const r = await responder('¿qué hay en este punto?', ESTADO_INICIAL, ctx());
    expect(r.tipo).toBe('info');
    expect(r.ficha).toBeNull();
    expect(r.titular).toMatch(/mapa/i);
  });

  it('compara dos avisos de la lista lado a lado sin elegir uno', async () => {
    const t1 = await responder('un departamento en Yanahuara cerca de un colegio', ESTADO_INICIAL, ctx());
    expect(t1.avisos).toHaveLength(2);
    expect(t1.estado.ultimosAvisos).toHaveLength(2);
    const t2 = await responder('compara el 1 y el 2', t1.estado, ctx());
    expect(t2.comparacion?.columnas).toHaveLength(2);
    expect(t2.comparacion?.filas.map((f) => f.etiqueta)).toEqual(expect.arrayContaining(['Precio', 'Colegio']));
    expect(dicho(t2)).toMatch(/no hay puntaje ni una opción ganadora/i);
    expect(dicho(t2)).not.toMatch(/\bla mejor\b|\bel mejor\b|recomend/i);
    const sinLista = await responder('compara el 1 y el 2', ESTADO_INICIAL, ctx());
    expect(sinLista.comparacion).toBeNull();
    expect(sinLista.tipo).toBe('info');
  });

  it('un modelo de lenguaje solo reescribe la frase de apertura y pasa por la verificación; los avisos y los límites siguen siendo los de las herramientas', async () => {
    const honesto = { nombre: 'honesto', redactar: async () => 'Hay avisos de departamento en Yanahuara que cumplen lo que pides.' };
    const r = await responder('un departamento en Yanahuara cerca de un colegio', ESTADO_INICIAL, ctx(), honesto);
    expect(r.modo).toBe('modelo');
    expect(r.titular).toContain('Hay avisos de departamento en Yanahuara');
    expect(r.descartadoPorVerificacion).toBe(false);
    for (const a of r.avisos) expect(r.texto).toContain(a.url);
    expect(r.resultados?.limites.length).toBeGreaterThan(0);
    const mentiroso = { nombre: 'mentiroso', redactar: async () => 'Encuentra el departamento perfecto a 123 m del colegio por S/ 777 777.' };
    const m = await responder('un departamento en Yanahuara cerca de un colegio', ESTADO_INICIAL, ctx(), mentiroso);
    expect(m.modo).toBe('reglas');
    expect(m.descartadoPorVerificacion).toBe(true);
    expect(`${m.titular}${m.texto}`).not.toContain('777');
    const roto = { nombre: 'roto', redactar: async () => { throw new Error('sin red'); } };
    const q = await responder('un departamento en Yanahuara cerca de un colegio', ESTADO_INICIAL, ctx(), roto);
    expect(q.tipo).toBe('resultado');
    expect(q.modo).toBe('reglas');
  });

  it('un lugar que no existe en los datos no se inventa: lo dice y pregunta otro', async () => {
    const r = await responder('un departamento cerca de mi trabajo en Zzqxw Vvkj', ESTADO_INICIAL, ctx());
    expect(r.tipo).toBe('pregunta');
    expect(r.estado.pendiente).toBe('trabajo');
    expect(r.titular).toMatch(/No encontré ese lugar|No ubiqué/);
    expect(r.estado.consulta?.trabajoLugar).toBeNull();
  });

  it('un lugar dudoso no se elige solo: ofrece las opciones y la que se toca se usa', async () => {
    const r = await responder('un departamento cerca de la univ san agustn de arequipa', ESTADO_INICIAL, ctx());
    if (r.tipo === 'pregunta' && r.estado.pendiente === 'aclarar') {
      expect(r.estado.aclaracion?.opciones.length).toBeGreaterThan(0);
      const opcion = r.estado.aclaracion!.opciones[0];
      const siguiente = await responder(opcion, r.estado, ctx());
      expect(siguiente.tipo).toBe('resultado');
    } else {
      // Si la errata era clara, la usó y lo dijo.
      expect(r.tipo).toBe('resultado');
    }
  });

  it('un estado manipulado por el cliente no rompe nada', async () => {
    const r = await responder('hola', { consulta: { intencion: 'buscar_avisos', criterios: [{ id: 'inventado' }] }, pendiente: 'otra' } as any, ctx());
    expect(r.tipo).toBe('info');
  });
});
