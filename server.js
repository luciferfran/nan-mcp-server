#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs, { realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

export const API_KEY = process.env.NAN_API_KEY;
export const BASE_URL = process.env.NAN_BASE_URL || "https://api.nan.builders/v1";
export const TIMEOUT_MS = Number(process.env.NAN_TIMEOUT_MS) || 180000;

export function getOutputDir() {
  return process.env.NAN_OUTPUT_DIR || path.join(os.homedir(), "nan-mcp-output");
}
export const OUTPUT_DIR = getOutputDir();

const pkgUrl = new URL("./package.json", import.meta.url);
export const VERSION = JSON.parse(fs.readFileSync(pkgUrl, "utf8")).version;

export function safeName(str, max = 60) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max) || "output";
}

export function resolveOutputPath(base, ext, suffix = "") {
  const outRoot = path.resolve(getOutputDir());
  const resolved = path.resolve(outRoot, `${safeName(base)}${suffix}${ext}`);
  if (resolved !== outRoot && !resolved.startsWith(outRoot + path.sep)) {
    throw new Error(`Invalid output name: path escapes the output directory`);
  }
  return resolved;
}

// Writes inside OUTPUT_DIR without ever clobbering an existing file: on collision
// it appends -2, -3, ... The `wx` flag makes the check-and-write atomic.
export function writeUnique(base, ext, suffix, data) {
  const outRoot = path.resolve(getOutputDir());
  fs.mkdirSync(outRoot, { recursive: true });

  for (let i = 0; i < 1000; i++) {
    const candidate = resolveOutputPath(base, ext, `${suffix}${i ? `-${i + 1}` : ""}`);
    try {
      fs.writeFileSync(candidate, data, { flag: "wx" });
      return candidate;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }

  throw new Error(`Could not find a free filename for "${safeName(base)}${suffix}${ext}" in ${outRoot}`);
}

async function downloadBuffer(url, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Download from ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// The body is consumed here so the timeout covers the whole exchange, not just headers.
export async function nanRequest(endpoint, { parse = "json", ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      signal: options.signal || controller.signal,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`NaN API ${res.status}: ${body}`);
    }

    if (parse === "arrayBuffer") return Buffer.from(await res.arrayBuffer());
    if (parse === "text") return res.text();
    return res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`NaN API request to ${endpoint} timed out after ${TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const VOICES = {
  "American English": ["af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa"],
  "British English": ["bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis"],
  "Japanese": ["jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo"],
  "Mandarin Chinese": ["zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi", "zm_yunjian", "zm_yunxi", "zm_yunxia", "zm_yunyang"],
  "Spanish": ["ef_dora", "em_alex", "em_santa"],
  "French": ["ff_siwis"],
  "Hindi": ["hf_alpha", "hf_beta", "hm_omega", "hm_psi"],
  "Italian": ["if_sara", "im_nicola"],
  "Brazilian Portuguese": ["pf_dora", "pm_alex", "pm_santa"],
};

// flux-2-klein serves JPEG today even though it once served PNG, so the extension
// is read from the magic bytes of the payload we actually got. Naming a JPEG
// ".png" leaves files that strict readers reject. Unknown formats keep .png.
export function imageExtension(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return ".webp";
  return ".png";
}

async function saveGeneratedImages(json, base) {
  const count = json.data?.length ?? 0;
  const results = [];
  for (let i = 0; i < count; i++) {
    const item = json.data[i];
    const suffix = count > 1 ? `-${i + 1}` : "";
    const buf = item.b64_json
      ? Buffer.from(item.b64_json, "base64")
      : await downloadBuffer(item.url);
    results.push({ path: writeUnique(base, imageExtension(buf), suffix, buf), url: item.url || null });
  }
  return results;
}

export async function generateImage({ prompt, size, n, seed, guidance, outputName }) {
  const body = {
    model: "flux-2-klein",
    prompt,
    ...(size ? { size } : {}),
    ...(n ? { n } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(guidance !== undefined ? { guidance } : {}),
  };

  const json = await nanRequest("/images/generations", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const results = await saveGeneratedImages(json, outputName || prompt);

  return {
    content: [
      {
        type: "text",
        text: results.map((r) => `Image saved to ${r.path}${r.url ? ` (source URL: ${r.url})` : ""}`).join("\n"),
      },
    ],
  };
}

export async function listVoices() {
  const lines = Object.entries(VOICES).map(([lang, voices]) => `${lang}: ${voices.join(", ")}`);
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

export async function textToSpeech({ text, voice, format, speed, outputName }) {
  const body = {
    model: "kokoro",
    input: text,
    ...(voice ? { voice } : {}),
    ...(format ? { response_format: format } : {}),
    ...(speed ? { speed } : {}),
  };

  const buf = await nanRequest("/audio/speech", {
    method: "POST",
    body: JSON.stringify(body),
    parse: "arrayBuffer",
  });
  const ext = format || "mp3";
  const filePath = writeUnique(outputName || text, `.${ext}`, "", buf);

  return {
    content: [{ type: "text", text: `Audio saved to ${filePath} (${buf.length} bytes)` }],
  };
}

export async function speechToText({ file, language, verbose }) {
  if (!fs.existsSync(file)) {
    throw new Error(`File not found: ${file}`);
  }

  const form = new FormData();
  form.append("model", "whisper");
  form.append("file", new Blob([fs.readFileSync(file)]), path.basename(file));
  if (language) form.append("language", language);
  form.append("response_format", verbose ? "verbose_json" : "json");

  const json = await nanRequest("/audio/transcriptions", {
    method: "POST",
    body: form,
  });

  const text = verbose
    ? JSON.stringify(json, null, 2)
    : (json.text || "No transcription returned");

  return { content: [{ type: "text", text }] };
}

export async function listModels() {
  const json = await nanRequest("/models");
  const lines = (json.data || []).map((m) => `${m.id} (${m.owned_by})`);
  return { content: [{ type: "text", text: lines.join("\n") || "No models found" }] };
}

export async function embed({ input, encoding_format }) {
  const body = {
    model: "qwen3-embedding",
    input,
    ...(encoding_format ? { encoding_format } : {}),
  };

  const json = await nanRequest("/embeddings", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const n = (json.data || []).length;
  const dims = json.data?.[0]?.embedding?.length ?? 0;
  const inputTokens = json.usage?.prompt_tokens ?? "?";

  return {
    content: [
      {
        type: "text",
        text: `Embedded ${n} item(s), ${dims} dimensions, ${inputTokens} input tokens. Use a dedicated tool to inspect or store the vectors (truncated here for context).`,
      },
    ],
  };
}

export async function rerank({ query, documents, top_n }) {
  const body = {
    model: "rerank",
    query,
    documents,
    ...(top_n ? { top_n } : {}),
  };

  const json = await nanRequest("/rerank", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const lines = (json.results || []).map(
    (r) => `[${r.relevance_score.toFixed(4)}] (orig index ${r.index}) ${r.document?.text || ""}`
  );

  return { content: [{ type: "text", text: lines.join("\n") || "No results" }] };
}

export async function editImage({ prompt, images, size, n, seed, guidance, outputName }) {
  // The schema caps this at 4; slicing here too would only hide a fifth image
  // from a caller that bypassed it.
  for (const f of images) {
    if (!fs.existsSync(f)) throw new Error(`File not found: ${f}`);
  }

  const form = new FormData();
  form.append("model", "flux-2-klein");
  for (const f of images) {
    form.append("image[]", new Blob([fs.readFileSync(f)]), path.basename(f));
  }
  form.append("prompt", prompt);
  if (size) form.append("size", size);
  if (n) form.append("n", String(n));
  if (seed !== undefined) form.append("seed", String(seed));
  if (guidance !== undefined) form.append("guidance", String(guidance));

  const json = await nanRequest("/images/edits", {
    method: "POST",
    body: form,
  });
  const results = await saveGeneratedImages(json, outputName || prompt);

  return {
    content: [
      {
        type: "text",
        text: results.map((r) => `Image saved to ${r.path}${r.url ? ` (source URL: ${r.url})` : ""}`).join("\n"),
      },
    ],
  };
}

const server = new McpServer({
  name: "nan-mcp-server",
  version: VERSION,
});

server.registerTool("generate_image", {
  title: "Generate Image",
  description: "Generate an image with flux-2-klein (NaN API). Returns the saved image file path and its URL.",
  inputSchema: {
    prompt: z.string().describe("Textual description of the image to generate"),
    size: z.string().optional().describe('Image size "WxH" divisible by 16, e.g. 1024x1024, 1536x1024, 1024x1536. Default 1024x1024'),
    n: z.number().int().min(1).max(4).optional().describe("Number of images to generate (1-4). Default 1"),
    seed: z.number().optional().describe("Base seed for reproducibility"),
    guidance: z.number().optional().describe("FLUX guidance scale"),
    outputName: z.string().optional().describe("Optional base name for the output file(s)"),
  },
}, generateImage);

server.registerTool("list_voices", {
  title: "List Voices",
  description: "List all available kokoro TTS voices grouped by language.",
  inputSchema: {},
}, listVoices);

server.registerTool("text_to_speech", {
  title: "Text To Speech",
  description: "Synthesize audio from text with kokoro (NaN API TTS). Returns the saved audio file path. Use the list_voices tool to see all available voices per language.",
  inputSchema: {
    text: z.string().describe("Text to synthesize"),
    voice: z.string().optional().describe('Voice to use, e.g. "af_heart" (American English female), "ef_dora" (Spanish female), "em_alex" (Spanish male), "em_santa" (Spanish male). Use list_voices for the full catalog'),
    format: z.enum(["mp3", "wav", "flac", "aac", "pcm", "opus"]).optional().describe("Audio format. Default mp3"),
    speed: z.number().optional().describe("Speech speed. Default 1.0"),
    outputName: z.string().optional().describe("Optional base name for the output file"),
  },
}, textToSpeech);

server.registerTool("speech_to_text", {
  title: "Speech To Text",
  description: "Transcribe an audio file with whisper (NaN API STT). Returns the transcript.",
  inputSchema: {
    file: z.string().describe("Absolute path to the audio file to transcribe"),
    language: z.string().optional().describe('ISO-639-1 language code, e.g. "es", "en". Auto-detected if omitted'),
    verbose: z.boolean().optional().describe("Return verbose JSON with segments instead of plain text"),
  },
}, speechToText);

server.registerTool("list_models", {
  title: "List Models",
  description: "List all available NaN API models for your key.",
  inputSchema: {},
}, listModels);

server.registerTool("embed", {
  title: "Embed",
  description: "Generate vector embeddings with qwen3-embedding (NaN API, 4096 dimensions). Useful for RAG and semantic search.",
  inputSchema: {
    input: z.string().or(z.array(z.string())).describe("Single text or array of strings to embed"),
    encoding_format: z.enum(["float", "base64"]).optional().describe("Encoding format. Default float"),
  },
}, embed);

server.registerTool("rerank", {
  title: "Rerank",
  description: "Re-rank a list of documents by relevance to a query (NaN API, Qwen3-Reranker-8B). Complements embed for RAG pipelines.",
  inputSchema: {
    query: z.string().describe("Query against which each document's relevance is measured"),
    documents: z.array(z.string()).describe("Array of strings to re-rank"),
    top_n: z.number().int().min(1).optional().describe("Limit response to the N most relevant documents"),
  },
}, rerank);

// Exported so a test can check the contract the client actually sees. The
// other tools keep their schema inline.
export const editImageInput = {
  prompt: z.string().describe("Description of the edit or transformation to apply"),
  images: z.array(z.string()).min(1).max(4).describe("Absolute paths to reference image files (PNG, JPEG, WebP; up to 4, each < 25MB)"),
  size: z.string().optional().describe('Image size "WxH" divisible by 16, e.g. 1024x1024, 1536x1024, 1024x1536. Default 1024x1024'),
  n: z.number().int().min(1).max(4).optional().describe("Number of images to generate (1-4). Default 1"),
  seed: z.number().optional().describe("Base seed for reproducibility"),
  guidance: z.number().optional().describe("FLUX guidance scale"),
  outputName: z.string().optional().describe("Optional base name for the output file(s)"),
};

server.registerTool("edit_image", {
  title: "Edit Image",
  description: "Edit an image with flux-2-klein image-to-image (NaN API). Takes one or more reference image files and applies a transformation. Returns the saved output image path.",
  inputSchema: editImageInput,
}, editImage);

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  if (!API_KEY) {
    console.error("Error: NAN_API_KEY environment variable is required");
    process.exit(1);
  }
  fs.mkdirSync(getOutputDir(), { recursive: true });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
