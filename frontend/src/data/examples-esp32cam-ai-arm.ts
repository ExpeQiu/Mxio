import type { ExampleLike } from '../utils/exampleToVlx';
import sketch from './sketches/ai-vision-arm.ino?raw';

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

/** ESP32-CAM 人脸跟随 4DOF 臂：左锁定 LED，右四舵机。GPIO12/13/14/15 PWM，GPIO2 LED。 */
export const esp32camAiArm: ExampleLike = {
  id: 'esp32cam-ai-arm',
  title: 'ESP32-CAM: AI 视觉机械臂（人脸跟随）',
  description:
    '板载 OV2640 取流，肤色质心偏差驱动基座/肩/肘。打开后弹出视觉窗口，借用电脑摄像头。',
  category: 'robotics',
  difficulty: 'intermediate',
  boardType: 'esp32-cam',
  boardFilter: 'esp32-cam',
  tags: ['esp32-cam', 'servo', 'vision', 'robotics', 'face'],
  libraries: ['ESP32Servo'],
  code: '',
  boards: [
    {
      boardKind: 'esp32-cam',
      x: 240,
      y: 80,
      files: [{ name: 'sketch.ino', content: sketch }],
    },
  ],
  components: [
    { type: 'velxio-servo', id: 'sv_base', x: 390, y: 70, properties: { horn: 'single', label: '基座' } },
    { type: 'velxio-servo', id: 'sv_shld', x: 555, y: 70, properties: { horn: 'single', label: '肩' } },
    { type: 'velxio-servo', id: 'sv_elbw', x: 390, y: 170, properties: { horn: 'single', label: '肘' } },
    { type: 'velxio-servo', id: 'sv_grip', x: 555, y: 170, properties: { horn: 'single', label: '夹爪' } },
    { type: 'wokwi-resistor', id: 'rled', x: 40, y: 200, properties: { value: '220' } },
    { type: 'wokwi-led', id: 'led_ok', x: 40, y: 270, properties: { color: 'red' } },
  ],
  wires: [
    w('w_base_pwm', ['esp32-cam', '12'], ['sv_base', 'PWM'], '#22c55e'),
    w('w_shld_pwm', ['esp32-cam', '13'], ['sv_shld', 'PWM'], '#38bdf8'),
    w('w_elbw_pwm', ['esp32-cam', '14'], ['sv_elbw', 'PWM'], '#a855f7'),
    w('w_grip_pwm', ['esp32-cam', '15'], ['sv_grip', 'PWM'], '#f97316'),
    w('w_base_vcc', ['esp32-cam', '5V.1'], ['sv_base', 'V+'], '#ef4444'),
    w('w_shld_vcc', ['esp32-cam', '5V.1'], ['sv_shld', 'V+'], '#ef4444'),
    w('w_elbw_vcc', ['esp32-cam', '5V.1'], ['sv_elbw', 'V+'], '#ef4444'),
    w('w_grip_vcc', ['esp32-cam', '5V.1'], ['sv_grip', 'V+'], '#ef4444'),
    w('w_base_gnd', ['esp32-cam', 'GND.1'], ['sv_base', 'GND'], '#111111'),
    w('w_shld_gnd', ['esp32-cam', 'GND.1'], ['sv_shld', 'GND'], '#111111'),
    w('w_elbw_gnd', ['esp32-cam', 'GND.1'], ['sv_elbw', 'GND'], '#111111'),
    w('w_grip_gnd', ['esp32-cam', 'GND.1'], ['sv_grip', 'GND'], '#111111'),
    w('w_led_gpio', ['esp32-cam', '2'], ['rled', '1'], '#facc15'),
    w('w_led_r', ['rled', '2'], ['led_ok', 'A'], '#facc15'),
    w('w_led_gnd', ['led_ok', 'C'], ['esp32-cam', 'GND.1'], '#111111'),
  ],
};
