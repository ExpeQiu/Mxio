"""
Velxio MCP Server

Exposes the following tools to MCP-compatible agents (e.g. Claude):

  - compile_project       Compile Arduino sketch files → hex / binary
  - run_project           Compile and return simulation-ready artifacts
  - import_wokwi_json     Parse a Wokwi diagram.json → Velxio circuit
  - export_wokwi_json     Serialise a Velxio circuit → Wokwi diagram.json
  - create_circuit        Create a new circuit definition
  - update_circuit        Merge changes into an existing circuit definition
  - generate_code_files   Generate starter Arduino code from a circuit

Transport:
  - stdio  — run `python mcp_server.py` for Claude Desktop / CLI agents
  - SSE    — mounted at /mcp in the FastAPI app for HTTP-based agents
"""

from __future__ import annotations

import json
import sys
from typing import Annotated, Any

from mcp.server.fastmcp import FastMCP

from app.mcp.wokwi import (
    format_wokwi_diagram,
    generate_arduino_sketch,
    parse_wokwi_diagram,
)
from app.services.arduino_cli import ArduinoCLIService
from app.services.hwexec.runner import compile_sketch, execute, set_compiler
from app.services.hwexec.tasks import get_store

# ---------------------------------------------------------------------------
# Server setup
# ---------------------------------------------------------------------------

mcp = FastMCP(
    name="velxio",
    instructions=(
        "Velxio MCP server — create circuits, compile, run headless ESP32 "
        "simulation, flash a local ESP32, or run code on a Raspberry Pi over SSH. "
        "USB flashing only works on the machine that has the board attached."
    ),
)

_arduino = ArduinoCLIService()
set_compiler(_arduino)

# ---------------------------------------------------------------------------
# compile_project
# ---------------------------------------------------------------------------


@mcp.tool()
async def compile_project(
    files: Annotated[
        list[dict[str, str]],
        "List of source files. Each item must have 'name' (filename, e.g. 'sketch.ino') "
        "and 'content' (file text).",
    ],
    board: Annotated[
        str,
        "Arduino board FQBN, e.g. 'arduino:avr:uno' or 'rp2040:rp2040:rpipico'. "
        "Defaults to 'arduino:avr:uno'.",
    ] = "arduino:avr:uno",
) -> dict[str, Any]:
    """
    Compile one or more Arduino sketch files and return the compiled artifact.

    Returns a dict with:
      - success (bool)
      - hex_content (str | null)    Intel HEX for AVR boards
      - binary_content (str | null) Base-64 .bin/.uf2 for RP2040
      - binary_type (str | null)    'bin' or 'uf2'
      - stdout (str)
      - stderr (str)
      - error (str | null)
    """
    for f in files:
        if "name" not in f or "content" not in f:
            return {
                "success": False,
                "error": "Each file entry must have 'name' and 'content' keys.",
                "stdout": "",
                "stderr": "",
            }

    try:
        result = await compile_sketch(files, board)
        return result
    except Exception as exc:  # pragma: no cover
        return {
            "success": False,
            "error": str(exc),
            "stdout": "",
            "stderr": "",
        }


# ---------------------------------------------------------------------------
# run_project
# ---------------------------------------------------------------------------


@mcp.tool()
async def run_project(
    files: Annotated[
        list[dict[str, str]],
        "List of source files (same format as compile_project).",
    ],
    board: Annotated[str, "Board FQBN (default: 'arduino:avr:uno')."] = "arduino:avr:uno",
    duration_s: Annotated[float, "How long to capture serial output from the simulator."] = 5,
    expect: Annotated[
        list[str] | None,
        "Substrings that must appear in the serial log. Prefix with re: for a regex.",
    ] = None,
    serial_input: Annotated[str, "Bytes to write to the simulator UART before reading."] = "",
    demo: Annotated[bool, "Skip real compile/QEMU and return a deterministic demo log."] = False,
) -> dict[str, Any]:
    """
    Compile the project and execute a headless simulation.

    ESP32 boards boot under QEMU and the tool returns the captured serial log
    plus assertion results. Raspberry Pi boards boot the Linux guest when a
    local QEMU and boot image are already cached, then run the Python file.
    AVR boards still simulate in the browser.
    """
    return await execute(
        files=files,
        board=board,
        target="sim",
        duration_s=duration_s,
        expect=expect or [],
        serial_input=serial_input,
        demo=demo,
        via="mcp",
    )


# ---------------------------------------------------------------------------
# import_wokwi_json
# ---------------------------------------------------------------------------


@mcp.tool()
async def import_wokwi_json(
    diagram_json: Annotated[
        str,
        "Wokwi diagram.json content as a JSON string. "
        "Must contain at minimum a 'parts' array.",
    ],
) -> dict[str, Any]:
    """
    Parse a Wokwi diagram.json payload and return a Velxio circuit object.

    The returned circuit can be passed directly to export_wokwi_json,
    generate_code_files, compile_project, or saved as a Velxio project.

    Returns:
      - board_fqbn (str)         Detected Arduino board FQBN
      - components (list)        List of component objects
      - connections (list)       List of connection objects
      - version (int)
    """
    try:
        diagram = json.loads(diagram_json)
    except json.JSONDecodeError as exc:
        return {"error": f"Invalid JSON: {exc}"}

    if not isinstance(diagram, dict):
        return {"error": "diagram_json must be a JSON object."}

    return parse_wokwi_diagram(diagram)


# ---------------------------------------------------------------------------
# export_wokwi_json
# ---------------------------------------------------------------------------


@mcp.tool()
async def export_wokwi_json(
    circuit: Annotated[
        dict[str, Any],
        "Velxio circuit object with 'components', 'connections', and 'board_fqbn'.",
    ],
    author: Annotated[str, "Author name to embed in the diagram (default: 'velxio')."] = "velxio",
) -> dict[str, Any]:
    """
    Convert a Velxio circuit object into a Wokwi diagram.json payload.

    The returned payload is compatible with the Wokwi simulator and can be
    imported using the Wokwi zip import feature in Velxio.

    Returns the Wokwi diagram dict (version, author, editor, parts, connections).
    """
    if not isinstance(circuit, dict):
        return {"error": "circuit must be a JSON object."}

    return format_wokwi_diagram(circuit, author=author)


# ---------------------------------------------------------------------------
# create_circuit
# ---------------------------------------------------------------------------


@mcp.tool()
async def create_circuit(
    board_fqbn: Annotated[
        str,
        "Arduino board FQBN. e.g. 'arduino:avr:uno', 'rp2040:rp2040:rpipico'.",
    ] = "arduino:avr:uno",
    components: Annotated[
        list[dict[str, Any]] | None,
        "List of component objects. Each item may have: "
        "id (str), type (str, Wokwi element type), left (number), top (number), "
        "rotate (number), attrs (object).",
    ] = None,
    connections: Annotated[
        list[dict[str, Any]] | None,
        "List of connection objects. Each item may have: "
        "from_part (str), from_pin (str), to_part (str), to_pin (str), color (str).",
    ] = None,
) -> dict[str, Any]:
    """
    Create a new Velxio circuit definition.

    Example component types: wokwi-led, wokwi-pushbutton, wokwi-resistor,
    wokwi-buzzer, wokwi-servo, wokwi-lcd1602.

    Example connection:
      { "from_part": "uno", "from_pin": "13", "to_part": "led1", "to_pin": "A",
        "color": "green" }

    Returns the new circuit object (board_fqbn, components, connections, version).
    """
    components_list = components if components is not None else []
    connections_list = connections if connections is not None else []

    # Normalise components
    normalised_components: list[dict[str, Any]] = []
    for i, comp in enumerate(components_list):
        normalised_components.append(
            {
                "id": comp.get("id", f"comp{i}"),
                "type": comp.get("type", ""),
                "left": float(comp.get("left", 0)),
                "top": float(comp.get("top", 0)),
                "rotate": int(comp.get("rotate", 0)),
                "attrs": dict(comp.get("attrs", {})),
            }
        )

    # Normalise connections
    normalised_connections: list[dict[str, Any]] = []
    for conn in connections_list:
        normalised_connections.append(
            {
                "from_part": conn.get("from_part", ""),
                "from_pin": conn.get("from_pin", ""),
                "to_part": conn.get("to_part", ""),
                "to_pin": conn.get("to_pin", ""),
                "color": conn.get("color", "green"),
            }
        )

    return {
        "board_fqbn": board_fqbn,
        "components": normalised_components,
        "connections": normalised_connections,
        "version": 1,
    }


# ---------------------------------------------------------------------------
# update_circuit
# ---------------------------------------------------------------------------


@mcp.tool()
async def update_circuit(
    circuit: Annotated[
        dict[str, Any],
        "Existing Velxio circuit object to update.",
    ],
    add_components: Annotated[
        list[dict[str, Any]] | None,
        "Components to add. Merged after existing components.",
    ] = None,
    remove_component_ids: Annotated[
        list[str] | None,
        "IDs of components to remove.",
    ] = None,
    add_connections: Annotated[
        list[dict[str, Any]] | None,
        "Connections to add.",
    ] = None,
    remove_connections: Annotated[
        list[dict[str, Any]] | None,
        "Connections to remove (matched by from_part+from_pin+to_part+to_pin).",
    ] = None,
    board_fqbn: Annotated[
        str | None,
        "If provided, replaces the circuit board_fqbn.",
    ] = None,
) -> dict[str, Any]:
    """
    Merge changes into an existing Velxio circuit definition.

    Supports adding/removing components and connections, and changing the board.

    Returns the updated circuit object.
    """
    if not isinstance(circuit, dict):
        return {"error": "circuit must be a JSON object."}

    import copy

    updated = copy.deepcopy(circuit)

    if board_fqbn is not None:
        updated["board_fqbn"] = board_fqbn

    # Remove components
    if remove_component_ids:
        remove_set = set(remove_component_ids)
        updated["components"] = [
            c for c in updated.get("components", []) if c.get("id") not in remove_set
        ]

    # Add components
    existing_ids = {c.get("id") for c in updated.get("components", [])}
    for i, comp in enumerate(add_components or []):
        comp_id = comp.get("id", f"comp_new_{i}")
        if comp_id in existing_ids:
            comp_id = f"{comp_id}_new"
        updated.setdefault("components", []).append(
            {
                "id": comp_id,
                "type": comp.get("type", ""),
                "left": float(comp.get("left", 0)),
                "top": float(comp.get("top", 0)),
                "rotate": int(comp.get("rotate", 0)),
                "attrs": dict(comp.get("attrs", {})),
            }
        )

    # Remove connections (exact match)
    if remove_connections:
        def _conn_key(c: dict[str, Any]) -> tuple[str, str, str, str]:
            return (
                c.get("from_part", ""),
                c.get("from_pin", ""),
                c.get("to_part", ""),
                c.get("to_pin", ""),
            )

        remove_keys = {_conn_key(c) for c in remove_connections}
        updated["connections"] = [
            c for c in updated.get("connections", []) if _conn_key(c) not in remove_keys
        ]

    # Add connections
    for conn in (add_connections or []):
        updated.setdefault("connections", []).append(
            {
                "from_part": conn.get("from_part", ""),
                "from_pin": conn.get("from_pin", ""),
                "to_part": conn.get("to_part", ""),
                "to_pin": conn.get("to_pin", ""),
                "color": conn.get("color", "green"),
            }
        )

    return updated


# ---------------------------------------------------------------------------
# generate_code_files
# ---------------------------------------------------------------------------


@mcp.tool()
async def generate_code_files(
    circuit: Annotated[
        dict[str, Any],
        "Velxio circuit object (from create_circuit or import_wokwi_json).",
    ],
    sketch_name: Annotated[
        str,
        "Base name for the generated sketch file (without extension).",
    ] = "sketch",
    extra_instructions: Annotated[
        str,
        "Optional extra instructions or comments to embed in the sketch.",
    ] = "",
) -> dict[str, Any]:
    """
    Generate starter Arduino code files for the given circuit.

    Returns:
      - files: list of { "name": str, "content": str } — ready for compile_project
      - board_fqbn: str — detected board FQBN
    """
    if not isinstance(circuit, dict):
        return {"error": "circuit must be a JSON object."}

    sketch_content = generate_arduino_sketch(circuit, sketch_name=sketch_name)

    if extra_instructions:
        header = f"// {extra_instructions}\n"
        sketch_content = header + sketch_content

    board_fqbn: str = circuit.get("board_fqbn", "arduino:avr:uno")

    return {
        "files": [{"name": f"{sketch_name}.ino", "content": sketch_content}],
        "board_fqbn": board_fqbn,
    }


# ---------------------------------------------------------------------------
# hardware execution — same runner as HTTP /api/exec/run
# ---------------------------------------------------------------------------


@mcp.tool()
async def esp32_run(
    files: Annotated[list[dict[str, str]], "Sketch files with name and content."],
    port: Annotated[str, "Serial port, for example /dev/cu.usbserial-10 or COM3."],
    board: Annotated[str, "ESP32 FQBN."] = "esp32:esp32:esp32",
    duration_s: Annotated[float, "Seconds of serial log to capture after flashing."] = 5,
    expect: Annotated[list[str] | None, "Substrings or re: patterns that must appear in the log."] = None,
    serial_input: Annotated[str, "Text written to the serial port before reading."] = "",
    baud: Annotated[int, "Serial capture baud rate."] = 115200,
    demo: Annotated[bool, "Do not touch USB; return a demo log."] = False,
) -> dict[str, Any]:
    """Compile, validate the ESP32 image, flash it, capture serial, and judge expect patterns.

    Refuses to run inside a container. Flash address comes from the image
    (merged flash at 0x0, application image at 0x10000).
    """
    return await execute(
        files=files,
        board=board,
        target="esp32",
        port=port,
        duration_s=duration_s,
        expect=expect or [],
        serial_input=serial_input,
        baud=baud,
        demo=demo,
        via="mcp",
    )


@mcp.tool()
async def pi_run(
    files: Annotated[list[dict[str, str]], "Source files to copy to the Pi."],
    host: Annotated[str, "Raspberry Pi hostname or IP."],
    start_cmd: Annotated[str, "Command to run in the remote directory. Its exit code is the test result."],
    user: Annotated[str, "SSH user."] = "pi",
    remote_dir: Annotated[str, "Absolute remote directory."] = "/tmp/velxio",
    identity: Annotated[str | None, "Path to an SSH private key. Omit to use the agent default."] = None,
    action: Annotated[str, "cycle, test, start, stop, or logs."] = "cycle",
    duration_s: Annotated[float, "Timeout budget for a foreground test."] = 30,
    expect: Annotated[list[str] | None, "Substrings or re: patterns required in the remote output."] = None,
    demo: Annotated[bool, "Do not open SSH; return a demo log."] = False,
) -> dict[str, Any]:
    """Deploy files over SSH, run them, and return logs plus the exit code."""
    return await execute(
        files=files,
        board="raspberry-pi",
        target="pi",
        duration_s=duration_s,
        expect=expect or [],
        pi={
            "host": host,
            "user": user,
            "identity": identity,
            "remote_dir": remote_dir,
            "start_cmd": start_cmd,
            "action": action,
        },
        demo=demo,
        via="mcp",
    )


@mcp.tool()
async def list_esp32_devices() -> dict[str, Any]:
    """List local serial ports and flag likely ESP32 USB adapters.

    Returns a boundary error when this process is not the local USB executor.
    """
    from app.services.hwexec.boundary import authorize, hardware_local
    from app.services.hwexec.esp32 import list_serial_ports

    if not hardware_local():
        logger_msg = "USB executor is not enabled in this process"
        decision = authorize(via="mcp", target="esp32", device=None, client_host=None, authorization=None)
        return {"ok": False, "error": decision.message or logger_msg, "devices": []}
    return list_serial_ports()


@mcp.tool()
async def exec_task(
    task_id: Annotated[str | None, "Task id returned by run_project, esp32_run, or pi_run."] = None,
    cancel: Annotated[bool, "Cancel the task and kill its process group."] = False,
) -> dict[str, Any]:
    """Read one hardware-execution task, list recent tasks, or cancel a running task."""
    store = get_store()
    if task_id and cancel:
        task = store.cancel(task_id)
        return task or {"error": "任务不存在"}
    if task_id:
        task = store.get(task_id)
        return task or {"error": "任务不存在"}
    return {"tasks": store.list_tasks()}


@mcp.tool()
async def diagnose_hardware(
    host: Annotated[str | None, "Raspberry Pi host, for example 192.168.0.194."] = None,
    port: Annotated[str | None, "ESP32 serial port. Used to pick the last task for that device."] = None,
    command: Annotated[
        str | None,
        "One remote command to run on the Pi for diagnosis, such as 'pinctrl get 17'.",
    ] = None,
    user: Annotated[str, "SSH user."] = "pi",
) -> dict[str, Any]:
    """Inspect the last run, sample live GPIO on a Pi, and return a short diagnosis.

    Use this after esp32_run or pi_run fails. It does not start a debugger.
    """
    from app.services.hwexec.diagnose import diagnose

    return await diagnose(host=host, port=port, command=command, user=user)


@mcp.tool()
async def search_parts(
    query: Annotated[str, "Part name or tag, for example led, oled, servo."],
    limit: Annotated[int, "Maximum matches."] = 8,
) -> dict[str, Any]:
    """Search the Velxio component catalog. Use this before placing parts."""
    from app.services.circuit_design import search_parts as _search

    return _search(query, limit)


@mcp.tool()
async def design_circuit(
    board: Annotated[str, "esp32, arduino-uno, or raspberry-pi-5."],
    parts: Annotated[
        list[dict[str, str]],
        "Each item has role (led, button, oled, servo, buzzer) and optional gpio.",
    ],
) -> dict[str, Any]:
    """Build a validated circuit from catalog parts.

    LEDs are wired through a 220 ohm resistor. Instance ids have no hyphens.
    Returns components, wires, issues, and a starter sketch.
    """
    from app.services.circuit_design import design_circuit as _design

    logger_board = board
    result = _design(logger_board, parts)
    return result
