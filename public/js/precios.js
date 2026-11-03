/**
 * precios.js — Precio de OFERTA por m² del distrito (informativo, sin DOM).
 *
 * Fuente: Aptología (CC BY 4.0), estudio «Vivienda en Arequipa: precio por m², arriendo, habitaciones y rentabilidad»,
 * congelado con scripts/descargar-precios.mjs en data/precios_m2_distrito.json.
 *
 * Lo que es: la mediana del precio PEDIDO (avisos publicados) por m² de departamentos en venta, por distrito, con el
 * número de avisos y el periodo. Lo que NO es: precio de cierre, tasación ni el valor de un inmueble en particular.
 * Nunca produce CUMPLE / NO CUMPLE ni puntaje: el estado es INFORMATIVO o SIN DATO (con su causa).
 *
 * Aptología solo publica cifras con al menos `muestra_minima` avisos, así que hoy solo hay tres distritos
 * (Cayma, Yanahuara y Cerro Colorado). Para el resto el resultado es SIN DATO, nunca una estimación.
 *
 * Pura: recibe el contenido del JSON (objeto) y el nombre del distrito. `load` es la única función con red.
 * Se carga como script del navegador (define `Precios`) y también como módulo CommonJS para las pruebas y para
 * scripts/descargar-precios.mjs.
 */
const Precios = (() => {
  /** Nombre normalizado para comparar distritos: sin tildes, sin signos, en MAYÚSCULAS y con un solo espacio. */
  function normalizarNombre(texto) {
    if (typeof texto !== 'string') return '';
    return texto
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // tildes (la Ñ pierde la virgulilla: QUEQUENA, igual en ambos lados)
      .replace(/[^A-Za-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  // Variantes habituales de los portales que no son solo tildes o mayúsculas. Clave y valor, ya normalizados.
  const ALIAS = {
    'JOSE LUIS BUSTAMANTE': 'JOSE LUIS BUSTAMANTE Y RIVERO',
    'J L BUSTAMANTE Y RIVERO': 'JOSE LUIS BUSTAMANTE Y RIVERO',
    'JLB Y R': 'JOSE LUIS BUSTAMANTE Y RIVERO',
    'BUSTAMANTE Y RIVERO': 'JOSE LUIS BUSTAMANTE Y RIVERO',
  };

  /** Clave de comparación: normaliza y resuelve alias. */
  function clave(texto) {
    const n = normalizarNombre(texto);
    return ALIAS[n] || n;
  }

  const sinDato = (distrito, causa, motivo) => ({ estado: 'SIN DATO', distrito: distrito || null, causa, motivo });

  /** Redondea a soles enteros (la fuente publica enteros; el CSV trae decimales de la mediana). */
  const entero = (n) => (Number.isFinite(n) ? Math.round(n) : null);

  /**
   * Cifras del distrito: INFORMATIVO con los datos, o SIN DATO con la causa.
   * `datos` es el contenido de data/precios_m2_distrito.json (o null si no se pudo leer).
   * Devuelve { estado: 'INFORMATIVO', distrito, precioM2: { venta, alquiler }, arriendoMensual, moneda, periodo,
   *            nAvisos: { venta, arriendo }, muestraMinima, tipo, fuente, url, licencia, atribucion, fechaDescarga }
   *       o { estado: 'SIN DATO', distrito, causa, motivo } — motivo: 'sin_archivo' | 'sin_distrito' | 'sin_muestra'.
   * `precioM2.alquiler` es null mientras la fuente no publique precio de alquiler por m² (hoy solo publica el canon
   * mensual, que va aparte en `arriendoMensual`).
   */
  function buscar(datos, distrito) {
    if (!datos || typeof datos !== 'object' || !datos.distritos || typeof datos.distritos !== 'object') {
      return sinDato(distrito, 'No se pudo leer el archivo de precios por distrito (precios_m2_distrito.json).', 'sin_archivo');
    }
    const k = clave(distrito);
    if (!k) return sinDato(null, 'No se pudo determinar el distrito del punto, así que no hay precio de referencia.', 'sin_distrito');

    const entrada = Object.entries(datos.distritos).find(([nombre]) => clave(nombre) === k);
    const nombreEtiqueta = entrada ? entrada[0] : k;
    const fila = entrada ? entrada[1] : null;
    const venta = fila && Number.isFinite(fila.venta_m2) ? entero(fila.venta_m2) : null;
    const arriendo = fila && Number.isFinite(fila.arriendo_mensual) ? entero(fila.arriendo_mensual) : null;
    if (venta === null && arriendo === null) {
      const minimo = datos.muestra_minima;
      return sinDato(
        nombreEtiqueta,
        `La fuente (${datos.fuente || 'Aptología'}) no publica precio por m² para este distrito${minimo ? `: solo publica cifras con al menos ${minimo} avisos` : ''}.`,
        'sin_muestra'
      );
    }
    return {
      estado: 'INFORMATIVO',
      distrito: nombreEtiqueta,
      precioM2: { venta, alquiler: null },
      arriendoMensual: arriendo,
      moneda: datos.moneda || 'PEN',
      periodo: datos.periodo || null,
      nAvisos: { venta: fila.avisos_venta ?? null, arriendo: fila.avisos_arriendo ?? null },
      muestraMinima: datos.muestra_minima ?? null,
      tipo: datos.tipo || 'precio de oferta (avisos), no de cierre',
      fuente: datos.fuente || null,
      url: datos.url || null,
      licencia: datos.licencia || null,
      atribucion: datos.atribucion || null,
      fechaDescarga: datos.fecha_descarga || null,
    };
  }

  /** Distritos con cifra publicada, con el nombre tal como figura en el archivo. */
  function distritosConDato(datos) {
    return datos && datos.distritos ? Object.keys(datos.distritos) : [];
  }

  /** «S/ 4 905» → texto para mostrar. Sin decimales; separador de miles con espacio fino no separable. */
  function formatearSoles(n) {
    if (!Number.isFinite(n)) return '—';
    return `S/ ${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
  }

  /** Fecha ISO (AAAA-MM-DD) → «18 de octubre de 2026». Devuelve el texto original si no es una fecha ISO válida. */
  function fechaLarga(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return iso || '';
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const mes = meses[Number(m[2]) - 1];
    return mes ? `${Number(m[3])} de ${mes} de ${m[1]}` : iso;
  }

  /** Texto del periodo: «avisos vistos del 11 al 18 de octubre de 2026» o, si solo hay corte, «con corte al 18 de …». */
  function textoPeriodo(periodo) {
    if (!periodo) return 'periodo no informado';
    if (periodo.desde && periodo.hasta) {
      const mismoMes = periodo.desde.slice(0, 7) === periodo.hasta.slice(0, 7);
      const dia = Number(periodo.desde.slice(8, 10));
      return `avisos vistos del ${mismoMes && dia ? dia : fechaLarga(periodo.desde)} al ${fechaLarga(periodo.hasta)}`;
    }
    return `datos con corte al ${fechaLarga(periodo.corte || periodo.hasta)}`;
  }

  let ready = null;
  /** Carga el archivo (una sola vez). Si falla, la siguiente llamada lo reintenta. Solo para el navegador. */
  function load() {
    if (!ready) {
      ready = (async () => {
        const url = CONFIG.precios.jsonUrl;
        let res;
        try {
          res = await fetch(url);
        } catch (_) {
          throw new Error(`No se pudo leer el archivo de precios (${url}).`);
        }
        if (!res.ok) throw new Error(`No se encontró ${url} (HTTP ${res.status}). Genera el archivo con: node scripts/descargar-precios.mjs`);
        let datos;
        try {
          datos = await res.json();
        } catch (_) {
          throw new Error(`${url} no es un JSON válido.`);
        }
        if (!datos || typeof datos.distritos !== 'object') throw new Error('El archivo de precios no tiene el formato esperado (falta `distritos`).');
        return datos;
      })().catch((err) => {
        ready = null;
        throw err;
      });
    }
    return ready;
  }

  return { normalizarNombre, claveDistrito: clave, buscar, distritosConDato, formatearSoles, fechaLarga, textoPeriodo, load };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Precios;
