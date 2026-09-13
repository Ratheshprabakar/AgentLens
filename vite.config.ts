import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  root: "web",
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 4041,
    proxy: {
      "/api": {
        target: "http://localhost:4040",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "web/src"),
    },
  },
});
