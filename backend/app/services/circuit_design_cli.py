"""stdin JSON {board, parts} → 设计结果 JSON。供 CLI 调用。"""

from __future__ import annotations

import json
import sys

from app.services.circuit_design import design_circuit


def main() -> None:
    raw = json.loads(sys.stdin.read() or "{}")
    result = design_circuit(str(raw.get("board") or ""), list(raw.get("parts") or []))
    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
