/**
 * reporte.js — Ficha del predio en PDF.
 *
 * Arma un informe legible con los mismos datos que muestra la aplicación (sin calcular nada nuevo) y abre el diálogo
 * de impresión del navegador, donde se elige «Guardar como PDF». Así no hace falta ninguna librería: el diseño del
 * informe está en las reglas @media print de styles.css.
 *
 * Recibe un objeto `d` con lo que ya calculó app.js (ver app.js, datosReporte).
 */
const Reporte = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Math.round(n).toLocaleString('es-PE');
  const dist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2).replace('.', ',')} km`);
  const coma = (n) => String(n).replace('.', ',');
  const fila = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;

  function seccion(titulo, color, cuerpo, fuente) {
    return `
      <section class="rp-sec" style="--rp-c:${color}">
        <h2>${esc(titulo)}</h2>
        ${cuerpo}
        ${fuente ? `<p class="rp-fuente">Fuente: ${esc(fuente)}</p>` : ''}
      </section>`;
  }

  function normativo(d) {
    if (d.zonaStatus === 'outside') return '<p>El punto está <strong>fuera del área zonificada</strong> del plano: no tiene zona asignada.</p>';
    if (d.zonaStatus !== 'ok') return '<p class="rp-muted">No se pudo consultar la zonificación.</p>';
    const z = d.zona;
    const r = z.regla || {};
    const filas = [
      fila('Zona', `<strong>${esc(z.codigo)}</strong> · ${esc(r.nombre || 'código sin reglas en la tabla')}`),
      fila('Condición', esc(d.badgeZona || '—')),
    ];
    const has = (v) => v !== null && v !== undefined && v !== '';
    const bm = (a, b) => (has(b) && b !== a ? `${a} (hasta ${b})` : `${a}`);
    if (has(r.pisos_base)) filas.push(fila('Pisos', esc(bm(r.pisos_base, r.pisos_max))));
    if (has(r.coef_base)) filas.push(fila('Coeficiente de edificación', esc(bm(r.coef_base, r.coef_max))));
    if (has(r.area_libre_pct)) filas.push(fila('Área libre mínima', `${esc(r.area_libre_pct)} %`));
    if (has(r.lote_min_m2)) filas.push(fila('Lote mínimo', `${num(r.lote_min_m2)} m²`));
    if (has(r.frente_min_m)) filas.push(fila('Frente mínimo', `${esc(r.frente_min_m)} m`));
    let calc = '';
    if (d.lote && d.potencial) {
      const [b, m] = d.potencial.construible;
      calc = `<p class="rp-destacado">Con un lote de ${num(d.lote)} m²: <strong>hasta ${num(b)} m² techados</strong>${m > b ? ` (${num(m)} m² en el caso máximo)` : ''}${d.potencial.ocupable ? `; el primer piso puede ocupar ${d.potencial.ocupable[0] === d.potencial.ocupable[1] ? `hasta ${num(d.potencial.ocupable[1])}` : `entre ${num(d.potencial.ocupable[0])} y ${num(d.potencial.ocupable[1])}`} m²` : ''}.${d.potencial.bajoLoteMinimo ? ' El lote es menor que el mínimo de la zona.' : ''}</p>`;
    } else if (d.lote) {
      calc = '<p class="rp-muted">No se calculan m² construibles: la zona no fija un coeficiente o no es construible.</p>';
    }
    return `<table class="rp-tabla">${filas.join('')}</table>${r.nota ? `<p class="rp-nota">${esc(r.nota)}</p>` : ''}${calc}`;
  }

  function desastre(d) {
    let html = '';
    if (d.zonaRiesgo) html += `<p class="rp-alerta">El plano de zonificación ubica el punto en zona de riesgo muy alto (${esc(d.zona.codigo)}).</p>`;
    if (d.peligro) {
      const p = d.peligro;
      const m = p.masCercano;
      html += `<table class="rp-tabla">
        ${fila(`Peligros geológicos registrados a ${p.radio} m`, `<strong>${num(p.total)}</strong>${p.porTipo.length ? ` (${p.porTipo.map(([t, n]) => `${esc(t)} ${n}`).join(', ')})` : ''}`)}
        ${fila('Registro más cercano', `${dist(m.distancia)} · ${esc(m.subtipo || m.tipo)}${m.sector ? ` · «${esc(m.sector)}»` : ''}${m.anio ? ` · ${esc(m.anio)}` : ''}`)}
      </table>
      <p class="rp-nota">Es un inventario de eventos documentados (${esc(p.meta.anioDesde)}–${esc(p.meta.anioHasta)}): que no haya registros no significa que el lugar sea seguro.</p>`;
    } else html += '<p class="rp-muted">No se pudo consultar el inventario de peligros.</p>';
    if (d.distrito) {
      html += `<table class="rp-tabla">${fila('Zona sísmica (Norma E.030 2026)', `<strong>Zona ${esc(d.distrito.zona)} · Z = ${coma(d.distrito.z)}</strong> (distrito de ${esc(d.distritoNombre)})`)}</table>
      <p class="rp-nota">Z: aceleración máxima horizontal en suelo rígido con 10 % de probabilidad de ser excedida en 50 años, como fracción de la gravedad. No considera el suelo del predio.</p>`;
    }
    return html;
  }

  function seguridad(d) {
    if (!d.delito) return '<p class="rp-muted">No se pudo calcular el indicador de denuncias.</p>';
    const { total, ROBO, HURTO } = d.delito.conteo;
    return `<table class="rp-tabla">
      ${fila(`Denuncias de robo y hurto a ${d.delito.radio} m`, `<strong>${num(total)}</strong> (${num(ROBO)} robos, ${num(HURTO)} hurtos)`)}
      ${fila('Periodo', `${d.delito.meta.meses} meses (${esc(d.periodo)}); ${Math.round(d.delito.meta.coberturaVentana * 100)} % de las denuncias del periodo trae ubicación`)}
    </table>
    <p class="rp-nota">Son denuncias con ubicación, no todos los delitos. Robo: con violencia o amenaza; hurto: sin violencia.</p>`;
  }

  function entorno(d) {
    if (!d.entorno) return '<p class="rp-muted">No se analizó el entorno (requiere consultar OpenStreetMap desde la pestaña Entorno).</p>';
    const filas = d.entorno.categorias.map((c) => fila(c.label, `<strong>${c.total}</strong>${c.cercanos.length ? ` · más cercanos: ${c.cercanos.map((i) => `${esc(i.nombre)} (${dist(i.distancia)})`).join('; ')}` : ''}`));
    return `<table class="rp-tabla">${filas.join('')}</table><p class="rp-nota">Elementos de OpenStreetMap en ${d.entorno.radio} m (datos OSM al ${esc(d.entorno.fecha || 's. d.')}). OSM es colaborativo: algo ausente puede existir.</p>`;
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
    const { riesgos, evaluacion: ev, nivel, escala, decisiones } = d.registro;
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
    contenedor.innerHTML = `
      <header class="rp-head">
        <div>
          <div class="rp-marca">GeoVerificador</div>
          <h1>Ficha de riesgos del predio</h1>
          <p class="rp-sub">${esc(d.distritoTitulo)} · ${d.punto.lat.toFixed(6)}, ${d.punto.lon.toFixed(6)}</p>
        </div>
        <div class="rp-fecha">Generado el ${esc(d.fecha)}</div>
      </header>
      <p class="rp-aviso">Ficha informativa con datos públicos. No es una recomendación de compra ni reemplaza los certificados municipales, un estudio de suelos ni una evaluación de riesgo.</p>

      <section class="rp-sec rp-resumen">
        <h2>Resumen</h2>
        <table class="rp-tabla">${d.resumen.map(([k, v]) => fila(k, esc(v))).join('')}</table>
      </section>

      ${seccion('1. Riesgo normativo: zonificación', '#4f46e5', normativo(d), d.fuentes.zonificacion)}
      ${seccion('2. Riesgo de desastre', '#ea580c', desastre(d), `${d.fuentes.peligros}; ${d.fuentes.distritos}`)}
      ${seccion('3. Riesgo de seguridad', '#dc2626', seguridad(d), d.fuentes.delitos)}
      ${seccion('4. Entorno', '#16a34a', entorno(d), 'OpenStreetMap (ODbL) vía Overpass API')}
      ${seccion('5. Registro de riesgos', '#0f766e', registro(d), '')}

      <section class="rp-sec rp-limites">
        <h2>Limitaciones principales</h2>
        <ul>
          <li>La zonificación es la del PDM 2016-2025, cuya vigencia de 10 años se cumplió; hay un PDM nuevo en trámite y una sentencia (183-2019) que suspendió ciertos actos para predios antes agrícolas o de reserva paisajista.</li>
          <li>Los peligros geológicos son un inventario de eventos documentados, no un mapa de susceptibilidad. La zona sísmica es regional y no considera el suelo del predio. No se evalúa el peligro volcánico (Misti).</li>
          <li>Las denuncias no son todos los delitos y solo se cuentan las que tienen ubicación.</li>
          <li>Metodología, fuentes y validaciones completas: docs/METODOLOGIA.md y docs/VALIDACION.md del proyecto.</li>
        </ul>
      </section>
      <footer class="rp-pie">GeoVerificador · datos: MPA/IMPLA, INGEMMET (GEOCATMIN), INEI, MVCS (E.030), MININTER (SIDPOL), © colaboradores de OpenStreetMap.</footer>`;

    // El título del documento es el nombre de archivo que propone «Guardar como PDF».
    const tituloOriginal = document.title;
    document.title = `ficha-predio_${d.punto.lat.toFixed(5)}_${d.punto.lon.toFixed(5)}`;
    const restaurar = () => { document.title = tituloOriginal; window.removeEventListener('afterprint', restaurar); };
    window.addEventListener('afterprint', restaurar);
    window.print();
  }

  return { imprimir };
})();
