# Vendored emoji picker

- `picker.js`, `database.js`, `LICENSE`: emoji-picker-element 1.29.1, Apache-2.0.
  Source: https://github.com/nolanlawson/emoji-picker-element
- `emojis-en.json`, `DATA-LICENSE`: emoji-picker-element-data 1.8.0, English
  Emojibase data, Apache-2.0. Source: https://github.com/nolanlawson/emoji-picker-element-data

Copied from the pinned npm package tarballs. In `picker.js`, the upstream
`baseStyles` and `EXTRA_STYLES` have been extracted into `picker.css`, and the
shadow-root `<style>` injection has been replaced with a same-origin stylesheet
link resolved against `import.meta.url`. The template renderer applies dynamic
style values with the CSSOM (`style.cssText`) instead of `setAttribute('style')`.
This supports the app's strict CSP without allowing arbitrary inline style
attributes or style blocks. All picker behavior and data remain upstream.

The app lazily imports
the picker and sets its data source to the same-origin JSON file; neither asset
needs a CDN at runtime. To update, download the pinned package tarballs with
`npm pack`, copy these same files, repeat the CSS extraction, link adaptation and
CSSOM patch, and update the versions here.
