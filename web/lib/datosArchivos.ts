import fs from 'node:fs';
import path from 'node:path';

/** Carpeta con los archivos de datos: web/public/data (copia de ../public/data hecha al compilar) o, en el repositorio, ../public/data. */
function carpeta(): string {
  for (const c of [path.join(process.cwd(), 'public', 'data'), path.join(process.cwd(), '..', 'public', 'data')]) if (fs.existsSync(c)) return c;
  throw new Error('No encuentro la carpeta de datos (public/data).');
}

/** Un `fetch` que responde las URL «data/…» del núcleo leyendo los archivos locales. */
export const fetchArchivos = async (url: string) => {
  const ruta = path.join(carpeta(), String(url).replace(/^.*?data\//, ''));
  if (!fs.existsSync(ruta)) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(ruta, 'utf8')) };
};
