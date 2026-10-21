import script from './sketches/pi5-button-led.py?raw';
import type { ExampleLike } from '../utils/exampleToVlx';

const board = 'raspberry-pi-5';
function wire(
  id: string,
  from: [string, string],
  to: [string, string],
  color: string,
): ExampleLike['wires'][number] {
  return {
    id,
    start: { componentId: from[0], pinName: from[1] },
    end: { componentId: to[0], pinName: to[1] },
    color,
    autoRouted: true,
  };
}

export const pi5ButtonLed: ExampleLike = {
  id: 'pi5-button-led',
  title: '[Pi 5] 按键切换 LED（消抖）',
  description:
    'GPIO27 按键每次有效按下切换 GPIO17 LED，50ms 消抖。默认运行 Mock 引脚演示；真机运行 python3 main.py --mode live。',
  category: 'basics',
  difficulty: 'beginner',
  boardType: board,
  boardFilter: board,
  tags: ['raspberry pi 5', 'button', 'led', 'gpiozero', 'debounce'],
  libraries: [],
  code: '',
  boards: [{ boardKind: board, x: 60, y: 60, vfsFiles: { 'main.py': script } }],
  components: [
    { type: 'wokwi-resistor', id: 'rled', x: 460, y: 90, properties: { value: '220' } },
    {
      type: 'wokwi-led',
      id: 'led',
      x: 590,
      y: 90,
      properties: { color: 'red', label: '切换指示灯' },
    },
    { type: 'wokwi-resistor', id: 'rpull', x: 450, y: 250, properties: { value: '10000' } },
    {
      type: 'wokwi-pushbutton',
      id: 'btn',
      x: 590,
      y: 270,
      properties: { label: '切换', pressed: false },
    },
  ],
  wires: [
    wire('wledgpio', [board, 'GPIO17'], ['rled', '1'], '#facc15'),
    wire('wledseries', ['rled', '2'], ['led', 'A'], '#facc15'),
    wire('wledgnd', ['led', 'C'], [board, 'GND'], '#111111'),
    wire('wbtninput', [board, 'GPIO27'], ['btn', '1.l'], '#22c55e'),
    wire('wbtngnd', ['btn', '2.l'], [board, 'GND'], '#111111'),
    wire('wpullpower', [board, '3V3'], ['rpull', '1'], '#ef4444'),
    wire('wpullinput', ['rpull', '2'], ['btn', '1.l'], '#22c55e'),
  ],
};
