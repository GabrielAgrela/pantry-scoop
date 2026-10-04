# Vendored blobatar

- `internal.js`, `expression.js`, `gaze.js`, `motion.css`, `gaze.css`, `LICENSE`:
  blobatar 2.7.0 (`dist/`), MIT. Source: https://github.com/Alain00/blobatar

Copied unchanged from the pinned npm package tarball, except the trailing
`sourceMappingURL` comments, which are dropped because the maps are not shipped.
Each module is self-contained (no imports, no dependencies, no network or
storage access); they only compute SVG geometry and set CSS custom properties
through the CSSOM.

`public/js/blob-buddy.js` renders the animated variant with `internal.js`
(`_parts`, the entry the official framework adapters use), morphs expressions
from `expression.js`, and follows the pointer with `gaze.js`. The library's
markup carries inline `style` attributes, which the app's CSP refuses, so the
buddy renames them before parsing and re-applies them through the CSSOM.

To update, download the pinned tarball with `npm pack blobatar@<version>`, copy
the same `dist/` files and `LICENSE`, strip the source map comments, and update
the version here. `internal.js` only promises stability within a major, so check
`_parts` still returns `{ cls, bg, inner, vars }` after a major upgrade.
