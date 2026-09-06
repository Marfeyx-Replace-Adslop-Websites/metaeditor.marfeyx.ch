import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative assets keep production builds working on sub-path and static hosts.
  base: "./",
  plugins: [react(), tailwindcss()],
});
