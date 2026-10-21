#!/usr/bin/env python3
"""Verify the exported firmware and solve its electrical states with real ngspice."""
import argparse
import json
import py_compile
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "cli"
COMMAND = ["node", "--import", "./src/register-vite-raw.mjs", "--import", "tsx", "./src/cli.ts"]


def vx(*args):
    result = subprocess.run(COMMAND + list(args), cwd=CLI, text=True,
                            capture_output=True, timeout=45)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    body = json.loads(result.stdout)
    if body.get("ok") is not True:
        raise RuntimeError("CLI did not succeed: %r" % body)
    return body


def verify(project):
    payload = json.loads(project.read_text())
    validation = vx("circuit", "validate", "-p", str(project))
    compile_result = vx("compile", "-p", str(project))
    if compile_result.get("status") != "ready":
        raise RuntimeError("Expected Python ready, not a binary compilation")
    board = payload["boards"][0]
    source = next(f["content"] for f in payload["fileGroups"][board["activeFileGroupId"]]
                  if f["name"] == "main.py")
    states = []
    with tempfile.TemporaryDirectory(prefix="pi5-button-led-") as directory:
        temp = Path(directory)
        firmware = temp / "main.py"
        firmware.write_text(source)
        py_compile.compile(str(firmware), doraise=True)
        run = subprocess.run([sys.executable, str(firmware), "--mode", "mock"],
                             text=True, capture_output=True, timeout=10)
        if run.returncode:
            raise RuntimeError(run.stdout + run.stderr)
        logs = [json.loads(row) for row in run.stdout.splitlines()]
        scenario = next(row for row in logs if row.get("state") == "PASS")
        if scenario["toggles"] != 2 or logs[-1]["state"] != "STOP" or logs[-1]["led"] != 0:
            raise RuntimeError("Firmware scenario or safe shutdown failed")
        # Replay every distinct electrical state produced by the SAME firmware.
        unique = sorted({(row["button_level"], row["led"]) for row in scenario["trace"]})
        if len(unique) != 4:
            raise RuntimeError("Scenario must cover pressed/released and on/off")
        for button_level, led in unique:
            for component in payload["components"]:
                if component["id"] == "btn":
                    component["properties"]["pressed"] = button_level == 0
            snapshot = temp / ("state-%s-%s.vlx" % (button_level, led))
            snapshot.write_text(json.dumps(payload))
            assertions = ["voltage:vcc_rail>3.29V", "voltage:vcc_rail<3.31V",
                          "voltage:aux_rail_5>4.99V", "voltage:aux_rail_5<5.01V",
                          "voltage:raspberry-pi-5:GPIO27>3V" if button_level else
                          "voltage:raspberry-pi-5:GPIO27<0.01V"]
            if led:
                assertions += ["current:led>3mA", "current:led<10mA",
                               "voltage:raspberry-pi-5:GPIO17>3.29V",
                               "voltage:raspberry-pi-5:GPIO17<3.31V"]
            else:
                assertions += ["abs:current:led<1uA",
                               "abs:voltage:raspberry-pi-5:GPIO17<0.01V"]
            args = ["sim", "spice", "-p", str(snapshot), "--drive", "GPIO17:%s" % led]
            for assertion in assertions:
                args += ["--assert", assertion]
            result = vx(*args)
            if result.get("solved") is not True or result.get("mode") != "live":
                raise RuntimeError("Expected a real SPICE solve")
            states.append({"button_level": button_level, "led": led,
                           "led_current_mA": result["currents"]["v_led_sense"] * 1000,
                           "assertions": result["assertions"]})
    return {"ok": True, "project": str(project),
            "verified_at": datetime.now(timezone.utc).isoformat(),
            "circuit_validation": validation, "cli_compile": compile_result,
            "python_syntax": "passed", "firmware": scenario,
            "electrical_engine": "ngspice", "electrical_states": states,
            "limitations": ["GPIO behavior uses gpiozero MockFactory; no physical Pi was used.",
                            "SPICE snapshots are replayed from the firmware trace, not co-simulation.",
                            "Full Pi QEMU requires qemu-system-aarch64 and a cached boot image."]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path, nargs="?", default=CLI / "fixtures/pi5-button-led.vlx")
    parser.add_argument("--report", type=Path, default=CLI / "logs/pi5-button-led-validation.json")
    opts = parser.parse_args()
    report = verify(opts.project.resolve())
    opts.report.parent.mkdir(parents=True, exist_ok=True)
    opts.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"ok": True, "python_syntax": "passed", "toggles": 2,
                      "real_spice_states": len(report["electrical_states"]),
                      "report": str(opts.report.resolve())}, ensure_ascii=False))
