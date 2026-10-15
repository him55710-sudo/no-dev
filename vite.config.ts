import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./",
  plugins: [react()],
  test: { include: ["tests/**/*.test.ts"] },
  worker: { format: "es" },
  server: { port: 5173, strictPort: true },
  build: { chunkSizeWarningLimit: 600 },
});
