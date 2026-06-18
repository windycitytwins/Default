'use strict';

/**
 * build-standalone.js — bundles the whole app into a single, dependency-free
 * `chart-school.html` you can open by double-clicking (no server needed).
 *
 * The standalone file uses offline demo data (the live-data proxy needs the
 * Node server). Run `node build-standalone.js` after changing any source file.
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const pub = path.join(root, 'public');

let html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(pub, 'css', 'styles.css'), 'utf8');

// Inline the stylesheet. NB: use FUNCTION replacers so `$` sequences in the
// inlined code (e.g. `$'`, `$&`) are inserted literally, not interpreted.
html = html.replace(/<link rel="stylesheet" href="css\/styles\.css"\s*\/>/, () => `<style>\n${css}\n</style>`);

// Inline each script, in order, escaping any stray "</script>" just in case.
const order = ['indicators.js', 'data.js', 'chart.js', 'lessons.js', 'analysis.js', 'screener.js', 'glossary.js', 'blueprint.js', 'app.js'];
for (const file of order) {
  const code = fs
    .readFileSync(path.join(pub, 'js', file), 'utf8')
    .replace(/<\/script>/g, '<\\/script>');
  html = html.replace(new RegExp(`<script src="js/${file.replace('.', '\\.')}"></script>`), () => `<script>\n${code}\n</script>`);
}

// A small banner so it's obvious this is the standalone (demo-data) build.
html = html.replace(
  '</title>',
  '</title>\n  <!-- Standalone build — open directly in a browser. Uses offline demo data;\n       run `node server.js` for live market data. -->'
);

const out = path.join(root, 'chart-school.html');
fs.writeFileSync(out, html, 'utf8');

// Sanity check: nothing external should remain.
const leftover = /(href="css\/|src="js\/)/.test(html);
console.log(
  leftover
    ? '⚠  Warning: external references still present!'
    : `✅ Wrote ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB, fully self-contained)`
);
process.exit(leftover ? 1 : 0);
