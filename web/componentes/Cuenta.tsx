'use client';
import { useEffect, useState } from 'react';
import Cuenta from '@geoverificador/dominio/nucleo/cuenta';
import ui from './ui.module.css';

type Estado = { tipo: 'sesion'; nombre: string } | { tipo: 'anonimo' } | { tipo: 'no_configurado' } | { tipo: 'error' } | null;

/** Cuenta opcional (Google). Si el servidor no la tiene configurada, no aparece nada. */
export default function CuentaBarra() {
  const [estado, setEstado] = useState<Estado>(null);

  useEffect(() => {
    let vivo = true;
    void (Cuenta.consultarMe(window.fetch.bind(window)) as Promise<Estado>).then((e) => vivo && setEstado(e));
    return () => { vivo = false; };
  }, []);

  const entrada = Cuenta.entradaDeBarra(estado) as { visible: boolean; texto: string };
  if (!entrada.visible) return null;
  if (estado?.tipo === 'sesion') {
    return (
      <button type="button" className={ui.boton} onClick={async () => { if (await Cuenta.cerrarSesion(window.fetch.bind(window))) setEstado({ tipo: 'anonimo' }); }} title="Cerrar sesión">
        {entrada.texto} · salir
      </button>
    );
  }
  return <a className={ui.boton} href="/acceso">{entrada.texto}</a>;
}
