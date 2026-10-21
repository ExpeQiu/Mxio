import asyncio
import json
import unittest
from app.services.hwexec.xiaozhi_bridge import handle


class BridgeTests(unittest.TestCase):
    def call(self, method, params=None, provider=lambda: {'usb_present': True}):
        return asyncio.run(handle({'jsonrpc': '2.0', 'id': 7, 'method': method,
                                   'params': params or {}}, provider))

    def test_initialize_and_list(self):
        self.assertEqual(self.call('initialize', {'protocolVersion': '2024-11-05'})['result']['protocolVersion'], '2024-11-05')
        self.assertEqual(len(self.call('tools/list')['result']['tools']), 1)

    def test_status_provider_is_called(self):
        result = self.call('tools/call', {'name': 'velxio_device_channel_status', 'arguments': {}})
        self.assertTrue(json.loads(result['result']['content'][0]['text'])['usb_present'])

    def test_no_arbitrary_device_commands(self):
        result = self.call('tools/call', {'name': 'restart', 'arguments': {}})
        self.assertEqual(result['error']['code'], -32602)

    def test_backend_error_does_not_leak_credentials(self):
        def fail(): raise RuntimeError('token=secret')
        result = self.call('tools/call', {'name': 'velxio_device_channel_status'}, fail)
        self.assertTrue(result['result']['isError'])
        self.assertNotIn('secret', str(result))

    def test_notifications_are_not_answered(self):
        result = asyncio.run(handle({'jsonrpc': '2.0', 'method': 'notifications/initialized'}))
        self.assertIsNone(result)


if __name__ == '__main__': unittest.main()
