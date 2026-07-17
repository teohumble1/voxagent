import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Library mode: gói React vào luôn -> ra 1 file JS tự chứa, nhúng vào web bất kỳ.
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, "src/mount.tsx"),
      name: "VoxAgentWidget",
      formats: ["iife"],
      fileName: () => "voxagent-widget.js",
    },
    // KHÔNG externalize react -> bundle self-contained cho embed.
    rollupOptions: {},
  },
});
