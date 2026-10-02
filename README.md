# Sa.li Tattoo

A static portfolio site for Vita, built with HTML, CSS and a small amount of vanilla JavaScript. The site is hosted at [sali.tattoo](https://sali.tattoo/); `CNAME` contains the custom domain.

## Local preview

From this folder, run:

```sh
python -m http.server 8000
```

Then open `http://localhost:8000/`. No build step or package installation is required.

## Pages

- `index.html` — main portfolio, artist, process, pricing and contact
- `animals.html`, `plants.html`, `other.html` — original sketch and design categories
- `admin/index.html` — password-based photo publishing for Vita
- `worker/` — private photo API for Cloudflare Workers and KV
- `portfolio-uploads.json` — hashes of the original artwork for duplicate checks
- `custom.html`, `fine-line.html`, `floral.html`, `ornamental.html` — legacy redirects

The tattoo portfolio and design pages open full-size images with JavaScript and remain ordinary image links without it. The mobile menu uses native `details`. Motion respects the visitor's reduced-motion preference.

## Updating content

- For new photos, open `https://sali.tattoo/admin/`. Vita signs in with the studio password, chooses the tattoo gallery or a design collection, and uploads one image. She can remove photos added through the admin page. The password stays in browser memory for that tab and is sent only over HTTPS to the photo API.
- The admin page accepts JPEG, PNG and WebP up to 8 MB per file. It rejects byte-for-byte duplicates of the catalogued images. Check visually for alternate crops or edits of an existing tattoo before publishing.
- The original HTML cards are still maintained in the HTML files. The admin page manages only images stored in Cloudflare KV. The public site loads them from the API, so no GitHub account or token is needed for routine uploads.
- If editing manually, add artwork to `images/` and update the corresponding HTML card with an accurate description and intrinsic image width and height.
- Keep tattoo photos in the main gallery and sketches in the three design pages. Check for duplicate tattoos before adding images.
- See `PHOTO_SELECTION.md` for the source-photo mapping and duplicate decisions from the September 2026 update.
- Keep the category pages, social metadata, and `sitemap.xml` in sync with significant content changes.
- Prices, studio addresses and booking information are maintained in `index.html`.
- The two linked review excerpts are from [Vita's Fresha profile](https://www.fresha.com/uk/a/vita-tattooist-at-teddington-ink-teddington-201-waldegrave-road-l0gueldz). Keep the wording and attribution faithful to that source.

Before publishing, check the site at desktop and narrow mobile widths, including the menu, filters, artwork dialog, and keyboard navigation.

## Photo API

The Worker is deployed at `https://sali-photo-api.beher-dan.workers.dev`; its KV namespace and rate limits are configured in Cloudflare. `photo-api-config.js` points the site to it. The one-time setup still needs an `ADMIN_PASSWORD` secret in the Worker settings. Use a unique password of at least 16 characters and do not put it in this repository. After setting it, sign in at `https://sali.tattoo/admin/` and upload a photo to check the complete publishing flow.

For future API changes, deploy `worker/index.js` to the existing Worker and keep the bindings in `worker/wrangler.jsonc`. The Worker checks the public `portfolio-uploads.json` catalog to reject images already on the site.

Cloudflare KV changes can take up to about a minute to appear globally. The admin page shows a successful upload immediately. The Worker uses a per-location login limit and a separate upload limit. Images have an 8 MB limit; Workers KV has a 1 GB free storage allowance and a 25 MiB per-item limit. Run `node --test worker/test.mjs` to check the API locally.
