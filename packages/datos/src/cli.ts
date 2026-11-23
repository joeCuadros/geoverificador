/**
 * cli.ts — Órdenes de la base de datos.
 *
 *   pnpm bd:migrar                 aplica las migraciones pendientes
 *   pnpm bd:cargar [filtro]        carga apps/estatica/public/data en la base (solo los archivos cuya ruta contenga `filtro`, si se da)
 *   pnpm bd:verificar              compara la base contra los archivos
 *   pnpm bd:ficha <lat> <lon>      imprime la ficha de un punto armada con consultas a la base
 *   pnpm datos:tipo-cambio         guarda el tipo de cambio de los últimos 15 días (BCRP)
 *   pnpm avisos:ingerir <archivo>  guarda en la base una corrida de `pnpm datos:avisos` (JSON); --geocodificar ubica con Nominatim los avisos sin coordenadas
 *   pnpm avisos:estado             avisos vigentes, distritos cubiertos y porcentaje con coordenadas y ficha de entorno
 *
 * Opción común: --si-hay-base  termina sin error cuando no hay DATABASE_URL (así los `pnpm datos:*` siguen sirviendo sin base).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estadoDeAvisos, guardarTipoCambio, ingerirCorrida, tipoCambioVigente } from './avisos.ts';
import { abrirBase } from './cliente.ts';
import { geocodificarNominatim } from './geocodificar.ts';
import { descargarTipoCambio } from './tipo-cambio.ts';
import { cargarTodo } from './cargar.ts';
import { fichaDePunto } from './ficha.ts';
import { migrar } from './migrar.ts';
import { verificarBase } from './verificar.ts';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DATOS = path.join(RAIZ, 'apps', 'estatica', 'public', 'data');

async function principal(): Promise<number> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const banderas = new Set(args.filter((a) => a.startsWith('--')));
  const [orden, ...resto] = args.filter((a) => !a.startsWith('--'));
  if (!process.env.DATABASE_URL) {
    if (banderas.has('--si-hay-base')) {
      console.log('Sin DATABASE_URL: no se escribe en la base.');
      return 0;
    }
    console.error('Falta DATABASE_URL. Para desarrollo sin servidor: DATABASE_URL=pglite://.pglite');
    return 2;
  }
  const base = await abrirBase();
  try {
    if (orden === 'migrar') {
      const hechas = await migrar(base);
      console.log(hechas.length ? `Migraciones aplicadas: ${hechas.join(', ')}` : 'La base ya está al día.');
      return 0;
    }
    if (orden === 'cargar') {
      await migrar(base);
      const filtro = resto[0];
      const r = await cargarTodo(base, DATOS, { filtro: filtro ? (ruta) => ruta.includes(filtro) : undefined, forzar: banderas.has('--forzar') });
      for (const x of r) if (x.estado === 'cargado') console.log(`cargado      ${x.ruta} → ${x.tabla} (${x.registros})`);
      console.log(`${r.filter((x) => x.estado === 'cargado').length} archivos cargados, ${r.filter((x) => x.estado === 'sin_cambios').length} sin cambios.`);
      return 0;
    }
    if (orden === 'verificar') {
      const r = await verificarBase(base, DATOS);
      for (const c of r) console.log(`${c.ok ? 'OK   ' : 'FALLA'} ${c.nombre} — ${c.detalle}`);
      const fallas = r.filter((c) => !c.ok).length;
      console.log(`\n${r.length - fallas} de ${r.length} comprobaciones de la base correctas.`);
      return fallas ? 1 : 0;
    }
    if (orden === 'ficha') {
      const [lat, lon] = resto.map(Number);
      console.log(JSON.stringify(await fichaDePunto(base, { lat, lon }), null, 2));
      return 0;
    }
    if (orden === 'tipo-cambio') {
      await migrar(base);
      const hoy = new Date();
      const dia = (d: Date) => d.toISOString().slice(0, 10);
      const serie = await descargarTipoCambio(dia(new Date(hoy.getTime() - 15 * 86_400_000)), dia(hoy));
      for (const tc of serie) await guardarTipoCambio(base, tc);
      const ultimo = serie[serie.length - 1];
      console.log(ultimo ? `Tipo de cambio: ${serie.length} días guardados; el último, ${ultimo.fecha}: S/ ${ultimo.venta} por dólar (${ultimo.fuente}).` : 'El BCRP no devolvió cotizaciones para el periodo.');
      return 0;
    }
    if (orden === 'avisos-estado') {
      console.log(JSON.stringify(await estadoDeAvisos(base), null, 2));
      return 0;
    }
    if (orden === 'avisos') {
      if (!resto[0]) {
        console.error('Indique el archivo JSON que escribió `pnpm datos:avisos`.');
        return 2;
      }
      await migrar(base);
      const crudo = fs.readFileSync(path.resolve(resto[0]), 'utf8');
      const json = JSON.parse(crudo.charCodeAt(0) === 0xfeff ? crudo.slice(1) : crudo);
      const avisos = Array.isArray(json) ? json : json.avisos;
      if (!Array.isArray(avisos)) throw new Error('El archivo no trae la lista `avisos`.');
      const ahora = new Date(json.metadatos?.generado ?? Date.now());
      // Solo las fuentes que terminaron sin error pueden marcar avisos como caídos.
      const resumen = json.metadatos?.fuentes ?? {};
      const fuentes: string[] = Array.isArray(resumen)
        ? resumen.filter((f: any) => !f.error).map((f: any) => f.fuente ?? f.nombre)
        : Object.entries(resumen)
            .filter(([, v]: [string, any]) => !v?.error)
            .map(([k]) => k);
      const tc = await tipoCambioVigente(base, ahora.toISOString().slice(0, 10));
      if (!tc) console.warn('No hay tipo de cambio guardado: los precios en dólares quedarán sin equivalente en soles. Corra antes `pnpm datos:tipo-cambio`.');
      let ultima = 0;
      const geocodificar = banderas.has('--geocodificar')
        ? async (texto: string) => {
            const espera = 1100 - (Date.now() - ultima); // política de uso de Nominatim: una consulta por segundo como máximo
            if (espera > 0) await new Promise((r) => setTimeout(r, espera));
            ultima = Date.now();
            return geocodificarNominatim(texto, { fetch: fetch as any });
          }
        : undefined;
      const r = await ingerirCorrida(base, avisos, { ahora, fuentes: fuentes.filter(Boolean), tipoCambio: tc, geocodificar, gastoUsd: Number(json.metadatos?.gasto_usd ?? 0), topeUsd: json.metadatos?.filtros?.topeUsd ?? null });
      console.log(`Corrida ${r.corridaId}: ${r.recibidos} recibidos, ${r.aceptados} aceptados, ${r.descartados} descartados ${JSON.stringify(r.motivosDescarte)}.`);
      console.log(`  nuevos ${r.nuevos}, actualizados ${r.actualizados}, cambios de precio ${r.cambiosDePrecio}, caídos ${r.caidos}, duplicados entre portales ${r.duplicadosEntrePortales}.`);
      console.log(`  sin coordenadas ${r.sinCoordenadas - r.geocodificados} (geocodificados ${r.geocodificados}), sin distrito ${r.sinDistrito}, sin tipo ${r.sinTipo}, sin precio en soles ${r.sinPrecioEnSoles}.`);
      console.log(`  estado: ${JSON.stringify(await estadoDeAvisos(base))}`);
      return 0;
    }
    console.error('Orden desconocida. Use: migrar | cargar [filtro] | verificar | ficha <lat> <lon>');
    return 2;
  } finally {
    await base.cerrar();
  }
}

principal().then(
  (codigo) => process.exit(codigo),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
