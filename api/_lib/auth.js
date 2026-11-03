'use strict';
/**
 * auth.js — Núcleo opcional del inicio de sesión con Google (OpenID Connect, código de autorización con PKCE).
 *
 * Lo usan las funciones de Vercel (api/auth/*.js) y el controlador de NestJS (src/auth.controller.ts), igual que gemini.js
 * con el chat. Sin dependencias: solo `crypto` y `fetch` de Node.
 *
 * Qué hace y qué no:
 *   - Pide a Google solo `openid profile` y guarda del ID token únicamente `sub` (identificador opaco) y `name`.
 *     No pide ni guarda el correo, la foto ni ningún token de Google.
 *   - No hay base de datos ni almacén en el servidor. El estado vive en dos cookies HttpOnly firmadas con HMAC-SHA256:
 *       flujo:  state + verificador PKCE + nonce + ruta de regreso (10 minutos, se borra al volver de Google)
 *       sesión: { sub, nombre, exp } (7 días)
 *   - La aplicación sigue funcionando sin cuenta; si falta cualquier variable de entorno, los endpoints responden 503.
 *
 * Configuración (solo variables de entorno):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, AUTH_SESSION_SECRET (32 caracteres o más) y AUTH_BASE_URL
 *   (origen público de la aplicación, p. ej. https://sitio.example; el redireccionamiento es `${AUTH_BASE_URL}/api/auth/callback`).
 *
 * Nota sobre el ID token: llega directamente del endpoint de tokens de Google por TLS y con el secreto del cliente, así que,
 * como permite OpenID Connect Core §3.1.3.7, se validan los reclamos (iss, aud, azp, exp, nonce, sub) y no la firma JWT.
 * Nunca se acepta un ID token que llegue por el navegador.
 */
const crypto = require('node:crypto');

const URL_AUTORIZACION = 'https://accounts.google.com/o/oauth2/v2/auth';
const URL_TOKEN = 'https://oauth2.googleapis.com/token';
const EMISORES = ['https://accounts.google.com', 'accounts.google.com'];
const ALCANCE = 'openid profile';
const TIEMPO_GOOGLE_MS = 8000;
const VIDA_FLUJO_S = 10 * 60;
const VIDA_SESION_S = 7 * 24 * 60 * 60;
const MIN_SECRETO = 32;
const MAX_NOMBRE = 80;
const NOMBRE_POR_DEFECTO = 'Cuenta de Google';
const ANFITRIONES_LOCALES = new Set(['localhost', '127.0.0.1', '[::1]']);
const METODO_DE = { google: 'GET', callback: 'GET', me: 'GET', logout: 'POST' };

// ------------------------------------------------------------------ Configuración

/** Lee y valida las variables de entorno. Devuelve null si falta alguna o no es válida (sin decir cuál en los registros). */
function leerConfig(env) {
  const e = env || {};
  const dato = (k) => String(e[k] || '').trim();
  const clienteId = dato('GOOGLE_CLIENT_ID');
  const clienteSecreto = dato('GOOGLE_CLIENT_SECRET');
  const secreto = dato('AUTH_SESSION_SECRET');
  const base = dato('AUTH_BASE_URL');
  if (!clienteId || !clienteSecreto || !base || secreto.length < MIN_SECRETO) return null;

  let url;
  try { url = new URL(base); } catch { return null; }
  const https = url.protocol === 'https:';
  const httpLocal = url.protocol === 'http:' && ANFITRIONES_LOCALES.has(url.hostname);
  if (!https && !httpLocal) return null;
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;

  return { clienteId, clienteSecreto, secreto, baseUrl: url.origin, redirectUri: `${url.origin}/api/auth/callback`, seguro: https };
}

/** Con https las cookies llevan el prefijo __Host- (obliga a Secure, Path=/ y sin Domain). */
function nombresCookie(seguro) {
  const prefijo = seguro ? '__Host-' : '';
  return { flujo: `${prefijo}gv_flujo`, sesion: `${prefijo}gv_sesion` };
}

// ------------------------------------------------------------------ Utilidades

function iguales(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function leerCookies(cabecera) {
  const salida = {};
  if (typeof cabecera !== 'string') return salida;
  for (const trozo of cabecera.split(';')) {
    const i = trozo.indexOf('=');
    if (i <= 0) continue;
    const nombre = trozo.slice(0, i).trim();
    if (nombre && !(nombre in salida)) salida[nombre] = trozo.slice(i + 1).trim();
  }
  return salida;
}

function crearCookie(nombre, valor, { maxAgeS, seguro }) {
  return `${nombre}=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${seguro ? '; Secure' : ''}`;
}

const borrarCookie = (nombre, seguro) => crearCookie(nombre, '', { maxAgeS: 0, seguro });

/**
 * Ruta de regreso: solo una ruta relativa del mismo sitio (sin esquema, sin «//», sin barras invertidas ni caracteres de
 * control, ni siquiera codificados) y fuera de /api/. Cualquier otra cosa vuelve a «/». Se descarta el fragmento.
 */
function rutaSegura(valor) {
  const POR_DEFECTO = '/';
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > 200) return POR_DEFECTO;
  if (valor[0] !== '/' || /[\u0000-\u001f\u007f\\]/.test(valor)) return POR_DEFECTO;
  let decodificada;
  try { decodificada = decodeURIComponent(valor); } catch { return POR_DEFECTO; }
  if (/[\u0000-\u001f\u007f\\]/.test(decodificada) || decodificada.startsWith('//')) return POR_DEFECTO;
  let url;
  try { url = new URL(valor, 'http://sitio.invalid'); } catch { return POR_DEFECTO; }
  if (url.origin !== 'http://sitio.invalid' || url.pathname.startsWith('/api/')) return POR_DEFECTO;
  return `${url.pathname}${url.search}`;
}

// ------------------------------------------------------------------ Cookies firmadas

const firmaDe = (tipo, cuerpo, secreto) => crypto.createHmac('sha256', secreto).update(`${tipo}.${cuerpo}`).digest('base64url');

/** `cuerpo.firma`: el tipo entra en la firma, de modo que una cookie de flujo no sirve como sesión. */
function firmar(tipo, datos, secreto) {
  const cuerpo = Buffer.from(JSON.stringify(datos)).toString('base64url');
  return `${cuerpo}.${firmaDe(tipo, cuerpo, secreto)}`;
}

/** Devuelve los datos si la firma es válida y no venció (`exp` en segundos); si no, null. Comparación en tiempo constante. */
function verificar(tipo, token, secreto, ahoraMs) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return null;
  const partes = token.split('.');
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  if (!iguales(partes[1], firmaDe(tipo, partes[0], secreto))) return null;
  let datos;
  try { datos = JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf8')); } catch { return null; }
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return null;
  if (typeof datos.exp !== 'number' || !(datos.exp * 1000 > ahoraMs)) return null;
  return datos;
}

// ------------------------------------------------------------------ ID token

function decodificarIdToken(token) {
  if (typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3 || !partes[1]) return null;
  try {
    const reclamos = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
    return reclamos && typeof reclamos === 'object' && !Array.isArray(reclamos) ? reclamos : null;
  } catch { return null; }
}

function limpiarNombre(...candidatos) {
  for (const c of candidatos) {
    if (typeof c !== 'string') continue;
    const limpio = c.replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim();
    if (limpio) return Array.from(limpio).slice(0, MAX_NOMBRE).join('');
  }
  return NOMBRE_POR_DEFECTO;
}

/** Valida iss, aud (y azp), exp, nonce y sub. Devuelve { sub, nombre } o null. */
function validarIdToken(idToken, { clienteId, nonce, ahoraMs }) {
  const r = decodificarIdToken(idToken);
  if (!r) return null;
  if (!EMISORES.includes(r.iss)) return null;
  const audiencias = Array.isArray(r.aud) ? r.aud : [r.aud];
  if (!audiencias.includes(clienteId)) return null;
  if (audiencias.length > 1 && r.azp !== clienteId) return null;
  if (r.azp !== undefined && r.azp !== clienteId) return null;
  if (typeof r.exp !== 'number' || !(r.exp * 1000 > ahoraMs)) return null;
  if (!iguales(r.nonce, nonce)) return null;
  if (typeof r.sub !== 'string' || r.sub.length === 0 || r.sub.length > 255) return null;
  return { sub: r.sub, nombre: limpiarNombre(r.name, r.given_name) };
}

// ------------------------------------------------------------------ Acciones

const respuesta = (status, cuerpo, extra = {}) => ({ status, cuerpo, cookies: [], ...extra });
const redirigir = (ubicacion, cookies = []) => ({ status: 302, ubicacion, cookies });

function falloDeFlujo(codigo, config) {
  // Solo el código del fallo: ni el código de autorización, ni los tokens, ni los secretos llegan a los registros.
  console.error(`[auth] fallo del inicio de sesión: ${codigo}`);
  return redirigir(`/login.html?error=${codigo}`, [borrarCookie(nombresCookie(config.seguro).flujo, config.seguro)]);
}

function iniciar(req, config, ctx) {
  const nombres = nombresCookie(config.seguro);
  const state = ctx.aleatorio(32).toString('base64url');
  const nonce = ctx.aleatorio(24).toString('base64url');
  const verificador = ctx.aleatorio(48).toString('base64url');
  const desafio = crypto.createHash('sha256').update(verificador).digest('base64url');
  const volver = rutaSegura(req.consulta && req.consulta.volver);

  const destino = new URL(URL_AUTORIZACION);
  destino.search = new URLSearchParams({
    client_id: config.clienteId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: ALCANCE,
    state,
    nonce,
    code_challenge: desafio,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();

  const exp = Math.floor(ctx.ahoraMs / 1000) + VIDA_FLUJO_S;
  const valor = firmar('flujo', { state, verificador, nonce, volver, exp }, config.secreto);
  return redirigir(destino.toString(), [crearCookie(nombres.flujo, valor, { maxAgeS: VIDA_FLUJO_S, seguro: config.seguro })]);
}

async function canjearCodigo(codigo, verificador, config, ctx) {
  const cuerpo = new URLSearchParams({
    code: codigo,
    client_id: config.clienteId,
    client_secret: config.clienteSecreto,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verificador,
  }).toString();
  const r = await ctx.fetchFn(URL_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: cuerpo,
    signal: AbortSignal.timeout(TIEMPO_GOOGLE_MS),
  });
  if (!r || !r.ok) return null;
  const json = await r.json();
  return json && typeof json.id_token === 'string' ? json.id_token : null;
}

async function volverDeGoogle(req, config, ctx) {
  const nombres = nombresCookie(config.seguro);
  const consulta = req.consulta || {};
  const cookies = leerCookies(req.cabeceras && req.cabeceras.cookie);

  const flujo = verificar('flujo', cookies[nombres.flujo], config.secreto, ctx.ahoraMs);
  if (!flujo || typeof flujo.state !== 'string' || typeof flujo.verificador !== 'string' || typeof flujo.nonce !== 'string') {
    return falloDeFlujo('sesion_expirada', config);
  }
  if (!iguales(consulta.state, flujo.state)) return falloDeFlujo('estado_invalido', config);
  if (consulta.error) return falloDeFlujo(consulta.error === 'access_denied' ? 'acceso_denegado' : 'google_error', config);
  if (typeof consulta.code !== 'string' || consulta.code.length === 0 || consulta.code.length > 2048) return falloDeFlujo('google_error', config);

  let idToken;
  try { idToken = await canjearCodigo(consulta.code, flujo.verificador, config, ctx); } catch { idToken = null; }
  if (!idToken) return falloDeFlujo('intercambio_fallido', config);

  const identidad = validarIdToken(idToken, { clienteId: config.clienteId, nonce: flujo.nonce, ahoraMs: ctx.ahoraMs });
  if (!identidad) return falloDeFlujo('token_invalido', config);

  const exp = Math.floor(ctx.ahoraMs / 1000) + VIDA_SESION_S;
  const sesion = firmar('sesion', { sub: identidad.sub, nombre: identidad.nombre, exp }, config.secreto);
  return redirigir(rutaSegura(flujo.volver), [
    crearCookie(nombres.sesion, sesion, { maxAgeS: VIDA_SESION_S, seguro: config.seguro }),
    borrarCookie(nombres.flujo, config.seguro),
  ]);
}

function quienSoy(req, config, ctx) {
  const cookies = leerCookies(req.cabeceras && req.cabeceras.cookie);
  const sesion = verificar('sesion', cookies[nombresCookie(config.seguro).sesion], config.secreto, ctx.ahoraMs);
  if (!sesion || typeof sesion.nombre !== 'string' || typeof sesion.sub !== 'string') return respuesta(200, { autenticado: false });
  return respuesta(200, { autenticado: true, nombre: sesion.nombre });
}

/** Defensa CSRF del cierre de sesión: solo peticiones del propio origen (Sec-Fetch-Site, o Origin si el navegador no lo envía). */
function esMismoOrigen(cabeceras, config) {
  const c = cabeceras || {};
  if (c['sec-fetch-site'] !== undefined) return c['sec-fetch-site'] === 'same-origin';
  return typeof c.origin === 'string' && c.origin === config.baseUrl;
}

function cerrarSesion(req, config) {
  if (!esMismoOrigen(req.cabeceras, config)) return respuesta(403, { error: 'origen_no_permitido' });
  const nombres = nombresCookie(config.seguro);
  return respuesta(200, { autenticado: false }, { cookies: [borrarCookie(nombres.sesion, config.seguro), borrarCookie(nombres.flujo, config.seguro)] });
}

/**
 * Atiende una solicitud a /api/auth/*.
 *   req:  { accion: 'google' | 'callback' | 'me' | 'logout', metodo, consulta, cabeceras (en minúsculas) }
 *   deps: { env, fetchFn, ahora, aleatorio } (para pruebas)
 * Devuelve { status, cuerpo?, ubicacion?, cookies }.
 */
async function manejarAuth(req, deps = {}) {
  const ctx = {
    fetchFn: deps.fetchFn || globalThis.fetch,
    aleatorio: deps.aleatorio || ((n) => crypto.randomBytes(n)),
    ahoraMs: (deps.ahora || Date.now)(),
  };
  const esperado = Object.prototype.hasOwnProperty.call(METODO_DE, req.accion) ? METODO_DE[req.accion] : null;
  if (!esperado) return respuesta(404, { error: 'no_encontrado' });
  if (req.metodo !== esperado) return respuesta(405, { error: 'metodo_no_permitido' });

  const config = leerConfig(deps.env || process.env);
  if (!config) return respuesta(503, { error: 'no_configurado', autenticado: false });

  switch (req.accion) {
    case 'google': return iniciar(req, config, ctx);
    case 'callback': return volverDeGoogle(req, config, ctx);
    case 'me': return quienSoy(req, config, ctx);
    default: return cerrarSesion(req, config);
  }
}

// ------------------------------------------------------------------ Adaptador común (Vercel y Nest)

function cabecerasEnMinusculas(crudas) {
  const salida = {};
  for (const [k, v] of Object.entries(crudas || {})) salida[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  return salida;
}

function enviar(res, r) {
  res.statusCode = r.status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (r.cookies && r.cookies.length) res.setHeader('Set-Cookie', r.cookies);
  if (r.ubicacion) {
    res.setHeader('Location', r.ubicacion);
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(r.cuerpo));
}

/** Traduce una solicitud/respuesta de Node (Vercel o Express) a manejarAuth y escribe el resultado. Nunca lanza. */
async function atenderNode(accion, req, res, deps = {}) {
  let r;
  try {
    const url = new URL(req.url || '/', 'http://sitio.invalid');
    const consulta = Object.create(null);
    for (const [k, v] of url.searchParams) if (!(k in consulta)) consulta[k] = v;
    r = await manejarAuth({ accion, metodo: req.method, consulta, cabeceras: cabecerasEnMinusculas(req.headers) }, deps);
  } catch {
    console.error('[auth] fallo interno');
    r = respuesta(500, { error: 'interno' });
  }
  enviar(res, r);
}

module.exports = { manejarAuth, atenderNode, leerConfig, nombresCookie, firmar, verificar, rutaSegura, validarIdToken };
