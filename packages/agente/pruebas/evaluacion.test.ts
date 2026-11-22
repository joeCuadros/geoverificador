/**
 * Evaluación del intérprete (tarea 6.6): una lista de frases reales con lo que debe entenderse y lo que debe preguntarse. Corre en CI;
 * si un cambio empeora la comprensión, falla. Los criterios esperados son un subconjunto: pueden aparecer más.
 */
import { describe, expect, it } from 'vitest';
import { interpretar, loQueFalta, type Consulta } from '../src/consulta.ts';

interface Caso { frase: string; intencion?: Consulta['intencion']; tipo?: Consulta['tipo']; precioMax?: number; moneda?: Consulta['moneda']; distrito?: string; criterios?: string[]; falta?: string | null; dormitoriosMin?: number }
const DISTRITOS = ['CAYMA', 'YANAHUARA', 'CERRO COLORADO', 'AREQUIPA', 'PAUCARPATA', 'MIRAFLORES', 'SACHACA', 'JOSE LUIS BUSTAMANTE Y RIVERO', 'SOCABAYA', 'HUNTER'];

const CASOS: Caso[] = [
  { frase: 'Quiero un departamento cerca de mi trabajo, cerca de un mall, con agua y luz, cerca de un colegio y de una universidad, y que no cueste más de medio millón', tipo: 'departamento', precioMax: 500000, criterios: ['trabajo', 'mall', 'agua', 'luz', 'colegio', 'universidad'], falta: 'trabajo' },
  { frase: 'busco casa en Cayma hasta 350 mil soles', tipo: 'casa', distrito: 'CAYMA', precioMax: 350000, moneda: 'PEN', falta: null },
  { frase: 'un departamento en Yanahuara de máximo 120 mil dólares', tipo: 'departamento', distrito: 'YANAHUARA', precioMax: 120000, moneda: 'USD', falta: null },
  { frase: 'departamento de 3 dormitorios en Cerro Colorado', tipo: 'departamento', distrito: 'CERRO COLORADO', dormitoriosMin: 3, falta: null },
  { frase: 'terreno en Sachaca', tipo: 'terreno', distrito: 'SACHACA', falta: null },
  { frase: 'quiero un local comercial en Arequipa', tipo: 'local', falta: null },
  { frase: 'busco una oficina cerca de un banco', tipo: 'oficina' },
  { frase: 'departamento cerca de un colegio', tipo: 'departamento', criterios: ['colegio'], falta: null },
  { frase: 'casa cerca de un hospital o posta', tipo: 'casa', criterios: ['salud'] },
  { frase: 'departamento con agua y desagüe', tipo: 'departamento', criterios: ['agua', 'desague'] },
  { frase: 'departamento con luz eléctrica', tipo: 'departamento', criterios: ['luz'] },
  { frase: 'casa cerca de la universidad', tipo: 'casa', criterios: ['universidad'], falta: null },
  { frase: 'departamento cerca de un paradero', tipo: 'departamento', criterios: ['paradero'] },
  { frase: 'departamento cerca de un mercado', tipo: 'departamento', criterios: ['mercado'] },
  { frase: 'departamento lejos de quebradas', tipo: 'departamento', criterios: ['lejos_de_cauce'] },
  { frase: 'casa hasta 450,000 soles', tipo: 'casa', precioMax: 450000, moneda: 'PEN', falta: null },
  { frase: 'casa hasta 450 000 soles', tipo: 'casa', precioMax: 450000, moneda: 'PEN', falta: null },
  { frase: 'casa que cueste menos de 300 mil', tipo: 'casa', precioMax: 300000, falta: 'moneda' },
  { frase: 'departamento por no más de US$ 90000', tipo: 'departamento', precioMax: 90000, moneda: 'USD', falta: null },
  { frase: 'departamento de 1.5 millones de soles', tipo: 'departamento', precioMax: 1500000, moneda: 'PEN', falta: null },
  { frase: 'hola', intencion: 'saludo' },
  { frase: 'buenas tardes', intencion: 'saludo' },
  { frase: '¿de dónde sale el dato de agua?', intencion: 'fuente' },
  { frase: '¿de qué fecha son los colegios?', intencion: 'fuente' },
  { frase: 'dónde puedo vivir cerca de salud y transporte', intencion: 'buscar_zonas' },
  { frase: 'qué zonas tienen colegio y área verde', intencion: 'buscar_zonas' },
  { frase: 'casa en Paucarpata cerca de un colegio hasta 280 mil soles', tipo: 'casa', distrito: 'PAUCARPATA', precioMax: 280000, moneda: 'PEN', criterios: ['colegio'], falta: null },
  { frase: 'departamento en Miraflores con agua y luz', tipo: 'departamento', distrito: 'MIRAFLORES', criterios: ['agua', 'luz'], falta: null },
  { frase: 'departamento en Hunter, cerca de un colegio', tipo: 'departamento', distrito: 'HUNTER', criterios: ['colegio'], falta: null },
  { frase: 'departamento cerca de mi trabajo en el Parque Industrial', tipo: 'departamento', criterios: ['trabajo'], falta: null },
  { frase: 'casa cerca de mi trabajo', tipo: 'casa', criterios: ['trabajo'], falta: 'trabajo' },
  { frase: 'departamento a menos de 800 m de un colegio', tipo: 'departamento', criterios: ['colegio'], falta: null },
  { frase: 'departamento a 2 km de un mall', tipo: 'departamento', criterios: ['mall'], falta: null },
  { frase: 'departamento en zona comercial', tipo: 'departamento', criterios: ['zona_comercio'], falta: null },
  { frase: 'departamento sin trasbordo hasta mi trabajo en la UNSA', tipo: 'departamento', criterios: ['trabajo'], falta: null },
  { frase: 'casa de 4 dormitorios en Socabaya', tipo: 'casa', distrito: 'SOCABAYA', dormitoriosMin: 4, falta: null },
  { frase: 'oficina en Cayma hasta 200 mil soles', tipo: 'oficina', distrito: 'CAYMA', precioMax: 200000, moneda: 'PEN', falta: null },
  { frase: 'terreno de 200 m2 en Cerro Colorado', tipo: 'terreno', distrito: 'CERRO COLORADO', falta: null },
  { frase: 'departamento nuevo con ascensor', tipo: 'departamento', falta: null },
  { frase: 'quiero un departamento', tipo: 'departamento', falta: null },
  { frase: 'quiero comprar una casa en Yanahuara con agua', tipo: 'casa', distrito: 'YANAHUARA', criterios: ['agua'], falta: null },
  { frase: 'busco departamento en Cayma cerca de universidad y mall', tipo: 'departamento', distrito: 'CAYMA', criterios: ['universidad', 'mall'], falta: null },
];

describe('evaluación del intérprete', () => {
  it('tiene al menos 40 casos', () => expect(CASOS.length).toBeGreaterThanOrEqual(40));
  for (const k of CASOS) {
    it(k.frase, () => {
      const c = interpretar(k.frase, { distritos: DISTRITOS });
      const malos: string[] = [];
      if (k.intencion && c.intencion !== k.intencion) malos.push(`intención ${c.intencion}`);
      if (k.tipo !== undefined && c.tipo !== k.tipo) malos.push(`tipo ${c.tipo}`);
      if (k.precioMax !== undefined && c.precioMax !== k.precioMax) malos.push(`precio ${c.precioMax}`);
      if (k.moneda !== undefined && c.moneda !== k.moneda) malos.push(`moneda ${c.moneda}`);
      if (k.distrito !== undefined && c.distrito !== k.distrito) malos.push(`distrito ${c.distrito}`);
      if (k.dormitoriosMin !== undefined && c.dormitoriosMin !== k.dormitoriosMin) malos.push(`dormitorios ${c.dormitoriosMin}`);
      for (const id of k.criterios ?? []) if (!c.criterios.some((x) => x.id === id)) malos.push(`falta criterio ${id}`);
      if (k.falta !== undefined && (c.intencion === 'buscar_avisos' ? loQueFalta(c) : null) !== k.falta) malos.push(`pregunta ${loQueFalta(c)}`);
      expect(malos, malos.join('; ')).toEqual([]);
    });
  }
});
