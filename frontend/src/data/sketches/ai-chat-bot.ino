// ESP32 — AI 对话机器人（Velxio 仿真 / 真机同一状态机）
// 按键 GPIO4 进入 LISTEN；Serial 一行 = 听到的话；GPIO34 麦峰值作能量门。
// OLED 用 Wire 直驱 SSD1306（不依赖 Adafruit，避开本机 AVR 版库的 util/delay.h）。
// 默认 Mock：板内回复。Serial 输入 MODE live 后走 WiFi HTTP（OpenAI 兼容）。
// 日志字段：turn_id / state / mock，便于排查。

#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>

#ifndef AI_MOCK_MODE
#define AI_MOCK_MODE 1
#endif

#define PIN_SDA 21
#define PIN_SCL 22
#define PIN_BTN 4
#define PIN_LED 2
#define PIN_BUZ 15
#define PIN_MIC 34

#define OLED_ADDR 0x3C
#define MIC_DELTA 500
#define LISTEN_MS 8000
#define DEBOUNCE_MS 40

bool oledOk = false;
bool gMock = AI_MOCK_MODE != 0;
int turnId = 0;
int lastBtn = HIGH;
unsigned long btnAt = 0;

String wifiSsid = "Velxio-GUEST";
// 仿真里 llm.local = slirp 网关 192.168.4.2（宿主 /v1/chat/completions）
String llmUrl = "http://192.168.4.2/v1/chat/completions";
String llmKey = "";

enum State { ST_IDLE, ST_LISTEN, ST_THINK, ST_SPEAK };
const char* stateName[] = {"IDLE", "LISTEN", "THINK", "SPEAK"};

// 5x7：0-9 A-Z 空格 / : - ?   LSB 在上。OLED 只显示 ASCII。
static const uint8_t FONT5[][5] = {
  {0x3E,0x51,0x49,0x45,0x3E},{0x00,0x42,0x7F,0x40,0x00},{0x42,0x61,0x51,0x49,0x46},
  {0x21,0x41,0x45,0x4B,0x31},{0x18,0x14,0x12,0x7F,0x10},{0x27,0x45,0x45,0x45,0x39},
  {0x3C,0x4A,0x49,0x49,0x30},{0x01,0x71,0x09,0x05,0x03},{0x36,0x49,0x49,0x49,0x36},
  {0x06,0x49,0x49,0x29,0x1E},{0x7E,0x11,0x11,0x11,0x7E},{0x7F,0x49,0x49,0x49,0x36},
  {0x3E,0x41,0x41,0x41,0x22},{0x7F,0x41,0x41,0x22,0x1C},{0x7F,0x49,0x49,0x49,0x41},
  {0x7F,0x09,0x09,0x09,0x01},{0x3E,0x41,0x49,0x49,0x7A},{0x7F,0x08,0x08,0x08,0x7F},
  {0x00,0x41,0x7F,0x41,0x00},{0x20,0x40,0x41,0x3F,0x01},{0x7F,0x08,0x14,0x22,0x41},
  {0x7F,0x40,0x40,0x40,0x40},{0x7F,0x02,0x0C,0x02,0x7F},{0x7F,0x04,0x08,0x10,0x7F},
  {0x3E,0x41,0x41,0x41,0x3E},{0x7F,0x09,0x09,0x09,0x06},{0x3E,0x41,0x51,0x21,0x5E},
  {0x7F,0x09,0x19,0x29,0x46},{0x46,0x49,0x49,0x49,0x31},{0x01,0x01,0x7F,0x01,0x01},
  {0x3F,0x40,0x40,0x40,0x3F},{0x1F,0x20,0x40,0x20,0x1F},{0x3F,0x40,0x38,0x40,0x3F},
  {0x63,0x14,0x08,0x14,0x63},{0x07,0x08,0x70,0x08,0x07},{0x61,0x51,0x49,0x45,0x43},
  {0x00,0x00,0x00,0x00,0x00},{0x00,0x41,0x22,0x14,0x08},{0x00,0x36,0x36,0x00,0x00},
  {0x08,0x08,0x08,0x08,0x08},{0x02,0x01,0x51,0x09,0x06},
};

int fontIndex(char c) {
  if (c >= 'a' && c <= 'z') c = (char)(c - 32);
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'Z') return 10 + (c - 'A');
  if (c == ' ') return 36;
  if (c == '/') return 37;
  if (c == ':') return 38;
  if (c == '-') return 39;
  return 40;
}

void oledCmd(uint8_t c) {
  Wire.beginTransmission(OLED_ADDR);
  Wire.write(0x00);
  Wire.write(c);
  Wire.endTransmission();
}

void oledBytes(const uint8_t* d, int n) {
  while (n > 0) {
    int chunk = n > 16 ? 16 : n;
    Wire.beginTransmission(OLED_ADDR);
    Wire.write(0x40);
    for (int i = 0; i < chunk; i++) Wire.write(d[i]);
    Wire.endTransmission();
    d += chunk;
    n -= chunk;
  }
}

void oledPos(uint8_t col, uint8_t page) {
  oledCmd(0x21); oledCmd(col); oledCmd(127);
  oledCmd(0x22); oledCmd(page); oledCmd(7);
}

bool oledBegin() {
  Wire.beginTransmission(OLED_ADDR);
  if (Wire.endTransmission() != 0) return false;
  const uint8_t init[] = {
    0xAE, 0x20, 0x00, 0x40, 0xA1, 0xA8, 0x3F, 0xC8,
    0xD3, 0x00, 0xDA, 0x12, 0xD5, 0x80, 0xD9, 0xF1,
    0xDB, 0x30, 0x81, 0xFF, 0xA4, 0xA6, 0x8D, 0x14, 0xAF,
  };
  for (uint8_t c : init) oledCmd(c);
  return true;
}

void oledClear() {
  oledPos(0, 0);
  uint8_t z[16] = {0};
  for (int i = 0; i < 64; i++) oledBytes(z, 16);
}

void oledPrint(uint8_t col, uint8_t page, const char* s) {
  oledPos(col, page);
  while (*s && col <= 122) {
    const uint8_t* g = FONT5[fontIndex(*s++)];
    uint8_t cell[6] = {g[0], g[1], g[2], g[3], g[4], 0};
    oledBytes(cell, 6);
    col += 6;
  }
}

void oledShow(const char* line1, const char* line2, const char* line3) {
  if (!oledOk) return;
  oledClear();
  oledPrint(0, 0, "VELXIO CHAT");
  oledPrint(0, 2, line1);
  oledPrint(0, 4, line2);
  oledPrint(0, 6, line3);
}

void logChat(const char* msg) {
  Serial.printf("[chat] turn_id=%d mock=%d %s\n", turnId, gMock ? 1 : 0, msg);
}

void logState(State st, const char* extra) {
  Serial.printf("[chat] turn_id=%d state=%s mock=%d %s\n",
                turnId, stateName[st], gMock ? 1 : 0, extra);
}

void setLed(bool on) { digitalWrite(PIN_LED, on ? HIGH : LOW); }

void speakBeep(int n) {
  for (int i = 0; i < n; i++) {
    digitalWrite(PIN_BUZ, HIGH);
    delay(45);
    digitalWrite(PIN_BUZ, LOW);
    delay(45);
  }
}

String mockReply(const String& q) {
  String s = q;
  s.toLowerCase();
  if (s.indexOf("hello") >= 0 || s.indexOf("你好") >= 0) {
    return "你好，我是 Velxio 对话机器人。";
  }
  if (s.indexOf("name") >= 0 || s.indexOf("名字") >= 0) {
    return "我叫 Velxio Bot，跑在 ESP32 上。";
  }
  if (s.indexOf("weather") >= 0 || s.indexOf("天气") >= 0) {
    return "仿真里没有气象站，我们先聊天。";
  }
  if (s.indexOf("help") >= 0 || s.indexOf("帮助") >= 0) {
    return "按键说话，或在 Serial 打一行。MODE live 走云端。";
  }
  String out = "收到: ";
  out += q;
  out += " (mock)";
  return out;
}

String liveReply(const String& q) {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(wifiSsid.c_str());
    unsigned long t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 8000) delay(200);
    if (WiFi.status() != WL_CONNECTED) return "WiFi 未连接，回退 mock。";
  }
  HTTPClient http;
  http.begin(llmUrl);
  http.addHeader("Content-Type", "application/json");
  if (llmKey.length()) {
    http.addHeader("Authorization", String("Bearer ") + llmKey);
  }
  String body = "{\"model\":\"mock\",\"messages\":[{\"role\":\"user\",\"content\":\"";
  String esc = q;
  esc.replace("\\", "\\\\");
  esc.replace("\"", "\\\"");
  body += esc;
  body += "\"}]}";
  int code = http.POST(body);
  String resp = http.getString();
  http.end();
  Serial.printf("[chat] turn_id=%d http=%d bytes=%u\n", turnId, code, (unsigned)resp.length());
  int i = resp.indexOf("\"content\"");
  if (i < 0) return code == 200 ? resp.substring(0, 48) : String("HTTP ") + code;
  int colon = resp.indexOf(':', i);
  int q1 = resp.indexOf('"', colon + 1);
  int q2 = resp.indexOf('"', q1 + 1);
  if (q1 < 0 || q2 < 0) return "解析失败";
  return resp.substring(q1 + 1, q2);
}

void trimLine(String& s) {
  s.trim();
  while (s.endsWith("\r")) s.remove(s.length() - 1);
}

bool handleCmd(const String& line) {
  if (line.equalsIgnoreCase("HELP")) {
    Serial.println("[chat] SAY <text> | MODE mock|live | SSID <s> | URL <u> | KEY <k>");
    return true;
  }
  if (line.startsWith("MODE ")) {
    String m = line.substring(5);
    m.trim();
    gMock = !m.equalsIgnoreCase("live");
    logChat(gMock ? "mode=mock" : "mode=live");
    return true;
  }
  if (line.startsWith("SSID ")) { wifiSsid = line.substring(5); wifiSsid.trim(); return true; }
  if (line.startsWith("URL ")) { llmUrl = line.substring(4); llmUrl.trim(); return true; }
  if (line.startsWith("KEY ")) { llmKey = line.substring(4); llmKey.trim(); return true; }
  if (line.startsWith("SAY ")) { return false; }
  return false;
}

String utteranceFrom(const String& line) {
  if (line.startsWith("SAY ")) {
    String u = line.substring(4);
    u.trim();
    return u;
  }
  return line;
}

void doTurn(const String& utter) {
  turnId++;
  if (utter.length() == 0) {
    logState(ST_IDLE, "empty");
    return;
  }
  logState(ST_THINK, utter.c_str());
  setLed(true);
  oledShow("THINK", utter.c_str(), gMock ? "mock" : "live");
  delay(80);
  String ans = gMock ? mockReply(utter) : liveReply(utter);
  logState(ST_SPEAK, ans.c_str());
  oledShow("SPEAK", ans.c_str(), "");
  speakBeep(3 + (int)(ans.length() % 4));
  setLed(false);
  oledShow("IDLE", gMock ? "mock" : "live", "btn / serial");
  logState(ST_IDLE, "done");
}

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(PIN_BTN, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUZ, OUTPUT);
  pinMode(PIN_MIC, INPUT);
  digitalWrite(PIN_LED, LOW);
  digitalWrite(PIN_BUZ, LOW);

  Wire.begin(PIN_SDA, PIN_SCL);
  oledOk = oledBegin();
  if (!oledOk) Serial.println("[chat] oled=fail (serial-only)");
  else Serial.println("[chat] oled=ok");

  oledShow("IDLE", gMock ? "mock" : "live", "btn / serial");
  Serial.println("[chat] ready  mock=1  type HELP  or press GPIO4");
}

void loop() {
  unsigned long now = millis();
  int btn = digitalRead(PIN_BTN);
  if (btn != lastBtn && now - btnAt > DEBOUNCE_MS) {
    btnAt = now;
    lastBtn = btn;
    if (btn == LOW) {
      logState(ST_LISTEN, "button");
      setLed(true);
      oledShow("LISTEN", "speak / serial", "");
      unsigned long t0 = millis();
      bool heardPeak = false;
      int micBase = analogRead(PIN_MIC);
      String line = "";
      while (millis() - t0 < LISTEN_MS) {
        int mic = analogRead(PIN_MIC);
        if (mic > micBase + MIC_DELTA) heardPeak = true;
        if (Serial.available()) {
          line = Serial.readStringUntil('\n');
          trimLine(line);
          break;
        }
        delay(20);
      }
      setLed(false);
      if (line.length() && !handleCmd(line)) {
        doTurn(utteranceFrom(line));
      } else if (heardPeak) {
        doTurn("(sound)");
      } else {
        logState(ST_IDLE, "listen_timeout");
        oledShow("IDLE", "timeout", "btn / serial");
      }
    }
  }

  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    trimLine(line);
    if (!line.length()) return;
    if (handleCmd(line)) return;
    doTurn(utteranceFrom(line));
  }
}
