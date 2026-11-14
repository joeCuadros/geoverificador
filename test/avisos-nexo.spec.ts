/**
 * Pruebas de la fuente Nexo Inmobiliario (scripts/lib/avisos/fuentes/nexo.js): lectura de `const projects = [...]` con una
 * muestra recortada de la respuesta real de /venta-de-inmuebles/arequipa (test/fixtures/avisos/) y búsqueda con un cliente
 * falso (sin red). Nexo publica PROYECTOS inmobiliarios con rangos («desde»), no avisos de unidades sueltas.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const Nexo = require('../scripts/lib/avisos/fuentes/nexo.js');
const E = require('../scripts/lib/avisos/esquema.js');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'avisos', 'nexo-arequipa-muestra.html'), 'utf8');
const geojson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'distritos_aqp.geojson'), 'utf8'));
const DISTRITOS: string[] = geojson.features.map((f: { properties: { distrito: string } }) => f.properties.distrito);
const ctx = { distritosConocidos: DISTRITOS, ahora: new Date('2026-11-12T10:00:00.000Z') };
type Aviso = Record<string, any>;

describe('Nexo.extraerProyectos', () => {
  it('lee el arreglo JSON de «const projects = [...]»', () => {
    expect(Nexo.extraerProyectos(fixture)).toHaveLength(3);
  });
  it('respeta corchetes y comillas dentro de los textos', () => {
    const html = 'const projects = [{"name":"A ] [ \\" B","x":[1,2]}];\nconst otra = [9];';
    expect(Nexo.extraerProyectos(html)).toEqual([{ name: 'A ] [ " B', x: [1, 2] }]);
  });
  it('devuelve null si no está o el JSON está cortado', () => {
    expect(Nexo.extraerProyectos('<html></html>')).toBeNull();
    expect(Nexo.extraerProyectos('const projects = [{"a":')).toBeNull();
  });
});

describe('Nexo.parsear con la muestra real', () => {
  const r = Nexo.parsear(fixture, ctx);
  const por = (id: string): Aviso => r.find((a: Aviso) => a.id_fuente === id);

  it('devuelve un aviso por proyecto, todos marcados como proyecto, con el esquema completo', () => {
    expect(r).toHaveLength(3);
    for (const a of r) {
      expect(Object.keys(a)).toEqual(E.COLUMNAS);
      expect(a).toMatchObject({ fuente: 'nexo', es_proyecto: true, operacion: 'venta', precio_m2: null });
    }
  });

  it('departamentos: precio «desde» en soles, rangos de área, dormitorios y baños, distrito y coordenadas', () => {
    expect(por('3197')).toMatchObject({
      url: 'https://nexoinmobiliario.pe/proyecto/3197-luzzo-cerro-colorado',
      titulo: 'LUZZO Cerro Colorado',
      tipo_inmueble: 'departamento',
      tipo_portal: 'Departamentos',
      precio: 343000,
      precio_max: 587000,
      moneda: 'PEN',
      precio_alterno: null,
      area_total_m2: 62.48,
      area_total_max_m2: 133.75,
      dormitorios: 2,
      dormitorios_max: 3,
      banos: 2,
      banos_max: 3,
      estacionamientos: null,
      distrito: 'CERRO COLORADO',
      direccion: 'JCHV+VCJ, Arequipa 04017',
      lat: -16.3702875,
      lon: -71.5564844,
      fecha_publicacion: '2023-10-24',
    });
  });

  it('el alias del distrito se resuelve igual que en el resto del proyecto', () => {
    expect(por('3630').distrito).toBe('JOSE LUIS BUSTAMANTE Y RIVERO');
    expect(por('3630')).toMatchObject({ dormitorios: 2, dormitorios_max: 2, precio: 369000, precio_max: 369000 });
  });

  it('lotes con precio en dólares: la moneda es la del portal, el equivalente en soles va aparte y no se mezcla el máximo', () => {
    expect(por('1353')).toMatchObject({
      tipo_inmueble: 'terreno',
      precio: 23694.75,
      moneda: 'USD',
      precio_alterno: 81059.73975,
      moneda_alterna: 'PEN',
      precio_max: null,
      area_total_m2: 302.83,
      area_total_max_m2: 500.09,
      dormitorios: null,
      banos: null,
      distrito: 'LA JOYA',
    });
  });

  it('no deja datos de contacto del anunciante', () => {
    const texto = JSON.stringify(r);
    expect(texto).not.toMatch(/REDACTADO|contact|whatsapp|@|builder/i);
  });
});

describe('Nexo.parsear: casos límite', () => {
  const pagina = (proyectos: unknown[]) => `<script>const projects = ${JSON.stringify(proyectos)};\n</script>`;
  const base = { project_id: '9', url: 'https://nexoinmobiliario.pe/proyecto/9-x', name: 'X', category: 'Casas', dpto_project: 'Arequipa', distrito: 'Cayma', coin: 'S/.', min_price: '500000' };

  it('lo que el portal no publica queda en null', () => {
    const [a] = Nexo.parsear(pagina([base]), ctx);
    expect(a).toMatchObject({ tipo_inmueble: 'casa', precio: 500000, moneda: 'PEN', area_total_m2: null, dormitorios: null, lat: null, lon: null, fecha_publicacion: null, direccion: null });
  });

  it('descarta los proyectos de otros departamentos', () => {
    const lima = { ...base, project_id: '10', dpto_project: 'Lima' };
    expect(Nexo.parsear(pagina([base, lima]), ctx).map((a: Aviso) => a.id_fuente)).toEqual(['9']);
  });

  it('un estacionamiento «0» no se toma como dato (el portal lo trae en 0 aunque no lo publique)', () => {
    const [a] = Nexo.parsear(pagina([{ ...base, parking_min: '0', parking_max: '0' }]), ctx);
    expect(a.estacionamientos).toBeNull();
    const [b] = Nexo.parsear(pagina([{ ...base, parking_min: '1', parking_max: '2' }]), ctx);
    expect(b.estacionamientos).toBe(1);
  });

  it('sin la variable projects devuelve una lista vacía', () => {
    expect(Nexo.parsear('<html></html>', ctx)).toEqual([]);
  });
});

describe('Nexo.buscar', () => {
  const URL = 'https://nexoinmobiliario.pe/venta-de-inmuebles/arequipa';
  const cliente = (respuesta: Record<string, unknown>) => {
    const pedidas: string[] = [];
    return { pedidas, obtener: async (url: string) => (pedidas.push(url), respuesta) };
  };

  it('pide una sola página (la lista de Arequipa) y devuelve los proyectos', async () => {
    const c = cliente({ estado: 'ok', texto: fixture });
    const r = await Nexo.buscar({ tipo: 'todos', distrito: null }, { cliente: c, paginas: 3, ...ctx });
    expect(c.pedidas).toEqual([URL]);
    expect(r).toMatchObject({ estado: 'ok', paginas: 1 });
    expect(r.avisos).toHaveLength(3);
  });

  it('bloqueo y robots.txt se informan sin avisos', async () => {
    const b = await Nexo.buscar({ tipo: 'todos' }, { cliente: cliente({ estado: 'bloqueado', motivo: 'HTTP 403' }), paginas: 1, ...ctx });
    expect(b).toMatchObject({ estado: 'bloqueado', avisos: [] });
    expect(b.mensaje).toMatch(/403/);
    const r = await Nexo.buscar({ tipo: 'todos' }, { cliente: cliente({ estado: 'robots', motivo: 'robots.txt no permite' }), paginas: 1, ...ctx });
    expect(r).toMatchObject({ estado: 'robots', avisos: [] });
  });

  it('un cambio de formato es error y no inventa avisos', async () => {
    const r = await Nexo.buscar({ tipo: 'todos' }, { cliente: cliente({ estado: 'ok', texto: '<html>nuevo diseño</html>' }), paginas: 1, ...ctx });
    expect(r.estado).toBe('error');
    expect(r.mensaje).toMatch(/formato/i);
    expect(r.avisos).toEqual([]);
  });

  it('avisa si la lista llega al tamaño de página (puede haber más y su paginado no está verificado)', async () => {
    const muchos = Array.from({ length: 24 }, (_, i) => ({ project_id: String(i), url: `https://nexoinmobiliario.pe/proyecto/${i}`, name: 'P', category: 'Casas', dpto_project: 'Arequipa', distrito: 'Cayma', coin: 'S/.', min_price: '1' }));
    const c = cliente({ estado: 'ok', texto: `<script>const projects = ${JSON.stringify(muchos)};\n</script>` });
    const r = await Nexo.buscar({ tipo: 'todos' }, { cliente: c, paginas: 3, ...ctx });
    expect(r.mensaje).toMatch(/paginado/);
  });
});
