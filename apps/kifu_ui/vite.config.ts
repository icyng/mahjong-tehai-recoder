import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: path.resolve(__dirname, "../assets"),
  server: {
    port: 5173
  }
});
