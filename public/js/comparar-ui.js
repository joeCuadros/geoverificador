/**
 * comparar-ui.js — Vista de «Comparar puntos»: botón «Guardar para comparar», contador de la barra superior y el diálogo
 * con la tabla de las 5 variables. Las decisiones (guardar hasta 3, qué cumple las prioridades) están en comparar.js.
 * Aquí solo se dibuja y se guarda en localStorage con try/catch (si falla, todo sigue funcionando en memoria).
 * No hay puntaje global: el diálogo solo resalta qué punto cumple las variables que la persona marcó como prioridad.
 * INFORMATIVO (quebradas, peligros y sismos) no tiene umbral normativo: solo la cercanía a quebradas pasa a cumple / no cumple,
 * y únicamente con el umbral de «Mis umbrales» de la persona; peligros y sismos son filas de contexto, nunca prioridad.
 */
const CompararUI = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icono = (id, extra = '') => `<svg class="ico${extra ? ` ${extra}` : ''}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const almacen = () => { try { return window.localStorage; } catch (err) { return null; } };

  const ESTADO_UI = {
    CUMPLE: { clase: 'cumple', ico: 'cumple', texto: 'Cumple' },
    'NO CUMPLE': { clase: 'nocumple', ico: 'nocumple', texto: 'No cumple' },
    'SIN DATO': { clase: 'sindato', ico: 'sindato', texto: 'Sin dato' },
    PARCIAL: { clase: 'parcial', ico: 'parcial', texto: 'Parcial' },
    INFORMATIVO: { clase: 'informativo', ico: 'info', texto: 'Informativo' },
  };
  const estadoHtml = (estado, texto = null) => {
    const u = ESTADO_UI[estado] || ESTADO_UI['SIN DATO'];
    return `<span class="estado ${u.clase}">${icono(u.ico)}${esc(texto || u.texto)}</span>`;
  };
  // Para Colegio por nivel: un icono pequeño y el texto del estado solo para lectores de pantalla.
  const miniEstado = (estado) => {
    const u = ESTADO_UI[estado] || ESTADO_UI['SIN DATO'];
    return `<span class="mini-estado ${u.clase}">${icono(u.ico)}<span class="sr-only">${u.texto}</span></span>`;
  };

  let api = null; // { punto(), candidatoActual(), umbrales() }
  let candidatos = [];
  let prioridades = [];
  let armado = false;

  const umbrales = () => (api && api.umbrales ? api.umbrales() : null);
  const tituloDe = (id) => Comparar.VARIABLES.find((v) => v.id === id).titulo;
  const listaTexto = (ids) => ids.map(tituloDe).join(', ');
  const nombreCorto = (c) => (c.etiqueta.length > 38 ? `${c.etiqueta.slice(0, 36)}…` : c.etiqueta);

  function decir(texto) {
    const el = $('guardar-estado');
    el.textContent = '';
    setTimeout(() => { el.textContent = texto; }, 40);
  }

  // ------------------------------------------------------------ Botón y contador

  function actualizarContador() {
    const n = candidatos.length;
    $('comparar-contador').hidden = n === 0;
    $('comparar-contador').textContent = String(n);
    $('comparar-contador-sr').textContent = n === 0 ? '' : ` (${n} ${n === 1 ? 'punto guardado' : 'puntos guardados'})`;
  }

  /** Estado del botón del reporte: guardar, quitar, o esperar a que termine la consulta. Lo llama app.js al cambiar el reporte. */
  function actualizarBoton() {
    const btn = $('btn-guardar');
    const txt = $('btn-guardar-texto');
    const p = api && api.punto();
    if (!p) { btn.disabled = true; return; }
    if (Comparar.estaGuardado(candidatos, p.lat, p.lon)) {
      txt.textContent = 'Quitar de la comparación';
      btn.disabled = false;
      btn.dataset.modo = 'quitar';
    } else if (candidatos.length >= Comparar.MAX_CANDIDATOS) {
      txt.textContent = `Comparación llena (${candidatos.length} de ${Comparar.MAX_CANDIDATOS})`;
      btn.disabled = true;
      btn.dataset.modo = 'lleno';
    } else if (!api.candidatoActual()) {
      txt.textContent = 'Calculando los datos…';
      btn.disabled = true;
      btn.dataset.modo = 'espera';
    } else {
      txt.textContent = `Guardar para comparar (${candidatos.length}/${Comparar.MAX_CANDIDATOS})`;
      btn.disabled = false;
      btn.dataset.modo = 'guardar';
    }
  }

  function persistir() {
    Comparar.guardarCandidatos(almacen(), candidatos);
    actualizarContador();
    actualizarBoton();
    if ($('comparar').open) render();
  }

  function alPulsarGuardar() {
    const p = api.punto();
    if (!p) return;
    if ($('btn-guardar').dataset.modo === 'quitar') {
      const c = candidatos.find((x) => Comparar.estaGuardado([x], p.lat, p.lon));
      candidatos = Comparar.quitar(candidatos, c.id);
      persistir();
      decir('Punto quitado de la comparación.');
      return;
    }
    const r = Comparar.agregar(candidatos, api.candidatoActual());
    if (!r.ok) {
      decir(r.motivo === 'lleno' ? 'Ya guardaste 3 puntos. Quita uno en «Comparar» para guardar otro.' : r.motivo === 'repetido' ? 'Ese punto ya está guardado.' : 'Espera a que termine la consulta.');
      return;
    }
    candidatos = r.lista;
    persistir();
    decir(`Punto guardado. Tienes ${candidatos.length} de ${Comparar.MAX_CANDIDATOS}. Ábrelos con «Comparar» en la barra superior.`);
  }

  // ------------------------------------------------------------------- Diálogo

  function prioridadesHtml() {
    return Comparar.VARIABLES.map((v) => `<label class="check prioridad-op"><input type="checkbox" name="prioridad" value="${v.id}"${prioridades.includes(v.id) ? ' checked' : ''}><span><strong>${esc(v.titulo)}</strong><small>${esc(v.ayuda)}</small></span></label>`).join('');
  }

  function resumenTexto() {
    if (candidatos.length === 0) return '';
    if (prioridades.length === 0) return 'Marca tus prioridades para ver qué punto las cumple. Sin prioridades no se resalta ningún punto.';
    const sinUmbral = prioridades.includes('quebradas') && !(umbrales() && umbrales().quebradaMinM);
    const aviso = sinUmbral ? ' Marcaste «Quebradas y cauces» pero no fijaste tu distancia mínima: sin ella solo es informativo y no se puede confirmar. Fíjala en «Mis umbrales», en la tarjeta de quebradas del reporte.' : '';
    const ganan = candidatos.filter((c) => Comparar.quienesCumplen(candidatos, prioridades, umbrales()).includes(c.id));
    if (ganan.length === 0) return `Ningún punto cumple todas tus prioridades. Revisa en la tabla cuál se acerca más.${aviso}`;
    return (ganan.length === 1
      ? `Cumple todas tus prioridades: «${nombreCorto(ganan[0])}».`
      : `Cumplen todas tus prioridades: ${ganan.map((c) => `«${nombreCorto(c)}»`).join(', ')}.`) + aviso;
  }

  /** Pares de puntos donde uno cumple todo lo que cumple el otro y algo más. Nunca se nombra un ganador. */
  function dominanciaHtml() {
    const pares = Comparar.dominancias(candidatos, prioridades, umbrales());
    if (pares.length === 0) return '';
    const nombre = (id) => `«${esc(nombreCorto(candidatos.find((c) => c.id === id)))}»`;
    const items = pares.map((d) => `<li>${nombre(d.mayor)} cumple todas las prioridades que cumple ${nombre(d.menor)} y además: ${esc(listaTexto(d.extra))}.</li>`).join('');
    return `<ul>${items}</ul><p class="small muted">Es una comparación entre dos puntos según tus prioridades, no un veredicto: lo que no mide esta herramienta (precio, seguridad, ruido, el estado real del predio) también cuenta.</p>`;
  }

  function chipResultado(ev) {
    if (ev.resultado === 'sin-prioridades') return '';
    if (ev.resultado === 'cumple') return `<span class="res-prio cumple">${icono('cumple')}Cumple tus ${ev.total === 1 ? 'prioridad' : `${ev.total} prioridades`}</span>`;
    if (ev.resultado === 'incompleto' && ev.informativas.length > 0 && ev.sinDato.length === 0) return `<span class="res-prio informativo">${icono('info')}Falta tu umbral en: ${esc(listaTexto(ev.informativas))}</span>`;
    if (ev.resultado === 'no-cumple') return `<span class="res-prio nocumple">${icono('nocumple')}Cumple ${ev.cumplen.length} de ${ev.total}. No cumple: ${esc(listaTexto(ev.noCumplen))}</span>`;
    return `<span class="res-prio sindato">${icono('sindato')}Falta dato en: ${esc(listaTexto([...ev.sinDato, ...ev.informativas]))}</span>`;
  }

  // La tabla (escritorio) y las tarjetas (móvil, hasta 480 px) se dibujan con las mismas filas de Comparar.filas.
  function partesHtml(cel) {
    const texto = (p) => (p.url && /^https?:\/\//.test(p.url) ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.texto)}<span class="sr-only"> (se abre en una pestaña nueva)</span></a>` : esc(p.texto));
    return cel.partes.map((p) => `<p class="celda-parte">${p.etiqueta ? `${miniEstado(p.estado)}<span class="celda-nivel">${esc(p.etiqueta)}</span> ` : ''}${texto(p)}</p>`).join('');
  }

  function celdaHtml(cel, prioritaria) {
    return `<td class="${cel.mejor ? 'mejor' : ''}${prioritaria ? ' prioritaria' : ''}">${estadoHtml(cel.estado)}${partesHtml(cel)}</td>`;
  }

  const textoContexto = 'Contexto de riesgo (informativo): no es una evaluación ni cuenta para tus prioridades';
  const textoMercado = 'Precio de oferta (informativo): promedio del distrito, no del inmueble; no cuenta para tus prioridades';
  const tagPrio =() => `<span class="tag-prio">${icono('estrella')}Tu prioridad</span>`;

  function tablaHtml(f, evals, ganan) {
    const cabeceras = candidatos.map((c, i) => `<th scope="col" class="col-punto${ganan.has(c.id) ? ' mejor' : ''}">
      <span class="punto-nombre">${esc(c.etiqueta)}</span>
      <span class="punto-det">${c.distrito ? `${esc(c.distrito)} · ` : ''}${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}</span>
      ${chipResultado(evals[i])}
      <button type="button" class="link" data-quitar="${esc(c.id)}" aria-label="Quitar «${esc(c.etiqueta)}» de la comparación">Quitar</button>
    </th>`).join('');
    const filas = f.variables.map((v) => `<tr${v.prioritaria ? ' class="prioritaria"' : ''}>
        <th scope="row"><span class="var-nombre-fila">${esc(v.titulo)}</span>${v.prioritaria ? tagPrio() : ''}</th>
        ${v.celdas.map((cel) => celdaHtml(cel, v.prioritaria)).join('')}
      </tr>`).join('');
    const filasContexto = f.contexto.map((v) => `<tr class="fila-contexto">
        <th scope="row"><span class="var-nombre-fila">${esc(v.titulo)}</span></th>
        ${v.celdas.map((cel) => celdaHtml(cel, false)).join('')}
      </tr>`).join('');
    const filasMercado = f.mercado.map((v) => `<tr class="fila-contexto">
        <th scope="row"><span class="var-nombre-fila">${esc(v.titulo)}</span></th>
        ${v.celdas.map((cel) => celdaHtml(cel, false)).join('')}
      </tr>`).join('');
    return `<table class="tabla-comparar" style="--cols:${candidatos.length}">
      <caption class="sr-only">Comparación de ${candidatos.length} ${candidatos.length === 1 ? 'punto' : 'puntos'}. Cada celda indica el estado, la distancia en línea recta y la distancia de referencia (ref.). Las últimas filas son contexto de riesgo y precio de oferta del distrito, solo informativos.</caption>
      <thead><tr><td class="esquina"><span class="sr-only">Variable</span></td>${cabeceras}</tr></thead>
      <tbody>${filas}</tbody>
      <tbody class="contexto-filas">
        <tr class="sep"><th scope="colgroup" colspan="${candidatos.length + 1}">${textoContexto}</th></tr>
        ${filasContexto}
      </tbody>
      <tbody class="contexto-filas">
        <tr class="sep"><th scope="colgroup" colspan="${candidatos.length + 1}">${textoMercado}</th></tr>
        ${filasMercado}
      </tbody>
    </table>`;
  }

  /** Móvil: una tarjeta por punto (nombre, resultado, quitar) y una tarjeta por variable con los puntos apilados. */
  function cartasHtml(f, evals, ganan) {
    const puntos = candidatos.map((c, i) => `<article class="carta-punto${ganan.has(c.id) ? ' mejor' : ''}">
        <h3 class="punto-nombre">${esc(c.etiqueta)}</h3>
        <p class="punto-det">${c.distrito ? `${esc(c.distrito)} · ` : ''}${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}</p>
        ${chipResultado(evals[i])}
        <button type="button" class="link" data-quitar="${esc(c.id)}" aria-label="Quitar «${esc(c.etiqueta)}» de la comparación">Quitar</button>
      </article>`).join('');
    const nombreDe = (id) => esc(nombreCorto(candidatos.find((c) => c.id === id)));
    const tarjeta = (v) => `<section class="carta-var${v.prioritaria ? ' prioritaria' : ''}" aria-labelledby="cv-${v.id}">
        <h3 id="cv-${v.id}">${esc(v.titulo)}${v.prioritaria ? tagPrio() : ''}</h3>
        <ul>${v.celdas.map((cel) => `<li class="${cel.mejor ? 'mejor' : ''}"><span class="carta-quien">${nombreDe(cel.candidatoId)}</span>${estadoHtml(cel.estado)}${partesHtml(cel)}</li>`).join('')}</ul>
      </section>`;
    return `<h3 class="carta-sep">Puntos guardados</h3>${puntos}
      <h3 class="carta-sep">Comparación por variable</h3>${f.variables.map(tarjeta).join('')}
      <h3 class="carta-sep">${textoContexto}</h3>${f.contexto.map(tarjeta).join('')}
      <h3 class="carta-sep">${textoMercado}</h3>${f.mercado.map(tarjeta).join('')}`;
  }

  function render() {
    const hay = candidatos.length > 0;
    $('prioridades-lista').innerHTML = prioridadesHtml();
    $('comparar-vacio').hidden = hay;
    $('comparar-tabla-wrap').hidden = !hay;
    $('comparar-pista').hidden = candidatos.length < 2;
    $('comparar-limpiar').hidden = !hay;
    $('comparar-resumen').textContent = resumenTexto();
    $('comparar-resumen').hidden = !hay;
    const dom = hay ? dominanciaHtml() : '';
    $('comparar-dominancia').innerHTML = dom;
    $('comparar-dominancia').hidden = dom === '';
    $('comparar-cartas').hidden = !hay;
    if (hay) {
      const f = Comparar.filas(candidatos, prioridades, umbrales());
      const evals = candidatos.map((c) => Comparar.evaluarPrioridades(c, prioridades, umbrales()));
      const ganan = new Set(Comparar.quienesCumplen(candidatos, prioridades, umbrales()));
      $('comparar-tabla-wrap').innerHTML = tablaHtml(f, evals, ganan);
      $('comparar-cartas').innerHTML = cartasHtml(f, evals, ganan);
    } else {
      $('comparar-tabla-wrap').innerHTML = '';
      $('comparar-cartas').innerHTML = '';
    }
    const fechas = [...new Set(candidatos.map((c) => c.fechaDatos).filter(Boolean))];
    $('comparar-fuente').textContent = hay
      ? `Zonificación: plano del PDM Arequipa 2016-2025. Salud: RENIPRESS (SUSALUD). Colegios: padrón de ESCALE (MINEDU). OpenStreetMap, de respaldo en ambos y para paraderos y áreas verdes${fechas.length ? `, datos del ${fechas.join(' y del ')}` : ''}. Líneas de transporte: recorridos de SmartBus (smartbus.app), sin frecuencias ni horarios. Quebradas: cauces de la ANA, el IGP y OpenStreetMap (ODbL; cada celda dice su fuente). Peligros geológicos: INGEMMET. Sismos: IGP. Precio de oferta del distrito: Aptología (CC BY 4.0), precios de avisos y no de cierre. Distancias en línea recta. Esta tabla muestra lo que la herramienta calculó y es referencial; lo que tú debes comprobar (certificados, partida registral, servicios, peligros) está en «Verificaciones recomendadas antes de comprar», en el reporte.`
      : '';
  }

  function abrir() {
    render();
    const d = $('comparar');
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    $('comparar-h').focus();
  }

  function cerrar() {
    const d = $('comparar');
    if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
  }

  /**
   * api: { punto(): {lat, lon} | null, candidatoActual(): candidato listo para guardar | null }
   * Los puntos y las prioridades guardados antes se recuperan de localStorage (si hay).
   */
  function iniciar(opciones) {
    if (armado) return;
    armado = true;
    api = opciones;
    candidatos = Comparar.leerCandidatos(almacen());
    prioridades = Comparar.leerPrioridades(almacen());
    actualizarContador();

    $('comparar-btn').addEventListener('click', abrir);
    $('comparar-cerrar').addEventListener('click', cerrar);
    $('comparar-ok').addEventListener('click', cerrar);
    $('comparar').addEventListener('click', (e) => { if (e.target === $('comparar')) cerrar(); });
    $('btn-guardar').addEventListener('click', alPulsarGuardar);

    $('prioridades-lista').addEventListener('change', (e) => {
      if (e.target.name !== 'prioridad') return;
      prioridades = Comparar.alternar(prioridades, e.target.value);
      Comparar.guardarPrioridades(almacen(), prioridades);
      render();
      const foco = document.querySelector(`#prioridades-lista input[value="${e.target.value}"]`);
      if (foco) foco.focus(); // el redibujado reemplaza la casilla: se devuelve el foco a la misma
    });
    const alQuitar = (e) => {
      const b = e.target.closest('[data-quitar]');
      if (!b) return;
      candidatos = Comparar.quitar(candidatos, b.dataset.quitar);
      persistir();
      if (candidatos.length === 0) $('comparar-ok').focus(); else $('comparar-h').focus();
    };
    $('comparar-tabla-wrap').addEventListener('click', alQuitar);
    $('comparar-cartas').addEventListener('click', alQuitar);
    $('comparar-limpiar').addEventListener('click', () => {
      candidatos = [];
      persistir();
      $('comparar-ok').focus();
    });
    actualizarBoton();
  }

  /** Vuelve a dibujar el diálogo si está abierto (por ejemplo, tras cambiar «Mis umbrales»). */
  function refrescar() {
    actualizarBoton();
    if ($('comparar').open) render();
  }

  return { iniciar, actualizarBoton, refrescar, abrir };
})();
