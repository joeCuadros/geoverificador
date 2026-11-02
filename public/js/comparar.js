/**
 * comparar.js — Lógica pura de «Comparar puntos» (sin DOM, sin red).
 *
 * La persona guarda hasta 3 puntos candidatos y ve, lado a lado, sus variables (estado, distancia y umbral) más un contexto
 * de riesgo informativo. NO hay puntaje global: no existe una base para decidir cuánto pesa cada variable. Lo único que se calcula es
 * si cada punto cumple las variables que la PERSONA marcó como prioridad; el conteo («2 de 3») y la lista de cuáles
 * cumplen son recuentos, no ponderaciones. Para la zonificación, «cumple» significa que el plano la marca como construible.
 *
 * INFORMATIVO: estado de lo que no tiene umbral normativo (la distancia a una quebrada, los peligros registrados y los
 * sismos recientes). Solo la cercanía a quebradas puede pasar a CUMPLE / NO CUMPLE, y únicamente con el umbral que fije la
 * persona en «Mis umbrales» (public/js/umbrales.js). Los peligros y los sismos son contexto: nunca son prioridad.
 *
 * Se carga como script del navegador (define `Comparar`) y también como módulo CommonJS para las pruebas
 * (test/comparar.spec.ts). app.js y comparar-ui.js son quienes tocan el DOM; aquí solo viven las decisiones.
 */
const Comparar = (() => {
  const C = typeof Calculos !== 'undefined' ? Calculos : require('./calculos.js'); // eslint-disable-line no-undef

  const MAX_CANDIDATOS = 3;
  const CLAVE_PRIORIDADES = 'geoverificador.prioridades';
  const CLAVE_CANDIDATOS = 'geoverificador.candidatos';
  const DISTANCIA_MISMO_PUNTO_M = 5; // dos puntos a menos de esto se consideran el mismo
  const NIVELES = ['inicial', 'primaria', 'secundaria'];
  const ESTADOS = ['CUMPLE', 'NO CUMPLE', 'SIN DATO', 'PARCIAL', 'INFORMATIVO'];

  const VARIABLES = [
    { id: 'zonificacion', titulo: 'Zonificación', ayuda: 'Cumple si el plano la marca como construible' },
    { id: 'salud', titulo: 'Salud', ayuda: 'Establecimiento de salud dentro de la distancia de referencia' },
    { id: 'educacion', titulo: 'Colegio', ayuda: 'Colegio de los tres niveles dentro de su distancia de referencia' },
    { id: 'transporte', titulo: 'Paradero', ayuda: 'Paradero dentro de la distancia de referencia' },
    { id: 'areaVerde', titulo: 'Área verde', ayuda: 'Área verde de al menos 5 000 m² dentro de la distancia de referencia' },
    { id: 'quebradas', titulo: 'Quebradas y cauces', ayuda: 'A la distancia mínima de una quebrada o río que fijes en «Mis umbrales». Sin tu umbral solo es informativo' },
  ];
  const IDS = VARIABLES.map((v) => v.id);
  /** Filas informativas de la tabla: contexto, nunca prioridad. */
  const CONTEXTO = [
    { id: 'peligros', titulo: 'Peligros geológicos registrados' },
    { id: 'sismos', titulo: 'Sismos recientes (IGP)' },
  ];

  const esNumero = (n) => typeof n === 'number' && Number.isFinite(n);
  const esTexto = (t) => typeof t === 'string';

  // ------------------------------------------------------------------ Formato

  function fmtDist(m) {
    if (!esNumero(m)) return '';
    if (m < 1000) return `${Math.round(m)} m`;
    return `${(m / 1000).toFixed(2).replace('.', ',')} km`;
  }
  const fmtRef = (m) => `${Math.round(m)} m`; // los umbrales se dicen siempre en metros, como en la ficha

  // ------------------------------------------------------------ Instantánea

  /** Estado de «Colegio» a partir de los tres niveles; la misma regla de la tarjeta de la ficha. */
  function estadoEducacion(niveles) {
    const lista = NIVELES.map((n) => niveles[n]);
    const cumplen = lista.filter((r) => r.estado === 'CUMPLE').length;
    if (cumplen === lista.length) return 'CUMPLE';
    if (lista.every((r) => r.estado === 'SIN DATO')) return 'SIN DATO';
    return cumplen === 0 ? 'NO CUMPLE' : 'PARCIAL';
  }

  const servicio = (r) => ({
    estado: ESTADOS.includes(r && r.estado) ? r.estado : 'SIN DATO',
    distanciaM: r && esNumero(r.distanciaM) ? r.distanciaM : null,
    umbralM: r && esNumero(r.umbralM) ? r.umbralM : null,
    nombre: r && esTexto(r.nombre) ? r.nombre : null,
  });

  function variableZonificacion(zona) {
    if (!zona) return { estado: 'SIN DATO', texto: 'Fuera del área zonificada', codigo: null, nombre: null, bordeM: null };
    const r = zona.regla;
    const borde = zona.borde && zona.borde.alerta && esNumero(zona.borde.distanciaM) ? zona.borde.distanciaM : null;
    const base = { codigo: zona.codigo || null, nombre: r ? r.nombre : null, bordeM: borde };
    if (!r) return { ...base, estado: 'SIN DATO', texto: 'Sin reglas en la tabla' };
    if (r.edificable === 'si') return { ...base, estado: 'CUMPLE', texto: 'Construible' };
    if (r.edificable === 'condicionado') return { ...base, estado: 'PARCIAL', texto: 'Requiere consulta' };
    if (r.edificable === 'no') return { ...base, estado: 'NO CUMPLE', texto: 'No construible' };
    return { ...base, estado: 'SIN DATO', texto: 'Sin condición definida' };
  }

  // Cauce más cercano, sin aplicar todavía el umbral del usuario (eso lo hace conUmbrales al mostrar): se guarda la distancia.
  function variableQuebradas(cauce) {
    const d = cauce && esNumero(cauce.distanciaM) ? cauce.distanciaM : null;
    return {
      estado: d === null ? 'SIN DATO' : 'INFORMATIVO',
      distanciaM: d,
      umbralM: null,
      nombre: cauce && esTexto(cauce.nombre) ? cauce.nombre : null,
      tipo: cauce && esTexto(cauce.tipo) ? cauce.tipo : null,
      segunUmbralUsuario: false,
    };
  }

  const contextoPeligros = (p) => ({
    estado: p && p.estado === 'INFORMATIVO' && esNumero(p.total) ? 'INFORMATIVO' : 'SIN DATO',
    total: p && esNumero(p.total) ? p.total : null,
    radioM: p && esNumero(p.radioM) ? p.radioM : null,
    distanciaM: p && esNumero(p.distanciaM) ? p.distanciaM : null,
    tipo: p && p.masCercano ? p.masCercano.subtipo || p.masCercano.tipo || null : null,
  });

  const contextoSismos = (s) => ({
    estado: s && s.estado === 'INFORMATIVO' && esNumero(s.total) ? 'INFORMATIVO' : 'SIN DATO',
    total: s && esNumero(s.total) ? s.total : null,
    radioM: s && esNumero(s.radioM) ? s.radioM : null,
    magnitudMaxima: s && esNumero(s.magnitudMaxima) ? s.magnitudMaxima : null,
    desde: s && esTexto(s.desde) ? s.desde : null,
    hasta: s && esTexto(s.hasta) ? s.hasta : null,
  });

  /**
   * Instantánea de un punto con lo que la ficha ya calculó.
   *   entrada: { lat, lon, etiqueta, distrito, zona, entorno, cauce, contexto }
   *     entorno  = resultado de Equipamiento.evaluar
   *     cauce    = resultado de Contexto.quebradas (si falta, la variable queda SIN DATO)
   *     contexto = { peligros, sismos } de Contexto (si faltan, esas filas quedan SIN DATO)
   * Devuelve null si falta lo mínimo (coordenadas o el entorno), para no guardar un punto a medias.
   */
  function crearCandidato(entrada) {
    const { lat, lon, etiqueta = '', distrito = '', zona = null, entorno = null, cauce = null, contexto = null } = entrada || {};
    if (!esNumero(lat) || !esNumero(lon) || !entorno || !entorno.educacion) return null;
    const niveles = Object.fromEntries(NIVELES.map((n) => [n, servicio(entorno.educacion[n])]));
    return {
      id: `${lat.toFixed(5)},${lon.toFixed(5)}`,
      lat,
      lon,
      etiqueta: String(etiqueta || '').trim() || 'Punto elegido en el mapa',
      distrito: String(distrito || ''),
      fechaDatos: (entorno.salud && entorno.salud.fecha) || null,
      variables: {
        zonificacion: variableZonificacion(zona),
        salud: servicio(entorno.salud),
        educacion: { estado: estadoEducacion(niveles), niveles },
        transporte: servicio(entorno.transporte),
        areaVerde: servicio(entorno.areaVerde),
        quebradas: variableQuebradas(cauce),
      },
      contexto: { peligros: contextoPeligros(contexto && contexto.peligros), sismos: contextoSismos(contexto && contexto.sismos) },
    };
  }

  /**
   * Aplica los umbrales de la persona al candidato (sin modificarlo): con una distancia mínima a quebradas, esa variable pasa de
   * INFORMATIVO a CUMPLE / NO CUMPLE «según tu umbral». Sin umbral queda INFORMATIVO. Lo guardado no cambia: la distancia
   * se conserva y el estado se calcula al mostrar, así cambiar el umbral vale para los puntos ya guardados.
   */
  function conUmbrales(candidato, umbrales) {
    const q = candidato.variables.quebradas;
    const u = umbrales && esNumero(umbrales.quebradaMinM) && umbrales.quebradaMinM > 0 ? umbrales.quebradaMinM : null;
    const estado = C.clasificarCauce(q.distanciaM, u);
    return { ...candidato, variables: { ...candidato.variables, quebradas: { ...q, estado, umbralM: u, segunUmbralUsuario: u !== null && estado !== 'SIN DATO' } } };
  }

  // ----------------------------------------------------------------- Lista

  /** Agrega un candidato sin pasar de 3 ni repetir el mismo punto. No modifica la lista recibida. */
  function agregar(lista, candidato) {
    const actual = Array.isArray(lista) ? lista : [];
    if (!candidato) return { lista: actual, ok: false, motivo: 'incompleto' };
    const repetido = actual.some((c) => c.id === candidato.id || C.haversine(c.lat, c.lon, candidato.lat, candidato.lon) < DISTANCIA_MISMO_PUNTO_M);
    if (repetido) return { lista: actual, ok: false, motivo: 'repetido' };
    if (actual.length >= MAX_CANDIDATOS) return { lista: actual, ok: false, motivo: 'lleno' };
    return { lista: [...actual, candidato], ok: true, motivo: null };
  }

  const quitar = (lista, id) => (Array.isArray(lista) ? lista.filter((c) => c.id !== id) : []);

  /** ¿Ese punto (lat, lon) ya está guardado? Sirve para cambiar el texto del botón. */
  function estaGuardado(lista, lat, lon) {
    return (Array.isArray(lista) ? lista : []).some((c) => C.haversine(c.lat, c.lon, lat, lon) < DISTANCIA_MISMO_PUNTO_M);
  }

  // ------------------------------------------------------------ Prioridades

  /** Deja solo variables conocidas, sin repetir y en el orden de VARIABLES. */
  function normalizarPrioridades(valor) {
    const set = new Set(Array.isArray(valor) ? valor : []);
    return IDS.filter((id) => set.has(id));
  }

  function alternar(prioridades, id) {
    if (!IDS.includes(id)) return normalizarPrioridades(prioridades);
    const set = new Set(normalizarPrioridades(prioridades));
    if (set.has(id)) set.delete(id); else set.add(id);
    return normalizarPrioridades([...set]);
  }

  /**
   * ¿Cumple el punto lo que la persona marcó como prioridad? Es un recuento, no un puntaje:
   *   resultado: 'sin-prioridades' (nada marcado) | 'cumple' (todas CUMPLE) | 'no-cumple' (alguna NO CUMPLE o PARCIAL)
   *              | 'incompleto' (ninguna incumple, pero falta dato o umbral en alguna: no se puede confirmar)
   *   `informativas` lista las prioridades que no se pueden confirmar porque no hay umbral de la persona (hoy, quebradas).
   *   `umbrales` = { quebradaMinM } de «Mis umbrales» (opcional).
   */
  function evaluarPrioridades(candidato, prioridades, umbrales = null) {
    const ids = normalizarPrioridades(prioridades);
    if (ids.length === 0) return { resultado: 'sin-prioridades', total: 0, cumplen: [], noCumplen: [], sinDato: [], informativas: [] };
    const c = conUmbrales(candidato, umbrales);
    const out = { cumplen: [], noCumplen: [], sinDato: [], informativas: [] };
    ids.forEach((id) => {
      const estado = c.variables[id].estado;
      if (estado === 'CUMPLE') out.cumplen.push(id);
      else if (estado === 'SIN DATO') out.sinDato.push(id);
      else if (estado === 'INFORMATIVO') out.informativas.push(id); // sin umbral de la persona no se puede decir que cumple
      else out.noCumplen.push(id); // NO CUMPLE o PARCIAL: no se confirma que cumpla del todo
    });
    const resultado = out.noCumplen.length > 0 ? 'no-cumple' : out.sinDato.length + out.informativas.length > 0 ? 'incompleto' : 'cumple';
    return { resultado, total: ids.length, ...out };
  }

  /** ids de los candidatos que cumplen todas las prioridades marcadas (vacío si no hay prioridades). */
  function quienesCumplen(candidatos, prioridades, umbrales = null) {
    if (normalizarPrioridades(prioridades).length === 0) return [];
    return (candidatos || []).filter((c) => evaluarPrioridades(c, prioridades, umbrales).resultado === 'cumple').map((c) => c.id);
  }

  /**
   * Dominancia entre pares, solo con las prioridades marcadas: A domina a B si A cumple todas las prioridades que cumple B
   * y además alguna más. Es una relación entre dos puntos, NO un ganador: no se suman ni se ponderan variables, y un punto
   * puede no dominar a ninguno aunque sea el mejor para la persona (por ejemplo, si cumple una prioridad que el otro no y
   * al revés). La vista debe decirlo con esas palabras y nunca declarar un ganador.
   *   Devuelve [{ mayor: id, menor: id, extra: [variable…] }]   (extra = prioridades que cumple A y no B)
   */
  function dominancias(candidatos, prioridades, umbrales = null) {
    const ids = normalizarPrioridades(prioridades);
    const lista = candidatos || [];
    if (ids.length === 0) return [];
    const cumplen = new Map(lista.map((c) => [c.id, new Set(evaluarPrioridades(c, ids, umbrales).cumplen)]));
    const out = [];
    lista.forEach((a) => {
      lista.forEach((b) => {
        if (a.id === b.id) return;
        const A = cumplen.get(a.id);
        const B = cumplen.get(b.id);
        if (B.size < A.size && [...B].every((x) => A.has(x))) out.push({ mayor: a.id, menor: b.id, extra: ids.filter((id) => A.has(id) && !B.has(id)) });
      });
    });
    return out;
  }

  // ----------------------------------------------------------------- Celdas

  /**
   * Contenido de una celda de la tabla: estado y líneas de texto.
   *   partes: [{ etiqueta?, estado?, texto }]   (Colegio trae una por nivel)
   */
  function celda(candidato, id, umbrales = null) {
    const v = conUmbrales(candidato, umbrales).variables[id];
    if (id === 'quebradas') {
      if (v.distanciaM === null) return { estado: v.estado, partes: [{ texto: 'Sin dato' }] };
      const partes = [{ texto: `${v.nombre || 'Sin nombre'}${v.tipo && !String(v.nombre).startsWith(v.tipo) ? ` (${v.tipo.toLowerCase()})` : ''} · ${fmtDist(v.distanciaM)} en línea recta` }];
      partes.push({ texto: v.segunUmbralUsuario ? `Según tu umbral: al menos ${fmtRef(v.umbralM)}` : 'Sin umbral normativo: solo informativo' });
      return { estado: v.estado, partes };
    }
    if (id === 'zonificacion') {
      const texto = v.codigo ? `${v.codigo} · ${v.texto}` : v.texto;
      const partes = [{ texto }];
      if (v.bordeM !== null) partes.push({ texto: `Otra zona a ${fmtDist(v.bordeM)} en línea recta` });
      return { estado: v.estado, partes };
    }
    // Toda distancia se rotula «en línea recta»: no es el recorrido a pie.
    const linea = (r) => (r.distanciaM === null ? 'Sin dato' : `${fmtDist(r.distanciaM)} en línea recta · ref. ${r.umbralM === null ? '—' : fmtRef(r.umbralM)}`);
    if (id === 'educacion') {
      return {
        estado: v.estado,
        partes: NIVELES.map((n) => ({ etiqueta: n.charAt(0).toUpperCase() + n.slice(1), estado: v.niveles[n].estado, texto: linea(v.niveles[n]) })),
      };
    }
    return { estado: v.estado, partes: [{ texto: linea(v) }] };
  }

  /** Filas de contexto (peligros y sismos): estado INFORMATIVO o SIN DATO y líneas de texto. Nunca son prioridad. */
  function celdaContexto(candidato, id) {
    const v = candidato.contexto[id];
    if (v.estado !== 'INFORMATIVO') return { estado: 'SIN DATO', partes: [{ texto: 'Sin dato' }] };
    if (id === 'peligros') {
      const partes = [{ texto: `${v.total} registrado${v.total === 1 ? '' : 's'} a ${fmtRef(v.radioM)} o menos` }];
      if (v.distanciaM !== null) partes.push({ texto: `El más cercano a ${fmtDist(v.distanciaM)} en línea recta${v.tipo ? ` (${v.tipo.toLowerCase()})` : ''}` });
      return { estado: 'INFORMATIVO', partes };
    }
    const partes = [{ texto: `${v.total} sismo${v.total === 1 ? '' : 's'} a ${v.radioM / 1000} km o menos (en línea recta)` }];
    if (v.magnitudMaxima !== null) partes.push({ texto: `Magnitud máxima: ${String(v.magnitudMaxima).replace('.', ',')}` });
    if (v.desde && v.hasta) partes.push({ texto: `Periodo: ${v.desde} a ${v.hasta}` });
    return { estado: 'INFORMATIVO', partes };
  }

  // ------------------------------------------------------------ Almacenamiento
  // El almacenamiento del navegador puede faltar o lanzar (ventana privada, datos bloqueados): nunca debe romper la página.

  function leerPrioridades(almacen) {
    try {
      const crudo = almacen && almacen.getItem(CLAVE_PRIORIDADES);
      return crudo ? normalizarPrioridades(JSON.parse(crudo)) : [];
    } catch (err) {
      return [];
    }
  }

  function guardarPrioridades(almacen, prioridades) {
    try {
      if (almacen) almacen.setItem(CLAVE_PRIORIDADES, JSON.stringify(normalizarPrioridades(prioridades)));
    } catch (err) {
      /* sin almacenamiento: las prioridades valen mientras la página siga abierta */
    }
  }

  function candidatoValido(c) {
    if (!c || !esTexto(c.id) || !esNumero(c.lat) || !esNumero(c.lon) || !esTexto(c.etiqueta) || !c.variables) return false;
    const v = c.variables;
    if (!IDS.every((id) => v[id] && ESTADOS.includes(v[id].estado))) return false;
    if (!v.educacion.niveles || !NIVELES.every((n) => v.educacion.niveles[n] && ESTADOS.includes(v.educacion.niveles[n].estado))) return false;
    return !!c.contexto && CONTEXTO.every((x) => c.contexto[x.id] && ESTADOS.includes(c.contexto[x.id].estado));
  }

  /** Lee los puntos guardados; descarta lo que no tenga la forma esperada (datos viejos o alterados). */
  function leerCandidatos(almacen) {
    try {
      const crudo = almacen && almacen.getItem(CLAVE_CANDIDATOS);
      const lista = crudo ? JSON.parse(crudo) : [];
      return Array.isArray(lista) ? lista.filter(candidatoValido).slice(0, MAX_CANDIDATOS) : [];
    } catch (err) {
      return [];
    }
  }

  function guardarCandidatos(almacen, candidatos) {
    try {
      if (almacen) almacen.setItem(CLAVE_CANDIDATOS, JSON.stringify((candidatos || []).slice(0, MAX_CANDIDATOS)));
    } catch (err) {
      /* sin almacenamiento: los puntos valen mientras la página siga abierta */
    }
  }

  return {
    MAX_CANDIDATOS, VARIABLES, CONTEXTO, NIVELES, CLAVE_PRIORIDADES, CLAVE_CANDIDATOS,
    estadoEducacion, crearCandidato, conUmbrales, agregar, quitar, estaGuardado,
    normalizarPrioridades, alternar, evaluarPrioridades, quienesCumplen, dominancias, celda, celdaContexto, fmtDist,
    leerPrioridades, guardarPrioridades, leerCandidatos, guardarCandidatos,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Comparar;
