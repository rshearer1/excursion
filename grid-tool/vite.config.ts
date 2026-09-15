import { defineConfig } from "vite";
import { renderHelper } from "./server/render";

// `npm run dev` serves the grid tool and, on the same port, the local render helper
// (server/render.ts): the Render button in the page talks to Blender and ffmpeg through it.
export default defineConfig({
  plugins: [renderHelper()],
  server: { port: 5173 },
});
