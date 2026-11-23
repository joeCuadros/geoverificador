import type { ReactNode } from 'react';

/**
 * Los iconos del asistente: una sola familia (trazo de 1,8 en una cuadrícula de 20, extremos redondos, color heredado). Siempre acompañan a un texto y por eso van ocultos
 * a los lectores de pantalla. Los estados cumple / no cumple / informativo / sin dato son los de `EstadoChip` (FichaPartes), los mismos de la ficha.
 */
function Icono({ children, tamano = 16 }: { children: ReactNode; tamano?: number }) {
  return (
    <svg className="icono" viewBox="0 0 20 20" width={tamano} height={tamano} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const IconoInfo = () => (
  <Icono>
    <circle cx="10" cy="10" r="8.25" />
    <path d="M10 9v5" />
    <circle cx="10" cy="6.4" r="1" fill="currentColor" stroke="none" />
  </Icono>
);

export const IconoAlerta = () => (
  <Icono>
    <path d="M10 2.8l7.4 13H2.6z" />
    <path d="M10 8v3.6" />
    <circle cx="10" cy="14" r=".9" fill="currentColor" stroke="none" />
  </Icono>
);

export const IconoChevron = () => (
  <Icono tamano={14}>
    <path d="M5 7.8l5 5 5-5" />
  </Icono>
);

export const IconoCerrar = () => (
  <Icono tamano={14}>
    <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
  </Icono>
);

export const IconoEnviar = () => (
  <Icono>
    <path d="M3 10h13M11 4.5l5.5 5.5-5.5 5.5" />
  </Icono>
);

export const IconoFlecha = () => (
  <Icono tamano={14}>
    <path d="M4 10h11M10.5 5.5L15 10l-4.5 4.5" />
  </Icono>
);

export const IconoMapa = () => (
  <Icono>
    <path d="M10 18s6-5.2 6-9.6A6 6 0 004 8.4C4 12.8 10 18 10 18z" />
    <circle cx="10" cy="8.4" r="2.1" />
  </Icono>
);

export const IconoEnlace = () => (
  <Icono>
    <path d="M8.5 4H5a1.5 1.5 0 00-1.5 1.5v9A1.5 1.5 0 005 16h9a1.5 1.5 0 001.5-1.5V11M11.5 3.5h5v5M16.5 3.5L9.5 10.5" />
  </Icono>
);

export const IconoEntorno = () => (
  <Icono>
    <circle cx="10" cy="10" r="2" />
    <circle cx="10" cy="10" r="6.2" strokeDasharray="2.2 2.4" />
    <path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2" />
  </Icono>
);

export const IconoOrden = () => (
  <Icono>
    <path d="M6 4v12M3.5 13.5L6 16l2.5-2.5M14 16V4M11.5 6.5L14 4l2.5 2.5" />
  </Icono>
);
