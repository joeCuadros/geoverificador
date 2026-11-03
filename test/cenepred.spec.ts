/**
 * Pruebas de public/js/cenepred.js: búsqueda del escenario de riesgo del CENEPRED por distrito (ubigeo o nombre), frases, líneas con
 * los conteos confirmados y datos para la leyenda del mapa. Se fija que el resultado sea siempre INFORMATIVO o SIN DATO (nunca
 * CUMPLE / NO CUMPLE ni puntaje), y se revisa el archivo congelado real contra los distritos del GeoJSON.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const Cenepred = require('../public/js/cenepred.js');
const Distritos = require('../public/js/distritos.js');

const leer = (ruta: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', ruta), 'utf8'));
const bloque = (nivel: string, v = 100, ie = 2, es = 1) => ({ nivel, viviendas: v, instituciones_educativas: ie, establecimientos_salud: es });

const DATOS = {
  fuente: 'CENEPRED (SIGRID)',
  url: 'https://example.org/servicio',
  url_visor: 'https://example.org/visor',
  fecha_descarga: '2026-11-03',
  distritos: {
    '040117': { distrito: 'SACHACA', inundacion: bloque('Muy alto', 7926, 50, 6), movimientos_masa: bloque('Alto', 7926, 23, 3) },
    '040112': { distrito: 'PAUCARPATA', inundacion: bloque('Alto', 36020, 187, 75), movimientos_masa: bloque('Medio', 0, 32, 9) },
    '040129': { distrito: 'JOSE LUIS BUSTAMANTE Y RIVERO', inundacion: bloque('Muy alto'), movimientos_masa: bloque('Bajo', 1, 1, 1) },
    '040101': { distrito: 'AREQUIPA', inundacion: bloque('Muy alto'), movimientos_masa: bloque('Bajo') },
  },
};

describe('Cenepred.buscar', () => {
  it('encuentra el distrito por ubigeo, por nombre con tildes y mayúsculas y por un apodo', () => {
    expect(Cenepred.buscar(DATOS, '040117').distrito).toBe('SACHACA');
    expect(Cenepred.buscar(DATOS, 'sachaca').ubigeo).toBe('040117');
    expect(Cenepred.buscar(DATOS, 'José Luis Bustamante y Rivero').ubigeo).toBe('040129');
    expect(Cenepred.buscar(DATOS, 'cercado').ubigeo).toBe('040101'); // el buscador de nombres de distritos (Distritos.buscarNombre)
    expect(Cenepred.buscar(DATOS, { ubigeo: '040112', distrito: 'PAUCARPATA' }).titulo).toBe('Paucarpata');
  });

  it('devuelve INFORMATIVO con los niveles y los conteos, y nunca un cumple ni un puntaje', () => {
    const r = Cenepred.buscar(DATOS, 'Sachaca');
    expect(r.estado).toBe('INFORMATIVO');
    expect(r.inundacion).toEqual(bloque('Muy alto', 7926, 50, 6));
    expect(r.movimientos_masa.nivel).toBe('Alto');
    expect(JSON.stringify(r)).not.toMatch(/CUMPLE|puntaje|score/i);
  });

  it('un distrito que no está en los datos da SIN DATO con su causa, sin inventar un nivel', () => {
    const r = Cenepred.buscar(DATOS, 'Vítor');
    expect(r.estado).toBe('SIN DATO');
    expect(r.motivo).toBe('fuera_de_datos');
    expect(r.causa).toMatch(/no está en los datos/);
    expect(r.inundacion).toBeUndefined();
    expect(Cenepred.buscar(DATOS, '999999').motivo).toBe('fuera_de_datos');
  });

  it('sin archivo o sin distrito da SIN DATO', () => {
    expect(Cenepred.buscar(null, 'Sachaca').motivo).toBe('sin_archivo');
    expect(Cenepred.buscar({}, 'Sachaca').motivo).toBe('sin_archivo');
    expect(Cenepred.buscar(DATOS, null).motivo).toBe('sin_distrito');
    expect(Cenepred.buscar(DATOS, '').motivo).toBe('sin_distrito');
  });

  it('un distrito con un nivel desconocido no se muestra', () => {
    const malo = { distritos: { '040117': { distrito: 'SACHACA', inundacion: bloque('Extremo'), movimientos_masa: bloque('Alto') } } };
    const r = Cenepred.buscar(malo, 'Sachaca');
    expect(r.estado).toBe('SIN DATO');
    expect(r.motivo).toBe('sin_nivel');
  });
});

describe('Cenepred.frase', () => {
  it('dice el nivel de los dos fenómenos, que es del distrito y que es un escenario', () => {
    const f = Cenepred.frase(Cenepred.buscar(DATOS, 'Sachaca'));
    expect(f).toBe('Según el CENEPRED, el distrito de Sachaca tiene riesgo muy alto ante inundaciones y alto ante movimientos en masa en un escenario El Niño (estimación por distrito, no del predio).');
  });

  it('con un solo fenómeno es la frase de la inundación', () => {
    expect(Cenepred.frase(Cenepred.buscar(DATOS, 'Sachaca'), { fenomenos: ['inundacion'] }))
      .toBe('Según el CENEPRED, el distrito de Sachaca tiene riesgo muy alto ante inundaciones en un escenario El Niño (estimación por distrito, no del predio).');
    expect(Cenepred.frase(Cenepred.buscar(DATOS, 'Paucarpata'), { fenomenos: ['movimientos_masa'] })).toMatch(/riesgo medio ante movimientos en masa/);
  });

  it('si los dos niveles son iguales no los repite', () => {
    const iguales = { distritos: { '040117': { distrito: 'SACHACA', inundacion: bloque('Alto'), movimientos_masa: bloque('Alto') } } };
    expect(Cenepred.frase(Cenepred.buscar(iguales, 'Sachaca'))).toMatch(/riesgo alto ante inundaciones y movimientos en masa en un escenario/);
  });

  it('sin dato no hay frase', () => {
    expect(Cenepred.frase(Cenepred.buscar(DATOS, 'Vítor'))).toBeNull();
    expect(Cenepred.niveles(Cenepred.buscar(DATOS, 'Vítor'))).toBeNull();
    expect(Cenepred.lineas(Cenepred.buscar(DATOS, 'Vítor'))).toEqual([]);
  });
});

describe('Cenepred.lineas y niveles', () => {
  it('una línea por fenómeno con los conteos, con miles separados', () => {
    const l = Cenepred.lineas(Cenepred.buscar(DATOS, 'Paucarpata'));
    expect(l).toHaveLength(2);
    expect(l[0].texto).toBe('Inundaciones: riesgo alto. En zonas de mayor susceptibilidad a inundaciones: 36 020 viviendas, 187 locales educativos y 75 establecimientos de salud.');
    expect(l[1].texto).toMatch(/Movimientos en masa: riesgo medio\. .*0 viviendas, 32 locales educativos y 9 establecimientos de salud\./);
  });

  it('usa el singular cuando es uno', () => {
    const l = Cenepred.lineas(Cenepred.buscar(DATOS, 'Bustamante y Rivero'), { fenomenos: ['movimientos_masa'] });
    expect(l[0].texto).toContain('1 vivienda, 1 local educativo y 1 establecimiento de salud');
  });

  it('niveles resume en una línea', () => {
    expect(Cenepred.niveles(Cenepred.buscar(DATOS, 'Sachaca'))).toBe('inundaciones: muy alto; movimientos en masa: alto');
  });
});

describe('Cenepred.porNivel y distritosPorFenomeno', () => {
  it('cuenta los distritos de cada nivel en el orden de menor a mayor', () => {
    expect(Cenepred.porNivel(DATOS, 'inundacion')).toEqual([{ nivel: 'Alto', n: 1 }, { nivel: 'Muy alto', n: 3 }]);
    expect(Cenepred.porNivel(DATOS, 'movimientos_masa')).toEqual([{ nivel: 'Bajo', n: 2 }, { nivel: 'Medio', n: 1 }, { nivel: 'Alto', n: 1 }]);
    expect(Cenepred.porNivel(DATOS, 'otro')).toEqual([]);
  });

  it('lista los distritos con su nivel para colorear el mapa', () => {
    const l = Cenepred.distritosPorFenomeno(DATOS, 'inundacion');
    expect(l).toHaveLength(4);
    expect(l.find((x: { distrito: string }) => x.distrito === 'SACHACA')).toMatchObject({ ubigeo: '040117', nivel: 'Muy alto', viviendas: 7926 });
  });
});

describe('archivo congelado real (data/riesgo_cenepred_fen2027.json)', () => {
  const datos = leer('data/riesgo_cenepred_fen2027.json');
  const geo = leer('data/distritos_aqp.geojson');

  it('trae los 25 distritos del GeoJSON, emparejados por ubigeo y con el mismo nombre', () => {
    expect(Object.keys(datos.distritos)).toHaveLength(25);
    geo.features.forEach((f: { properties: { ubigeo: string; distrito: string } }) => {
      expect(datos.distritos[f.properties.ubigeo]?.distrito).toBe(f.properties.distrito);
    });
  });

  it('todos los niveles son del conjunto conocido y cada distrito da INFORMATIVO', () => {
    Distritos.cargarParaPruebas(geo);
    geo.features.forEach((f: { properties: { distrito: string; ubigeo: string } }) => {
      const r = Cenepred.buscar(datos, f.properties.distrito);
      expect(r.estado).toBe('INFORMATIVO');
      expect(Cenepred.NIVELES).toContain(r.inundacion.nivel);
      expect(Cenepred.NIVELES).toContain(r.movimientos_masa.nivel);
      expect(Cenepred.buscar(datos, f.properties.ubigeo).distrito).toBe(f.properties.distrito);
    });
  });

  it('dice de dónde sale, de cuándo es y qué escala tiene', () => {
    expect(datos.url).toMatch(/sigrid\.cenepred\.gob\.pe/);
    expect(datos.url_visor).toBe('https://sigrid.cenepred.gob.pe/sigridv3/');
    expect(datos.fecha_descarga).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(datos.nota).toMatch(/distrital/i);
    expect(datos.nota).toMatch(/no es una evaluación/i);
    expect(datos.estudio.url).toMatch(/\.pdf$/);
  });

  it('Sachaca tiene riesgo muy alto ante inundaciones (la frase del producto)', () => {
    expect(Cenepred.frase(Cenepred.buscar(datos, 'Sachaca'), { fenomenos: ['inundacion'] }))
      .toBe('Según el CENEPRED, el distrito de Sachaca tiene riesgo muy alto ante inundaciones en un escenario El Niño (estimación por distrito, no del predio).');
  });
});
