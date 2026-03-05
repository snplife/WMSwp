import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  define: {
    __APP_BUILD_ID__: JSON.stringify(String(Date.now()))
  },
  plugins: [react()]
});
