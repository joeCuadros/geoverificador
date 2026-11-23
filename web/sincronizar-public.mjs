// Copia ../public (la aplicación de mapa y paneles que ya existe) a web/public para que Next la sirva tal cual. No se versiona la copia.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const aqui = path.dirname(fileURLToPath(import.meta.url));
const destino = path.join(aqui, 'public');
fs.rmSync(destino, { recursive: true, force: true });
fs.cpSync(path.join(aqui, '..', 'public'), destino, { recursive: true });
console.log('public/ copiado a web/public');
