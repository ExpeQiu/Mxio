/**
 * 4.3 寸 RA8875：把板子 SPI 字节解码进 800×480 玻璃。
 * 帧在 SPI 停顿后刷到 canvas，避免半帧闪一下。
 */

import { Ra8875Panel } from '../displays/Ra8875';
import { TFT43_FB_H, TFT43_FB_W } from '../displays/tft43Geom';
import { PartSimulationRegistry } from './PartSimulationRegistry';

const IDLE_FLUSH_MS = 50;

PartSimulationRegistry.register('tft43', {
  attachEvents: (element, simulator, getArduinoPinHelper) => {
    const el = element as HTMLElement & { canvas?: HTMLCanvasElement | null; lit?: boolean };
    const pinManager = (simulator as { pinManager?: { onPinChange: (pin: number, cb: (p: number, s: boolean) => void) => () => void } }).pinManager;
    const spi = (simulator as { spi?: { onByte: ((mosi: number) => void) | null; completeTransfer?: (miso: number) => void } }).spi;
    if (!pinManager || !spi) return () => {};

    const panel = new Ra8875Panel();
    let ctx: CanvasRenderingContext2D | null = null;
    let imageData: ImageData | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let lastFlushLog = 0;
    let csLow = false;

    const grab = (): CanvasRenderingContext2D | null => {
      const canvas = el.canvas ?? null;
      if (!canvas) return null;
      return canvas.getContext('2d');
    };

    const flush = () => {
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      if (!panel.dirty) return;
      if (!ctx) ctx = grab();
      if (!ctx) return;
      if (!imageData) imageData = ctx.createImageData(TFT43_FB_W, TFT43_FB_H);
      if (panel.lit) imageData.data.set(panel.pixels);
      else {
        imageData.data.fill(0);
        for (let i = 3; i < imageData.data.length; i += 4) imageData.data[i] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      el.lit = panel.lit;
      panel.dirty = false;
      const now = performance.now();
      if (now - lastFlushLog > 500) {
        lastFlushLog = now;
        console.info(
          `[tft43] flush bytes=${panel.bytes} px=${panel.pixelWrites} rects=${panel.rects} lit=${panel.lit ? 1 : 0} text="${panel.lastText}"`,
        );
      }
    };

    const scheduleFlush = () => {
      if (!panel.dirty) return;
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = setTimeout(flush, IDLE_FLUSH_MS);
    };

    const onReady = () => {
      ctx = grab();
      imageData = null;
      panel.dirty = true;
      scheduleFlush();
    };
    el.addEventListener('canvas-ready', onReady);
    ctx = grab();

    const unsubs: Array<() => void> = [];
    const pinCS = getArduinoPinHelper('CS');
    const pinRST = getArduinoPinHelper('RST');
    const pinBL = getArduinoPinHelper('BL');
    console.info(`[tft43] attach cs=${pinCS ?? '-'} rst=${pinRST ?? '-'} bl=${pinBL ?? '-'} fb=${TFT43_FB_W}x${TFT43_FB_H}`);

    if (pinCS !== null) {
      unsubs.push(
        pinManager.onPinChange(pinCS, (_pin, high) => {
          const low = !high;
          if (csLow && !low) panel.align();
          csLow = low;
        }),
      );
    }
    if (pinRST !== null) {
      unsubs.push(
        pinManager.onPinChange(pinRST, (_pin, high) => {
          if (!high) {
            panel.reset();
            flush();
          }
        }),
      );
    }
    if (pinBL !== null) {
      unsubs.push(
        pinManager.onPinChange(pinBL, (_pin, high) => {
          panel.setBacklight(high);
          scheduleFlush();
        }),
      );
    }

    const prevOnByte = spi.onByte;
    spi.onByte = (value: number) => {
      const miso = panel.pushByte(value);
      spi.completeTransfer?.(miso);
      scheduleFlush();
    };

    return () => {
      spi.onByte = prevOnByte;
      if (idleTimer !== null) clearTimeout(idleTimer);
      el.removeEventListener('canvas-ready', onReady);
      unsubs.forEach((u) => u());
    };
  },
});
