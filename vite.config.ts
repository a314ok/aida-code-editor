import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue({
    template: {
      compilerOptions: {
        isCustomElement: (tag) => tag === "webview",
      },
    },
  })],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: "dist",
  },
});
