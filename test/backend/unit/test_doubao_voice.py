import asyncio
import gzip
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock

from app.services.hwexec.doubao_voice import (DoubaoClient, DoubaoError, decode_event,
                                            encode_event, load_config)
from app.services.hwexec.agentcenter_voice import VoiceRouter


def server_frame(event, ident, payload, kind=9, compressed=False):
    binary = isinstance(payload, bytes)
    value = payload if binary else json.dumps(payload).encode()
    if compressed:
        value = gzip.compress(value)
    header = bytes([0x11, kind*16+4, (0 if binary else 16)+(1 if compressed else 0), 0])
    return header+struct.pack('>I', event)+struct.pack('>I', len(ident))+ident.encode()+struct.pack('>I', len(value))+value


class FakeWebSocket:
    def __init__(self, audio=True):
        self.queue = asyncio.Queue()
        self.events = []
        self.output_audio = audio

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def recv(self):
        return await self.queue.get()

    async def send(self, raw):
        event = struct.unpack_from('>I', raw, 4)[0]
        self.events.append(event)
        if event == 1:
            await self.queue.put(server_frame(50, 'connection', {}))
        elif event == 100:
            n = struct.unpack_from('>I', raw, 8)[0]
            self.session = raw[12:12+n].decode()
            await self.queue.put(server_frame(150, self.session, {}))
        elif event == 200 and self.events.count(200) == 1:
            await self.queue.put(server_frame(550, self.session, {'content': '你好'}))
            if self.output_audio:
                await self.queue.put(server_frame(352, self.session, b'\0'*2880, kind=11))
            await self.queue.put(server_frame(359, self.session, {}))
        elif event == 102:
            await self.queue.put(server_frame(152, self.session, {}))
        elif event == 2:
            await self.queue.put(server_frame(52, 'connection', {}))


class DoubaoTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name)/'voice.env'
        self.path.write_text('DOUBAO_APP_ID=123\nDOUBAO_ACCESS_TOKEN=unit-test-secret\n')

    def tearDown(self):
        self.directory.cleanup()

    async def test_credentials_are_speech_specific(self):
        self.assertEqual(load_config(self.path)['model'], '1.2.1.1')
        self.path.write_text('ARK_API_KEY=unrelated-text-service\n')
        with self.assertRaisesRegex(DoubaoError, 'MissingSpeechCredentials'):
            load_config(self.path)

    async def test_binary_gzip_and_error_frames(self):
        self.assertEqual(decode_event(server_frame(550, 's', {'content': 'hello'}, compressed=True)),
                         (550, 's', {'content': 'hello'}))
        self.assertEqual(decode_event(server_frame(352, 's', b'\x01\x02', kind=11))[2], b'\x01\x02')
        error = b'\x11\xf0\x10\0'+struct.pack('>II', 403, 6)+b'secret'
        with self.assertRaisesRegex(DoubaoError, '^RemoteError_403$'):
            decode_event(error)
        with self.assertRaises(DoubaoError):
            decode_event(server_frame(352, 's', b'abc', kind=11)[:-1])

    async def test_input_audio_frame_contains_session_and_pcm(self):
        raw = encode_event(200, b'\1\0'*320, 'session', audio=True)
        self.assertEqual(raw[:4], b'\x11\x24\0\0')
        self.assertIn(b'session', raw)
        self.assertTrue(raw.endswith(b'\1\0'*320))

    async def test_mock_server_requires_real_audio_before_success(self):
        ws = FakeWebSocket()
        connector = Mock(return_value=ws)
        audio, text = AsyncMock(), AsyncMock()
        client = DoubaoClient(self.path, connector)
        result = await client.talk(b'\0'*640, audio, text)
        self.assertTrue(result['session_started'])
        self.assertEqual(result['audio_bytes_received'], 2880)
        audio.assert_awaited_once_with(b'\0'*2880)
        text.assert_awaited_once_with('你好')
        self.assertIn(102, ws.events)
        self.assertEqual(connector.call_args.args[0], 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue')
        ws = FakeWebSocket(audio=False)
        with self.assertRaisesRegex(DoubaoError, 'NoAudioReply'):
            await DoubaoClient(self.path, Mock(return_value=ws)).talk(b'\0'*640, audio, text)

    async def test_failure_does_not_expose_server_or_header_secrets(self):
        def fail(*args, **kwargs):
            raise RuntimeError('token=unit-test-secret')
        with self.assertRaisesRegex(DoubaoError, '^RuntimeError$') as caught:
            await DoubaoClient(self.path, fail).talk(b'\0'*640, AsyncMock(), AsyncMock())
        self.assertNotIn('secret', str(caught.exception))

    async def test_button_doubao_preserves_wake_route_and_streams_device_audio(self):
        async def talk(pcm, audio, text):
            await text('你好')
            await audio(b'\0'*1000)
            await audio(b'\0'*1880)
            return {'audio_bytes_received': 2880, 'session_started': True}

        gateway = Mock(send_json=AsyncMock(), send_upstream_json=AsyncMock())
        voice = VoiceRouter(gateway, Mock(), '/unused', doubao=Mock(talk=talk), button_route='doubao')
        try:
            voice.from_device({'type': 'listen', 'state': 'start'})
            self.assertEqual(voice.route, 'doubao')
            self.assertFalse(voice.state['local_asr'])
            voice.cancel()
            voice.transport = Mock()
            voice.device = ('192.168.0.200', 1234)
            voice.nonce = bytes([1])+bytes(15)
            voice.key = bytes(16)
            await voice.doubao_turn(b'\0'*640, voice.generation)
            self.assertEqual(voice.state['audio_packets_sent'], 1)
            packet = voice.transport.sendto.call_args.args[0]
            self.assertEqual(int.from_bytes(packet[2:4], 'big'), len(packet)-16)
            self.assertEqual(int.from_bytes(packet[12:16], 'big'), 1)
            voice.from_device({'type': 'listen', 'state': 'detect', 'text': '你好小智'})
            self.assertEqual(voice.route, 'xiaozhi')
            voice.from_device({'type': 'listen', 'state': 'detect', 'text': '你好管家'})
            self.assertEqual(voice.route, 'agentcenter')
        finally:
            voice.close()


if __name__ == '__main__':
    unittest.main()
