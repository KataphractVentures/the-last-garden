import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: './',
  // Generated simulation archives are not application inputs. On Windows,
  // watching a checkpoint while another process writes it can raise EBUSY.
  server: {watch: {ignored: ['**/qa/**']}},
  build: {target: 'es2022'},
});
