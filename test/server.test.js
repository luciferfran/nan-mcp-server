import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  API_KEY,
  BASE_URL,
  OUTPUT_DIR,
  TIMEOUT_MS,
  VOICES,
  VERSION,
  safeName,
  writeUnique,
  generateImage,
  textToSpeech,
  listVoices,
  listModels,
  embed,
  rerank,
} from "../server.js";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(handler) {
  globalThis.fetch = async (url, opts) => {
    return handler(url, opts);
  };
}

function jsonResponse(obj) {
  return {
    ok: true,
    status: 200,
    json: async () => obj,
    arrayBuffer: async () => Buffer.from(JSON.stringify(obj)),
  };
}

function restoreFetch() {
  globalThis.fetch = ORIGINAL_FETCH;
}

describe("configuration", () => {
  test("requires NAN_API_KEY", () => {
    assert.ok(API_KEY, "NAN_API_KEY should be set when the module is loaded");
  });

  test("has a valid default base URL", () => {
    assert.match(BASE_URL, /^https:\/\/api\.nan\.builders\/v1$/);
  });

  test("output directory defaults under home", () => {
    assert.ok(OUTPUT_DIR.endsWith("nan-mcp-output"));
  });

  test("version matches package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(VERSION, pkg.version);
  });

  test("has a positive request timeout", () => {
    assert.ok(Number.isFinite(TIMEOUT_MS) && TIMEOUT_MS > 0);
  });

  // The README pins an exact version in every install example; this keeps those
  // examples from drifting behind a version bump.
  test("README examples pin the current version", () => {
    const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const pinned = [...readme.matchAll(/nan-mcp-server@(\d+\.\d+\.\d+)/g)].map((m) => m[1]);

    assert.ok(pinned.length > 0, "README should pin the version in its examples");
    const stale = [...new Set(pinned)].filter((v) => v !== VERSION);
    assert.deepEqual(stale, [], `README pins ${stale.join(", ")} but package.json is ${VERSION}`);
  });
});

describe("VOICES", () => {
  test("contains Spanish voices", () => {
    assert.ok(Array.isArray(VOICES.Spanish));
    assert.ok(VOICES.Spanish.includes("ef_dora"));
    assert.ok(VOICES.Spanish.includes("em_alex"));
    assert.ok(VOICES.Spanish.includes("em_santa"));
  });

  test("contains American English voices", () => {
    assert.ok(VOICES["American English"].includes("af_heart"));
    assert.ok(VOICES["American English"].includes("af_bella"));
  });

  test("all voices are lowercase ids", () => {
    for (const voices of Object.values(VOICES)) {
      for (const v of voices) {
        assert.match(v, /^[a-z]{2}_[a-z]+$/, `${v} should look like "xx_name"`);
      }
    }
  });

  test("covers all supported languages", () => {
    const expected = ["American English", "British English", "Japanese", "Mandarin Chinese", "Spanish", "French", "Hindi", "Italian", "Brazilian Portuguese"];
    assert.deepEqual(Object.keys(VOICES), expected);
  });
});

describe("safeName", () => {
  test("lowercases and dashes", () => {
    assert.equal(safeName("Hola Mundo!"), "hola-mundo");
  });

  test("strips non alphanumeric", () => {
    assert.equal(safeName("A lighthouse at sunset, cinematic!"), "a-lighthouse-at-sunset-cinematic");
  });

  test("falls back to output when empty", () => {
    assert.equal(safeName("!!!  ###"), "output");
  });

  test("truncates to max length", () => {
    const long = "x".repeat(200);
    assert.ok(safeName(long).length <= 60);
  });

  test("sanitizes path traversal attempts", () => {
    assert.equal(safeName("../../etc/passwd"), "etc-passwd");
    assert.equal(safeName("../secret"), "secret");
  });
});

describe("handlers with mocked fetch", () => {
  beforeEach(() => {
    process.env.NAN_OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nan-mcp-test-"));
  });

  afterEach(() => {
    restoreFetch();
    fs.rmSync(process.env.NAN_OUTPUT_DIR, { recursive: true, force: true });
  });

  test("generateImage sends correct request body and saves b64 image", async () => {
    let capturedBody;
    mockFetch(async (url, opts) => {
      assert.equal(url, `${BASE_URL}/images/generations`);
      assert.match(opts.headers.Authorization, /^Bearer /);
      capturedBody = JSON.parse(opts.body);
      return jsonResponse({
        data: [{ b64_json: Buffer.from("fake-image-bytes").toString("base64") }],
      });
    });

    const outDir = process.env.NAN_OUTPUT_DIR;
    const result = await generateImage({ prompt: "A Test! Image", size: "512x512", n: 1 });

    assert.equal(capturedBody.model, "flux-2-klein");
    assert.equal(capturedBody.prompt, "A Test! Image");
    assert.equal(capturedBody.size, "512x512");

    const text = result.content[0].text;
    assert.match(text, new RegExp(outDir));
    assert.match(text, /\.png/);
    assert.ok(fs.existsSync(path.join(outDir, "a-test-image.png")));
  });

  test("generateImage sanitizes path traversal in outputName", async () => {
    mockFetch(async () => {
      return jsonResponse({
        data: [{ b64_json: Buffer.from("fake").toString("base64") }],
      });
    });

    const outDir = process.env.NAN_OUTPUT_DIR;
    const result = await generateImage({ prompt: "img", outputName: "../../etc/hostname" });

    const filePath = result.content[0].text.match(/saved to ([^\s]+)/)[1];
    assert.ok(path.resolve(filePath).startsWith(path.resolve(outDir)), "file should stay inside output dir");
    assert.ok(!filePath.includes(".."), "no path traversal in saved path");
  });

  test("textToSpeech sends correct body and saves audio", async () => {
    let capturedBody;
    mockFetch(async (url, opts) => {
      assert.equal(url, `${BASE_URL}/audio/speech`);
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from("audio-bytes") };
    });

    const outDir = process.env.NAN_OUTPUT_DIR;
    const result = await textToSpeech({ text: "Hola mundo", voice: "ef_dora", format: "mp3" });

    assert.equal(capturedBody.model, "kokoro");
    assert.equal(capturedBody.voice, "ef_dora");
    assert.match(result.content[0].text, /Audio saved to/);
    assert.ok(fs.existsSync(path.join(outDir, "hola-mundo.mp3")));
  });

  test("textToSpeech sanitizes path traversal in outputName", async () => {
    mockFetch(async () => {
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from("audio") };
    });

    const outDir = process.env.NAN_OUTPUT_DIR;
    const result = await textToSpeech({ text: "hola", outputName: "../../.ssh/authorized_keys" });

    const filePath = result.content[0].text.match(/saved to ([^\s]+)/)[1];
    assert.ok(path.resolve(filePath).startsWith(path.resolve(outDir)), "file should stay inside output dir");
    assert.ok(!filePath.includes(".."), "no path traversal in saved path");
  });

  test("listVoices returns grouped voices", async () => {
    const result = await listVoices();
    assert.match(result.content[0].text, /Spanish: ef_dora, em_alex, em_santa/);
  });

  test("listModels returns model ids", async () => {
    mockFetch(async () => {
      return jsonResponse({
        data: [
          { id: "deepseek-v4-flash", owned_by: "openai" },
          { id: "flux-2-klein", owned_by: "nan" },
        ],
      });
    });

    const result = await listModels();
    assert.match(result.content[0].text, /deepseek-v4-flash \(openai\)/);
    assert.match(result.content[0].text, /flux-2-klein \(nan\)/);
  });

  test("embed returns summary without dumping vectors", async () => {
    mockFetch(async () => {
      return jsonResponse({
        data: [{ embedding: new Array(4096).fill(0.1) }],
        usage: { prompt_tokens: 5 },
      });
    });

    const result = await embed({ input: "hello" });
    assert.match(result.content[0].text, /4096 dimensions/);
    assert.ok(result.content[0].text.length < 500, "should not dump 4096 floats");
  });

  test("rerank returns ordered relevance scores", async () => {
    mockFetch(async () => {
      return jsonResponse({
        results: [
          { index: 2, relevance_score: 0.9, document: { text: "Paris" } },
          { index: 0, relevance_score: 0.5, document: { text: "Berlin" } },
        ],
      });
    });

    const result = await rerank({
      query: "capital of France",
      documents: ["Berlin", "London", "Paris"],
    });
    const text = result.content[0].text;
    assert.match(text, /\[0\.9000\] \(orig index 2\) Paris/);
    assert.match(text, /\[0\.5000\] \(orig index 0\) Berlin/);
  });

  test("nanRequest throws on non-2xx response", async () => {
    mockFetch(async () => {
      return { ok: false, status: 429, text: async () => "rate limited" };
    });

    await assert.rejects(() => listModels(), /NaN API 429: rate limited/);
  });

  test("nanRequest passes an abort signal and reports timeouts", async () => {
    let sawSignal = false;
    mockFetch(async (url, opts) => {
      sawSignal = opts.signal instanceof AbortSignal;
      throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    });

    await assert.rejects(() => listModels(), /timed out after \d+ms/);
    assert.ok(sawSignal, "fetch should receive an AbortSignal");
  });

  test("generateImage never overwrites an existing file", async () => {
    let call = 0;
    mockFetch(async () =>
      jsonResponse({ data: [{ b64_json: Buffer.from(`img-${++call}`).toString("base64") }] })
    );

    const outDir = process.env.NAN_OUTPUT_DIR;
    const first = await generateImage({ prompt: "un faro al atardecer" });
    const second = await generateImage({ prompt: "un faro al atardecer" });

    const p1 = first.content[0].text.match(/saved to (\S+)/)[1];
    const p2 = second.content[0].text.match(/saved to (\S+)/)[1];

    assert.notEqual(p1, p2, "second call must not reuse the first path");
    assert.equal(fs.readFileSync(p1, "utf8"), "img-1", "first file must survive");
    assert.equal(fs.readFileSync(p2, "utf8"), "img-2");
    assert.deepEqual(fs.readdirSync(outDir).sort(), ["un-faro-al-atardecer-2.png", "un-faro-al-atardecer.png"]);
  });

  test("textToSpeech never overwrites an existing file", async () => {
    let call = 0;
    mockFetch(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from(`audio-${++call}`),
    }));

    const outDir = process.env.NAN_OUTPUT_DIR;
    await textToSpeech({ text: "hola" });
    await textToSpeech({ text: "hola" });

    assert.deepEqual(fs.readdirSync(outDir).sort(), ["hola-2.mp3", "hola.mp3"]);
    assert.equal(fs.readFileSync(path.join(outDir, "hola.mp3"), "utf8"), "audio-1");
  });

  test("generateImage numbers multiple images and keeps them unique across calls", async () => {
    mockFetch(async () =>
      jsonResponse({
        data: [
          { b64_json: Buffer.from("a").toString("base64") },
          { b64_json: Buffer.from("b").toString("base64") },
        ],
      })
    );

    const outDir = process.env.NAN_OUTPUT_DIR;
    await generateImage({ prompt: "gatos", n: 2 });
    await generateImage({ prompt: "gatos", n: 2 });

    const files = fs.readdirSync(outDir);
    assert.equal(files.length, 4, `expected 4 distinct files, got ${files.join(", ")}`);
  });

  test("writeUnique keeps writes inside the output dir", () => {
    const outDir = process.env.NAN_OUTPUT_DIR;
    const p = writeUnique("../../etc/hostname", ".png", "", Buffer.from("x"));
    assert.ok(path.resolve(p).startsWith(path.resolve(outDir)));
    assert.ok(!p.includes(".."));
  });

  test("writeUnique creates the output dir if it is missing", () => {
    const nested = path.join(process.env.NAN_OUTPUT_DIR, "nested", "deeper");
    process.env.NAN_OUTPUT_DIR = nested;
    try {
      const p = writeUnique("hello", ".txt", "", Buffer.from("hi"));
      assert.equal(fs.readFileSync(p, "utf8"), "hi");
    } finally {
      process.env.NAN_OUTPUT_DIR = path.dirname(path.dirname(nested));
    }
  });
});
