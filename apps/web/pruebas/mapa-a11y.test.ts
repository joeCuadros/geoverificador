import { describe, expect, it } from 'vitest';
import { areaDeToque, colorDeTexto, contrasteEntre, nombreDeAviso, textoDeFuente } from '../app/componentes/dibujo.ts';
import { anuncioDeResultados, textoDeEstado } from '../app/componentes/interfaz.ts';
import { CAPAS_MAPA } from '../lib/capas.ts';

describe('el texto de un marcador o de una muestra se lee sobre su color', () => {
  it('elige blanco sobre fondos oscuros y tinta sobre fondos claros', () => {
    expect(colorDeTexto('#1c3a6b')).toBe('#ffffff');
    expect(colorDeTexto('#f59e0b')).toBe('#111827');
    expect(colorDeTexto('#fff')).toBe('#111827');
    expect(colorDeTexto('#000')).toBe('#ffffff');
  });

  it('cada color de la leyenda de cada capa tiene un texto con contraste de al menos 4,5 a 1', () => {
    for (const capa of CAPAS_MAPA) {
      for (const item of capa.leyenda) {
        expect(contrasteEntre(colorDeTexto(item.color), item.color), `${capa.id} · ${item.texto} (${item.color})`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('un color que no es hexadecimal cae en el gris de siempre y sigue leyéndose', () => {
    expect(contrasteEntre(colorDeTexto('red; background: url(x)'), '#3b4a5a')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('marcadores de aviso', () => {
  it('el nombre accesible lleva el número del aviso, igual que su tarjeta en el chat', () => {
    expect(nombreDeAviso(2, 'Departamento en Yanahuara')).toBe('Aviso 2: Departamento en Yanahuara');
  });

  it('el área de toque mide al menos 44 px en pantallas táctiles y el tamaño del dibujo en las demás', () => {
    expect(areaDeToque(30, true)).toBe(44);
    expect(areaDeToque(30, false)).toBe(30);
    expect(areaDeToque(60, true)).toBe(60);
  });
});

describe('textos del mapa y del buscador', () => {
  it('el buscador anuncia solo cuántos resultados hay', () => {
    expect(anuncioDeResultados(1)).toBe('1 resultado');
    expect(anuncioDeResultados(3)).toBe('3 resultados');
  });

  it('la fuente sin fecha dice «sin fecha registrada»', () => {
    expect(textoDeFuente('RENIPRESS', '2025-02-01')).toBe('Fuente: RENIPRESS · datos del 2025-02-01');
    expect(textoDeFuente('Plano', null)).toBe('Fuente: Plano · sin fecha registrada');
  });

  it('un error de capa dice el siguiente paso y no habla en primera persona', () => {
    const t = textoDeEstado({ tipo: 'error' });
    expect(t).toMatch(/^No se pudo cargar esta capa\./);
    expect(t).toMatch(/Reintentar/);
    expect(t).not.toMatch(/\bpude\b|\bintent[eé]\b/i);
  });
});
