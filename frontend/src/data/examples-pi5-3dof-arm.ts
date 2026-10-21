import type { ExampleLike } from '../utils/exampleToVlx';

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

const SCRIPT = `#!/usr/bin/env python3
# Raspberry Pi 5 — 3DOF swing arm (gpiozero AngularServo)
#
# Pin map (BCM). Hobby-servo pulse 544–2400 µs ↔ 0–180° (same-law as Servo.h).
#   sv_base PWM=GPIO12
#   sv_shld PWM=GPIO13
#   sv_elbw PWM=GPIO18
#   led     GPIO17 → 220Ω → LED anode, cathode → GND
#
# Start the Pi, Upload, then: python3 /home/pi/script.py
# Default: demo sweep. Other: home | wave | demo | pose <base> <shld> <elbw>

from __future__ import print_function

import sys
import time

try:
    from gpiozero import AngularServo, LED
except ImportError:
    AngularServo = None
    LED = None

PINS = {"base": 12, "shld": 13, "elbw": 18}
LED_PIN = 17
HOME = {"base": 90, "shld": 90, "elbw": 90}
PULSE_MIN = 0.000544
PULSE_MAX = 0.0024


def log(turn_id, state, mock, extra=""):
    extra = (" " + extra) if extra else ""
    print(
        "[arm] turn_id=%s state=%s mock=%s%s" % (turn_id, state, mock, extra),
        flush=True,
    )


class MockHorn:
    def __init__(self, pin):
        self.pin = pin
        self.angle = 90

    def close(self):
        pass


class ThreeAxisArm:
    def __init__(self):
        self.mock = 0
        self.turn_id = 0
        self.led = None
        self.servos = {}
        if AngularServo is None:
            self._use_mock("gpiozero missing")
            return
        try:
            for name, pin in PINS.items():
                self.servos[name] = AngularServo(
                    pin,
                    min_angle=0,
                    max_angle=180,
                    min_pulse_width=PULSE_MIN,
                    max_pulse_width=PULSE_MAX,
                    initial_angle=HOME[name],
                )
            if LED is not None:
                self.led = LED(LED_PIN)
        except Exception as err:
            self._use_mock(str(err))

    def _use_mock(self, reason):
        self.mock = 1
        self.servos = {name: MockHorn(pin) for name, pin in PINS.items()}
        self.led = None
        log(0, "INIT", 1, "fallback=%s" % reason.replace(" ", "_"))

    def _flash(self):
        if self.led is None:
            return
        self.led.on()
        time.sleep(0.05)
        self.led.off()

    def pose(self, base, shld, elbw, state="POSE"):
        self.turn_id += 1
        q = {
            "base": max(0, min(180, int(base))),
            "shld": max(0, min(180, int(shld))),
            "elbw": max(0, min(180, int(elbw))),
        }
        for name, angle in q.items():
            try:
                self.servos[name].angle = angle
            except Exception:
                pass
        self._flash()
        log(
            self.turn_id,
            state,
            self.mock,
            "base=%s shld=%s elbw=%s" % (q["base"], q["shld"], q["elbw"]),
        )
        return q

    def home(self):
        return self.pose(HOME["base"], HOME["shld"], HOME["elbw"], "HOME")

    def wave(self):
        log(self.turn_id, "WAVE", self.mock, "start")
        self.home()
        for elbw in (40, 140, 40, 140, 90):
            self.pose(90, 70, elbw, "WAVE")
            time.sleep(0.25)
        return self.home()

    def demo(self):
        log(self.turn_id, "DEMO", self.mock, "start")
        path = (
            (90, 90, 90),
            (45, 60, 120),
            (135, 60, 120),
            (90, 30, 150),
            (90, 120, 40),
            (90, 90, 90),
        )
        for base, shld, elbw in path:
            self.pose(base, shld, elbw, "DEMO")
            time.sleep(0.4)
        return self.home()

    def close(self):
        for sv in self.servos.values():
            try:
                sv.close()
            except Exception:
                pass
        if self.led is not None:
            try:
                self.led.close()
            except Exception:
                pass


def parse_pose(parts):
    if len(parts) < 4:
        return None
    try:
        return int(parts[1]), int(parts[2]), int(parts[3])
    except ValueError:
        return None


def handle(arm, raw):
    line = raw.strip().lower()
    if not line:
        return True
    parts = line.split()
    cmd = parts[0]
    if cmd in ("home", "h"):
        arm.home()
    elif cmd in ("wave", "w"):
        arm.wave()
    elif cmd in ("demo", "d"):
        arm.demo()
    elif cmd in ("pose", "p", "q"):
        angles = parse_pose(parts)
        if angles is None:
            log(arm.turn_id, "ERR", arm.mock, "need=pose_base_shld_elbw")
        else:
            arm.pose(*angles)
    elif cmd in ("quit", "exit"):
        return False
    else:
        log(arm.turn_id, "ERR", arm.mock, "unknown=%s" % cmd)
    return True


def main():
    action = sys.argv[1].lower() if len(sys.argv) > 1 else "demo"
    arm = ThreeAxisArm()
    log(0, "READY", arm.mock, "cmd=home|wave|demo|pose")
    try:
        if action == "demo":
            arm.demo()
        elif action == "wave":
            arm.wave()
        elif action == "home":
            arm.home()
        elif action == "pose":
            angles = parse_pose(sys.argv[1:])
            if angles:
                arm.pose(*angles)
            else:
                arm.home()
        else:
            log(0, "ERR", arm.mock, "unknown=%s" % action)
            arm.home()
        if sys.stdin.isatty() or action == "demo":
            print("[arm] waiting serial: home|wave|demo|pose <b> <s> <e>", flush=True)
            for raw in sys.stdin:
                if not handle(arm, raw):
                    break
    except KeyboardInterrupt:
        log(arm.turn_id, "STOP", arm.mock, "interrupted")
    finally:
        arm.close()


if __name__ == "__main__":
    main()
`;

/** Raspberry Pi 5 + 三轴舵机摆臂：基座/肩/肘，Serial 指令驱动，3Dm kit=arm-3dof。 */
export const pi53dofArm: ExampleLike = {
  id: 'pi5-3dof-arm',
  title: '[Pi 5] 三轴机械摆臂',
  description:
    'Raspberry Pi 5 用 GPIO12/13/18 PWM 驱动基座/肩/肘三只舵机。Start the Pi，Upload，运行 python3 /home/pi/script.py（默认摆臂演示；可跟 home|wave|demo|pose 90 60 120）。',
  category: 'robotics',
  difficulty: 'intermediate',
  boardType: 'raspberry-pi-5',
  boardFilter: 'raspberry-pi-5',
  tags: ['raspberry pi 5', 'robotics', 'servo', 'arm', '3dof', 'gpiozero'],
  code: '',
  boards: [
    {
      boardKind: 'raspberry-pi-5',
      x: 40,
      y: 80,
      vfsFiles: { 'script.py': SCRIPT },
    },
  ],
  components: [
    { type: 'velxio-servo', id: 'sv_base', x: 400, y: 40, properties: { horn: 'single', label: '基座' } },
    { type: 'velxio-servo', id: 'sv_shld', x: 580, y: 40, properties: { horn: 'single', label: '肩' } },
    { type: 'velxio-servo', id: 'sv_elbw', x: 400, y: 170, properties: { horn: 'single', label: '肘' } },
    { type: 'wokwi-resistor', id: 'rled', x: 40, y: 320, properties: { value: '220' } },
    { type: 'wokwi-led', id: 'ledok', x: 40, y: 390, properties: { color: 'red' } },
  ],
  wires: [
    w('w_base_pwm', ['raspberry-pi-5', 'GPIO12'], ['sv_base', 'PWM'], '#22c55e'),
    w('w_shld_pwm', ['raspberry-pi-5', 'GPIO13'], ['sv_shld', 'PWM'], '#38bdf8'),
    w('w_elbw_pwm', ['raspberry-pi-5', 'GPIO18'], ['sv_elbw', 'PWM'], '#a855f7'),
    w('w_base_vcc', ['raspberry-pi-5', '5V'], ['sv_base', 'V+'], '#ef4444'),
    w('w_shld_vcc', ['raspberry-pi-5', '5V'], ['sv_shld', 'V+'], '#ef4444'),
    w('w_elbw_vcc', ['raspberry-pi-5', '5V'], ['sv_elbw', 'V+'], '#ef4444'),
    w('w_base_gnd', ['raspberry-pi-5', 'GND'], ['sv_base', 'GND'], '#111111'),
    w('w_shld_gnd', ['raspberry-pi-5', 'GND'], ['sv_shld', 'GND'], '#111111'),
    w('w_elbw_gnd', ['raspberry-pi-5', 'GND'], ['sv_elbw', 'GND'], '#111111'),
    w('w_led_gpio', ['raspberry-pi-5', 'GPIO17'], ['rled', '1'], '#facc15'),
    w('w_led_r', ['rled', '2'], ['ledok', 'A'], '#facc15'),
    w('w_led_gnd', ['ledok', 'C'], ['raspberry-pi-5', 'GND'], '#111111'),
  ],
};
