/**
 * Pruebas de las funciones puras de public/js/reporte.js que arman el informe imprimible (PDF): quebradas y cauces,
 * contexto de riesgo, precio de oferta del distrito, verificaciones antes de comprar y el orden de las secciones. No usan DOM: devuelven HTML como texto.
 *
 * Lo que fijan: el estado INFORMATIVO se rotula como tal (y «según tu umbral» solo con el umbral de la persona), toda
 * distancia dice «en línea recta», el contexto no se presenta como evaluación, y las verificaciones separan lo que la
 * herramienta calculó de lo que la persona debe comprobar, con las URL impresas como texto (en papel no se puede hacer clic).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Reporte = require('../public/js/reporte.js');
const Verificaciones = require('../public/js/verificaciones.js');

const cauce = (extra = {}) => ({
  estado: 'INFORMATIVO', nombre: 'Río Chili', tipo: 'Río', distanciaM: 568, umbralM: null, segunUmbralUsuario: false,
  fuente: 'Red hidrográfica (capa «Cuerpos de Agua»), Autoridad Nacional del Agua (ANA)', fecha: '2026-11-02',
  metodo: 'Distancia en línea recta hasta el tramo más cercano.', nombres: ['Río Chili', 'Quebrada El Cuico'], tramos: 14, elaboracion: 'Enero de 2018', ...extra,
});
const peligros = (extra = {}) => ({
  estado: 'INFORMATIVO', radioM: 500, total: 3, porTipo: [['Flujos', 2], ['Caida', 1]], masCercano: { tipo: 'Flujos', subtipo: 'Flujo de detritos', sector: 'Quebrada X', anio: 2019 },
  distanciaM: 120, anioDesde: 2003, anioHasta: 2023, registros: 394, fuente: 'Inventario de peligros geológicos, GEOCATMIN (INGEMMET)', fecha: '2026-10-12', ...extra,
});
const sismos = (extra = {}) => ({
  estado: 'INFORMATIVO', radioM: 100000, total: 49, magnitudMaxima: 4.7, masReciente: '2026-10-11', desde: '2026-01-01', hasta: '2026-11-02',
  fuente: 'Sismos reportados, Instituto Geofísico del Perú (IGP)', fecha: '2026-11-02', ...extra,
});
const precio = (extra = {}) => ({
  estado: 'INFORMATIVO', distrito: 'CAYMA', precioM2: { venta: 4905, alquiler: null }, arriendoMensual: null, moneda: 'PEN',
  periodo: { desde: '2026-10-11', hasta: '2026-10-18', corte: '2026-10-18' }, nAvisos: { venta: 118, arriendo: null }, muestraMinima: 30,
  tipo: 'precio de oferta (avisos), no de cierre', fuente: 'Aptología (aptologia.com)', url: 'https://example.org/estudio', licencia: 'CC BY 4.0',
  atribucion: 'Datos: Aptologia', fechaDescarga: '2026-11-03', ...extra,
});
const verif = () => ({ calculado: Verificaciones.CALCULADO, items: Verificaciones.ITEMS, aviso: Verificaciones.AVISO });

const base = (extra = {}) => ({
  fecha: '2 de noviembre de 2026', punto: { lat: -16.4, lon: -71.53 }, distritoTitulo: 'Distrito de Arequipa', distritoNombre: 'Arequipa',
  resumen: [['Zonificación vigente', 'RDM-2']], zonaStatus: 'outside', zona: null, badgeZona: null, lote: null, potencial: null, avisoPDM: null,
  variables: null, umbrales: { areaVerde: { areaMinM2: 5000, areaGrandeM2: 10000, distanciaM: 300 } },
  fuentesUmbral: { salud: 'x', educacion: 'x', transporte: 'x', areaVerde: 'x' }, modulos: {},
  fuentes: { zonificacion: 'Plano del PDM', peligros: 'p', distritos: 'd', delitos: 'e' },
  cauce: cauce(), contextoRiesgo: { peligros: peligros(), sismos: sismos() }, precio: precio(), verificaciones: verif(), ...extra,
});

describe('Reporte.seccionQuebradas', () => {
  it('sin umbral del usuario se rotula INFORMATIVO, con nombre, distancia en línea recta y que no hay umbral normativo', () => {
    const h = Reporte.seccionQuebradas(base());
    expect(h).toContain('INFORMATIVO');
    expect(h).toContain('Río Chili');
    expect(h).toContain('568 m en línea recta');
    expect(h).toMatch(/Sin umbral normativo/);
    expect(h).not.toMatch(/CUMPLE/);
    expect(h).not.toMatch(/según tu umbral/i);
  });

  it('con el umbral del usuario muestra CUMPLE / NO CUMPLE rotulado «según tu umbral»', () => {
    const no = Reporte.seccionQuebradas(base({ cauce: cauce({ estado: 'NO CUMPLE', umbralM: 800, segunUmbralUsuario: true }) }));
    expect(no).toContain('NO CUMPLE');
    expect(no).toMatch(/según tu umbral/i);
    expect(no).toContain('al menos 800 m');
    expect(no).not.toContain('INFORMATIVO');
    expect(Reporte.seccionQuebradas(base({ cauce: cauce({ estado: 'CUMPLE', umbralM: 300, segunUmbralUsuario: true }) }))).toContain('CUMPLE');
  });

  it('dice lo que no cubre: no es un mapa de peligro, la faja marginal y que la red no incluye todas las quebradas urbanas', () => {
    const h = Reporte.seccionQuebradas(base());
    expect(h).toMatch(/no es un mapa de peligro/);
    expect(h).toMatch(/faja marginal/);
    expect(h).toMatch(/no incluye todas las quebradas urbanas/);
    expect(h).toContain('Enero de 2018');
  });

  it('menciona la ausencia de Añashuayco o San Lázaro solo si de verdad no figuran en el archivo', () => {
    expect(Reporte.seccionQuebradas(base())).toMatch(/no figuran Añashuayco ni San Lázaro/);
    expect(Reporte.seccionQuebradas(base({ cauce: cauce({ nombres: ['Quebrada Añashuayco', 'Río Chili'] }) }))).toMatch(/no figura San Lázaro/);
  });

  it('sin dato no inventa nada y muestra la causa', () => {
    const h = Reporte.seccionQuebradas(base({ cauce: cauce({ estado: 'SIN DATO', distanciaM: null, nombre: null, error: 'archivo ausente' }) }));
    expect(h).toContain('SIN DATO');
    expect(h).toContain('archivo ausente');
    expect(h).not.toMatch(/568/);
  });

  it('sin el resultado (aún no calculado) lo dice', () => {
    expect(Reporte.seccionQuebradas(base({ cauce: null }))).toMatch(/No se calcul/);
  });

  it('escapa el HTML del nombre', () => {
    const h = Reporte.seccionQuebradas(base({ cauce: cauce({ nombre: '<img src=x onerror=alert(1)>' }) }));
    expect(h).not.toContain('<img');
    expect(h).toContain('&lt;img');
  });
});

describe('Reporte.seccionContexto', () => {
  it('presenta peligros y sismos como contexto informativo, no como evaluación', () => {
    const h = Reporte.seccionContexto(base());
    expect(h).toMatch(/no una evaluación de peligro/);
    expect((h.match(/INFORMATIVO/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(h).toMatch(/no hay umbral/i);
  });

  it('peligros: cuántos a 500 m, por tipo, el más cercano en línea recta y que un inventario vacío no es seguridad', () => {
    const h = Reporte.seccionContexto(base());
    expect(h).toContain('3');
    expect(h).toContain('500 m');
    expect(h).toContain('Flujos 2');
    expect(h).toContain('120 m en línea recta');
    expect(h).toContain('Flujo de detritos');
    expect(h).toMatch(/no significa que el lugar sea seguro/);
    expect(h).toContain('2003');
  });

  it('sismos: cuántos, radio, magnitud máxima, periodo y que no es predicción', () => {
    const h = Reporte.seccionContexto(base());
    expect(h).toContain('49');
    expect(h).toContain('100 km');
    expect(h).toContain('4,7');
    expect(h).toContain('2026-01-01');
    expect(h).toContain('2026-11-02');
    expect(h).toMatch(/no predice/);
    expect(h).toMatch(/E\.030/);
  });

  it('con cero registros muestra «0», no «sin dato»', () => {
    const h = Reporte.seccionContexto(base({ contextoRiesgo: { peligros: peligros({ total: 0, porTipo: [], distanciaM: 900 }), sismos: sismos({ total: 0, magnitudMaxima: null, masReciente: null }) } }));
    expect(h).toMatch(/<strong>0<\/strong>/);
    expect(h).not.toMatch(/Sin dato/i);
  });

  it('cada fuente que falta queda SIN DATO con su causa', () => {
    const h = Reporte.seccionContexto(base({ contextoRiesgo: { peligros: peligros({ estado: 'SIN DATO', total: null, error: 'sin archivo' }), sismos: sismos() } }));
    expect(h).toContain('SIN DATO');
    expect(h).toContain('sin archivo');
    expect(h).toContain('49');
  });

  it('sin el contexto calculado lo dice', () => {
    expect(Reporte.seccionContexto(base({ contextoRiesgo: null }))).toMatch(/No se calcul/);
  });
});

describe('Reporte.seccionPrecio', () => {
  it('muestra el precio por m² como INFORMATIVO, con distrito, avisos, periodo y atribución', () => {
    const h = Reporte.seccionPrecio(base());
    expect(h).toContain('INFORMATIVO');
    expect(h).toContain('4 905');
    expect(h).toContain('118');
    expect(h).toContain('CAYMA');
    expect(h).toContain('11 al 18 de octubre de 2026');
    expect(h).toContain('Datos: Aptologia');
    expect(h).toContain('CC BY 4.0');
  });

  it('dice lo que no cubre: oferta y no cierre, promedio del distrito y no del inmueble, y que no es un puntaje', () => {
    const h = Reporte.seccionPrecio(base());
    expect(h).toMatch(/no de cierre/);
    expect(h).toMatch(/no el valor de este inmueble|no el precio de este inmueble/);
    expect(h).toMatch(/ningún puntaje/);
    expect(h).not.toMatch(/NO CUMPLE|>CUMPLE</);
  });

  it('sin cifra para el distrito queda SIN DATO con la causa', () => {
    const h = Reporte.seccionPrecio(base({ precio: { estado: 'SIN DATO', distrito: 'YURA', causa: 'No hay cifra publicada para este distrito.', motivo: 'sin_muestra' } }));
    expect(h).toContain('SIN DATO');
    expect(h).toContain('No hay cifra publicada');
    expect(h).not.toContain('INFORMATIVO');
  });

  it('sin el precio calculado lo dice', () => {
    expect(Reporte.seccionPrecio(base({ precio: null }))).toMatch(/No se calculó el precio/);
  });

  it('entra al resumen como INFORMATIVO y su fuente lleva la atribución', () => {
    const fila = Reporte.filasResumenExtra(base()).find(([k]: [string]) => k.startsWith('Precio de oferta'));
    expect(fila[1]).toMatch(/^INFORMATIVO/);
    const sec = Reporte.construirSecciones(base()).find((x: { titulo: string }) => x.titulo.startsWith('Precio de oferta'));
    expect(sec.fuente).toContain('Datos: Aptologia');
    expect(Reporte.limites(base()).join(' ')).toMatch(/precio de oferta/i);
  });
});

describe('Reporte.seccionVerificaciones', () => {
  it('separa lo que la herramienta calculó de lo que la persona debe comprobar', () => {
    const h = Reporte.seccionVerificaciones(base());
    const a = h.indexOf('Lo que GeoVerificador ya calculó');
    const b = h.indexOf('Lo que debes comprobar tú');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    Verificaciones.CALCULADO.forEach((c: { titulo: string }) => expect(h.indexOf(c.titulo)).toBeGreaterThan(a));
    expect(h).toMatch(/Referencial/);
  });

  it('lista todas las verificaciones con su entidad y qué confirman', () => {
    const h = Reporte.seccionVerificaciones(base());
    Verificaciones.ITEMS.forEach((it: { titulo: string; entidad: string }) => {
      expect(h).toContain(it.titulo.replace(/&/g, '&amp;'));
      expect(h).toContain(it.entidad);
    });
  });

  it('imprime las URL como texto y no como enlaces (en papel no se hace clic)', () => {
    const h = Reporte.seccionVerificaciones(base());
    expect(h).not.toMatch(/<a\b/i);
    expect(h).not.toMatch(/href=/i);
    const urls = Verificaciones.ITEMS.flatMap((i: { enlaces: { url: string }[] }) => i.enlaces.map((e) => e.url));
    expect(urls.length).toBeGreaterThan(0);
    urls.forEach((u: string) => expect(h).toContain(u));
  });

  it('los pasos sin enlace (SEDAPAR) quedan como texto', () => {
    expect(Reporte.seccionVerificaciones(base())).toMatch(/SEDAPAR/);
  });

  it('incluye el aviso de que no es asesoría legal', () => {
    expect(Reporte.seccionVerificaciones(base()).toLowerCase()).toContain('no es asesoría legal');
  });

  it('sin verificaciones no rompe', () => {
    expect(() => Reporte.seccionVerificaciones(base({ verificaciones: null }))).not.toThrow();
  });
});

describe('Reporte.filasResumenExtra', () => {
  it('agrega al resumen quebradas y contexto, con su estado y en línea recta', () => {
    const f = Reporte.filasResumenExtra(base());
    const txt = JSON.stringify(f);
    expect(f.map((x: string[]) => x[0])).toEqual(['Quebradas y cauces', 'Peligros geológicos registrados (contexto)', 'Sismos recientes (contexto)', 'Precio de oferta del distrito (informativo)']);
    expect(txt).toContain('INFORMATIVO');
    expect(txt).toContain('568 m en línea recta');
    expect(txt).toContain('2026-01-01');
  });

  it('con umbral del usuario lo dice en el resumen', () => {
    const f = Reporte.filasResumenExtra(base({ cauce: cauce({ estado: 'CUMPLE', umbralM: 300, segunUmbralUsuario: true }) }));
    expect(f[0][1]).toMatch(/CUMPLE.*según tu umbral de 300 m/);
  });

  it('sin datos calculados no agrega filas', () => {
    expect(Reporte.filasResumenExtra(base({ cauce: null, contextoRiesgo: null, precio: null }))).toEqual([]);
  });
});

describe('Reporte.construirSecciones', () => {
  const titulos = (d: object) => Reporte.construirSecciones(d).map((s: { titulo: string }) => s.titulo);

  it('incluye quebradas, contexto de riesgo y verificaciones, en ese orden tras las 5 variables', () => {
    expect(titulos(base())).toEqual([
      'Zonificación vigente y proyectada', 'Salud', 'Educación por nivel', 'Transporte', 'Área verde',
      'Quebradas y cauces', 'Contexto de riesgo (informativo)', 'Precio de oferta del distrito (informativo)', 'Verificaciones recomendadas antes de comprar',
    ]);
  });

  it('los módulos fuera de alcance se insertan antes de las verificaciones, que siempre cierran', () => {
    const t = titulos(base({ modulos: { desastre: { mostrarPeligro: true, mostrarSismica: false, peligro: null, zonaRiesgo: false }, seguridad: {}, riesgos: { riesgos: [], evaluacion: {}, nivel: () => null, escala: [], decisiones: [] } } }));
    expect(t.slice(-4)).toEqual(['Desastre', 'Seguridad', 'Registro de riesgos', 'Verificaciones recomendadas antes de comprar']);
  });

  it('cada sección trae color, cuerpo y la fuente de sus datos', () => {
    const s = Reporte.construirSecciones(base());
    const q = s.find((x: { titulo: string }) => x.titulo === 'Quebradas y cauces');
    expect(q.fuente).toContain('Autoridad Nacional del Agua');
    expect(q.fuente).toContain('2026-11-02');
    const c = s.find((x: { titulo: string }) => x.titulo.startsWith('Contexto'));
    expect(c.fuente).toContain('INGEMMET');
    expect(c.fuente).toContain('IGP');
    s.forEach((x: { color: string; cuerpo: string }) => { expect(x.color).toMatch(/^#/); expect(x.cuerpo.length).toBeGreaterThan(0); });
  });
});

describe('Reporte.limites', () => {
  it('menciona las quebradas, el contexto y que toda distancia es en línea recta', () => {
    const t = Reporte.limites(base()).join(' ');
    expect(t).toMatch(/quebradas urbanas/);
    expect(t).toMatch(/INFORMATIVO/);
    expect(t).toMatch(/sismos/i);
    expect(t).toMatch(/línea recta/);
    expect(t).toMatch(/METODOLOGIA/);
  });
});

describe('Reporte.estadoHtml', () => {
  it('INFORMATIVO tiene su propia clase y texto (no solo color)', () => {
    expect(Reporte.estadoHtml('INFORMATIVO')).toContain('rp-info');
    expect(Reporte.estadoHtml('INFORMATIVO')).toContain('INFORMATIVO');
    expect(Reporte.estadoHtml('CUMPLE')).toContain('rp-bajo');
    expect(Reporte.estadoHtml('NO CUMPLE')).toContain('rp-alto');
    expect(Reporte.estadoHtml('SIN DATO')).toContain('rp-medio');
  });
});
