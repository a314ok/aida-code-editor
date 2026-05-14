import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  main: {
    build: {
      outDir: "dist-electron/main",
      rollupOptions: {
        input: {
          main: resolve(__dirname, "electron/main.ts"),
        },
      },
    },
  },
  preload: {
    build: {
      outDir: "dist-electron/preload",
      rollupOptions: {
        input: {
          preload: resolve(__dirname, "electron/preload.ts"),
        },
      },
    },
  },
  renderer: {
    plugins: [vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === "webview",
        },
      },
    })],
    root: ".",
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(__dirname, "index.html"),
      },
    },
    server: {
      port: 5173,
      strictPort: false,
    },
  },
});
