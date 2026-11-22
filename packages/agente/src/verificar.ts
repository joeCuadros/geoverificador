/**
 * verificar.ts — Comprueba (tarea 6.5) que una respuesta escrita por un modelo no contiene cifras, enlaces ni avisos que las herramientas no
 * devolvieron. Si algo no coincide, el ciclo descarta el texto del modelo y usa la redacción determinista (redactar.ts).
 */

/** Todas las cifras (y enlaces) que aparecen en las salidas de las herramientas, como cadenas normalizadas. */
export function cifrasPermitidas(salidas: unknown[]): { cifras: Set<string>; enlaces: Set<string> } {
  const cifras = new Set<string>();
  const enlaces = new Set<string>();
  const agregar = (n: number) => {
    cifras.add(String(n));
    for (const d of [0, 1, 2]) cifras.add(n.toFixed(d).replace(/\.?0+$/, ''));
    if (Number.isFinite(n) && Math.abs(n) >= 1000) cifras.add(String(Math.round(n)));
  };
  const visitar = (v: unknown): void => {
    if (typeof v === 'number') agregar(v);
    else if (typeof v === 'string') {
      for (const m of v.match(/https?:\/\/[^\s)»"]+/g) ?? []) enlaces.add(m);
      for (const m of normalizarCifras(v)) cifras.add(m);
      if (/^https?:\/\//.test(v)) enlaces.add(v);
    } else if (Array.isArray(v)) v.forEach(visitar);
    else if (v && typeof v === 'object') Object.values(v).forEach(visitar);
  };
  salidas.forEach(visitar);
  return { cifras, enlaces };
}

/** Las cifras de un texto en su forma canónica: «S/ 450 000» → «450000»; «1,5 km» → «1.5»; fechas se parten en sus números. */
export function normalizarCifras(texto: string): string[] {
  const sinEnlaces = texto.replace(/https?:\/\/\S+/g, ' ');
  const juntas = sinEnlaces.replace(/(\d)[ ., ](?=\d{3}(?!\d))/g, '$1');
  const out: string[] = [];
  for (const m of juntas.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const c = m[0].replace(',', '.');
    out.push(c, String(Number(c)));
    if (m[0].startsWith('0') && m[0].length > 1 && !m[0].includes('.') && !m[0].includes(',')) out.push(m[0].replace(/^0+/, ''));
  }
  return out;
}

export interface ResultadoVerificacion {
  ok: boolean;
  cifrasSinOrigen: string[];
  enlacesSinOrigen: string[];
}

/**
 * ¿Cada cifra y cada enlace del texto sale de las herramientas? Se permiten los números pequeños que son parte de la redacción
 * («1 criterio», «3 de 4») solo si ≤ el total de criterios/avisos posible: aquí, 0–20, para no bloquear la lengua corriente.
 */
export function verificarRespuesta(texto: string, salidas: unknown[], extra: string[] = []): ResultadoVerificacion {
  const { cifras, enlaces } = cifrasPermitidas([...salidas, ...extra]);
  const sin = new Set<string>();
  for (const c of normalizarCifras(texto)) {
    if (cifras.has(c)) continue;
    if (/^\d{1,2}$/.test(c) && Number(c) <= 20) continue;
    sin.add(c);
  }
  const enlacesSin = (texto.match(/https?:\/\/[^\s)»"]+/g) ?? []).filter((e) => !enlaces.has(e));
  return { ok: sin.size === 0 && enlacesSin.length === 0, cifrasSinOrigen: [...sin], enlacesSinOrigen: enlacesSin };
}
