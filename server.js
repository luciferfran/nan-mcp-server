#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

export const API_KEY = process.env.NAN_API_KEY;
export const BASE_URL = process.env.NAN_BASE_URL || "https://api.nan.builders/v1";
export const OUTPUT_DIR = process.env.NAN_OUTPUT_DIR || path.join(os.homedir(), "nan-mcp-output");

if (!API_KEY) {
  console.error("Error: NAN_API_KEY environment variable is required");
  process.exit(1);
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

export async function nanRequest(endpoint, options = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
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

  return res;
}

export function safeName(str, max = 60) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max) || "output";
}

const server = new McpServer({
  name: "nan-mcp-server",
  version: "1.0.0",
});

server.tool(
  "generate_image",
  "Generate an image with flux-2-klein (NaN API). Returns the saved image file path and its URL.",
  {
    prompt: z.string().describe("Textual description of the image to generate"),
    size: z.string().optional().describe('Image size "WxH" divisible by 16, e.g. 1024x1024, 1536x1024, 1024x1536. Default 1024x1024'),
    n: z.number().int().min(1).max(4).optional().describe("Number of images to generate (1-4). Default 1"),
    seed: z.number().optional().describe("Base seed for reproducibility"),
    guidance: z.number().optional().describe("FLUX guidance scale"),
    outputName: z.string().optional().describe("Optional base name for the output file(s)"),
  },
  async ({ prompt, size, n, seed, guidance, outputName }) => {
    const body = {
      model: "flux-2-klein",
      prompt,
      ...(size ? { size } : {}),
      ...(n ? { n } : {}),
      ...(seed !== undefined ? { seed } : {}),
      ...(guidance !== undefined ? { guidance } : {}),
    };

    const res = await nanRequest("/images/generations", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const json = await res.json();

    const count = json.data?.length ?? 0;
    const base = outputName || safeName(prompt);
    const results = [];

    for (let i = 0; i < count; i++) {
      const item = json.data[i];
      let filePath;
      if (item.b64_json) {
        filePath = path.join(OUTPUT_DIR, `${base}${count > 1 ? `-${i + 1}` : ""}.png`);
        fs.writeFileSync(filePath, Buffer.from(item.b64_json, "base64"));
      } else {
        const imgRes = await fetch(item.url);
        const buf = Buffer.from(await imgRes.arrayBuffer());
        filePath = path.join(OUTPUT_DIR, `${base}${count > 1 ? `-${i + 1}` : ""}.png`);
        fs.writeFileSync(filePath, buf);
      }
      results.push({ path: filePath, url: item.url || null });
    }

    return {
      content: [
        {
          type: "text",
          text: results.map((r) => `Image saved to ${r.path}${r.url ? ` (source URL: ${r.url})` : ""}`).join("\n"),
        },
      ],
    };
  }
);

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

server.tool(
  "list_voices",
  "List all available kokoro TTS voices grouped by language.",
  {},
  async () => {
    const lines = Object.entries(VOICES).map(([lang, voices]) => `${lang}: ${voices.join(", ")}`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "text_to_speech",
  "Synthesize audio from text with kokoro (NaN API TTS). Returns the saved audio file path. Use the list_voices tool to see all available voices per language.",
  {
    text: z.string().describe("Text to synthesize"),
    voice: z.string().optional().describe('Voice to use, e.g. "af_heart" (American English female), "ef_dora" (Spanish female), "em_alex" (Spanish male), "em_santa" (Spanish male). Use list_voices for the full catalog'),
    format: z.enum(["mp3", "wav", "flac", "aac", "pcm", "opus"]).optional().describe("Audio format. Default mp3"),
    speed: z.number().optional().describe("Speech speed. Default 1.0"),
    outputName: z.string().optional().describe("Optional base name for the output file"),
  },
  async ({ text, voice, format, speed, outputName }) => {
    const body = {
      model: "kokoro",
      input: text,
      ...(voice ? { voice } : {}),
      ...(format ? { response_format: format } : {}),
      ...(speed ? { speed } : {}),
    };

    const res = await nanRequest("/audio/speech", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = format || "mp3";
    const filePath = path.join(OUTPUT_DIR, `${outputName || safeName(text)}.${ext}`);
    fs.writeFileSync(filePath, buf);

    return {
      content: [{ type: "text", text: `Audio saved to ${filePath} (${buf.length} bytes)` }],
    };
  }
);

server.tool(
  "speech_to_text",
  "Transcribe an audio file with whisper (NaN API STT). Returns the transcript.",
  {
    file: z.string().describe("Absolute path to the audio file to transcribe"),
    language: z.string().optional().describe('ISO-639-1 language code, e.g. "es", "en". Auto-detected if omitted'),
    verbose: z.boolean().optional().describe("Return verbose JSON with segments instead of plain text"),
  },
  async ({ file, language, verbose }) => {
    if (!fs.existsSync(file)) {
      throw new Error(`File not found: ${file}`);
    }

    const form = new FormData();
    form.append("model", "whisper");
    form.append("file", new Blob([fs.readFileSync(file)]), path.basename(file));
    if (language) form.append("language", language);
    form.append("response_format", verbose ? "verbose_json" : "json");

    const res = await nanRequest("/audio/transcriptions", {
      method: "POST",
      body: form,
    });
    const json = await res.json();

    const text = verbose
      ? JSON.stringify(json, null, 2)
      : (json.text || "No transcription returned");

    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "list_models",
  "List all available NaN API models for your key.",
  {},
  async () => {
    const res = await nanRequest("/models");
    const json = await res.json();
    const lines = (json.data || []).map((m) => `${m.id} (${m.owned_by})`);
    return { content: [{ type: "text", text: lines.join("\n") || "No models found" }] };
  }
);

server.tool(
  "embed",
  "Generate vector embeddings with qwen3-embedding (NaN API, 4096 dimensions). Useful for RAG and semantic search.",
  {
    input: z.string().or(z.array(z.string())).describe("Single text or array of strings to embed"),
    encoding_format: z.enum(["float", "base64"]).optional().describe("Encoding format. Default float"),
  },
  async ({ input, encoding_format }) => {
    const body = {
      model: "qwen3-embedding",
      input,
      ...(encoding_format ? { encoding_format } : {}),
    };

    const res = await nanRequest("/embeddings", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const json = await res.json();

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
);

server.tool(
  "rerank",
  "Re-rank a list of documents by relevance to a query (NaN API, Qwen3-Reranker-8B). Complements embed for RAG pipelines.",
  {
    query: z.string().describe("Query against which each document's relevance is measured"),
    documents: z.array(z.string()).describe("Array of strings to re-rank"),
    top_n: z.number().int().min(1).optional().describe("Limit response to the N most relevant documents"),
  },
  async ({ query, documents, top_n }) => {
    const body = {
      model: "rerank",
      query,
      documents,
      ...(top_n ? { top_n } : {}),
    };

    const res = await nanRequest("/rerank", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const json = await res.json();

    const lines = (json.results || []).map(
      (r) => `[${r.relevance_score.toFixed(4)}] (orig index ${r.index}) ${r.document?.text || ""}`
    );

    return {
      content: [{ type: "text", text: lines.join("\n") || "No results" }],
    };
  }
);

server.tool(
  "edit_image",
  "Edit an image with flux-2-klein image-to-image (NaN API). Takes one or more reference image files and applies a transformation. Returns the saved output image path.",
  {
    prompt: z.string().describe("Description of the edit or transformation to apply"),
    images: z.array(z.string()).describe("Absolute paths to reference image files (PNG, JPEG, WebP; up to 4, each < 25MB)"),
    size: z.string().optional().describe('Image size "WxH" divisible by 16, e.g. 1024x1024, 1536x1024, 1024x1536. Default 1024x1024'),
    n: z.number().int().min(1).max(4).optional().describe("Number of images to generate (1-4). Default 1"),
    seed: z.number().optional().describe("Base seed for reproducibility"),
    guidance: z.number().optional().describe("FLUX guidance scale"),
    outputName: z.string().optional().describe("Optional base name for the output file(s)"),
  },
  async ({ prompt, images, size, n, seed, guidance, outputName }) => {
    const files = images.slice(0, 4);
    for (const f of files) {
      if (!fs.existsSync(f)) throw new Error(`File not found: ${f}`);
    }

    const form = new FormData();
    form.append("model", "flux-2-klein");
    for (const f of files) {
      form.append("image[]", new Blob([fs.readFileSync(f)]), path.basename(f));
    }
    form.append("prompt", prompt);
    if (size) form.append("size", size);
    if (n) form.append("n", String(n));
    if (seed !== undefined) form.append("seed", String(seed));
    if (guidance !== undefined) form.append("guidance", String(guidance));

    const res = await nanRequest("/images/edits", {
      method: "POST",
      body: form,
    });
    const json = await res.json();

    const count = json.data?.length ?? 0;
    const base = outputName || safeName(prompt);
    const results = [];

    for (let i = 0; i < count; i++) {
      const item = json.data[i];
      let filePath;
      if (item.b64_json) {
        filePath = path.join(OUTPUT_DIR, `${base}${count > 1 ? `-${i + 1}` : ""}.png`);
        fs.writeFileSync(filePath, Buffer.from(item.b64_json, "base64"));
      } else {
        const imgRes = await fetch(item.url);
        const buf = Buffer.from(await imgRes.arrayBuffer());
        filePath = path.join(OUTPUT_DIR, `${base}${count > 1 ? `-${i + 1}` : ""}.png`);
        fs.writeFileSync(filePath, buf);
      }
      results.push({ path: filePath, url: item.url || null });
    }

    return {
      content: [
        {
          type: "text",
          text: results.map((r) => `Image saved to ${r.path}${r.url ? ` (source URL: ${r.url})` : ""}`).join("\n"),
        },
      ],
    };
  }
);

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
