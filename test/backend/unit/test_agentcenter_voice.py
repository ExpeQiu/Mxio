import asyncio
import unittest
import struct
from unittest.mock import Mock, AsyncMock, patch

from app.services.hwexec.agentcenter_voice import Opus, VoiceRouter, wake_route
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


class VoiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_finished_local_session_does_not_restart_capture(self):
        router = VoiceRouter(Mock(), Mock(), '/unused')
        try:
            router.route = 'agentcenter'
            router.selected = True
            router.conversation_finished = True
            self.assertTrue(router.from_device({'type': 'listen', 'state': 'start'}))
            self.assertFalse(router.listening)
            self.assertIsNone(router.capture_guard)
        finally:
            router.close()

    async def test_no_microphone_audio_returns_to_idle(self):
        gateway = Mock(send_json=AsyncMock(), send_upstream_json=AsyncMock())
        router = VoiceRouter(gateway, Mock(), '/unused')
        try:
            router.listening = True
            with patch('app.services.hwexec.agentcenter_voice.asyncio.sleep', new=AsyncMock()):
                await router.capture_timeout(router.generation)
            self.assertFalse(router.listening)
            self.assertEqual(router.state['last_error'], 'NoMicrophoneAudio')
            self.assertEqual(gateway.send_json.call_args.args[0]['type'], 'goodbye')
        finally:
            router.close()

    async def test_wake_routes_preserve_xiaozhi(self):
        self.assertEqual(wake_route('你好，管家'), 'agentcenter')
        self.assertEqual(wake_route('你好管家'), 'agentcenter')
        self.assertEqual(wake_route('你好小智'), 'xiaozhi')
        self.assertEqual(wake_route('管家'), 'xiaozhi')

    async def test_local_route_blocks_cloud_actions_and_audio_commands(self):
        router = VoiceRouter(Mock(), Mock(), '/unused')
        try:
            self.assertTrue(router.from_device({'type': 'listen', 'state': 'detect', 'text': '你好管家'}))
            self.assertTrue(router.from_device({'type': 'listen', 'state': 'start'}))
            self.assertTrue(router.listening)
            self.assertTrue(router.block_cloud({'type': 'mcp'}))
            self.assertTrue(router.block_cloud({'type': 'tts'}))
            self.assertFalse(router.block_cloud({'type': 'hello'}))
            self.assertFalse(router.from_device({'type': 'mcp', 'payload': {'result': {}}}))
        finally:
            router.close()

    async def test_xiaozhi_wake_remains_upstream_and_button_selects_local(self):
        router = VoiceRouter(Mock(), Mock(), '/unused')
        try:
            self.assertFalse(router.from_device({'type': 'listen', 'state': 'detect', 'text': '你好小智'}))
            self.assertFalse(router.from_device({'type': 'listen', 'state': 'start'}))
            self.assertFalse(router.block_cloud({'type': 'tts'}))
            router.selected = False
            self.assertTrue(router.from_device({'type': 'listen', 'state': 'start'}))
            self.assertEqual(router.state['wake_word'], 'button')
        finally:
            router.close()

    async def test_opus_real_codec(self):
        codec = Opus()
        try:
            frames = codec.encode(b'\0'*(16000*2*60//1000), 16000, 60)
            self.assertEqual(len(frames), 1)
            decoded = codec.decode(frames[0])
            self.assertEqual(len(decoded), 1920)
        finally:
            codec.close()

    async def test_local_audio_decrypts_and_does_not_forward_upstream(self):
        gateway = Mock(device_ip='192.168.0.200')
        router = VoiceRouter(gateway, Mock(), '/unused')
        try:
            router.transport = Mock()
            router.cloud = ('47.1.2.3', 9000)
            router.key = bytes(range(16))
            router.route = 'agentcenter'
            router.listening = True
            pcm = b''.join(struct.pack('<h', 8000 if i % 40 < 20 else -8000) for i in range(960))
            payload = router.opus.encode(pcm, 16000, 60)[0]
            header = bytearray(16)
            header[0] = 1
            struct.pack_into('>H', header, 2, len(payload))
            struct.pack_into('>I', header, 12, 1)
            cipher = Cipher(algorithms.AES(router.key), modes.CTR(bytes(header))).encryptor()
            encrypted = bytes(header)+cipher.update(payload)+cipher.finalize()
            router.datagram_received(encrypted, ('192.168.0.200', 5555))
            self.assertIsNone(router.state['last_error'])
            self.assertEqual(len(router.frames), 1)
            router.transport.sendto.assert_not_called()
            router.datagram_received(encrypted, ('192.168.0.200', 5555))
            self.assertEqual(len(router.frames), 1)
            router.route = 'xiaozhi'
            router.datagram_received(encrypted, ('192.168.0.200', 5555))
            router.transport.sendto.assert_called_once_with(encrypted, router.cloud)
        finally:
            router.close()


if __name__ == '__main__':
    unittest.main()
