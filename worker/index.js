const SITE_ORIGIN = "https://sali.tattoo";
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
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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

function imageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte))
    return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP")
    return "image/webp";
  return null;
}

async function allItems(store, origin) {
  const items = [];
  let cursor;
  do {
    const page = await store.list({ prefix: "photo:", limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const entry of page.keys) {
      const item = entry.metadata;
      if (item?.id && item?.kind && item?.category)
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

async function isPublishedPhoto(sha256) {
  const response = await fetch(`${SITE_ORIGIN}/portfolio-uploads.json`);
  if (!response.ok) throw new Error("The published photo catalog is unavailable.");
  const catalog = await response.json();
  return catalog.known?.some((item) => item.sha256 === sha256) === true;
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
  if (method === "GET" && path === "/gallery") {
    return json({ items: await allItems(env.GALLERY, url.origin) });
  }
  const imageMatch = /^\/photos\/([a-f0-9-]{36})\/image$/.exec(path);
  if (method === "GET" && imageMatch) {
    const item = await env.GALLERY.get(`photo:${imageMatch[1]}`, { type: "arrayBuffer" });
    if (!item) return error("Photograph not found.", 404);
    const type = imageType(new Uint8Array(item));
    if (!type) return error("Photograph is unavailable.", 500);
    return new Response(item, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (!["POST", "DELETE"].includes(method)) return error("Not found.", 404);
  if (request.headers.get("Origin") !== SITE_ORIGIN) return error("Origin is not allowed.", 403);
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 16) return error("Admin access is not configured.", 503);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await rateLimit(env.LOGIN_LIMIT, `login:${ip}`))) return error("Too many attempts. Try again in a minute.", 429);

  if (method === "POST" && path === "/login") {
    if (Number(request.headers.get("Content-Length")) > 1024) return error("Request is too large.", 413);
    let submitted;
    try { submitted = await request.json(); } catch { return error("Invalid request.", 400); }
    if (!(await matchesPassword(submitted.password, env.ADMIN_PASSWORD)))
      return error("Incorrect password.", 401);
    return json({ ok: true });
  }
  if (!(await matchesPassword(request.headers.get("X-Admin-Password"), env.ADMIN_PASSWORD)))
    return error("Incorrect password.", 401);

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
    const title = form.get("title");
    const alt = form.get("alt");
    if (!(file instanceof File) || !file.size || file.size > MAX_BYTES)
      return error("Choose a JPEG, PNG or WebP image up to 8 MB.", 400);
    if (!CATEGORIES[kind]?.has(category)) return error("Choose a valid collection.", 400);
    if (typeof title !== "string" || !title.trim() || title.length > 80 ||
        typeof alt !== "string" || !alt.trim() || alt.length > 180)
      return error("Add a short title and image description.", 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = imageType(bytes);
    if (!type || type !== file.type || !MIME_EXTENSIONS[type])
      return error("The file is not a valid JPEG, PNG or WebP image.", 400);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (await isPublishedPhoto(sha256)) return error("This exact image is already in the portfolio.", 409);
    const existing = await allItems(env.GALLERY, url.origin);
    if (existing.some((item) => item.sha256 === sha256))
      return error("This exact image is already in the portfolio.", 409);
    const id = crypto.randomUUID();
    const item = {
      id, kind, category, title: title.trim(), alt: alt.trim(), sha256,
      type, addedAt: new Date().toISOString(),
    };
    await env.GALLERY.put(`photo:${id}`, bytes, { metadata: item });
    return json({ item: { ...item, path: `${url.origin}/photos/${id}/image` } }, 201);
  }
  const deleteMatch = /^\/photos\/([a-f0-9-]{36})$/.exec(path);
  if (method === "DELETE" && deleteMatch) {
    const key = `photo:${deleteMatch[1]}`;
    const existing = await env.GALLERY.get(key);
    if (!existing) return error("Photograph not found.", 404);
    await env.GALLERY.delete(key);
    return json({ ok: true });
  }
  return error("Not found.", 404);
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
