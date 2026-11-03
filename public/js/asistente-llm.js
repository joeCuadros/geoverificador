/**
 * asistente-llm.js — Contrato entre el asistente y el modelo de lenguaje (Gemini). Sin DOM y sin claves.
 *
 * El modelo NUNCA calcula ni redacta datos por su cuenta. Solo hace dos cosas acotadas:
 *   1. INTERPRETAR: convierte la frase en una consulta estructurada (la herramienta `HERRAMIENTA`). Lo que devuelve se valida
 *      con `validarSpec` (campos desconocidos, enumeraciones y rangos) antes de usarse, en el servidor y de nuevo en el navegador.
 *   2. REDACTAR: reescribe en pocas líneas el resultado que ya calculó el motor determinista. `verificarTexto` comprueba que
 *      cada cifra del texto exista en ese resultado; si no, se usa el texto determinista.
 * Los números y los estados salen siempre de Asistente (asistente.js) con los datos congelados del navegador.
 *
 * Se carga como script del navegador (define `AsistenteLLM`) y como módulo CommonJS (servidor y pruebas).
 */
const AsistenteLLM = (() => {
  // Se resuelve al usarlo: el servidor valida y verifica sin necesitar el motor de búsqueda.
  const motor = () => (typeof Asistente !== 'undefined' ? Asistente : require('./asistente.js')); // eslint-disable-line no-undef


  const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const esNumero = (n) => typeof n === 'number' && Number.isFinite(n);
  const ausente = (v) => v === undefined || v === null;

  // ------------------------------------------------------------------ Esquema

  const INTENCIONES = [
    'buscar', 'zona', 'construir', 'cambio_zonificacion', 'resumen', 'quebradas', 'sismos', 'peligros', 'servicio_cercano', 'rutas', 'precio_distrito',
    'fuentes', 'ayuda', 'saludo', 'fuera_de_alcance', 'desconocido', 'contar_en_distrito', 'perfil_distrito', 'mejor_zona', 'volcan',
  ];
  const FENOMENOS = ['lahar', 'flujo_piroclastico', 'lava', 'avalancha', 'ceniza'];
  const CRITERIOS = ['salud', 'colegio', 'inicial', 'primaria', 'secundaria', 'transporte', 'areaVerde', 'campina', 'residencial', 'tranquilo', 'comercial', 'historico', 'lejosQuebrada'];
  const SERVICIOS = ['salud', 'colegio', 'inicial', 'primaria', 'secundaria', 'transporte', 'areaVerde'];
  const MODOS = ['nuevo', 'agregar', 'quitar', 'priorizar'];
  const TEMAS = ['seguridad', 'precio', 'ruido'];
  const CAMPOS = ['intencion', 'criterios', 'prioridades', 'distancias', 'radioM', 'lejosQuebradaM', 'incluirCondicional', 'cercaDeMiPunto', 'modo', 'loteM2', 'tema', 'distrito', 'fenomeno'];

  // Rangos a los que se ajustan las distancias y el lote (en metros y m²). Un valor fuera de rango se recorta, no se rechaza.
  const RANGOS = { radioM: [100, 5000], lejosQuebradaM: [50, 5000], distanciaM: [50, 5000], loteM2: [10, 100000] };
  const MAX_ITEMS = 12;
  const MAX_DISTRITO = 60;
  // Un nombre de distrito: letras (con tildes), espacios y algún signo de nombres propios. Nada que parezca una instrucción.
  const FORMA_DISTRITO = /^[\p{L}\p{M} .'’-]{2,60}$/u;

  /** Declaración de la única función que el modelo puede llamar (formato functionDeclarations de la API de Gemini). */
  const HERRAMIENTA = {
    name: 'consulta_asistente',
    description: 'Registra qué quiere saber o buscar la persona, como una consulta estructurada. Es la única salida permitida: no responde a la persona.',
    parameters: {
      type: 'object',
      properties: {
        intencion: {
          type: 'string',
          enum: INTENCIONES,
          description: 'buscar = encontrar zonas de la ciudad por lo que importa a la persona; zona = qué zona es su punto; construir = cuánto se puede construir en su punto; cambio_zonificacion = si el plan nuevo cambiará la zonificación; resumen = resumen/ficha del punto; quebradas, sismos, peligros = contexto de riesgo del punto; volcan = peligro volcánico del Misti (lahares, ceniza, flujos piroclásticos, lava, avalanchas) en su punto o en un distrito; servicio_cercano = si hay un servicio cerca de su punto; precio_distrito = precio de oferta por m² promedio de un distrito (por ejemplo «cuánto cuesta el m² en Cayma»); rutas = qué líneas de bus o combi pasan cerca de su punto o por un distrito (distrito = el distrito; vacío si pregunta por su punto); fuentes = de dónde salen los datos; ayuda; saludo; fuera_de_alcance = solo seguridad, ruido, el precio de una casa o terreno en particular, alquileres o búsquedas por precio; contar_en_distrito = cuántos colegios, postas, paraderos o parques hay en un distrito (criterios = lo que se cuenta, distrito = el distrito); perfil_distrito = la persona habla de un distrito sin pedir algo concreto («quiero vivir en Paucarpata», «cómo es Cayma»); mejor_zona = pide la mejor zona o dónde vivir sin nombrar un distrito ni decir qué le importa; desconocido = no se entiende o no tiene relación.',
        },
        criterios: {
          type: 'array',
          items: { type: 'string', enum: CRITERIOS },
          description: 'Lo que la persona quiere tener cerca (buscar) o los servicios por los que pregunta (servicio_cercano). colegio sin nivel = inicial o primaria. tranquilo, comercial e historico son aproximaciones con la zonificación.',
        },
        prioridades: {
          type: 'array',
          items: { type: 'string', enum: CRITERIOS },
          description: 'Criterios que la persona marca como lo más importante. Deben estar también en criterios.',
        },
        distancias: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              criterio: { type: 'string', enum: CRITERIOS },
              metros: { type: 'number', description: 'Distancia máxima en metros (50 a 5000).' },
            },
            required: ['criterio', 'metros'],
          },
          description: 'Distancia propia de un criterio, solo si la persona la dijo para ese criterio (por ejemplo «colegio a 500 m»).',
        },
        radioM: { type: 'number', description: 'Una distancia en metros que vale para todos los criterios (por ejemplo «en un radio de 1 km» = 1000). Solo si la persona la dijo.' },
        lejosQuebradaM: { type: 'number', description: 'Distancia mínima en metros a quebradas y ríos (por ejemplo «lejos de quebradas a más de 200 m» = 200). Déjalo vacío si la persona no dio la distancia: nunca la inventes.' },
        incluirCondicional: { type: 'boolean', description: 'true solo si la persona pide incluir zonas condicionales o condicionadas.' },
        cercaDeMiPunto: { type: 'boolean', description: 'true solo si la persona quiere buscar alrededor de su punto («cerca de mi punto», «en mi zona»).' },
        modo: {
          type: 'string',
          enum: MODOS,
          description: 'nuevo (por defecto) = búsqueda nueva. agregar, quitar o priorizar = ajuste de la búsqueda anterior («agrega transporte», «quita el parque», «prioriza el colegio»); solo si ya hubo una búsqueda.',
        },
        loteM2: { type: 'number', description: 'Área del lote en m² cuando la persona la menciona (intencion construir).' },
        distrito: {
          type: 'string',
          description: 'Nombre del distrito de la provincia de Arequipa que la persona nombra, tal como lo escribió (con sus errores de tipeo): nunca lo corrijas ni inventes uno. Obligatorio en contar_en_distrito y perfil_distrito; en rutas y precio_distrito solo si nombra un distrito (vacío si habla de su punto: «por aquí», «cerca de mí»); en buscar solo si pide buscar dentro de un distrito.',
        },
        fenomeno: {
          type: 'string',
          enum: FENOMENOS,
          description: 'Solo en intencion volcan: el fenómeno volcánico por el que pregunta, si nombra uno (lahar = lahares o huaicos del volcán, flujo_piroclastico, lava, avalancha = avalancha de escombros, ceniza). Vacío si pregunta en general por el volcán o el Misti.',
        },
        tema: {
          type: 'string',
          enum: TEMAS,
          description: 'Si la persona menciona seguridad, ruido o el precio de un inmueble concreto, un alquiler o zonas por precio (datos que el asistente no tiene), el tema; también en una búsqueda que lo incluye.',
        },
      },
      required: ['intencion'],
    },
  };

  // --------------------------------------------------------------- Validación

  const rechazo = (motivo) => ({ ok: false, motivo });
  const recortar = (n, [min, max]) => Math.min(max, Math.max(min, Math.round(n)));

  function leerLista(v, permitidos, campo) {
    if (ausente(v)) return { lista: [] };
    if (!Array.isArray(v)) return { error: `${campo}_no_es_lista` };
    if (v.length > MAX_ITEMS) return { error: `${campo}_muy_larga` };
    const lista = [];
    for (const x of v) {
      if (typeof x !== 'string' || !permitidos.includes(x)) return { error: `${campo}_valor_invalido` };
      if (!lista.includes(x)) lista.push(x);
    }
    return { lista };
  }

  function leerDistrito(v) {
    if (ausente(v)) return { valor: null };
    if (typeof v !== 'string') return { error: 'distrito_no_es_texto' };
    const t = v.trim();
    if (t === '') return { error: 'distrito_vacio' };
    if (t.length > MAX_DISTRITO || !FORMA_DISTRITO.test(t)) return { error: 'distrito_invalido' };
    return { valor: t };
  }

  function leerNumero(v, rango, campo) {
    if (ausente(v)) return { valor: null };
    if (!esNumero(v)) return { error: `${campo}_no_es_numero` };
    return { valor: recortar(v, rango) };
  }

  /**
   * Valida lo que devolvió el modelo (o lo que envía un cliente) contra el esquema de `HERRAMIENTA`.
   * Rechaza campos desconocidos, tipos distintos y valores fuera de las enumeraciones; recorta los rangos numéricos.
   * Devuelve { ok: true, spec } con todos los campos completos, o { ok: false, motivo }.
   */
  function validarSpec(args) {
    if (!esObjeto(args)) return rechazo('no_es_objeto');
    const extra = Object.keys(args).find((k) => !CAMPOS.includes(k));
    if (extra !== undefined) return rechazo('campo_desconocido');
    if (typeof args.intencion !== 'string' || !INTENCIONES.includes(args.intencion)) return rechazo('intencion_invalida');

    const criterios = leerLista(args.criterios, CRITERIOS, 'criterios');
    if (criterios.error) return rechazo(criterios.error);
    const prioridades = leerLista(args.prioridades, CRITERIOS, 'prioridades');
    if (prioridades.error) return rechazo(prioridades.error);
    const radio = leerNumero(args.radioM, RANGOS.radioM, 'radioM');
    if (radio.error) return rechazo(radio.error);
    const cauce = leerNumero(args.lejosQuebradaM, RANGOS.lejosQuebradaM, 'lejosQuebradaM');
    if (cauce.error) return rechazo(cauce.error);
    const lote = leerNumero(args.loteM2, RANGOS.loteM2, 'loteM2');
    if (lote.error) return rechazo(lote.error);
    if (!ausente(args.incluirCondicional) && typeof args.incluirCondicional !== 'boolean') return rechazo('incluirCondicional_no_es_booleano');
    if (!ausente(args.cercaDeMiPunto) && typeof args.cercaDeMiPunto !== 'boolean') return rechazo('cercaDeMiPunto_no_es_booleano');
    if (!ausente(args.modo) && !MODOS.includes(args.modo)) return rechazo('modo_invalido');
    if (!ausente(args.tema) && !TEMAS.includes(args.tema)) return rechazo('tema_invalido');
    if (!ausente(args.fenomeno) && !FENOMENOS.includes(args.fenomeno)) return rechazo('fenomeno_invalido');
    const distrito = leerDistrito(args.distrito);
    if (distrito.error) return rechazo(distrito.error);

    let distancias = [];
    if (!ausente(args.distancias)) {
      if (!Array.isArray(args.distancias) || args.distancias.length > MAX_ITEMS) return rechazo('distancias_invalidas');
      for (const d of args.distancias) {
        if (!esObjeto(d) || Object.keys(d).some((k) => k !== 'criterio' && k !== 'metros')) return rechazo('distancias_invalidas');
        if (typeof d.criterio !== 'string' || !CRITERIOS.includes(d.criterio) || !esNumero(d.metros)) return rechazo('distancias_invalidas');
        distancias.push({ criterio: d.criterio, metros: recortar(d.metros, RANGOS.distanciaM) });
      }
    }

    const spec = {
      intencion: args.intencion,
      criterios: criterios.lista,
      prioridades: prioridades.lista,
      distancias,
      radioM: radio.valor,
      lejosQuebradaM: cauce.valor,
      incluirCondicional: args.incluirCondicional === true,
      cercaDeMiPunto: args.cercaDeMiPunto === true,
      modo: args.modo || 'nuevo',
      loteM2: lote.valor,
      tema: args.tema || null,
      distrito: distrito.valor,
    };
    // `fenomeno` solo existe en la consulta del volcán: en las demás no se añade, para no cambiar su forma.
    if (spec.intencion === 'volcan') spec.fenomeno = args.fenomeno || null;

    if (spec.intencion === 'buscar') {
      // Una distancia a quebradas es, por sí sola, el criterio «lejos de quebradas».
      if (spec.lejosQuebradaM !== null && !spec.criterios.includes('lejosQuebrada')) spec.criterios.push('lejosQuebrada');
      const dQ = distancias.find((d) => d.criterio === 'lejosQuebrada');
      if (dQ && spec.lejosQuebradaM === null) spec.lejosQuebradaM = dQ.metros;
      if (spec.modo === 'priorizar' && spec.criterios.length === 0) spec.criterios = [...spec.prioridades];
      spec.prioridades = spec.prioridades.filter((p) => spec.criterios.includes(p));
      spec.distancias = distancias.filter((d) => d.criterio !== 'lejosQuebrada' && spec.criterios.includes(d.criterio));
      const soloCondicional = spec.modo === 'agregar' && spec.incluirCondicional;
      if (spec.criterios.length === 0 && !soloCondicional) return rechazo('buscar_sin_criterios');
      return { ok: true, spec };
    }

    // Las demás intenciones no usan los campos de búsqueda: se vacían para que no se cuelen.
    const limpio = { ...spec, criterios: [], prioridades: [], distancias: [], radioM: null, lejosQuebradaM: null, incluirCondicional: false, cercaDeMiPunto: false, modo: 'nuevo', distrito: null };
    if (spec.intencion === 'rutas') limpio.distrito = spec.distrito;
    if (spec.intencion === 'volcan') limpio.distrito = spec.distrito; // vacío = su punto
    if (spec.intencion === 'contar_en_distrito' || spec.intencion === 'perfil_distrito') {
      if (spec.distrito === null) return rechazo('distrito_ausente');
      limpio.distrito = spec.distrito;
    }
    if (spec.intencion === 'contar_en_distrito') {
      limpio.criterios = spec.criterios.filter((c) => SERVICIOS.includes(c));
      if (limpio.criterios.length === 0) return rechazo('contar_sin_criterios');
    }
    if (spec.intencion === 'servicio_cercano') {
      limpio.criterios = spec.criterios.filter((c) => SERVICIOS.includes(c));
      if (limpio.criterios.length === 0) return rechazo('servicio_sin_criterios');
    }
    if (spec.intencion !== 'construir') limpio.loteM2 = null;
    if (spec.intencion === 'precio_distrito') limpio.distrito = spec.distrito; // vacío = el distrito de su punto
    if (spec.intencion === 'fuera_de_alcance' && !spec.tema) return rechazo('fuera_de_alcance_sin_tema');
    return { ok: true, spec: limpio };
  }

  /** Estructura de la ficha de estado que se envía al modelo: solo ids conocidos, nunca texto libre. */
  function sanitizarEstado(estado) {
    const e = esObjeto(estado) ? estado : {};
    const previos = Array.isArray(e.criteriosPrevios) ? e.criteriosPrevios.filter((c) => typeof c === 'string' && CRITERIOS.includes(c)).slice(0, MAX_ITEMS) : [];
    return { hayPunto: e.hayPunto === true, criteriosPrevios: previos };
  }

  const MAX_MENSAJE = 300;
  const MAX_TURNOS = 6;

  /** Últimos turnos de la conversación, recortados; solo roles conocidos y texto. */
  function sanitizarHistorial(historial) {
    if (!Array.isArray(historial)) return [];
    return historial
      .filter((h) => esObjeto(h) && (h.rol === 'usuario' || h.rol === 'asistente') && typeof h.texto === 'string' && h.texto.trim())
      .slice(-MAX_TURNOS)
      .map((h) => ({ rol: h.rol, texto: h.texto.trim().slice(0, MAX_MENSAJE) }));
  }

  // ----------------------------------------------- De la consulta al motor determinista

  const TIPO_DE_INTENCION = {
    zona: 'zona', construir: 'construir', cambio_zonificacion: 'pdm', resumen: 'ficha', quebradas: 'quebrada', sismos: 'sismos',
    peligros: 'peligros', volcan: 'volcan', fuentes: 'fuentes', ayuda: 'ayuda', saludo: 'saludo', mejor_zona: 'mejor_zona', precio_distrito: 'precio',
  };
  const distritos = () => (typeof Distritos !== 'undefined' ? Distritos : require('./distritos.js')); // eslint-disable-line no-undef

  /** El distrito que dijo el modelo, resuelto con el mismo buscador de nombres que usan las reglas. null si no es un distrito de la provincia. */
  function resolverDistrito(texto) {
    const r = distritos().buscarNombre(texto, { admitirCiudad: true });
    return r ? { distrito: r.distrito, distritoFuera: !r.enDatos } : null;
  }

  /**
   * Convierte una consulta ya validada en la intención que entiende el motor (la misma estructura de Asistente.interpretar).
   *   ctx: { ultimaBusqueda?: { criterios } } — sin búsqueda anterior, «agrega…», «quita…» y «prioriza…» son una búsqueda nueva.
   */
  function aIntencion(spec, ctx = {}) {
    const A = motor();
    const vacia = A.interpretar('');
    if (spec.intencion === 'desconocido') return vacia;
    if (spec.intencion === 'mejor_zona') return { ...vacia, tipo: 'mejor_zona' };
    const conDistrito = ['contar_en_distrito', 'perfil_distrito'].includes(spec.intencion) || (['rutas', 'precio_distrito', 'volcan'].includes(spec.intencion) && spec.distrito) || (spec.intencion === 'buscar' && spec.distrito);
    const dis = conDistrito ? resolverDistrito(spec.distrito) : null;
    if (conDistrito && !dis) return { ...vacia, tipo: 'distrito_desconocido', distritoTexto: spec.distrito };
    if (spec.intencion === 'perfil_distrito') return { ...vacia, tipo: 'perfil', ...dis };
    if (spec.intencion === 'contar_en_distrito') {
      return { ...vacia, tipo: 'contar', criterios: spec.criterios.map((id) => ({ id, umbralM: null, prioridad: 1 })), ...dis };
    }
    if (spec.intencion === 'fuera_de_alcance') return { ...vacia, tipo: 'no_soportado', temaNoSoportado: spec.tema };
    if (spec.intencion === 'rutas') return { ...vacia, tipo: 'rutas', ...(dis || {}) };
    if (spec.intencion === 'volcan') return { ...vacia, tipo: 'volcan', volcanTipos: spec.fenomeno ? [spec.fenomeno] : [], ...(dis || {}) };
    if (spec.intencion === 'servicio_cercano') {
      return { ...vacia, tipo: 'servicio', criterios: spec.criterios.map((id) => ({ id, umbralM: null, prioridad: 1 })) };
    }
    if (spec.intencion === 'buscar') {
      const hayPrevia = Boolean(ctx.ultimaBusqueda && ctx.ultimaBusqueda.criterios && ctx.ultimaBusqueda.criterios.length > 0);
      const modo = hayPrevia ? spec.modo : 'nuevo';
      const prioridades = modo === 'priorizar' && spec.prioridades.length === 0 ? spec.criterios : spec.prioridades;
      const q = A.construirConsulta({
        criterios: spec.criterios, prioridades, radioM: spec.radioM, incluirCondicional: spec.incluirCondicional,
        lejosQuebradaM: spec.lejosQuebradaM, cercaDeMiPunto: spec.cercaDeMiPunto,
      });
      if (q.tipo !== 'buscar') {
        // Solo «incluye zonas condicionales» sobre la búsqueda anterior: no hay criterios nuevos.
        return hayPrevia ? { ...vacia, tipo: 'buscar', modo: 'agregar', incluirCondicional: true, temaNoSoportado: spec.tema } : vacia;
      }
      spec.distancias.forEach((d) => {
        const c = q.criterios.find((x) => x.id === d.criterio);
        if (c) c.umbralM = d.metros;
      });
      return { ...q, modo, temaNoSoportado: spec.tema, ...(dis || {}) };
    }
    return {
      ...vacia,
      tipo: TIPO_DE_INTENCION[spec.intencion] || 'desconocido',
      lote: spec.intencion === 'construir' ? spec.loteM2 : null,
      ...(spec.intencion === 'precio_distrito' ? dis || {} : {}),
    };
  }

  /**
   * Picks the intent the deterministic engine will run: the model's validated query when the server answered in Gemini
   * mode, otherwise the local rule-based parser (`reglas`, called lazily). Never throws.
   */
  function elegirIntencion(respuesta, { reglas, ultimaBusqueda = null }) {
    if (respuesta && respuesta.modo === 'gemini' && esObjeto(respuesta.spec)) {
      try {
        return { origen: 'gemini', intencion: aIntencion(respuesta.spec, { ultimaBusqueda }) };
      } catch {
        // A query that cannot be mapped falls back to the rules below.
      }
    }
    return { origen: 'reglas', intencion: reglas() };
  }

  // ------------------------------------------------------- Verificación del texto

  const quitarTildes = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /** Todas las cadenas y números de un resultado, para saber qué cifras y nombres existen en él. */
  function recolectar(valor, salida = []) {
    if (typeof valor === 'string') salida.push(valor);
    else if (esNumero(valor)) salida.push(String(valor));
    else if (Array.isArray(valor)) valor.forEach((v) => recolectar(v, salida));
    else if (esObjeto(valor)) Object.values(valor).forEach((v) => recolectar(v, salida));
    return salida;
  }

  /** Valores numéricos que puede significar una cifra escrita: «1,5» es 1,5; «1,500» es 1,5 o 1500. */
  function valoresDe(token) {
    if (/^\d+$/.test(token)) return [Number(token)];
    const partes = token.split(/[.,]/);
    const out = [];
    if (partes.length === 2) out.push(Number(`${partes[0]}.${partes[1]}`));
    if (partes.slice(1).every((p) => p.length === 3)) out.push(Number(partes.join('')));
    if (out.length === 0) partes.forEach((p) => out.push(Number(p)));
    return out;
  }

  const cifrasDe = (texto) => (String(texto).match(/\d+(?:[.,]\d+)*/g) || []);

  // Siglas y nombres propios que el texto puede nombrar aunque el resultado no los traiga.
  const NOMBRES_PERMITIDOS = ['arequipa', 'peru', 'pdm', 'geoverificador', 'openstreetmap', 'osm', 'minedu', 'oms', 'ana', 'igp', 'ingemmet', 'cenepred', 'sigrid', 'impla', 'sunarp', 'nominatim', 'gemini'];
  const RECOMENDACION = /\b(te recomiendo|le recomiendo|recomiendo (?:que )?(?:comprar|vivir|construir|mudarte|elegir)|conviene (?:comprar|vivir|construir)|lo mejor es (?:comprar|vivir|construir)|deberias (?:comprar|vivir|construir)|mejor opcion)\b/;
  const MAX_TEXTO = 1500;

  /** Quita adornos de Markdown que la vista no interpreta; las viñetas pasan a «• », que la vista sí convierte en lista. */
  function limpiarTexto(texto) {
    return String(texto ?? '')
      .replace(/\r/g, '')
      .replace(/\*\*|__|`/g, '')
      .replace(/^[ \t]*[-*]\s+/gm, '• ')
      .replace(/^#+\s*/gm, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Comprueba que un texto redactado por el modelo solo dice lo que dice el resultado del motor.
   *   hechos: el objeto que se le dio al modelo (`texto`, `filas`…). Devuelve { ok, motivo? }.
   * Reglas: (1) cada cifra del texto aparece en los hechos; (2) los nombres propios (palabras con mayúscula fuera del inicio de
   * oración) aparecen en los hechos o son siglas conocidas; (3) conserva la advertencia «referencial» si los hechos la traen;
   * (4) no recomienda comprar, vivir ni construir; (5) sin enlaces y de largo acotado.
   */
  function verificarTexto(texto, hechos) {
    const t = typeof texto === 'string' ? texto.trim() : '';
    if (!t) return { ok: false, motivo: 'vacio' };
    if (t.length > MAX_TEXTO) return { ok: false, motivo: 'muy_largo' };
    if (/https?:|www\./i.test(t)) return { ok: false, motivo: 'enlace' };
    const corpus = recolectar(hechos);
    if (corpus.length === 0) return { ok: false, motivo: 'sin_hechos' };

    const permitidas = new Set();
    corpus.forEach((s) => cifrasDe(s).forEach((c) => valoresDe(c).forEach((v) => permitidas.add(v))));
    const cifraNueva = cifrasDe(t).find((c) => !valoresDe(c).some((v) => permitidas.has(v)));
    if (cifraNueva !== undefined) return { ok: false, motivo: 'cifra_nueva' };

    const palabras = new Set(corpus.flatMap((s) => quitarTildes(s).match(/[a-zñ0-9]+/g) || []));
    const propio = /[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]+/g;
    let m;
    while ((m = propio.exec(t)) !== null) {
      const previo = t.slice(0, m.index).replace(/[ \t]+$/, '');
      const iniciaOracion = previo === '' || /[.!?¡¿:•\n]$/.test(previo);
      if (iniciaOracion) continue;
      const w = quitarTildes(m[0]);
      if (!palabras.has(w) && !NOMBRES_PERMITIDOS.includes(w)) return { ok: false, motivo: 'nombre_nuevo' };
    }

    const textoHechos = hechos && typeof hechos.texto === 'string' ? hechos.texto : corpus.join(' ');
    if (/referencial/i.test(textoHechos) && !/referencial/i.test(t)) return { ok: false, motivo: 'sin_aviso_referencial' };
    if (RECOMENDACION.test(quitarTildes(t))) return { ok: false, motivo: 'recomendacion' };
    return { ok: true };
  }

  // -------------------------------------------------- Llamadas al servidor y respaldo

  const URL_CHAT = '/api/chat';
  const TIEMPO_INTERPRETAR_MS = 8000;
  const TIEMPO_REDACTAR_MS = 6000;

  /**
   * Decide a partir de la respuesta de /api/chat si se usa el modelo o las reglas. Nunca lanza.
   *   { estado, cuerpo } → { modo: 'gemini', ... } | { modo: 'reglas', motivo, disponible }
   * `disponible`: false = el servidor no tiene el modelo (sin clave o sin función); null = fallo pasajero, se puede reintentar.
   */
  function clasificarRespuesta(estado, cuerpo, tipo) {
    if (estado === 503) return { modo: 'reglas', motivo: 'sin_clave', disponible: false };
    if (estado === 404 || estado === 405) return { modo: 'reglas', motivo: 'sin_funcion', disponible: false };
    if (estado === 429) return { modo: 'reglas', motivo: 'limite', disponible: null };
    if (estado !== 200 || !esObjeto(cuerpo) || cuerpo.modo !== 'gemini') return { modo: 'reglas', motivo: 'error', disponible: null };
    if (tipo === 'interpretar') {
      const v = validarSpec(cuerpo.spec);
      return v.ok ? { modo: 'gemini', spec: v.spec, disponible: true } : { modo: 'reglas', motivo: 'consulta_invalida', disponible: null };
    }
    return typeof cuerpo.texto === 'string' ? { modo: 'gemini', texto: limpiarTexto(cuerpo.texto), disponible: true } : { modo: 'reglas', motivo: 'error', disponible: null };
  }

  /** POST a /api/chat con tiempo límite. Devuelve { estado, cuerpo } o { error: 'tiempo' | 'red' }. */
  async function enviarAlServidor(cuerpo, { fetchFn, timeoutMs, url = URL_CHAT }) {
    const f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null); // eslint-disable-line no-undef
    if (!f) return { error: 'red' };
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), timeoutMs);
    try {
      const resp = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), signal: control.signal });
      let json = null;
      try { json = await resp.json(); } catch { json = null; }
      return { estado: resp.status, cuerpo: json };
    } catch (err) {
      return { error: err && err.name === 'AbortError' ? 'tiempo' : 'red' };
    } finally {
      clearTimeout(reloj);
    }
  }

  /** Pide al servidor que interprete la frase. Ante cualquier fallo devuelve { modo: 'reglas' } para usar el intérprete local. */
  async function interpretar({ mensaje, historial, estado }, opciones = {}) {
    const texto = String(mensaje ?? '').trim().slice(0, MAX_MENSAJE);
    if (!texto) return { modo: 'reglas', motivo: 'vacio', disponible: null };
    const r = await enviarAlServidor(
      { mode: 'interpretar', mensaje: texto, historial: sanitizarHistorial(historial), estado: sanitizarEstado(estado) },
      { ...opciones, timeoutMs: opciones.timeoutMs ?? TIEMPO_INTERPRETAR_MS },
    );
    if (r.error) return { modo: 'reglas', motivo: r.error, disponible: null };
    return clasificarRespuesta(r.estado, r.cuerpo, 'interpretar');
  }

  /**
   * Pide al servidor que redacte el resultado del motor. Si el texto no pasa `verificarTexto`, o hay cualquier fallo,
   * devuelve { modo: 'reglas' }: quien llama muestra entonces el texto determinista.
   */
  async function redactar({ pregunta, tipo, hechos }, opciones = {}) {
    const r = await enviarAlServidor(
      { mode: 'redactar', mensaje: String(pregunta ?? '').trim().slice(0, MAX_MENSAJE), tipo: String(tipo ?? '').slice(0, 40), hechos },
      { ...opciones, timeoutMs: opciones.timeoutMs ?? TIEMPO_REDACTAR_MS },
    );
    if (r.error) return { modo: 'reglas', motivo: r.error, disponible: null };
    const c = clasificarRespuesta(r.estado, r.cuerpo, 'redactar');
    if (c.modo !== 'gemini') return c;
    const v = verificarTexto(c.texto, hechos);
    return v.ok ? c : { modo: 'reglas', motivo: `no_verificado:${v.motivo}`, disponible: true };
  }

  /** ¿El servidor tiene el modelo configurado? (GET /api/chat; no gasta una consulta al modelo). */
  async function disponible(opciones = {}) {
    const f = opciones.fetchFn || (typeof fetch !== 'undefined' ? fetch : null); // eslint-disable-line no-undef
    if (!f) return false;
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), opciones.timeoutMs ?? 4000);
    try {
      const resp = await f(opciones.url || URL_CHAT, { method: 'GET', signal: control.signal });
      if (resp.status !== 200) return false;
      const json = await resp.json();
      return esObjeto(json) && json.disponible === true;
    } catch {
      return false;
    } finally {
      clearTimeout(reloj);
    }
  }

  /**
   * Lo que la vista dice del modo del chat y de qué se envía adónde. Solo «gemini» afirma que el texto llega al proveedor
   * del modelo; cualquier otro valor se trata como reglas, para no prometer lo que no se sabe.
   */
  function textoModo(modo) {
    if (modo === 'gemini') {
      return {
        modo: 'gemini',
        etiqueta: 'Modo: Gemini',
        ayuda: 'Gemini interpreta tu frase y redacta la respuesta; los datos, distancias y estados los calcula siempre el motor de la ficha.',
        privacidad: 'Lo que escribes aquí se envía al proveedor del modelo (Gemini) para entender tu frase. No escribas tu dirección.',
      };
    }
    return {
      modo: 'reglas',
      etiqueta: 'Modo: reglas',
      ayuda: 'El asistente entiende tu frase con reglas fijas, sin IA. Entiende menos frases, pero los datos son los mismos de la ficha.',
      privacidad: 'En modo reglas lo que escribes no se envía a ningún modelo.',
    };
  }

  return {
    HERRAMIENTA, INTENCIONES, CRITERIOS, MODOS, TEMAS, RANGOS, MAX_MENSAJE, MAX_TURNOS, MAX_TEXTO,
    validarSpec, sanitizarEstado, sanitizarHistorial, aIntencion, elegirIntencion, verificarTexto, limpiarTexto,
    clasificarRespuesta, interpretar, redactar, disponible, textoModo,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AsistenteLLM;
