import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Project Pages need /AgentLens/; override with VITE_BASE=/ for a custom domain. */
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
