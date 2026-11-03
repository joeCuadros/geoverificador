# Identidad visual de GeoVerificador

Fuente: `public/css/styles.css` del repositorio (tokens en `:root`). El sitio publicado es <https://geoverificador-nine.vercel.app>.

**Idea:** la piedra blanca de Arequipa (sillar) y la tinta azul de los planos. Fondo de sillar claro con juntas de bloques apenas visibles; tinta azul para la acción y la barra superior; ámbar solo para el aviso de que la consulta es referencial.

## Tipografías
- **Public Sans** (interfaz), pesos 100 a 900, autoalojada.
- **Source Serif 4** (títulos, direcciones, códigos de zona y cifras), pesos 200 a 900, autoalojada.
- Pila de reserva: `system-ui` para la interfaz y `Georgia` para los títulos.

## Tokens: tema claro

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#f3eee3` | Fondo (sillar) |
| `--surface` | `#fbf8f1` | Tarjetas |
| `--surface-2` | `#ece6d8` | Superficie secundaria |
| `--line` / `--line-strong` | `#d8cfbc` / `#b9ad94` | Bordes |
| `--input-border` | `#7d7461` | Borde de campos |
| `--ink` / `--ink-2` / `--muted` | `#1b2233` / `#3a4254` / `#565c6b` | Texto |
| `--tinta` | `#1c3a6b` | Acción principal, enlaces |
| `--tinta-hover` | `#142b53` | Estado hover |
| `--on-tinta` | `#fbf8f1` | Texto sobre tinta |
| `--tinta-soft` | `#dfe7f3` | Fondo suave de acción |
| `--band` / `--on-band` | `#15294f` / `#f3eee3` | Barra superior |
| `--ok` / `--ok-bg` | `#17603a` / `#e1f1e6` | Cumple |
| `--no` / `--no-bg` | `#9b2415` / `#f9e3de` | No cumple |
| `--dato` / `--dato-bg` | `#444b5c` / `#e7e3d8` | Sin dato |
| `--parcial` / `--parcial-bg` | `#7a4a00` / `#f8e9c8` | Parcial |
| `--amb-bg` / `--amb-line` / `--amb-text` | `#fff1c9` / `#b07a12` / `#4a3000` | Aviso referencial (único uso del ámbar) |
| `--map-poi` / `--map-verde` | `#1c3a6b` / `#2f7a4d` | Marcadores del mapa |

## Tokens: tema oscuro (`prefers-color-scheme: dark`)

| Token | Valor |
|---|---|
| `--bg` / `--surface` / `--surface-2` | `#101520` / `#171d2b` / `#1f2738` |
| `--line` / `--line-strong` / `--input-border` | `#2c3548` / `#46506a` / `#7b86a0` |
| `--ink` / `--ink-2` / `--muted` | `#ece8de` / `#cfcbc0` / `#a4a9b8` |
| `--tinta` / `--tinta-hover` / `--on-tinta` | `#9dbcf0` / `#bcd1f6` / `#0d1730` |
| `--tinta-soft` | `#1f2c47` |
| `--band` / `--on-band` | `#0a0e17` / `#ece8de` |
| `--ok` / `--ok-bg` | `#8fd6a6` / `#12301f` |
| `--no` / `--no-bg` | `#ffa595` / `#3a1a15` |
| `--dato` / `--dato-bg` | `#b9bfce` / `#262d3c` |
| `--parcial` / `--parcial-bg` | `#f4d089` / `#3a2c0c` |
| `--amb-bg` / `--amb-line` / `--amb-text` | `#35280a` / `#c79320` / `#fbe3a0` |
| `--map-poi` / `--map-verde` | `#9dbcf0` / `#6fcf97` |

## Forma y ritmo
- Radio de esquina: tarjetas `12px`, controles `8px`; botones secundarios y chips en forma de píldora.
- Sombras suaves de tono cálido en claro y negras en oscuro.
- Objetivos táctiles de **44 px** como mínimo; foco visible (`--focus`).
- Textura de «juntas de bloques» (patrón SVG muy tenue) sobre el fondo del panel.

## Estado de la revisión

Revisado el 2026-11-03 contra `main` (`c9508f7`): **ningún token de `:root` cambió** con el PR #7 (claro y oscuro iguales, mismas fuentes, `--radius:12px`, `--panel-w:460px`). Solo se añadieron componentes y puntos de quiebre.

## Componentes añadidos por el PR #7
- `.barra-acciones` y `.btn-barra` (Comparar con contador, Asistente, ¿Cómo funciona?).
- Tarjetas `<details>` desplegables (con consulta de contenedor a 440 px) y `.disclosure` con chevron.
- Diálogos del tour y del comparador; `.tabla-comparar` y tarjetas apiladas `.carta-*` a ≤ 480 px.
- Panel de verificaciones y estilos de impresión del informe (`rp-*`).
- `.estado.informativo` (usa `--tinta`) y una píldora «Modo» en la cabecera del chat.
- Enlace para saltar la barra (`.saltar`), `forced-colors` y puntos de quiebre en 639,98 / 480 / 420 / 359,98 px; barra superior en una sola fila desde 320 px.

## Patrones ya construidos (para mantener coherencia)
- Barra superior con marca, pasos 1-2-3 y botones «Asistente» y «¿Cómo funciona?».
- Tarjetas de variable con **icono + texto** de estado (cumple / no cumple / sin dato / parcial).
- Chat flotante en escritorio (tarjeta abajo a la derecha, 420 px) y hoja a pantalla completa en móvil; marcadores numerados en el mapa.
- Aviso ámbar «Consulta referencial» y bloque informativo azul suave.

Se puede **proponer** una evolución del sistema visual, pero hay que justificarla y **conservar** la identidad (sillar, tinta de plano, serif para cifras, estados con icono y texto, tema oscuro).
