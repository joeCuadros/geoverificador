'use client';
import { useRef, useState } from 'react';

interface Turno { quien: 'yo' | 'agente'; texto: string }

export default function Pagina() {
  const [turnos, setTurnos] = useState<Turno[]>([{ quien: 'agente', texto: 'Cuéntame qué vivienda buscas en Arequipa: tipo, distrito, precio máximo y qué quieres tener cerca.' }]);
  const [cargando, setCargando] = useState(false);
  const estado = useRef<unknown>(null);

  async function enviar(f: React.FormEvent<HTMLFormElement>) {
    f.preventDefault();
    const campo = f.currentTarget.elements.namedItem('mensaje') as HTMLInputElement;
    const mensaje = campo.value.trim();
    if (!mensaje) return;
    campo.value = '';
    setTurnos((t) => [...t, { quien: 'yo', texto: mensaje }]);
    setCargando(true);
    try {
      const r = await fetch('/api/agente', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mensaje, estado: estado.current ?? undefined }) });
      const j = await r.json();
      if (j.estado) estado.current = j.estado;
      setTurnos((t) => [...t, { quien: 'agente', texto: j.texto ?? j.error ?? 'Algo salió mal.' }]);
    } catch {
      setTurnos((t) => [...t, { quien: 'agente', texto: 'No pude conectar. Intenta de nuevo.' }]);
    } finally {
      setCargando(false);
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '16px' }}>
      <h1 style={{ fontSize: 22 }}>GeoVerificador</h1>
      <div aria-live="polite">
        {turnos.map((t, i) => (
          <p key={i} style={{ whiteSpace: 'pre-wrap', background: t.quien === 'yo' ? '#dbeafe' : '#fff', padding: 12, borderRadius: 8, marginLeft: t.quien === 'yo' ? 48 : 0 }}>{t.texto}</p>
        ))}
        {cargando && <p>Buscando…</p>}
      </div>
      <form onSubmit={enviar} style={{ display: 'flex', gap: 8, position: 'sticky', bottom: 0, paddingTop: 8 }}>
        <input name="mensaje" aria-label="Tu consulta" autoComplete="off" maxLength={600} style={{ flex: 1, padding: 12, fontSize: 16 }} placeholder="Quiero un departamento en Cayma, cerca de un colegio…" />
        <button type="submit" disabled={cargando} style={{ padding: '12px 16px', fontSize: 16 }}>Enviar</button>
      </form>
      <p style={{ fontSize: 12, color: '#555' }}>Los números salen de datos oficiales y de avisos públicos, con su fuente y fecha. Revisa siempre el aviso original.</p>
    </main>
  );
}
