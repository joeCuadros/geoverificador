/**
 * salida.js — Dónde y cómo se escribe lo de SmartBus (sin red). Lo prueba test/smartbus-recolector.spec.ts.
 *
 * Regla dura: por defecto solo se escribe bajo datos-crudos/smartbus/ (ignorada por git) y se rechaza cualquier ruta dentro de
 * public/, dist/ o api/ de la raíz del proyecto, porque esas carpetas se publican o se despliegan y estos datos no tienen
 * licencia para redistribuirse.
 */
const fs = require('fs');
const path = require('path');

const CARPETAS_PROHIBIDAS = ['public', 'dist', 'api'];

const dentroDe = (hijo, padre) => {
  const rel = path.relative(padre, hijo);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Ruta del archivo de salida; lanza un error si cae dentro de public/, dist/ o api/. */
function rutaSalida({ salida, formato, raiz }) {
  const ruta = salida ? path.resolve(salida) : path.join(raiz, 'datos-crudos', 'smartbus', `smartbus-aqp.${formato}`);
  for (const carpeta of CARPETAS_PROHIBIDAS) {
    if (dentroDe(ruta, path.join(raiz, carpeta))) {
      throw new Error(`No se escribe dentro de ${carpeta}/ (${ruta}): los datos de SmartBus no tienen licencia para redistribuirse y esa carpeta se publica o se despliega. Use datos-crudos/smartbus/.`);
    }
  }
  return ruta;
}

const carpetaCache = (raiz) => path.join(raiz, 'datos-crudos', 'smartbus', 'cache');

/** Escribe en un temporal y lo renombra: un fallo a medias nunca deja un archivo roto ni pisa uno bueno. */
async function escribirAtomico(ruta, contenido) {
  await fs.promises.mkdir(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp-${process.pid}`;
  try {
    await fs.promises.writeFile(tmp, contenido, 'utf8');
    await fs.promises.rename(tmp, ruta);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true });
    throw err;
  }
}

/** Caché de respuestas crudas en una carpeta. Los nombres no pueden salir de ella. */
function crearCacheDisco(carpeta) {
  const ruta = (nombre) => {
    if (!/^[A-Za-z0-9_.-]+$/.test(nombre) || nombre.includes('..')) throw new Error(`Nombre de caché no válido: ${nombre}`);
    return path.join(carpeta, nombre);
  };
  return {
    leer(nombre) {
      try {
        return fs.readFileSync(ruta(nombre), 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
    guardar(nombre, texto) {
      const destino = ruta(nombre);
      fs.mkdirSync(carpeta, { recursive: true });
      fs.writeFileSync(destino, texto, 'utf8');
    },
  };
}

module.exports = { CARPETAS_PROHIBIDAS, rutaSalida, carpetaCache, escribirAtomico, crearCacheDisco };
