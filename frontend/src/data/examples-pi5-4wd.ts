import type { ExampleLike } from '../utils/exampleToVlx';

/** Node-safe 4WD example (no Vite ?raw). Imported by the gallery and the CLI. */
export const pi54wdCar: ExampleLike = {
    id: 'pi5-4wd-car',
    title: '[Pi 5] 四轮小车 (2× L293D)',
    description:
      'Raspberry Pi 5 通过两片 L293D 驱动四个可视直流电机（前左/前右/后左/后右）。Start the Pi，Upload，然后运行 python3 /home/pi/script.py（默认持续前进；可跟 forward|back|left|right|stop|demo）。',
    category: 'robotics',
    difficulty: 'intermediate',
    boardType: 'raspberry-pi-5',
    boardFilter: 'raspberry-pi-5',
    tags: ['raspberry pi 5', 'robotics', '4wd', 'car', 'l293d', 'motor', 'gpiozero'],
    code: '',
    boards: [
      {
        boardKind: 'raspberry-pi-5',
        x: 40,
        y: 80,
        vfsFiles: {
          'script.py': `#!/usr/bin/env python3
# Raspberry Pi 5 — 4WD car (2x L293D)
#
# Pin map (BCM). EN pins are tied HIGH to 5V on the canvas.
#   FL  IN1=GPIO17  IN2=GPIO27
#   RL  IN3=GPIO23  IN4=GPIO24
#   FR  IN1=GPIO5   IN2=GPIO6
#   RR  IN3=GPIO16  IN4=GPIO13
#
# Pi GPIO PWM is not simulated — Motor(..., pwm=False) uses digital pins.
# Default: forward forever. Other:
#   python3 /home/pi/script.py forward|back|left|right|stop|demo

from gpiozero import Motor
from signal import pause
from time import sleep
import sys

PINS = {
    "fl": (17, 27),
    "fr": (5, 6),
    "rl": (23, 24),
    "rr": (16, 13),
}


class FourWD:
    """Tank-steer 4WD: left pair vs right pair."""

    def __init__(self):
        self.wheels = {
            name: Motor(forward=fwd, backward=back, pwm=False)
            for name, (fwd, back) in PINS.items()
        }

    def _apply(self, action, fl, fr, rl, rr):
        cmds = {"fl": fl, "fr": fr, "rl": rl, "rr": rr}
        for name, direction in cmds.items():
            motor = self.wheels[name]
            if direction > 0:
                motor.forward()
            elif direction < 0:
                motor.backward()
            else:
                motor.stop()
        print(
            "[4wd] action=%s fl=%+d fr=%+d rl=%+d rr=%+d" % (action, fl, fr, rl, rr),
            flush=True,
        )

    def forward(self):
        self._apply("forward", 1, 1, 1, 1)

    def back(self):
        self._apply("back", -1, -1, -1, -1)

    def left(self):
        self._apply("left", -1, 1, -1, 1)

    def right(self):
        self._apply("right", 1, -1, 1, -1)

    def stop(self):
        self._apply("stop", 0, 0, 0, 0)

    def close(self):
        self.stop()
        for motor in self.wheels.values():
            motor.close()


def demo(car):
    for fn, dt in (
        (car.forward, 2.0),
        (car.left, 1.0),
        (car.forward, 2.0),
        (car.right, 1.0),
        (car.back, 1.5),
        (car.stop, 0.2),
    ):
        fn()
        sleep(dt)


def main():
    action = sys.argv[1].lower() if len(sys.argv) > 1 else "forward"
    car = FourWD()
    try:
        if action == "demo":
            demo(car)
            return
        fn = getattr(car, action, None)
        if fn is None:
            print(
                "[4wd] unknown action=%s (forward|back|left|right|stop|demo)" % action,
                flush=True,
            )
            return
        fn()
        if action != "stop":
            pause()
    except KeyboardInterrupt:
        print("[4wd] interrupted", flush=True)
    finally:
        car.close()


if __name__ == "__main__":
    main()
`,
        },
      },
    ],
    components: [
      { type: 'velxio-motor-driver-l293d', id: 'drv_l', x: 400, y: 40, properties: {} },
      { type: 'velxio-motor-driver-l293d', id: 'drv_r', x: 400, y: 280, properties: {} },
      { type: 'velxio-dc-motor', id: 'm_fl', x: 580, y: 10, properties: { value: '5' } },
      { type: 'velxio-dc-motor', id: 'm_rl', x: 580, y: 140, properties: { value: '5' } },
      { type: 'velxio-dc-motor', id: 'm_fr', x: 580, y: 270, properties: { value: '5' } },
      { type: 'velxio-dc-motor', id: 'm_rr', x: 580, y: 400, properties: { value: '5' } },
      { type: 'wokwi-battery-9v', id: 'bat9', x: 40, y: 360, properties: {} },
    ],
    wires: [
      // Left driver — FL (ch1) + RL (ch2)
      { id: 'w_fl_in1', start: { componentId: 'raspberry-pi-5', pinName: 'GPIO17' }, end: { componentId: 'drv_l', pinName: 'IN1' }, color: '#22c55e' },
      { id: 'w_fl_in2', start: { componentId: 'raspberry-pi-5', pinName: 'GPIO27' }, end: { componentId: 'drv_l', pinName: 'IN2' }, color: '#22c55e' },
      { id: 'w_rl_in3', start: { componentId: 'raspberry-pi-5', pinName: 'GPIO23' }, end: { componentId: 'drv_l', pinName: 'IN3' }, color: '#38bdf8' },
      { id: 'w_rl_in4', start: { componentId: 'raspberry-pi-5', pinName: 'GPIO24' }, end: { componentId: 'drv_l', pinName: 'IN4' }, color: '#38bdf8' },
      { id: 'w_l_en1', start: { componentId: 'raspberry-pi-5', pinName: '5V' }, end: { componentId: 'drv_l', pinName: 'EN1' }, color: '#ef4444' },
      { id: 'w_l_en2', start: { componentId: 'raspberry-pi-5', pinName: '5V' }, end: { componentId: 'drv_l', pinName: 'EN2' }, color: '#ef4444' },
      { id: 'w_m_fl_a', start: { componentId: 'drv_l', pinName: 'OUT1' }, end: { componentId: 'm_fl', pinName: '1' }, color: '#f97316' },
      { id: 'w_m_fl_b', start: { componentId: 'drv_l', pinName: 'OUT2' }, end: { componentId: 'm_fl', pinName: '2' }, color: '#f97316' },
      { id: 'w_m_rl_a', start: { componentId: 'drv_l', pinName: 'OUT3' }, end: { componentId: 'm_rl', pinName: '1' }, color: '#a855f7' },
      { id: 'w_m_rl_b', start: { componentId: 'drv_l', pinName: 'OUT4' }, end: { componentId: 'm_rl', pinName: '2' }, color: '#a855f7' },
      // Right driver — FR (ch1) + RR (ch2)
      { id: 'w_fr_in1', start: { componentId: 'raspberry-pi-5', pinName: 'GPIO5' }, end: { componentId: 'drv_r', pinName: 'IN1' }, color: '#22c55e' },
      { id: 'w_fr_in2', start: { componentId: 'raspberry-pi-5', pinName: 'GPIO6' }, end: { componentId: 'drv_r', pinName: 'IN2' }, color: '#22c55e' },
      { id: 'w_rr_in3', start: { componentId: 'raspberry-pi-5', pinName: 'GPIO16' }, end: { componentId: 'drv_r', pinName: 'IN3' }, color: '#38bdf8' },
      { id: 'w_rr_in4', start: { componentId: 'raspberry-pi-5', pinName: 'GPIO13' }, end: { componentId: 'drv_r', pinName: 'IN4' }, color: '#38bdf8' },
      { id: 'w_r_en1', start: { componentId: 'raspberry-pi-5', pinName: '5V' }, end: { componentId: 'drv_r', pinName: 'EN1' }, color: '#ef4444' },
      { id: 'w_r_en2', start: { componentId: 'raspberry-pi-5', pinName: '5V' }, end: { componentId: 'drv_r', pinName: 'EN2' }, color: '#ef4444' },
      { id: 'w_m_fr_a', start: { componentId: 'drv_r', pinName: 'OUT1' }, end: { componentId: 'm_fr', pinName: '1' }, color: '#f97316' },
      { id: 'w_m_fr_b', start: { componentId: 'drv_r', pinName: 'OUT2' }, end: { componentId: 'm_fr', pinName: '2' }, color: '#f97316' },
      { id: 'w_m_rr_a', start: { componentId: 'drv_r', pinName: 'OUT3' }, end: { componentId: 'm_rr', pinName: '1' }, color: '#a855f7' },
      { id: 'w_m_rr_b', start: { componentId: 'drv_r', pinName: 'OUT4' }, end: { componentId: 'm_rr', pinName: '2' }, color: '#a855f7' },
      // Power: logic 5V, motor 9V, common GND
      { id: 'w_vcc1_l', start: { componentId: 'raspberry-pi-5', pinName: '5V' }, end: { componentId: 'drv_l', pinName: 'VCC1' }, color: '#ef4444' },
      { id: 'w_vcc1_r', start: { componentId: 'raspberry-pi-5', pinName: '5V' }, end: { componentId: 'drv_r', pinName: 'VCC1' }, color: '#ef4444' },
      { id: 'w_vm_l', start: { componentId: 'bat9', pinName: '+' }, end: { componentId: 'drv_l', pinName: 'VCC2' }, color: '#facc15' },
      { id: 'w_vm_r', start: { componentId: 'bat9', pinName: '+' }, end: { componentId: 'drv_r', pinName: 'VCC2' }, color: '#facc15' },
      { id: 'w_gnd_l', start: { componentId: 'drv_l', pinName: 'GND.1' }, end: { componentId: 'raspberry-pi-5', pinName: 'GND' }, color: '#000000' },
      { id: 'w_gnd_r', start: { componentId: 'drv_r', pinName: 'GND.1' }, end: { componentId: 'raspberry-pi-5', pinName: 'GND' }, color: '#000000' },
      { id: 'w_gnd_bat', start: { componentId: 'bat9', pinName: '−' }, end: { componentId: 'raspberry-pi-5', pinName: 'GND' }, color: '#000000' },
    ],
  };
