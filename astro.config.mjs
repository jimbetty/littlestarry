import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://littlestarry.com',
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  trailingSlash: 'ignore',
});
