// ESP32 — 小米音箱耳机孔接 AgentCenter 超级AI（仿真 / 真机同一状态机）
// 蜂鸣器 GPIO15 = 3.5mm 播报（真机换成线路 DAC 进 AUX）。
// 声传感器 GPIO34 = 拾音能量，不从插孔取麦（真机换成 INMP441）。
// Serial 一行 = 语音识别结果。按键 GPIO4 = 按住说话。
// 默认 Mock。MODE live 才 WiFi.begin("Velxio-GUEST")，POST /api/super-ai/device/turn。
// 令牌只经 Serial 的 TOKEN，不进仓库、不进日志正文。
// 日志：turn_id / state / mock / device。

#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>

#ifndef AI_MOCK_MODE
#define AI_MOCK_MODE 1
#endif

#define PIN_SDA 21
#define PIN_SCL 22
#define PIN_PTT 4
#define PIN_LED 2
#define PIN_JACK 15
#define PIN_MIC 34

#define OLED_ADDR 0x3C
#define MIC_DELTA 500
#define LISTEN_MS 8000
#define DEBOUNCE_MS 40
#define POLL_TRIES 4
#define POLL_MS 300

#define DEVICE_ID "xiaomi-living"

bool oledOk = false;
bool gMock = AI_MOCK_MODE != 0;
bool gPending = false;
int turnId = 0;
int lastBtn = HIGH;
unsigned long btnAt = 0;

String wifiSsid = "Velxio-GUEST";
String wifiPass = "";
String cloudUrl = "http://192.168.4.2/api/super-ai/device/turn";
String deviceToken = "";
String workspace = "cyber";
String gPendingPrompt = "";
String gLastTaskId = "";
bool gRespPending = false;

enum State { ST_IDLE, ST_LISTEN, ST_THINK, ST_SPEAK, ST_CONFIRM, ST_POLL };
const char* stateName[] = {"IDLE", "LISTEN", "THINK", "SPEAK", "CONFIRM", "POLL"};

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
  oledPrint(0, 0, "VELXIO SPK");
  oledPrint(0, 2, line1);
  oledPrint(0, 4, line2);
  oledPrint(0, 6, line3);
}

void logSpk(State st, const char* extra) {
  Serial.printf("[spk] turn_id=%d state=%s mock=%d device=%s %s\n",
                turnId, stateName[st], gMock ? 1 : 0, DEVICE_ID, extra);
}

void setLed(bool on) { digitalWrite(PIN_LED, on ? HIGH : LOW); }

void jackBeep(int n) {
  for (int i = 0; i < n; i++) {
    digitalWrite(PIN_JACK, HIGH);
    delay(45);
    digitalWrite(PIN_JACK, LOW);
    delay(45);
  }
}

void showState(State st, const char* ascii) {
  oledShow(stateName[st], ascii, gMock ? "MOCK" : "LIVE");
}

void trimLine(String& s) {
  s.trim();
  while (s.endsWith("\r")) s.remove(s.length() - 1);
}

bool isConfirm(const String& q) {
  return q.equals("确认") || q.equals("执行") || q.equals("做吧") || q.equals("把它做了");
}

bool isCancel(const String& q) {
  return q.equals("取消") || q.equals("算了") || q.equals("不用了") || q.equals("不要");
}

bool wantsHealth(const String& q) {
  return q.indexOf("系统") >= 0 || q.indexOf("健康") >= 0;
}

bool wantsKnow(const String& q) {
  return q.indexOf("什么是") >= 0 || q.indexOf("知识") >= 0;
}

bool wantsSkill(const String& q) {
  return q.indexOf("技能") >= 0;
}

bool wantsTask(const String& q) {
  return q.indexOf("帮我") >= 0 || q.indexOf("建任务") >= 0 || q.indexOf("新建任务") >= 0;
}

String jsonField(const String& resp, const char* key) {
  String pat = String("\"") + key + "\"";
  int i = resp.indexOf(pat);
  if (i < 0) return "";
  int colon = resp.indexOf(':', i + pat.length());
  if (colon < 0) return "";
  int q1 = resp.indexOf('"', colon + 1);
  if (q1 < 0) return "";
  String out;
  for (int k = q1 + 1; k < (int)resp.length(); k++) {
    char c = resp[k];
    if (c == '\\' && k + 1 < (int)resp.length()) {
      out += resp[k + 1];
      k++;
      continue;
    }
    if (c == '"') break;
    out += c;
  }
  return out;
}

bool jsonDone(const String& resp) {
  return resp.indexOf("\"done\":true") >= 0 || resp.indexOf("\"done\": true") >= 0;
}

bool ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  if (wifiPass.length()) WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
  else WiFi.begin(wifiSsid.c_str());
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 8000) delay(200);
  return WiFi.status() == WL_CONNECTED;
}

String buildBody(const String& q) {
  String esc = q;
  esc.replace("\\", "\\\\");
  esc.replace("\"", "\\\"");
  esc.replace("\n", " ");
  String body = "{\"text\":\"";
  body += esc;
  body += "\",\"workspace_slug\":\"";
  body += workspace;
  body += "\",\"channel\":\"voice\"";
  if (gPending) {
    String p = gPendingPrompt;
    p.replace("\\", "\\\\");
    p.replace("\"", "\\\"");
    body += ",\"pending\":{\"action\":\"create_task\",\"prompt\":\"";
    body += p;
    body += "\"}";
  }
  body += "}";
  return body;
}

String pollTask(const String& taskId) {
  logSpk(ST_POLL, taskId.c_str());
  showState(ST_POLL, "TASK");
  String last = "任务仍在执行，稍后再问进度。";
  String base = cloudUrl;
  base.replace("/device/turn", "/device/tasks/");
  String url = base + taskId;
  for (int i = 0; i < POLL_TRIES; i++) {
    HTTPClient http;
    http.begin(url);
    if (deviceToken.length()) http.addHeader("X-Device-Token", deviceToken);
    int code = http.GET();
    String resp = http.getString();
    http.end();
    Serial.printf("[spk] turn_id=%d state=POLL mock=0 device=%s http=%d bytes=%u\n",
                  turnId, DEVICE_ID, code, (unsigned)resp.length());
    String reply = jsonField(resp, "reply");
    if (reply.length()) last = reply;
    if (jsonDone(resp)) return last;
    delay(POLL_MS);
  }
  return last;
}

String liveReply(const String& q) {
  gLastTaskId = "";
  gRespPending = false;
  if (!ensureWifi()) return "WiFi 未连接。";
  HTTPClient http;
  http.begin(cloudUrl);
  http.addHeader("Content-Type", "application/json");
  if (deviceToken.length()) http.addHeader("X-Device-Token", deviceToken);
  int code = http.POST(buildBody(q));
  String resp = http.getString();
  http.end();
  Serial.printf("[spk] turn_id=%d state=THINK mock=0 device=%s http=%d bytes=%u token=%s\n",
                turnId, DEVICE_ID, code, (unsigned)resp.length(),
                deviceToken.length() ? "set" : "empty");
  gLastTaskId = jsonField(resp, "task_id");
  gRespPending = resp.indexOf("create_task") >= 0;
  String reply = jsonField(resp, "reply");
  if (!reply.length()) {
    if (code == 200) return resp.substring(0, 80);
    return String("HTTP ") + code;
  }
  return reply;
}

void finishSpeak(const String& ans) {
  logSpk(ST_SPEAK, ans.c_str());
  showState(ST_SPEAK, "JACK");
  jackBeep(2 + (int)(ans.length() % 3));
  setLed(false);
  showState(ST_IDLE, gPending ? "CONFIRM" : "READY");
  logSpk(ST_IDLE, gPending ? "pending=1" : "done");
}

void doTurn(const String& utter) {
  turnId++;
  if (!utter.length()) {
    logSpk(ST_IDLE, "empty");
    return;
  }
  if (isCancel(utter)) {
    gPending = false;
    gPendingPrompt = "";
    finishSpeak("已取消。");
    return;
  }
  if (isConfirm(utter)) {
    if (!gPending) {
      finishSpeak("没有待确认的任务。");
      return;
    }
    String prompt = gPendingPrompt;
    logSpk(ST_THINK, "confirm");
    setLed(true);
    showState(ST_THINK, "CONFIRM");
    String ans;
    if (gMock) {
      gPending = false;
      gPendingPrompt = "";
      ans = "任务已完成。仿真没有执行器，确认链路已走通。";
    } else {
      ans = liveReply(utter);
      gPending = gRespPending;
      gPendingPrompt = gPending ? prompt : "";
      if (gLastTaskId.length()) ans = pollTask(gLastTaskId);
    }
    finishSpeak(ans);
    return;
  }

  if (gMock) {
    if (wantsHealth(utter)) {
      finishSpeak("协调器正常。语音通道已接通，本机没有执行器。");
      return;
    }
    if (wantsKnow(utter)) {
      finishSpeak("超级AI只收文本。耳机孔负责播报，拾音不走插孔。");
      return;
    }
    if (wantsSkill(utter)) {
      finishSpeak("技能目录在云端。仿真请先问系统是否正常。");
      return;
    }
    if (wantsTask(utter)) {
      gPending = true;
      gPendingPrompt = utter;
      logSpk(ST_CONFIRM, "pending=1");
      showState(ST_CONFIRM, "SAY OK");
      finishSpeak("将交给超级AI建任务。请说确认或取消。");
      return;
    }
    String ans = "收到：";
    ans += utter;
    finishSpeak(ans);
    return;
  }

  logSpk(ST_THINK, utter.c_str());
  setLed(true);
  showState(ST_THINK, "CLOUD");
  String ans = liveReply(utter);
  if (gRespPending) {
    gPending = true;
    gPendingPrompt = utter;
  } else {
    gPending = false;
    gPendingPrompt = "";
  }
  if (gLastTaskId.length()) ans = pollTask(gLastTaskId);
  finishSpeak(ans);
}

bool handleCmd(const String& line) {
  if (line.equalsIgnoreCase("HELP")) {
    Serial.println("[spk] SAY <text> | MODE mock|live | SSID <s> | PASS <p> | URL <u> | TOKEN <t> | WORKSPACE <w>");
    return true;
  }
  if (line.startsWith("MODE ")) {
    String m = line.substring(5);
    m.trim();
    gMock = !m.equalsIgnoreCase("live");
    logSpk(ST_IDLE, gMock ? "mode=mock" : "mode=live");
    showState(ST_IDLE, gMock ? "MOCK" : "LIVE");
    return true;
  }
  if (line.startsWith("SSID ")) { wifiSsid = line.substring(5); wifiSsid.trim(); return true; }
  if (line.startsWith("PASS ")) {
    wifiPass = line.substring(5);
    wifiPass.trim();
    Serial.printf("[spk] turn_id=%d state=IDLE mock=%d device=%s pass=%s\n",
                  turnId, gMock ? 1 : 0, DEVICE_ID, wifiPass.length() ? "set" : "empty");
    return true;
  }
  if (line.startsWith("URL ")) { cloudUrl = line.substring(4); cloudUrl.trim(); return true; }
  if (line.startsWith("TOKEN ")) {
    deviceToken = line.substring(6);
    deviceToken.trim();
    Serial.printf("[spk] turn_id=%d state=IDLE mock=%d device=%s token=%s\n",
                  turnId, gMock ? 1 : 0, DEVICE_ID, deviceToken.length() ? "set" : "empty");
    return true;
  }
  if (line.startsWith("WORKSPACE ")) { workspace = line.substring(10); workspace.trim(); return true; }
  if (line.startsWith("SAY ")) return false;
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

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(PIN_PTT, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_JACK, OUTPUT);
  pinMode(PIN_MIC, INPUT);
  digitalWrite(PIN_LED, LOW);
  digitalWrite(PIN_JACK, LOW);

  Wire.begin(PIN_SDA, PIN_SCL);
  oledOk = oledBegin();
  if (!oledOk) Serial.println("[spk] turn_id=0 state=IDLE mock=1 device=xiaomi-living oled=fail");
  else Serial.println("[spk] turn_id=0 state=IDLE mock=1 device=xiaomi-living oled=ok");

  showState(ST_IDLE, "READY");
  Serial.printf("[spk] turn_id=0 state=IDLE mock=%d device=%s ready jack=gpio15 mic=gpio34\n",
                gMock ? 1 : 0, DEVICE_ID);
}

void loop() {
  unsigned long now = millis();
  int btn = digitalRead(PIN_PTT);
  if (btn != lastBtn && now - btnAt > DEBOUNCE_MS) {
    btnAt = now;
    lastBtn = btn;
    if (btn == LOW) {
      logSpk(ST_LISTEN, "ptt");
      setLed(true);
      showState(ST_LISTEN, "SERIAL");
      unsigned long t0 = millis();
      int micBase = analogRead(PIN_MIC);
      bool heardPeak = false;
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
      } else if (!line.length() && heardPeak) {
        logSpk(ST_IDLE, "mic=1 asr=empty");
        showState(ST_IDLE, "NEED ASR");
      } else if (!line.length()) {
        logSpk(ST_IDLE, "listen_timeout");
        showState(ST_IDLE, "READY");
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
