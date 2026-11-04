import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { main: resolve("index.html"), viewer: resolve("viewer.html") } } },
  server: { host: "127.0.0.1", port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
});
