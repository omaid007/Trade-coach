import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    open: true,
    proxy: {
      "/api": "http://localhost:3001",
      "/ws":  { target: "ws://localhost:3001", ws: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
