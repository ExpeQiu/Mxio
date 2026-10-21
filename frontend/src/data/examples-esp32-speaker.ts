import type { ExampleLike } from '../utils/exampleToVlx';
import sketch from './sketches/speaker-agent.ino?raw';

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

/** 小米音箱耳机孔接超级AI：蜂鸣器代替插孔播报，声传感器只做能量门，Serial 即 ASR。 */
export const esp32SpeakerAgent: ExampleLike = {
  id: 'esp32-speaker-agent',
  title: 'ESP32：小米音箱耳机孔接超级AI（仿真）',
  description:
    '蜂鸣器代替 3.5mm 播报，声传感器做拾音能量（不从插孔取麦）。Serial 一行即识别文本，默认 Mock 超级AI；MODE live 调用 /api/super-ai/device/turn。',
  category: 'robotics',
  difficulty: 'intermediate',
  boardType: 'esp32',
  boardFilter: 'esp32',
  tags: ['esp32', 'speaker', 'agentcenter', 'buzzer', 'sound', 'mock'],
  libraries: [],
  code: '',
  boards: [
    {
      boardKind: 'esp32',
      x: 280,
      y: 120,
      files: [{ name: 'sketch.ino', content: sketch }],
    },
  ],
  components: [
    // 左侧：GPIO34 与左侧 GND。麦的模拟脚对着板子左排。
    { type: 'wokwi-big-sound-sensor', id: 'mic', x: 20, y: 150, properties: {} },
    // 右侧按排针从上到下：22/21 屏，4 按键，2 灯，15 蜂鸣器。地回到右侧 GND2。
    { type: 'velxio-ssd1306-i2c-4pin', id: 'oled', x: 500, y: 40, properties: {} },
    { type: 'wokwi-pushbutton', id: 'ptt', x: 520, y: 220, properties: { color: 'green', label: '说话' } },
    { type: 'wokwi-resistor', id: 'rled', x: 680, y: 250, properties: { value: '220' } },
    { type: 'wokwi-led', id: 'ledok', x: 790, y: 230, properties: { color: 'blue' } },
    { type: 'wokwi-buzzer', id: 'jack', x: 520, y: 360, properties: {} },
  ],
  wires: [
    w('w_oled_vcc', ['esp32', '3V3'], ['oled', 'VCC'], '#ef4444'),
    w('w_oled_gnd', ['esp32', 'GND2'], ['oled', 'GND'], '#111111'),
    w('w_oled_sda', ['esp32', '21'], ['oled', 'SDA'], '#38bdf8'),
    w('w_oled_scl', ['esp32', '22'], ['oled', 'SCL'], '#f97316'),
    w('w_ptt_gpio', ['esp32', '4'], ['ptt', '1.l'], '#22c55e'),
    w('w_ptt_gnd', ['ptt', '2.l'], ['esp32', 'GND2'], '#111111'),
    w('w_led_gpio', ['esp32', '2'], ['rled', '1'], '#60a5fa'),
    w('w_led_r', ['rled', '2'], ['ledok', 'A'], '#60a5fa'),
    w('w_led_gnd', ['ledok', 'C'], ['esp32', 'GND2'], '#111111'),
    w('w_jack_sig', ['esp32', '15'], ['jack', '1'], '#a855f7'),
    w('w_jack_gnd', ['jack', '2'], ['esp32', 'GND2'], '#111111'),
    w('w_mic_vcc', ['esp32', '3V3'], ['mic', 'VCC'], '#ef4444'),
    w('w_mic_gnd', ['mic', 'GND'], ['esp32', 'GND'], '#111111'),
    w('w_mic_aout', ['mic', 'AOUT'], ['esp32', '34'], '#eab308'),
  ],
};
