import type { ExampleLike } from '../utils/exampleToVlx';
import sketch from './sketches/ai-chat-bot.ino?raw';

function w(
  id: string,
  start: [string, string],
  end: [string, string],
  color: string,
): ExampleLike['wires'][number] {
  return {
    id,
    start: { componentId: start[0], pinName: start[1] },
    end: { componentId: end[0], pinName: end[1] },
    color,
    autoRouted: true,
  };
}

/** ESP32 对话机器人：OLED 状态 + 按键 PTT + 声传感器 + LED + 蜂鸣器。Serial 即文本 ASR。 */
export const esp32AiChat: ExampleLike = {
  id: 'esp32-ai-chat',
  title: 'ESP32: AI 对话机器人（Mock 优先）',
  description:
    '按键进入聆听，Serial 一行即用户话；OLED 显示状态，蜂鸣器播报。默认板内 Mock 回复，MODE live 走 WiFi HTTP。',
  category: 'robotics',
  difficulty: 'intermediate',
  boardType: 'esp32',
  boardFilter: 'esp32',
  tags: ['esp32', 'ai', 'chat', 'oled', 'buzzer', 'sound', 'mock'],
  libraries: [],
  code: '',
  boards: [
    {
      boardKind: 'esp32',
      x: 80,
      y: 80,
      files: [{ name: 'sketch.ino', content: sketch }],
    },
  ],
  components: [
    { type: 'velxio-ssd1306-i2c-4pin', id: 'oled', x: 420, y: 40, properties: {} },
    { type: 'wokwi-pushbutton', id: 'btn', x: 420, y: 180, properties: { color: 'green', label: '说话' } },
    { type: 'wokwi-led', id: 'ledok', x: 40, y: 280, properties: { color: 'blue' } },
    { type: 'wokwi-resistor', id: 'rled', x: 40, y: 210, properties: { value: '220' } },
    { type: 'wokwi-buzzer', id: 'buz', x: 560, y: 180, properties: {} },
    { type: 'wokwi-big-sound-sensor', id: 'mic', x: 560, y: 40, properties: {} },
  ],
  wires: [
    w('w_oled_vcc', ['esp32', '3V3'], ['oled', 'VCC'], '#ef4444'),
    w('w_oled_gnd', ['esp32', 'GND'], ['oled', 'GND'], '#111111'),
    w('w_oled_sda', ['esp32', '21'], ['oled', 'SDA'], '#38bdf8'),
    w('w_oled_scl', ['esp32', '22'], ['oled', 'SCL'], '#f97316'),
    w('w_btn_gpio', ['esp32', '4'], ['btn', '1.l'], '#22c55e'),
    w('w_btn_gnd', ['btn', '2.l'], ['esp32', 'GND'], '#111111'),
    w('w_led_gpio', ['esp32', '2'], ['rled', '1'], '#60a5fa'),
    w('w_led_r', ['rled', '2'], ['ledok', 'A'], '#60a5fa'),
    w('w_led_gnd', ['ledok', 'C'], ['esp32', 'GND'], '#111111'),
    w('w_buz_sig', ['esp32', '15'], ['buz', '1'], '#a855f7'),
    w('w_buz_gnd', ['buz', '2'], ['esp32', 'GND'], '#111111'),
    w('w_mic_vcc', ['esp32', '3V3'], ['mic', 'VCC'], '#ef4444'),
    w('w_mic_gnd', ['mic', 'GND'], ['esp32', 'GND'], '#111111'),
    w('w_mic_aout', ['mic', 'AOUT'], ['esp32', '34'], '#eab308'),
  ],
};
