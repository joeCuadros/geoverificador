-- 0004 · Operación: uso del agente y eventos para el tablero (tareas 6.8, 7.5 y 8.4).

-- Un mensaje de una conversación con el agente: pasos de herramienta, tokens y si hubo resultados. No guarda el texto de la persona.
CREATE TABLE conversacion_uso (
  id              bigserial PRIMARY KEY,
  sesion          text NOT NULL,            -- identificador opaco de la sesión (no es la IP ni el correo)
  creado_en       timestamptz NOT NULL DEFAULT now(),
  proveedor       text NOT NULL,
  modelo          text,
  pasos           integer NOT NULL DEFAULT 0,
  tokens_entrada  integer NOT NULL DEFAULT 0,
  tokens_salida   integer NOT NULL DEFAULT 0,
  costo_usd       numeric(10, 6),           -- null si no hay tarifa escrita
  resultados      integer,                  -- avisos o zonas devueltos; 0 es «consulta sin resultados»
  redaccion       text NOT NULL CHECK (redaccion IN ('modelo', 'determinista', 'aclaracion')),
  duracion_ms     integer
);
CREATE INDEX conversacion_uso_fecha  ON conversacion_uso (creado_en);
CREATE INDEX conversacion_uso_sesion ON conversacion_uso (sesion, creado_en);

-- Errores y sucesos operativos.
CREATE TABLE evento (
  id        bigserial PRIMARY KEY,
  creado_en timestamptz NOT NULL DEFAULT now(),
  nivel     text NOT NULL CHECK (nivel IN ('info', 'aviso', 'error')),
  origen    text NOT NULL,                 -- 'agente' | 'avisos' | 'datos' | 'web'
  mensaje   text NOT NULL,
  detalle   jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX evento_fecha ON evento (creado_en);
