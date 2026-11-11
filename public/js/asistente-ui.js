/**
 * asistente-ui.js — Vista de chat del asistente: panel, mensajes y menús para armar una búsqueda; los sectores y las entidades se dibujan con capas-ui.js.
 *
 * Toda la lógica (entender el texto, responder, buscar zonas, armar la consulta desde los menús, explicar cada respuesta)
 * está en asistente.js. Aquí solo se conecta con la página: lee los mismos datos que la ficha (Zonificacion,
 * Equipamiento, Distritos) y dibuja los resultados en el mapa. Los menús desplegables producen la MISMA consulta que el
 * intérprete saca de una frase (Asistente.construirConsulta), así que hay un solo motor de decisión.
 * La conversación no se guarda: al recargar la página empieza de cero. Con el modo Gemini activo, lo que se escribe se
 * envía al proveedor del modelo (asistente-llm.js); en modo reglas no sale del navegador hacia ningún modelo. La vista
 * lo dice junto al campo de texto (AsistenteLLM.textoModo).
 */
const AsistenteUI = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAX_MENSAJES = 60;
  const NIVELES = ['inicial', 'primaria', 'secundaria'];

  let api = null; // { map, obtenerPunto, consultarPunto, umbrales, mostrarMapa, mapaVisible, alBuscar, verSector }
  let ultimaBusqueda = null; // { criterios, radioGlobalM, incluirCondicional } para «agrega…», «quita…», «prioriza…»
  let preparado = null; // promesa con los datos ya ordenados para buscar
  let cacheContexto = null; // { clave, ctx } del último punto consultado
  let ocupado = false;
  let saludado = false;
  let promesaModo = null;
  // Language model: null = not checked yet, true = /api/chat has Gemini, false = rules only (no key or static site).
  let llmDisponible = null;
  const historial = []; // last turns sent to the model as context: { rol: 'usuario' | 'asistente', texto }

  const hayLLM = () => typeof AsistenteLLM !== 'undefined';
  // El modo y lo que se envía adónde se dicen junto al campo de texto (AsistenteLLM.textoModo): con Gemini, lo escrito llega al proveedor.
  function mostrarModo(origen) {
    const el = $('asistente-modo');
    if (!el) return;
    const m = hayLLM()
      ? AsistenteLLM.textoModo(origen)
      : { modo: 'reglas', etiqueta: 'Modo: reglas', ayuda: el.title, privacidad: 'En modo reglas lo que escribes no se envía a ningún modelo.' };
    el.textContent = m.etiqueta;
    el.dataset.modo = m.modo;
    el.title = m.ayuda;
    if ($('asistente-privacidad')) $('asistente-privacidad').textContent = m.privacidad;
  }
  /** Averigua una sola vez si el servidor tiene el modelo. Se espera antes de enviar el primer mensaje: así el modo ya se ve. */
  function verificarModo() {
    if (!hayLLM() || llmDisponible !== null) return Promise.resolve();
    if (!promesaModo) {
      promesaModo = AsistenteLLM.disponible().then((si) => {
        if (llmDisponible === null) llmDisponible = si;
        mostrarModo(si ? 'gemini' : 'reglas');
      });
    }
    return promesaModo;
  }
  function recordar(rol, texto) {
    historial.push({ rol, texto: String(texto).slice(0, 300) });
    while (historial.length > 6) historial.shift();
  }

  const cacheCeldas = new Map(); // la cuadrícula no depende de los criterios: se arma una vez por tipo de zona
  const celdasDe = (zonas, condicional) => {
    const k = condicional ? 'con' : 'sin';
    if (!cacheCeldas.has(k)) cacheCeldas.set(k, Asistente.generarCeldas(zonas, { pasoM: CONFIG.asistente.pasoCeldaM, incluirCondicional: condicional }));
    return cacheCeldas.get(k);
  };

  const umbrales = () => ({ ...CONFIG.umbrales, zona: CONFIG.asistente.umbralesZona });
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------------ Mensajes

  /** Texto con saltos de línea a párrafos; las líneas que empiezan con «• » forman una lista. */
  function textoAHtml(texto) {
    const out = [];
    let lista = [];
    const cerrar = () => { if (lista.length) { out.push(`<ul>${lista.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`); lista = []; } };
    String(texto).split('\n').forEach((l) => {
      if (l.startsWith('• ')) lista.push(l.slice(2));
      else { cerrar(); if (l.trim()) out.push(`<p>${esc(l)}</p>`); }
    });
    cerrar();
    return out.join('');
  }

  const bloqueLista = (titulo, items) => (items.length ? `<p class="chat-mas-t">${titulo}</p><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '');

  /** Apartado desplegable «Por qué, fuente y límites» (texto fijo de Asistente.explicar, más el detalle de una búsqueda). */
  function masHtml(explicacion, detalle = []) {
    if (!explicacion) return '';
    const porque = [...detalle.filter((l) => !/^Resultado referencial/.test(l)), ...explicacion.porque];
    const cuerpo = bloqueLista('Por qué', porque) + bloqueLista('Fuente', explicacion.fuente) + bloqueLista('Límites', explicacion.limites);
    return cuerpo ? `<details class="chat-mas"><summary>Por qué, fuente y límites</summary><div class="chat-mas-cuerpo">${cuerpo}</div></details>` : '';
  }

  /** Un sector de la búsqueda: su nombre, de qué tamaño es, lo que hay en su centro y los botones «Ver en el mapa» y «Consultar este punto». */
  function filaHtml(f, i) {
    const acciones = f.mejor
      ? `<div class="chat-acc">
          <button type="button" class="ghost" data-accion="ver" data-lat="${f.mejor.lat}" data-lon="${f.mejor.lon}" data-n="${f.n}">Ver en el mapa</button>
          <button type="button" class="ghost" data-accion="consultar" data-lat="${f.mejor.lat}" data-lon="${f.mejor.lon}" data-nombre="${esc(f.titulo)}">Consultar este punto</button>
        </div>`
      : '';
    return `<li class="chat-fila"><details class="chat-distrito"${i === 0 ? ' open' : ''}>
      <summary><span class="chat-fila-n" aria-hidden="true">${f.n}</span><span class="chat-fila-t"><strong>${esc(f.titulo)}</strong><span class="chat-fila-pct">${esc(f.detalle)}</span></span></summary>
      <div class="chat-fila-cuerpo">${f.nota ? `<span class="chat-fila-det">${esc(f.nota)}</span>` : ''}${acciones}</div>
    </details></li>`;
  }

  /** Un botón de sugerencia: un texto, o { etiqueta, texto } cuando lo que se ve es más corto que lo que se envía. */
  const botonSugerencia = (s) => {
    const texto = typeof s === 'string' ? s : s.texto;
    const etiqueta = typeof s === 'string' ? s : s.etiqueta;
    return `<button type="button" class="ghost" data-accion="sugerir" data-texto="${esc(texto)}">${esc(etiqueta)}</button>`;
  };

  /** Agrega un mensaje al registro. Devuelve el elemento (para poder quitar el aviso de «buscando»). */
  function mensaje(rol, { texto, filas = [], sugerencias = [], espera = false, explicacion = null, detalle = [], verMapa = false, botones = [] }) {
    const log = $('asistente-log');
    const el = document.createElement('div');
    el.className = `chat-msg chat-${rol}`;
    if (espera) el.dataset.espera = 'true';
    const quien = rol === 'usuario' ? 'Tú: ' : 'Asistente: ';
    el.innerHTML = `<span class="sr-only">${quien}</span><div class="chat-burbuja">${rol === 'usuario' ? `<p>${esc(texto)}</p>` : textoAHtml(texto)}${filas.length ? `<ol class="chat-filas">${filas.map(filaHtml).join('')}</ol>` : ''}${masHtml(explicacion, detalle)}</div>`
      + (botones.length ? `<div class="chat-acc">${botones.map((b) => `<button type="button" class="ghost" data-accion="${b.accion}">${esc(b.etiqueta)}</button>`).join('')}</div>` : '')
      + (verMapa ? '<div class="chat-acc chat-ver-mapa"><button type="button" class="ghost" data-accion="mapa">Ver el mapa</button></div>' : '')
      + (sugerencias.length ? `<div class="chat-sug" role="group" aria-label="Sugerencias">${sugerencias.map(botonSugerencia).join('')}</div>` : '');
    log.appendChild(el);
    while (log.children.length > MAX_MENSAJES) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  // ------------------------------------------------------------------- Contexto

  /** Lo ya calculado del punto elegido. Se calcula aquí aunque la persona aún no haya abierto el reporte. */
  async function contexto() {
    const base = { estadoPDM: CONFIG.estadoPDM, potencial: Zonificacion.potencial };
    const p = api.obtenerPunto();
    if (!p) return { ...base, punto: null };
    const umbral = api.umbrales ? api.umbrales().quebradaMinM : null; // «Mis umbrales»: cambia el estado de quebradas
    const clave = `${p.lat},${p.lon},${umbral}`;
    if (cacheContexto && cacheContexto.clave === clave) return cacheContexto.ctx;
    const [zona, entorno, dis, riesgo] = await Promise.all([
      Zonificacion.lookup(p.lat, p.lon).catch(() => null),
      Equipamiento.evaluar(p.lat, p.lon), // nunca rechaza: cada variable devuelve SIN DATO con su causa
      Distritos.lookup(p.lat, p.lon).catch(() => null),
      Contexto.evaluar(p.lat, p.lon, umbral), // quebradas, peligros y sismos: contexto informativo
    ]);
    const interrupciones = await Equipamiento.interrupcionesDe(dis ? dis.distrito : null); // SUNASS: interrupciones del servicio de agua del distrito (informativo)
    const ctx = { ...base, punto: { lat: p.lat, lon: p.lon }, distrito: dis ? dis.distrito : null, zona, entorno, interrupciones, cauce: riesgo.quebradas, sismos: riesgo.sismos, peligros: riesgo.peligros, volcan: riesgo.volcan, cenepred: riesgo.cenepred, departamento2025: CONFIG.censo.departamento2025 };
    cacheContexto = { clave, ctx };
    return ctx;
  }

  /** Líneas de transporte (OpenStreetMap) que cruzan un distrito ya reconocido (nombre exacto de Distritos): { distrito, res } o { distrito, error }. */
  async function rutasDeDistrito(distrito) {
    try {
      const [indice] = await Promise.all([Equipamiento.indiceRutas(), Distritos.load()]);
      return { distrito, res: Rutas.cruzan(indice, Distritos.geometriaDe(distrito)) };
    } catch (err) {
      console.error('[Asistente] rutas por distrito', err);
      return { distrito, error: err.message };
    }
  }

  /** Qué parte de un distrito (nombre exacto de Distritos) cae en cada zona de peligro volcánico del Misti: { r, fecha } o { error }. */
  async function volcanDeDistrito(distrito) {
    try {
      const [{ zonas, meta }] = await Promise.all([Contexto.volcanCrudo(), Distritos.load()]);
      return { r: Volcan.porDistrito(zonas, Distritos.poligonos(distrito), { pasoM: 250 }), fecha: String(meta.descargado || '').slice(0, 10) };
    } catch (err) {
      console.error('[Asistente] peligro volcánico por distrito', err);
      return { error: err.message };
    }
  }

  /** Para «¿cuánto cuesta el m² en…?»: el archivo de precios y, si hay punto, su distrito. No necesita el resto de la ficha. */
  async function contextoPrecio() {
    const p = api.obtenerPunto();
    const [precios, dis] = await Promise.all([
      Precios.load().catch(() => null), // sin archivo, el asistente lo dice
      p ? Distritos.lookup(p.lat, p.lon).catch(() => null) : Promise.resolve(null),
    ]);
    return { estadoPDM: CONFIG.estadoPDM, potencial: Zonificacion.potencial, punto: p, distrito: dis ? dis.distrito : null, precios };
  }

  // -------------------------------------------------------------------- Búsqueda

  /** Ordena los archivos congelados y el plano una sola vez; si falta equipamiento, no se puede buscar. */
  function preparar() {
    if (!preparado) {
      preparado = (async () => {
        const [zonas, congelados, , cauces, consultorios, comercio] = await Promise.all([Zonificacion.zonas(), Equipamiento.datosCongelados(), Distritos.load().catch(() => null), Contexto.cauces().catch(() => null), Equipamiento.consultorios(), Equipamiento.comercio()]); // el tercero (distritos) solo se precarga; los consultorios y el comercio son informativos y opcionales
        if (!congelados) throw new Error('Faltan los archivos de equipamiento de OpenStreetMap (public/data/equipamiento); sin ellos no puedo buscar zonas.');
        const datos = Asistente.prepararDatos({
          salud: congelados.salud.features, consultorios: consultorios ? consultorios.features : [],
          mercados: comercio.mercados ? comercio.mercados.features : [], supermercados: comercio.supermercados ? comercio.supermercados.features : [], malls: comercio.malls ? comercio.malls.features : [],
          finanzas: comercio.finanzas ? comercio.finanzas.features : [], comida_fuera: comercio.comida_fuera ? comercio.comida_fuera.features : [], recreacion: comercio.recreacion ? comercio.recreacion.features : [],
          educacion: congelados.educacion.features, transporte: congelados.transporte.features, areasVerdes: congelados.areasVerdes.features,
          cauces: cauces ? cauces.lista : [],
        }, zonas, umbrales());
        const fechas = Object.values(comercio).filter(Boolean).map((d) => d.fecha).filter(Boolean).sort();
        return { zonas, datos, fecha: congelados.salud.fecha, fechaComercio: fechas.length ? fechas[fechas.length - 1] : null, hayCauces: Boolean(cauces), cauces: cauces ? cauces.lista : null };
      })().catch((err) => { preparado = null; throw err; });
    }
    return preparado;
  }

  /** Los datos ya ordenados para dibujar entidades en el mapa (capas-ui.js). Los sismos son opcionales: sin archivo, la capa lo dice. */
  /**
   * Las manzanas del censo (INEI, 2017) de lo que se ve: lee el índice y SOLO las piezas de los distritos cuya caja toca `vista` ([oeste, sur, este, norte]). Si tocan más de
   * `MAX_PIEZAS_CENSO` (el mapa abarca media ciudad) no baja nada y la capa lo dice: son varios MB y miles de polígonos. Devuelve la lista de Features o null.
   */
  const MAX_PIEZAS_CENSO = 4;
  async function manzanasDelCenso(vista) {
    const c = CONFIG.censo;
    const indice = await fetch(c.indiceUrl).then((r) => (r.ok ? r.json() : null));
    if (!indice || !Array.isArray(indice.distritos)) return null;
    const toca = (d) => !vista || !(d.caja[2] < vista[0] || d.caja[0] > vista[2] || d.caja[3] < vista[1] || d.caja[1] > vista[3]);
    const piezas = indice.distritos.filter(toca);
    if (piezas.length === 0 || piezas.length > MAX_PIEZAS_CENSO) return null;
    const cargadas = await Promise.all(piezas.map((d) => fetch(`${c.carpetaUrl}${d.archivo}`).then((r) => (r.ok ? r.json() : null))));
    return cargadas.some((x) => !x) ? null : cargadas.flatMap((x) => x.features);
  }

  async function datosParaMapa({ rutas = false, volcan = false, cenepred = false, electricidad = false, mineria = false, acopio = false, censo = null } = {}) {
    const { zonas, datos, fecha, cauces } = await preparar();
    let sismos = null;
    try { sismos = Capas.sismosDeFeatures(await Contexto.sismosCrudos()); } catch (_) { sismos = null; }
    // Los recorridos de OpenStreetMap pesan unos 3 MB: solo se bajan cuando hay líneas que dibujar. Si fallan, la capa lo dice.
    let indiceRutas = null;
    if (rutas) { try { indiceRutas = await Equipamiento.indiceRutas(); } catch (_) { indiceRutas = null; } }
    // Las zonas de peligro volcánico (~0,5 MB) solo se bajan cuando se van a dibujar. Si fallan, la capa lo dice.
    let concesiones = null; // áreas de concesión de distribución eléctrica (MINEM-DGE): solo con la capa «electricidad»
    if (electricidad) { try { const f = await fetch(CONFIG.equipamiento.archivos.electricidad).then((r) => (r.ok ? r.json() : null)); concesiones = f && Array.isArray(f.features) ? f.features : null; } catch (_) { concesiones = null; } }
    let mineras = null; // concesiones mineras (INGEMMET): solo con la capa «mineria»
    if (mineria) { try { const f = await fetch(CONFIG.equipamiento.archivos.mineria).then((r) => (r.ok ? r.json() : null)); mineras = f && Array.isArray(f.features) ? f.features : null; } catch (_) { mineras = null; } }
    let puntosAcopio = null; // puntos de acopio de agua (SEDAPAR): solo con la capa «acopio_agua»
    if (acopio) { try { const f = await fetch(CONFIG.equipamiento.archivos.acopio).then((r) => (r.ok ? r.json() : null)); puntosAcopio = f && Array.isArray(f.features) ? f.features : null; } catch (_) { puntosAcopio = null; } }
    let manzanas = null; // manzanas del censo (INEI, 2017): solo con una capa censo_*; `censo` es la vista [oeste, sur, este, norte] o true
    if (censo) { try { manzanas = await manzanasDelCenso(Array.isArray(censo) ? censo : null); } catch (_) { manzanas = null; } }
    let zonasVolcan = null;
    if (volcan) { try { zonasVolcan = (await Contexto.volcanCrudo()).zonas; } catch (_) { zonasVolcan = null; } }
    // El escenario del CENEPRED es un archivo pequeño (25 distritos) y sus límites; solo se leen cuando se va a colorear. Si fallan, la capa lo dice.
    let datosCenepred = null;
    if (cenepred) { try { const [cen] = await Promise.all([Cenepred.load(), Distritos.load()]); datosCenepred = cen; } catch (_) { datosCenepred = null; } }
    return { datos, zonas, cauces, sismos, volcan: zonasVolcan, electricidad: concesiones, mineria: mineras, acopio: puntosAcopio, censo: manzanas, cenepred: datosCenepred, rutas: indiceRutas, umbrales: umbrales(), fecha };
  }

  // ------------------------------------------------------------ Viaje en combi o bus

  let cacheViaje = null; // promesa con { rutas, paradas } de OpenStreetMap ya adaptadas (Viaje.desdeOsm y Viaje.paradasDeOsm)
  /** Las rutas para «¿qué combi me lleva…?»: ~3 MB de OpenStreetMap (el mismo archivo que usa la ficha). Si falla, null. */
  function datosParaViaje() {
    if (!cacheViaje) {
      cacheViaje = (async () => {
        const fc = await fetch(CONFIG.viaje.osmUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const rutas = fc ? Viaje.desdeOsm(fc) : [];
        return rutas.length ? { rutas, paradas: Viaje.paradasDeOsm(fc) } : null;
      })();
      cacheViaje.then((r) => { if (!r) cacheViaje = null; });
    }
    return cacheViaje;
  }
  async function rutasParaViaje() { const d = await datosParaViaje(); return d ? d.rutas : null; }
  async function paradasParaViaje() { const d = await datosParaViaje(); return d ? d.paradas : []; }

  /**
   * Un punto de partida o de llegada para un distrito: el promedio de las celdas de 250 m de sus zonas construibles del plano (donde hay o puede haber viviendas), no el centro
   * geométrico del polígono, que en Cerro Colorado o Yura cae en el desierto. Es aproximado y se dice. null si el distrito no tiene zonas construibles en el plano.
   */
  async function centroUrbanoDistrito(distrito) {
    await Distritos.load().catch(() => null);
    const { zonas } = await preparar();
    const propias = celdasDe(zonas, true).filter((c) => Distritos.nombreDe(c.lat, c.lon) === distrito);
    if (!propias.length) return null;
    return { lat: propias.reduce((t, c) => t + c.lat, 0) / propias.length, lon: propias.reduce((t, c) => t + c.lon, 0) / propias.length, celdas: propias.length };
  }

  /** Lo que el chat necesita para viajar: las rutas, la distancia a pie y el destino fijado; para la búsqueda de zonas, además las celdas desde las que se llega. */
  async function contextoViaje(intencion) {
    const base = await contexto();
    const viajeRutas = await rutasParaViaje();
    const destino = intencion.destino || (api.obtenerDestino ? api.obtenerDestino() : null);
    const c = { ...base, viajeRutas, viajeParadas: await paradasParaViaje(), caminarM: CONFIG.viaje.caminarM, trasbordoM: CONFIG.viaje.trasbordoM, maxTrasbordos: CONFIG.viaje.maxTrasbordos, tiempo: CONFIG.viaje.tiempo, destino };
    if (intencion.origen && intencion.origen.tipo === 'distrito') c.origenPunto = await centroUrbanoDistrito(intencion.origen.distrito);
    if (intencion.tipo === 'ruta_zonas' && viajeRutas && destino) {
      const { zonas } = await preparar();
      const celdas = celdasDe(zonas, false);
      const v = intencion.viaje || {};
      const hits = Viaje.zonasConRutaDirecta(destino, viajeRutas, celdas, { caminarM: CONFIG.viaje.caminarM, trasbordoM: CONFIG.viaje.trasbordoM, trasbordo: Boolean(intencion.trasbordo), linea: v.linea || null, texto: v.texto || null });
      await Distritos.load().catch(() => null);
      c.zonasRuta = { ...Asistente.resumirRutaZonas(hits, celdas, (la, lo) => Distritos.nombreDe(la, lo), { separacionM: CONFIG.asistente.separacionPuntosM }), caminarM: CONFIG.viaje.caminarM, trasbordo: Boolean(intencion.trasbordo), trasbordoM: CONFIG.viaje.trasbordoM, celdasConRuta: hits.map((h) => ({ lat: h.celda.lat, lon: h.celda.lon })) };
    }
    return c;
  }

  /** Lo que el chat necesita para hablar de un distrito: sus polígonos, el conteo o el perfil y la fecha de los datos. */
  async function contextoDistrito(intencion) {
    const base = { estadoPDM: CONFIG.estadoPDM, potencial: Zonificacion.potencial, punto: api.obtenerPunto(), distritoTitulo: Distritos.titulo(intencion.distrito) };
    if (intencion.distritoFuera) return base;
    await Distritos.load();
    if (intencion.tipo === 'rutas') return { ...base, rutasDistrito: await rutasDeDistrito(intencion.distrito) };
    if (intencion.tipo === 'volcan') return { ...base, volcanDistrito: await volcanDeDistrito(intencion.distrito) };
    if (intencion.tipo === 'cenepred') return { ...base, cenepredDatos: await Cenepred.load().catch(() => null) }; // sin archivo, el asistente lo dice
    const { zonas, datos, fecha, fechaComercio, cauces } = await preparar();
    const polys = Distritos.poligonos(intencion.distrito);
    const opciones = { areaMinM2: CONFIG.umbrales.areaVerde.areaMinM2 };
    if (intencion.tipo === 'consultorio') return { ...base, fecha, consultorios: Entidades.contarConsultorios(datos, polys) };
    if (intencion.tipo === 'comercio') return { ...base, fecha: fechaComercio || fecha, comercio: Object.fromEntries(intencion.comercio.map((id) => [id, Entidades.contarComercio(datos, polys, id)])) };
    if (intencion.tipo === 'contar') return { ...base, fecha, conteo: Entidades.contar(datos, polys, opciones), ...(intencion.consultorio ? { consultorios: Entidades.contarConsultorios(datos, polys) } : {}) };
    // El perfil suma lo que ya existe en el resto de las fuentes: líneas de transporte (OpenStreetMap) que lo cruzan y precio de oferta (solo 3 distritos).
    const [rutasDistrito, precios, cenepredDatos] = await Promise.all([rutasDeDistrito(intencion.distrito), Precios.load().catch(() => null), Cenepred.load().catch(() => null)]);
    return { ...base, fecha, perfil: Entidades.perfil(datos, zonas, cauces, polys, { ...opciones, pasoM: 300 }), rutasDistrito, precios, cenepredDatos };
  }

  /** Distancia mínima a quebradas que dio la persona (menú o frase), o null: solo con ella existe el criterio «lejos de quebradas». */
  function distanciaQuebradaM() {
    const menu = $('cons-cauce') && $('cons-cauce').value ? Number($('cons-cauce').value) : null;
    if (menu) return menu;
    const dicho = ultimaBusqueda && ultimaBusqueda.criterios.find((c) => c.id === 'lejosQuebrada');
    return dicho && dicho.umbralM ? dicho.umbralM : null;
  }

  async function ejecutarBusqueda(intencion) {
    const anterior = intencion.modo !== 'nuevo' ? ultimaBusqueda : null;
    const criterios = intencion.modo === 'nuevo' ? intencion.criterios : Asistente.combinarBusqueda(anterior, intencion);
    if (criterios.length === 0) {
      mensaje('asistente', { texto: 'Con eso no quedó ningún criterio para buscar. Dime qué te importa, por ejemplo «cerca de un colegio y un parque».', sugerencias: Asistente.SUGERENCIAS_BASE, explicacion: Asistente.explicar('desconocido') });
      return;
    }
    // «Lejos de quebradas» solo vale con la distancia mínima de la persona: ninguna norma la fija, así que no se usa un valor por defecto.
    if (Asistente.criteriosSinUmbral(criterios).length > 0) {
      mensaje('asistente', {
        texto: 'Para buscar «lejos de quebradas» necesito la distancia mínima que tú quieras: no existe una distancia oficial. Dime, por ejemplo, «lejos de quebradas a más de 200 m», o elígela en el menú «Armar una búsqueda sin escribir».',
        sugerencias: ['Busco lejos de quebradas a más de 200 m', 'Busco lejos de quebradas a más de 500 m'],
        explicacion: Asistente.explicar('quebrada'),
      });
      return;
    }
    const punto = api.obtenerPunto();
    const limitar = Boolean(intencion.limitarAlPunto && punto);
    const radioGlobalM = limitar ? null : (intencion.radioGlobalM ?? (anterior ? anterior.radioGlobalM : null));
    const radioAreaM = limitar ? (intencion.radioGlobalM ?? CONFIG.asistente.radioAreaM) : null;
    const incluirCondicional = Boolean(intencion.incluirCondicional || (anterior && anterior.incluirCondicional));
    const distrito = intencion.distrito || (anterior ? anterior.distrito : null) || null; // «agrega transporte» sigue dentro del mismo distrito
    if (distrito && intencion.distritoFuera) {
      mensaje('asistente', { texto: Asistente.textoDistritoFuera(Distritos.titulo(distrito)), sugerencias: Asistente.SUGERENCIAS_BASE, explicacion: Asistente.explicar('desconocido') });
      return;
    }

    const espera = mensaje('asistente', { texto: 'Buscando sectores con los datos de la ficha…', espera: true });
    try {
      const { zonas, datos, fecha, hayCauces } = await preparar();
      if (!hayCauces && criterios.some((c) => c.id === 'lejosQuebrada')) {
        espera.remove();
        mensaje('asistente', { texto: 'No pude leer el archivo de quebradas, así que no puedo buscar «lejos de quebradas» sin inventar datos. Prueba con los demás criterios.', explicacion: Asistente.explicar('quebrada') });
        return;
      }
      await pausa(30); // deja pintar el aviso antes del cálculo
      await Distritos.load();
      const resultado = Asistente.buscar({
        criterios, zonas, datos, umbrales: umbrales(), distritoDe: (la, lo) => Distritos.nombreDe(la, lo), distrito,
        pasoM: CONFIG.asistente.pasoCeldaM, minCeldas: CONFIG.asistente.minCeldasArea, maxPuntos: CONFIG.asistente.maxPuntos, separacionM: CONFIG.asistente.separacionPuntosM,
        centro: limitar ? punto : null, radioM: radioAreaM, incluirCondicional, radioGlobalM, celdas: celdasDe(zonas, incluirCondicional),
      });
      const aproximados = criterios.map((c) => c.id).filter((id) => Asistente.CRITERIOS[id].aproximado);
      const f = Asistente.formatearBusqueda(resultado, { aproximados, temaNoSoportado: intencion.temaNoSoportado, radioGlobalM, datos, distrito: distrito ? Distritos.titulo(distrito) : null });
      const notas = [];
      if (limitar) notas.push(`Solo miré a ${Asistente.fmtDist(radioAreaM)} o menos de tu punto.`);
      else if (intencion.limitarAlPunto) notas.push('Todavía no elegiste un punto, así que busqué en toda la ciudad.');
      if (incluirCondicional) notas.push('Incluí zonas condicionadas, donde lo que se puede construir depende de la zona vecina o de un plan específico.');
      notas.push(`Datos de OpenStreetMap del ${fecha || 'sin fecha'}. Distancias en línea recta.`);

      ultimaBusqueda = { criterios, radioGlobalM, incluirCondicional, distrito };
      sincronizarFormulario(ultimaBusqueda);
      espera.remove();
      // Lo esencial queda a la vista; cómo se calculó y los avisos de método van en «Por qué, fuente y límites».
      mensaje('asistente', {
        texto: `${f.lineas.principal.join('\n')}\n${notas.join('\n')}`,
        filas: f.filas,
        sugerencias: f.sugerencias,
        explicacion: Asistente.explicar('buscar', { fecha, aproximados, cauce: criterios.some((c) => c.id === 'lejosQuebrada') }),
        detalle: f.lineas.detalle,
        verMapa: true,
      });
      // El mapa muestra las entidades de lo que pediste y, resaltados, los sectores donde se cumple todo.
      if (api.alBuscar) api.alBuscar({ capas: Capas.deCriterios(resultado.criterios), distrito, sectores: f.sectores });
    } catch (err) {
      espera.remove();
      console.error('[Asistente] búsqueda', err);
      mensaje('asistente', { texto: `No pude hacer la búsqueda: ${err.message}` });
    }
  }

  // -------------------------------------------------------------------- Turnos

  function ocupar(si) {
    ocupado = si;
    $('asistente-enviar').disabled = si;
    $('cons-buscar').disabled = si;
  }

  async function enviar(texto) {
    const limpio = String(texto || '').trim();
    if (!limpio || ocupado) return;
    ocupar(true);
    mensaje('usuario', { texto: limpio });
    try {
      await verificarModo(); // antes de enviar nada, la persona ya ve si el texto llega a un modelo
      const hayPunto = Boolean(api.obtenerPunto());
      const destino = api.obtenerDestino ? api.obtenerDestino() : null; // el que la persona fijó con «Ir al trabajo»
      const reglas = () => Asistente.interpretar(limpio, { hayPunto, ultimaBusqueda, destino });
      let eleccion = { origen: 'reglas', intencion: null };
      // El modelo no conoce las categorías «consultorio» (distinta de la salud) ni mercado, supermercado y mall (informativas): esas frases las responden las reglas, sin salir del navegador.
      if (hayLLM() && llmDisponible !== false && !Asistente.mencionaConsultorio(limpio) && !Asistente.mencionaComercio(limpio) && !Asistente.mencionaElectricidad(limpio) && !Asistente.mencionaMineria(limpio) && !Asistente.mencionaAgua(limpio) && !Asistente.mencionaViaje(limpio, { hayPunto, destino })) {
        const espera = mensaje('asistente', { texto: 'Pensando…', espera: true });
        const r = await AsistenteLLM.interpretar({
          mensaje: limpio, historial,
          estado: { hayPunto, criteriosPrevios: ultimaBusqueda ? ultimaBusqueda.criterios.map((c) => c.id) : [] },
        });
        espera.remove();
        if (r.disponible === false) llmDisponible = false;
        else if (r.disponible === true) llmDisponible = true;
        eleccion = AsistenteLLM.elegirIntencion(r, { reglas, ultimaBusqueda });
      } else {
        eleccion.intencion = reglas();
      }
      mostrarModo(eleccion.origen);
      recordar('usuario', limpio);
      const intencion = eleccion.intencion;
      if (intencion.tipo === 'buscar') {
        if (intencion.consultorio) mensaje('asistente', { texto: Asistente.notaConsultorio() }); // la búsqueda sigue sin el consultorio
        if ((intencion.comercio || []).length) mensaje('asistente', { texto: Asistente.notaComercio() }); // ni mercados, supermercados o malls
        await ejecutarBusqueda(intencion);
      }
      else {
        const esDistrito = ['contar', 'consultorio', 'comercio', 'perfil', 'rutas', 'volcan', 'cenepred'].includes(intencion.tipo) && intencion.distrito;
        const conPunto = ['ficha', 'servicio', 'consultorio', 'comercio', 'electricidad', 'mineria', 'agua', 'zona', 'construir', 'quebrada', 'sismos', 'peligros', 'rutas', 'volcan', 'cenepred'].includes(intencion.tipo);
        const ctx = intencion.tipo === 'viaje' || intencion.tipo === 'ruta_zonas' ? await contextoViaje(intencion) : intencion.tipo === 'precio' ? await contextoPrecio() : esDistrito ? await contextoDistrito(intencion) : intencion.tipo === 'cenepred' ? { ...(await contexto()), cenepredDatos: await Cenepred.load().catch(() => null) } : conPunto ? await contexto() : { estadoPDM: CONFIG.estadoPDM, potencial: Zonificacion.potencial, punto: api.obtenerPunto() };
        const resp = Asistente.responder(intencion, ctx);
        let texto = resp.texto;
        // Gemini only rewords the deterministic answer; the text is verified (numbers, names, caveat) or discarded.
        // The profile and the «what matters to you?» question keep their exact structure (buttons and closing question), so they are not reworded.
        if (eleccion.origen === 'gemini' && texto && !['perfil', 'mejor_zona', 'electricidad', 'mineria', 'agua', 'viaje', 'ruta_zonas'].includes(intencion.tipo)) {
          const espera = mensaje('asistente', { texto: 'Redactando…', espera: true });
          const red = await AsistenteLLM.redactar({ pregunta: limpio, tipo: intencion.tipo, hechos: { texto } });
          espera.remove();
          if (red.modo === 'gemini' && red.texto) texto = red.texto;
        }
        recordar('asistente', texto);
        mensaje('asistente', { ...resp, texto, explicacion: Asistente.explicar(intencion.tipo), verMapa: Boolean(resp.mapa) });
        // «Cuántos colegios hay en X»: se dibujan esos colegios y se encuadra el distrito. El perfil solo marca el distrito.
        if (resp.mapa && api.alBuscar) {
          const nivelPedido = resp.mapa.capas.some((id) => Asistente.NIVELES_COLEGIO.includes(id));
          const capas = Capas.deCriterios(resp.mapa.capas.map((id) => ({ id }))).map((c) => (c.id === 'colegios' && !nivelPedido ? { id: 'colegios' } : c)); // «colegios» a secas son todos los niveles
          if (resp.mapa.lineas) capas.push({ id: 'lineas', ...resp.mapa.lineas }); // líneas de bus: nombres de las líneas y, si hay, el punto
          if (resp.mapa.volcan) capas.push({ id: 'volcan', ...resp.mapa.volcan }); // peligro volcánico: los fenómenos que se dibujan
          if (resp.mapa.viaje) capas.push({ id: 'viaje', ...resp.mapa.viaje }); // ruta al trabajo: tramos, origen, destino y, en zonas, las celdas
          if (resp.mapa.cenepred) capas.push({ id: resp.mapa.cenepred.fenomeno === 'movimientos_masa' ? 'cenepred_mm' : 'cenepred_inundacion' }); // riesgo de los distritos ante El Niño (CENEPRED)
          api.alBuscar({ capas, distrito: resp.mapa.distrito, sectores: [] });
        }
      }
    } catch (err) {
      console.error('[Asistente]', err);
      mensaje('asistente', { texto: 'Algo falló al responder. Intenta de nuevo; si sigue, recarga la página.' });
    } finally {
      ocupar(false);
    }
  }

  /** Una consulta armada con los menús: se muestra como frase y se ejecuta sin pasar por el intérprete. */
  async function enviarConsulta(consulta) {
    if (ocupado || consulta.tipo !== 'buscar') return;
    ocupar(true);
    mensaje('usuario', { texto: Asistente.textoDeConsulta(consulta) });
    try {
      await ejecutarBusqueda(consulta);
    } catch (err) {
      console.error('[Asistente]', err);
      mensaje('asistente', { texto: 'Algo falló al buscar. Intenta de nuevo; si sigue, recarga la página.' });
    } finally {
      ocupar(false);
    }
  }

  // --------------------------------------------------- Menús para armar la búsqueda

  const checks = () => [...document.querySelectorAll('#constructor-form input[name="cons-criterio"]')];
  const elegidos = () => checks().filter((c) => c.checked).map((c) => c.value);
  const etiquetaCorta = (id) => {
    if (id === 'lejosQuebrada') return 'Lejos de quebradas';
    const o = [...Asistente.OPCIONES.servicios, ...Asistente.OPCIONES.zonas].find((x) => x.id === id);
    return o ? o.etiqueta.split(' (')[0] : id;
  };
  const etiquetaRadio = (m) => (m === null ? 'Según la ficha (cada servicio con su distancia)' : m < 1000 ? `${m} m` : `${String(m / 1000).replace('.', ',')} km`);

  function leerFormulario() {
    const prio = $('cons-prio').value;
    return {
      lejosQuebradaM: $('cons-cauce').value ? Number($('cons-cauce').value) : null,
      cercaDeMiPunto: $('cons-punto').checked && !$('cons-punto').disabled,
      criterios: elegidos(),
      prioridades: prio ? [prio] : [],
      nivel: $('cons-nivel').value,
      radioM: $('cons-radio').value ? Number($('cons-radio').value) : null,
      incluirCondicional: $('cons-cond').checked,
    };
  }

  /** Mantiene al día lo que depende de lo elegido: el resumen del desplegable, el nivel educativo y las opciones de prioridad. */
  function actualizarFormulario() {
    const ids = elegidos();
    const nombres = ids.map(etiquetaCorta);
    $('cons-que-n').textContent = nombres.length === 0 ? 'Elige uno o más' : nombres.length <= 2 ? nombres.join(', ') : `${nombres.slice(0, 2).join(', ')} y ${nombres.length - 2} más`;
    $('cons-nivel-campo').hidden = !ids.includes('colegio');
    const prevista = $('cons-prio').value;
    const conCauce = $('cons-cauce').value ? [...ids, 'lejosQuebrada'] : ids;
    $('cons-prio').innerHTML = `<option value="">Ninguna</option>${conCauce.map((id) => `<option value="${id}">${esc(etiquetaCorta(id))}</option>`).join('')}`;
    $('cons-prio').value = conCauce.includes(prevista) ? prevista : '';
    $('cons-error').hidden = true;
    actualizarPunto();
    if (api && api.alCambiarFormulario) api.alCambiarFormulario(); // la distancia a quebradas puede haber cambiado
  }

  /**
   * «Solo cerca de mi punto» solo se puede elegir con un punto en el mapa. Con la casilla marcada, la distancia máxima pasa a
   * ser el radio del área alrededor del punto: se dice en la etiqueta y en la ayuda.
   */
  function actualizarPunto() {
    const hay = Boolean(api && api.obtenerPunto());
    const c = $('cons-punto');
    c.disabled = !hay;
    if (!hay) c.checked = false;
    const cerca = c.checked;
    $('cons-radio-l').textContent = cerca ? 'Radio alrededor de mi punto' : 'Distancia máxima';
    $('cons-punto-ayuda').textContent = !hay
      ? 'Disponible cuando eliges un punto en el mapa.'
      : cerca
        ? `Solo miro celdas dentro de ese radio (${Asistente.fmtDist(CONFIG.asistente.radioAreaM)} si no eliges uno). Los servicios se miden con la distancia de cada uno en la ficha.`
        : 'Limita la búsqueda a lo que rodea el punto que elegiste.';
  }

  /** Pone en los menús lo que se buscó (también cuando se pidió escribiendo: «agrega transporte», «prioriza el parque»…). */
  function sincronizarFormulario(b) {
    if (!b || !$('constructor-form')) return;
    const esColegio = (id) => id === 'colegio' || NIVELES.includes(id);
    const ids = new Set(b.criterios.map((c) => (esColegio(c.id) ? 'colegio' : c.id)));
    ids.delete('lejosQuebrada'); // no es una casilla: se elige con su propia distancia
    checks().forEach((c) => { c.checked = ids.has(c.value); });
    const nivel = b.criterios.find((c) => esColegio(c.id));
    $('cons-nivel').value = nivel && nivel.id !== 'colegio' ? nivel.id : 'colegio';
    actualizarFormulario();
    const lejos = b.criterios.find((c) => c.id === 'lejosQuebrada');
    $('cons-cauce').value = lejos && Asistente.OPCIONES.cauces.includes(lejos.umbralM) ? String(lejos.umbralM) : '';
    actualizarFormulario();
    const prio = b.criterios.find((c) => c.prioridad > 1);
    $('cons-prio').value = prio ? (esColegio(prio.id) ? 'colegio' : prio.id) : '';
    const radio = Asistente.OPCIONES.radios.includes(b.radioGlobalM) ? String(b.radioGlobalM ?? '') : '';
    $('cons-radio').value = radio;
    $('cons-cond').checked = Boolean(b.incluirCondicional);
  }

  function limpiarFormulario() {
    checks().forEach((c) => { c.checked = false; });
    $('cons-nivel').value = 'colegio';
    $('cons-radio').value = '';
    $('cons-cauce').value = '';
    $('cons-punto').checked = false;
    $('cons-cond').checked = false;
    actualizarFormulario();
  }

  function cerrarMulti({ devolverFoco = false } = {}) {
    const m = $('cons-que');
    if (!m.open) return;
    m.open = false;
    if (devolverFoco) m.querySelector('summary').focus();
  }

  function iniciarConstructor() {
    const casilla = (o) => `<label class="check multi-op"><input type="checkbox" name="cons-criterio" value="${o.id}"><span>${esc(o.etiqueta)}</span></label>`;
    $('cons-servicios').innerHTML = Asistente.OPCIONES.servicios.map(casilla).join('');
    $('cons-zonas').innerHTML = Asistente.OPCIONES.zonas.map(casilla).join('');
    $('cons-nivel').innerHTML = Asistente.OPCIONES.niveles.map((n) => `<option value="${n.id}">${esc(n.etiqueta)}</option>`).join('');
    $('cons-radio').innerHTML = Asistente.OPCIONES.radios.map((m) => `<option value="${m ?? ''}">${esc(etiquetaRadio(m))}</option>`).join('');
    $('cons-cauce').innerHTML = Asistente.OPCIONES.cauces.map((m) => `<option value="${m ?? ''}">${m === null ? 'No me importa' : `A más de ${m < 1000 ? `${m} m` : '1 km'}`}</option>`).join('');
    $('presets').innerHTML = Asistente.PRESETS.map((p) => `<button type="button" class="ghost" data-preset="${p.id}">${esc(p.etiqueta)}</button>`).join('');
    actualizarFormulario();

    const form = $('constructor-form');
    form.addEventListener('change', actualizarFormulario);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = Asistente.construirConsulta(leerFormulario());
      if (q.tipo !== 'buscar') {
        $('cons-error').textContent = 'Elige al menos un servicio, un tipo de zona o una distancia a quebradas para buscar.';
        $('cons-error').hidden = false;
        $('cons-que').open = true;
        $('cons-que').querySelector('summary').focus();
        return;
      }
      $('constructor').open = false;
      $('constructor').querySelector('summary').focus();
      enviarConsulta(q);
    });
    $('cons-limpiar').addEventListener('click', limpiarFormulario);
    $('presets').addEventListener('click', (e) => {
      const b = e.target.closest('[data-preset]');
      const preset = b && Asistente.PRESETS.find((p) => p.id === b.dataset.preset);
      if (!preset) return;
      const q = Asistente.construirConsulta(preset.consulta);
      sincronizarFormulario({ criterios: q.criterios, radioGlobalM: q.radioGlobalM, incluirCondicional: q.incluirCondicional });
      $('constructor').open = false;
      enviarConsulta(q);
    });

    // El desplegable de varias opciones se cierra con Escape (sin cerrar todo el asistente) y al tocar fuera.
    $('cons-que').addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('cons-que').open) { e.stopPropagation(); cerrarMulti({ devolverFoco: true }); }
    });
    $('cons-que').addEventListener('toggle', () => {
      $('cons-que').querySelector('summary').setAttribute('aria-expanded', String($('cons-que').open));
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#cons-que')) cerrarMulti(); });
  }

  // ------------------------------------------------------------------- Activar

  /** Se llama al entrar al espacio de trabajo: saluda una sola vez y averigua el modo (Gemini o reglas). */
  function activar() {
    if (!saludado) {
      saludado = true;
      mensaje('asistente', { ...Asistente.responder({ tipo: 'saludo', criterios: [] }, {}), explicacion: Asistente.explicar('saludo') }); // trae sus sugerencias
    }
    actualizarPunto(); // el punto pudo cambiar desde la última vez
    verificarModo();
  }

  function iniciar(opciones) {
    api = opciones;
    iniciarConstructor();

    $('asistente-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const campo = $('asistente-texto');
      const t = campo.value;
      campo.value = '';
      enviar(t);
      campo.focus();
    });

    // Un solo oyente para los botones de los mensajes (sugerencias, «Ver en el mapa» y «Consultar ese punto»).
    $('asistente-log').addEventListener('click', (e) => {
      const b = e.target.closest('[data-accion]');
      if (!b) return;
      const { accion } = b.dataset;
      if (accion === 'sugerir') { enviar(b.dataset.texto); return; }
      if (accion === 'mapa') { if (api.mostrarMapa) api.mostrarMapa(); return; }
      if (accion === 'detalle') { api.abrirFicha(); return; }
      if (accion === 'guardar') { mensaje('asistente', { texto: api.guardarParaComparar() }); return; }
      if (accion === 'verificar') { mensaje('asistente', { texto: Resumen.verificar(Verificaciones.ITEMS), botones: [{ accion: 'verificar-ficha', etiqueta: 'Ver el detalle de cada trámite' }] }); return; }
      if (accion === 'verificar-ficha') { api.abrirVerificaciones(); return; }
      const lat = Number(b.dataset.lat);
      const lon = Number(b.dataset.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      if (accion === 'ver') {
        if (api.mostrarMapa) api.mostrarMapa(); // en el móvil o con el chat ampliado el mapa no está a la vista
        if (!(b.dataset.n && api.verSector && api.verSector(Number(b.dataset.n)))) api.map.setView([lat, lon], 15, { animate: false });
      } else if (accion === 'consultar') {
        api.consultarPunto(lat, lon, b.dataset.nombre ? `Punto en ${b.dataset.nombre}` : null);
      }
    });
  }

  /** El punto elegido, resumido en palabras llanas, con los botones para seguir desde el chat (ver el detalle, guardar y qué verificar). */
  function publicarPunto(r) {
    recordar('asistente', r.texto);
    mensaje('asistente', {
      texto: [...r.lineas, r.aviso].join('\n'),
      explicacion: Asistente.explicar('ficha'),
      botones: [
        { accion: 'detalle', etiqueta: 'Ver detalle técnico' },
        { accion: 'guardar', etiqueta: 'Guardar para comparar' },
        { accion: 'verificar', etiqueta: '¿Qué debo verificar antes de comprar?' },
      ],
    });
  }

  return { iniciar, activar, rutasParaViaje, paradasParaViaje, centroUrbanoDistrito, datosParaMapa, distanciaQuebradaM, publicarPunto };
})();
