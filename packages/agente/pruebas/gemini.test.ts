import { describe, expect, it } from 'vitest';
import { CONSULTA_VACIA } from '../src/consulta.ts';
import { MODELO_POR_DEFECTO, crearProveedorGemini, proveedorDesdeEntorno } from '../src/gemini.ts';

const entrada = { mensaje: 'un departamento en Cayma', consulta: { ...CONSULTA_VACIA, tipo: 'departamento' as const }, salidas: [{ totalHallados: 2, avisos: [], motivoVacio: null }], borrador: 'Encontré 2 avisos.' };
const respuesta = (cuerpo: unknown, ok = true, status = 200) => ({ ok, status, json: async () => cuerpo });

describe('el proveedor de lenguaje es opcional', () => {
  it('sin GEMINI_API_KEY no hay proveedor: el asistente responde con reglas', () => {
    expect(proveedorDesdeEntorno({})).toBeNull();
    expect(proveedorDesdeEntorno({ GEMINI_API_KEY: '   ' })).toBeNull();
  });
  it('con la clave en el entorno hay proveedor, con el modelo por omisión o el que se configure', () => {
    expect(proveedorDesdeEntorno({ GEMINI_API_KEY: 'k' })?.nombre).toBe(`gemini:${MODELO_POR_DEFECTO}`);
    expect(proveedorDesdeEntorno({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-otro-1.0' })?.nombre).toBe('gemini:gemini-otro-1.0');
    expect(proveedorDesdeEntorno({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'Mal Modelo/../x' })?.nombre).toBe(`gemini:${MODELO_POR_DEFECTO}`);
  });
});

describe('la llamada al modelo', () => {
  it('manda la clave en la cabecera y no en la URL, y devuelve el texto en una línea', async () => {
    let visto: { url: string; init: any } | null = null;
    const p = crearProveedorGemini({ clave: 'CLAVE-SECRETA', fetch: async (url, init) => ((visto = { url, init }), respuesta({ candidates: [{ content: { parts: [{ text: 'Encontré 2 avisos.\nTe los muestro.' }] } }] })) });
    expect(await p.redactar(entrada)).toBe('Encontré 2 avisos. Te los muestro.');
    expect(visto!.url).not.toContain('CLAVE-SECRETA');
    expect(visto!.init.headers['x-goog-api-key']).toBe('CLAVE-SECRETA');
    const cuerpo = JSON.parse(visto!.init.body);
    expect(cuerpo.systemInstruction.parts[0].text).toMatch(/ONLY the facts/);
    expect(JSON.stringify(cuerpo)).not.toContain('CLAVE-SECRETA');
  });
  it('un error HTTP, una respuesta vacía o un fallo de red lanzan un error sin la clave ni el cuerpo', async () => {
    for (const fetch of [async () => respuesta({ error: 'CLAVE-SECRETA inválida' }, false, 403), async () => respuesta({ candidates: [] }), async () => { throw new Error('ECONNRESET CLAVE-SECRETA'); }]) {
      const p = crearProveedorGemini({ clave: 'CLAVE-SECRETA', fetch });
      const error = await p.redactar(entrada).catch((e) => e as Error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('CLAVE-SECRETA');
    }
  });
  it('si el modelo tarda más del tiempo permitido, se corta', async () => {
    const p = crearProveedorGemini({ clave: 'k', tiempoMs: 20, fetch: (_u, init) => new Promise((_ok, no) => init.signal.addEventListener('abort', () => no(Object.assign(new Error('abortado'), { name: 'AbortError' })))) });
    await expect(p.redactar(entrada)).rejects.toThrow(/tardó demasiado/);
  });
});
