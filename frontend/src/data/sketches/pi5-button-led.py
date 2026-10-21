#!/usr/bin/env python3
"""Pi 5: debounced active-low button toggles an LED; mock and live share logic.

BCM17 -> 220 ohm -> LED A; LED C -> GND.
BCM27 -> button 1.l; button 2.l -> GND; 10k pull-up to 3V3.
Default runs a finite mock demonstration. Use --mode live on the Pi.
"""
import argparse
import json
import time

from gpiozero import Button, LED

LED_PIN = 17
BUTTON_PIN = 27
DEBOUNCE_S = 0.05


class ToggleController:
    def __init__(self, factory=None, mock=False):
        self.mock = mock
        self.led = LED(LED_PIN, initial_value=False, pin_factory=factory)
        try:
            self.button = Button(BUTTON_PIN, pull_up=True, bounce_time=None,
                                 pin_factory=factory)
        except Exception:
            self.led.close()
            raise
        self.raw = False
        self.stable = False
        self.changed_at = 0.0
        self.turn_id = 0
        self.log("READY")

    def log(self, state):
        print(json.dumps({"project": "pi5-button-led", "turn_id": self.turn_id,
                          "state": state, "mock": self.mock,
                          "pressed": self.stable, "led": int(self.led.value)},
                         sort_keys=True), flush=True)

    def sample(self, now):
        pressed = self.button.is_pressed
        if pressed != self.raw:
            self.raw = pressed
            self.changed_at = now
        if self.raw != self.stable and now - self.changed_at >= DEBOUNCE_S:
            self.stable = self.raw
            if self.stable:
                self.turn_id += 1
                self.led.toggle()
                self.log("TOGGLE")
            else:
                self.log("RELEASE")
        return int(self.led.value)

    def close(self):
        self.led.off()
        self.log("STOP")
        self.button.close()
        self.led.close()


def demonstrate(controller):
    """Inject real MockPin edges, including bounce and a held button.

    Synthetic monotonic times avoid slow/flaky sleep-based tests. Only the
    pin driver and clock differ from live; sample() and gpiozero devices do not.
    """
    pin = controller.button.pin
    trace = []
    # released, bouncing press, stable press, held, bouncing release, second press
    events = [(0.00, 1), (0.01, 0), (0.02, 1), (0.03, 0),
              (0.10, 0), (0.50, 0), (0.51, 1), (0.52, 0),
              (0.53, 1), (0.60, 1), (0.61, 0), (0.68, 0), (0.90, 0)]
    for now, level in events:
        pin.drive_high() if level else pin.drive_low()
        trace.append({"time_s": now, "button_level": level,
                      "led": controller.sample(now), "turn_id": controller.turn_id})
    expected_led = [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0]
    if [row["led"] for row in trace] != expected_led or controller.turn_id != 2:
        raise RuntimeError("debounce/toggle verification failed: %r" % trace)
    print(json.dumps({"state": "PASS", "engine": "gpiozero-mock",
                      "toggles": controller.turn_id, "trace": trace}), flush=True)
    return trace


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("mock", "live"), default="mock")
    parser.add_argument("--duration", type=float, default=0,
                        help="live run seconds; 0 runs until Ctrl+C")
    args = parser.parse_args()
    if args.duration < 0:
        parser.error("--duration must be >= 0")
    factory = None
    if args.mode == "mock":
        from gpiozero.pins.mock import MockFactory
        factory = MockFactory()
    else:
        # Pi 5 uses lgpio. Never silently fall back to simulated pins on hardware.
        from gpiozero.pins.lgpio import LGPIOFactory
        factory = LGPIOFactory()
    controller = None
    try:
        controller = ToggleController(factory, mock=args.mode == "mock")
        if args.mode == "mock":
            demonstrate(controller)
        else:
            start = time.monotonic()
            while args.duration == 0 or time.monotonic() - start < args.duration:
                controller.sample(time.monotonic())
                time.sleep(0.005)
    except KeyboardInterrupt:
        pass
    finally:
        if controller is not None:
            controller.close()
        factory.close()


if __name__ == "__main__":
    main()
