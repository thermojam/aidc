import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {resolve} from "node:path";

export default defineConfig({
    plugins: [react(), tailwindcss()],
    build: {rollupOptions: {input: {main: resolve("index.html"), viewer: resolve("viewer.html")}}},
    server: {host: "127.0.0.1", port: 1420, strictPort: true, watch: {ignored: ["**/src-tauri/**"]}},
});
