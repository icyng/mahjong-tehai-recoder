import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: "../assets",
  server: {
    port: 5173,
    proxy: {
      "/analysis": "http://localhost:8000",
      "/kifu": "http://localhost:8000",
      "/api": "http://localhost:8000"
    }
  }
});
