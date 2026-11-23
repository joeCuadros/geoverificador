/**
 * Lo que la interfaz muestra además del texto: respuestas rápidas, siguientes pasos y alivios. Regla del producto: ninguna sugerencia ordena, puntúa ni recomienda;
 * y el vocabulario es «aviso» y «punto», no «predio», «vivienda» ni «inmueble».
 */
import { describe, expect, it } from 'vitest';
import { CONSULTA_VACIA, type Consulta } from '../src/consulta.ts';
import { alivios, ayudaSinEntender, entendidoDe, repreguntar, resumenDe, siguientesPasos, type Cobertura } from '../src/presentacion.ts';

const consulta = (extra: Partial<Consulta> = {}): Consulta => ({ ...CONSULTA_VACIA, intencion: 'buscar_avisos', criterios: [], noDisponible: [], avisos: [], posiciones: [], ...extra });
const cobertura = { distritos: [{ nombre: 'YANAHUARA', total: 3 }, { nombre: 'CAYMA', total: 1 }] } as unknown as Cobertura;
const PROHIBIDO = /\b(mejor(es)?|recomend\w+|ganador\w*|primeros|puntaje|ranking)\b/i;

describe('siguientesPasos', () => {
  it('ofrece comparar el 1 y el 2 (no «los dos primeros»: eso suena a un podio)', () => {
    const pasos = siguientesPasos(consulta({ tipo: 'departamento' }), { cobertura, mostrados: 3, hayPunto: false });
    const comparar = pasos.find((p) => p.mensaje === 'compara el 1 y el 2');
    expect(comparar).toMatchObject({ texto: 'Compara el 1 y el 2', rol: 'siguiente' });
    expect(pasos.map((p) => p.texto).join(' | ')).not.toMatch(/primeros/i);
  });

  it('no ofrece comparar con menos de dos avisos', () => {
    const pasos = siguientesPasos(consulta(), { cobertura, mostrados: 1, hayPunto: false });
    expect(pasos.some((p) => /compara/i.test(p.texto))).toBe(false);
  });

  it('ninguna sugerencia recomienda ni ordena', () => {
    const pasos = siguientesPasos(consulta({ precioMax: 400000, moneda: 'PEN' }), { cobertura, mostrados: 3, hayPunto: true });
    for (const p of pasos) expect(p.texto, p.texto).not.toMatch(PROHIBIDO);
  });
});

describe('alivios', () => {
  const diagnostico = { sinFiltro: [{ filtro: 'precio', total: 2, precioMinimoPen: 650000 }, { filtro: 'distrito', total: 3 }, { filtro: 'tipo', total: 1 }], sinNingunFiltro: 4 } as any;

  it('cada alivio lleva el rol «alivio» (la interfaz lo dibuja con el estilo neutro, no con el relleno de la acción principal)', () => {
    const a = alivios(consulta({ precioMax: 100000, moneda: 'PEN' }), diagnostico, cobertura);
    expect(a.map((x) => x.texto)).toContain('Quitar el tope de precio');
    expect(a.every((x) => x.rol === 'alivio')).toBe(true);
  });

  it('no habla de «inmueble»: el tipo es «tipo»', () => {
    const a = alivios(consulta(), diagnostico, cobertura);
    expect(a.map((x) => x.texto)).toContain('Cualquier tipo');
    expect(a.map((x) => x.texto).join(' ')).not.toMatch(/inmueble|predio|vivienda/i);
  });
});

describe('vocabulario', () => {
  it('lo entendido y las ayudas dicen «tipo», no «tipo de inmueble»', () => {
    expect(resumenDe(consulta({ tipoCualquiera: true }))).toBe('cualquier tipo');
    expect(entendidoDe(consulta({ tipoCualquiera: true }), { distritosConAvisos: [] })[0].valor).toBe('Cualquier tipo');
    const textos = [ayudaSinEntender(0, 'asdf', null).titular, repreguntar('tipo', 0, 'asdf'), repreguntar('tipo', 1, 'asdf')];
    for (const t of textos) expect(t, t).not.toMatch(/inmueble|predio|vivienda/i);
  });
});
