/**
 * Los dibujos de la guía: una miniatura de la propia interfaz para cada paso (el asistente, el buscador, las capas, la ficha…), hecha con cajas y colores de los
 * tokens, sin imágenes: se ven nítidos a cualquier tamaño, siguen el tema claro u oscuro y no hay que volver a sacar capturas cuando cambia un texto.
 * Son decorativos (aria-hidden): lo que explican lo dice el texto del paso, al lado.
 *
 * Si cambia la interfaz que dibujan, hay que cambiarlos a mano (la prueba de la guía solo comprueba que cada paso tenga el suyo).
 */

export type IdIlustracion = 'bienvenida' | 'buscar' | 'capas' | 'ficha' | 'asistente' | 'privacidad';

const Linea = ({ ancho, clase = '' }: { ancho: string; clase?: string }) => <span className={`il-linea ${clase}`} style={{ width: ancho }} />;

function Asistente() {
  return (
    <span className="il-tarjeta il-chat">
      <span className="il-burbuja">Casa en Cayma cerca de un colegio</span>
      <Linea ancho="82%" />
      <Linea ancho="58%" />
      <span className="il-compositor il-resalte">
        <span className="il-compositor-texto">Tu consulta…</span>
        <span className="il-enviar" />
      </span>
    </span>
  );
}

function Mapa({ conPunto = false }: { conPunto?: boolean }) {
  return (
    <span className="il-mapa">
      <span className="il-calle il-calle-1" />
      <span className="il-calle il-calle-2" />
      <span className="il-rio" />
      <span className="il-parque" />
      {conPunto ? <span className="il-punto" /> : (
        <>
          <span className="il-marcador il-marcador-activo" style={{ left: '32%', top: '30%' }}>1</span>
          <span className="il-marcador" style={{ left: '20%', top: '62%' }}>2</span>
          <span className="il-marcador" style={{ left: '62%', top: '22%' }}>3</span>
        </>
      )}
    </span>
  );
}

function Buscar() {
  return (
    <span className="il-columna">
      <span className="il-buscador il-resalte">
        <span className="il-lupa" />
        <span className="il-compositor-texto">Av. Ejército, Cayma</span>
      </span>
      <Mapa conPunto />
    </span>
  );
}

function Capas() {
  return (
    <span className="il-fila">
      <Mapa />
      <span className="il-tarjeta il-capas il-resalte">
        <span className="il-titulo-mini">Capas del mapa</span>
        {['Colegios', 'Paraderos', 'Zonificación'].map((c, i) => (
          <span key={c} className="il-capa">
            <span className={`il-casilla${i < 2 ? ' il-casilla-marcada' : ''}`} />
            {c}
          </span>
        ))}
      </span>
    </span>
  );
}

function Ficha() {
  return (
    <span className="il-tarjeta il-ficha">
      <span className="il-titulo-mini">Ficha del punto</span>
      <span className="il-pastillas">
        <span className="il-pastilla il-ok">✓ 4 dentro</span>
        <span className="il-pastilla il-no">✕ 1 fuera</span>
        <span className="il-pastilla il-nd">? 1 sin dato</span>
      </span>
      <span className="il-medida">
        <span className="il-medida-fila"><span>Colegio primario</span><b>620 m</b></span>
        <span className="il-barra"><span className="il-ok-fondo" style={{ width: '41%' }} /></span>
      </span>
      <span className="il-medida">
        <span className="il-medida-fila"><span>Paradero</span><b>180 m</b></span>
        <span className="il-barra"><span className="il-ok-fondo" style={{ width: '45%' }} /></span>
      </span>
      <span className="il-tema">Riesgos <span className="il-pastilla il-no">✕</span></span>
    </span>
  );
}

function Bienvenida() {
  return (
    <span className="il-fila">
      <span className="il-tarjeta il-chat il-chat-corto">
        <span className="il-burbuja">Casa cerca de un colegio</span>
        <Linea ancho="80%" />
        <span className="il-pastillas">
          <span className="il-pastilla il-ok">✓ 2</span>
          <span className="il-pastilla il-nd">? 1</span>
        </span>
      </span>
      <Mapa />
    </span>
  );
}

function Privacidad() {
  return (
    <span className="il-fila il-privacidad">
      <span className="il-tarjeta il-chat il-chat-corto">
        <span className="il-burbuja">Casa en Cayma…</span>
        <span className="il-candado" />
      </span>
      <span className="il-flecha" />
      <span className="il-tarjeta il-servidor">
        <span className="il-titulo-mini">Sin coordenadas</span>
        <Linea ancho="70%" />
        <Linea ancho="50%" />
      </span>
    </span>
  );
}

const DIBUJOS: Record<IdIlustracion, () => React.JSX.Element> = { bienvenida: Bienvenida, buscar: Buscar, capas: Capas, ficha: Ficha, asistente: Asistente, privacidad: Privacidad };

/** El dibujo de un paso. `tam` cambia la escala: «mini» para la portada del asistente, «grande» para el cuadro de la guía. */
export function Ilustracion({ id, tam = 'grande' }: { id: IdIlustracion; tam?: 'mini' | 'grande' }) {
  const Dibujo = DIBUJOS[id];
  return (
    <span className={`il il-${tam}`} data-ilustracion={id} aria-hidden="true">
      <Dibujo />
    </span>
  );
}

export const tieneIlustracion = (id: string): id is IdIlustracion => id in DIBUJOS;
