const root = document.documentElement;
const header = document.querySelector("[data-header]");
const progress = document.querySelector(".scroll-progress");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let scrollQueued = false;
function updateScrollState() {
  const range = Math.max(
    1,
    document.documentElement.scrollHeight - window.innerHeight,
  );
  if (progress)
    progress.style.transform = `scaleX(${Math.min(1, window.scrollY / range)})`;
  header?.classList.toggle("is-scrolled", window.scrollY > 16);
  scrollQueued = false;
}
window.addEventListener(
  "scroll",
  () => {
    if (!scrollQueued) {
      scrollQueued = true;
      requestAnimationFrame(updateScrollState);
    }
  },
  { passive: true },
);
updateScrollState();

const mobileMenu = document.querySelector("[data-mobile-menu]");
if (mobileMenu) {
  mobileMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      mobileMenu.open = false;
    });
  });
  document.addEventListener("pointerdown", (event) => {
    if (mobileMenu.open && !mobileMenu.contains(event.target))
      mobileMenu.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mobileMenu.open) {
      mobileMenu.open = false;
      mobileMenu.querySelector("summary")?.focus();
    }
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 960) mobileMenu.open = false;
  });
}

const revealItems = [...document.querySelectorAll("[data-reveal]")];
if ("IntersectionObserver" in window && !reducedMotion.matches) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08, rootMargin: "0px 0px 40px 0px" },
  );
  revealItems.forEach((item) => {
    if (item.getBoundingClientRect().top < window.innerHeight * 1.05)
      item.classList.add("is-visible");
    else observer.observe(item);
  });
  root.classList.add("motion-ready");
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

const filterButtons = [...document.querySelectorAll("[data-filter]")];
const portfolioGrid = document.querySelector(".work-grid");
function updateGalleryEmpty(grid) {
  const empty = grid?.querySelector(".gallery-empty");
  if (empty) empty.hidden = [...grid.querySelectorAll("[data-lightbox]")].some((card) => !card.hidden);
}
if (filterButtons.length && portfolioGrid) {
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const chosen = button.dataset.filter;
      filterButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      portfolioGrid.querySelectorAll("[data-category]").forEach((card) => {
        card.hidden = chosen !== "all" && card.dataset.category !== chosen;
      });
      updateGalleryEmpty(portfolioGrid);
    });
  });
  root.classList.add("enhanced");
}

const dialog = document.querySelector("[data-lightbox-dialog]");
if (dialog && typeof dialog.showModal === "function") {
  const image = dialog.querySelector("[data-lightbox-image]");
  const title = dialog.querySelector("[data-lightbox-title]");
  const kind = dialog.querySelector("[data-lightbox-kind]");
  const counter = dialog.querySelector("[data-lightbox-counter]");
  const closeButton = dialog.querySelector("[data-lightbox-close]");
  let activeIndex = 0;
  let opener = null;
  let currentGroup = document;
  const visibleLinks = () =>
    [...currentGroup.querySelectorAll("[data-lightbox]")].filter(
      (link) =>
        !link.hidden &&
        !link.closest("[hidden]"),
    );
  function display(index) {
    const available = visibleLinks();
    if (!available.length) return;
    activeIndex = (index + available.length) % available.length;
    const link = available[activeIndex];
    image.src = link.href;
    image.alt = link.querySelector("img")?.alt || "";
    title.textContent = link.closest(".work-grid")
      ? "Tattoo by Vita"
      : link.dataset.title || "Original design";
    kind.textContent = link.closest(".work-grid")
      ? "Sa.li Tattoo portfolio"
      : link.dataset.kind || "Sa.li Tattoo designs";
    counter.textContent = `${String(activeIndex + 1).padStart(2, "0")} / ${String(available.length).padStart(2, "0")}`;
  }
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-lightbox]");
    if (!link) return;
    event.preventDefault();
    opener = link;
    currentGroup =
      link.closest(".work-grid, .category-gallery-grid") || document;
    display(visibleLinks().indexOf(link));
    dialog.showModal();
    closeButton.focus();
  });
  closeButton.addEventListener("click", () => dialog.close());
  dialog
    .querySelector("[data-lightbox-prev]")
    ?.addEventListener("click", () => display(activeIndex - 1));
  dialog
    .querySelector("[data-lightbox-next]")
    ?.addEventListener("click", () => display(activeIndex + 1));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    image.removeAttribute("src");
    if (opener?.isConnected) opener.focus();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      display(activeIndex - 1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      display(activeIndex + 1);
    }
  });
}

const tilt = document.querySelector("[data-tilt]");
if (
  tilt &&
  window.matchMedia("(pointer: fine)").matches &&
  !reducedMotion.matches
) {
  tilt.addEventListener("pointermove", (event) => {
    const rect = tilt.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    tilt.style.setProperty("--tilt-x", `${(-y * 3).toFixed(2)}deg`);
    tilt.style.setProperty("--tilt-y", `${(x * 3).toFixed(2)}deg`);
  });
  tilt.addEventListener("pointerleave", () => {
    tilt.style.setProperty("--tilt-x", "0deg");
    tilt.style.setProperty("--tilt-y", "0deg");
  });
}

// The photo API is the shared source for desktop and mobile. The original HTML
// remains a fallback if the API and local catalog are temporarily unavailable.
const apiRoot = window.SALI_PHOTO_API || "";
const validLocalPath = /^images\/[a-z0-9-]+\.(?:jpg|jpeg|png|webp)$/i;
const validApiPath = (path) =>
  !!apiRoot && path.startsWith(`${apiRoot}/photos/`) &&
  /^[a-f0-9-]{36}\/image$/.test(path.slice(`${apiRoot}/photos/`.length));
function safeImagePath(path) {
  return typeof path === "string" && (validLocalPath.test(path) || validApiPath(path));
}
async function loadCatalog() {
  for (const url of [apiRoot && `${apiRoot}/catalog`, "portfolio-catalog.json"].filter(Boolean)) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const catalog = await response.json();
      if (Array.isArray(catalog.items)) return catalog.items;
    } catch { /* Try the next source. */ }
  }
  return null;
}
function renderCatalog(items) {
  const active = items.filter((item) => item?.status === "active" && safeImagePath(item.path));
  const byId = new Map(active.map((item) => [item.id, item]));
  document.querySelectorAll("img[data-photo-slot]").forEach((image) => {
    const item = byId.get(image.dataset.photoSlot);
    image.hidden = !item;
    const figure = image.closest(".hero-mobile-image, .hero-main-image, .hero-accent-image");
    if (figure) figure.hidden = !item;
    if (!item) {
      image.removeAttribute("src");
      return;
    }
    image.src = item.path;
    image.alt = String(item.alt || item.title || "Artwork by Vita");
    if (Number.isInteger(item.width) && item.width > 0) image.width = item.width;
    if (Number.isInteger(item.height) && item.height > 0) image.height = item.height;
  });

  const target = document.querySelector(".work-grid, .category-gallery-grid");
  if (!target) return;
  const designCategory = {
    "animals.html": "animals",
    "plants.html": "plants",
    "other.html": "other",
  }[location.pathname.split("/").pop()];
  const kind = designCategory ? "design" : "tattoo";
  const galleryItems = active.filter((item) => item.kind === kind &&
    (!designCategory || item.category === designCategory))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const cards = galleryItems.map((item) => {
    const card = document.createElement("a");
    card.className = "work-card";
    card.href = item.path;
    card.dataset.lightbox = "";
    card.dataset.title = String(item.title || "Original artwork");
    if (designCategory) card.dataset.kind = "Original design";
    else card.dataset.category = item.category;
    const image = document.createElement("img");
    image.src = item.path;
    image.alt = String(item.alt || item.title || "Artwork by Vita");
    image.loading = "lazy";
    if (Number.isInteger(item.width) && item.width > 0) image.width = item.width;
    if (Number.isInteger(item.height) && item.height > 0) image.height = item.height;
    card.append(image);
    return card;
  });
  const empty = document.createElement("p");
  empty.className = "gallery-empty";
  empty.textContent = "New work is coming soon.";
  target.replaceChildren(...cards, empty);
  const chosen = document.querySelector("[data-filter].is-active")?.dataset.filter;
  if (chosen && chosen !== "all") {
    target.querySelectorAll("[data-category]").forEach((card) => {
      card.hidden = card.dataset.category !== chosen;
    });
  }
  updateGalleryEmpty(target);
}
loadCatalog().then((items) => { if (items) renderCatalog(items); });
