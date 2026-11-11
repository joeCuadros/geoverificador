/**
 * reporte.js — Ficha del predio en PDF.
 *
 * Arma un informe legible con los mismos datos que muestra la aplicación (sin calcular nada nuevo) y abre el diálogo
 * de impresión del navegador, donde se elige «Guardar como PDF». Así no hace falta ninguna librería: el diseño del
 * informe está en las reglas @media print de styles.css.
 *
 * Incluye las variables del alcance: zonificación vigente, zonificación proyectada, salud, educación, transporte y
 * área verde, más quebradas y cauces (INFORMATIVO, o cumple / no cumple «según tu umbral» si la persona fijó el suyo), el
 * contexto de riesgo (peligros geológicos y sismos, siempre informativo), el precio de oferta por m² del distrito (informativo) y las verificaciones recomendadas antes de comprar
 * (lo que la herramienta calculó frente a lo que la persona debe comprobar; las URL se imprimen como texto). Los módulos fuera de alcance (peligros, zona sísmica, denuncias, registro de riesgos) solo aparecen si
 * están activos (`d.modulos`, ver CONFIG.modulos y ?modulos=todos); con los módulos ocultos el informe no los menciona.
 *
 * Recibe un objeto `d` con lo que ya calculó app.js (ver app.js, datosReporte). Las funciones que arman el HTML de cada
 * sección son puras (no tocan el DOM) y se prueban en test/reporte.spec.ts; solo `imprimir` usa document y window.
 */
const Reporte = (() => {
  const RT = typeof Rutas !== 'undefined' ? Rutas : require('./rutas.js'); // eslint-disable-line no-undef
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Math.round(n).toLocaleString('es-PE');
  const dist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2).replace('.', ',')} km`);
  const coma = (n) => String(n).replace('.', ',');
  const fila = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const P = typeof Precios !== 'undefined' ? Precios : require('./precios.js'); // eslint-disable-line no-undef
  const CALC = typeof Calculos !== 'undefined' ? Calculos : require('./calculos.js'); // eslint-disable-line no-undef
  const NIVELES = ['inicial', 'primaria', 'secundaria'];
  const nombreNivel = (n) => n[0].toUpperCase() + n.slice(1);

  function seccion(titulo, color, cuerpo, fuente) {
    return `
      <section class="rp-sec${titulo.includes('Verificaciones') ? ' rp-largo' : ''}" style="--rp-c:${color}">
        <h2>${esc(titulo)}</h2>
        ${cuerpo}
        ${fuente ? `<p class="rp-fuente">Fuente: ${esc(fuente)}</p>` : ''}
      </section>`;
  }

  // ------------------------------------------------------------ V1a y V1b: zonificación
  function zonificacion(d) {
    let html = '';
    if (d.zonaStatus === 'outside') html += '<p>El punto está <strong>fuera del área zonificada</strong> del plano: no tiene zona asignada.</p>';
    else if (d.zonaStatus !== 'ok') html += '<p class="rp-muted">No se pudo consultar la zonificación.</p>';
    else {
      const z = d.zona;
      const r = z.regla || {};
      const b = z.borde;
      if (b && b.alerta) {
        html += `<p class="rp-alerta">Punto cerca del borde de la zona: a ${dist(b.distanciaM)} en línea recta hay otra zona (${esc(b.codigo)}). Cerca de un borde el resultado puede no ser exacto; confirma la zona con el certificado municipal (aviso a ${b.umbralM} m o menos, convención del proyecto).</p>`;
      }
      const filas = [
        fila('Zona', `<strong>${esc(z.codigo)}</strong> · ${esc(r.nombre || 'código sin reglas en la tabla')}`),
        fila('Condición', esc(d.badgeZona || '—')),
      ];
      const has = (v) => v !== null && v !== undefined && v !== '';
      const bm = (a, b2) => (has(b2) && b2 !== a ? `${a} (hasta ${b2})` : `${a}`);
      if (has(r.pisos_base)) filas.push(fila('Pisos', esc(bm(r.pisos_base, r.pisos_max))));
      if (has(r.coef_base)) filas.push(fila('Coeficiente de edificación', esc(bm(r.coef_base, r.coef_max))));
      if (has(r.area_libre_pct)) filas.push(fila('Área libre mínima', `${esc(r.area_libre_pct)} %`));
      if (has(r.lote_min_m2)) filas.push(fila('Lote mínimo', `${num(r.lote_min_m2)} m²`));
      if (has(r.frente_min_m)) filas.push(fila('Frente mínimo', `${esc(r.frente_min_m)} m`));
      let calc = '';
      if (d.lote && d.potencial) {
        const [b0, m] = d.potencial.construible;
        calc = `<p class="rp-destacado">Con un lote de ${num(d.lote)} m²: <strong>hasta ${num(b0)} m² techados</strong>${m > b0 ? ` (${num(m)} m² en el caso máximo)` : ''}${d.potencial.ocupable ? `; el primer piso puede ocupar ${d.potencial.ocupable[0] === d.potencial.ocupable[1] ? `hasta ${num(d.potencial.ocupable[1])}` : `entre ${num(d.potencial.ocupable[0])} y ${num(d.potencial.ocupable[1])}`} m²` : ''}.${d.potencial.bajoLoteMinimo ? ' El lote es menor que el mínimo de la zona.' : ''}</p>`;
      } else if (d.lote) {
        calc = '<p class="rp-muted">No se calculan m² construibles: la zona no fija un coeficiente o no es construible.</p>';
      }
      html += `<table class="rp-tabla">${filas.join('')}</table><p class="rp-nota">Parámetros del Reglamento del PDM Arequipa 2016-2025, Título III${r.articulo ? ` (${esc(r.articulo)})` : ''}.</p>${r.nota ? `<p class="rp-nota">${esc(r.nota)}</p>` : ''}${calc}`;
    }
    // V1b: solo texto, y solo si hay fuente y fecha (d.avisoPDM es null en caso contrario).
    if (d.avisoPDM) {
      const a = d.avisoPDM;
      html += `<p class="rp-destacado"><strong>Zonificación proyectada (PDM nuevo).</strong> ${esc(a.texto)} <span class="rp-muted">Fuente: ${esc(a.fuente)}, ${esc(a.fecha)}${a.url ? ` · ${esc(a.url)}` : ''}. Nota de prensa, no un documento oficial.</span></p>`;
    }
    return html;
  }

  // ------------------------------------------------------- V2 a V5: servicios
  const ESTADO_CLS = { CUMPLE: 'rp-bajo', 'SIN DATO': 'rp-medio', 'NO CUMPLE': 'rp-alto', INFORMATIVO: 'rp-info' };
  const estado = (e) => `<span class="rp-niv ${ESTADO_CLS[e] || 'rp-medio'}">${esc(e)}</span>`;
  const estadoHtml = estado;
  const fuenteDe = (r) => `${r.fuente}${r.fecha ? `, datos extraídos el ${r.fecha}` : ''}`;
  const sinResultado = '<p class="rp-muted">No se calcularon los servicios cercanos.</p>';

  function filasDe(r, fuenteUmbral) {
    if (r.error) return [fila('Resultado', `No se pudo obtener el dato: ${esc(r.error)}`)];
    const f = [fila('Estado', estado(r.estado))];
    if (r.nombre) f.push(fila('Más cercano', esc(r.nombre)));
    if (r.fuenteElemento) f.push(fila('Fuente del establecimiento', esc(CALC.textoFuenteElemento(r))));
    f.push(fila('Distancia', r.distanciaM === null ? 'Sin dato' : r.distanciaM === 0 ? 'El punto está dentro del área' : `${dist(r.distanciaM)} en línea recta`));
    f.push(fila('Umbral', `${dist(r.umbralM)} (${esc(fuenteUmbral)})`));
    return f;
  }

  function salud(d) {
    const r = d.variables && d.variables.salud;
    if (!r) return sinResultado;
    return `<table class="rp-tabla">${filasDe(r, d.fuentesUmbral.salud).join('')}</table><p class="rp-nota">${esc(r.metodo)}</p>`;
  }

  /** Consultorio médico más cercano: categoría aparte de la salud, INFORMATIVA (sin umbral, sin cumple / no cumple). */
  function consultorio(d) {
    const r = d.variables && d.variables.consultorio;
    if (!r) return '';
    if (r.error) return `<table class="rp-tabla">${fila('Resultado', `No se pudo obtener el dato: ${esc(r.error)}`)}</table>`;
    const filas = [fila('Estado', r.estado === 'SIN DATO' ? estado('SIN DATO') : estado('INFORMATIVO'))];
    if (r.nombre) filas.push(fila('Más cercano', esc(r.nombre)));
    if (r.fuenteElemento) filas.push(fila('Fuente del establecimiento', esc(CALC.textoFuenteElemento(r))));
    filas.push(fila('Distancia', r.distanciaM === null ? 'Sin dato' : r.distanciaM === 0 ? 'El punto está dentro del área' : `${dist(r.distanciaM)} en línea recta`));
    return `<table class="rp-tabla">${filas.join('')}</table><p class="rp-nota">${esc(CALC.NOTA_CONSULTORIO)} ${esc(r.metodo)}</p>`;
  }

  /**
   * Las tres necesidades de comercio más cercanas (abastecimiento, compras y ocio, comercio de barrio): INFORMATIVAS (sin umbral, sin cumple / no cumple),
   * una tabla por necesidad. Del mall o la galería con polígono la distancia es al borde. Un mall confirmado con su fuente la cita; un supermercado dentro
   * de un mall dice en cuál está, y el abastecimiento trae además el mercado y el supermercado más cercanos.
   */
  function comercio(d) {
    const v = d.variables || {};
    const donde = (x) => (x.distanciaM === null ? 'Sin dato' : x.distanciaM === 0 ? 'El punto está dentro del terreno' : `${dist(x.distanciaM)} en línea recta${x.forma ? ' hasta su borde' : ''}`);
    const dentroDe = (x) => (x.dentroDeMall ? `dentro de ${esc(x.dentroDeMall.nombre || 'un mall')}` : '');
    const bloques = Object.entries(CALC.COMERCIO).filter(([id]) => v[id]).map(([id, def]) => {
      const r = v[id];
      if (r.error) return `<p class="rp-muted"><strong>${esc(def.etiqueta)}</strong></p><table class="rp-tabla">${fila('Resultado', `No se pudo obtener el dato: ${esc(r.error)}`)}</table>`;
      const filas = [fila(def.etiqueta, r.estado === 'SIN DATO' ? estado('SIN DATO') : estado('INFORMATIVO'))];
      if (r.nombre) {
        const tipo = r.tipo ? CALC.COMERCIO_TIPO[r.tipo].singular : '';
        filas.push(fila('Más cercano', `${esc(r.nombre)}${tipo ? ` (${esc(tipo)}${dentroDe(r) ? `, ${dentroDe(r)}` : ''})` : ''}`));
      }
      filas.push(fila('Distancia', donde(r)));
      if (r.osm) filas.push(fila('Fuente', `OpenStreetMap (${esc(r.osm)})`));
      if (r.verificado) filas.push(fila('Confirmado con', `${esc(r.verificado.nombre)}: ${esc(r.verificado.url)}`));
      if (def.tipos.length > 1 && r.porTipo) { // abastecimiento, finanzas, comida fuera: además el más cercano de cada tipo
        def.tipos.forEach((tipo) => {
          const x = r.porTipo[tipo];
          const nombre = CALC.COMERCIO_TIPO[tipo].singular;
          if (x && x.distanciaM !== null && x.nombre) filas.push(fila(`${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} más cercano`, `${esc(x.nombre)}${dentroDe(x) ? ` (${dentroDe(x)})` : ''} · ${donde(x)}`));
        });
      }
      return `<table class="rp-tabla">${filas.join('')}</table>`;
    });
    const metodo = Object.keys(CALC.COMERCIO).map((id) => v[id] && v[id].metodo).find(Boolean);
    return `${bloques.join('')}<p class="rp-nota">${esc(CALC.NOTA_COMERCIO)}${metodo ? ` ${esc(metodo)}` : ''}</p>`;
  }

  /**
   * Agua: el punto de acopio más cercano (directorio de SEDAPAR, datos de 2017), las interrupciones del servicio de agua del distrito (SUNASS) y lo que conviene pedir al
   * comprar. INFORMATIVA (sin umbral): ni el acopio ni las interrupciones dicen que el predio tenga o no tenga agua.
   */
  function agua(d) {
    const a = d.variables && d.variables.acopio;
    const i = d.variables && d.variables.interrupciones;
    const filas = [];
    if (a) {
      filas.push(fila('Punto de acopio de agua', a.estado === 'SIN DATO' ? estado('SIN DATO') : estado('INFORMATIVO')));
      if (a.estado !== 'SIN DATO') {
        filas.push(fila('Más cercano', `${esc(a.direccion || 'sin dirección')}${a.distrito ? ` (${esc(a.distrito)})` : ''}`));
        filas.push(fila('Distancia', `${dist(a.distanciaM)} en línea recta`));
        filas.push(fila('Puntos a 500 m / a 1 km', `${a.a500m} / ${a.a1000m}`));
        filas.push(fila('Datos de', `${esc(a.fechaDatos || '2017')} (directorio publicado el ${esc(a.fecha || 'sin fecha')})`));
      } else filas.push(fila('Resultado', esc(CALC.textoAcopio(a))));
    }
    if (i) {
      filas.push(fila('Interrupciones del servicio de agua', i.estado === 'SIN DATO' ? estado('SIN DATO') : estado('INFORMATIVO')));
      if (i.estado === 'SIN DATO' || !i.registros) filas.push(fila('Resultado', esc(CALC.textoInterrupciones(i))));
      else {
        const k = i.aniosCompletos;
        if (k.length) filas.push(fila(`Promedio por año completo (${k[0]} a ${k.at(-1)})`, `${i.promedioN} interrupciones · ${i.promedioHoras} horas`));
        if (i.total && i.periodo) filas.push(fila(`Todo el periodo (${esc(i.periodo.desde)} a ${esc(i.periodo.hasta)})`, `${i.total.n} interrupciones · ${Math.round(i.total.horas)} horas (${i.total.imprevistas} imprevistas, ${i.total.programadas} programadas)`));
        i.parciales.forEach((p) => filas.push(fila(`Año parcial ${p.anio}`, `${p.n} interrupciones · ${Math.round(p.horas)} horas`)));
      }
    }
    const notas = [a ? CALC.NOTA_ACOPIO : '', i ? CALC.NOTA_INTERRUPCIONES : ''].filter(Boolean).map((t) => `<p class="rp-nota">${esc(t)}</p>`).join('');
    const lista = `<p class="rp-nota"><strong>Si vas a comprar, lo que conviene pedir:</strong></p><ul class="rp-lista">${CALC.LISTA_COMPRADOR.map((x) => `<li>${esc(x.texto)}</li>`).join('')}</ul>`;
    return `<table class="rp-tabla">${filas.join('')}</table>${notas}${lista}`;
  }

  /**
   * Concesión minera: ¿el punto cae dentro de una concesión del Catastro Minero de INGEMMET? INFORMATIVA (sin umbral). Una concesión es un derecho a explorar y explotar los
   * minerales, separado del predio: no dice que haya minería ni de quién es el predio. No se guarda el nombre del titular.
   */
  function mineria(d) {
    const r = d.variables && d.variables.mineria;
    if (!r) return '';
    if (r.error) return `<table class="rp-tabla">${fila('Resultado', `No se pudo obtener el dato: ${esc(r.error)}`)}</table><p class="rp-nota">${esc(CALC.NOTA_MINERA)}</p>`;
    const filas = [fila('Estado', r.estado === 'SIN DATO' ? estado('SIN DATO') : estado('INFORMATIVO')), fila('Resultado', esc(CALC.textoMinera(r)))];
    if (r.dentro) {
      r.concesiones.forEach((c) => filas.push(fila(`Concesión ${esc(c.codigo)}`, `${esc(c.nombre)} · ${esc(c.estado)}${c.sustancia ? ` · ${esc(c.sustancia)}` : ''}${c.hectareas ? ` · ${Math.round(c.hectareas)} ha` : ''}${c.explotacion_o_exploracion ? ` · ${esc(c.explotacion_o_exploracion)}` : ''}`)));
    } else if (r.dentro === false && r.cercana) {
      filas.push(fila('Distancia al borde de la más cercana', `${dist(r.distanciaM)} en línea recta (${esc(r.cercana.nombre)}, ${esc(r.cercana.estado)})`));
    }
    return `<table class="rp-tabla">${filas.join('')}</table><p class="rp-nota">${esc(CALC.NOTA_MINERA)} ${esc(r.metodo || '')}</p>`;
  }

  /**
   * Electricidad: ¿el punto está dentro de un área de concesión de distribución eléctrica (SEAL u otra)? INFORMATIVA (sin umbral). Una concesión dice a
   * quién le corresponde el servicio; NO que el predio esté conectado, y la cobertura real de conexión vendría de un censo que el proyecto aún no tiene.
   */
  function electricidad(d) {
    const r = d.variables && d.variables.electricidad;
    if (!r) return '';
    if (r.error) return `<table class="rp-tabla">${fila('Resultado', `No se pudo obtener el dato: ${esc(r.error)}`)}</table><p class="rp-nota">${esc(CALC.NOTA_ELECTRICIDAD)}</p>`;
    const filas = [fila('Estado', r.estado === 'SIN DATO' ? estado('SIN DATO') : estado('INFORMATIVO'))];
    if (r.dentro !== null) {
      filas.push(fila('Resultado', esc(CALC.textoElectricidad(r))));
      if (r.dentro) {
        r.concesiones.forEach((c) => filas.push(fila(`Concesión (${c.concesionaria || 'empresa'})`, `${esc(c.nombre_zona)} · ${esc(c.empresa)} · expediente ${esc(c.expediente)} · ${esc(String(c.situacion || '').toLowerCase())}`)));
      } else {
        filas.push(fila('Distancia al borde de la más cercana', `${dist(r.distanciaM)} en línea recta (${esc(r.concesionaria || '')}${r.cercana ? `, ${esc(r.cercana.nombre_zona)}` : ''})`));
      }
    } else filas.push(fila('Resultado', esc(CALC.textoElectricidad(r))));
    return `<table class="rp-tabla">${filas.join('')}</table><p class="rp-nota">${esc(CALC.NOTA_ELECTRICIDAD)} ${esc(r.metodo || '')}</p>`;
  }

  /**
   * Servicios de la manzana según el censo (INEI): alumbrado, agua y desagüe por red pública. INFORMATIVOS (sin umbral). Son cifras de TODA la manzana en el año del
   * censo (hoy 2017), sobre las viviendas ocupadas con personas presentes que se censaron: no son de un predio ni de hoy. Con menos de 5 viviendas no hay porcentaje.
   */
  function censo(d) {
    const r = d.variables && d.variables.censo;
    if (!r) return '';
    const filas = [fila('Estado', r.estado === 'SIN DATO' ? estado('SIN DATO') : estado('INFORMATIVO'))];
    const p = (x) => (x === null || x === undefined ? 'sin porcentaje' : `${String(x).replace('.', ',')} %`);
    if (r.tieneCifras) {
      filas.push(fila('Manzana', `${esc(r.manzana)} · ${r.modo === 'cercana' ? `la más cercana, a ${dist(r.distanciaM)} de su borde (el punto está en la calle)` : 'el punto está dentro'}`));
      filas.push(fila(`Viviendas ocupadas con personas presentes (censo ${r.anio})`, `${esc(r.ocupadas)} (de ${esc(r.viviendas)} viviendas contadas; ${esc(r.personas)} personas)`));
      filas.push(fila('Alumbrado eléctrico por red pública', p(r.luz.pct)));
      filas.push(fila('Agua por red pública', `${p(r.agua.pct)}${r.agua.pctDentro !== null && r.agua.pctDentro !== r.agua.pct ? ` (${p(r.agua.pctDentro)} dentro de la vivienda)` : ''}`));
      filas.push(fila('Desagüe por red pública', `${p(r.desague.pct)}${r.desague.pctDentro !== null && r.desague.pctDentro !== r.desague.pct ? ` (${p(r.desague.pctDentro)} dentro de la vivienda)` : ''}`));
    }
    filas.push(fila('Resultado', esc(CALC.textoCenso(r))));
    const dep = d.departamento2025 ? ` ${esc(CALC.textoCenso2025(d.departamento2025, 'agua'))} ${esc(CALC.textoCenso2025(d.departamento2025, 'luz'))}` : '';
    return `<table class="rp-tabla">${filas.join('')}</table><p class="rp-nota">${esc(CALC.NOTA_CENSO)} ${esc(r.metodo || '')}${dep}</p>`;
  }

  const hayComercio = (d) => Boolean(d.variables && Object.keys(CALC.COMERCIO).some((id) => d.variables[id]));
  const fuenteComercio = (d) => {
    const r = Object.keys(CALC.COMERCIO).map((id) => d.variables[id]).find((x) => x && x.fuente);
    return r ? fuenteDe(r) : '';
  };

  function educacion(d) {
    const e = d.variables && d.variables.educacion;
    if (!e) return sinResultado;
    const filas = NIVELES.flatMap((n) => {
      const r = e[n];
      if (r.error) return [fila(nombreNivel(n), `No se pudo obtener el dato: ${esc(r.error)}`)];
      const origen = r.fuenteElemento ? ` · fuente: ${esc(CALC.textoFuenteElemento(r))}` : '';
      const det = r.nombre ? `${esc(r.nombre)} · ${r.distanciaM === null ? 'sin distancia' : `${dist(r.distanciaM)} en línea recta`} · umbral ${dist(r.umbralM)}${origen}` : `Sin dato · umbral ${dist(r.umbralM)}`;
      return [fila(nombreNivel(n), `${estado(r.estado)} ${det}`)];
    });
    return `<table class="rp-tabla">${filas.join('')}</table>
      <p class="rp-nota">Umbrales: ${esc(d.fuentesUmbral.educacion)}. Los colegios salen del padrón de ESCALE (MINEDU), que dice el nivel de cada local; OpenStreetMap solo completa donde ESCALE no tiene un local a 200 m, y allí casi no etiqueta el nivel: uno sin nivel se toma como candidato a primaria y secundaria, y los jardines (amenity=kindergarten) cuentan como inicial.</p>`;
  }

  // Líneas de transporte (relaciones route=bus de OpenStreetMap) que pasan cerca del punto, aparte del paradero más cercano, con su licencia y sus límites.
  function lineasTransporte(t, d) {
    const r = t.rutas;
    if (!r) return '';
    if (r.error) return `<p class="rp-muted">No se pudieron cargar las líneas de transporte: ${esc(r.error)}</p>`;
    const ref = `${dist(r.distanciaM)} (${esc(d.fuentesUmbral.transporte)})`;
    const filas = r.lineas.length
      ? r.lineas.map((l) => {
        const ramales = [...new Set(l.ramales.map((x) => x.ramal))];
        const parada = l.parada ? ` · parada mapeada más cercana ${l.parada.nombre ? `«${esc(l.parada.nombre)}»` : '(sin nombre)'} a ${dist(l.parada.distanciaM)}` : l.paradasMapeadas === 0 ? ' · paradas no mapeadas' : '';
        return fila(RT.etiquetaLinea(l), `trazado a ${dist(l.distanciaM)}${parada} · ${esc(ramales.slice(0, 4).join(', '))}${ramales.length > 4 ? ` y ${ramales.length - 4} más` : ''}`);
      })
      : [fila('Líneas', `Ninguna línea mapeada en OpenStreetMap pasa a ${dist(r.distanciaM)} o menos`)];
    return `<p class="rp-destacado"><strong>Líneas que pasan a ${dist(r.distanciaM)} o menos</strong> ${r.lineas.length ? esc(RT.listaTexto(r.lineas)) : '(ninguna)'}</p>
      <table class="rp-tabla">${filas.join('')}</table>
      <p class="rp-nota">Fuente: ${esc(r.fuente)}, recorridos extraídos el ${esc(r.fecha || 'sin fecha')}, ${esc(r.atribucion || '')}. Distancia en línea recta del punto al trazado de cada recorrido; referencia de ${ref}. Son los recorridos mapeados por la comunidad de OpenStreetMap, no un servicio garantizado: sin frecuencias ni horarios, y un cambio de ruta por tramos puede no estar reflejado. Las paradas de OSM son parciales.</p>`;
  }

  function transporte(d) {
    const r = d.variables && d.variables.transporte;
    if (!r) return sinResultado;
    return `<table class="rp-tabla">${filasDe(r, d.fuentesUmbral.transporte).join('')}</table><p class="rp-nota">${esc(r.metodo)}</p>${lineasTransporte(r, d)}`;
  }

  function areaVerde(d) {
    const r = d.variables && d.variables.areaVerde;
    if (!r) return sinResultado;
    const u = d.umbrales.areaVerde;
    const filas = filasDe(r, d.fuentesUmbral.areaVerde);
    if (!r.error && r.estado !== 'SIN DATO') {
      if (r.areaM2) filas.splice(3, 0, fila('Superficie', `${num(r.areaM2)} m² (${(r.areaM2 / 10000).toFixed(2).replace('.', ',')} ha)`));
      filas.push(fila('Criterio más estricto (≥ 1 ha)', r.cumple1ha ? `También hay una a ${dist(r.distancia1haM)} (${esc(r.nombre1ha)})` : `Ninguna de al menos ${num(u.areaGrandeM2)} m² a ${u.distanciaM} m o menos`));
    }
    return `<table class="rp-tabla">${filas.join('')}</table><p class="rp-nota">Criterio: un área verde de al menos ${num(u.areaMinM2)} m² a ${u.distanciaM} m o menos. ${esc(r.metodo)}</p>`;
  }

  // ------------------------------------------------ Quebradas y cauces (ANA, IGP y OpenStreetMap)

  function seccionQuebradas(d) {
    const q = d.cauce;
    if (!q) return '<p class="rp-muted">No se calcularon las quebradas y los cauces cercanos.</p>';
    if (q.estado === 'SIN DATO') {
      return `<table class="rp-tabla">${fila('Estado', estado('SIN DATO'))}${fila('Resultado', `No se pudo obtener el dato${q.error ? `: ${esc(q.error)}` : ''}`)}</table>
        <p class="rp-nota">Que no haya dato no significa que no haya una quebrada cerca: consulta SIGRID (CENEPRED) y al IMPLA.</p>`;
    }
    const faltan = CALC.textoQuebradasAusentes(q.ausentes);
    const filas = [
      fila('Estado', estado(q.estado) + (q.segunUmbralUsuario ? ' <span class="rp-muted">según tu umbral</span>' : '')),
      fila('Cauce más cercano', `${esc(q.nombre)}${q.tipo ? ` (${esc(String(q.tipo).toLowerCase())})` : ''}${q.fuenteCorta ? ` · fuente: ${esc(q.fuenteCorta)}` : ''}${(q.alias || []).length ? `. También figura como ${esc(q.alias.map((a) => a.nombre).join(', '))}` : ''}`),
      fila('Distancia', `${dist(q.distanciaM)} en línea recta`),
      fila('Umbral', q.segunUmbralUsuario ? `Según tu umbral: al menos ${dist(q.umbralM)} de un cauce (es tu criterio, no una norma)` : 'Sin umbral normativo: no existe una distancia oficial a una quebrada, así que el dato es solo informativo'),
    ];
    const cubre = `Los cauces vienen de ${esc(CALC.textoFuentesCauces(q.fuentes))}; ninguna fuente es completa (la de la ANA es una red nacional de 2018).${faltan ? ` Quebradas conocidas que aún no figuran: ${esc(faltan)}.` : ''} Ninguna es un mapa de peligro de huaicos ni de inundación ni delimita la faja marginal. La distancia es a la línea del mapa, no al cauce real.`;
    return `<table class="rp-tabla">${filas.join('')}</table><p class="rp-nota">${cubre}</p>${q.metodo ? `<p class="rp-nota">${esc(q.metodo)}</p>` : ''}`;
  }

  // ------------------------------------------ Contexto de riesgo (informativo)
  const NO_CALCULADO = '<p class="rp-muted">No se calculó el contexto de riesgo.</p>';

  function bloquePeligros(p) {
    if (!p || p.estado === 'SIN DATO') {
      return `<table class="rp-tabla">${fila('Peligros geológicos registrados', `${estado('SIN DATO')} ${p && p.error ? esc(p.error) : ''}`)}</table>`;
    }
    const m = p.masCercano;
    const filas = [
      fila(`Peligros geológicos registrados a ${num(p.radioM)} m o menos`, `${estado('INFORMATIVO')} <strong>${num(p.total)}</strong>${p.porTipo && p.porTipo.length ? ` (${p.porTipo.map(([tp, n]) => `${esc(tp)} ${n}`).join(', ')})` : ''}`),
    ];
    if (m) filas.push(fila('Registro más cercano', `${dist(p.distanciaM)} en línea recta · ${esc(m.subtipo || m.tipo)}${m.sector ? ` · «${esc(m.sector)}»` : ''}${m.anio ? ` · ${esc(m.anio)}` : ''}`));
    return `<table class="rp-tabla">${filas.join('')}</table>
      <p class="rp-nota">Es un inventario de eventos documentados (${esc(p.anioDesde)}–${esc(p.anioHasta)}, ${num(p.registros)} registros en Arequipa metropolitana), no un mapa de susceptibilidad: que no haya registros cerca no significa que el lugar sea seguro. Datos congelados el ${esc(p.fecha || 'sin fecha')}.</p>`;
  }

  function bloqueSismos(s) {
    if (!s || s.estado === 'SIN DATO') {
      return `<table class="rp-tabla">${fila('Sismos reportados', `${estado('SIN DATO')} ${s && s.error ? esc(s.error) : ''}`)}</table>`;
    }
    const km = coma(s.radioM / 1000);
    const filas = [
      fila(`Sismos reportados a ${km} km o menos (en línea recta)`, `${estado('INFORMATIVO')} <strong>${num(s.total)}</strong>`),
      fila('Periodo que cubre', `${esc(s.desde)} a ${esc(s.hasta)}`),
    ];
    if (s.magnitudMaxima !== null && s.magnitudMaxima !== undefined) filas.push(fila('Magnitud máxima', coma(s.magnitudMaxima)));
    if (s.masReciente) filas.push(fila('Más reciente', esc(s.masReciente)));
    return `<table class="rp-tabla">${filas.join('')}</table>
      <p class="rp-nota">Es actividad reciente reportada por el IGP en el periodo indicado: no predice sismos ni mide el peligro del lugar, y un conteo bajo no dice nada de otros periodos. Para construir, la referencia normativa es la zona sísmica de la Norma E.030, que depende del distrito, y el Estudio de Mecánica de Suelos. El radio es una convención del proyecto. Datos congelados el ${esc(s.fecha || 'sin fecha')}.</p>`;
  }

  /** Peligro volcánico del Misti (zonas del IGP): INFORMATIVO, nunca cumple ni puntaje. */
  function bloqueVolcan(v) {
    if (!v) return ''; // no se calculó (puntos o informes anteriores a esta variable): no se dice nada
    if (v.estado === 'SIN DATO') {
      return `<table class="rp-tabla">${fila('Peligro volcánico del Misti', `${estado('SIN DATO')} ${v.error ? esc(v.error) : ''}`)}</table>`;
    }
    const filas = [fila('Peligro volcánico del Misti', `${estado('INFORMATIVO')} ${esc(v.frase)}`)];
    (v.lineas || []).forEach((l) => filas.push(fila('Detalle', esc(l.texto))));
    return `<table class="rp-tabla">${filas.join('')}</table>
      <p class="rp-nota">Zonas de peligro volcánico del IGP, de escala regional: cerca del borde de una zona el nivel no es exacto a nivel de predio. No es una evaluación de riesgo ni dice si habrá una erupción, y que el punto no esté en una zona no significa que no haya peligro. ${esc(v.fechaDelMapa || 'Sin metadatos de fecha')}${v.referencia ? `; mapa oficial de referencia: ${esc(v.referencia)}` : ''}. Datos congelados el ${esc(v.fecha || 'sin fecha')}. Consulta el CENEPRED (SIGRID), la municipalidad y el IGP o INGEMMET.</p>`;
  }

  /** Escenario de riesgo del CENEPRED ante El Niño (por distrito): INFORMATIVO, nunca cumple ni puntaje. */
  function bloqueCenepred(c) {
    if (!c) return ''; // no se calculó (puntos o informes anteriores a esta variable): no se dice nada
    if (c.estado !== 'INFORMATIVO') {
      return `<table class="rp-tabla">${fila('Riesgo del distrito ante El Niño (CENEPRED)', `${estado('SIN DATO')} ${c.error ? esc(c.error) : ''}`)}</table>`;
    }
    const filas = [fila('Riesgo del distrito ante El Niño (CENEPRED)', `${estado('INFORMATIVO')} ${esc(c.frase)}`)];
    (c.lineas || []).forEach((l) => filas.push(fila('Detalle', esc(l.texto))));
    return `<table class="rp-tabla">${filas.join('')}</table>
      <p class="rp-nota">Escenario del CENEPRED para el distrito de ${esc(c.titulo)}, ante lluvias como las de El Niño de 1983, 1998, 2017 y 2023: es una estimación por distrito, no una predicción ni una evaluación de este predio, y dentro del distrito el riesgo cambia mucho de una calle a otra. Los movimientos en masa son, por ejemplo, deslizamientos, huaicos y derrumbes. Una zona de mayor susceptibilidad es donde el terreno es más propenso a que ocurra el fenómeno. Datos congelados el ${esc(c.fecha || 'sin fecha')}. Para decidir, pide la evaluación de riesgos de la municipalidad y consulta el SIGRID del CENEPRED (${esc(c.urlVisor || 'sigrid.cenepred.gob.pe')}).</p>`;
  }

  function seccionContexto(d) {
    const c = d.contextoRiesgo;
    if (!c) return NO_CALCULADO;
    return `<p class="rp-nota">Datos de contexto, no una evaluación de peligro: no hay umbral que diga si un lugar es seguro. Que algo no aparezca aquí no significa que el lugar esté libre de riesgo.</p>${bloquePeligros(c.peligros)}${bloqueSismos(c.sismos)}${bloqueVolcan(c.volcan)}${bloqueCenepred(c.cenepred)}`;
  }

  // ------------------------------- Precio de oferta del distrito (Aptología, CC BY 4.0)
  const QUE_NO_CUBRE_PRECIO = 'Son precios pedidos en avisos de venta, no de cierre ni una tasación. Es la mediana del distrito, no el precio de este inmueble: una vivienda concreta puede costar mucho más o menos según su estado, tamaño, piso y ubicación exacta. Solo cubre departamentos y los distritos con al menos 30 avisos; no hay cifra para casas ni terrenos. Refleja un periodo corto, así que no muestra tendencia.';

  function seccionPrecio(d) {
    const p = d.precio;
    if (!p) return '<p class="rp-muted">No se calculó el precio de oferta del distrito.</p>';
    if (p.estado === 'SIN DATO') {
      return `<table class="rp-tabla">${fila('Precio de oferta por m² del distrito', `${estado('SIN DATO')} ${esc(p.causa || '')}`)}</table>
        <p class="rp-nota">${esc(QUE_NO_CUBRE_PRECIO)}</p>`;
    }
    const filas = [
      fila('Precio de oferta por m² (venta)', `${estado('INFORMATIVO')} <strong>${esc(P.formatearSoles(p.precioM2.venta))}</strong> por m², mediana de ${num(p.nAvisos.venta)} avisos de departamentos en ${esc(p.distrito)}`),
      fila('Periodo de los datos', esc(P.textoPeriodo(p.periodo))),
    ];
    if (p.arriendoMensual !== null && p.arriendoMensual !== undefined) filas.push(fila('Arriendo mensual (mediana)', `${esc(P.formatearSoles(p.arriendoMensual))} por mes, sin administración ni gastos comunes (${num(p.nAvisos.arriendo ?? 0)} avisos)`));
    filas.push(fila('Atribución', `${esc(p.atribucion)}${p.url ? ` (${esc(p.url)})` : ''} · licencia ${esc(p.licencia)}`));
    return `<table class="rp-tabla">${filas.join('')}</table>
      <p class="rp-nota">Informativo: es lo que piden los vendedores en el distrito, no el valor de este inmueble. No dice si un precio es caro o barato y no entra en ningún puntaje. ${esc(QUE_NO_CUBRE_PRECIO)} Datos congelados el ${esc(p.fechaDescarga || 'sin fecha')}. Valores redondeados a soles enteros.</p>`;
  }

  // ------------------------------- Verificaciones recomendadas antes de comprar
  // En papel no se puede hacer clic: las URL se imprimen como texto, sin enlaces.
  function seccionVerificaciones(d) {
    const v = d.verificaciones;
    if (!v) return '';
    const calc = (v.calculado || []).map((c) => `<li><strong>${esc(c.titulo)}.</strong> ${esc(c.texto)}</li>`).join('');
    const items = (v.items || []).map((it) => `<li class="rp-verif">
        <span class="rp-caja" aria-hidden="true">☐</span>
        <div>
          <strong>${esc(it.titulo)}</strong>
          <div class="rp-muted">${esc(it.entidad)}</div>
          <div>${esc(it.queConfirma)}</div>
          ${it.nota ? `<div class="rp-muted">${esc(it.nota)}</div>` : ''}
          ${(it.enlaces || []).length ? `<div class="rp-url">${it.enlaces.map((e) => `${esc(e.texto)}: ${esc(e.url)}`).join(' · ')}</div>` : ''}
        </div>
      </li>`).join('');
    return `<div class="rp-grupo">
        <h3>Lo que GeoVerificador ya calculó <span class="rp-etiqueta">Referencial</span></h3>
        <ul>${calc}</ul>
      </div>
      <div class="rp-grupo rp-grupo-fuerte">
        <h3>Lo que debes comprobar tú <span class="rp-etiqueta">Fuera de esta herramienta</span></h3>
        <ul class="rp-verifs">${items}</ul>
      </div>
      <p class="rp-nota">${esc(v.aviso || '')}</p>`;
  }

  // ------------------------------------------------------------ Resumen, secciones y límites
  /** Filas que se suman al resumen: quebradas y contexto (solo si ya se calcularon). */
  function filasResumenExtra(d) {
    const out = [];
    const q = d.cauce;
    if (q) {
      let v;
      if (q.estado === 'SIN DATO') v = 'SIN DATO';
      else {
        v = `${q.estado} · ${q.nombre} a ${dist(q.distanciaM)} en línea recta${q.fuenteCorta ? ` (fuente: ${q.fuenteCorta})` : ''}`;
        v += q.segunUmbralUsuario ? ` (según tu umbral de ${dist(q.umbralM)})` : ' (sin umbral normativo)';
      }
      out.push(['Quebradas y cauces', v]);
    }
    const c = d.contextoRiesgo;
    if (c) {
      const p = c.peligros;
      out.push(['Peligros geológicos registrados (contexto)', !p || p.estado === 'SIN DATO' ? 'SIN DATO' : `INFORMATIVO · ${num(p.total)} a ${num(p.radioM)} m o menos${p.masCercano ? `; el más cercano a ${dist(p.distanciaM)} en línea recta` : ''}`]);
      const s = c.sismos;
      const vo = c.volcan;
      if (vo) out.push(['Peligro volcánico del Misti (contexto)', vo.estado !== 'INFORMATIVO' ? 'SIN DATO' : `INFORMATIVO · ${vo.enZona ? vo.frase.replace(/^Tu punto está en zona de /, 'en zona de ').replace(/ del Misti, según el IGP[.]$/, '') + ' (IGP)' : 'fuera de las zonas mapeadas por el IGP'}`]);
      const ce = c.cenepred;
      if (ce) out.push(['Riesgo del distrito ante El Niño (CENEPRED, contexto)', ce.estado !== 'INFORMATIVO' ? 'SIN DATO' : `INFORMATIVO · en ${ce.titulo}: inundaciones ${ce.inundacion.nivel.toLowerCase()}, movimientos en masa ${ce.movimientos_masa.nivel.toLowerCase()} (estimación del distrito, no del predio)`]);
      out.push(['Sismos recientes (contexto)', !s || s.estado === 'SIN DATO' ? 'SIN DATO' : `INFORMATIVO · ${num(s.total)} a ${coma(s.radioM / 1000)} km o menos entre el ${s.desde} y el ${s.hasta}${s.magnitudMaxima !== null && s.magnitudMaxima !== undefined ? `; magnitud máxima ${coma(s.magnitudMaxima)}` : ''}`]);
    }
    const pr = d.precio;
    if (pr) out.push(['Precio de oferta del distrito (informativo)', pr.estado === 'INFORMATIVO' ? `INFORMATIVO · ${P.formatearSoles(pr.precioM2.venta)} por m² (mediana de ${num(pr.nAvisos.venta)} avisos en ${pr.distrito}; oferta, no cierre; ${P.textoPeriodo(pr.periodo)})` : 'SIN DATO']);
    return out;
  }

  const fuenteCauce = (q) => (q ? `${q.fuente}${q.fecha ? `, datos extraídos el ${q.fecha}` : ''}${q.fuentes && q.fuentes.length > 1 ? `. Cauces del archivo: ${CALC.textoFuentesCauces(q.fuentes)}` : ''}` : '');
  const fuenteContexto = (c) => (c ? [c.peligros && c.peligros.fuente, c.sismos && c.sismos.fuente, c.volcan && c.volcan.estado === 'INFORMATIVO' && c.volcan.fuente, c.cenepred && c.cenepred.estado === 'INFORMATIVO' && c.cenepred.fuente].filter(Boolean).join('; ') : '');

  const fuentePrecio = (p) => (p && p.estado === 'INFORMATIVO' ? `${p.atribucion} — ${p.fuente}, licencia ${p.licencia}, descargado el ${p.fechaDescarga}` : '');

  /** Las secciones del informe en orden: [{ titulo, color, cuerpo, fuente }]. */
  function construirSecciones(d) {
    const m = d.modulos || {};
    const lista = [
      ['Zonificación vigente y proyectada', '#4f46e5', zonificacion(d), d.fuentes.zonificacion],
      ['Salud', '#c2410c', salud(d), d.variables ? fuenteDe(d.variables.salud) : ''],
      ...(d.variables && d.variables.consultorio ? [['Consultorio médico (informativo)', '#b45309', consultorio(d), fuenteDe(d.variables.consultorio)]] : []),
      ...(hayComercio(d) ? [['Comercio por necesidad: abastecimiento, compras y ocio, comercio de barrio (informativo)', '#be185d', comercio(d), fuenteComercio(d)]] : []),
      ...(d.variables && (d.variables.acopio || d.variables.interrupciones) ? [['Agua: puntos de acopio e interrupciones del servicio (informativo)', '#0369a1', agua(d), [d.variables.acopio ? `${d.variables.acopio.fuente || 'SEDAPAR'} (publicado el ${d.variables.acopio.fecha || 'sin fecha'}; datos de ${d.variables.acopio.fechaDatos || '2017'})` : '', d.variables.interrupciones && d.variables.interrupciones.registros !== null ? `${d.variables.interrupciones.fuente || 'SUNASS'}, interrupciones reportadas por SEDAPAR (${d.variables.interrupciones.licencia || 'ODC-By'}, descargado el ${d.variables.interrupciones.fecha || 'sin fecha'})` : ''].filter(Boolean).join('; ')]] : []),
      ...(d.variables && d.variables.mineria ? [['Concesión minera (informativo)', '#7c2d12', mineria(d), fuenteDe(d.variables.mineria)]] : []),
      ...(d.variables && d.variables.electricidad ? [['Electricidad (informativo)', '#ca8a04', electricidad(d), fuenteDe(d.variables.electricidad)]] : []),
      ...(d.variables && d.variables.censo ? [[`Servicios de la manzana (censo ${d.variables.censo.anio || 2017}, informativo)`, '#0e7490', censo(d), d.variables.censo.fuente ? fuenteDe(d.variables.censo) : '']] : []),
      ['Educación por nivel', '#7c3aed', educacion(d), d.variables ? fuenteDe(d.variables.educacion.inicial) : ''],
      ['Transporte', '#1d4ed8', transporte(d), d.variables ? [fuenteDe(d.variables.transporte), d.variables.transporte.rutas && !d.variables.transporte.rutas.error ? `${d.variables.transporte.rutas.atribucion || '© colaboradores de OpenStreetMap (ODbL)'}` : ''].filter(Boolean).join('; ') : ''],
      ['Área verde', '#15803d', areaVerde(d), d.variables ? fuenteDe(d.variables.areaVerde) : ''],
      ['Quebradas y cauces', '#0369a1', seccionQuebradas(d), fuenteCauce(d.cauce)],
      ['Contexto de riesgo (informativo)', '#64748b', seccionContexto(d), fuenteContexto(d.contextoRiesgo)],
      ['Precio de oferta del distrito (informativo)', '#a16207', seccionPrecio(d), fuentePrecio(d.precio)],
    ];
    if (m.desastre) lista.push(['Desastre', '#ea580c', desastre(d), [m.desastre.mostrarPeligro ? d.fuentes.peligros : '', m.desastre.mostrarSismica ? d.fuentes.distritos : ''].filter(Boolean).join('; ')]);
    if (m.seguridad) lista.push(['Seguridad', '#dc2626', seguridad(d), d.fuentes.delitos]);
    if (m.riesgos) lista.push(['Registro de riesgos', '#0f766e', registro(d), '']);
    if (d.verificaciones) lista.push(['Verificaciones recomendadas antes de comprar', '#334155', seccionVerificaciones(d), '']);
    return lista.map(([titulo, color, cuerpo, fuente]) => ({ titulo, color, cuerpo, fuente }));
  }

  /** Limitaciones principales del informe. */
  function limites(d) {
    const m = d.modulos || {};
    const l = [
      'La zonificación vigente es la del PDM 2016-2025, cuya vigencia de 10 años se cumplió; hay un PDM nuevo en trámite y una sentencia (183-2019) que suspendió ciertos actos para predios antes agrícolas o de reserva paisajista. La zonificación proyectada no se muestra: solo se advierte su estado, con la fuente indicada.',
      'Los polígonos de la zonificación se extrajeron de un PDF: cerca del borde entre dos zonas el resultado puede no ser exacto (por eso se avisa cuando otra zona queda a 20 m o menos).',
      'Salud sale de RENIPRESS (SUSALUD) y educación del padrón de ESCALE (MINEDU), como fuente primaria; OpenStreetMap, un mapa colaborativo, solo sirve de respaldo donde ningún registro oficial tiene un punto a 200 m, y es la fuente de transporte y área verde: algo ausente puede existir. RENIPRESS no trae las coordenadas de cerca del 42 % de los establecimientos de Arequipa, que por eso no pueden ubicarse. Los datos se extrajeron una vez (fecha indicada en cada sección) y no se actualizan solos.',
      'Las líneas de transporte son los recorridos que la comunidad de OpenStreetMap tenía mapeados en la fecha indicada (ODbL): no traen frecuencias ni horarios, y un cambio de ruta por tramos puede no estar reflejado. Las paradas de OpenStreetMap son parciales: una línea puede tener pocas o ninguna parada mapeada.',
      'Todas las distancias son en línea recta, no recorrido a pie. Los umbrales de salud (1000 m), transporte (400 m) y borde de zona (20 m) son convenciones del proyecto; los de educación son distancias referenciales de las normas del MINEDU (RVM 104-2019 y 208-2019, numeral 7.1) y el de área verde es un indicador de la OMS Europa (2016), no una norma peruana.',
      'Los locales de ESCALE dicen su nivel. Los colegios de OpenStreetMap que completan el mapa casi no lo etiquetan: uno sin nivel se toma como candidato a primaria y secundaria, lo que puede sobrestimar la oferta de un nivel.',
      ...(d.variables && d.variables.consultorio ? ['El consultorio médico es una categoría aparte de los establecimientos de salud y es solo informativo: no tiene una distancia de referencia (es una decisión pendiente), así que no se dice si está cerca o lejos, no suma a ningún puntaje y no cuenta como «salud cerca».'] : []),
      ...(d.variables && d.variables.censo ? ['Servicios de la manzana: alumbrado, agua y desagüe por red pública según el censo de 2017 del INEI (REDATAM), solo área urbana. Son cifras de toda la manzana, calculadas sobre las viviendas ocupadas con personas presentes que se censaron, no de un predio ni de hoy; con menos de 5 viviendas no se da el porcentaje. El censo de 2025 ya se levantó pero el INEI todavía no lo abre por manzana. Es informativo y no suma a ningún puntaje.'] : []),
      ...(d.variables && (d.variables.acopio || d.variables.interrupciones) ? ['Agua: los puntos de acopio vienen del directorio de SEDAPAR y la Municipalidad Provincial de Arequipa (publicado en gob.pe en 2024 con datos de abril a junio de 2017) y son lugares de reparto con camiones cisterna ante un desabastecimiento: no dicen que haya agua en ellos hoy, que sigan vigentes ni que una zona tenga conexión. Las interrupciones son las que SEDAPAR reportó a la SUNASS (de octubre de 2019 a abril de 2024), contadas una vez por distrito y sin pesar por las viviendas afectadas: no se comparan distritos y no dicen nada de un predio. Los datos de conexión de un predio en particular no están publicados. Es informativo y no suma a ningún puntaje.'] : []),
      ...(d.variables && d.variables.mineria ? ['Concesión minera: el Catastro Minero de INGEMMET es referencial y se actualiza a diario; una concesión minera es un derecho a explorar y explotar los minerales, separado del predio (art. 9 de la Ley General de Minería): no dice que haya minería en el lugar, de quién es el predio ni qué se puede hacer en él, y que el punto quede fuera no garantiza que no haya otros derechos. Es informativo y no suma a ningún puntaje.'] : []),
      ...(d.variables && d.variables.electricidad ? ['Electricidad: el área de concesión de distribución eléctrica (MINEM, Dirección General de Electricidad) dice a qué empresa le corresponde dar el servicio en esa zona; una concesión no es una conexión: no dice que el predio esté conectado ni que haya red en su calle, y los polígonos del registro son poco detallados (su borde puede ser impreciso). La cobertura real de conexión vendría de un censo (INEI) que este proyecto aún no tiene. Es informativo y no suma a ningún puntaje.'] : []),
      ...(hayComercio(d) ? ['El comercio se ordena por necesidad —abastecimiento (mercados y supermercados), compras y ocio (solo los malls confirmados con su fuente) y comercio de barrio (el resto de lo que se etiqueta mall)— y es informativo: no tiene una distancia de referencia (es una decisión pendiente), así que no se dice si está cerca o lejos y no suma a ningún puntaje. Un supermercado dentro de un mall cuenta como abastecimiento; el mall, no. Sale de OpenStreetMap, que puede no tenerlos todos (por distrito, el número de mercados mapeados no coincide con el del censo de 2016), etiqueta de más —amenity=marketplace incluye ferias y comercios mal etiquetados y shop=mall incluye galerías pequeñas, no solo malls— y no distingue un mercado minorista de uno mayorista; de un mall con forma en el mapa la distancia es al borde.'] : []),
      'Quebradas y cauces: no existe una distancia normativa a una quebrada, así que el estado es INFORMATIVO salvo que la persona fije su propio umbral («según tu umbral»). Los cauces vienen de la ANA, el IGP y OpenStreetMap; ninguna fuente es completa, no son un mapa de peligro y no delimitan la faja marginal.',
      'El contexto de riesgo (peligros geológicos de INGEMMET, sismos reportados por el IGP en el periodo indicado y zonas de peligro volcánico del Misti del IGP, de escala regional y sin fecha de elaboración, y el escenario de riesgo del CENEPRED ante El Niño, que es una estimación por distrito) es informativo: no es una evaluación del predio, no predice sismos, erupciones ni lluvias y que no haya registros o zonas no significa que el lugar sea seguro.',
      'El precio de oferta por m² del distrito (Aptología, CC BY 4.0) es informativo: son precios pedidos en avisos, no de cierre, y es la mediana del distrito, no el precio de este inmueble. Solo hay cifra en los distritos con al menos 30 avisos.',
    ];
    if (m.desastre) l.push('Los peligros geológicos son un inventario de eventos documentados, no un mapa de susceptibilidad. La zona sísmica es regional y no considera el suelo del predio.');
    if (m.seguridad) l.push('Las denuncias no son todos los delitos y solo se cuentan las que tienen ubicación.');
    l.push('Metodología, fuentes y validaciones completas: docs/METODOLOGIA.md y docs/VALIDACION.md del proyecto.');
    return l;
  }

  // ------------------------------------------- Módulos fuera de alcance (solo si están activos)
  function desastre(d) {
    const m = d.modulos.desastre;
    let html = '';
    if (m.mostrarPeligro && m.zonaRiesgo) html += `<p class="rp-alerta">El plano de zonificación ubica el punto en zona de riesgo muy alto (${esc(d.zona.codigo)}).</p>`;
    if (m.mostrarPeligro) {
      if (m.peligro) {
        const p = m.peligro;
        const masCercano = p.masCercano;
        html += `<table class="rp-tabla">
        ${fila(`Peligros geológicos registrados a ${p.radio} m`, `<strong>${num(p.total)}</strong>${p.porTipo.length ? ` (${p.porTipo.map(([t, n]) => `${esc(t)} ${n}`).join(', ')})` : ''}`)}
        ${fila('Registro más cercano', `${dist(masCercano.distancia)} · ${esc(masCercano.subtipo || masCercano.tipo)}${masCercano.sector ? ` · «${esc(masCercano.sector)}»` : ''}${masCercano.anio ? ` · ${esc(masCercano.anio)}` : ''}`)}
      </table>
      <p class="rp-nota">Es un inventario de eventos documentados (${esc(p.meta.anioDesde)}–${esc(p.meta.anioHasta)}): que no haya registros no significa que el lugar sea seguro.</p>`;
      } else html += '<p class="rp-muted">No se pudo consultar el inventario de peligros.</p>';
    }
    if (m.mostrarSismica && m.distrito) {
      html += `<table class="rp-tabla">${fila('Zona sísmica (Norma E.030 2026)', `<strong>Zona ${esc(m.distrito.zona)} · Z = ${coma(m.distrito.z)}</strong> (distrito de ${esc(d.distritoNombre)})`)}</table>
      <p class="rp-nota">Z: aceleración máxima horizontal en suelo rígido con 10 % de probabilidad de ser excedida en 50 años, como fracción de la gravedad. No considera el suelo del predio.</p>`;
    }
    return html;
  }

  function seguridad(d) {
    const m = d.modulos.seguridad;
    if (!m.delito) return '<p class="rp-muted">No se pudo calcular el indicador de denuncias.</p>';
    const { total, ROBO, HURTO } = m.delito.conteo;
    return `<table class="rp-tabla">
      ${fila(`Denuncias de robo y hurto a ${m.delito.radio} m`, `<strong>${num(total)}</strong> (${num(ROBO)} robos, ${num(HURTO)} hurtos)`)}
      ${fila('Periodo', `${m.delito.meta.meses} meses (${esc(m.periodo)}); ${Math.round(m.delito.meta.coberturaVentana * 100)} % de las denuncias del periodo trae ubicación`)}
    </table>
    <p class="rp-nota">Son denuncias con ubicación, no todos los delitos. Robo: con violencia o amenaza; hurto: sin violencia.</p>`;
  }

  function matriz(riesgos, ev, nivel) {
    const nombres = ['Baja', 'Media', 'Alta'];
    let celdas = '';
    for (let p = 3; p >= 1; p--) {
      celdas += `<div class="rp-my">${nombres[p - 1]}</div>`;
      for (let i = 1; i <= 3; i++) {
        const n = nivel(p, i);
        const ids = riesgos.filter((r) => ev[r.id]?.p === p && ev[r.id]?.i === i).map((r) => r.id).join(' ');
        celdas += `<div class="rp-celda rp-${n.texto.toLowerCase()}">${esc(ids)}</div>`;
      }
    }
    return `<div class="rp-matriz"><div class="rp-mtit">Probabilidad ↑ · Impacto →</div>${celdas}<div></div>${nombres.map((t) => `<div class="rp-mx">${t}</div>`).join('')}</div>`;
  }

  function registro(d) {
    const { riesgos, evaluacion: ev, nivel, escala, decisiones } = d.modulos.riesgos;
    if (!riesgos.length) return '<p class="rp-muted">No se identificaron riesgos con los datos disponibles.</p>';
    const txt = (v) => escala.find((x) => x.v === v)?.texto || '—';
    const evaluados = riesgos.filter((r) => nivel(ev[r.id]?.p, ev[r.id]?.i)).length;
    const filas = riesgos.map((r) => {
      const e = ev[r.id] || {};
      const n = nivel(e.p, e.i);
      return `<tr>
        <td class="rp-id">${r.id}</td>
        <td><strong>${esc(r.titulo)}</strong><div class="rp-ev">${esc(r.evidencia)}</div></td>
        <td class="rp-c">${txt(e.p)}</td><td class="rp-c">${txt(e.i)}</td>
        <td class="rp-c">${n ? `<span class="rp-niv rp-${n.texto.toLowerCase()}">${n.texto}</span>` : '<span class="rp-muted">Sin evaluar</span>'}</td>
        <td>${e.decision != null ? esc(decisiones[e.decision].split(' (')[0]) : '—'}</td>
      </tr>
      <tr class="rp-acc"><td></td><td colspan="5">${r.acciones.map((a, k) => `${(e.hechas || []).includes(k) ? '☑' : '☐'} ${esc(a.texto)} <span class="rp-muted">(${esc(a.fuente)})</span>`).join('<br>')}</td></tr>`;
    }).join('');
    return `
      <p>${riesgos.length} riesgos identificados a partir de los datos · ${evaluados} evaluados por el usuario. La probabilidad, el impacto y la decisión son del usuario; la herramienta no los asigna.</p>
      ${evaluados ? matriz(riesgos, ev, nivel) : ''}
      <table class="rp-reg">
        <thead><tr><th>Id</th><th>Riesgo y evidencia</th><th>Prob.</th><th>Impacto</th><th>Nivel</th><th>Decisión</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
      <p class="rp-nota">Nivel = probabilidad × impacto (1–3 cada uno): 1–2 bajo, 3–4 medio, 6–9 alto. Convención del proyecto, no una norma.</p>`;
  }

  /** Construye el informe dentro de `contenedor` y abre el diálogo de impresión. */
  function imprimir(contenedor, d) {
    const m = d.modulos || {};
    const secciones = construirSecciones(d);
    const resumen = [...d.resumen, ...filasResumenExtra(d)];

    const datos = ['MPA/IMPLA (zonificación)', 'RENIPRESS (SUSALUD, ODC-By)', 'Padrón de ESCALE (MINEDU)', '© colaboradores de OpenStreetMap (ODbL, respaldo y transporte)', 'ANA, IGP y OpenStreetMap (cauces)', 'INGEMMET (peligros geológicos)', 'IGP (sismos reportados y zonas de peligro volcánico)', 'CENEPRED (escenario de riesgo ante El Niño por distrito)', 'Datos: Aptologia (precio de oferta, CC BY 4.0)'];
    if (m.desastre) datos.push('INGEMMET (GEOCATMIN), INEI, MVCS (E.030)');
    if (m.seguridad) datos.push('MININTER (SIDPOL)');

    contenedor.innerHTML = `
      <header class="rp-head">
        <div>
          <div class="rp-marca">GeoVerificador</div>
          <h1>Ficha del predio</h1>
          <p class="rp-sub">${esc(d.distritoTitulo)} · ${d.punto.lat.toFixed(6)}, ${d.punto.lon.toFixed(6)}</p>
        </div>
        <div class="rp-fecha">Generado el ${esc(d.fecha)}</div>
      </header>
      <p class="rp-aviso">Ficha informativa con datos públicos. No es una recomendación de compra ni reemplaza los certificados municipales. Las distancias son en línea recta.</p>

      <section class="rp-sec rp-resumen">
        <h2>Resumen</h2>
        <table class="rp-tabla">${resumen.map(([k, v]) => fila(k, esc(v))).join('')}</table>
      </section>

      ${secciones.map((s, i) => seccion(`${i + 1}. ${s.titulo}`, s.color, s.cuerpo, s.fuente)).join('')}

      <section class="rp-sec rp-limites">
        <h2>Limitaciones principales</h2>
        <ul>${limites(d).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      </section>
      <footer class="rp-pie">GeoVerificador · datos: ${datos.join(', ')}.</footer>`;

    // El título del documento es el nombre de archivo que propone «Guardar como PDF».
    const tituloOriginal = document.title;
    document.title = `ficha-predio_${d.punto.lat.toFixed(5)}_${d.punto.lon.toFixed(5)}`;
    const restaurar = () => { document.title = tituloOriginal; window.removeEventListener('afterprint', restaurar); };
    window.addEventListener('afterprint', restaurar);
    window.print();
  }

  return { imprimir, seccionQuebradas, seccionContexto, seccionPrecio, seccionVerificaciones, filasResumenExtra, construirSecciones, limites, estadoHtml };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Reporte;
