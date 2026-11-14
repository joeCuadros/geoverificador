/**
 * recolector.js — Flujo de la recolección de SmartBus (sin red propia: cliente HTTP y caché se inyectan). Lo prueba
 * test/smartbus-recolector.spec.ts.
 *
 * Reglas que conserva del script anterior:
 *  - robots.txt se vuelve a leer en cada corrida (siempre, aunque la caché esté llena) y si deja de permitir la ruta se para.
 *  - Una solicitud a la vez; la espera entre solicitudes la impone el cliente (scripts/lib/avisos/http.js).
 *  - Ante 401/403/407/429, una redirección o una página de verificación anti-bot el cliente devuelve «bloqueado» y aquí se
 *    LANZA `Detenido`: se para sin insistir, sin resultado parcial y sin intentar saltar nada.
 *  - Las respuestas crudas (ya validadas) se guardan en la caché; con ella llena no se toca la red. `refrescar` la ignora.
 *  - Todo se valida antes de devolver el resultado; si algo falla se lanza un error y quien llama NO escribe nada.
 */
const S = require('./smartbus.js');

class ErrorSmartbus extends Error {}
class Detenido extends ErrorSmartbus {}

/** Texto de la respuesta (de la caché o de la red) ya parseado y validado. */
async function leerJson({ nombre, url, validar, cliente, cache, refrescar }) {
  const guardado = refrescar ? null : cache.leer(nombre);
  let texto = guardado;
  if (texto === null) {
    const r = await cliente.obtener(url);
    if (r.estado === 'bloqueado' || r.estado === 'robots') throw new Detenido(`${url}: ${r.motivo}. Me detengo sin insistir ni intentar saltarlo.`);
    if (r.estado !== 'ok') throw new ErrorSmartbus(`${url}: ${r.motivo || 'fallo al pedirla'}`);
    texto = r.texto;
  }
  let json;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new ErrorSmartbus(`${url}: la respuesta no es JSON válido.`);
  }
  try {
    validar(json);
  } catch (err) {
    throw new ErrorSmartbus(err.message);
  }
  if (guardado === null) cache.guardar(nombre, texto);
  return json;
}

/**
 * Descarga (o lee de la caché) la lista y los detalles de las rutas pedidas y devuelve el resultado validado:
 * { rutas, paradas, metadata }. Lanza `Detenido` o `ErrorSmartbus`; en ambos casos no hay resultado parcial.
 * Opciones: { cliente, linea = 'todas', maxRutas = null, cache: { leer(nombre) → texto|null, guardar(nombre, texto) },
 *             refrescar = false, ahora, userAgent, log }.
 */
async function recolectarSmartbus({ cliente, linea = 'todas', maxRutas = null, cache, refrescar = false, ahora = new Date(), userAgent, log = () => {} }) {
  const robots = await cliente.permitido(S.URL_LISTA);
  if (robots.estado === 'bloqueado' || robots.estado === 'robots') throw new Detenido(`${robots.motivo}. Me detengo.`);
  if (robots.estado !== 'ok') throw new ErrorSmartbus(robots.motivo || 'No se pudo comprobar robots.txt de smartbus.app.');

  const json = await leerJson({ nombre: 'routes.json', url: S.URL_LISTA, validar: S.validarLista, cliente, cache, refrescar });
  const lista = json.data;
  const completa = String(linea).toLowerCase() === 'todas' && !maxRutas;
  try {
    S.validarCompletitud(lista, { completa });
  } catch (err) {
    throw new ErrorSmartbus(err.message);
  }
  let seleccion;
  try {
    seleccion = S.seleccionarRutas(lista, { linea, maxRutas });
  } catch (err) {
    throw new ErrorSmartbus(err.message);
  }
  log(`Lista: ${lista.length} rutas; se descargan ${seleccion.length}.`);

  const detalles = new Map();
  let n = 0;
  for (const r of seleccion) {
    const id = String(r.id).replace(/[^A-Za-z0-9_.-]/g, '_');
    const d = await leerJson({ nombre: `ruta-${id}.json`, url: S.urlDetalle(r.id), validar: (j) => S.validarDetalle(j, r.id), cliente, cache, refrescar });
    detalles.set(r.id, d.data);
    if (++n % 25 === 0) log(`  ${n}/${seleccion.length} detalles`);
  }

  const { rutas, paradas, problemas } = S.construir(seleccion, detalles);
  if (problemas.length) {
    throw new ErrorSmartbus(`La validación falló, no se escribe nada:\n - ${problemas.slice(0, 20).join('\n - ')}${problemas.length > 20 ? `\n … y ${problemas.length - 20} más` : ''}`);
  }
  if (rutas.length !== seleccion.length) throw new ErrorSmartbus('Alguna ruta quedó sin geometría.');

  const conteos = S.contar(rutas, paradas);
  const lineas = [...new Set(rutas.map((f) => f.properties.linea))].sort((a, b) => (Number(a.slice(1)) || 99) - (Number(b.slice(1)) || 99) || a.localeCompare(b));
  const metadata = S.crearMetadata({ ahora, filtros: { linea, maxRutas }, conteos, lineas, userAgent });
  return { rutas, paradas, metadata };
}

module.exports = { ErrorSmartbus, Detenido, recolectarSmartbus };
