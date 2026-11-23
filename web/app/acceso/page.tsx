'use client';
import { useEffect, useState } from 'react';
import Cuenta from '@geoverificador/dominio/nucleo/cuenta';
import ui from '../../componentes/ui.module.css';
import estilos from './acceso.module.css';

export default function Acceso() {
  const [error, setError] = useState<string | null>(null);
  const [volver, setVolver] = useState<string | null>(null);
  const [sesion, setSesion] = useState<string | null>(null);
  const [sinConfigurar, setSinConfigurar] = useState(false);

  useEffect(() => {
    const p = Cuenta.leerParametros(window.location.search) as { error: string | null; volver: string | null };
    setVolver(p.volver);
    if (p.error) setError(Cuenta.mensajeDeError(p.error));
    void Cuenta.consultarMe(window.fetch.bind(window)).then((e: any) => {
      if (e.tipo === 'sesion') setSesion(e.nombre);
      if (e.tipo === 'no_configurado') setSinConfigurar(true);
    });
  }, []);

  return (
    <main className={estilos.pagina}>
      <section className={ui.tarjeta} style={{ maxWidth: 480, width: '100%' }}>
        <p className={ui.tit}>Cuenta opcional</p>
        <h1 className={ui.h2} style={{ fontSize: 24 }}>Inicia sesión con Google</h1>
        <p className={ui.sub}>No necesitas una cuenta: GeoVerificador funciona completo sin ella, y iniciar sesión no cambia tus resultados.</p>
        {error && <p role="alert" className={estilos.error}>{error}</p>}
        {sinConfigurar && <p role="status" className={estilos.info}>{Cuenta.mensajeDeError('no_configurado')}</p>}
        {sesion ? (
          <div className={estilos.acciones}>
            <p>Sesión iniciada como <strong>{sesion}</strong></p>
            <a className={`${ui.boton} ${ui.primario}`} href="/">Volver a la consulta</a>
            <button type="button" className={ui.boton} onClick={async () => { if (await Cuenta.cerrarSesion(window.fetch.bind(window))) setSesion(null); }}>Cerrar sesión</button>
          </div>
        ) : (
          <div className={estilos.acciones}>
            <a className={`${ui.boton} ${ui.primario}`} href={Cuenta.hrefInicio(volver)} aria-disabled={sinConfigurar} style={sinConfigurar ? { pointerEvents: 'none', opacity: 0.5 } : undefined}>Continuar con Google</a>
            <a className={ui.boton} href="/">Continuar sin cuenta</a>
          </div>
        )}
        <h2 className={ui.tit} style={{ marginTop: 22 }}>Qué leemos y qué guardamos</h2>
        <ul className={estilos.lista}>
          <li>Google nos da tu <strong>nombre</strong> y un <strong>identificador interno</strong>. No es tu correo ni tu foto: no los pedimos.</li>
          <li>Tu contraseña de Google no pasa por GeoVerificador.</li>
          <li>No guardamos nada tuyo en el servidor: no hay base de datos de usuarios.</li>
          <li>Tu sesión vive en una cookie firmada de este navegador. Dura 7 días y «Cerrar sesión» la borra.</li>
        </ul>
      </section>
    </main>
  );
}
