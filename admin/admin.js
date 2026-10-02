const API_ROOT = window.SALI_PHOTO_API || "";
const MAX_BYTES = 8 * 1024 * 1024;
const CATEGORIES = {
  tattoo: [["botanical", "Botanical"], ["creatures", "Creatures"], ["concepts", "Concepts"]],
  design: [["animals", "Animals"], ["plants", "Plants"], ["other", "Other"]],
};
const connectForm = document.querySelector("#connect-form");
const uploadForm = document.querySelector("#upload-form");
const kindInput = document.querySelector("#kind");
const categoryInput = document.querySelector("#category");
const fileInput = document.querySelector("#photo");
const previewImage = document.querySelector("#preview-image");
const previewPlaceholder = document.querySelector("#preview span");
const libraryList = document.querySelector("#library-list");
const statusLine = document.querySelector("#status");
let password = "";
let catalog = { items: [] };
let knownHashes = new Set();
let previewUrl = null;

function setStatus(message, error = false) {
  statusLine.textContent = message;
  statusLine.classList.toggle("error", error);
}
function setBusy(form, busy) {
  form.querySelectorAll("button, input, select, textarea").forEach((field) => {
    field.disabled = busy;
  });
  form.setAttribute("aria-busy", String(busy));
}
if (!API_ROOT) {
  setBusy(connectForm, true);
  setStatus("Photo publishing is being connected. Please try again soon.");
}
function updateCategories() {
  categoryInput.replaceChildren();
  CATEGORIES[kindInput.value].forEach(([value, label]) => categoryInput.add(new Option(label, value)));
}
kindInput.addEventListener("change", updateCategories);
updateCategories();
function showConnected(connected) {
  connectForm.hidden = connected;
  document.querySelector("#disconnect").hidden = !connected;
  document.querySelector("#upload-panel").hidden = !connected;
  document.querySelector("#library-panel").hidden = !connected;
  const badge = document.querySelector("#connection-state");
  badge.textContent = connected ? "Signed in" : "Signed out";
  badge.classList.toggle("connected", connected);
}
async function api(path, { method = "GET", body, authenticated = false } = {}) {
  if (!API_ROOT) throw new Error("Photo publishing is being set up. Please try again later.");
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
    if (response.status === 401) { password = ""; showConnected(false); }
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return data;
}
async function loadKnownHashes() {
  try {
    const response = await fetch("../portfolio-uploads.json", { cache: "no-store" });
    if (!response.ok) return;
    const manifest = await response.json();
    knownHashes = new Set((manifest.known || []).map((item) => item.sha256));
  } catch { /* Server checks previously uploaded photos too. */ }
}
loadKnownHashes();
connectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  password = document.querySelector("#password").value;
  setBusy(connectForm, true);
  setStatus("Checking password…");
  try {
    await api("/login", { method: "POST", body: { password } });
    document.querySelector("#password").value = "";
    catalog = await api("/gallery");
    showConnected(true);
    renderLibrary();
    setStatus("Signed in. Choose a photograph to publish.");
  } catch (error) {
    password = "";
    setStatus(error.message, true);
  } finally { setBusy(connectForm, false); }
});
document.querySelector("#disconnect").addEventListener("click", () => {
  password = "";
  catalog = { items: [] };
  showConnected(false);
  libraryList.replaceChildren();
  setStatus("Signed out. The password has been cleared from this tab.");
});
fileInput.addEventListener("change", () => {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  const file = fileInput.files[0];
  previewImage.hidden = !file;
  previewPlaceholder.hidden = !!file;
  if (file) {
    previewUrl = URL.createObjectURL(file);
    previewImage.src = previewUrl;
  } else {
    previewUrl = null;
    previewImage.removeAttribute("src");
  }
});
async function sha256(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = fileInput.files[0];
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    setStatus("Choose a JPEG, PNG or WebP photograph.", true); return;
  }
  if (file.size > MAX_BYTES) {
    setStatus("This file is over 8 MB. Export a smaller copy first.", true); return;
  }
  const kind = kindInput.value;
  const category = categoryInput.value;
  if (!CATEGORIES[kind]?.some(([value]) => value === category)) {
    setStatus("Choose a valid collection.", true); return;
  }
  setBusy(uploadForm, true);
  setStatus("Checking photograph…");
  try {
    const hash = await sha256(file);
    if (knownHashes.has(hash) || catalog.items.some((item) => item.sha256 === hash))
      throw new Error("This exact image is already in the portfolio.");
    const form = new FormData();
    form.set("photo", file);
    form.set("kind", kind);
    form.set("category", category);
    form.set("title", document.querySelector("#title").value.trim());
    form.set("alt", document.querySelector("#alt").value.trim());
    setStatus("Uploading photograph…");
    const published = await api("/photos", { method: "POST", body: form, authenticated: true });
    catalog.items.push(published.item);
    uploadForm.reset();
    updateCategories();
    fileInput.dispatchEvent(new Event("change"));
    renderLibrary();
    setStatus("Published. The photograph will appear on the website shortly.");
  } catch (error) {
    setStatus(`Could not publish: ${error.message}`, true);
  } finally { setBusy(uploadForm, false); }
});
function renderLibrary() {
  libraryList.replaceChildren();
  const items = [...catalog.items].reverse();
  document.querySelector("#photo-count").textContent =
    `${items.length} added photograph${items.length === 1 ? "" : "s"}`;
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No photographs have been added through this page yet.";
    libraryList.append(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "library-item";
    const image = document.createElement("img");
    image.src = item.path;
    image.alt = "";
    image.loading = "lazy";
    const info = document.createElement("div");
    info.className = "library-item-info";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const category = document.createElement("span");
    category.textContent = `${item.kind === "tattoo" ? "Tattoo" : "Design"} · ${item.category}`;
    info.append(title, category);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${item.title} from the website`);
    remove.addEventListener("click", async () => {
      if (!confirm(`Remove “${item.title}” from the website?`)) return;
      remove.disabled = true;
      setStatus("Removing photograph…");
      try {
        await api(`/photos/${encodeURIComponent(item.id)}`, { method: "DELETE", authenticated: true });
        catalog.items = catalog.items.filter((entry) => entry.id !== item.id);
        renderLibrary();
        setStatus("Removed. The website will update shortly.");
      } catch (error) {
        remove.disabled = false;
        setStatus(`Could not remove: ${error.message}`, true);
      }
    });
    row.append(image, info, remove);
    libraryList.append(row);
  }
}
