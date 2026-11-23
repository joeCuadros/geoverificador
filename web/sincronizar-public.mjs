// Copia ../public/data (los datos) a web/public/data para que Next los sirva. No se versiona la copia.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const aqui = path.dirname(fileURLToPath(import.meta.url));
const destino = path.join(aqui, 'public');
fs.rmSync(destino, { recursive: true, force: true });
fs.cpSync(path.join(aqui, '..', 'public', 'data'), path.join(destino, 'data'), { recursive: true });
console.log('public/data copiado a web/public/data');
