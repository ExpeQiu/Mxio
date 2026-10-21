"""Codex 电路设计：只从元件目录选型，并套用已验证的接线规则。"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger("velxio.hwexec")

_METADATA = (
    Path(__file__).resolve().parents[3] / "frontend" / "public" / "components-metadata.json"
)

# 与 cli/src/catalog/index.ts 的 FALLBACK_PINS 对齐。元数据里没有 pins 时用这张表。
FALLBACK_PINS: dict[str, list[str]] = {
    "led": ["A", "C"],
    "resistor": ["1", "2"],
    "pushbutton": ["1.l", "1.r", "2.l", "2.r"],
    "servo": ["PWM", "V+", "GND"],
    "ssd1306-i2c-4pin": ["GND", "VCC", "SCL", "SDA"],
    "buzzer": ["1", "2"],
}

BOARDS: dict[str, dict[str, Any]] = {
    "esp32": {
        "fqbn": "esp32:esp32:esp32",
        "gnd": ["GND"],
        "vcc": ["3V3", "5V"],
        "gpio": [str(i) for i in range(40)],
        "i2c": ("21", "22"),
        "default_led": "2",
        "sketch": "ino",
    },
    "esp32-c3": {
        "fqbn": "esp32:esp32:esp32c3",
        "gnd": ["GND"],
        "vcc": ["3V3", "5V"],
        "gpio": [str(i) for i in range(22)],
        "i2c": ("8", "9"),
        "default_led": "8",
        "sketch": "ino",
    },
    "arduino-uno": {
        "fqbn": "arduino:avr:uno",
        "gnd": ["GND"],
        "vcc": ["5V", "3.3V"],
        "gpio": [str(i) for i in range(14)] + [f"A{i}" for i in range(6)],
        "i2c": ("A4", "A5"),
        "default_led": "13",
        "sketch": "ino",
    },
    "raspberry-pi-5": {
        "fqbn": None,
        "gnd": ["GND"],
        "vcc": ["3V3", "5V"],
        "gpio": [str(n) for n in (2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27)],
        "i2c": ("2", "3"),
        "default_led": "17",
        "sketch": "py",
    },
}

_ALIASES = {
    "uno": "arduino-uno",
    "pi": "raspberry-pi-5",
    "pi5": "raspberry-pi-5",
    "esp32cam": "esp32",
    "esp32-cam": "esp32",
}


def _load_parts() -> list[dict[str, Any]]:
    if not _METADATA.is_file():
        logger.error("元件目录不存在 path=%s", _METADATA)
        return []
    raw = json.loads(_METADATA.read_text(encoding="utf-8"))
    parts = []
    for item in raw.get("components") or []:
        pins = item.get("pins") or FALLBACK_PINS.get(item.get("id", ""))
        parts.append(
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "category": item.get("category"),
                "description": item.get("description") or "",
                "tags": item.get("tags") or [],
                "pins": pins,
            }
        )
    return parts


def search_parts(query: str, limit: int = 8) -> dict[str, Any]:
    """按 id、名称、标签搜索目录，不返回缩略图。"""
    needle = query.strip().lower()
    if not needle:
        return {"ok": False, "error": "查询词为空", "parts": []}
    ranked: list[tuple[int, dict[str, Any]]] = []
    for part in _load_parts():
        ident = str(part["id"]).lower()
        name = str(part["name"]).lower()
        blob = " ".join(
            [ident, name, str(part["description"]), " ".join(part["tags"])]
        ).lower()
        if needle not in blob:
            continue
        if ident == needle:
            rank = 0
        elif ident.startswith(needle):
            rank = 1
        elif name.startswith(needle):
            rank = 2
        else:
            rank = 3
        ranked.append((rank, part))
    ranked.sort(key=lambda item: (item[0], str(item[1]["id"])))
    found = [part for _rank, part in ranked[: max(1, min(limit, 20))]]
    logger.info("元件搜索 query=%s hits=%d", query, len(found))
    return {"ok": True, "query": query, "parts": found}


def _board(name: str) -> dict[str, Any] | None:
    key = _ALIASES.get(name.strip().lower(), name.strip().lower())
    spec = BOARDS.get(key)
    if spec is None:
        return None
    return {"id": key, **spec}


def _pin_ok(board: dict[str, Any], pin: str) -> bool:
    return pin in board["gnd"] or pin in board["vcc"] or pin in board["gpio"]


def _issue(code: str, message: str, severity: str = "error") -> dict[str, str]:
    return {"severity": severity, "code": code, "message": message}


def design_circuit(board: str, parts: list[dict[str, Any]]) -> dict[str, Any]:
    """把角色清单展开成无连字符 id、带限流电阻的电路和同构草图。"""
    spec = _board(board)
    issues: list[dict[str, str]] = []
    notes: list[str] = []
    if spec is None:
        return {
            "ok": False,
            "error": f"不支持的板型 {board}",
            "issues": [_issue("unknown-board", f"不支持的板型 {board}")],
            "components": [],
            "wires": [],
        }
    catalog = {item["id"]: item for item in _load_parts()}
    components: list[dict[str, Any]] = []
    wires: list[dict[str, Any]] = []
    used: set[str] = {spec["id"]}
    counts: dict[str, int] = {}

    def take_id(base: str) -> str:
        counts[base] = counts.get(base, 0) + 1
        candidate = base if counts[base] == 1 else f"{base}{counts[base]}"
        if "-" in candidate or candidate in used:
            issues.append(_issue("hyphen-id", f"实例 id 不可用: {candidate}"))
        used.add(candidate)
        return candidate

    def add_part(metadata_id: str, instance: str, x: int, props: dict | None = None) -> None:
        if metadata_id not in catalog and metadata_id not in FALLBACK_PINS:
            issues.append(_issue("unknown-part", f"目录中没有 {metadata_id}"))
        components.append(
            {
                "id": instance,
                "metadata_id": metadata_id,
                "x": x,
                "y": 200,
                "properties": props or {},
            }
        )

    def add_wire(src: str, src_pin: str, dst: str, dst_pin: str, color: str = "#00aa00") -> None:
        wires.append(
            {
                "id": f"w{len(wires) + 1}",
                "from": f"{src}:{src_pin}",
                "to": f"{dst}:{dst_pin}",
                "from_part": src,
                "from_pin": src_pin,
                "to_part": dst,
                "to_pin": dst_pin,
                "color": color,
            }
        )

    board_id = spec["id"]
    sketch_bits: list[str] = []
    for index, request in enumerate(parts):
        role = str(request.get("role") or request.get("part") or "").lower()
        gpio = str(request.get("gpio") or "")
        if role == "led":
            gpio = gpio or spec["default_led"]
            if not _pin_ok(spec, gpio):
                issues.append(_issue("unknown-board-pin", f"{board_id} 无引脚 {gpio}"))
            led_id = take_id("led")
            res_id = take_id("rled")
            add_part("led", led_id, 280 + index * 120)
            add_part("resistor", res_id, 220 + index * 120, {"value": "220"})
            add_wire(board_id, gpio, res_id, "1")
            add_wire(res_id, "2", led_id, "A")
            add_wire(led_id, "C", board_id, spec["gnd"][0], "#000000")
            notes.append(f"{led_id} 串 220Ω 后接到 {gpio}")
            sketch_bits.append(("led", gpio, led_id))
        elif role in {"button", "btn"}:
            gpio = gpio or ("4" if "4" in spec["gpio"] else spec["gpio"][0])
            if not _pin_ok(spec, gpio):
                issues.append(_issue("unknown-board-pin", f"{board_id} 无引脚 {gpio}"))
            btn_id = take_id("btn")
            add_part("pushbutton", btn_id, 280 + index * 120)
            add_wire(board_id, gpio, btn_id, "1.l", "#e6b800")
            add_wire(btn_id, "2.l", board_id, spec["gnd"][0], "#000000")
            notes.append(f"{btn_id} 使用 INPUT_PULLUP，接到 {gpio}")
            sketch_bits.append(("button", gpio, btn_id))
        elif role == "oled":
            sda, scl = spec["i2c"]
            oled_id = take_id("oled")
            add_part("ssd1306-i2c-4pin", oled_id, 360)
            add_wire(oled_id, "SDA", board_id, sda, "#0000ff")
            add_wire(oled_id, "SCL", board_id, scl, "#ffff00")
            add_wire(oled_id, "VCC", board_id, spec["vcc"][0], "#ff0000")
            add_wire(oled_id, "GND", board_id, spec["gnd"][0], "#000000")
            notes.append(f"{oled_id} I2C SDA={sda} SCL={scl}")
            sketch_bits.append(("oled", sda, scl))
        elif role == "servo":
            gpio = gpio or ("18" if "18" in spec["gpio"] else spec["default_led"])
            if not _pin_ok(spec, gpio):
                issues.append(_issue("unknown-board-pin", f"{board_id} 无引脚 {gpio}"))
            servo_id = take_id("servo")
            add_part("servo", servo_id, 300 + index * 80)
            add_wire(board_id, gpio, servo_id, "PWM")
            add_wire(servo_id, "V+", board_id, spec["vcc"][-1], "#ff0000")
            add_wire(servo_id, "GND", board_id, spec["gnd"][0], "#000000")
            notes.append(f"{servo_id} PWM={gpio}")
            sketch_bits.append(("servo", gpio, servo_id))
        elif role == "buzzer":
            gpio = gpio or spec["default_led"]
            if not _pin_ok(spec, gpio):
                issues.append(_issue("unknown-board-pin", f"{board_id} 无引脚 {gpio}"))
            buzz_id = take_id("buzz")
            add_part("buzzer", buzz_id, 300)
            add_wire(board_id, gpio, buzz_id, "1")
            add_wire(buzz_id, "2", board_id, spec["gnd"][0], "#000000")
            sketch_bits.append(("buzzer", gpio, buzz_id))
        else:
            issues.append(_issue("unknown-role", f"未知角色 {role}，可用 led/button/oled/servo/buzzer"))

    for wire in wires:
        for endpoint, pin in ((wire["from_part"], wire["from_pin"]), (wire["to_part"], wire["to_pin"])):
            if endpoint == board_id:
                if not _pin_ok(spec, pin):
                    issues.append(_issue("unknown-board-pin", f"{board_id} 无引脚 {pin}"))
                continue
            comp = next((item for item in components if item["id"] == endpoint), None)
            pins = FALLBACK_PINS.get(comp["metadata_id"], []) if comp else []
            meta = catalog.get(comp["metadata_id"], {}) if comp else {}
            known = meta.get("pins") or pins
            if known and pin not in known:
                issues.append(_issue("unknown-part-pin", f"{endpoint} 无引脚 {pin}"))

    ok = not any(item["severity"] == "error" for item in issues)
    sketch = _sketch(spec, sketch_bits)
    logger.info("电路设计 board=%s parts=%d ok=%s", board_id, len(components), ok)
    return {
        "ok": ok,
        "board": {"id": board_id, "board_kind": board_id, "fqbn": spec["fqbn"]},
        "components": components,
        "wires": wires,
        "issues": issues,
        "notes": notes,
        "sketch": sketch,
    }


def _sketch(spec: dict[str, Any], bits: list[tuple]) -> dict[str, str]:
    if spec["sketch"] == "py":
        lines = ["# Mock First：真机换外设前先在仿真里跑同一套状态。", ""]
        for kind, pin, _name in bits:
            if kind == "led":
                lines.append(f"# GPIO{pin} -> 220R -> LED")
            elif kind == "button":
                lines.append(f"# GPIO{pin} 按键，另一端 GND，内部上拉")
        lines.append("print('state=idle mock=1')")
        return {"name": "script.py", "content": "\n".join(lines) + "\n"}
    setups = []
    loops = []
    for kind, pin, name in bits:
        if kind == "led":
            setups.append(f"  pinMode({pin}, OUTPUT);")
            loops.append(f"  digitalWrite({pin}, !digitalRead({pin}));")
        elif kind == "button":
            setups.append(f"  pinMode({pin}, INPUT_PULLUP); // {name}")
        elif kind == "servo":
            setups.append(f"  pinMode({pin}, OUTPUT); // {name} PWM")
        elif kind == "buzzer":
            setups.append(f"  pinMode({pin}, OUTPUT); // {name}")
        elif kind == "oled":
            sda, scl = pin, name
            setups.append(f"  Wire.begin({sda}, {scl}); // OLED 0x3C")
    body = "\n".join(
        [
            "void setup() {",
            *(setups or ["  // 无外设"]),
            "}",
            "",
            "void loop() {",
            *(loops or ["  delay(200);"]),
            "  delay(200);",
            "}",
            "",
        ]
    )
    if any(kind == "oled" for kind, *_ in bits):
        body = "#include <Wire.h>\n\n" + body
    return {"name": "sketch.ino", "content": body}
