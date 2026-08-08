# NaN MCP Server

[![npm](https://img.shields.io/npm/v/nan-mcp-server)](https://www.npmjs.com/package/nan-mcp-server)
![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=nodedotjs&logoColor=white)
![Tests](https://img.shields.io/badge/tests-29%20passed-brightgreen)
![License](https://img.shields.io/badge/license-MIT-green)
[![MCP](https://img.shields.io/badge/MCP-SDK%201.30-blueviolet)](https://modelcontextprotocol.io)

Servidor MCP (Model Context Protocol) que expone las herramientas de media de la [API de NaN](https://nan.builders) (`api.nan.builders`) para cualquier cliente compatible con MCP.

Al ser un estándar abierto, funciona con **opencode**, **Claude Code**, **Codex**, **Pi**, **Cursor**, **Windsurf**, **Zed**, etc.

## Herramientas

| Herramienta | Descripción | Modelo |
|---|---|---|
| `generate_image` | Generar imagen desde texto | `flux-2-klein` |
| `edit_image` | Editar imagen (imagen→imagen) | `flux-2-klein` |
| `text_to_speech` | Sintetizar audio desde texto | `kokoro` |
| `list_voices` | Listar voces kokoro por idioma | — |
| `speech_to_text` | Transcribir audio a texto | `whisper` |
| `embed` | Embeddings vectoriales (4096 dims) | `qwen3-embedding` |
| `rerank` | Reordenar documentos por relevancia (RAG) | `rerank` |
| `list_models` | Listar modelos disponibles con tu key | — |

## Requisitos

- Node.js >= 18
- Una API key de [NaN](https://nan.builders) (`sk-...`)

## Instalación

El paquete se distribuye por [npm](https://www.npmjs.com/package/nan-mcp-server). La forma más simple de usarlo en cualquier cliente MCP es **sin instalarlo**: `npx` lo ejecuta al vuelo.

```bash
export NAN_API_KEY="sk-tu-key-aqui"
npx -y nan-mcp-server@latest
```

O instálalo localmente:

```bash
npm install -g nan-mcp-server
nan-mcp-server
```

## Configuración

El servidor se ejecuta vía **stdio** (proceso local). Solo necesita una variable de entorno: `NAN_API_KEY`.

Las imágenes y audios generados se guardan en `~/nan-mcp-output/` (configurable con `NAN_OUTPUT_DIR`).

### Configuración por cliente

<details>
  <summary>opencode</summary>

Añade a tu `opencode.jsonc` (o créalo en `~/.config/opencode/`):

```jsonc
{
  "mcp": {
    "nan-media": {
      "type": "local",
      "command": ["npx", "-y", "nan-mcp-server@latest"],
      "environment": {
        "NAN_API_KEY": "{env:NAN_API_KEY}"
      }
    }
  }
}
```

</details>

<details>
  <summary>Claude Code</summary>

**Instalar vía CLI:**

```bash
claude mcp add nan-media --scope user -e NAN_API_KEY='${NAN_API_KEY}' -- \
  npx -y nan-mcp-server@latest
```

**O en `.mcp.json`:**

```json
{
  "mcpServers": {
    "nan-media": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "nan-mcp-server@latest"],
      "env": {
        "NAN_API_KEY": "${NAN_API_KEY}"
      }
    }
  }
}
```

</details>

<details>
  <summary>Codex</summary>

En `~/.codex/config.toml`:

```toml
[mcp_servers.nan]
url = "https://api.nan.builders/mcp"
bearer_token_env_var = "NAN_API_KEY"

[mcp_servers.nan-media]
command = "npx"
args = ["-y", "nan-mcp-server@latest"]
```

> **Seguridad**: codex lee `NAN_API_KEY` de una variable de entorno — el servidor remoto vía `bearer_token_env_var` y el servidor local la hereda del shell. Así `config.toml` se puede subir a GitHub sin exponer secretos.

</details>

<details>
  <summary>Pi</summary>

Pi usa [`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter) y lee los archivos MCP estándar. Instala el adaptador:

```bash
pi install npm:pi-mcp-adapter
```

Crea `~/.config/mcp/mcp.json` (config compartido MCP estándar):

```json
{
  "mcpServers": {
    "nan": {
      "url": "https://api.nan.builders/mcp",
      "auth": "bearer",
      "bearerTokenEnv": "NAN_API_KEY"
    },
    "nan-media": {
      "command": "npx",
      "args": ["-y", "nan-mcp-server@latest"],
      "env": {
        "NAN_API_KEY": "$env:NAN_API_KEY"
      }
    }
  }
}
```

> El servidor `nan` (remoto) usa `auth: "bearer"` con `bearerTokenEnv`; `nan-media` (local) interpola la key con `$env:NAN_API_KEY`. Ningún secreto queda en el archivo.

Para usar los modelos de NaN en Pi, define el proveedor en `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "nan": {
      "baseUrl": "https://api.nan.builders/v1",
      "api": "openai-completions",
      "apiKey": "$NAN_API_KEY",
      "models": [
        { "id": "deepseek-v4-flash", "name": "DeepSeek V4 Flash", "reasoning": true, "input": ["text"], "contextWindow": 1048576 },
        { "id": "qwen3.6", "name": "Qwen 3.6", "reasoning": true, "input": ["text", "image"], "contextWindow": 262144 }
      ]
    }
  }
}
```

Luego usa `--provider nan --model <id>` (p.ej. `pi --provider nan --model deepseek-v4-flash`).

</details>

<details>
  <summary>Cursor / Windsurf / Zed</summary>

En la configuración de MCP del cliente, añade un servidor stdio:

```
Comando: npx -y nan-mcp-server@latest
Variables: NAN_API_KEY=tu-clave-de-nan-builders (no la incluyas en el config versionado)
```

</details>

## Uso

Una vez conectado, pide al agente:

- "Genera una imagen de un faro al atardecer con nan-media"
- "Sintetiza en español: Hola mundo, voz ef_dora"
- "Transcribe el audio /ruta/audio.mp3"
- "Reordena estos documentos según la query X"

## Límites de la API

| Recurso | Límite |
|---|---|
| Generación/edición de imágenes | 100 req/mes por usuario, 1 req/s (burst 3) |
| Tamaño máximo archivo (STT / edit_image) | 25 MB por archivo |
| Audios para transcripción | máx. ~2 min por archivo (timeout 524 si supera) |
| Imágenes de referencia (edit_image) | hasta 4 |
| Web search (vía MCP remoto) | 20 req/min, 500 req/día |

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `NAN_API_KEY` | Sí | API key de NaN |
| `NAN_BASE_URL` | No | Base URL de la API (default `https://api.nan.builders/v1`) |
| `NAN_OUTPUT_DIR` | No | Directorio de salida (default `~/nan-mcp-output`) |
| `NAN_TIMEOUT_MS` | No | Timeout por petición en ms (default `180000`, 3 min) |

## Desarrollo

### Estructura

```
nan-mcp-server/
├── server.js            # Servidor MCP + herramientas
├── test/server.test.js  # Tests (node:test, sin dependencias extra)
├── package.json
└── README.md
```

### Testing

Los tests usan el test runner nativo de Node (`node:test`), sin dependencias adicionales. No hacen llamadas a la API (usan un valor de prueba para `NAN_API_KEY`), así que se ejecutan sin red ni credenciales.

```bash
npm test
```

Para probar el servidor manualmente contra la API real (requiere key):

```bash
NAN_API_KEY=sk-tu-key-aqui node server.js
```

Y luego una llamada de ejemplo vía stdio:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' \
  | node server.js
```

### Publicación / CI

- El código no contiene secretos: `NAN_API_KEY` se lee solo del entorno.
- El `.gitignore` excluye `node_modules/`, logs y `.env`.
- Para CI, basta con `npm install && npm test`.

## Notas

- Las imágenes y audios se guardan en `~/nan-mcp-output/` (configurable con `NAN_OUTPUT_DIR`). Los nombres se sanitizan (sin path traversal) y nunca se sobrescriben archivos existentes: si el nombre ya está ocupado se añade `-2`, `-3`, etc.
- Los archivos de entrada (STT / edit_image) se cargan en memoria; para archivos muy grandes conviene dividirlos.
- El servidor no contiene ningún secreto en el código: solo lee `NAN_API_KEY` del entorno.

## Licencia

MIT — ver [LICENSE](LICENSE).
