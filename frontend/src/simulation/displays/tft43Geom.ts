/** 4.3" 800×480 模块的framebuffer 与画布外形。玻璃按约 5px/mm 缩小显示，像素缓冲保持 800×480。 */

export const TFT43_FB_W = 800;
export const TFT43_FB_H = 480;

export const TFT43_GLASS_W = 480;
export const TFT43_GLASS_H = 288;
export const TFT43_BEZEL = 16;
export const TFT43_GUTTER = 44;
export const TFT43_LABEL_H = 16;
export const TFT43_FPC_H = 8;

export const TFT43_BODY_W = TFT43_GUTTER + TFT43_GLASS_W + TFT43_BEZEL;
export const TFT43_BODY_H = TFT43_BEZEL + TFT43_GLASS_H + TFT43_LABEL_H + TFT43_FPC_H;

export const TFT43_PINS = ['GND', 'VCC', 'SCK', 'MOSI', 'MISO', 'CS', 'RST', 'BL'] as const;

export const TFT43_PIN_SPACING = 28;
