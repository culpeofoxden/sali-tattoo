import baseCatalog from "../portfolio-catalog.json" with { type: "json" };
import originalUploads from "../portfolio-uploads.json" with { type: "json" };

const SITE_ORIGIN = "https://sali.tattoo";
const CATALOG_KEY = "catalog:v2";
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_BYTES + 32 * 1024;
const CATEGORIES = {
  tattoo: new Set(["botanical", "creatures", "concepts"]),
  design: new Set(["animals", "plants", "other"]),
};
const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const ORIGINAL_HASH_BY_PATH = new Map(originalUploads.known.map(({ path, sha256 }) => [path, sha256]));
const LEGACY_ALT_CORRECTIONS = {
  "43e146cb-2749-44ae-8c61-e7506a5c3779": "Black and white sketches of winged kittens in different poses",
  "b6cc2536-6120-4322-898c-9ac5eed2dcbd": "Flowing fine line flower tattoo across an upper back",
  "16de5363-1a31-4ff7-a981-af680c17c9d8": "Pink orchid tattoo with delicate black linework on an upper arm",
  "885d73ef-8885-4215-955f-1e9ca115abc3": "Small fine line seahorse tattoo with bubbles on an arm",
  "8d4eec6b-2ca0-4236-be40-2263bb143903": "Continuous line tattoo of two faces on an arm",
  "adcc1216-4d66-465d-9b2a-dc1ba22ff6d0": "Butterfly and ornamental linework tattoo on an upper arm",
  "cdb543c8-5eae-4fb9-a62b-a7af003fe90b": "Cat and meditating frog tattoo design studies with colourful flowing lines",
  "d1a38919-7bdd-4023-a0da-14fbfe24dd5a": "Fine line animal tattoo on a woman's upper arm",
  "de0d8793-af9e-43c5-90df-eadd08883b65": "Fine line ocean wave and mountain tattoo on an arm",
};

function repairLegacyDescriptions(catalog) {
  let changed = false;
  const items = catalog.items.map((item) => {
    if (item.alt !== "..." || !LEGACY_ALT_CORRECTIONS[item.id]) return item;
    changed = true;
    return { ...item, alt: LEGACY_ALT_CORRECTIONS[item.id] };
  });
  return changed ? { ...catalog, items } : catalog;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}
function error(message, status) { return json({ error: message }, status); }

function cors(request, response) {
  if (request.headers.get("Origin") !== SITE_ORIGIN) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", SITE_ORIGIN);
  headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Password");
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

async function matchesPassword(candidate, actual) {
  if (!actual || actual.length < 16 || typeof candidate !== "string") return false;
  const [left, right] = await Promise.all(
    [candidate, actual].map((value) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  );
  const a = new Uint8Array(left), b = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

export function imageType(bytes) {
  if (bytes.length >= 32 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
      bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
    let offset = 2;
    let dimensions = false;
    let scan = false;
    while (offset + 4 <= bytes.length - 2) {
      if (bytes[offset] !== 0xff) return null;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9) break;
      if (marker === 0xda) { scan = dimensions && offset + 2 < bytes.length - 2; break; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return null;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length - 2) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 7) return null;
        const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
        const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
        dimensions = validDimensions(width, height);
      }
      offset += length;
    }
    if (scan) return "image/jpeg";
  }
  if (bytes.length >= 45 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8, header = false, data = false, end = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      if (length > bytes.length - offset - 12) return null;
      const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (type === "IHDR") {
        if (offset !== 8 || length !== 13 || !validDimensions(view.getUint32(offset + 8), view.getUint32(offset + 12))) return null;
        header = true;
      }
      if (type === "IDAT") data = data || length > 0;
      offset += length + 12;
      if (type === "IEND") { end = length === 0 && offset === bytes.length; break; }
    }
    if (header && data && end) return "image/png";
  }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(4, true) !== bytes.length - 8) return null;
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    const size = view.getUint32(16, true);
    if (size < 10 || size + 20 > bytes.length) return null;
    if (chunk === "VP8X" && size >= 10) {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      if (validDimensions(width, height)) return "image/webp";
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) return "image/webp";
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return "image/webp";
  }
  return null;
}

function validDimensions(width, height) {
  return width > 0 && height > 0 && width <= 16000 && height <= 16000 && width * height <= 100_000_000;
}

function validDescription(value) {
  return typeof value === "string" && value.trim().length >= 8 && value.length <= 180 && /[\p{L}]{3,}/u.test(value);
}

async function allItems(store, origin) {
  const items = [];
  let cursor;
  do {
    const page = await store.list({ prefix: "photo:", limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const entry of page.keys) {
      const item = entry.metadata;
      if (item?.id === entry.name.slice("photo:".length) && item.kind && item.category)
        items.push({ ...item, path: `${origin}/photos/${item.id}/image` });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && items.length < 10000);
  items.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  return items;
}

async function rateLimit(binding, key) {
  if (!binding) return false;
  const result = await binding.limit({ key });
  return result.success;
}

function itemHash(item) { return item.sha256 || ORIGINAL_HASH_BY_PATH.get(item.path); }

function duplicateInDestination(catalog, sha256, kind, category, replaceId) {
  if (!sha256) return false;
  return catalog.items.some((item) => item.status === "active" && item.id !== replaceId &&
    item.kind === kind && item.category === category &&
    itemHash(item) === sha256);
}

async function readCatalog(env, origin) {
  const stored = env.CATALOG_STORAGE && await env.CATALOG_STORAGE.get(CATALOG_KEY);
  if (stored?.version === 2 && Array.isArray(stored.items)) {
    const catalog = repairLegacyDescriptions(stored);
    if (catalog !== stored) await env.CATALOG_STORAGE.put(CATALOG_KEY, catalog);
    return catalog;
  }
  const saved = await env.GALLERY.get(CATALOG_KEY, { type: "json" });
  if (saved?.version === 2 && Array.isArray(saved.items)) {
    const catalog = repairLegacyDescriptions(saved);
    if (env.CATALOG_STORAGE) await env.CATALOG_STORAGE.put(CATALOG_KEY, catalog);
    return catalog;
  }
  const base = baseCatalog;
  if (base.version !== 2 || !Array.isArray(base.items)) throw new Error("Invalid portfolio catalog.");
  const legacy = await allItems(env.GALLERY, origin);
  const knownIds = new Set(base.items.map((item) => item.id));
  const items = [...base.items];
  for (const item of legacy) {
    if (knownIds.has(item.id)) continue;
    items.push({
      ...item,
      status: "active",
      position: items.filter((entry) => entry.kind === item.kind && entry.category === item.category).length,
    });
  }
  const catalog = { version: 2, items };
  if (env.CATALOG_STORAGE) await env.CATALOG_STORAGE.put(CATALOG_KEY, catalog);
  return catalog;
}

async function saveCatalog(env, catalog) {
  if (env.CATALOG_STORAGE) await env.CATALOG_STORAGE.put(CATALOG_KEY, catalog);
  else await env.GALLERY.put(CATALOG_KEY, JSON.stringify(catalog));
}

function publicItems(catalog) {
  return catalog.items.filter((item) => item.status === "active");
}

function validCategory(kind, category) {
  return CATEGORIES[kind]?.has(category) === true;
}

function catalogItem(catalog, id) {
  return catalog.items.find((item) => item.id === id);
}

function nextPosition(catalog, kind, category, excludeId) {
  return 1 + Math.max(-1, ...catalog.items
    .filter((item) => item.id !== excludeId && item.kind === kind && item.category === category)
    .map((item) => Number.isInteger(item.position) ? item.position : -1));
}

function blobId(path, origin) {
  const match = new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/photos/([a-f0-9-]{36})/image$`).exec(path || "");
  return match?.[1];
}

async function deleteUnreferencedBlob(env, catalog, path, origin) {
  const id = blobId(path, origin);
  if (id && !catalog.items.some((item) => item.path === path)) {
    try { await env.GALLERY.delete(`photo:${id}`); }
    catch (cause) { console.error("Could not remove old image blob", cause); }
  }
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (!env.GALLERY) return error("Photo storage is unavailable.", 503);

  if (method === "OPTIONS") {
    if (request.headers.get("Origin") !== SITE_ORIGIN) return error("Origin is not allowed.", 403);
    return new Response(null, { status: 204 });
  }
  if (env.CATALOG && !env.CATALOG_STORAGE &&
      (path === "/gallery" || path === "/catalog" || path === "/admin/catalog" ||
       path === "/photos" || /^\/photos\/[a-z0-9-]+(?:\/restore)?$/.test(path) ||
       /^\/categories\//.test(path))) {
    return env.CATALOG.getByName("primary").fetch(request);
  }
  if (method === "GET" && path === "/gallery") {
    const catalog = await readCatalog(env, url.origin);
    return json({ items: publicItems(catalog).filter((item) =>
      item.kind !== "slot" && item.path?.startsWith(`${url.origin}/photos/`)) });
  }
  if (method === "GET" && path === "/catalog") {
    return json({ items: publicItems(await readCatalog(env, url.origin)) });
  }
  const imageMatch = /^\/photos\/([a-f0-9-]{36})\/image$/.exec(path);
  if ((method === "GET" || method === "HEAD") && imageMatch) {
    const item = await env.GALLERY.get(`photo:${imageMatch[1]}`, { type: "arrayBuffer" });
    if (!item) return error("Photograph not found.", 404);
    const type = imageType(new Uint8Array(item));
    if (!type) return error("Photograph is unavailable.", 500);
    return new Response(method === "HEAD" ? null : item, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) return error("Not found.", 404);
  if (request.headers.get("Origin") !== SITE_ORIGIN) return error("Origin is not allowed.", 403);
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 16) return error("Admin access is not configured.", 503);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (method === "POST" && path === "/login") {
    if (!(await rateLimit(env.LOGIN_LIMIT, `login:${ip}`)))
      return error("Too many attempts. Try again in a minute.", 429);
    if (Number(request.headers.get("Content-Length")) > 1024) return error("Request is too large.", 413);
    let submitted;
    try { submitted = await request.json(); } catch { return error("Invalid request.", 400); }
    if (!(await matchesPassword(submitted.password, env.ADMIN_PASSWORD)))
      return error("Incorrect password.", 401);
    return json({ ok: true });
  }
  if (!(await matchesPassword(request.headers.get("X-Admin-Password"), env.ADMIN_PASSWORD))) {
    if (!(await rateLimit(env.LOGIN_LIMIT, `login:${ip}`)))
      return error("Too many attempts. Try again in a minute.", 429);
    return error("Incorrect password.", 401);
  }

  if (method === "GET" && path === "/admin/catalog") {
    return json(await readCatalog(env, url.origin));
  }

  if (method === "POST" && path === "/photos") {
    if (!(await rateLimit(env.UPLOAD_LIMIT, `upload:${ip}`)))
      return error("Please wait before adding another photograph.", 429);
    if (Number(request.headers.get("Content-Length")) > MAX_REQUEST_BYTES)
      return error("This file is over 8 MB.", 413);
    let form;
    try { form = await request.formData(); } catch { return error("Invalid upload.", 400); }
    const file = form.get("photo");
    const kind = form.get("kind");
    const category = form.get("category");
    const replaceId = form.get("replaceId");
    const title = form.get("title");
    const alt = form.get("alt");
    if (!(file instanceof File) || !file.size || file.size > MAX_BYTES)
      return error("Choose a JPEG, PNG or WebP image up to 8 MB.", 400);
    const catalog = await readCatalog(env, url.origin);
    const replacing = replaceId ? catalogItem(catalog, replaceId) : null;
    if (replaceId && !replacing) return error("Photograph not found.", 404);
    if (!replacing && !validCategory(kind, category)) return error("Choose a valid collection.", 400);
    if (typeof title !== "string" || !title.trim() || title.length > 80 || !validDescription(alt))
      return error("Add a short title and image description.", 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = imageType(bytes);
    if (!type || type !== file.type || !MIME_EXTENSIONS[type])
      return error("The file is not a valid JPEG, PNG or WebP image.", 400);
    try {
      const info = await env.IMAGES.info(new Blob([bytes], { type }).stream());
      if (!validDimensions(info.width, info.height))
        return error("The image dimensions are unsupported.", 400);
      const decoded = (await env.IMAGES.input(new Blob([bytes], { type }).stream())
        .transform({ width: 1 }).output({ format: "image/png" })).response();
      if (!decoded.ok) return error("The image could not be decoded. Export it again and retry.", 400);
      await decoded.arrayBuffer();
    } catch (cause) {
      console.error("Image decoding failed", cause);
      return error("The image could not be decoded. Export it again and retry.", 400);
    }
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const destinationKind = replacing ? replacing.kind : kind;
    const destinationCategory = replacing ? replacing.category : category;
    if (duplicateInDestination(catalog, sha256, destinationKind, destinationCategory, replaceId))
      return error("This image is already in this collection.", 409);
    const imageId = crypto.randomUUID();
    const imagePath = `${url.origin}/photos/${imageId}/image`;
    const item = replacing ? {
      ...replacing, title: title.trim(), alt: alt.trim(), sha256, type,
      path: imagePath, status: "active", removedAt: null,
    } : {
      id: imageId, kind, category, title: title.trim(), alt: alt.trim(), sha256,
      type, path: imagePath, addedAt: new Date().toISOString(), status: "active",
      position: nextPosition(catalog, kind, category),
    };
    await env.GALLERY.put(`photo:${imageId}`, bytes.buffer, { metadata: item });
    const oldPath = replacing?.path;
    if (replacing) catalog.items[catalog.items.indexOf(replacing)] = item;
    else catalog.items.push(item);
    try { await saveCatalog(env, catalog); }
    catch (cause) {
      try { await env.GALLERY.delete(`photo:${imageId}`); }
      catch (cleanupCause) { console.error("Could not remove failed upload", cleanupCause); }
      throw cause;
    }
    if (oldPath) await deleteUnreferencedBlob(env, catalog, oldPath, url.origin);
    return json({ item }, replacing ? 200 : 201);
  }
  const restoreMatch = /^\/photos\/([a-z0-9-]+)\/restore$/.exec(path);
  if (method === "POST" && restoreMatch) {
    const catalog = await readCatalog(env, url.origin);
    const item = catalogItem(catalog, restoreMatch[1]);
    if (!item) return error("Photograph not found.", 404);
    if (item.status === "removed" && duplicateInDestination(catalog, itemHash(item), item.kind, item.category, item.id))
      return error("This image is already in this collection.", 409);
    item.status = "active";
    item.removedAt = null;
    await saveCatalog(env, catalog);
    return json({ item });
  }
  const staticDeleteMatch = /^\/photos\/([a-z0-9-]+)$/.exec(path);
  if (method === "DELETE" && staticDeleteMatch) {
    const catalog = await readCatalog(env, url.origin);
    const item = catalogItem(catalog, staticDeleteMatch[1]);
    if (!item) return error("Photograph not found.", 404);
    item.status = "removed";
    item.removedAt = new Date().toISOString();
    await saveCatalog(env, catalog);
    return json({ ok: true });
  }
  const categoryMatch = /^\/categories\/(tattoo|design)\/(botanical|creatures|concepts|animals|plants|other)\/(clear|restore)$/.exec(path);
  if (method === "POST" && categoryMatch) {
    const [, kind, category, action] = categoryMatch;
    if (!validCategory(kind, category)) return error("Choose a valid collection.", 400);
    const catalog = await readCatalog(env, url.origin);
    if (action === "restore") {
      const restoringHashes = new Set();
      for (const item of catalog.items.filter((entry) => entry.kind === kind && entry.category === category && entry.status === "removed")) {
        const hash = itemHash(item);
        if (duplicateInDestination(catalog, hash, kind, category, item.id) || (hash && restoringHashes.has(hash)))
          return error("This collection contains a photo that is already in use. Restore photos individually.", 409);
        if (hash) restoringHashes.add(hash);
      }
    }
    let changed = 0;
    for (const item of catalog.items) {
      const belongs = item.category === category && item.kind === kind;
      if (!belongs || item.status === (action === "clear" ? "removed" : "active")) continue;
      item.status = action === "clear" ? "removed" : "active";
      item.removedAt = action === "clear" ? new Date().toISOString() : null;
      changed++;
    }
    await saveCatalog(env, catalog);
    return json({ changed });
  }
  const editMatch = /^\/photos\/([a-z0-9-]+)$/.exec(path);
  if (method === "PATCH" && editMatch) {
    const catalog = await readCatalog(env, url.origin);
    const item = catalogItem(catalog, editMatch[1]);
    if (!item || item.kind === "slot") return error("Photograph not found.", 404);
    let submitted;
    try { submitted = await request.json(); } catch { return error("Invalid request.", 400); }
    const nextCategory = submitted.category || item.category;
    if (!validCategory(item.kind, nextCategory)) return error("Choose a valid collection.", 400);
    if (typeof submitted.title !== "string" || !submitted.title.trim() || submitted.title.length > 80 ||
        !validDescription(submitted.alt))
      return error("Add a short title and image description.", 400);
    if (nextCategory !== item.category) {
      if (item.status === "active" && duplicateInDestination(catalog, itemHash(item), item.kind, nextCategory, item.id))
        return error("This image is already in this collection.", 409);
      item.position = nextPosition(catalog, item.kind, nextCategory, item.id);
      item.category = nextCategory;
    }
    item.title = submitted.title.trim();
    item.alt = submitted.alt.trim();
    await saveCatalog(env, catalog);
    return json({ item });
  }
  return error("Not found.", 404);
}

// Every catalog request for this site runs through one object. The queue keeps
// read/modify/write operations ordered even while KV image writes are in flight.
export class CatalogStore {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.pending = Promise.resolve();
  }

  fetch(request) {
    const work = this.pending.then(() => handle(request, {
      ...this.env,
      CATALOG_STORAGE: this.ctx.storage,
    }));
    this.pending = work.catch(() => {});
    return work;
  }
}

export default {
  async fetch(request, env) {
    try { return cors(request, await handle(request, env)); }
    catch (cause) {
      console.error("Photo API error", cause);
      return cors(request, error("Could not complete this request. Try again.", 500));
    }
  },
};
