# Frame

A client-side photo analysis and color-grading tool, built entirely in vanilla HTML, CSS, and JavaScript. No frameworks, no backend, no dependencies — every pixel operation runs in the browser.

**[Live demo →](https://aryanarunm.github.io/Frame/)**

---

## What it does

Frame has two top-level modes, switchable from the topbar:

### Analyze
Drop in a photo and get an instant breakdown of its exposure, color balance, and tonal distribution — built for photographers and retouchers who want a fast, objective read on an image before editing it.

### Color match
Drop in two photos — a **Reference** (the grade you want to copy) and a **Target** (the photo you want to grade) — and Frame transfers the color feel of one onto the other automatically.

- **Algorithm:** statistical color transfer, based on Reinhard et al.'s 2001 paper *"Color Transfer between Images."* Both images are converted from RGB into **lαβ** space (via LMS cone space), a decorrelated color space where lightness and color can be adjusted independently. Frame then matches the mean and standard deviation of each channel between the two images, and converts back to RGB — transferring the *statistical signature* of a grade rather than overlaying pixels.
- **Strength slider** blends between the original and the fully-graded result.
- **Three-up preview** (Reference / Target / Result) so you can see what's driving the output.
- Processing is capped at 2400px on the long edge to keep the tab responsive, with a full-resolution pass applied on download.

---

## Tech stack

- Vanilla **HTML / CSS / JavaScript** — no build step, no frameworks
- All image processing runs client-side via the Canvas API — nothing is uploaded anywhere
- Deployed as a static site on **GitHub Pages**

---

## Design

A "luxury darkroom" aesthetic — dark, minimal, and typographic, closer to a film lab's contact sheet than a typical web app.

---

## Running locally

Since it's a static site with no build step, just clone and open:

```bash
git clone https://github.com/aryanarunm7807-arch/Frame.git
cd Frame
open index.html
```

Or serve it locally to avoid any file:// restrictions:

```bash
python3 -m http.server 8000
```

---

## Project structure

```
Frame/
├── index.html
├── style.css
├── script.js
└── README.md
```

---

## Credits

Color transfer implementation based on:
Reinhard, E., Adhikhmin, M., Gooch, B., & Shirley, P. (2001). *Color Transfer between Images.* IEEE Computer Graphics and Applications, 21(5), 34–41.

---

## Related project

**[Focal](https://github.com/aryanarunm7807-arch)** — an earlier, similar photo tool by the same author.
