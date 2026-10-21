import { register } from 'node:module';

register(new URL('./vite-raw-loader.mjs', import.meta.url));
