import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  define: {
    __APP_BUILD_ID__: JSON.stringify(String(Date.now()))
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (id.includes("react") || id.includes("react-dom")) {
            return "react-vendor";
          }
          if (id.includes("@supabase")) {
            return "supabase-vendor";
          }
          if (id.includes("lucide-react")) {
            return "icons-vendor";
          }
          if (id.includes("xlsx")) {
            return "xlsx";
          }
          if (id.includes("exceljs")) {
            return "exceljs";
          }
          return "vendor";
        }
      }
    }
  }
});
