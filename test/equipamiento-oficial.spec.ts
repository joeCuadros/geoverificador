/**
 * Pruebas de scripts/lib/equipamiento-oficial.js: la lógica pura detrás de scripts/descargar-equipamiento-oficial.mjs.
 * Lectura de DBF (ESCALE) y ZIP, selección de los establecimientos de salud (RENIPRESS) y de los locales educativos (ESCALE),
 * correspondencia de códigos de nivel y la fusión con OpenStreetMap como respaldo. Con archivos pequeños de test/fixtures,
 * sin red ni datos oficiales reales.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const E = require('../scripts/lib/equipamiento-oficial.js');
const V = require('../scripts/lib/validacion-oficial.js');

const fixture = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const dLat = (m: number) => m / M_POR_GRADO_LAT;
const dLon = (m: number, lat: number) => m / (M_POR_GRADO_LAT * Math.cos((lat * Math.PI) / 180));

// El «distrito» de prueba es todo menos el punto lejano de los archivos de muestra (-16,42 -71,40).
const dentro = (lat: number, lon: number) => !(lat === -16.42 && lon === -71.4);

// ------------------------------------------------------------------------------ DBF

/** Arma un DBF mínimo (dBase III) con campos de texto y uno numérico; `texto` va en CP850. */
function armarDbf(campos: Array<[string, string, number]>, filas: Array<Array<string | number>>, borrados: number[] = []) {
  const largoRegistro = 1 + campos.reduce((s, c) => s + c[2], 0);
  const inicio = 32 + 32 * campos.length + 1;
  const cab = Buffer.alloc(32);
  cab[0] = 3;
  cab.writeUInt32LE(filas.length, 4);
  cab.writeUInt16LE(inicio, 8);
  cab.writeUInt16LE(largoRegistro, 10);
  cab[29] = 2; // controlador de idioma: DOS multilingüe (CP850)
  const descr = campos.map(([nombre, tipo, largo]) => {
    const b = Buffer.alloc(32);
    b.write(nombre, 0, 'latin1');
    b.write(tipo, 11, 'latin1');
    b[16] = largo;
    return b;
  });
  const cp850 = (s: string) => Buffer.from([...s].map((ch) => ({ 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'é': 0x82, 'É': 0x90, 'í': 0xa1, 'á': 0xa0 }[ch as 'ó'] ?? ch.charCodeAt(0))));
  const regs = filas.map((f, i) => {
    const b = Buffer.alloc(largoRegistro, 0x20);
    b[0] = borrados.includes(i) ? 0x2a : 0x20;
    let p = 1;
    campos.forEach(([, , largo], k) => {
      const v = cp850(String(f[k]));
      v.copy(b, p, 0, Math.min(largo, v.length));
      p += largo;
    });
    return b;
  });
  return Buffer.concat([cab, ...descr, Buffer.from([0x0d]), ...regs, Buffer.from([0x1a])]);
}

describe('decodificarCp850', () => {
  it('decodifica las letras con tilde y la eñe del DBF de ESCALE', () => {
    expect(E.decodificarCp850(Buffer.from([0x45, 0x64, 0x75, 0x63, 0x61, 0x63, 0x69, 0xa2, 0x6e]))).toBe('Educación');
    expect(E.decodificarCp850(Buffer.from([0x4d, 0x61, 0xa4, 0x61, 0x6e, 0x61]))).toBe('Mañana');
    expect(E.decodificarCp850(Buffer.from([0x50, 0xa3, 0x62, 0x6c, 0x69, 0x63, 0x61]))).toBe('Pública');
  });
});

describe('leerDbf', () => {
  const campos: Array<[string, string, number]> = [['COD_MOD', 'C', 7], ['CEN_EDU', 'C', 30], ['D_NIV_MOD', 'C', 20], ['NLAT_IE', 'N', 12]];
  const buf = armarDbf(campos, [['0100001', 'SAN JOSÉ', 'Educación', -16.4], ['0100002', 'NIÑO JESUS', 'Primaria', -16.5], ['0100003', 'BORRADO', 'Primaria', -16.6]], [2]);
  const dbf = E.leerDbf(buf);

  it('lee los campos con nombre en minúsculas, tipo y largo', () => {
    expect(dbf.campos.map((c: { nombre: string }) => c.nombre)).toEqual(['cod_mod', 'cen_edu', 'd_niv_mod', 'nlat_ie']);
    expect(dbf.campos[0]).toMatchObject({ tipo: 'C', largo: 7 });
  });
  it('decodifica el texto en CP850 y recorta los espacios', () => {
    expect(dbf.filas[0]).toEqual({ cod_mod: '0100001', cen_edu: 'SAN JOSÉ', d_niv_mod: 'Educación', nlat_ie: '-16.4' });
    expect(dbf.filas[1]).toMatchObject({ cen_edu: 'NIÑO JESUS', nlat_ie: '-16.5' });
  });
  it('omite los registros marcados como borrados', () => {
    expect(dbf.filas.map((f: { cod_mod: string }) => f.cod_mod)).toEqual(['0100001', '0100002']);
  });
  it('rechaza un archivo que no es un DBF', () => {
    expect(() => E.leerDbf(Buffer.from('esto no es un dbf'))).toThrow(/DBF/);
  });
  it('leerDbfArchivo aplica el filtro por bloques y devuelve solo lo que pasa', () => {
    const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dbf-')), 'p.dbf');
    fs.writeFileSync(ruta, buf);
    const r = E.leerDbfArchivo(ruta, { filtro: (f: { cod_mod: string }) => f.cod_mod !== '0100001', registrosPorBloque: 1 });
    expect(r.total).toBe(3);
    expect(r.filas.map((f: { cod_mod: string }) => f.cod_mod)).toEqual(['0100002']);
  });
});

// ------------------------------------------------------------------------------ ZIP

describe('extraerEntradaZip', () => {
  /** Un ZIP de una entrada, con la estructura mínima (cabecera local, directorio central y fin de directorio). */
  function armarZip(nombre: string, contenido: Buffer, metodo: 0 | 8) {
    const datos = metodo === 8 ? zlib.deflateRawSync(contenido) : contenido;
    const nom = Buffer.from(nombre);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(datos.length, 18);
    local.writeUInt32LE(contenido.length, 22);
    local.writeUInt16LE(nom.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(datos.length, 20);
    central.writeUInt32LE(contenido.length, 24);
    central.writeUInt16LE(nom.length, 28);
    central.writeUInt32LE(0, 42); // desplazamiento de la cabecera local
    const dirCentral = Buffer.concat([central, nom]);
    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(0x06054b50, 0);
    fin.writeUInt16LE(1, 8);
    fin.writeUInt16LE(1, 10);
    fin.writeUInt32LE(dirCentral.length, 12);
    fin.writeUInt32LE(30 + nom.length + datos.length, 16);
    return Buffer.concat([local, nom, datos, dirCentral, fin]);
  }
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));

  it.each([8, 0] as const)('extrae una entrada (método %i) a un archivo', async (metodo) => {
    const contenido = Buffer.from('contenido del padrón\n'.repeat(500));
    const zip = path.join(carpeta, `p${metodo}.zip`);
    fs.writeFileSync(zip, armarZip('Padron_web.dbf', contenido, metodo));
    expect(E.listarEntradasZip(fs.readFileSync(zip)).map((e: { nombre: string }) => e.nombre)).toEqual(['Padron_web.dbf']);
    const salida = path.join(carpeta, `salida${metodo}.dbf`);
    await E.extraerEntradaZip(zip, 'Padron_web.dbf', salida);
    expect(fs.readFileSync(salida).equals(contenido)).toBe(true);
  });
  it('dice qué entradas hay si la pedida no existe', async () => {
    const zip = path.join(carpeta, 'otro.zip');
    fs.writeFileSync(zip, armarZip('otro.txt', Buffer.from('x'), 0));
    await expect(E.extraerEntradaZip(zip, 'Padron_web.dbf', path.join(carpeta, 'x.dbf'))).rejects.toThrow(/Padron_web\.dbf.*otro\.txt/);
  });
});

// ------------------------------------------------------------------ Ediciones en las páginas

describe('ultimaEdicionRenipress y ultimoPadronEscale', () => {
  it('elige el CSV de RENIPRESS con la fecha más reciente del nombre (día-mes-año)', () => {
    const html = '<a href="https://www.datosabiertos.gob.pe/sites/default/files/RENIPRESS_30-09-2026.csv">a</a><a href="https://www.datosabiertos.gob.pe/sites/default/files/RENIPRESS_30-10-2026.csv">b</a><a href="https://www.datosabiertos.gob.pe/sites/default/files/RENIPRESS_31-08-2026.csv">c</a><a href="/sites/default/files/RENIPRESS_30-10-2026.csv">dup</a>';
    expect(E.ultimaEdicionRenipress(html)).toEqual({ url: 'https://www.datosabiertos.gob.pe/sites/default/files/RENIPRESS_30-10-2026.csv', fecha: '2026-10-30', nombre: 'RENIPRESS_30-10-2026.csv' });
  });
  it('sin ningún CSV lo dice en vez de inventar una dirección', () => {
    expect(() => E.ultimaEdicionRenipress('<html></html>')).toThrow(/RENIPRESS/);
    expect(() => E.ultimoPadronEscale('<html></html>')).toThrow(/Padron_web/);
  });
  it('elige el ZIP del padrón de ESCALE con la fecha más reciente (año-mes-día)', () => {
    const html = '<a>Padron_web_20261009.zip</a><a>Padron_web_20261030.zip</a><a>Padron_web_20261023.zip</a>';
    expect(E.ultimoPadronEscale(html)).toEqual({ nombre: 'Padron_web_20261030.zip', fecha: '2026-10-30', url: 'https://escale.minedu.gob.pe/documents/10156/958881/Padron_web_20261030.zip' });
  });
});

// ------------------------------------------------------------------------------ Salud

describe('clasificarSalud', () => {
  const r = (extra: object) => ({ tipoEstablecimiento: 'ESTABLECIMIENTO DE SALUD SIN INTERNAMIENTO', categoria: 'I-3', tipo: 'POLICLINICOS', ...extra });
  it('con y sin internamiento, de I-1 a III-E, cuentan', () => {
    for (const categoria of ['I-1', 'I-2', 'I-3', 'I-4', 'II-1', 'II-2', 'II-E', 'III-1', 'III-2', 'III-E']) {
      expect(E.clasificarSalud(r({ categoria })).incluir).toBe(true);
    }
    expect(E.clasificarSalud(r({ tipoEstablecimiento: 'ESTABLECIMIENTO DE SALUD CON INTERNAMIENTO', categoria: 'II-1' })).incluir).toBe(true);
  });
  it('el servicio médico de apoyo (laboratorios, imágenes, traslado, ópticas) no cuenta, aunque traiga categoría', () => {
    expect(E.clasificarSalud(r({ tipoEstablecimiento: 'SERVICIO MÉDICO DE APOYO', categoria: '0' }))).toEqual({ incluir: false, motivo: 'apoyo' });
    expect(E.clasificarSalud(r({ tipoEstablecimiento: 'SERVICIO MEDICO DE APOYO', categoria: 'I-3' })).motivo).toBe('apoyo');
  });
  it('sin una categoría válida (vacía, 0 o con otro formato) no cuenta', () => {
    for (const categoria of ['', '0', 'IV-1', 'I-5', 'sin categoria']) expect(E.clasificarSalud(r({ categoria }))).toEqual({ incluir: false, motivo: 'sinCategoria' });
  });
  it('el centro odontológico no cuenta (solo atiende una especialidad; OpenStreetMap también excluye al dentista)', () => {
    expect(E.clasificarSalud(r({ tipo: 'CENTRO ODONTOLOGICO' }))).toEqual({ incluir: false, motivo: 'odontologico' });
  });
  it('el consultorio médico (I-1, I-2) cuenta: es atención ambulatoria', () => {
    expect(E.clasificarSalud(r({ tipo: 'CONSULTORIOS MEDICOS Y DE OTROS PROFESIONALES DE LA SALUD', categoria: 'I-1' })).incluir).toBe(true);
  });
});

describe('seleccionarSalud', () => {
  const s = E.seleccionarSalud(fixture('renipress_oficial_muestra.csv'), { dentro });

  it('lee latitud y longitud de las columnas NORTE y ESTE (grados decimales)', () => {
    const h = s.registros.find((x: { id: string }) => x.id === '00001');
    expect(h).toMatchObject({ lat: -16.4075, lon: -71.5275, nombre: 'HOSPITAL REGIONAL HONORIO DELGADO', categoria: 'III-1', distrito: 'AREQUIPA' });
  });
  it('deja los activos de la provincia con coordenadas dentro del distrito y de una categoría de atención', () => {
    expect(s.registros.map((x: { id: string }) => x.id)).toEqual(['00001', '00002', '00003', '00004']);
  });
  it('cuenta lo descartado por cada causa', () => {
    expect(s.descartados).toMatchObject({
      total: 14, sinCoordenadas: 1, otraProvincia: 1, fueraDeZona: 0, fueraDeDistrito: 1, inactivos: 2, repetidos: 1,
      apoyo: 2, odontologicos: 1, sinCategoria: 1,
    });
  });
  it('el cierre temporal y la baja no son activos (solo «ACTIVO» lo es)', () => {
    const ids = s.registros.map((x: { id: string }) => x.id);
    expect(ids).not.toContain('00008');
    expect(ids).not.toContain('00009');
  });
  it('conserva el código, la categoría y la clasificación de RENIPRESS', () => {
    expect(s.registros.find((x: { id: string }) => x.id === '00004')).toMatchObject({ tipo: 'CONSULTORIOS MEDICOS Y DE OTROS PROFESIONALES DE LA SALUD', categoria: 'I-1' });
  });
  it('un archivo con NORTE y ESTE en metros (UTM) se rechaza diciendo qué falta', () => {
    expect(() => E.seleccionarSalud('COD_IPRESS;NOMBRE;NORTE;ESTE\n1;X;8000000;230000\n')).toThrow(/latitud/);
  });
});

// -------------------------------------------------------------------------- Educación

describe('nivelDeCodigo (educación básica regular)', () => {
  it('solo A1, A2 y A3 son inicial; B0 es primaria y F0 es secundaria', () => {
    expect(['A1', 'A2', 'A3'].map(V.nivelDeCodigo)).toEqual(['inicial', 'inicial', 'inicial']);
    expect(V.nivelDeCodigo('B0')).toBe('primaria');
    expect(V.nivelDeCodigo('F0')).toBe('secundaria');
  });
  it('el programa no escolarizado (A5), los adultos (C0, G0), la alternativa (D*), la especial (E*, K0), la técnico-productiva y la superior (L*, M0, P0, S0, T0) no son educación básica regular', () => {
    for (const c of ['A5', 'C0', 'G0', 'D0', 'D1', 'D2', 'E0', 'E1', 'E2', 'K0', 'L0', 'L4', 'M0', 'P0', 'S0', 'T0', '', 'ZZ']) expect(V.nivelDeCodigo(c)).toBeNull();
  });
  it('acepta minúsculas y espacios', () => {
    expect(V.nivelDeCodigo(' b0 ')).toBe('primaria');
  });
});

describe('seleccionarEscale', () => {
  const csv = V.parsearCsv(fixture('padron_escale_muestra.csv'));
  const e = E.seleccionarEscale({ columnas: csv.columnas, filas: csv.filas }, { dentro });
  const local = (cod: string) => e.locales.find((l: { codLocal: string }) => l.codLocal === cod);

  it('deja los locales activos de la provincia con coordenadas, dentro del distrito y con un nivel básico regular', () => {
    expect(e.locales.map((l: { codLocal: string }) => l.codLocal).sort()).toEqual(['100001', '100002', '100009', '100010', '100011']);
  });
  it('la cuna-jardín (A3) y la cuna (A1) son inicial', () => {
    expect(local('100010').niveles).toEqual(['inicial']);
    expect(local('100011').niveles).toEqual(['inicial']);
  });
  it('un local con varias instituciones junta los niveles y guarda el código modular, el nombre, el nivel y la gestión de cada una', () => {
    expect(local('100001').niveles).toEqual(['primaria', 'secundaria']);
    expect(local('100001').instituciones).toEqual([
      { codigoModular: '0100001', nombre: '40001 GLORIOSO COLEGIO NACIONAL, DE VARONES', nivel: 'primaria', gestion: 'Pública' },
      { codigoModular: '0100002', nombre: '40001 GLORIOSO COLEGIO NACIONAL, DE VARONES', nivel: 'secundaria', gestion: 'Pública' },
    ]);
  });
  it('mantiene los colegios públicos y los privados; «pública de gestión privada» es pública', () => {
    expect(local('100010').instituciones[0].gestion).toBe('Privada');
    expect(local('100009').instituciones.map((i: { gestion: string }) => i.gestion).sort()).toEqual(['Privada', 'Pública']);
  });
  it('cuenta las causas de descarte: inactivas, otro nivel (programa no escolarizado, adultos, alternativa, especial, superior), otra provincia, sin coordenadas y fuera del distrito', () => {
    expect(e.descartados).toMatchObject({ total: 16, inactivas: 1, otraProvincia: 1, sinCoordenadas: 1, fueraDeDistrito: 1, otroNivel: 5 });
  });
  it('el estado se lee del texto («Activo») y, si no lo hay, del código (1 activo, 2 inactivo)', () => {
    const t = 'CODLOCAL,CEN_EDU,NIV_MOD,ESTADO,NLAT_IE,NLONG_IE\n1,A,B0,1,-16.4,-71.5\n2,B,B0,2,-16.41,-71.5\n';
    const c = V.parsearCsv(t);
    expect(E.seleccionarEscale(c).locales.map((l: { codLocal: string }) => l.codLocal)).toEqual(['1']);
  });
});

describe('seleccionarEscaleDbf: del Padron_web.dbf a los locales', () => {
  const campos: Array<[string, string, number]> = [
    ['CODLOCAL', 'C', 6], ['COD_MOD', 'C', 7], ['CEN_EDU', 'C', 40], ['NIV_MOD', 'C', 2], ['D_NIV_MOD', 'C', 30], ['D_GESTION', 'C', 30],
    ['D_DPTO', 'C', 15], ['D_PROV', 'C', 20], ['D_DIST', 'C', 20], ['NLAT_IE', 'N', 12], ['NLONG_IE', 'N', 12], ['ESTADO', 'C', 1], ['D_ESTADO', 'C', 10],
  ];
  const fila = (loc: string, mod: string, nombre: string, niv: string, txt: string, ges: string, prov: string, estado: string) =>
    [loc, mod, nombre, niv, txt, ges, 'AREQUIPA', prov, 'CAYMA', -16.38, -71.54, estado === 'Activo' ? '1' : '2', estado];
  const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'padron-')), 'Padron_web.dbf');
  fs.writeFileSync(ruta, armarDbf(campos, [
    fila('000001', '0000011', 'ESCUELA 1', 'B0', 'Primaria', 'Pública de gestión directa', 'AREQUIPA', 'Activo'),
    fila('000001', '0000012', 'COLEGIO 1', 'F0', 'Secundaria', 'Pública de gestión directa', 'AREQUIPA', 'Activo'),
    fila('000002', '0000021', 'JARDÍN 2', 'A2', 'Inicial - Jardín', 'Privada', 'AREQUIPA', 'Inactivo'),
    fila('000003', '0000031', 'ESCUELA DE CAYLLOMA', 'B0', 'Primaria', 'Privada', 'CAYLLOMA', 'Activo'),
    fila('000004', '0000041', 'JARDIN 4', 'A3', 'Inicial - Cuna-jardín', 'Privada', 'AREQUIPA', 'Activo'),
  ]));
  const r = E.seleccionarEscaleDbf(ruta);

  it('lee el padrón por bloques, se queda con la provincia de Arequipa y aplica las mismas reglas que el CSV', () => {
    expect(r.totalPadron).toBe(5);
    expect(r.filasProvincia).toBe(4);
    expect(r.locales.map((l: { codLocal: string }) => l.codLocal)).toEqual(['000001', '000004']);
    expect(r.locales[0].niveles).toEqual(['primaria', 'secundaria']);
    expect(r.locales[1].niveles).toEqual(['inicial']);
    expect(r.descartados).toMatchObject({ inactivas: 1 });
  });
  it('guarda el código modular y la gestión de cada institución', () => {
    expect(r.locales[0].instituciones.map((i: { codigoModular: string }) => i.codigoModular)).toEqual(['0000011', '0000012']);
    expect(r.locales[1].instituciones[0].gestion).toBe('Privada');
  });
});

// ------------------------------------------------------------------------ Entidades

describe('featureSalud y featureEscale', () => {
  const reg = { id: '00001', nombre: 'HOSPITAL X', lat: -16.4075123, lon: -71.5275987, categoria: 'III-1', tipo: 'HOSPITALES', distrito: 'AREQUIPA' };
  it('featureSalud lleva la fuente, el código de RENIPRESS, el nombre y la categoría, con 5 decimales', () => {
    expect(E.featureSalud(reg)).toEqual({
      type: 'Feature',
      properties: { fuente: 'RENIPRESS', nombre: 'HOSPITAL X', codigo_renipress: '00001', categoria: 'III-1', clasificacion: 'HOSPITALES', distrito: 'AREQUIPA' },
      geometry: { type: 'Point', coordinates: [-71.5276, -16.40751] },
    });
  });
  it('featureEscale lleva la fuente, el código modular, el código de local, el nombre y los niveles', () => {
    const f = E.featureEscale({
      codLocal: '100001', nombre: 'A', niveles: ['primaria', 'secundaria'], lat: -16.399, lon: -71.537, distrito: 'AREQUIPA',
      instituciones: [{ codigoModular: '0100001', nombre: 'A', nivel: 'primaria', gestion: 'Pública' }, { codigoModular: '0100002', nombre: 'B', nivel: 'secundaria', gestion: 'Pública' }],
    });
    expect(f.properties).toMatchObject({ fuente: 'ESCALE', nombre: 'A', codigo_modular: '0100001', codigo_local: '100001', niveles: ['primaria', 'secundaria'], distrito: 'AREQUIPA' });
    expect(f.properties.instituciones).toHaveLength(2);
    expect(f.geometry.coordinates).toEqual([-71.537, -16.399]);
  });
});

// -------------------------------------------------------------------------- Fusión

const LAT = -16.4;
const LON = -71.53;
const osmPunto = (osmId: string, nombre: string, metrosAlEste: number, tags: Record<string, string>) => ({
  type: 'Feature', properties: { osm: osmId, nombre, tags }, geometry: { type: 'Point', coordinates: [LON + dLon(metrosAlEste, LAT), LAT] },
});
const oficialSalud = (cod: string, nombre: string, metrosAlEste: number) =>
  E.featureSalud({ id: cod, nombre, lat: LAT, lon: LON + dLon(metrosAlEste, LAT), categoria: 'I-3', tipo: 'POLICLINICOS', distrito: 'X' });
const oficialColegio = (cod: string, nombre: string, niveles: string[], metrosAlEste: number) =>
  E.featureEscale({
    codLocal: cod, nombre, niveles, lat: LAT, lon: LON + dLon(metrosAlEste, LAT), distrito: 'X',
    instituciones: niveles.map((n) => ({ codigoModular: `M${cod}${n[0]}`, nombre, nivel: n, gestion: 'Privada' })),
  });

describe('fusionarSalud: RENIPRESS primero, OpenStreetMap como respaldo', () => {
  const oficiales = [oficialSalud('R1', 'Clínica Alfa', 0), oficialSalud('R2', 'Posta Bravo', 5000)];
  const osm = [
    osmPunto('node/1', 'Clínica Alfa', 30, { amenity: 'clinic' }), // mismo nombre y a 30 m: duplicado
    osmPunto('node/2', 'Consultorio Distinto', 150, { amenity: 'doctors' }), // otro nombre pero a 150 m de un oficial: se descarta por cercanía
    osmPunto('node/3', 'Hospital Charlie', 1000, { amenity: 'hospital' }), // a 1 km de todo: se queda
    osmPunto('node/4', 'Clínica Delta', 199, { healthcare: 'clinic' }), // 199 m: dentro del radio, se descarta
    osmPunto('node/5', 'Clínica Eco', 201 + 5000, { amenity: 'clinic' }), // 201 m de R2: fuera del radio, se queda
  ];
  const r = E.fusionarSalud(oficiales, osm, { radioM: 200 });
  const porFuente = (f: string) => r.features.filter((x: { properties: { fuente: string } }) => x.properties.fuente === f);

  it('incluye todos los puntos oficiales', () => {
    expect(porFuente('RENIPRESS').map((f: { properties: { codigo_renipress: string } }) => f.properties.codigo_renipress)).toEqual(['R1', 'R2']);
  });
  it('añade de OpenStreetMap solo lo que no tiene un punto oficial a 200 m o menos', () => {
    expect(porFuente('OSM').map((f: { properties: { osm: string } }) => f.properties.osm)).toEqual(['node/3', 'node/5']);
  });
  it('lo de OpenStreetMap conserva su identificador, su nombre y sus etiquetas, y dice que es de OSM', () => {
    expect(porFuente('OSM')[0]).toMatchObject({ properties: { fuente: 'OSM', osm: 'node/3', nombre: 'Hospital Charlie', tags: { amenity: 'hospital' } } });
  });
  it('los oficiales van primero y en orden de código', () => {
    expect(r.features.map((f: { properties: { fuente: string } }) => f.properties.fuente)).toEqual(['RENIPRESS', 'RENIPRESS', 'OSM', 'OSM']);
  });
  it('cuenta por fuente y dice cuántas de OSM se descartaron y por qué (mismo nombre o solo cercanía)', () => {
    expect(r.conteo).toEqual({ RENIPRESS: 2, OSM: 2 });
    expect(r.osm).toEqual({ total: 5, conservadas: 2, descartadas: 3, porNombreYDistancia: 1, soloPorDistancia: 2 });
  });
  it('si el radio es menor, se queda más de OpenStreetMap', () => {
    expect(E.fusionarSalud(oficiales, osm, { radioM: 50 }).conteo.OSM).toBe(4);
  });
  it('sin datos de OpenStreetMap devuelve solo lo oficial', () => {
    expect(E.fusionarSalud(oficiales, [], { radioM: 200 }).conteo).toEqual({ RENIPRESS: 2, OSM: 0 });
  });
  it('un elemento de OpenStreetMap que no es un punto no se puede ubicar y no se añade', () => {
    const linea = { type: 'Feature', properties: { osm: 'way/9', nombre: 'X', tags: { amenity: 'clinic' } }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } };
    expect(E.fusionarSalud(oficiales, [linea], { radioM: 200 }).conteo.OSM).toBe(0);
  });
});

describe('fusionarEducacion: ESCALE primero, OpenStreetMap como respaldo por nivel', () => {
  const oficiales = [oficialColegio('L1', 'Colegio Alfa', ['primaria', 'secundaria'], 0), oficialColegio('L2', 'Jardín Bravo', ['inicial'], 3000)];
  const osm = [
    osmPunto('node/1', 'Colegio Alfa', 20, { amenity: 'school', 'isced:level': '1;2' }), // mismos niveles a 20 m: duplicado
    osmPunto('node/2', 'Escuela sin nivel', 100, { amenity: 'school' }), // se supone primaria y secundaria, ambas cubiertas a 100 m
    osmPunto('node/3', 'Kínder Charlie', 100, { amenity: 'kindergarten' }), // inicial: el oficial cercano es primaria y secundaria, no cubre inicial
    osmPunto('node/4', 'Colegio Lejano', 1000, { amenity: 'school', 'isced:level': '1' }), // a 1 km de todo
    osmPunto('node/5', 'Instituto Superior', 1000, { amenity: 'school', 'isced:level': '5' }), // educación superior: no es un nivel básico
    osmPunto('node/6', 'Colegio Mixto', 100, { amenity: 'school', 'isced:level': '0;1' }), // inicial no cubierto, primaria sí
  ];
  const r = E.fusionarEducacion(oficiales, osm, { radioM: 200 });
  const osmKept = r.features.filter((f: { properties: { fuente: string } }) => f.properties.fuente === 'OSM');

  it('incluye todos los locales oficiales', () => {
    expect(r.features.filter((f: { properties: { fuente: string } }) => f.properties.fuente === 'ESCALE').map((f: { properties: { codigo_local: string } }) => f.properties.codigo_local)).toEqual(['L1', 'L2']);
  });
  it('conserva de OpenStreetMap lo que aporta un nivel que no cubre ningún local oficial a 200 m', () => {
    expect(osmKept.map((f: { properties: { osm: string } }) => f.properties.osm)).toEqual(['node/3', 'node/4', 'node/6']);
  });
  it('lo que conserva lleva solo los niveles que el registro oficial no cubre ahí', () => {
    const niveles = Object.fromEntries(osmKept.map((f: { properties: { osm: string; niveles: string[] } }) => [f.properties.osm, f.properties.niveles]));
    expect(niveles).toEqual({ 'node/3': ['inicial'], 'node/4': ['primaria'], 'node/6': ['inicial'] });
  });
  it('lo de OpenStreetMap dice que es de OSM y conserva su identificador, nombre y etiquetas', () => {
    expect(osmKept[0]).toMatchObject({ properties: { fuente: 'OSM', osm: 'node/3', nombre: 'Kínder Charlie', tags: { amenity: 'kindergarten' } } });
  });
  it('cuenta por fuente y por nivel, y cuántas de OSM se descartaron', () => {
    expect(r.conteo).toMatchObject({ ESCALE: 2, OSM: 3 });
    expect(r.porNivel).toEqual({
      ESCALE: { inicial: 1, primaria: 1, secundaria: 1 },
      OSM: { inicial: 2, primaria: 1, secundaria: 0 },
    });
    expect(r.osm).toMatchObject({ total: 6, conservadas: 3, sinNivelBasico: 1 });
  });
});

describe('metadatos de procedencia', () => {
  it('juntan fuentes, fechas, licencias, conteos y la regla de deduplicación', () => {
    const m = E.procedencia({
      categoria: 'salud', oficial: { id: 'RENIPRESS', nombre: 'RENIPRESS (SUSALUD)', url: 'https://x/ren.csv', pagina: 'https://x', fecha: '2026-10-30', licencia: 'ODC-By' },
      osm: { fecha: '2026-10-28', osm_base: '2026-10-28T12:31:29Z' }, conteo: { RENIPRESS: 3, OSM: 1 }, radioM: 200, regla: 'regla de salud', descartes: { total: 9 }, osmDescartes: { total: 5 },
    });
    expect(m).toMatchObject({
      fuente: expect.stringContaining('RENIPRESS'),
      fuentes: [expect.objectContaining({ id: 'RENIPRESS', licencia: 'ODC-By', fecha: '2026-10-30' }), expect.objectContaining({ id: 'OSM', licencia: 'ODbL', fecha: '2026-10-28' })],
      conteo_por_fuente: { RENIPRESS: 3, OSM: 1 },
      deduplicacion: { radio_m: 200 },
      fecha_extraccion: '2026-10-30',
      registros: 4,
    });
  });
});
