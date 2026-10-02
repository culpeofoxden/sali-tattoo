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

// Original portfolio cards live in HTML. Photos uploaded through the studio
// appear from the photo API when it is connected.
async function loadPublishedArtwork() {
  const target = document.querySelector(".work-grid, .category-gallery-grid");
  if (!target) return;
  const items = [];
  try {
    const response = await fetch("portfolio-uploads.json", { cache: "no-store" });
    if (response.ok) {
      const catalog = await response.json();
      if (Array.isArray(catalog.items)) items.push(...catalog.items);
    }
  } catch { /* Keep the built-in gallery available. */ }
  const apiRoot = window.SALI_PHOTO_API || "";
  if (apiRoot) {
    try {
      const response = await fetch(`${apiRoot}/gallery`, { cache: "no-store" });
      if (response.ok) {
        const catalog = await response.json();
        if (Array.isArray(catalog.items)) items.push(...catalog.items);
      }
    } catch { /* Keep the built-in gallery available. */ }
  }

  const pageName = location.pathname.split("/").pop();
  const designCategory = {
    "animals.html": "animals",
    "plants.html": "plants",
    "other.html": "other",
  }[pageName];
  const validLocalPath = /^images\/uploads\/[a-z0-9-]+\.(?:jpg|jpeg|png|webp)$/i;
  const validApiPath = (path) =>
    !!apiRoot && path.startsWith(`${apiRoot}/photos/`) &&
    /^[a-f0-9-]{36}\/image$/.test(path.slice(`${apiRoot}/photos/`.length));
  const seenPaths = new Set();
  const allowedTattooCategories = ["botanical", "creatures", "concepts"];

  for (const item of items) {
    if (!item || typeof item.path !== "string" ||
        !(validLocalPath.test(item.path) || validApiPath(item.path)) || seenPaths.has(item.path))
      continue;
    if (designCategory) {
      if (item.kind !== "design" || item.category !== designCategory)
        continue;
    } else if (
      item.kind !== "tattoo" ||
      !allowedTattooCategories.includes(item.category)
    ) {
      continue;
    }
    seenPaths.add(item.path);

    const card = document.createElement("a");
    card.className = "work-card";
    card.href = item.path;
    card.dataset.lightbox = "";
    card.dataset.title = String(item.title || "Original artwork");
    if (!designCategory) card.dataset.category = item.category;
    else card.dataset.kind = "Original design";

    const photo = document.createElement("img");
    photo.src = item.path;
    photo.alt = String(item.alt || item.title || "Artwork by Vita");
    photo.loading = "lazy";
    if (Number.isInteger(item.width) && item.width > 0)
      photo.width = item.width;
    if (Number.isInteger(item.height) && item.height > 0)
      photo.height = item.height;
    card.append(photo);

    if (designCategory) {
      const overlay = document.createElement("span");
      overlay.className = "work-card-overlay";
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = String(item.title || "New design");
      copy.append(title);
      const arrow = document.createElement("span");
      arrow.className = "work-open";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "↗";
      overlay.append(copy, arrow);
      card.append(overlay);
    }
    target.append(card);
  }

  const chosen = document.querySelector("[data-filter].is-active")?.dataset.filter;
  if (chosen && chosen !== "all") {
    target.querySelectorAll("[data-category]").forEach((card) => {
      card.hidden = card.dataset.category !== chosen;
    });
  }
}
loadPublishedArtwork();
