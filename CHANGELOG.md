# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el versionado [Semantic Versioning](https://semver.org/lang/es/).

## [Sin publicar]

### Añadido

- Herramienta `get_usage`: consumo real y fondo de créditos desde
  `GET /v1/usage` (créditos usados/restantes y reinicio; peticiones,
  tokens de entrada/salida/caché y créditos por modelo; totales).
  Entrada opcional `start_date`/`end_date` (`YYYY-MM-DD`); por defecto
  el periodo de créditos actual. Avisa si la respuesta está truncada
  (`has_more`) en vez de cortarla en silencio. (#18)

### Cambiado

- `get_quota` marca con «counter not updated since YYYY-MM-DD» los
  modelos cuyo contador va por detrás de la actividad real, y su
  descripción apunta a `get_usage`. El formato de salida existente no
  cambia. (#18)

## [1.4.0] - 2026-11-10

### Añadido

- `generate_image` acepta el parámetro opcional `model`:
  `flux-2-klein` (por defecto) o `qwen-image-2.1`.
- Soporte para `qwen-image-2.1`: texto→imagen, 512–1280 px,
  `seed` entero de 0 a 2147483647 y sin `guidance`.
- Validación local del tamaño para ambos modelos: múltiplos de 16,
  rango por modelo y ratio entre 1:3 y 3:1.
- Validación del `seed` de `qwen-image-2.1` antes de llamar a la API.
- `CHANGELOG.md`.

### Cambiado

- `edit_image` sigue siendo exclusivo de `flux-2-klein`, ya que
  `qwen-image-2.1` no admite imágenes de referencia.
- Las descripciones de las herramientas documentan que la cuota de
  100 imágenes/mes es compartida entre los dos modelos.
- Dependencias actualizadas (MCP SDK 1.32.2, zod 4.6.7).

### Corregido

- El README indicaba un límite de 1 req/s (burst 3); la API publica
  20 req/min y 100 imágenes/mes compartidas.
- Referencias de instalación actualizadas a `nan-mcp-server@1.4.0`.

## [1.3.0] - 2026-10-11

### Añadido

- Herramienta `get_quota` para consultar la cuota de tokens por modelo
  desde el backend del dashboard.

## [1.2.0] - 2026-10-07

### Añadido

- El servidor arranca sin `NAN_API_KEY` para que los inspectores puedan
  leer el catálogo de herramientas.

[1.4.0]: https://github.com/luciferfran/nan-mcp-server/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/luciferfran/nan-mcp-server/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/luciferfran/nan-mcp-server/compare/v1.1.4...v1.2.0
