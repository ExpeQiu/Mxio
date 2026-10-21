"""ESP32 固件格式、分区表和烧录地址校验。

合并镜像布局与 ``espidf_compiler._merge_flash_image`` 一致：
经典 ESP32/S2 的 bootloader 在 0x1000，其余芯片在 0x0；分区表在 0x8000。
"""

from __future__ import annotations

import logging
import struct
from typing import Any

logger = logging.getLogger("velxio.hwexec")

PART_MAGIC = 0x50AA
PART_TABLE_OFFSET = 0x8000
PART_ENTRY_SIZE = 32
APP_FLASH_ADDRESS = 0x10000
MAX_FLASH = 16 * 1024 * 1024

# 与 espidf_compiler._BOOTLOADER_OFFSETS 保持一致。
BOOTLOADER_OFFSETS = {
    "esp32": 0x1000,
    "esp32s2": 0x1000,
}


def chip_name(board_or_chip: str) -> str:
    text = (board_or_chip or "esp32").lower().replace("-", "")
    for name in ("esp32c6", "esp32c3", "esp32c2", "esp32s3", "esp32s2", "esp32h2"):
        if name in text:
            return name
    return "esp32"


def bootloader_offset(chip: str) -> int:
    return BOOTLOADER_OFFSETS.get(chip_name(chip), 0x0)


def esp_board_type(board_fqbn: str) -> str | None:
    """QEMU 机器名。无法识别时返回 None。"""
    text = (board_fqbn or "").lower()
    if "esp32s3" in text or "esp32-s3" in text:
        return "esp32-s3"
    if "esp32c3" in text or "esp32-c3" in text:
        return "esp32-c3"
    if "esp32" in text:
        return "esp32"
    return None


def _parse_partitions(blob: bytes) -> tuple[list[dict[str, Any]], str | None]:
    entries: list[dict[str, Any]] = []
    offset = 0
    while offset + PART_ENTRY_SIZE <= len(blob) and len(entries) < 95:
        magic, ptype, subtype, poff, size = struct.unpack_from("<HBBII", blob, offset)
        if magic == 0xFFFF:
            break
        if magic != PART_MAGIC:
            if entries:
                break
            return [], "分区表魔数不是 0x50AA"
        name = blob[offset + 12:offset + 28].split(b"\x00", 1)[0].decode("utf-8", "replace")
        entries.append(
            {
                "name": name,
                "type": ptype,
                "subtype": subtype,
                "offset": poff,
                "size": size,
            }
        )
        offset += PART_ENTRY_SIZE
    return entries, None


def inspect_firmware(data: bytes, chip: str = "esp32") -> dict[str, Any]:
    """判断镜像是合并 flash、单独 app，还是不能烧的格式。"""
    chip_id = chip_name(chip)
    boot_off = bootloader_offset(chip_id)
    errors: list[str] = []
    warnings: list[str] = []

    if not data:
        return _report(False, "empty", chip_id, boot_off, None, [], ["固件为空"], warnings)

    stripped = data.lstrip()
    if stripped.startswith(b":"):
        return _report(
            False,
            "ihex",
            chip_id,
            boot_off,
            None,
            [],
            ["这是 Intel HEX，不是 ESP32 flash 镜像"],
            warnings,
        )

    if len(data) > MAX_FLASH:
        errors.append(f"固件超过 16MB（{len(data)} 字节）")

    has_table = (
        len(data) >= PART_TABLE_OFFSET + 2
        and data[PART_TABLE_OFFSET] == 0xAA
        and data[PART_TABLE_OFFSET + 1] == 0x50
    )
    has_boot = len(data) > boot_off and data[boot_off] == 0xE9
    partitions: list[dict[str, Any]] = []

    if has_table:
        partitions, perr = _parse_partitions(data[PART_TABLE_OFFSET:])
        if perr:
            errors.append(perr)
        if not has_boot:
            errors.append(f"合并镜像在 0x{boot_off:X} 缺少 bootloader 魔数 0xE9")
        image_format = "merged"
        flash_address = 0x0
    elif len(data) >= 8 and data[0] == 0xE9:
        image_format = "app"
        flash_address = APP_FLASH_ADDRESS
        warnings.append("单独应用镜像烧到 0x10000，不会更新 bootloader 和分区表")
    else:
        return _report(
            False,
            "unknown",
            chip_id,
            boot_off,
            None,
            [],
            ["无法识别的固件：需要 0xE9 镜像头，或带分区表的合并 flash"],
            warnings,
        )

    for part in partitions:
        poff = int(part["offset"])
        psize = int(part["size"])
        if poff % 0x1000 != 0:
            errors.append(f"分区 {part['name']} 偏移 0x{poff:X} 没有 4KB 对齐")
        if part["type"] == 0 and poff % 0x10000 != 0:
            errors.append(f"应用分区 {part['name']} 偏移 0x{poff:X} 没有 64KB 对齐")
        if psize <= 0 or poff + psize > MAX_FLASH:
            errors.append(f"分区 {part['name']} 范围越界")
        if poff < len(data) and poff + 1 <= len(data) and part["type"] == 0:
            if data[poff] != 0xE9:
                errors.append(f"应用分区 {part['name']} 在 0x{poff:X} 不是 0xE9 镜像")
        elif part["type"] == 0 and poff >= len(data):
            errors.append(f"应用分区 {part['name']} 偏移超出镜像长度")

    _check_overlap(partitions, errors)

    if image_format == "app" and flash_address % 0x10000 != 0:
        errors.append("应用烧录地址未 64KB 对齐")

    ok = not errors
    logger.info(
        "固件校验 format=%s chip=%s bytes=%d flash_address=0x%X ok=%s errors=%s",
        image_format,
        chip_id,
        len(data),
        flash_address or 0,
        ok,
        errors,
    )
    return _report(ok, image_format, chip_id, boot_off, flash_address, partitions, errors, warnings, len(data))


def _check_overlap(partitions: list[dict[str, Any]], errors: list[str]) -> None:
    ordered = sorted(partitions, key=lambda item: int(item["offset"]))
    for prev, nxt in zip(ordered, ordered[1:]):
        prev_end = int(prev["offset"]) + int(prev["size"])
        if prev_end > int(nxt["offset"]):
            errors.append(f"分区重叠：{prev['name']} 与 {nxt['name']}")


def _report(
    ok: bool,
    image_format: str,
    chip: str,
    boot_off: int,
    flash_address: int | None,
    partitions: list[dict[str, Any]],
    errors: list[str],
    warnings: list[str],
    size: int = 0,
) -> dict[str, Any]:
    return {
        "ok": ok,
        "format": image_format,
        "chip": chip,
        "size": size,
        "bootloader_offset": boot_off,
        "partition_table_offset": PART_TABLE_OFFSET,
        "flash_address": flash_address,
        "partitions": partitions,
        "errors": errors,
        "warnings": warnings,
    }
