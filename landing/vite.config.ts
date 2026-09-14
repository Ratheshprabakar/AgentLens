import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Default `/` for Vercel; set VITE_BASE if hosting under a subpath. */
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  plugins: [react()],
  base,
  server: {
    port: 4050,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
