import asyncio
import importlib.util
import json
import struct
import unittest
import zlib
from unittest.mock import Mock, AsyncMock, patch
from pathlib import Path

from app.services.hwexec.xiaozhi_wifi import Gateway, packet, read_packet, validate_call


class WifiTests(unittest.IsolatedAsyncioTestCase):
    async def test_same_device_reconnect_replaces_stale_session(self):
        gateway = Gateway('127.0.0.1')
        gateway.config = {'endpoint': 'api.tenclass.net'}
        cancelled = []

        async def stale():
            try:
                await asyncio.Future()
            finally:
                cancelled.append(True)

        previous = asyncio.create_task(stale())
        await asyncio.sleep(0)
        gateway.relay_task = previous
        gateway.writer = Mock()
        device_reader = asyncio.StreamReader()
        device_reader.feed_data(packet(0x10, b''))
        device_reader.feed_eof()
        cloud_reader = asyncio.StreamReader()
        cloud_reader.feed_eof()
        writer = Mock(get_extra_info=Mock(return_value=('192.168.0.200', 5000)),
                      drain=AsyncMock(), wait_closed=AsyncMock())
        upstream = Mock(drain=AsyncMock(), wait_closed=AsyncMock())
        with patch('app.services.hwexec.xiaozhi_wifi.asyncio.open_connection',
                   new=AsyncMock(return_value=(cloud_reader, upstream))):
            await gateway.relay(device_reader, writer)
        self.assertTrue(cancelled)
        upstream.write.assert_called_once_with(packet(0x10, b''))

    async def test_packet_fragmentation_and_size_limit(self):
        reader = asyncio.StreamReader()
        encoded = packet(0x30, b'x'*200)
        for byte in encoded:
            reader.feed_data(bytes([byte]))
        self.assertEqual(await read_packet(reader), (0x30, b'x'*200, encoded))
        reader = asyncio.StreamReader()
        reader.feed_data(b'\x30\xff\xff\xff\x7f')
        with self.assertRaises(ValueError):
            await read_packet(reader)

    async def test_no_success_without_device_connection(self):
        gateway = Gateway('127.0.0.1')
        with self.assertRaises(ConnectionError):
            await gateway.rpc('tools/list', {})
        self.assertEqual(gateway.calls, 0)

    async def test_real_reply_correlation_required(self):
        gateway = Gateway('127.0.0.1')
        gateway.connected = True
        gateway.config = {'subscribe_topic': 'device/down'}
        sent = []

        async def send(raw):
            sent.append(raw)
            ident = gateway.counter
            gateway.pending[ident].set_result({'id': ident, 'result': {'content': []}})

        gateway.send = send
        result = await gateway.rpc('tools/call', {'name': 'self.get_device_status', 'arguments': {}})
        self.assertEqual(result, {'content': []})
        self.assertEqual(gateway.calls, 1)
        self.assertFalse(gateway.pending)
        self.assertIn(b'device/down', sent[0])

    async def test_control_allowlist_and_ranges(self):
        validate_call('self.get_device_status', {})
        validate_call('self.screen.set_brightness', {'brightness': 50})
        for name, arguments in [('self.reboot', {}), ('self.audio_speaker.set_volume', {'volume': True}),
                                ('self.screen.set_brightness', {'brightness': 101}),
                                ('self.get_device_status', {'extra': 1})]:
            with self.assertRaises(ValueError):
                validate_call(name, arguments)

    async def test_config_preserves_original_entries_and_rejects_corruption(self):
        path = Path(__file__).resolve().parents[3] / 'cli/scripts/xiaozhi-wifi-config.py'
        spec = importlib.util.spec_from_file_location('wifi_config', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        data = bytearray(b'\xff'*0x4000)
        struct.pack_into('<II', data, 0, 0xfffffffe, 0)
        data[8] = 0xfe
        struct.pack_into('<I', data, 28, module.crc(data[4:28]))
        entry = bytearray(b'\xff'*32)
        entry[:4] = bytes([0, 1, 1, 0xff])
        entry[8:24] = b'wifi'.ljust(16, b'\0')
        entry[24] = 3
        struct.pack_into('<I', entry, 4, module.crc(entry[:4]+entry[8:]))
        data[64:96] = entry
        data[32] = 0xfe
        result = module.patch(bytes(data), 'http://192.168.0.196:8766/ota/')
        self.assertEqual(result[64:96], entry)
        self.assertEqual(result[4096:], data[4096:])
        self.assertIn(b'ota_url', result)
        data[70] ^= 1
        with self.assertRaises(ValueError):
            module.patch(bytes(data), 'http://192.168.0.196:8766/ota/')


if __name__ == '__main__':
    unittest.main()
