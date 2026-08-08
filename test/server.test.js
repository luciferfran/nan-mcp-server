import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { API_KEY, BASE_URL, OUTPUT_DIR, VOICES, safeName } from "../server.js";

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
});
