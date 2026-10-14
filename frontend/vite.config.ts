import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [vue()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3000", "/auth/chatgpt/return": "http://127.0.0.1:3000" } },
});
