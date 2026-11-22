import { defineConfig } from "vite";

// Served from https://zaahieradams.github.io/repo-timelapse/
export default defineConfig({
  base: process.env.VITE_BASE ?? "/repo-timelapse/",
  build: { target: "es2022", sourcemap: false },
});
