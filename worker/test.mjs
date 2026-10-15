import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import api, { CatalogStore } from "./index.js";
import baseCatalog from "../portfolio-catalog.json" with { type: "json" };

const ORIGIN = "https://sali.tattoo";
const PASSWORD = "an-example-password-for-tests";
const PNG = new Uint8Array(readFileSync(new URL("../images/review-01.png", import.meta.url)));
const JPEG = new Uint8Array(readFileSync(new URL("../images/gallery-01.jpg", import.meta.url)));

function photoForm({ bytes = PNG, type = "image/png", kind = "design", category = "animals", replaceId, alt = "A small tattoo design" } = {}) {
  const form = new FormData();
  form.set("photo", new File([bytes], "artwork", { type }));
  form.set("title", "New artwork");
  form.set("alt", alt);
  if (replaceId) form.set("replaceId", replaceId);
  else { form.set("kind", kind); form.set("category", category); }
  return form;
}

function environment() {
  const values = new Map();
  const catalogValues = new Map();
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
  const env = {
    ADMIN_PASSWORD: PASSWORD,
    GALLERY: gallery,
    IMAGES: {
      async info() { return { width: 1, height: 1, format: "png" }; },
      input() { return { transform() { return { async output() { return {
        response() { return new Response(PNG, { status: 200, headers: { "Content-Type": "image/png" } }); },
      }; } }; } }; },
    },
    LOGIN_LIMIT: { async limit() { return { success: true }; } },
    UPLOAD_LIMIT: { async limit() { return { success: true }; } },
  };
  const object = new CatalogStore({ storage: {
    async get(key) { return structuredClone(catalogValues.get(key)); },
    async put(key, value) { catalogValues.set(key, structuredClone(value)); },
  } }, env);
  env.CATALOG = { getByName() { return object; } };
  env._values = values;
  env._catalogValues = catalogValues;
  env._storage = object.ctx.storage;
  return env;
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

test("finished tattoo uploads work in every category and invalid attempts do not use the upload limit", async () => {
  const env = environment();
  let counted = 0;
  env.UPLOAD_LIMIT = { async limit() { counted++; return { success: true }; } };
  for (const category of ["botanical", "creatures", "concepts"]) {
    const response = await api.fetch(request("/photos", "POST", {
      body: photoForm({ kind: "tattoo", category }), password: PASSWORD,
    }), env);
    assert.equal(response.status, 201, `${category} should accept a new photo`);
    assert.equal((await response.json()).item.category, category);
  }
  assert.equal(counted, 3);
  const duplicate = await api.fetch(request("/photos", "POST", {
    body: photoForm({ kind: "tattoo", category: "concepts" }), password: PASSWORD,
  }), env);
  assert.equal(duplicate.status, 409);
  const invalid = await api.fetch(request("/photos", "POST", {
    body: photoForm({ bytes: PNG.slice(0, 8), kind: "tattoo", category: "concepts" }), password: PASSWORD,
  }), env);
  assert.equal(invalid.status, 400);
  assert.equal(counted, 3);
  const publicCatalog = await api.fetch(request("/catalog"), env);
  const tattoo = (await publicCatalog.json()).items.filter((item) => item.kind === "tattoo" && item.sha256);
  assert.deepEqual(tattoo.map((item) => item.category), ["botanical", "creatures", "concepts"]);
});

test("restoring and moving cannot create duplicates, but reuse in another collection works", async () => {
  const env = environment();
  const upload = (category) => api.fetch(request("/photos", "POST", {
    body: photoForm({ category }), password: PASSWORD,
  }), env);
  const first = (await (await upload("animals")).json()).item;
  await api.fetch(request(`/photos/${first.id}`, "DELETE", { password: PASSWORD }), env);
  const second = (await (await upload("animals")).json()).item;
  assert.equal((await api.fetch(request(`/photos/${first.id}/restore`, "POST", { password: PASSWORD }), env)).status, 409);
  assert.equal((await upload("plants")).status, 201);
  const plants = (await (await api.fetch(request("/catalog"), env)).json()).items
    .find((item) => item.kind === "design" && item.category === "plants" && item.sha256);
  assert.equal((await api.fetch(request(`/photos/${plants.id}`, "PATCH", {
    body: JSON.stringify({ title: "Moved", alt: "The same small tattoo design", category: "animals" }),
    password: PASSWORD,
  }), env)).status, 409);
  assert.equal((await api.fetch(request(`/photos/${second.id}`, "DELETE", { password: PASSWORD }), env)).status, 200);
  assert.equal((await api.fetch(request("/categories/design/animals/restore", "POST", { password: PASSWORD }), env)).status, 409);
  assert.equal((await upload("other")).status, 201);
});

test("rejects truncated images and unreadable images", async () => {
  const env = environment();
  const truncated = photoForm({ bytes: PNG.slice(0, 8) });
  assert.equal((await api.fetch(request("/photos", "POST", { body: truncated, password: PASSWORD }), env)).status, 400);
  env.IMAGES.info = async () => { throw new Error("Cannot decode"); };
  const unreadable = await api.fetch(request("/photos", "POST", {
    body: photoForm(), password: PASSWORD,
  }), env);
  assert.equal(unreadable.status, 400);
  assert.equal(env._values.size, 0);
});

test("new photos append after the last position, and replacements discard old blobs", async () => {
  const env = environment();
  const originalMax = Math.max(...baseCatalog.items
    .filter((item) => item.kind === "tattoo" && item.category === "botanical")
    .map((item) => item.position));
  const created = await api.fetch(request("/photos", "POST", {
    body: photoForm({ kind: "tattoo", category: "botanical" }), password: PASSWORD,
  }), env);
  assert.equal(created.status, 201);
  const first = (await created.json()).item;
  assert.equal(first.position, originalMax + 1);
  const oldBlob = first.path.split("/").at(-2);
  const replaced = await api.fetch(request("/photos", "POST", {
    body: photoForm({ bytes: JPEG, type: "image/jpeg", replaceId: first.id }), password: PASSWORD,
  }), env);
  assert.equal(replaced.status, 200);
  assert.equal(env._values.has(`photo:${oldBlob}`), false);
  assert.equal(env._values.size, 1);
});

test("simultaneous edits are serialized and a failed catalog save cleans the new blob", async () => {
  const env = environment();
  const upload = () => api.fetch(request("/photos", "POST", {
    body: photoForm(), password: PASSWORD,
  }), env);
  const results = await Promise.all([upload(), upload()]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const active = (await (await api.fetch(request("/catalog"), env)).json()).items
    .filter((item) => item.sha256);
  assert.equal(active.length, 1);
  const originalPut = env._storage.put;
  env._storage.put = async () => { throw new Error("Storage failed"); };
  const failed = await api.fetch(request("/photos", "POST", {
    body: photoForm({ bytes: JPEG, type: "image/jpeg", category: "plants" }),
    password: PASSWORD,
  }), env);
  assert.equal(failed.status, 500);
  assert.equal(env._values.size, 1);
  env._storage.put = originalPut;
});

test("migration preserves the live KV catalog and repairs placeholder descriptions", async () => {
  const env = environment();
  const live = structuredClone(baseCatalog);
  live.items.push({ id: "43e146cb-2749-44ae-8c61-e7506a5c3779", kind: "design", category: "animals",
    title: "Cats", alt: "...", path: "https://sali-photo-api.example.workers.dev/photos/43e146cb-2749-44ae-8c61-e7506a5c3779/image",
    status: "active", position: 4 });
  env._values.set("catalog:v2", { text: JSON.stringify(live) });
  const response = await api.fetch(request("/catalog"), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).items.find((item) => item.title === "Cats").alt,
    "Black and white sketches of winged kittens in different poses");
  assert.equal(env._catalogValues.get("catalog:v2").items.length, live.items.length);
  const wave = { id: "de0d8793-af9e-43c5-90df-eadd08883b65", kind: "tattoo", category: "concepts",
    title: "wave", alt: "...", path: "https://sali-photo-api.example.workers.dev/photos/de0d8793-af9e-43c5-90df-eadd08883b65/image",
    status: "active", position: 20 };
  env._catalogValues.get("catalog:v2").items.push(wave);
  const repaired = await api.fetch(request("/catalog"), env);
  assert.equal((await repaired.json()).items.find((item) => item.id === wave.id).alt,
    "Fine line ocean wave and mountain tattoo on an arm");
});

test("removed images can be uploaded again and active images can be used in other collections", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    new Response(JSON.stringify(String(url).endsWith("portfolio-catalog.json") ? baseCatalog : { known: [] }), { status: 200 }));
  const env = environment();
  const upload = (kind, category) => {
    const form = new FormData();
    form.set("photo", new File([PNG], "same.png", { type: "image/png" }));
    form.set("kind", kind);
    form.set("category", category);
    form.set("title", "Same image");
    form.set("alt", "A small drawing");
    return api.fetch(request("/photos", "POST", { body: form, password: PASSWORD }), env);
  };

  const animals = await upload("design", "animals");
  assert.equal(animals.status, 201);
  const { item: first } = await animals.json();
  assert.equal((await upload("design", "animals")).status, 409);
  assert.equal((await api.fetch(request(`/photos/${first.id}`, "DELETE", { password: PASSWORD }), env)).status, 200);

  assert.equal((await upload("design", "plants")).status, 201);
  assert.equal((await upload("tattoo", "botanical")).status, 201);
  const again = await upload("design", "animals");
  assert.equal(again.status, 201);
  assert.notEqual((await again.json()).item.id, first.id);
  assert.equal((await upload("design", "plants")).status, 409);
  const publicCatalog = await api.fetch(request("/catalog"), env);
  const active = (await publicCatalog.json()).items;
  assert.equal(active.filter((item) => item.sha256).length, 3);
});

test("original artwork blocks only its active destination collection", async (t) => {
  const hash = createHash("sha256").update(PNG).digest("hex");
  const original = baseCatalog.items[0];
  const env = environment();
  const seeded = structuredClone(baseCatalog);
  seeded.items[0].sha256 = hash;
  env._catalogValues.set("catalog:v2", seeded);
  const upload = (category) => {
    const form = new FormData();
    form.set("photo", new File([PNG], "original.png", { type: "image/png" }));
    form.set("kind", "tattoo");
    form.set("category", category);
    form.set("title", "Reused artwork");
    form.set("alt", "An existing design reused in a gallery");
    return api.fetch(request("/photos", "POST", { body: form, password: PASSWORD }), env);
  };

  assert.equal((await upload(original.category)).status, 409);
  assert.equal((await upload("creatures")).status, 201);
  assert.equal((await api.fetch(request(`/photos/${original.id}`, "DELETE", { password: PASSWORD }), env)).status, 200);
  assert.equal((await upload(original.category)).status, 201);
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

test("limits password attempts without blocking signed-in photo edits", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    new Response(JSON.stringify(String(url).endsWith("portfolio-catalog.json") ? baseCatalog : { known: [] }), { status: 200 }));
  const env = environment();
  let attempts = 0;
  env.LOGIN_LIMIT = { async limit() { return { success: ++attempts <= 2 }; } };
  const login = await api.fetch(request("/login", "POST", {
    body: JSON.stringify({ password: PASSWORD }),
  }), env);
  assert.equal(login.status, 200);
  for (let i = 0; i < 3; i += 1) {
    const edited = await api.fetch(request("/photos/tattoo-gallery-09", "PATCH", {
      body: JSON.stringify({ title: `Dragon ${i}`, alt: "Dragon tattoo", category: "creatures" }),
      password: PASSWORD,
    }), env);
    assert.equal(edited.status, 200);
  }
  assert.equal(attempts, 1);
  assert.equal((await api.fetch(request("/admin/catalog", "GET", { password: "wrong" }), env)).status, 401);
  assert.equal((await api.fetch(request("/admin/catalog", "GET", { password: "wrong" }), env)).status, 429);
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
  const activeItems = (await after.json()).items;
  assert.equal(activeItems.some((item) => item.kind === "design" && item.category === "animals"), false);
  assert.ok(activeItems.some((item) => item.id === "design-cover-animals"));
  assert.ok(activeItems.some((item) => item.id === "design-hero-animals"));
});
