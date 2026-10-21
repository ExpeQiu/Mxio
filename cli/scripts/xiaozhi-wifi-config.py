#!/usr/bin/env python3
"""Append wifi.ota_url to a backed-up, unencrypted NVS image without rebuilding it.

Offline preparation only. Original partition is the rollback image. Refuses
existing ota_url, invalid CRCs, missing namespace or insufficient active space.
"""
import argparse
import struct
import zlib
from pathlib import Path
from urllib.parse import urlsplit


def crc(data):
    return zlib.crc32(data, 0xffffffff) & 0xffffffff


def patch(data, url):
    parsed = urlsplit(url)
    if parsed.scheme != 'http' or parsed.path != '/ota/' or parsed.query or parsed.username:
        raise ValueError('Expected LAN http://host:8766/ota/')
    if len(data) != 0x4000:
        raise ValueError('Expected the confirmed 16 KiB NVS partition')
    out = bytearray(data)
    namespace = None
    active = []
    for offset in range(0, len(data), 4096):
        state = struct.unpack_from('<I', data, offset)[0]
        if state == 0xffffffff:
            if data[offset:offset+4096] != b'\xff' * 4096:
                raise ValueError('Invalid empty page')
            continue
        if state not in (0xfffffffe, 0xfffffffc):
            raise ValueError('Unsupported NVS page state')
        if crc(data[offset+4:offset+28]) != struct.unpack_from('<I', data, offset+28)[0]:
            raise ValueError('Invalid page CRC')
        i = 0
        while i < 126:
            status = (data[offset+32+i//4] >> (2*(i%4))) & 3
            if status != 2:
                i += 1
                continue
            entry = data[offset+64+32*i:offset+96+32*i]
            if crc(entry[:4]+entry[8:]) != struct.unpack_from('<I', entry, 4)[0]:
                raise ValueError('Invalid entry CRC')
            span = entry[2]
            if not 1 <= span <= 126-i:
                raise ValueError('Invalid entry span')
            key = entry[8:24].split(b'\0')[0]
            if entry[0] == 0 and entry[1] == 1 and key == b'wifi':
                namespace = entry[24]
            if key == b'ota_url':
                raise ValueError('Existing OTA setting; use configuration UI instead')
            i += span
        if state == 0xfffffffe:
            active.append(offset)
    if namespace is None or len(active) != 1:
        raise ValueError('Expected wifi namespace and one active page')
    payload = url.encode() + b'\0'
    span = 1 + (len(payload)+31)//32
    offset = active[0]
    free = [i for i in range(126) if (data[offset+32+i//4] >> (2*(i%4))) & 3 == 3]
    if not free or free != list(range(free[0], 126)) or len(free) < span:
        raise ValueError('Insufficient contiguous active-page space')
    index = free[0]
    start = offset+64+32*index
    if data[start:start+32*span] != b'\xff'*(32*span):
        raise ValueError('Unexpected bytes in unused entries')
    entry = bytearray(b'\xff'*32)
    entry[:4] = bytes([namespace, 0x21, span, 0xff])
    entry[8:24] = b'ota_url'.ljust(16, b'\0')
    struct.pack_into('<H', entry, 24, len(payload))
    struct.pack_into('<I', entry, 28, crc(payload))
    struct.pack_into('<I', entry, 4, crc(entry[:4]+entry[8:]))
    out[start:start+32] = entry
    out[start+32:start+32+len(payload)] = payload
    for i in range(index, index+span):
        out[offset+32+i//4] &= ~(1 << (2*(i%4)))
    return bytes(out)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('backup')
    parser.add_argument('output')
    parser.add_argument('--url', required=True)
    args = parser.parse_args()
    destination = Path(args.output)
    if destination.exists():
        raise SystemExit('Refusing to overwrite prepared configuration')
    destination.write_bytes(patch(Path(args.backup).read_bytes(), args.url))
    destination.chmod(0o600)
    print('Prepared configuration; firmware and existing NVS entries unchanged')
