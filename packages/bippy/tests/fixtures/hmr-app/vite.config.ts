import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The real Fast Refresh pipeline: @vitejs/plugin-react installs the
// react-refresh preamble and transforms components, exactly like the apps
// bippy has to survive in.
export default defineConfig({
  plugins: [react()],
});
