"""USB channel must verify restart evidence and avoid leaking firmware secrets."""
import asyncio
import tempfile
import unittest
from pathlib import Path
from app.services.hwexec.device_channel import device_channel, summarize
from app.services.hwexec.tasks import TaskStore


class Usb:
    def __init__(self, logs):
        self.logs = logs
        self.calls = []

    async def capture(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return {'ok': True, 'logs': self.logs}


class ChannelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = TaskStore(Path(self.temp.name) / 'tasks.db')

    def tearDown(self):
        self.temp.cleanup()

    def run_channel(self, action, usb):
        return asyncio.run(device_channel('/dev/cu.test', action, 1, usb, self.store))

    def test_restart_requires_boot_evidence(self):
        usb = Usb('MQTT: Connected to endpoint')
        result = self.run_channel('restart', usb)
        self.assertFalse(result['success'])
        self.assertEqual(result['error_code'], 'NO_BOOT_EVIDENCE')
        self.assertTrue(usb.calls[0][1]['reset'])

    def test_observe_does_not_request_reset_or_write(self):
        usb = Usb('StateMachine: State: activating -> idle')
        result = self.run_channel('observe', usb)
        self.assertTrue(result['success'])
        self.assertEqual(result['last_state_observed'], 'idle')
        self.assertFalse(usb.calls[0][1]['reset'])
        self.assertEqual(usb.calls[0][0][-1], '')
        self.assertFalse(result['business_control_ready'])

    def test_sensitive_logs_not_in_report_or_task(self):
        usb = Usb('rst:0x15\nMQTT: password=secret\nMQTT: Connected to endpoint')
        result = self.run_channel('restart', usb)
        self.assertTrue(result['success'])
        self.assertNotIn('secret', str(result))
        self.assertNotIn('secret', str(self.store.get(result['task_id'])))

    def test_busy_device_is_not_opened(self):
        owner = self.store.create('other', '/dev/cu.test')
        self.store.mark(owner, 'running')
        self.store.acquire('/dev/cu.test', owner)
        usb = Usb('rst:0x15')
        result = self.run_channel('restart', usb)
        self.assertEqual(result['error_code'], 'DEVICE_BUSY')
        self.assertEqual(usb.calls, [])

    def test_parser_never_invents_state(self):
        self.assertIsNone(summarize('heap=1234')['last_state_observed'])


if __name__ == '__main__':
    unittest.main()
