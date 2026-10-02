import test from "node:test";
import assert from "node:assert/strict";
import api from "./index.js";

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
      return options?.type === "arrayBuffer" ? entry.bytes.buffer.slice(0) : entry.bytes;
    },
    async put(key, bytes, options) {
      values.set(key, { bytes, metadata: options.metadata });
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
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ known: [] }), { status: 200 }));
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
  const image = await api.fetch(request(`/photos/${item.id}/image`), env);
  assert.equal(image.headers.get("Content-Type"), "image/png");
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), PNG);

  const removed = await api.fetch(request(`/photos/${item.id}`, "DELETE", { password: PASSWORD }), env);
  assert.equal(removed.status, 200);
  const empty = await api.fetch(request("/gallery"), env);
  assert.deepEqual((await empty.json()).items, []);
});

test("rejects other origins, unauthenticated uploads, and disguised files", async () => {
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
