import { loadEnv } from '../env.js';

export function qemuStatus(opts: { demo: boolean }): {
  available: false;
  error: 'qemu_unavailable';
  reason: string;
} {
  const env = loadEnv(opts.demo);
  if (opts.demo || env.mock) {
    return {
      available: false,
      error: 'qemu_unavailable',
      reason: 'demo mode does not start QEMU',
    };
  }
  if (!env.bootImagesDir) {
    return {
      available: false,
      error: 'qemu_unavailable',
      reason: 'VELXIO_BOOT_IMAGES_LOCAL_DIR is not set; Pi Linux images are not bundled in OSS',
    };
  }
  return {
    available: false,
    error: 'qemu_unavailable',
    reason: 'QEMU client is not implemented in CLI; use editor Run or /api/simulation/ws',
  };
}
