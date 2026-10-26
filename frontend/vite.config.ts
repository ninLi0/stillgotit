import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";

const katexFonts = /[\\/]katex[\\/]dist[\\/]fonts[\\/]/;

/**
 * KaTeX's stylesheet offers each font as woff2, woff and ttf. Every browser the build targets reads woff2, so the other
 * two are dropped before Vite reads the stylesheet, and the build copies only the 20 woff2 files.
 */
const katexWoff2Only: Plugin = {
  name: "stillgotit:katex-woff2-only",
  enforce: "pre",
  transform(code, id) {
    if (!/[\\/]katex[\\/]dist[\\/]katex(\.min)?\.css$/.test(id)) return;
    return code.replace(/,\s*url\([^)]+\.woff\)\s*format\("woff"\)\s*,\s*url\([^)]+\.ttf\)\s*format\("truetype"\)/g, "");
  },
};

export default defineConfig({
  root: import.meta.dirname,
  plugins: [katexWoff2Only, vue()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3000" } },
  build: {
    // KaTeX's fonts stay separate files, even the small ones, so the browser fetches a font only when a formula uses it.
    assetsInlineLimit: (file) => katexFonts.test(file) ? false : undefined,
  },
});
