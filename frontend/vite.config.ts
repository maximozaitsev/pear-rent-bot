import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Allow ngrok/static tunnel hosts for Telegram Mini App local testing.
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_PROXY_TARGET || "http://backend:8000",
        changeOrigin: true,
      },
    },
  },
});
