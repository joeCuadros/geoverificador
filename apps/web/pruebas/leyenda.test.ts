import { describe, expect, it } from 'vitest';
import { estiloDeArea, muestraDeLeyenda } from '../app/componentes/dibujo.ts';
import { CAPAS_MAPA } from '../lib/capas.ts';

describe('muestras de la leyenda: repiten lo que el mapa dibuja', () => {
  it('cada entrada de cada capa tiene una muestra del color de la leyenda y de la forma de la capa', () => {
    for (const capa of CAPAS_MAPA) {
      for (const item of capa.leyenda) {
        const m = muestraDeLeyenda(capa, item);
        expect(m.color.toLowerCase(), `${capa.id} · ${item.texto}`).toBe(item.color.toLowerCase());
        if (capa.forma === 'linea') expect(m.tipo, capa.id).toBe('linea');
        if (capa.forma === 'poligono') expect(m.tipo, capa.id).toBe('area');
        if (capa.forma === 'punto') expect(['icono', 'punto', 'anillo'], capa.id).toContain(m.tipo);
      }
    }
  });

  it('los puntos con letra son iconos con su letra; los sismos, un anillo; los puntos sin letra, un punto liso', () => {
    const id = (x: string) => CAPAS_MAPA.find((c) => c.id === x)!;
    expect(muestraDeLeyenda(id('colegios'), id('colegios').leyenda[0])).toMatchObject({ tipo: 'icono', letra: 'I', color: '#9a4d00' });
    expect(muestraDeLeyenda(id('sismos'), id('sismos').leyenda[0])).toMatchObject({ tipo: 'anillo' });
    expect(muestraDeLeyenda(id('geologicos'), id('geologicos').leyenda[0])).toMatchObject({ tipo: 'punto' });
  });

  it('un área toma su relleno y su trazo del mismo estilo con que se pinta en el mapa (distritos: solo contorno discontinuo; concesión eléctrica: discontinua y casi sin relleno)', () => {
    for (const capa of CAPAS_MAPA.filter((c) => c.forma === 'poligono')) {
      const m = muestraDeLeyenda(capa, capa.leyenda[0]);
      const e = estiloDeArea(capa.id, capa.leyenda[0].color);
      expect(m).toMatchObject({ tipo: 'area', grosor: e.weight, relleno: e.fill ? e.fillOpacity : 0, discontinuo: Boolean(e.dashArray) });
    }
    expect(muestraDeLeyenda(CAPAS_MAPA.find((c) => c.id === 'distritos')!, { color: '#33415c' })).toMatchObject({ relleno: 0, discontinuo: true });
    expect(muestraDeLeyenda(CAPAS_MAPA.find((c) => c.id === 'zonificacion')!, { color: '#b88a2e' })).toMatchObject({ relleno: 0.38, discontinuo: false });
  });

  it('un color que no es hexadecimal no llega a la muestra', () => {
    expect(muestraDeLeyenda({ id: 'x', forma: 'linea' }, { color: 'red; background: url(x)' }).color).toBe('#3b4a5a');
  });
});
