import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:single` inlines everything into one dist-single/index.html for easy sharing.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  // Relative paths in the published build, so the icons and manifest resolve under the
  // GitHub Pages project path (radiusao.github.io/aboutwhalenstuff/).
  base: mode === 'single' ? './' : '/',
  build: mode === 'single' ? { outDir: 'dist-single' } : {},
}));
