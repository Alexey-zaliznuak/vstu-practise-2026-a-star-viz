import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "/a-star/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        city: resolve(__dirname, "city/index.html"),
      },
    },
  },
});
