/**
 * Censo 2017 por manzana (INEI, REDATAM): la lógica pura detrás de scripts/descargar-censo-servicios.mjs. Parámetros de la consulta a la lista de áreas,
 * lectura de la tabla HTML, la llave que une REDATAM con el polígono de la manzana y el armado de los registros. Sin red.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Censo = require('../scripts/lib/censo.js');

const td = (v: string, c = 'c1') => `<td class="${c}">${v}</td>`;
const fila = (celdas: string[]) => `<tr>${celdas.map((v) => td(v)).join('')}</tr>`;
/** Una tabla como la de REDATAM: título, área, cabecera, filas por manzana, total y pie. */
const tabla = (cabecera: string[], filas: string[][], total: string[]) => `<html><body><table>
<tr><td class="c0" colspan="5">T&iacute;tulo</td></tr><tr><td class="c1" colspan="5">Lista por &Aacute;reas de : V: algo</td></tr>
<tr><td class="c0" colspan="5">&Aacute;rea Geogr&aacute;fica</td></tr><tr><td class="c1" colspan="5">Arequipa, Arequipa, distrito: Cayma</td></tr>
${fila(['&nbsp;', 'C&oacute;digo', 'Manzana', ...cabecera, '&nbsp;'])}
${filas.map((f) => fila(['&nbsp;', ...f, '&nbsp;'])).join('\n')}
${fila(['&nbsp;', 'TOTAL', '&nbsp;', ...total, '&nbsp;'])}
${fila(['Fuente: Censos Nacionales de Poblaci&oacute;n y Vivienda 2017 (Informaci&oacute;n solo de &aacute;rea urbana)'])}
</table></body></html>`;

const CAB_SERV = [
  'Si tiene alumbrado el&eacute;ctrico', 'No tiene alumbrado el&eacute;ctrico',
  'Red p&uacute;blica dentro de la vivienda', 'Red p&uacute;blica fuera de la vivienda, pero dentro de la edificaci&oacute;n', 'Pil&oacute;n o pileta de uso p&uacute;blico', 'Otro',
  'Red p&uacute;blica de desag&uuml;e dentro de la vivienda', 'Red p&uacute;blica de desag&uuml;e fuera de la vivienda, pero dentro de la edificaci&oacute;n', 'Pozo ciego o negro', 'Otro',
];
const SERV = tabla(CAB_SERV, [
  ['04010300010010000200', '040103000100100002 , Arequipa,Arequipa,Cayma,Centro Poblado: X,Mza: 002', '59', '1', '50', '5', '3', '2', '45', '8', '5', '2'],
  ['04010300010010000300', '040103000100100003 , Arequipa,Arequipa,Cayma,Centro Poblado: X,Mza: 003', '30', '0', '25', '0', '5', '0', '20', '0', '10', '0'],
  ['04010300010010001506', '040103000100100015 , Arequipa,Arequipa,Cayma,Centro Poblado: X,Mza: 015F', '10', '0', '10', '0', '0', '0', '10', '0', '0', '0'],
  ['04010300010010088888', '040103000100100888 , Arequipa,Arequipa,Cayma,Centro Poblado: X,Mza: 8888', '4', '2', '0', '0', '0', '6', '0', '0', '0', '6'],
], ['103', '3', '85', '5', '8', '8', '75', '8', '15', '4']);
const CONT = tabla(['Vivienda', 'Hogar', 'Poblaci&oacute;n'], [
  ['04010300010010000200', 'x', '62', '64', '229'],
  ['04010300010010000300', 'x', '36', '32', '140'],
  ['04010300010010001506', 'x', '11', '11', '40'],
  ['04010300010010088888', 'x', '7', '7', '19'],
], ['116', '114', '428']);

describe('Censo.parametrosAreaList', () => {
  it('pide la lista por manzana del distrito, con las preguntas elegidas y solo viviendas ocupadas con personas presentes', () => {
    const p = Censo.parametrosAreaList({ item: 'AREAVIV', variables: ['Vivienda.C2P11', 'Vivienda.C2P6'], seleccion: 'sels\\Distrito_040103.sel', filtro: 'Vivienda.C2P2=1' });
    expect(p.get('BASE')).toBe('CPV2017');
    expect(p.get('ITEM')).toBe('AREAVIV');
    expect(p.getAll('VARIABLE')).toEqual(['Vivienda.C2P11', 'Vivienda.C2P6']);
    expect(p.get('OUTPUT')).toBe('Manzana');
    expect(p.get('SELECTION')).toBe('sels\\Distrito_040103.sel');
    expect(p.get('FORMAT')).toBe('HTML');
    expect(p.get('FILTER')).toBe('Vivienda.C2P2=1');
  });
  it('la selección de un distrito de la provincia de Arequipa sale del ubigeo', () => {
    expect(Censo.seleccionDeDistrito('040103')).toBe('sels\\Distrito_040103.sel');
    expect(() => Censo.seleccionDeDistrito('40103')).toThrow();
  });
});

describe('Censo.leerTabla', () => {
  it('lee el título, la cabecera, las filas por código y el total, con números sin separador de miles', () => {
    const t = Censo.leerTabla(SERV);
    expect(t.area).toMatch(/Cayma/);
    expect(t.cabecera).toHaveLength(10);
    expect(t.cabecera[0]).toBe('Si tiene alumbrado eléctrico');
    expect(t.filas).toHaveLength(4);
    expect(t.filas[0]).toMatchObject({ codigo: '04010300010010000200' });
    expect(t.filas[0].valores).toEqual([59, 1, 50, 5, 3, 2, 45, 8, 5, 2]);
    expect(t.total).toEqual([103, 3, 85, 5, 8, 8, 75, 8, 15, 4]);
  });
  it('entiende los miles con espacio y rechaza una tabla sin filas', () => {
    expect(Censo.numero('23 866')).toBe(23866);
    expect(Censo.numero('  59')).toBe(59);
    expect(() => Censo.leerTabla('<html><body>Error</body></html>')).toThrow(/tabla/i);
  });
});

describe('Censo.claveManzana: de REDATAM al polígono del INEI', () => {
  it('ubigeo + zona (5) + manzana (3) y la letra del sufijo (01 = A, 06 = F, 10 = J…)', () => {
    expect(Censo.claveManzana('04012900010010000200')).toBe('04012900100002');
    expect(Censo.claveManzana('04010300010010001506')).toBe('04010300100015F');
    expect(Censo.claveManzana('04012900010030003710')).toBe('04012900300037J');
  });
  it('las viviendas fuera de manzana (8888) no tienen polígono', () => {
    expect(Censo.claveManzana('04010300010010088888')).toBeNull();
  });
});

describe('Censo.construirRegistros', () => {
  const r = Censo.construirRegistros(Censo.leerTabla(SERV), Censo.leerTabla(CONT));
  it('une servicios y conteos por la llave de la manzana, con los campos que usa la aplicación', () => {
    expect(r.registros.get('04010300100002')).toEqual({ id: '04010300100002', viv: 62, hog: 64, pers: 229, ocup: 60, luz: 59, ad: 50, af: 5, sd: 45, sf: 8 });
    expect(r.registros.get('04010300100015F')).toMatchObject({ viv: 11, pers: 40, ocup: 10, luz: 10, ad: 10, af: 0, sd: 10, sf: 0 });
    expect(r.registros.size).toBe(3);
  });
  it('cuenta aparte lo que no se pudo unir (fuera de manzana) y no lo mezcla', () => {
    expect(r.sinManzana).toEqual({ filas: 1, viviendas: 7, personas: 19 });
  });
  it('la cabecera debe traer cada columna exactamente una vez; si cambió, falla en vez de adivinar', () => {
    const rota = Censo.leerTabla(SERV);
    rota.cabecera[0] = 'Otra cosa';
    expect(() => Censo.construirRegistros(rota, Censo.leerTabla(CONT))).toThrow(/alumbrado/);
  });
  it('avisa si los ocupados que dice el alumbrado no coinciden con la suma de las categorías de agua', () => {
    expect(r.incoherentes).toBe(0);
    const t = Censo.leerTabla(SERV);
    t.filas[0].valores[2] = 49; // agua dentro: 49 + 5 + 3 + 2 = 59 ≠ 60
    expect(Censo.construirRegistros(t, Censo.leerTabla(CONT)).incoherentes).toBe(1);
  });
});
