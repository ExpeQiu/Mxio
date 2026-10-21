"""Codex 电路设计：目录搜索、LED 串电阻、实例 id。"""

from app.services.circuit_design import design_circuit, search_parts


def test_search_led_from_catalog():
    found = search_parts("led", limit=5)
    assert found["ok"] is True
    assert any(part["id"] == "led" for part in found["parts"])


def test_design_led_inserts_resistor_and_rejects_bad_pin():
    ok = design_circuit("esp32", [{"role": "led", "gpio": "2"}, {"role": "button", "gpio": "4"}])
    assert ok["ok"] is True
    ids = [item["id"] for item in ok["components"]]
    assert "led" in ids and "rled" in ids and "btn" in ids
    assert all("-" not in item for item in ids)
    assert any(wire["to_pin"] == "A" and wire["from_part"] == "rled" for wire in ok["wires"])
    assert "pinMode(2, OUTPUT)" in ok["sketch"]["content"]
    assert "INPUT_PULLUP" in ok["sketch"]["content"]

    bad = design_circuit("esp32", [{"role": "led", "gpio": "GPIO99"}])
    assert bad["ok"] is False
    assert any(issue["code"] == "unknown-board-pin" for issue in bad["issues"])


def test_oled_uses_esp32_i2c_pins():
    designed = design_circuit("esp32", [{"role": "oled"}])
    assert designed["ok"] is True
    pins = {(wire["from_pin"], wire["to_pin"]) for wire in designed["wires"]}
    assert ("SDA", "21") in pins or ("21", "SDA") in {(a, b) for a, b in [(w["from_pin"], w["to_pin"]) for w in designed["wires"]]}
    assert "Wire.begin(21, 22)" in designed["sketch"]["content"]
