/**
 * interrupciones.js — Lógica pura (sin red ni archivos) detrás de scripts/descargar-interrupciones-sunass.mjs: el Registro de interrupciones del servicio de agua y
 * alcantarillado imprevistas y programadas que las empresas prestadoras reportan a la SUNASS (datosabiertos.gob.pe, ODC-By), reducido a las de SEDAPAR por distrito.
 * La usan ese script y test/interrupciones.spec.ts.
 *
 *   agregar(filas, { distritos, eps?, servicio? }) → { eps, servicio, periodo, anios_completos, anios_parciales, descartes, distritos }
 *
 * Reglas (todas visibles en `descartes` y en la metadata del archivo):
 *  - Solo las filas de la empresa (EPS = SEDAPAR) y del servicio (AGUA POTABLE; el alcantarillado tiene 7 filas y es otro asunto).
 *  - Solo los distritos que se le pasan (los del proyecto): el resto de la empresa (Islay, Camaná, La Joya…) no es Arequipa metropolitana.
 *  - Una interrupción (IDINTERRUPCION) puede venir en varias filas: una por distrito, y a veces varias del mismo distrito (sectores). Cuenta UNA vez por distrito.
 *  - La duración es de la fecha y hora de inicio a la de fin; si no se puede calcular o es negativa, la interrupción no cuenta.
 *  - Cada una se asigna al año de su inicio. El periodo es el de TODAS las filas de la empresa; un año es «completo» si el periodo lo cubre de enero a diciembre.
 *  - Las horas son de la interrupción, contada una vez: NO se multiplican por las conexiones afectadas (el archivo las trae, pero una interrupción de 3 conexiones
 *    y una de todo un distrito sumarían igual).
 */

const normalizar = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');

function instante(fecha, hora) {
  const f = /^(\d{4})(\d{2})(\d{2})$/.exec(String(fecha).trim());
  const h = /^(\d{1,2}):(\d{2})$/.exec(String(hora).trim());
  if (!f || !h) return null;
  const ms = Date.UTC(Number(f[1]), Number(f[2]) - 1, Number(f[3]), Number(h[1]), Number(h[2]));
  return Number.isFinite(ms) ? ms : null;
}

const iso = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
const redondear = (x, d = 2) => Number(x.toFixed(d));
const mediana = (v) => {
  const o = [...v].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

function agregar(filas, { distritos, eps = 'SEDAPAR', servicio = 'AGUA POTABLE' }) {
  const validos = new Map((distritos || []).map((d) => [normalizar(d), d]));
  const descartes = { otra_eps: 0, otro_servicio: 0, fuera_de_los_distritos: 0, sin_distrito: 0, fechas_invalidas: 0, repetidas: 0 };
  const fechasEps = [];
  const vistos = new Set();
  const porDistrito = new Map();
  for (const f of filas || []) {
    if (normalizar(f.EPS) !== normalizar(eps)) { descartes.otra_eps++; continue; }
    if (/^\d{8}$/.test(String(f.FECHAINICIO).trim())) fechasEps.push(String(f.FECHAINICIO).trim());
    if (normalizar(f.TIPOSERVICIO) !== normalizar(servicio)) { descartes.otro_servicio++; continue; }
    const nombre = normalizar(f.DISTRITO);
    if (!nombre) { descartes.sin_distrito++; continue; }
    if (!validos.has(nombre)) { descartes.fuera_de_los_distritos++; continue; }
    const clave = `${f.IDINTERRUPCION}|${nombre}`;
    if (vistos.has(clave)) { descartes.repetidas++; continue; }
    const ini = instante(f.FECHAINICIO, f.HORAINICIO);
    const fin = instante(f.FECHAFIN, f.HORAFIN);
    if (ini === null || fin === null || fin < ini) { descartes.fechas_invalidas++; continue; }
    vistos.add(clave);
    const d = validos.get(nombre);
    if (!porDistrito.has(d)) porDistrito.set(d, []);
    porDistrito.get(d).push({ anio: String(f.FECHAINICIO).trim().slice(0, 4), horas: (fin - ini) / 3600000, programada: normalizar(f.TIPOINTERRUPCION) === 'PROGRAMADA' });
  }
  fechasEps.sort();
  const desde = fechasEps[0] || null;
  const hasta = fechasEps.at(-1) || null;
  const anios = desde ? Array.from({ length: Number(hasta.slice(0, 4)) - Number(desde.slice(0, 4)) + 1 }, (_, i) => Number(desde.slice(0, 4)) + i) : [];
  const completo = (a) => desde <= `${a}0101` && hasta >= `${a}1231`;
  const out = {};
  for (const [d, eventos] of [...porDistrito.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const por = {};
    eventos.forEach((e) => {
      por[e.anio] = por[e.anio] || { n: 0, horas: 0 };
      por[e.anio].n++;
      por[e.anio].horas += e.horas;
    });
    Object.values(por).forEach((v) => { v.horas = redondear(v.horas); });
    out[d] = {
      total: {
        n: eventos.length, horas: redondear(eventos.reduce((t, e) => t + e.horas, 0)), horas_mediana: redondear(mediana(eventos.map((e) => e.horas))),
        imprevistas: eventos.filter((e) => !e.programada).length, programadas: eventos.filter((e) => e.programada).length,
      },
      por_anio: Object.fromEntries(Object.keys(por).sort().map((a) => [a, por[a]])),
    };
  }
  return {
    eps, servicio,
    periodo: desde ? { desde: iso(desde), hasta: iso(hasta) } : null,
    anios_completos: anios.filter(completo),
    anios_parciales: anios.filter((a) => !completo(a)),
    descartes,
    distritos: out,
  };
}

module.exports = { agregar, normalizar };
