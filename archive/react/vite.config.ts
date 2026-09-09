import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: "src",
  publicDir: path.resolve(__dirname, "public"),
  base: "./",
  build: {
    outDir: path.resolve(__dirname),
    emptyOutDir: false,
  },
});
