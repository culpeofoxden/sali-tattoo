import test from "node:test";
import assert from "node:assert/strict";
import api from "./index.js";
import baseCatalog from "../portfolio-catalog.json" with { type: "json" };

const ORIGIN = "https://sali.tattoo";
const PASSWORD = "an-example-password-for-tests";
const PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+tmx8AAAAASUVORK5CYII=",
  "base64",
));

function environment() {
  const values = new Map();
  const gallery = {
    async list() {
      return {
        keys: [...values.entries()].map(([name, entry]) => ({ name, metadata: entry.metadata })),
        list_complete: true,
      };
    },
    async get(key, options) {
      const entry = values.get(key);
      if (!entry) return null;
      if (options?.type === "json") return JSON.parse(entry.text);
      return options?.type === "arrayBuffer" ? entry.bytes.buffer.slice(0) : entry.bytes;
    },
    async put(key, bytes, options) {
      if (typeof bytes === "string") values.set(key, { text: bytes });
      else {
        assert.ok(bytes instanceof ArrayBuffer);
        values.set(key, { bytes: new Uint8Array(bytes), metadata: options?.metadata });
      }
    },
    async delete(key) { values.delete(key); },
  };
  return {
    ADMIN_PASSWORD: PASSWORD,
    GALLERY: gallery,
    LOGIN_LIMIT: { async limit() { return { success: true }; } },
    UPLOAD_LIMIT: { async limit() { return { success: true }; } },
  };
}

function request(path, method = "GET", { body, password, origin = ORIGIN } = {}) {
  return new Request(`https://sali-photo-api.example.workers.dev${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(password ? { "X-Admin-Password": password } : {}),
    },
    body,
  });
}

test("password access, upload, duplicate rejection, and deletion", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    new Response(JSON.stringify(String(url).endsWith("portfolio-catalog.json") ? baseCatalog : { known: [] }), { status: 200 }));
  const env = environment();
  const wrong = await api.fetch(request("/login", "POST", {
    body: JSON.stringify({ password: "wrong" }),
  }), env);
  assert.equal(wrong.status, 401);
  const signedIn = await api.fetch(request("/login", "POST", {
    body: JSON.stringify({ password: PASSWORD }),
  }), env);
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.headers.get("Access-Control-Allow-Origin"), ORIGIN);

  const form = new FormData();
  form.set("photo", new File([PNG], "new.png", { type: "image/png" }));
  form.set("kind", "design");
  form.set("category", "plants");
  form.set("title", "Tiny flower");
  form.set("alt", "A tiny flower drawing");
  const upload = () => api.fetch(request("/photos", "POST", { body: form, password: PASSWORD }), env);
  const created = await upload();
  assert.equal(created.status, 201);
  const { item } = await created.json();
  assert.match(item.path, /\/photos\/[a-f0-9-]{36}\/image$/);

  const duplicate = await upload();
  assert.equal(duplicate.status, 409);
  const gallery = await api.fetch(request("/gallery"), env);
  assert.equal((await gallery.json()).items.length, 1);
  const full = await api.fetch(request("/admin/catalog", "GET", { password: PASSWORD }), env);
  assert.equal((await full.json()).items.length, 40);
  const image = await api.fetch(request(`/photos/${item.id}/image`), env);
  assert.equal(image.headers.get("Content-Type"), "image/png");
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), PNG);

  const removed = await api.fetch(request(`/photos/${item.id}`, "DELETE", { password: PASSWORD }), env);
  assert.equal(removed.status, 200);
  const empty = await api.fetch(request("/gallery"), env);
  assert.deepEqual((await empty.json()).items, []);
  const restored = await api.fetch(request(`/photos/${item.id}/restore`, "POST", { password: PASSWORD }), env);
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).item.status, "active");
});

test("rejects other origins, unauthenticated uploads, and disguised files", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    new Response(JSON.stringify(String(url).endsWith("portfolio-catalog.json") ? baseCatalog : { known: [] }), { status: 200 }));
  const env = environment();
  const foreign = await api.fetch(request("/login", "POST", {
    origin: "https://another.example",
    body: JSON.stringify({ password: PASSWORD }),
  }), env);
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get("Access-Control-Allow-Origin"), null);
  const form = new FormData();
  form.set("photo", new File([PNG], "fake.jpg", { type: "image/jpeg" }));
  form.set("kind", "tattoo");
  form.set("category", "creatures");
  form.set("title", "A photo");
  form.set("alt", "A tattoo photo");
  assert.equal((await api.fetch(request("/photos", "POST", { body: form }), env)).status, 401);
  assert.equal((await api.fetch(request("/photos", "POST", { body: form, password: PASSWORD }), env)).status, 400);
});

test("replaces original slots, edits categories, and clears collections", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    new Response(JSON.stringify(String(url).endsWith("portfolio-catalog.json") ? baseCatalog : { known: [] }), { status: 200 }));
  const env = environment();
  const original = await api.fetch(request("/catalog"), env);
  assert.equal((await original.json()).items.length, 39);
  const form = new FormData();
  form.set("photo", new File([PNG], "replacement.png", { type: "image/png" }));
  form.set("replaceId", "hero-main");
  form.set("title", "New first image");
  form.set("alt", "New hero image");
  const replaced = await api.fetch(request("/photos", "POST", { body: form, password: PASSWORD }), env);
  assert.equal(replaced.status, 200);
  assert.equal((await replaced.json()).item.id, "hero-main");
  const second = await api.fetch(request("/catalog"), env);
  assert.equal((await second.json()).items.length, 39);
  const edited = await api.fetch(request("/photos/tattoo-gallery-09", "PATCH", {
    body: JSON.stringify({ title: "Dragon", alt: "Dragon tattoo", category: "botanical" }), password: PASSWORD,
  }), env);
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).item.category, "botanical");
  const cleared = await api.fetch(request("/categories/design/animals/clear", "POST", { password: PASSWORD }), env);
  assert.equal(cleared.status, 200);
  assert.ok((await cleared.json()).changed > 0);
  const after = await api.fetch(request("/catalog"), env);
  assert.equal((await after.json()).items.some((item) => item.kind === "design" && item.category === "animals"), false);
});
