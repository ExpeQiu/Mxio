import type { ExampleProject } from './examples';

const sketch = `#include <SPI.h>

// 4.3" 800x480 RA8875. Same register writes a BuyDisplay / Adafruit module accepts.
// SCK 18, MISO 19, MOSI 23, CS 5, RST 17. VCC and BL to 3V3, GND to GND.

#define PIN_SCK  18
#define PIN_MISO 19
#define PIN_MOSI 23
#define PIN_CS    5
#define PIN_RST  17

static uint32_t turnId = 0;

void wrCmd(uint8_t c) {
  digitalWrite(PIN_CS, LOW);
  SPI.transfer(0x80);
  SPI.transfer(c);
  digitalWrite(PIN_CS, HIGH);
}

void wrData(uint8_t d) {
  digitalWrite(PIN_CS, LOW);
  SPI.transfer(0x00);
  SPI.transfer(d);
  digitalWrite(PIN_CS, HIGH);
}

void wrReg(uint8_t r, uint8_t v) {
  wrCmd(r);
  wrData(v);
}

void setFg(uint16_t color) {
  wrReg(0x63, (color >> 11) & 0x1F);
  wrReg(0x64, (color >> 5) & 0x3F);
  wrReg(0x65, color & 0x1F);
}

void fillCircle(int x, int y, int r, uint16_t color) {
  if (r <= 0) return;
  if (r > 255) r = 255;
  setFg(color);
  wrReg(0x99, x & 0xFF);
  wrReg(0x9A, (x >> 8) & 0xFF);
  wrReg(0x9B, y & 0xFF);
  wrReg(0x9C, (y >> 8) & 0xFF);
  wrReg(0x9D, (uint8_t)r);
  wrReg(0x90, 0x60);
}

void drawLine(int x0, int y0, int x1, int y1, uint16_t color) {
  setFg(color);
  wrReg(0x91, x0 & 0xFF);
  wrReg(0x92, (x0 >> 8) & 0xFF);
  wrReg(0x93, y0 & 0xFF);
  wrReg(0x94, (y0 >> 8) & 0xFF);
  wrReg(0x95, x1 & 0xFF);
  wrReg(0x96, (x1 >> 8) & 0xFF);
  wrReg(0x97, y1 & 0xFF);
  wrReg(0x98, (y1 >> 8) & 0xFF);
  wrReg(0x90, 0x80);
}

void fillRect(int x, int y, int w, int h, uint16_t color) {
  if (w <= 0 || h <= 0) return;
  setFg(color);
  int x1 = x + w - 1;
  int y1 = y + h - 1;
  wrReg(0x91, x & 0xFF);
  wrReg(0x92, (x >> 8) & 0xFF);
  wrReg(0x93, y & 0xFF);
  wrReg(0x94, (y >> 8) & 0xFF);
  wrReg(0x95, x1 & 0xFF);
  wrReg(0x96, (x1 >> 8) & 0xFF);
  wrReg(0x97, y1 & 0xFF);
  wrReg(0x98, (y1 >> 8) & 0xFF);
  wrReg(0x90, 0xB0);
}

void textAt(int x, int y, uint8_t scale, uint16_t color, const char* s) {
  setFg(color);
  wrReg(0x40, 0x80);
  if (scale > 3) scale = 3;
  wrReg(0x22, (scale << 2) | scale);
  wrReg(0x2A, x & 0xFF);
  wrReg(0x2B, (x >> 8) & 0xFF);
  wrReg(0x2C, y & 0xFF);
  wrReg(0x2D, (y >> 8) & 0xFF);
  wrCmd(0x02);
  while (*s) {
    wrData((uint8_t)*s);
    s++;
  }
}

void panelInit() {
  wrReg(0x88, 0x0B);
  wrReg(0x89, 0x02);
  wrReg(0x10, 0x0C);
  wrReg(0x04, 0x82);
  wrReg(0x14, 0x63);
  wrReg(0x15, 0x00);
  wrReg(0x16, 0x03);
  wrReg(0x17, 0x03);
  wrReg(0x18, 0x0B);
  wrReg(0x19, 0xDF);
  wrReg(0x1A, 0x01);
  wrReg(0x1B, 0x20);
  wrReg(0x1C, 0x00);
  wrReg(0x1D, 0x16);
  wrReg(0x1E, 0x00);
  wrReg(0x1F, 0x01);
  wrReg(0x8A, 0x8A);
  wrReg(0x8B, 0xFF);
  wrReg(0xC7, 0x01);
  wrReg(0x01, 0x80);
  wrReg(0x30, 0x00);
  wrReg(0x31, 0x00);
  wrReg(0x32, 0x00);
  wrReg(0x33, 0x00);
  wrReg(0x34, 799 & 0xFF);
  wrReg(0x35, (799 >> 8) & 0xFF);
  wrReg(0x36, 479 & 0xFF);
  wrReg(0x37, (479 >> 8) & 0xFF);
}

static const uint16_t C_BG = 0x1082;
static const uint16_t C_SKIN = 0xFE73;
static const uint16_t C_HAIR = 0x4163;
static const uint16_t C_SHIRT = 0x23D4;
static const uint16_t C_LIP = 0xC229;
static const uint16_t C_IRIS = 0x23B5;

void eye(int cx, int cy, int look, bool shut) {
  if (shut) {
    fillRect(cx - 22, cy - 4, 44, 10, C_SKIN);
    return;
  }
  fillCircle(cx, cy, 16, 0xFFFF);
  fillCircle(cx + look, cy + 1, 8, C_IRIS);
  fillCircle(cx + look, cy + 1, 4, 0x1082);
  fillCircle(cx + look - 4, cy - 4, 2, 0xFFFF);
}

void paintHuman(uint32_t frame) {
  bool blink = (frame % 18) < 2;
  int mouth = (int)((frame / 3) % 4);
  int look = ((frame / 10) % 3 == 0) ? -5 : (((frame / 10) % 3 == 1) ? 5 : 0);

  fillRect(0, 0, 800, 480, C_BG);
  fillCircle(400, 530, 220, C_SHIRT);
  fillRect(378, 268, 44, 80, C_SKIN);
  fillCircle(400, 148, 116, C_HAIR);
  fillCircle(400, 188, 104, C_SKIN);
  fillCircle(286, 206, 16, C_SKIN);
  fillCircle(514, 206, 16, C_SKIN);
  fillCircle(292, 206, 8, C_HAIR);
  fillCircle(508, 206, 8, C_HAIR);

  eye(352, 176, look, blink);
  eye(448, 176, look, blink);
  drawLine(324, 150, 372, 156, C_HAIR);
  drawLine(476, 156, 428, 150, C_HAIR);
  drawLine(400, 196, 400, 220, C_HAIR);
  drawLine(392, 222, 408, 222, C_HAIR);

  if (mouth == 0) {
    drawLine(364, 248, 384, 258, C_LIP);
    drawLine(384, 258, 416, 258, C_LIP);
    drawLine(416, 258, 436, 248, C_LIP);
  } else if (mouth == 3) {
    drawLine(370, 252, 430, 252, C_LIP);
  } else {
    int r = (mouth == 1) ? 8 : 14;
    fillCircle(400, 256, r, C_LIP);
    fillCircle(400, 258, r - 4, 0x4008);
  }

  textAt(36, 28, 2, 0xFFFF, "AVA");
  textAt(36, 78, 1, 0x7BEF, blink ? "BLINK" : (mouth ? "TALK" : "IDLE"));

  turnId++;
  if ((frame % 5) == 0) {
    const char* pose = blink ? "BLINK" : (mouth ? "TALK" : "IDLE");
    Serial.printf("[tft43] turn_id=%lu state=%s mock=1 w=800 h=480 frame=%lu\\n",
                  (unsigned long)turnId, pose, (unsigned long)frame);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_CS, OUTPUT);
  pinMode(PIN_RST, OUTPUT);
  digitalWrite(PIN_CS, HIGH);
  digitalWrite(PIN_RST, LOW);
  delay(10);
  digitalWrite(PIN_RST, HIGH);
  delay(20);
  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, -1);
  SPI.beginTransaction(SPISettings(4000000, MSBFIRST, SPI_MODE3));
  panelInit();
  paintHuman(0);
  Serial.println("[tft43] state=READY res=800x480 avatar=ava");
}

void loop() {
  static uint32_t frame = 1;
  paintHuman(frame++);
  delay(200);
}
`;

/** ESP32 DevKit 接 4.3 寸 800×480 RA8875，玻璃显示固件画出的像素。 */
export const tft43Examples: ExampleProject[] = [
  {
    id: 'esp32-tft43',
    title: 'ESP32：4.3寸高清屏（800×480）',
    description:
      'RA8875 SPI 模组接到 ESP32。运行后玻璃上是数字人 AVA：会眨眼、转眼、张嘴。像素由控制器画出来。',
    category: 'displays',
    difficulty: 'intermediate',
    boardType: 'esp32',
    boardFilter: 'esp32',
    libraries: [],
    tags: ['esp32', 'tft', 'ra8875', '4.3', '800x480', 'spi', 'display'],
    code: '',
    boards: [{ boardKind: 'esp32', x: 30, y: 70, code: sketch }],
    components: [{ type: 'velxio-tft43', id: 'tft', x: 280, y: 16, properties: {} }],
    wires: [
      { id: 'w_vcc', start: { componentId: 'esp32', pinName: '3V3' }, end: { componentId: 'tft', pinName: 'VCC' }, color: '#ef4444', autoRouted: true },
      { id: 'w_bl', start: { componentId: 'esp32', pinName: '3V3' }, end: { componentId: 'tft', pinName: 'BL' }, color: '#e5e7eb', autoRouted: true },
      { id: 'w_gnd', start: { componentId: 'esp32', pinName: 'GND2' }, end: { componentId: 'tft', pinName: 'GND' }, color: '#111111', autoRouted: true },
      { id: 'w_sck', start: { componentId: 'esp32', pinName: '18' }, end: { componentId: 'tft', pinName: 'SCK' }, color: '#eab308', autoRouted: true },
      { id: 'w_mosi', start: { componentId: 'esp32', pinName: '23' }, end: { componentId: 'tft', pinName: 'MOSI' }, color: '#f97316', autoRouted: true },
      { id: 'w_miso', start: { componentId: 'esp32', pinName: '19' }, end: { componentId: 'tft', pinName: 'MISO' }, color: '#22c55e', autoRouted: true },
      { id: 'w_cs', start: { componentId: 'esp32', pinName: '5' }, end: { componentId: 'tft', pinName: 'CS' }, color: '#38bdf8', autoRouted: true },
      { id: 'w_rst', start: { componentId: 'esp32', pinName: '17' }, end: { componentId: 'tft', pinName: 'RST' }, color: '#ef4444', autoRouted: true },
    ],
  },
];
