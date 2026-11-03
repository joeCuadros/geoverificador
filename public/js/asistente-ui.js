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
  function mensaje(rol, { texto, filas = [], sugerencias = [], espera = false, explicacion = null, detalle = [], verMapa = false }) {
    const log = $('asistente-log');
    const el = document.createElement('div');
    el.className = `chat-msg chat-${rol}`;
    if (espera) el.dataset.espera = 'true';
    const quien = rol === 'usuario' ? 'Tú: ' : 'Asistente: ';
    el.innerHTML = `<span class="sr-only">${quien}</span><div class="chat-burbuja">${rol === 'usuario' ? `<p>${esc(texto)}</p>` : textoAHtml(texto)}${filas.length ? `<ol class="chat-filas">${filas.map(filaHtml).join('')}</ol>` : ''}${masHtml(explicacion, detalle)}</div>`
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
    const ctx = { ...base, punto: { lat: p.lat, lon: p.lon }, distrito: dis ? dis.distrito : null, zona, entorno, cauce: riesgo.quebradas, sismos: riesgo.sismos, peligros: riesgo.peligros };
    cacheContexto = { clave, ctx };
    return ctx;
  }

  // -------------------------------------------------------------------- Búsqueda

  /** Ordena los archivos congelados y el plano una sola vez; si falta equipamiento, no se puede buscar. */
  function preparar() {
    if (!preparado) {
      preparado = (async () => {
        const [zonas, congelados, , cauces] = await Promise.all([Zonificacion.zonas(), Equipamiento.datosCongelados(), Distritos.load().catch(() => null), Contexto.cauces().catch(() => null)]); // el tercero (distritos) solo se precarga
        if (!congelados) throw new Error('Faltan los archivos de equipamiento de OpenStreetMap (public/data/equipamiento); sin ellos no puedo buscar zonas.');
        const datos = Asistente.prepararDatos({
          salud: congelados.salud.features, educacion: congelados.educacion.features, transporte: congelados.transporte.features, areasVerdes: congelados.areasVerdes.features,
          cauces: cauces ? cauces.lista : [],
        }, zonas, umbrales());
        return { zonas, datos, fecha: congelados.salud.fecha, hayCauces: Boolean(cauces), cauces: cauces ? cauces.lista : null };
      })().catch((err) => { preparado = null; throw err; });
    }
    return preparado;
  }

  /** Los datos ya ordenados para dibujar entidades en el mapa (capas-ui.js). Los sismos son opcionales: sin archivo, la capa lo dice. */
  async function datosParaMapa() {
    const { zonas, datos, fecha, cauces } = await preparar();
    let sismos = null;
    try { sismos = Capas.sismosDeFeatures(await Contexto.sismosCrudos()); } catch (_) { sismos = null; }
    return { datos, zonas, cauces, sismos, umbrales: umbrales(), fecha };
  }

  /** Lo que el chat necesita para hablar de un distrito: sus polígonos, el conteo o el perfil y la fecha de los datos. */
  async function contextoDistrito(intencion) {
    const base = { estadoPDM: CONFIG.estadoPDM, potencial: Zonificacion.potencial, punto: api.obtenerPunto(), distritoTitulo: Distritos.titulo(intencion.distrito) };
    if (intencion.distritoFuera) return base;
    await Distritos.load();
    const { zonas, datos, fecha, cauces } = await preparar();
    const polys = Distritos.poligonos(intencion.distrito);
    const opciones = { areaMinM2: CONFIG.umbrales.areaVerde.areaMinM2 };
    if (intencion.tipo === 'contar') return { ...base, fecha, conteo: Entidades.contar(datos, polys, opciones) };
    return { ...base, fecha, perfil: Entidades.perfil(datos, zonas, cauces, polys, { ...opciones, pasoM: 300 }) };
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
        mensaje('asistente', { texto: 'No pude leer el archivo de quebradas de la ANA, así que no puedo buscar «lejos de quebradas» sin inventar datos. Prueba con los demás criterios.', explicacion: Asistente.explicar('quebrada') });
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
      const reglas = () => Asistente.interpretar(limpio, { hayPunto, ultimaBusqueda });
      let eleccion = { origen: 'reglas', intencion: null };
      if (hayLLM() && llmDisponible !== false) {
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
      if (intencion.tipo === 'buscar') await ejecutarBusqueda(intencion);
      else {
        const esDistrito = ['contar', 'perfil'].includes(intencion.tipo) && intencion.distrito;
        const conPunto = ['ficha', 'servicio', 'zona', 'construir', 'quebrada', 'sismos', 'peligros'].includes(intencion.tipo);
        const ctx = esDistrito ? await contextoDistrito(intencion) : conPunto ? await contexto() : { estadoPDM: CONFIG.estadoPDM, potencial: Zonificacion.potencial, punto: api.obtenerPunto() };
        const resp = Asistente.responder(intencion, ctx);
        let texto = resp.texto;
        // Gemini only rewords the deterministic answer; the text is verified (numbers, names, caveat) or discarded.
        // The profile and the «what matters to you?» question keep their exact structure (buttons and closing question), so they are not reworded.
        if (eleccion.origen === 'gemini' && texto && !['perfil', 'mejor_zona'].includes(intencion.tipo)) {
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

  return { iniciar, activar, datosParaMapa, distanciaQuebradaM };
})();
