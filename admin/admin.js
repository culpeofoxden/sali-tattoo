const API_ROOT = window.SALI_PHOTO_API || "";
const MAX_BYTES = 8 * 1024 * 1024;
const CATEGORIES = {
  tattoo: [["botanical", "Botanical"], ["creatures", "Creatures"], ["concepts", "Conceptual"]],
  design: [["animals", "Animals"], ["plants", "Plants"], ["other", "Other"]],
};
const SLOT_GROUPS = [
  ["First screen", ["hero-main", "hero-accent"]],
  ["Meet the artist", ["artist-action", "artist-portrait"]],
  ["Sketchbook cards on home", ["design-cover-animals", "design-cover-plants", "design-cover-other"]],
  ["Sketchbook page covers", ["design-hero-animals", "design-hero-plants", "design-hero-other"]],
];
const $ = (selector) => document.querySelector(selector);
const connectForm = $("#connect-form");
const uploadForm = $("#upload-form");
const kindInput = $("#kind");
const categoryInput = $("#category");
const fileInput = $("#photo");
let password = "";
let catalog = { items: [] };
let knownHashes = new Set();
let replacementId = null;
let previewUrl = null;

function status(message, error = false) {
  $("#status").textContent = message;
  $("#status").classList.toggle("error", error);
}
function busy(form, value) {
  form.querySelectorAll("button, input, select, textarea").forEach((field) => { field.disabled = value; });
  form.setAttribute("aria-busy", String(value));
}
function categories() {
  categoryInput.replaceChildren(...CATEGORIES[kindInput.value].map(([value, label]) => new Option(label, value)));
}
kindInput.addEventListener("change", categories);
categories();
function connected(value) {
  connectForm.hidden = value;
  $("#disconnect").hidden = !value;
  $("#upload-panel").hidden = !value;
  $("#library-panel").hidden = !value;
  $("#connection-state").textContent = value ? "Signed in" : "Signed out";
  $("#connection-state").classList.toggle("connected", value);
}
async function api(path, { method = "GET", body, authenticated = true } = {}) {
  if (!API_ROOT) throw new Error("Photo publishing is not connected.");
  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    headers: {
      ...(authenticated ? { "X-Admin-Password": password } : {}),
      ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) { password = ""; connected(false); }
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return data;
}
if (!API_ROOT) {
  busy(connectForm, true);
  status("Photo publishing is not connected.", true);
}
fetch("../portfolio-uploads.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : null)
  .then((manifest) => { knownHashes = new Set((manifest?.known || []).map((item) => item.sha256)); })
  .catch(() => {});

connectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  password = $("#password").value;
  busy(connectForm, true);
  status("Checking password…");
  try {
    await api("/login", { method: "POST", body: { password }, authenticated: false });
    catalog = await api("/admin/catalog");
    $("#password").value = "";
    connected(true);
    renderCatalog();
    status("Signed in. You can manage every photo on the site.");
  } catch (error) {
    password = "";
    status(error.message, true);
  } finally { busy(connectForm, false); }
});
$("#disconnect").addEventListener("click", () => {
  password = "";
  catalog = { items: [] };
  resetReplacement();
  connected(false);
  $("#catalog-groups").replaceChildren();
  $("#removed-list").replaceChildren();
  status("Signed out. The password has been cleared from this tab.");
});
fileInput.addEventListener("change", () => {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  const file = fileInput.files[0];
  $("#preview-image").hidden = !file;
  $("#preview span").hidden = !!file;
  previewUrl = file ? URL.createObjectURL(file) : null;
  if (file) $("#preview-image").src = previewUrl;
  else $("#preview-image").removeAttribute("src");
});
async function sha256(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function resetReplacement() {
  replacementId = null;
  $("#replace-message").hidden = true;
  $("#upload-destination").hidden = false;
  $("#upload-title").textContent = "Add one photograph";
  $(".publish-button").firstChild.textContent = "Publish photograph ";
  uploadForm.reset();
  categories();
  fileInput.dispatchEvent(new Event("change"));
}
function replace(item) {
  replacementId = item.id;
  $("#replace-message").hidden = false;
  $("#replace-description").textContent = `Replacing “${item.title}”. The new photo will take its place on the website.`;
  $("#upload-destination").hidden = true;
  $("#upload-title").textContent = "Replace photograph";
  $(".publish-button").firstChild.textContent = "Save replacement ";
  $("#title").value = item.title;
  $("#alt").value = item.alt || "";
  $("#upload-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  fileInput.focus();
}
$("#cancel-replace").addEventListener("click", resetReplacement);
uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = fileInput.files[0];
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    status("Choose a JPEG, PNG or WebP image.", true); return;
  }
  if (file.size > MAX_BYTES) { status("This file is over 8 MB. Export a smaller copy first.", true); return; }
  if (!replacementId && !CATEGORIES[kindInput.value]?.some(([value]) => value === categoryInput.value)) {
    status("Choose a valid collection.", true); return;
  }
  busy(uploadForm, true);
  status("Checking image…");
  try {
    const hash = await sha256(file);
    if (knownHashes.has(hash) || catalog.items.some((item) => item.sha256 === hash))
      throw new Error("This exact image is already in the portfolio.");
    const form = new FormData();
    form.set("photo", file);
    form.set("title", $("#title").value.trim());
    form.set("alt", $("#alt").value.trim());
    if (replacementId) form.set("replaceId", replacementId);
    else { form.set("kind", kindInput.value); form.set("category", categoryInput.value); }
    status("Uploading image…");
    const result = await api("/photos", { method: "POST", body: form });
    const index = catalog.items.findIndex((item) => item.id === result.item.id);
    if (index >= 0) catalog.items[index] = result.item;
    else catalog.items.push(result.item);
    resetReplacement();
    renderCatalog();
    status("Saved. The website will update shortly.");
  } catch (error) {
    status(`Could not save: ${error.message}`, true);
  } finally { busy(uploadForm, false); }
});
function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
}
function button(label, action, className = "card-button") {
  const node = element("button", className, label);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}
function updateItem(next) {
  const index = catalog.items.findIndex((item) => item.id === next.id);
  if (index >= 0) catalog.items[index] = next;
  renderCatalog();
}
async function remove(item) {
  if (!confirm(`Remove “${item.title}” from the website? You can restore it later.`)) return;
  status("Removing photo…");
  try {
    await api(`/photos/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    updateItem({ ...item, status: "removed" });
    status("Removed. The website will update shortly.");
  } catch (error) { status(error.message, true); }
}
async function restore(item) {
  status("Restoring photo…");
  try {
    const result = await api(`/photos/${encodeURIComponent(item.id)}/restore`, { method: "POST" });
    updateItem(result.item);
    status("Restored. The website will update shortly.");
  } catch (error) { status(error.message, true); }
}
function edit(item, host) {
  const form = element("form", "card-edit");
  const title = element("input");
  title.type = "text"; title.maxLength = 80; title.required = true; title.value = item.title;
  title.setAttribute("aria-label", "Internal title");
  const alt = element("textarea");
  alt.maxLength = 180; alt.required = true; alt.value = item.alt || "";
  alt.setAttribute("aria-label", "Image description");
  const category = element("select");
  category.setAttribute("aria-label", "Collection");
  CATEGORIES[item.kind].forEach(([value, label]) => category.add(new Option(label, value)));
  category.value = item.category;
  const save = element("button", "card-button", "Save details");
  save.type = "submit";
  form.append(title, alt, category, save, button("Cancel", () => form.remove()));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    busy(form, true);
    try {
      const result = await api(`/photos/${encodeURIComponent(item.id)}`, {
        method: "PATCH", body: { title: title.value.trim(), alt: alt.value.trim(), category: category.value },
      });
      updateItem(result.item);
      status("Details saved.");
    } catch (error) { status(error.message, true); busy(form, false); }
  });
  host.append(form);
  title.focus();
}
function card(item) {
  const host = element("div", `manage-card${item.status === "removed" ? " is-removed" : ""}`);
  if (item.path) {
    const image = element("img");
    image.src = item.path; image.alt = item.alt || item.title; image.loading = "lazy";
    host.append(image);
  } else host.append(element("div", "empty-photo", "No photo"));
  const info = element("div", "manage-card-info");
  info.append(element("strong", "", item.title));
  if (item.kind === "slot") info.append(element("small", "", item.id.replaceAll("-", " ")));
  const actions = element("div", "card-actions");
  if (item.status === "removed") actions.append(button("Restore", () => restore(item)));
  else {
    actions.append(button("Replace", () => replace(item)));
    if (item.kind !== "slot") actions.append(button("Edit details", () => edit(item, info)));
    actions.append(button("Remove", () => remove(item), "card-button danger"));
  }
  info.append(actions);
  host.append(info);
  return host;
}
function group(title, items, { kind, category } = {}) {
  const host = element("section", "library-group");
  const head = element("div", "library-group-heading");
  head.append(element("h3", "", title), element("span", "muted", `${items.filter((item) => item.status === "active").length} photos`));
  if (kind && category) {
    const actions = element("div", "group-actions");
    actions.append(button("Add photo", () => {
      resetReplacement(); kindInput.value = kind; categories(); categoryInput.value = category;
      $("#upload-panel").scrollIntoView({ behavior: "smooth", block: "start" }); fileInput.focus();
    }));
    const active = catalog.items.some((item) => item.category === category &&
      (item.kind === kind || (kind === "design" && item.kind === "slot")) && item.status === "active");
    actions.append(button(active ? "Clear collection" : "Restore collection", async () => {
      const action = active ? "clear" : "restore";
      if (active && !confirm(`Remove every photo in ${title}? You can restore the collection later.`)) return;
      try {
        await api(`/categories/${kind}/${category}/${action}`, { method: "POST" });
        catalog.items.forEach((item) => {
          if (item.category === category && (item.kind === kind || (kind === "design" && item.kind === "slot")))
            item.status = active ? "removed" : "active";
        });
        renderCatalog();
        status(active ? "Collection cleared." : "Collection restored.");
      } catch (error) { status(error.message, true); }
    }, "card-button subtle"));
    host.append(head, actions);
  } else host.append(head);
  const grid = element("div", "manage-grid");
  if (items.length) grid.append(...items.map(card));
  else grid.append(element("p", "muted", "This collection is empty. Add a photo to start."));
  host.append(grid);
  return host;
}
function renderCatalog() {
  const active = catalog.items.filter((item) => item.status === "active");
  $("#photo-count").textContent = `${active.length} photos in use`;
  const container = $("#catalog-groups");
  container.replaceChildren();
  for (const [title, ids] of SLOT_GROUPS) {
    const slots = ids.map((id) => catalog.items.find((item) => item.id === id)).filter(Boolean);
    container.append(group(title, slots));
  }
  for (const [kind, heading] of [["tattoo", "Tattoo gallery"], ["design", "Sketchbook gallery"]]) {
    container.append(element("h2", "catalog-heading", heading));
    for (const [category, title] of CATEGORIES[kind]) {
      const items = active.filter((item) => item.kind === kind && item.category === category)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      container.append(group(title, items, { kind, category }));
    }
  }
  const removed = catalog.items.filter((item) => item.status === "removed");
  $("#removed-count").textContent = `${removed.length} photos`;
  $("#removed-group").hidden = !removed.length;
  $("#removed-list").replaceChildren(...removed.map(card));
}
