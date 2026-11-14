/**
 * apify.js — Cliente mínimo de la API de Apify (apify.com, plataforma de pago) sobre fetch. Transporte OPCIONAL de
 * scripts/recolectar-avisos.mjs: solo se usa si la persona lo pide con `--transporte apify`. Nunca se activa solo ni como
 * respaldo de otro transporte, porque cada ejecución cuesta dinero. Lo prueba test/avisos-apify.spec.ts (sin red).
 *
 * Flujo asíncrono de la API oficial (https://docs.apify.com/api/v2):
 *   1. POST /v2/actors/{usuario}~{actor}/runs?maxTotalChargeUsd=<tope>&waitForFinish=60   (cuerpo: el input del actor)
 *   2. GET  /v2/actor-runs/{id}?waitForFinish=60   hasta SUCCEEDED (FAILED, TIMED-OUT y ABORTED son error)
 *   3. GET  /v2/datasets/{datasetId}/items?format=json&clean=1&limit=&offset=   paginado
 *
 * Seguridad: el token (variable de entorno APIFY_TOKEN) viaja SOLO en la cabecera `Authorization: Bearer`; nunca en una URL
 * y nunca se imprime ni se escribe: los mensajes de error pasan por un filtro que lo tacha. 401 = token inválido, 402 = sin
 * crédito (no se reintentan), 429 = se reintenta con espera creciente desde 500 ms (hasta 3 reintentos).
 * Si se agota el tiempo total de espera se intenta abortar la ejecución para que no siga gastando.
 */
const BASE = 'https://api.apify.com';
const ESPERA_SERVIDOR_SEG = 60;
const TIMEOUT_TOTAL_MS = 15 * 60 * 1000;
const REINTENTOS_429 = 3;
const ESPERA_429_MS = 500;
const PAGINA_DATASET = 1000;
const ESTADOS_EN_CURSO = new Set(['READY', 'RUNNING', 'ABORTING', 'TIMING-OUT']);

class ErrorApify extends Error {}

const dormirReal = (ms) => new Promise((r) => setTimeout(r, ms));

/** Token de APIFY_TOKEN (sin espacios) o null si falta. */
function leerToken(env = process.env) {
  const t = typeof env.APIFY_TOKEN === 'string' ? env.APIFY_TOKEN.trim() : '';
  return t || null;
}

/** «usuario/actor» o «usuario~actor» → «usuario~actor» (forma de la URL). Lanza ErrorApify si no tiene esa forma. */
function actorEnUrl(actor) {
  if (typeof actor !== 'string' || !/^[A-Za-z0-9_.-]+[~/][A-Za-z0-9_.-]+$/.test(actor.trim())) {
    throw new ErrorApify(`Identificador de actor no válido: «${actor}». Debe tener la forma usuario/actor (p. ej. apify/facebook-marketplace-scraper).`);
  }
  return actor.trim().replace('/', '~');
}

function crearClienteApify(opciones) {
  const { token, fetchFn = globalThis.fetch, dormir = dormirReal, ahora = Date.now, timeoutMs = TIMEOUT_TOTAL_MS } = opciones || {};
  if (!token) throw new ErrorApify('Falta el token de Apify: defina la variable de entorno APIFY_TOKEN.');

  const limpiar = (texto) => String(texto).split(token).join('***');
  const falla = (mensaje) => new ErrorApify(limpiar(mensaje));

  /** Una llamada a la API con reintentos de 429. Devuelve el JSON de la respuesta. */
  async function llamar(metodo, ruta, cuerpo) {
    const cabeceras = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    const init = { method: metodo, headers: cabeceras };
    if (cuerpo !== undefined) {
      cabeceras['Content-Type'] = 'application/json';
      init.body = JSON.stringify(cuerpo);
    }
    for (let intento = 0; ; intento++) {
      let res;
      try {
        res = await fetchFn(`${BASE}${ruta}`, init);
      } catch (err) {
        throw falla(`Fallo de red al llamar a Apify: ${err.message}`);
      }
      if (res.status === 429) {
        if (intento >= REINTENTOS_429) throw falla('Apify limitó las solicitudes (HTTP 429): se superó el límite de solicitudes tras varios reintentos. Espere unos minutos.');
        await dormir(ESPERA_429_MS * 2 ** intento);
        continue;
      }
      if (res.status === 401) throw falla('El token de Apify (APIFY_TOKEN) es inválido o fue revocado (HTTP 401).');
      if (res.status === 402) throw falla('Apify informa que no hay crédito suficiente en la cuenta (HTTP 402). Recargue el saldo o revise el plan.');
      if (!res.ok) throw falla(`Apify respondió HTTP ${res.status} en ${metodo} ${ruta.split('?')[0]}.`);
      try {
        return await res.json();
      } catch {
        throw falla('Respuesta inesperada de Apify: no es JSON.');
      }
    }
  }

  const datosDeRun = (json) => {
    const d = json && json.data;
    if (!d || typeof d.id !== 'string' || typeof d.status !== 'string') throw falla('Respuesta inesperada de Apify al consultar la ejecución (falta data.id o data.status).');
    return d;
  };

  /**
   * Inicia el actor y espera a que termine. `opciones.topeUsd` (obligatorio, > 0) es el máximo que Apify puede cobrar por esta
   * ejecución (maxTotalChargeUsd). → { runId, estado: 'SUCCEEDED', datasetId }.
   */
  async function ejecutarActor(actor, input, { topeUsd } = {}) {
    const ruta = actorEnUrl(actor);
    if (!(typeof topeUsd === 'number' && Number.isFinite(topeUsd) && topeUsd > 0)) throw falla('Falta el tope de gasto en USD (debe ser un número mayor que 0): no se inicia ninguna ejecución sin tope.');
    const inicio = ahora();
    const parametros = new URLSearchParams({ maxTotalChargeUsd: String(topeUsd), waitForFinish: String(ESPERA_SERVIDOR_SEG) });
    let run = datosDeRun(await llamar('POST', `/v2/actors/${ruta}/runs?${parametros}`, input));
    while (ESTADOS_EN_CURSO.has(run.status)) {
      if (ahora() - inicio >= timeoutMs) {
        await llamar('POST', `/v2/actor-runs/${encodeURIComponent(run.id)}/abort`).catch(() => undefined); // mejor esfuerzo
        throw falla(`Se superó el tiempo máximo de espera (${Math.round(timeoutMs / 1000)} s) por la ejecución ${run.id} de ${actor}; se intentó abortarla para no seguir gastando. Revise su estado en la consola de Apify.`);
      }
      run = datosDeRun(await llamar('GET', `/v2/actor-runs/${encodeURIComponent(run.id)}?waitForFinish=${ESPERA_SERVIDOR_SEG}`));
    }
    if (run.status === 'SUCCEEDED') return { runId: run.id, estado: run.status, datasetId: run.defaultDatasetId };
    const motivos = {
      FAILED: 'falló en Apify',
      'TIMED-OUT': 'superó el tiempo de ejecución permitido en Apify',
      ABORTED: 'fue abortada (por el tope de gasto, por una persona o por Apify)',
    };
    throw falla(`La ejecución ${run.id} de ${actor} ${motivos[run.status] || `terminó en un estado inesperado`} (estado ${run.status}).`);
  }

  /** Ítems del dataset, paginados con limit y offset. `maxItems` acota la lectura. */
  async function leerDataset(datasetId, { tamanoPagina = PAGINA_DATASET, maxItems = Infinity } = {}) {
    if (typeof datasetId !== 'string' || !datasetId) throw falla('La ejecución no devolvió un dataset.');
    const items = [];
    while (items.length < maxItems) {
      const limite = Math.min(tamanoPagina, maxItems - items.length);
      const parametros = new URLSearchParams({ format: 'json', clean: '1', limit: String(limite), offset: String(items.length) });
      const pagina = await llamar('GET', `/v2/datasets/${encodeURIComponent(datasetId)}/items?${parametros}`);
      if (!Array.isArray(pagina)) throw falla('Respuesta inesperada de Apify al leer el dataset: no es una lista.');
      items.push(...pagina);
      if (pagina.length < limite) break;
    }
    return items;
  }

  /** Ejecuta el actor y devuelve los ítems de su dataset (como mucho `maxItems`). */
  async function ejecutar(actor, input, { topeUsd, maxItems } = {}) {
    const { datasetId } = await ejecutarActor(actor, input, { topeUsd });
    return leerDataset(datasetId, { maxItems: maxItems ?? Infinity });
  }

  return { ejecutarActor, leerDataset, ejecutar };
}

module.exports = { ErrorApify, BASE, leerToken, actorEnUrl, crearClienteApify };
