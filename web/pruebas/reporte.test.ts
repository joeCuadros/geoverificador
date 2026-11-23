import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fichaDePunto, type FichaDePunto } from '@geoverificador/datos/ficha';
import { fuentes } from '@geoverificador/datos/consultas';
import type { Base, Fila } from '@geoverificador/datos/cliente';
import { baseDePrueba } from '../../packages/datos/pruebas/apoyo.ts';
import { armarReporte, distanciaTexto, numeroTexto, type ItemDeFicha, type ReporteDePunto } from '../lib/reporte.ts';

const CENTRO = { lat: -16.40065, lon: -71.53771 };
const CAYMA = { lat: -16.368, lon: -71.546 };
const FUERA_DEL_PLANO = { lat: -16.66, lon: -71.12 };
let base: Base;
let ficha: FichaDePunto;
let fuentesBase: Fila[];

beforeAll(async () => {
  base = await baseDePrueba();
  ficha = await fichaDePunto(base, CENTRO);
  fuentesBase = await fuentes(base);
});
afterAll(() => base?.cerrar());

const clonar = (f: FichaDePunto): FichaDePunto => structuredClone(f);
const items = (r: ReporteDePunto): ItemDeFicha[] => r.grupos.flatMap((g) => g.subgrupos.flatMap((s) => s.items));
const item = (r: ReporteDePunto, id: string): ItemDeFicha => {
  const x = items(r).find((i) => i.id === id);
  if (!x) throw new Error(`No hay un item «${id}»: ${items(r).map((i) => i.id).join(', ')}`);
  return x;
};
const grupo = (r: ReporteDePunto, id: string) => r.grupos.find((g) => g.id === id)!;

describe('formato de números', () => {
  it('distanciaTexto: metros bajo el kilómetro y kilómetros con coma decimal; sin dato si falta', () => {
    expect(distanciaTexto(264.5)).toBe('265 m');
    expect(distanciaTexto(999.4)).toBe('999 m');
    expect(distanciaTexto(1671.4)).toBe('1,67 km');
    expect(distanciaTexto(null)).toBe('sin dato');
  });
  it('numeroTexto: separador de miles con espacio duro y coma decimal, como se escribe en español', () => {
    expect(numeroTexto(10132.146)).toBe('10 132');
    expect(numeroTexto(10000)).toBe('10 000');
    expect(numeroTexto(1.0132, 2)).toBe('1,01');
    expect(numeroTexto(999)).toBe('999');
    expect(numeroTexto(1234567.8, 1)).toBe('1 234 567,8');
  });
});

describe('estructura de la ficha: de las preguntas de quien busca vivienda', () => {
  it('se organiza en grupos con una pregunta, una frase que resume y sus elementos', () => {
    const r = armarReporte(ficha, fuentesBase);
    expect(r.grupos.map((g) => g.id)).toEqual(['construir', 'cerca', 'moverse', 'servicios', 'riesgos']);
    for (const g of r.grupos) {
      expect(g.titulo.length, g.id).toBeGreaterThan(5);
      expect(g.resumen.length, g.id).toBeGreaterThan(10);
      expect(g.subgrupos.length, g.id).toBeGreaterThan(0);
      for (const s of g.subgrupos) expect(s.items.length, `${g.id}/${s.titulo}`).toBeGreaterThan(0);
    }
  });

  it('lo esencial son pocas frases, cada una llevada a su grupo, y ninguna es un veredicto ni un puntaje', () => {
    const r = armarReporte(ficha, fuentesBase);
    expect(r.esencial.length).toBeGreaterThanOrEqual(3);
    expect(r.esencial.length).toBeLessThanOrEqual(5);
    for (const e of r.esencial) {
      expect(r.grupos.some((g) => g.id === e.grupo)).toBe(true);
      expect(e.texto).not.toMatch(/puntaje|mejor|peor|buen[ao]s? lugar|recomend|ideal|apto|conviene/i);
    }
  });

  it('el aviso, el punto y el distrito siguen: es una ficha informativa', () => {
    const r = armarReporte(ficha, fuentesBase);
    expect(r.punto).toEqual({ lat: CENTRO.lat, lon: CENTRO.lon });
    expect(r.distrito).toBe('Arequipa');
    expect(r.aviso).toMatch(/no es una recomendaci[oó]n de compra/i);
    expect(r.aviso).toMatch(/l[ií]nea recta/i);
  });
});

describe('estados: cumple, no cumple, informativo y sin dato son cuatro cosas distintas', () => {
  it('lo que tiene una distancia de referencia cumple o no cumple, con su referencia', () => {
    const r = armarReporte(ficha, fuentesBase);
    const salud = item(r, 'salud');
    expect(salud.estado).toBe('cumple');
    expect(salud.referencia).toMatchObject({ m: 1000, texto: 'hasta 1 km' });
    expect(salud.referencia!.origen).toMatch(/Convención del proyecto/);
    const verde = item(r, 'area-verde');
    expect(verde.estado).toBe('no_cumple');
    expect(verde.referencia!.m).toBe(300);
    expect(verde.distancia!.m).toBeGreaterThan(300);
  });

  it('lo que no tiene referencia es informativo: sin medidor y sin «cumple»', () => {
    const r = armarReporte(ficha, fuentesBase);
    for (const id of ['consultorio', 'comercio-abastecimiento', 'comercio-compras_ocio', 'comercio-finanzas', 'acopio']) {
      const i = item(r, id);
      expect(i.estado, id).toBe('informativo');
      expect(i.referencia, id).toBeNull();
    }
  });

  it('una distancia nula es «sin dato»: no se escribe como cero ni como que cumple, y no tiene medidor', () => {
    const f = clonar(ficha);
    Object.assign(f.entorno.salud, { estado: 'SIN DATO', nombre: null, distanciaM: null, lat: null, lon: null });
    const r = armarReporte(f, fuentesBase);
    const salud = item(r, 'salud');
    expect(salud.estado).toBe('sin_dato');
    expect(salud.distancia).toBeNull();
    expect(salud.referencia?.proporcion ?? null).toBeNull();
    expect(salud.lugarId).toBeNull();
    expect(salud.resumen).toMatch(/sin dato/i);
  });

  it('el punto dentro de un área (distancia 0) lo dice y no escribe «0 m»', () => {
    const f = clonar(ficha);
    f.entorno.areaVerde.distanciaM = 0;
    f.entorno.areaVerde.estado = 'CUMPLE';
    const v = item(armarReporte(f, fuentesBase), 'area-verde');
    expect(v.distancia).toMatchObject({ m: 0, dentro: true });
    expect(v.distancia!.texto).toBe('dentro del área');
  });

  it('el medidor sitúa la distancia respecto de la referencia: la marca está en la mitad y se llena hasta el doble de la referencia', () => {
    const r = armarReporte(ficha, fuentesBase);
    const salud = item(r, 'salud');
    expect(salud.referencia!.marca).toBe(0.5);
    expect(salud.referencia!.proporcion).toBeCloseTo(salud.distancia!.m! / 2000, 5);
    const lejos = clonar(ficha);
    lejos.entorno.salud.distanciaM = 9000;
    expect(item(armarReporte(lejos, fuentesBase), 'salud').referencia!.proporcion).toBe(1);
  });
});

describe('lugares repetidos y detalles agrupados', () => {
  it('un colegio que es el más cercano de tres niveles es un solo elemento con tres criterios', () => {
    const r = armarReporte(ficha, fuentesBase);
    const colegios = items(r).filter((i) => i.id.startsWith('colegio'));
    expect(colegios).toHaveLength(1);
    const c = colegios[0];
    expect(c.nombre).toMatch(/ALBERT L\. LEHNINGER/);
    expect(c.criterios!.map((x) => x.etiqueta)).toEqual(['Inicial', 'Primaria', 'Secundaria']);
    expect(c.criterios!.map((x) => x.referencia!.m)).toEqual([500, 1500, 3000]);
    expect(c.criterios!.every((x) => x.estado === 'cumple')).toBe(true);
    expect(c.estado).toBeNull();
  });

  it('si los niveles son colegios distintos, son elementos distintos', () => {
    const f = clonar(ficha);
    f.entorno.educacion.secundaria = { ...f.entorno.educacion.secundaria, nombre: 'OTRO COLEGIO', codigo: '9999999', lat: f.entorno.educacion.secundaria.lat + 0.001 };
    const colegios = items(armarReporte(f, fuentesBase)).filter((i) => i.id.startsWith('colegio'));
    expect(colegios).toHaveLength(2);
    expect(colegios.find((c) => c.nombre === 'OTRO COLEGIO')!.criterios!.map((x) => x.etiqueta)).toEqual(['Secundaria']);
  });

  it('el peligro volcánico se resume con su nivel más alto y deja los escenarios en el detalle', () => {
    const r = armarReporte(ficha, fuentesBase);
    const v = item(r, 'peligro-volcanico');
    expect(v.estado).toBe('informativo');
    expect(v.resumen).toMatch(/nivel más alto: alto/i);
    expect(v.detalle!.lineas.length).toBeGreaterThanOrEqual(5);
    expect(new Set(v.detalle!.lineas).size).toBe(v.detalle!.lineas.length); // sin repetidos
    expect(v.fuente.texto).toMatch(/IGP/);
    expect(v.fuente.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v.lugarId).toBeNull(); // su polígono es enorme: está en la capa «Peligro volcánico» del mapa
  });

  it('el cauce más cercano se dibuja y sus otros registros quedan en el detalle', () => {
    const r = armarReporte(ficha, fuentesBase);
    const c = item(r, 'cauce');
    expect(c.nombre).toBe('Río Chili');
    expect(c.distancia!.m).toBeGreaterThan(0);
    expect(c.lugarId).toBeTruthy();
    expect(r.lugares.find((l) => l.id === c.lugarId)!.forma.type).toMatch(/LineString/);
  });
});

describe('texto que se lee de verdad', () => {
  it('cada elemento con distancia tiene un nombre: nunca «INFORMATIVO · 66 m» a secas', () => {
    const f = clonar(ficha);
    f.entorno.finanzas.nombre = null;
    f.entorno.recreacion.nombre = '';
    const r = armarReporte(f, fuentesBase);
    for (const i of items(r)) if (i.distancia && i.estado !== 'sin_dato') expect(i.nombre ?? i.criterios?.[0]?.etiqueta, i.id).toBeTruthy();
    expect(item(r, 'comercio-finanzas').nombre).toMatch(/sin nombre/i);
  });

  it('ningún texto repite «Sin umbral:» ni escribe «INFORMATIVO ·» como una fila de tabla', () => {
    const r = armarReporte(ficha, fuentesBase);
    const todo = JSON.stringify(r);
    expect(todo).not.toMatch(/Sin umbral: Sin umbral/i);
    expect(todo).not.toMatch(/INFORMATIVO ·/);
  });

  it('las superficies se escriben como en español: espacio entre miles y coma decimal', () => {
    const r = armarReporte(ficha, fuentesBase);
    const verde = item(r, 'area-verde');
    const texto = JSON.stringify(verde);
    expect(texto).toMatch(/\d \d{3} m²/);
    expect(texto).not.toMatch(/\d,\d{3} m²/); // «10,132 m²» sería el separador inglés
    expect(texto).toMatch(/\d,\d{2} ha/);
  });

  it('las frases de los datos salen de los textos de dominio: la concesión eléctrica y la minera', () => {
    const r = armarReporte(ficha, fuentesBase);
    expect(item(r, 'electricidad').resumen).toMatch(/SEAL/);
    expect(item(r, 'electricidad').noDice).toMatch(/no significa que tu predio ya tenga una conexión/);
    expect(item(r, 'mineria').resumen).toMatch(/no cae dentro de ninguna concesión minera/);
  });
});

describe('fuente y fecha junto a cada dato; método y límites aparte', () => {
  it('cada elemento dice su fuente y la fecha de sus datos, salvo la zonificación (sin fecha en la base)', () => {
    const r = armarReporte(ficha, fuentesBase);
    for (const i of items(r)) {
      expect(i.fuente.texto, i.id).toBeTruthy();
      if (i.id !== 'zona') expect(i.fuente.fecha, i.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(item(r, 'zona').fuente.fecha).toBeNull();
    expect(item(r, 'salud').fuente.texto).toMatch(/RENIPRESS/);
    expect(item(r, 'colegio-1').fuente.texto).toMatch(/ESCALE/);
  });

  it('el método y lo que el dato no dice van aparte, no en la frase principal', () => {
    const r = armarReporte(ficha, fuentesBase);
    for (const id of ['salud', 'transporte', 'area-verde', 'comercio-abastecimiento', 'acopio']) {
      const i = item(r, id);
      expect(i.metodo, id).toBeTruthy();
      expect(i.noDice, id).toBeTruthy();
      expect(i.resumen ?? '', id).not.toContain(i.metodo!.slice(0, 30));
    }
    expect(item(r, 'salud').metodo).toMatch(/haversine|línea recta/i);
  });

  it('la zona trae sus parámetros del plano y su regla', () => {
    const z = item(armarReporte(ficha, fuentesBase), 'zona');
    expect(z.nombre).toMatch(/ZRE-CH/);
    expect(z.resumen).toMatch(/Reglamentación especial centro histórico/);
    expect(z.estado).toBeNull();
  });

  it('los límites que se muestran son pocos y los demás quedan completos para desplegar', () => {
    const r = armarReporte(ficha, fuentesBase);
    expect(r.limitacionesClave.length).toBeGreaterThanOrEqual(2);
    expect(r.limitacionesClave.length).toBeLessThanOrEqual(4);
    expect(r.limitaciones.length).toBeGreaterThan(r.limitacionesClave.length);
    expect(r.limitaciones.join(' ')).toMatch(/PDM 2016-2025/);
    expect(r.limitaciones.join(' ')).not.toMatch(/por eso se avisa|zonificación proyectada no se muestra/);
    expect(r.limitaciones.join(' ')).toMatch(/no avisa si otra zona queda a 20 m o menos/);
    expect(r.limitaciones.join(' ')).not.toMatch(/Apt[oó]log/);
  });

  it('no trae el aviso del PDM nuevo ni secciones que la base no calcula', () => {
    const todo = JSON.stringify(armarReporte(ficha, fuentesBase));
    expect(todo).not.toMatch(/Diario Correo|PDM nuevo \(|Zonificación proyectada/);
    expect(todo).not.toMatch(/No se calcul/);
  });
});

describe('qué revisar antes de decidir', () => {
  it('es una lista corta de pasos con su detalle, con el texto que ya tiene el dominio', () => {
    const r = armarReporte(ficha, fuentesBase);
    expect(r.pasos.length).toBeGreaterThanOrEqual(3);
    expect(r.pasos.length).toBeLessThanOrEqual(5);
    for (const p of r.pasos) {
      expect(p.titulo).toBeTruthy();
      expect(p.detalle.length).toBeGreaterThan(20);
    }
    expect(r.pasos.map((p) => p.titulo).join(' ')).toMatch(/recibos/i);
    expect(r.pasos.find((p) => /recibos/i.test(p.titulo))!.detalle).toMatch(/SEDAPAR.*SEAL/);
  });

  it('sin zona en el plano no pide el certificado de zonificación como paso del punto', async () => {
    const f = await fichaDePunto(base, FUERA_DEL_PLANO);
    const titulos = armarReporte(f, fuentesBase).pasos.map((p) => p.titulo).join(' ');
    expect(titulos).not.toMatch(/Zonificación y Vías/);
  });
});

describe('puntos distintos', () => {
  it('fuera del plano de zonificación lo dice y no inventa una zona', async () => {
    const f = await fichaDePunto(base, FUERA_DEL_PLANO);
    const r = armarReporte(f, fuentesBase);
    const z = item(r, 'zona');
    expect(z.estado).toBe('sin_dato');
    expect(z.resumen).toMatch(/fuera del área zonificada/i);
    expect(r.distrito).toBeNull();
    expect(grupo(r, 'construir').resumen).toBe(''); // lo dice el elemento; el grupo no lo repite
    expect(r.esencial.find((e) => e.grupo === 'construir')!.texto).toMatch(/fuera del área zonificada/i);
  });

  it('en Cayma, el paradero que no cumple y la manzana sin cifras se dicen tal cual', async () => {
    const f = await fichaDePunto(base, CAYMA);
    const r = armarReporte(f, fuentesBase);
    expect(item(r, 'transporte').estado).toBe('no_cumple');
    const censo = item(r, 'censo');
    expect(censo.estado).toBe('sin_dato');
    expect(censo.resumen).toMatch(/no hay cifras/);
  });

  it('el resumen de «qué hay cerca» cuenta lo medido contra su referencia y no inventa más', () => {
    const r = armarReporte(ficha, fuentesBase);
    const medidos = items(r).filter((i) => ['salud', 'area-verde', 'colegio-1'].includes(i.id));
    const criterios: { estado: string | null }[] = medidos.flatMap((i): { estado: string | null }[] => (i.criterios ? i.criterios : [i]));
    const cumplen = criterios.filter((c) => c.estado === 'cumple').length;
    const g = grupo(r, 'cerca');
    expect(g.conteo).toEqual({ cumple: cumplen, noCumple: criterios.filter((c) => c.estado === 'no_cumple').length, sinDato: criterios.filter((c) => c.estado === 'sin_dato').length });
    expect(g.resumen).toContain(`${cumplen} de ${criterios.length}`);
  });
});

describe('escape: lo que viene de los datos es texto', () => {
  it('un nombre con HTML llega como texto plano; no hay HTML en la ficha', () => {
    const f = clonar(ficha);
    f.entorno.salud.nombre = '<img src=x onerror=alert(1)>';
    const r = armarReporte(f, fuentesBase);
    expect(item(r, 'salud').nombre).toBe('<img src=x onerror=alert(1)>');
    const sinNombres = JSON.stringify(r).split('<img src=x onerror=alert(1)>').join('');
    expect(sinNombres).not.toMatch(/<[a-z]+[ >]/i);
  });
});

describe('lugares para el mapa', () => {
  it('cada elemento con lugar apunta a uno de `lugares`, tal como lo devolvió la ficha', () => {
    const r = armarReporte(ficha, fuentesBase);
    for (const i of items(r)) if (i.lugarId) expect(r.lugares.some((l) => l.id === i.lugarId), i.id).toBe(true);
    const salud = r.lugares.find((l) => l.id === item(r, 'salud').lugarId)!;
    expect(salud.lat).toBe(ficha.entorno.salud.lat);
    expect(salud.lon).toBe(ficha.entorno.salud.lon);
    expect(salud.distanciaM).toBe(ficha.entorno.salud.distanciaM);
  });

  it('el colegio compartido es un solo lugar con sus tres filas', () => {
    const r = armarReporte(ficha, fuentesBase);
    const l = r.lugares.filter((x) => x.tipo === 'colegio');
    expect(l).toHaveLength(1);
    expect(l[0].filas).toEqual(['Educación inicial', 'Educación primaria', 'Educación secundaria']);
  });

  it('el área verde llega con su forma y el cauce con su línea anclada al vértice más cercano', () => {
    const r = armarReporte(ficha, fuentesBase);
    expect(r.lugares.find((l) => l.tipo === 'parque')!.forma.type).toMatch(/Polygon/);
    const cauce = r.lugares.find((l) => l.tipo === 'cauce')!;
    const grados = (a: number, b: number) => Math.hypot((a - ficha.punto.lat) * 111_000, (b - ficha.punto.lon) * 106_000);
    const aElla = grados(cauce.lat, cauce.lon);
    expect(aElla).toBeLessThan((cauce.distanciaM ?? 0) + 200);
    expect((cauce.forma.coordinates as number[][]).some(([x, y]) => grados(y, x) < aElla - 1)).toBe(false);
  });

  it('una sección sin dato no genera un lugar inventado', () => {
    const f = clonar(ficha);
    Object.assign(f.entorno.salud, { estado: 'SIN DATO', nombre: null, distanciaM: null, lat: null, lon: null });
    expect(armarReporte(f, fuentesBase).lugares.some((l) => l.tipo === 'salud')).toBe(false);
  });
});

describe('lo informativo se dice una vez por grupo, no en cada fila', () => {
  it('los subgrupos y grupos formados solo por datos informativos lo declaran, y los de distancias de referencia no', () => {
    const r = armarReporte(ficha, fuentesBase);
    expect(grupo(r, 'servicios').soloInformativo).toBe(true);
    expect(grupo(r, 'riesgos').soloInformativo).toBe(true);
    expect(grupo(r, 'cerca').soloInformativo).toBe(false);
    expect(grupo(r, 'moverse').soloInformativo).toBe(false);
    expect(grupo(r, 'construir').soloInformativo).toBe(false);
    const cerca = grupo(r, 'cerca');
    expect(cerca.subgrupos.map((s) => s.informativo)).toEqual([false, true]);
    expect(cerca.subgrupos[1].titulo).toMatch(/informativo/i);
  });

  it('un grupo informativo con un dato sin dato sigue siendo informativo: sin dato no es un veredicto', async () => {
    const f = await fichaDePunto(base, CAYMA); // la manzana no tiene cifras (sin dato)
    expect(grupo(armarReporte(f, fuentesBase), 'servicios').soloInformativo).toBe(true);
  });

  it('el resumen de «qué se puede construir» no repite la regla que ya está en el elemento, y lo esencial sí la lleva completa', () => {
    const r = armarReporte(ficha, fuentesBase);
    expect(grupo(r, 'construir').resumen).toMatch(/^Zona ZRE-CH: requiere consulta\.$/);
    expect(r.esencial.find((e) => e.grupo === 'construir')!.texto).toMatch(/ZRE-CH.*Reglamentación especial centro histórico.*requiere consulta/);
  });
});
