'use client';
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Aviso, Etiquetado, Punto } from '../lib/tipos.ts';
import { capasDelMapa, type DefCapaMapa } from '../lib/capas.ts';

export interface PropsMapa {
  punto: Punto | null;
  radioM: number;
  avisos: Aviso[];
  avisoActivo: number | null;
  destino: Etiquetado | null;
  capas: string[];
  vista: { lat: number; lon: number; zoom?: number; n: number } | null;
  onElegir: (p: Punto) => void;
  onAviso: (id: number) => void;
}

const CENTRO: [number, number] = [-16.39883, -71.53697];
const icono = (clase: string, html: string, size: [number, number]) => L.divIcon({ className: clase, html, iconSize: size, iconAnchor: [size[0] / 2, size[1]] });
const PIN =
  '<svg viewBox="0 0 38 48" width="34" height="43" aria-hidden="true"><path d="M19 46S3 29.5 3 18a16 16 0 0 1 32 0c0 11.5-16 28-16 28z" fill="#0f6e5a" stroke="#fff" stroke-width="2.5"/><circle cx="19" cy="18" r="6" fill="#fff"/></svg>';
const ficha = (texto: string, activo: boolean) =>
  `<div style="background:${activo ? '#0f6e5a' : '#14202b'};color:#fff;border:2px solid #fff;border-radius:999px;min-width:28px;height:28px;display:grid;place-items:center;font:700 13px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.35);padding:0 6px">${texto}</div>`;

export default function Mapa(p: PropsMapa) {
  const el = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const marcaPunto = useRef<L.Marker | null>(null);
  const circulo = useRef<L.Circle | null>(null);
  const marcaDestino = useRef<L.Marker | null>(null);
  const capaAvisos = useRef<L.LayerGroup | null>(null);
  const capasVivas = useRef<Map<string, L.LayerGroup>>(new Map());
  const alElegir = useRef(p.onElegir);
  alElegir.current = p.onElegir;
  const alAviso = useRef(p.onAviso);
  alAviso.current = p.onAviso;

  useEffect(() => {
    if (!el.current || mapa.current) return;
    const m = L.map(el.current, { zoomControl: false }).setView(CENTRO, 14);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m);
    m.on('click', (e) => alElegir.current({ lat: +e.latlng.lat.toFixed(6), lon: +e.latlng.lng.toFixed(6) }));
    capaAvisos.current = L.layerGroup().addTo(m);
    mapa.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      mapa.current = null;
    };
  }, []);

  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    marcaPunto.current?.remove();
    circulo.current?.remove();
    if (!p.punto) return;
    marcaPunto.current = L.marker([p.punto.lat, p.punto.lon], { icon: icono('pin-punto', PIN, [34, 43]), keyboard: false, zIndexOffset: 1000 }).addTo(m);
    circulo.current = L.circle([p.punto.lat, p.punto.lon], { radius: p.radioM, color: '#0f6e5a', weight: 1.5, fillOpacity: 0.06, interactive: false }).addTo(m);
  }, [p.punto, p.radioM]);

  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    marcaDestino.current?.remove();
    marcaDestino.current = null;
    if (p.destino) marcaDestino.current = L.marker([p.destino.lat, p.destino.lon], { icon: icono('pin-dest', ficha('⚑', false), [28, 28]), title: p.destino.nombre ?? 'Destino' }).addTo(m);
  }, [p.destino]);

  useEffect(() => {
    const g = capaAvisos.current;
    if (!g) return;
    g.clearLayers();
    p.avisos.forEach((a, i) => {
      if (a.lat == null || a.lon == null) return;
      L.marker([a.lat, a.lon], { icon: icono('pin-aviso', ficha(String(i + 1), a.id === p.avisoActivo), [28, 28]), title: a.titulo ?? 'Aviso', zIndexOffset: a.id === p.avisoActivo ? 900 : 500 })
        .on('click', () => alAviso.current(a.id))
        .addTo(g);
    });
    const conPunto = p.avisos.filter((a) => a.lat != null && a.lon != null);
    if (conPunto.length && mapa.current) mapa.current.fitBounds(L.latLngBounds(conPunto.map((a) => [a.lat!, a.lon!] as [number, number])).pad(0.3), { maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.avisos]);

  useEffect(() => {
    const g = capaAvisos.current;
    if (!g) return;
    let i = 0;
    g.eachLayer((l) => {
      const a = p.avisos.filter((x) => x.lat != null)[i++];
      if (a) (l as L.Marker).setIcon(icono('pin-aviso', ficha(String(p.avisos.indexOf(a) + 1), a.id === p.avisoActivo), [28, 28]));
    });
  }, [p.avisoActivo, p.avisos]);

  useEffect(() => {
    if (p.vista && mapa.current) mapa.current.setView([p.vista.lat, p.vista.lon], p.vista.zoom ?? Math.max(mapa.current.getZoom(), 15), { animate: true });
  }, [p.vista]);

  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    const vivas = capasVivas.current;
    for (const [id, g] of vivas) {
      if (!p.capas.includes(id)) {
        g.remove();
        vivas.delete(id);
      }
    }
    const refrescar = () => {
      for (const id of p.capas) {
        const def: DefCapaMapa | undefined = capasDelMapa[id];
        if (!def) continue;
        let g = vivas.get(id);
        if (!g) {
          g = L.layerGroup().addTo(m);
          vivas.set(id, g);
        }
        void def.cargar(m, g);
      }
    };
    refrescar();
    m.on('moveend', refrescar);
    return () => {
      m.off('moveend', refrescar);
    };
  }, [p.capas]);

  return <div ref={el} style={{ position: 'absolute', inset: 0 }} role="application" aria-label="Mapa de Arequipa. Toca un punto para ver su entorno." />;
}
