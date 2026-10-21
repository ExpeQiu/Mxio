// ESP32-CAM — 人脸移动跟随 4DOF 机械臂
// 点画布 Camera 注入 webcam。JPEG → RGB565(160×120) → YCbCr 肤色质心 →
// 偏差驱动基座(左右) / 肩+肘(上下)，把脸锁在画面中心即跟随。
// 仿真与真机同一控制律；真机可把 findFace() 换成 ESP-WHO / 上位机 OpenCV。

#include "esp_camera.h"
#include "img_converters.h"
#include <ESP32Servo.h>

#define PWDN_GPIO_NUM  32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM   0
#define SIOD_GPIO_NUM  26
#define SIOC_GPIO_NUM  27
#define Y9_GPIO_NUM    35
#define Y8_GPIO_NUM    34
#define Y7_GPIO_NUM    39
#define Y6_GPIO_NUM    36
#define Y5_GPIO_NUM    21
#define Y4_GPIO_NUM    19
#define Y3_GPIO_NUM    18
#define Y2_GPIO_NUM     5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM  23
#define PCLK_GPIO_NUM  22

#define PIN_BASE 12
#define PIN_SHLD 13
#define PIN_ELBW 14
#define PIN_GRIP 15
#define PIN_LOCK  2

#define PREVIEW_W 160
#define PREVIEW_H 120
#define MIN_FACE_PX 30
#define DEADZONE_PX 8
#define MAX_STEP_DEG 4
#define LOST_FRAMES 12

static uint8_t rgbBuf[PREVIEW_W * PREVIEW_H * 2];

Servo svBase, svShld, svElbw, svGrip;
int angBase = 90, angShld = 90, angElbw = 90, angGrip = 70;
int filtCx = PREVIEW_W / 2, filtCy = PREVIEW_H / 2;
int lost = LOST_FRAMES;

static bool initCamera() {
  camera_config_t cfg = {};
  cfg.ledc_channel = LEDC_CHANNEL_0;
  cfg.ledc_timer   = LEDC_TIMER_0;
  cfg.pin_d0 = Y2_GPIO_NUM; cfg.pin_d1 = Y3_GPIO_NUM;
  cfg.pin_d2 = Y4_GPIO_NUM; cfg.pin_d3 = Y5_GPIO_NUM;
  cfg.pin_d4 = Y6_GPIO_NUM; cfg.pin_d5 = Y7_GPIO_NUM;
  cfg.pin_d6 = Y8_GPIO_NUM; cfg.pin_d7 = Y9_GPIO_NUM;
  cfg.pin_xclk     = XCLK_GPIO_NUM;
  cfg.pin_pclk     = PCLK_GPIO_NUM;
  cfg.pin_vsync    = VSYNC_GPIO_NUM;
  cfg.pin_href     = HREF_GPIO_NUM;
  cfg.pin_sccb_sda = SIOD_GPIO_NUM;
  cfg.pin_sccb_scl = SIOC_GPIO_NUM;
  cfg.pin_pwdn     = PWDN_GPIO_NUM;
  cfg.pin_reset    = RESET_GPIO_NUM;
  cfg.xclk_freq_hz = 20000000;
  cfg.pixel_format = PIXFORMAT_JPEG;
  cfg.frame_size   = FRAMESIZE_QVGA;
  cfg.jpeg_quality = 12;
  cfg.fb_count     = 1;
  cfg.fb_location  = CAMERA_FB_IN_DRAM;
  return esp_camera_init(&cfg) == ESP_OK;
}

// YCbCr 肤色：室内人脸/手会成团。隔点采样，质心即「脸」位置。
static bool findFace(const uint8_t* rgb, int w, int h, int* cx, int* cy, int* nOut) {
  uint32_t sx = 0, sy = 0;
  int n = 0;
  for (int y = 0; y < h; y += 2) {
    const uint16_t* row = (const uint16_t*)(rgb + y * w * 2);
    for (int x = 0; x < w; x += 2) {
      uint16_t p = row[x];
      int r = ((p >> 11) & 0x1f) << 3;
      int g = ((p >> 5) & 0x3f) << 2;
      int b = (p & 0x1f) << 3;
      int cb = 128 + ((-38 * r - 74 * g + 112 * b) >> 8);
      int cr = 128 + ((112 * r - 94 * g - 18 * b) >> 8);
      if (r > 60 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) {
        sx += (uint32_t)x;
        sy += (uint32_t)y;
        n++;
      }
    }
  }
  if (n < MIN_FACE_PX) return false;
  *cx = (int)(sx / (uint32_t)n);
  *cy = (int)(sy / (uint32_t)n);
  *nOut = n;
  return true;
}

static int stepToward(int err, int span) {
  if (err > -DEADZONE_PX && err < DEADZONE_PX) return 0;
  int s = err * MAX_STEP_DEG / (span / 2);
  if (s > MAX_STEP_DEG) s = MAX_STEP_DEG;
  if (s < -MAX_STEP_DEG) s = -MAX_STEP_DEG;
  return s;
}

static int lerp(int a, int b, int num, int den) {
  return a + (b - a) * num / den;
}

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(PIN_LOCK, OUTPUT);
  digitalWrite(PIN_LOCK, LOW);

  svBase.attach(PIN_BASE, 500, 2400);
  svShld.attach(PIN_SHLD, 500, 2400);
  svElbw.attach(PIN_ELBW, 500, 2400);
  svGrip.attach(PIN_GRIP, 500, 2400);
  svBase.write(angBase);
  svShld.write(angShld);
  svElbw.write(angElbw);
  svGrip.write(angGrip);

  if (!initCamera()) {
    Serial.println("[arm] camera_init FAIL");
    while (1) delay(1000);
  }
  Serial.println("[arm] camera_init OK  face-follow base/shld/elbw");
}

void loop() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    digitalWrite(PIN_LOCK, LOW);
    Serial.println("[arm] no frame");
    delay(80);
    return;
  }

  bool decoded = jpg2rgb565(fb->buf, fb->len, rgbBuf, JPG_SCALE_2X);
  size_t nbytes = fb->len;
  esp_camera_fb_return(fb);

  int cx = 0, cy = 0, nSkin = 0;
  bool found = decoded && findFace(rgbBuf, PREVIEW_W, PREVIEW_H, &cx, &cy, &nSkin);

  if (found) {
    lost = 0;
    filtCx = (filtCx * 3 + cx) / 4;
    filtCy = (filtCy * 3 + cy) / 4;
    int errX = filtCx - PREVIEW_W / 2;
    int errY = filtCy - PREVIEW_H / 2;
    // 脸在画面右侧 → 基座右转；脸在画面下方(y↓) → 肩下俯
    angBase = constrain(angBase + stepToward(errX, PREVIEW_W), 20, 160);
    angShld = constrain(angShld + stepToward(errY, PREVIEW_H), 40, 140);
    angElbw = constrain(90 - (angShld - 90) / 2, 40, 140);
    bool centered = abs(errX) < 16 && abs(errY) < 16;
    angGrip = (centered && nSkin > 80) ? 20 : 70;
    digitalWrite(PIN_LOCK, centered ? HIGH : LOW);
    Serial.printf("[arm] face=1 cx=%d cy=%d n=%d err=%d,%d base=%d shld=%d elbw=%d grip=%d bytes=%u\n",
                  filtCx, filtCy, nSkin, errX, errY, angBase, angShld, angElbw, angGrip,
                  (unsigned)nbytes);
  } else {
    lost++;
    digitalWrite(PIN_LOCK, LOW);
    if (lost > LOST_FRAMES) {
      angBase = lerp(angBase, 90, 1, 8);
      angShld = lerp(angShld, 90, 1, 8);
      angElbw = lerp(angElbw, 90, 1, 8);
      angGrip = 70;
    }
    Serial.printf("[arm] face=0 decode=%d lost=%d base=%d shld=%d bytes=%u\n",
                  decoded ? 1 : 0, lost, angBase, angShld, (unsigned)nbytes);
  }

  svBase.write(angBase);
  svShld.write(angShld);
  svElbw.write(angElbw);
  svGrip.write(angGrip);
  delay(50);
}
