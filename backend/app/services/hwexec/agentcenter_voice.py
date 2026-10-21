"""Wake-routed UDP audio, local ASR/TTS, and authenticated AgentCenter turns."""
import asyncio
import ctypes
import ctypes.util
import json
import os
import socket
import struct
import tempfile
import time
import urllib.request
from collections import deque
from pathlib import Path
from types import SimpleNamespace

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


def wake_route(text):
    word = ''.join(c for c in text if c.isalnum()).lower()
    return 'agentcenter' if word == '你好管家' else 'xiaozhi'


class SenseVoiceASR:
    def __init__(self, model_path):
        import torch
        from funasr import AutoModel
        torch.set_num_threads(2)
        self.model = AutoModel(model=model_path, device='cpu', disable_update=True,
                              trust_remote_code=False, disable_pbar=True)

    def transcribe(self, audio, **kwargs):
        from funasr.utils.postprocess_utils import rich_transcription_postprocess
        result = self.model.generate(input=audio, cache={}, language='zh', use_itn=True,
                                     batch_size_s=30, disable_pbar=True)
        text = rich_transcription_postprocess(result[0]['text']) if result else ''
        return [SimpleNamespace(text=text)], None


class Opus:
    def __init__(self):
        self.lib = ctypes.CDLL(ctypes.util.find_library('opus') or '/opt/homebrew/lib/libopus.dylib')
        for name in ('opus_encoder_create', 'opus_decoder_create'):
            getattr(self.lib, name).restype = ctypes.c_void_p
        self.lib.opus_encoder_create.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
        self.lib.opus_decoder_create.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
        self.lib.opus_encode.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
        self.lib.opus_decode.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
        self.lib.opus_encoder_destroy.argtypes = [ctypes.c_void_p]
        self.lib.opus_decoder_destroy.argtypes = [ctypes.c_void_p]
        error = ctypes.c_int()
        self.decoder = self.lib.opus_decoder_create(16000, 1, ctypes.byref(error))
        if error.value or not self.decoder:
            raise RuntimeError('Opus decoder unavailable')

    def decode(self, payload):
        output = ctypes.create_string_buffer(16000*2)
        size = self.lib.opus_decode(self.decoder, payload, len(payload), output, 16000, 0)
        if size < 0:
            raise ValueError('Invalid Opus frame')
        return output.raw[:size*2]

    def encode(self, pcm, rate, duration):
        error = ctypes.c_int()
        encoder = self.lib.opus_encoder_create(rate, 1, 2048, ctypes.byref(error))
        if error.value or not encoder:
            raise RuntimeError('Opus encoder unavailable')
        samples = rate*duration//1000
        output = ctypes.create_string_buffer(4000)
        frames = []
        try:
            for start in range(0, len(pcm), samples*2):
                frame = pcm[start:start+samples*2].ljust(samples*2, b'\0')
                size = self.lib.opus_encode(encoder, frame, samples, output, 4000)
                if size < 0:
                    raise ValueError('Opus encoding failed')
                frames.append(output.raw[:size])
            return frames
        finally:
            self.lib.opus_encoder_destroy(encoder)

    def close(self):
        if self.decoder:
            self.lib.opus_decoder_destroy(self.decoder)
            self.decoder = None


class VoiceRouter(asyncio.DatagramProtocol):
    def __init__(self, gateway, model, credential_file, doubao=None, button_route='agentcenter'):
        self.gateway, self.model = gateway, model
        self.credential_file = Path(credential_file)
        if button_route not in {'agentcenter', 'doubao'} or (button_route == 'doubao' and doubao is None):
            raise ValueError('Selected button service unavailable')
        self.doubao, self.button_route = doubao, button_route
        self.opus = Opus()
        self.transport = None
        self.cloud = None
        self.device = None
        self.key = self.nonce = None
        self.rate, self.duration = 24000, 60
        self.route = 'xiaozhi'
        self.selected = False
        self.session = ''
        self.generation = 0
        self.sequence = 0
        self.input_sequence = 0
        self.pending = None
        self.turn_task = None
        self.capture_guard = None
        self.frames = []
        self.preroll = deque(maxlen=5)
        self.spoken = self.quiet = 0
        self.listening = False
        self.conversation_finished = False
        self.state = {'route': 'xiaozhi', 'wake_word': None, 'turns_completed': 0,
                      'audio_packets_sent': 0, 'last_error': None, 'local_asr': True,
                      'udp_packets_received': 0, 'microphone_packets': 0,
                      'last_audio_rms': None, 'phase': 'idle'}
        self.state.update(button_route=button_route, doubao_configured=doubao is not None)

    def connection_made(self, transport):
        self.transport = transport

    async def configure(self, hello):
        self.cancel()
        self.generation += 1
        self.session = hello['session_id']
        self.route, self.selected = 'xiaozhi', False
        self.conversation_finished = False
        self.sequence = 0
        self.input_sequence = 0
        self.device = None
        udp = hello['udp']
        self.key, self.nonce = bytes.fromhex(udp['key']), bytes.fromhex(udp['nonce'])
        if len(self.key) != 16 or len(self.nonce) != 16:
            raise ValueError('Invalid audio crypto parameters')
        addresses = await asyncio.get_running_loop().getaddrinfo(udp['server'], int(udp['port']),
            family=socket.AF_INET, type=socket.SOCK_DGRAM)
        self.cloud = addresses[0][4]
        params = hello.get('audio_params', {})
        self.rate = params.get('sample_rate', 24000)
        self.duration = params.get('frame_duration', 60)
        if self.rate not in (16000, 24000, 48000) or self.duration not in (20, 40, 60):
            raise ValueError('Unsupported audio format')
        udp['server'], udp['port'] = self.gateway.lan_ip, 8767

    def cancel(self):
        if self.capture_guard and self.capture_guard is not asyncio.current_task():
            self.capture_guard.cancel()
        self.capture_guard = None
        if self.turn_task and not self.turn_task.done():
            self.turn_task.cancel()
        self.turn_task = None
        self.listening = False
        self.frames.clear()
        self.preroll.clear()
        self.spoken = self.quiet = 0

    def from_device(self, message):
        typ, state = message.get('type'), message.get('state')
        if typ == 'listen' and state == 'detect':
            self.route = wake_route(message.get('text', ''))
            self.selected = True
            self.state.update(route=self.route, wake_word=message.get('text'), last_error=None)
        if typ == 'listen' and state == 'start':
            if self.route != 'xiaozhi' and self.conversation_finished:
                return True
            if not self.selected:
                # Existing board button starts listening without a wake-word event.
                self.route, self.selected = self.button_route, True
                self.state.update(route=self.route, wake_word='button', last_error=None)
            self.frames.clear()
            self.preroll.clear()
            self.spoken = self.quiet = 0
            self.listening = self.route != 'xiaozhi'
            self.state['local_asr'] = self.route == 'agentcenter'
            if self.listening:
                self.state['phase'] = 'listening'
                if self.capture_guard:
                    self.capture_guard.cancel()
                self.capture_guard = asyncio.create_task(self.capture_timeout(self.generation))
        if typ in ('goodbye', 'abort'):
            self.conversation_finished = True
            self.cancel()
        if typ == 'listen' and state == 'stop' and self.listening:
            self.finish()
        # Local conversation never sends its listen/abort commands upstream.
        return self.route != 'xiaozhi' and typ in ('listen', 'abort')

    def block_cloud(self, message):
        return self.route != 'xiaozhi' and message.get('type') in {'stt', 'llm', 'tts', 'goodbye', 'mcp'}

    def datagram_received(self, data, address):
        self.state['udp_packets_received'] += 1
        if not self.cloud or not self.key or len(data) < 16:
            return
        if len(data) != 16 + int.from_bytes(data[2:4], 'big'):
            return
        if address[0] == self.gateway.device_ip:
            self.state['microphone_packets'] += 1
            self.state['last_audio_packet_type'] = data[0]
            self.device = address
            if self.route == 'xiaozhi':
                self.transport.sendto(data, self.cloud)
                return
            if not self.listening:
                return
            sequence = int.from_bytes(data[12:16], 'big')
            if sequence <= self.input_sequence:
                return
            self.input_sequence = sequence
            try:
                decoder = Cipher(algorithms.AES(self.key), modes.CTR(data[:16])).decryptor()
                pcm = self.opus.decode(decoder.update(data[16:]) + decoder.finalize())
                import numpy as np
                values = np.frombuffer(pcm, dtype='<i2').astype('float32')
                rms = float(np.sqrt(np.mean(values*values)))
                self.state['last_audio_rms'] = round(rms, 2)
                loud = rms > 120
                seconds = len(pcm)/32000
                if loud:
                    self.spoken += seconds
                    self.quiet = 0
                else:
                    self.quiet += seconds
                self.frames.append(pcm)
                if (self.spoken >= .24 and self.quiet >= 1.2) or sum(map(len, self.frames)) >= 12*32000:
                    self.finish()
            except Exception as error:
                self.state['last_error'] = type(error).__name__
        elif address == self.cloud and data[0] == 1 and self.device and self.route == 'xiaozhi':
            self.sequence = max(self.sequence, int.from_bytes(data[12:16], 'big'))
            self.transport.sendto(data, self.device)

    def finish(self):
        if not self.listening or not self.frames:
            return
        self.listening = False
        if self.capture_guard and self.capture_guard is not asyncio.current_task():
            self.capture_guard.cancel()
        self.capture_guard = None
        pcm = b''.join(self.frames)
        self.frames.clear()
        self.turn_task = asyncio.create_task(self.turn(pcm, self.generation))

    async def capture_timeout(self, generation):
        await asyncio.sleep(12)
        if generation != self.generation or not self.listening:
            return
        if self.frames:
            self.finish()
        else:
            self.listening = False
            self.conversation_finished = True
            self.state.update(last_error='NoMicrophoneAudio', phase='idle')
            await self.gateway.send_json({'type': 'goodbye', 'session_id': self.session})
            await self.gateway.send_upstream_json({'type': 'goodbye', 'session_id': self.session})

    def transcribe(self, pcm):
        import numpy as np
        segments, _ = self.model.transcribe(np.frombuffer(pcm, dtype='<i2').astype('float32')/32768,
            language='zh', beam_size=3, initial_prompt='你好管家，查看系统状态。')
        return ''.join(segment.text for segment in segments).strip()

    def agentcenter(self, text):
        credentials = json.loads(self.credential_file.read_text())
        request = urllib.request.Request('http://47.113.225.93:8080/api/super-ai/device/turn',
            data=json.dumps({'text': text, 'workspace_slug': 'cyber', 'channel': 'voice',
                             'pending': self.pending}).encode(),
            headers={'Content-Type': 'application/json', 'X-Device-Token': credentials['device_token']})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)

    async def say(self, text, generation):
        with tempfile.TemporaryDirectory(prefix='velxio-tts-') as directory:
            audio = str(Path(directory)/'reply.aiff')
            process = await asyncio.create_subprocess_exec('/usr/bin/say', '-v', 'Tingting', '-o', audio,
                text[:400], stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            await asyncio.wait_for(process.wait(), 30)
            if process.returncode:
                raise RuntimeError('Speech synthesis failed')
            process = await asyncio.create_subprocess_exec('/opt/homebrew/bin/ffmpeg', '-v', 'error', '-i', audio,
                '-f', 's16le', '-ar', str(self.rate), '-ac', '1', '-', stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL)
            pcm, _ = await asyncio.wait_for(process.communicate(), 30)
            if process.returncode:
                raise RuntimeError('Speech conversion failed')
        frames = await asyncio.to_thread(self.opus.encode, pcm, self.rate, self.duration)
        if generation != self.generation or not self.device:
            return
        await self.gateway.send_json({'type': 'tts', 'state': 'start', 'session_id': self.session})
        await self.gateway.send_json({'type': 'tts', 'state': 'sentence_start', 'text': text[:400], 'session_id': self.session})
        for i, frame in enumerate(frames):
            if generation != self.generation:
                return
            self.sequence += 1
            header = bytearray(self.nonce)
            header[0] = 1
            struct.pack_into('>H', header, 2, len(frame))
            struct.pack_into('>II', header, 8, i*self.duration, self.sequence)
            encoder = Cipher(algorithms.AES(self.key), modes.CTR(bytes(header))).encryptor()
            self.transport.sendto(bytes(header)+encoder.update(frame)+encoder.finalize(), self.device)
            self.state['audio_packets_sent'] += 1
            await asyncio.sleep(self.duration/1000)
        await asyncio.sleep(.15)
        await self.gateway.send_json({'type': 'tts', 'state': 'stop', 'session_id': self.session})

    async def turn(self, pcm, generation):
        try:
            if self.route == 'doubao':
                await self.doubao_turn(pcm, generation)
                self.state['turns_completed'] += 1
                return
            self.state['phase'] = 'recognizing'
            text = await asyncio.to_thread(self.transcribe, pcm)
            if generation != self.generation:
                return
            if not text:
                raise ValueError('No speech recognized')
            self.state['phase'] = 'agentcenter'
            result = await asyncio.to_thread(self.agentcenter, text)
            if generation != self.generation:
                return
            self.pending = result.get('pending')
            reply = result.get('reply', '').strip()
            if not reply:
                raise ValueError('No AgentCenter reply')
            self.state.update(last_intent=result.get('intent'), last_run_id=result.get('run_id'),
                last_transcript=text, last_reply=reply, last_turn_unix=time.time(), last_error=None)
            self.state['phase'] = 'speaking'
            await self.say(reply, generation)
            self.state['turns_completed'] += 1
        except asyncio.CancelledError:
            raise
        except Exception as error:
            from .doubao_voice import DoubaoError
            self.state['last_error'] = str(error) if isinstance(error, DoubaoError) else type(error).__name__
            try:
                service = '豆包' if self.route == 'doubao' else '管家'
                await self.say(service+'通道暂时无法回复，请稍后再试。', generation)
            except Exception:
                pass
        finally:
            if generation == self.generation:
                self.listening = False
                self.conversation_finished = True
                if self.capture_guard and self.capture_guard is not asyncio.current_task():
                    self.capture_guard.cancel()
                self.capture_guard = None
                self.state['phase'] = 'idle'
                try:
                    await self.gateway.send_json({'type': 'goodbye', 'session_id': self.session})
                    await self.gateway.send_upstream_json({'type': 'goodbye', 'session_id': self.session})
                except ConnectionError:
                    pass

    async def doubao_turn(self, pcm, generation):
        from .doubao_voice import DoubaoError
        if not self.doubao:
            raise DoubaoError('MissingSpeechCredentials')
        self.state.update(phase='doubao', last_reply='', last_transcript=None,
                          last_intent='doubao-speech', last_error=None)
        error = ctypes.c_int()
        encoder = self.opus.lib.opus_encoder_create(self.rate, 1, 2048, ctypes.byref(error))
        if error.value or not encoder:
            raise DoubaoError('EncoderUnavailable')
        buffer = bytearray()
        output = ctypes.create_string_buffer(4000)
        frame_bytes = self.rate*self.duration//1000*2
        started = False
        timestamp = 0
        resample_state = None
        resample_tail = b''

        async def text(value):
            if generation == self.generation:
                self.state['last_reply'] = (self.state['last_reply']+value)[:4000]

        async def audio(value):
            nonlocal started, resample_state, resample_tail
            if generation != self.generation or not self.device:
                raise asyncio.CancelledError()
            if self.rate != 24000:
                import audioop
                value = resample_tail+value
                resample_tail = value[len(value)//2*2:]
                value = value[:len(value)//2*2]
                value, resample_state = audioop.ratecv(value, 2, 1, 24000, self.rate, resample_state)
            if not started:
                await self.gateway.send_json({'type': 'tts', 'state': 'start', 'session_id': self.session})
                started = True
                self.state['phase'] = 'speaking'
            buffer.extend(value)
            await emit_frames()

        async def emit_frames():
            nonlocal timestamp
            while len(buffer) >= frame_bytes:
                if generation != self.generation or not self.device:
                    raise asyncio.CancelledError()
                samples = bytes(buffer[:frame_bytes])
                del buffer[:frame_bytes]
                size = self.opus.lib.opus_encode(encoder, samples, frame_bytes//2, output, 4000)
                if size < 0:
                    raise DoubaoError('EncodingFailed')
                self.sequence += 1
                header = bytearray(self.nonce)
                header[0] = 1
                struct.pack_into('>H', header, 2, size)
                struct.pack_into('>II', header, 8, timestamp, self.sequence)
                cipher = Cipher(algorithms.AES(self.key), modes.CTR(bytes(header))).encryptor()
                self.transport.sendto(bytes(header)+cipher.update(output.raw[:size])+cipher.finalize(), self.device)
                self.state['audio_packets_sent'] += 1
                timestamp += self.duration
                await asyncio.sleep(self.duration/1000)

        try:
            receipt = await self.doubao.talk(pcm, audio, text)
            if resample_tail:
                raise DoubaoError('InvalidOutputAudio')
            if buffer:
                if len(buffer) % 2:
                    raise DoubaoError('InvalidOutputAudio')
                buffer.extend(b'\0'*(frame_bytes-len(buffer)))
                await emit_frames()
            self.state.update(doubao_receipt=receipt, last_turn_unix=time.time())
            await asyncio.sleep(.15)
            await self.gateway.send_json({'type': 'tts', 'state': 'stop', 'session_id': self.session})
        finally:
            self.opus.lib.opus_encoder_destroy(encoder)

    def close(self):
        self.cancel()
        if self.transport:
            self.transport.close()
        self.opus.close()
