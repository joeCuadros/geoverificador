import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBase, type Base } from '../src/cliente.ts';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DATOS = path.join(RAIZ, 'apps', 'estatica', 'public', 'data');

/** La base que armó preparar-base.ts. Cada archivo de pruebas la abre y la cierra. */
export function baseDePrueba(): Promise<Base> {
  if (!process.env.BASE_DE_PRUEBA) throw new Error('Falta BASE_DE_PRUEBA: corra las pruebas con `pnpm test:nuevo`.');
  return abrirBase(process.env.BASE_DE_PRUEBA);
}

export const leerDato = (ruta: string): any => JSON.parse(fs.readFileSync(path.join(DATOS, ruta), 'utf8'));

/** El `fetch` de la aplicación actual: lee los archivos completos de apps/estatica/public/data. */
export const fetchArchivos = async (url: string) => {
  const ruta = path.join(DATOS, String(url).replace(/^.*?data\//, ''));
  if (!fs.existsSync(ruta)) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(ruta, 'utf8')) };
};

/** Los cuatro puntos de la revisión en el navegador de docs/AUDITORIA-DATOS.md. */
export const PUNTOS_AUDITORIA = [
  { nombre: 'Plaza de Armas', lat: -16.39883, lon: -71.53697 },
  { nombre: 'Cerro Colorado (tierra agrícola)', lat: -16.3715, lon: -71.578 },
  { nombre: 'Yura', lat: -16.2447, lon: -71.6727 },
  { nombre: 'Parque Industrial', lat: -16.4179, lon: -71.5497 },
];

/** Una rejilla fija de puntos sobre la ciudad, para no depender solo de cuatro. */
export function rejilla(n = 6): { nombre: string; lat: number; lon: number }[] {
  const out = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push({ nombre: `rejilla ${i},${j}`, lat: -16.48 + (i * 0.16) / (n - 1), lon: -71.62 + (j * 0.16) / (n - 1) });
  return out;
}
