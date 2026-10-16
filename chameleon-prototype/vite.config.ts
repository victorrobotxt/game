import { resolve } from 'node:path';
import { defineConfig, type PluginOption } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { gyroRelay } from './vite-plugin-gyro-relay.ts';

// Phones only fire DeviceOrientationEvent in a secure context: `npm run dev:https` serves the
// game + /controller.html over a self-signed cert (accept the warning once on the phone).
const https = process.env.HTTPS === '1';

export default defineConfig({
    base: './',
    plugins: [gyroRelay(), https && basicSsl()] as PluginOption[],
    server: { host: true, port: 5173 },
    build: {
        target: 'es2022',
        rollupOptions: {
            input: {
                main: resolve(import.meta.dirname, 'index.html'),
                controller: resolve(import.meta.dirname, 'controller.html'),
            },
        },
    },
});
