/**
 * recolector.js — Une las fuentes: llama a cada una, sigue con las demás si una falla o está bloqueada, filtra por distrito y
 * tipo, y deduplica por (fuente, id_fuente). Sin red propia: el cliente HTTP y las fuentes se inyectan. Lo prueba
 * test/avisos-cli.spec.ts.
 *
 * Interfaz de una fuente (cada módulo de scripts/lib/avisos/fuentes/):
 *   { nombre, descripcion, tipos, requiereNavegador,
 *     buscar(filtros, ctx) → Promise<{ estado, mensaje, avisos, paginas }>,   (con red, vía ctx.cliente)
 *     parsear(contenido, ctx) → avisos[] }                                     (pura)
 *   filtros = { distrito (nombre del GeoJSON o null), tipo }
 *   ctx = { cliente, paginas, distritosConocidos, ahora, perfil?, log? }
 *   estado: ok | parcial | bloqueado | robots | error | omitido | sin_navegador
 */
const E = require('./esquema.js');
const ApifyFuentes = require('./apify-fuentes.js');

const FUENTES = {
  nexo: require('./fuentes/nexo.js'),
  adondevivir: require('./fuentes/adondevivir.js'),
  urbania: require('./fuentes/urbania.js'),
  marketplace: require('./fuentes/marketplace.js'),
};

/**
 * Deja solo los avisos del distrito y tipo pedidos. Con un tipo pedido, un aviso sin tipo conocido no se puede confirmar y
 * se excluye (se cuenta en `sinTipo`).
 */
function filtrarAvisos(avisos, { distrito, tipo }) {
  let sinTipo = 0;
  const salida = avisos.filter((a) => {
    if (distrito && a.distrito !== distrito) return false;
    if (tipo && tipo !== 'todos') {
      if (a.tipo_inmueble === null || a.tipo_inmueble === undefined) {
        sinTipo++;
        return false;
      }
      if (a.tipo_inmueble !== tipo) return false;
    }
    return true;
  });
  return { avisos: salida, sinTipo };
}

/**
 * Corre las fuentes en orden (una a la vez). → { avisos, duplicados, resumen }.
 * `resumen`: por fuente { fuente, estado, mensaje, paginas, recolectados (antes de filtrar), finales (aportados tras filtrar y deduplicar) }.
 */
const SUGERENCIA_APIFY = ' Puede probar --transporte apify (plataforma de pago: cuesta dinero y necesita APIFY_TOKEN); no se usa nunca por su cuenta.';

async function recolectar({ fuentes, filtros, paginas, cliente, distritosConocidos, ahora, perfil = null, log = () => {}, registro = FUENTES, transporte = 'directo', apify = null, buscarApify = ApifyFuentes.buscar }) {
  const desconocida = fuentes.find((f) => !registro[f]);
  if (desconocida) throw new Error(`Fuente desconocida: ${desconocida}`);

  const todos = [];
  const resumen = [];
  let duplicados = 0;
  for (const nombre of fuentes) {
    const fuente = registro[nombre];
    log(`\n[${nombre}] buscando…`);
    // Apify solo si se pidió (--transporte apify) y la fuente tiene variante Apify. Nunca como respaldo de un bloqueo.
    const porApify = transporte === 'apify' && ApifyFuentes.FUENTES_APIFY.includes(nombre);
    let r;
    try {
      r = porApify ? await buscarApify(nombre, filtros, { apify, paginas, distritosConocidos, ahora, log }) : await fuente.buscar(filtros, { cliente, paginas, distritosConocidos, ahora, perfil, log });
    } catch (err) {
      r = { estado: 'error', mensaje: `fallo inesperado: ${err.message}`, avisos: [], paginas: 0 };
    }
    if (!porApify && r.estado === 'bloqueado' && ApifyFuentes.FUENTES_APIFY.includes(nombre)) r = { ...r, mensaje: `${r.mensaje || 'bloqueado'}.${SUGERENCIA_APIFY}` };
    const { avisos, sinTipo } = filtrarAvisos(r.avisos || [], filtros);
    const ya = new Set(todos.map(E.claveAviso));
    const nuevos = E.deduplicar(avisos).avisos.filter((a) => !ya.has(E.claveAviso(a)));
    duplicados += avisos.length - nuevos.length;
    todos.push(...nuevos);
    const mensaje = [r.mensaje, sinTipo ? `${sinTipo} aviso(s) sin tipo de inmueble conocido quedaron fuera del filtro por tipo` : null].filter(Boolean).join('; ') || null;
    resumen.push({ fuente: nombre, via: porApify ? 'apify' : 'directo', estado: r.estado, mensaje, paginas: r.paginas || 0, recolectados: (r.avisos || []).length, finales: nuevos.length });
  }
  return { avisos: todos, duplicados, resumen };
}

module.exports = { FUENTES, filtrarAvisos, recolectar };
