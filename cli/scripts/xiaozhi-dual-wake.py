#!/usr/bin/env python3
"""Prepare a dual-wake asset image, preserving every unrelated asset/model."""
import argparse
import json
import struct
from pathlib import Path


def unpack_assets(data):
    count, checksum, length = struct.unpack_from('<III', data)
    body = data[12:12+length]
    if len(body) != length or sum(body)&65535 != checksum:
        raise ValueError('Invalid asset checksum')
    result = {}
    for i in range(count):
        name, size, offset, width, height = struct.unpack_from('<32sIIHH', body, 44*i)
        name = name.split(b'\0')[0].decode()
        start = count*44+offset
        if body[start:start+2] != b'ZZ' or start+2+size > len(body):
            raise ValueError('Invalid asset offset')
        result[name] = (body[start+2:start+2+size], width, height)
    return result


def unpack_models(data):
    count = struct.unpack_from('<I', data)[0]
    offset = 4
    models = {}
    for _ in range(count):
        name, files = struct.unpack_from('<32sI', data, offset)
        offset += 36
        name = name.split(b'\0')[0].decode()
        models[name] = {}
        for _ in range(files):
            key, start, size = struct.unpack_from('<32sII', data, offset)
            offset += 40
            if start+size > len(data):
                raise ValueError('Invalid model offset')
            models[name][key.split(b'\0')[0].decode()] = data[start:start+size]
    return models


def pack_models(models):
    header_size = 4+sum(36+40*len(files) for files in models.values())
    header = struct.pack('<I', len(models))
    body = b''
    for name, files in sorted(models.items()):
        header += struct.pack('<32sI', name.encode(), len(files))
        for key, value in sorted(files.items()):
            header += struct.pack('<32sII', key.encode(), header_size+len(body), len(value))
            body += value
    return header+body


def build(original, model_dir):
    assets = unpack_assets(original)
    index = json.loads(assets['index.json'][0])
    model_asset = index['srmodels']
    previous = unpack_models(assets[model_asset][0])
    models = {name: dict(files) for name, files in previous.items()}
    models['mn6_cn'] = {name: (model_dir/name).read_bytes()
                        for name in ['_MODEL_INFO_', 'mn6_data', 'mn6_index', 'vocab']}
    models['fst'] = {name: (model_dir/name).read_bytes() for name in ['commands_cn.txt', 'commands_en.txt']}
    index['multinet_model'] = {'language': 'cn', 'duration': 3000, 'threshold': .2,
        'commands': [{'command': 'ni hao xiao zhi', 'text': '你好小智', 'action': 'wake'},
                     {'command': 'ni hao guan jia', 'text': '你好管家', 'action': 'wake'}]}
    assets[model_asset] = (pack_models(models), 0, 0)
    assets['index.json'] = (json.dumps(index, ensure_ascii=False).encode(), 0, 0)
    table = body = b''
    for name, (value, width, height) in assets.items():
        table += struct.pack('<32sIIHH', name.encode(), len(value), len(body), width, height)
        body += b'ZZ'+value
    payload = table+body
    result = struct.pack('<III', len(assets), sum(payload)&65535, len(payload))+payload
    if len(result) > 0x800000:
        raise ValueError('Resource partition overflow')
    verified = unpack_assets(result)
    for name, value in unpack_assets(original).items():
        if name not in {'index.json', model_asset} and verified[name] != value:
            raise ValueError('Unrelated asset changed')
    verified_models = unpack_models(verified[model_asset][0])
    for name, files in previous.items():
        if verified_models[name] != files:
            raise ValueError('Original wake model changed')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('backup')
    parser.add_argument('model_dir')
    parser.add_argument('output')
    args = parser.parse_args()
    output = Path(args.output)
    if output.exists():
        raise SystemExit('Refusing to overwrite output')
    output.write_bytes(build(Path(args.backup).read_bytes(), Path(args.model_dir)))
    print('Dual-wake resources validated:', output.stat().st_size, 'bytes')
