/**
 * Pruebas de public/js/verificaciones.js: la lista estática de verificaciones antes de comprar. Se revisa que cubra los
 * trámites pedidos, que cada elemento tenga la forma esperada y que solo haya enlaces https (comprobados a mano).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Verificaciones = require('../public/js/verificaciones.js');

const todo = () => JSON.stringify(Verificaciones.ITEMS).toLowerCase();

describe('Verificaciones.ITEMS', () => {
  it('tiene una forma válida', () => {
    expect(Verificaciones.validar(Verificaciones.ITEMS)).toEqual([]);
  });

  it('cubre los trámites y consultas recomendados', () => {
    const t = todo();
    ['zonificación y vías', 'parámetros urbanísticos', 'copia literal', 'cargas y gravámenes', 'alerta registral', 'saneamiento físico-legal',
      'licencia de edificación', 'conformidad de obra', 'sedapar', 'seal', 'sigrid'].forEach((frase) => expect(t).toContain(frase));
    expect(Verificaciones.ITEMS.length).toBeGreaterThanOrEqual(7);
  });

  it('solo enlaza a sitios comprobados; SEDAPAR queda como texto', () => {
    const urls = Verificaciones.ITEMS.flatMap((i: any) => i.enlaces.map((e: any) => e.url));
    urls.forEach((u: string) => expect(u).toMatch(/^https:\/\//));
    // Todas respondieron HTTP 200 al comprobarlas (ver el encabezado de verificaciones.js).
    const permitidas = [
      'https://www.muniarequipa.gob.pe/', 'https://www.seal.com.pe/', 'https://sigrid.cenepred.gob.pe/sigridv3/', 'https://www.gob.pe/cofopri',
      'https://sprl.sunarp.gob.pe/', 'https://visor-bgr.sunarp.gob.pe/', 'https://alertaregistral.sunarp.gob.pe/alerta/Inicio', 'https://sigueloplus.sunarp.gob.pe/siguelo/',
      'https://www.gob.pe/institucion/sunarp/noticias/1032824-sunarp-evite-ser-sorprendido-conozca-los-pasos-a-seguir-antes-de-comprar-una-casa-o-departamento',
    ];
    urls.forEach((u: string) => expect(permitidas).toContain(u));
    expect(urls.join(' ')).not.toContain('sedapar');
  });

  it('no cita precios de trámites (cambian y se consultan en cada entidad)', () => {
    expect(todo()).not.toMatch(/\bs\/\s?\d|soles|precio/);
  });

  it('separa lo que la herramienta calculó de lo que la persona debe comprobar', () => {
    expect(Verificaciones.CALCULADO.length).toBeGreaterThan(0);
    const calc = JSON.stringify(Verificaciones.CALCULADO).toLowerCase();
    expect(calc).toContain('referencial');
    expect(calc).toContain('línea recta');
    const titulosItems = Verificaciones.ITEMS.map((i: any) => i.titulo);
    Verificaciones.CALCULADO.forEach((c: any) => expect(titulosItems).not.toContain(c.titulo));
  });

  it('aclara que no es asesoría legal', () => {
    expect(Verificaciones.AVISO.toLowerCase()).toContain('no es asesoría legal');
  });
});

describe('Verificaciones.validar', () => {
  const ok = { id: 'a', titulo: 'T', entidad: 'E', queConfirma: 'Q', enlaces: [] };

  it('acepta un elemento mínimo', () => {
    expect(Verificaciones.validar([ok])).toEqual([]);
  });

  it('detecta ids repetidos o inválidos', () => {
    expect(Verificaciones.validar([ok, ok])[0]).toContain('id repetido');
    expect(Verificaciones.validar([{ ...ok, id: 'Con Espacio' }])[0]).toContain('id inválido');
  });

  it('detecta campos vacíos o enlaces que no son https', () => {
    expect(Verificaciones.validar([{ ...ok, titulo: ' ' }])[0]).toContain('falta titulo');
    expect(Verificaciones.validar([{ ...ok, enlaces: [{ texto: 'x', url: 'http://sitio.pe' }] }])[0]).toContain('enlace inválido');
    expect(Verificaciones.validar([{ ...ok, enlaces: undefined }])[0]).toContain('enlaces debe ser una lista');
    expect(Verificaciones.validar([{ ...ok, nota: '' }])[0]).toContain('nota vacía');
  });
});
