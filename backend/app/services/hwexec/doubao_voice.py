"""Doubao official S2S WebSocket protocol; credentials never enter logs.

Protocol: https://www.volcengine.com/docs/6561/1594356
This first integration supports a bounded button-triggered speech turn.
"""
import asyncio
import json
import struct
import uuid
from pathlib import Path

ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue'
MAX_PAYLOAD = 4*1024*1024


class DoubaoError(RuntimeError):
    """Only non-secret, locally constructed error codes may be exposed."""


def load_config(path):
    text = Path(path).read_text()
    if text.lstrip().startswith('{'):
        source = json.loads(text)
    else:
        source = {}
        for line in text.splitlines():
            line = line.strip()
            if line.startswith('export '):
                line = line[7:]
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                source[key.strip()] = value.strip().strip('"').strip("'")

    def get(*names, default=''):
        for name in names:
            value = source.get(name)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return default

    result = {'app_id': get('DOUBAO_APP_ID', 'VOLC_APP_ID', 'app_id'),
              'access_token': get('DOUBAO_ACCESS_TOKEN', 'DOUBAO_ACCESS_KEY', 'VOLC_ACCESS_KEY', 'access_token'),
              'api_key': get('DOUBAO_API_KEY', 'api_key'),
              'model': get('DOUBAO_VOICE_MODEL', 'model', default='1.2.1.1'),
              'speaker': get('DOUBAO_SPEAKER', 'speaker', default='zh_female_vv_jupiter_bigtts')}
    if not result['api_key'] and not (result['app_id'] and result['access_token']):
        raise DoubaoError('MissingSpeechCredentials')
    if any('\n' in value or '\r' in value for value in result.values()):
        raise DoubaoError('InvalidConfiguration')
    if result['model'] not in {'1.2.1.1', '2.2.0.0'}:
        raise DoubaoError('UnsupportedVoiceModel')
    return result


def encode_event(event, payload=b'{}', session='', audio=False):
    if not isinstance(payload, bytes):
        payload = json.dumps(payload, ensure_ascii=False).encode()
    if len(payload) > MAX_PAYLOAD:
        raise DoubaoError('PayloadTooLarge')
    # Version 1, 4-byte header, event flag; raw audio or JSON; no compression.
    header = bytes([0x11, 0x24 if audio else 0x14, 0 if audio else 0x10, 0])
    body = struct.pack('>I', event)
    if event >= 100:
        ident = session.encode()
        body += struct.pack('>I', len(ident))+ident
    return header+body+struct.pack('>I', len(payload))+payload


def decode_event(raw):
    if not isinstance(raw, bytes) or len(raw) < 8 or raw[0] >> 4 != 1:
        raise DoubaoError('InvalidServerFrame')
    offset = (raw[0] & 15)*4
    kind, flags = raw[1] >> 4, raw[1] & 15
    serialization, compression = raw[2] >> 4, raw[2] & 15

    def integer():
        nonlocal offset
        if offset+4 > len(raw):
            raise DoubaoError('TruncatedServerFrame')
        value = struct.unpack_from('>I', raw, offset)[0]
        offset += 4
        return value

    def block():
        nonlocal offset
        size = integer()
        if size > MAX_PAYLOAD or offset+size > len(raw):
            raise DoubaoError('InvalidServerLength')
        value = raw[offset:offset+size]
        offset += size
        return value

    if offset < 4 or offset > len(raw) or kind not in {9, 11, 15}:
        raise DoubaoError('UnsupportedServerFrame')
    if kind == 15:
        code = integer()
        # Do not surface server bodies, which may echo sensitive input.
        raise DoubaoError('RemoteError_'+str(code))
    if flags & 1:
        integer()  # optional sequence number
    event = integer() if flags & 4 else None
    session = ''
    if event is not None and event >= 50:
        session = block().decode('utf-8')  # connection ID for 50..99, otherwise session ID
    payload = block()
    if offset != len(raw):
        raise DoubaoError('UnexpectedServerBytes')
    if compression == 1:
        # Bounded decompression, including hostile gzip expansion.
        import zlib
        decoder = zlib.decompressobj(16+zlib.MAX_WBITS)
        payload = decoder.decompress(payload, MAX_PAYLOAD+1)
        if len(payload) > MAX_PAYLOAD or not decoder.eof:
            raise DoubaoError('CompressedPayloadTooLarge')
    elif compression != 0:
        raise DoubaoError('UnsupportedCompression')
    if serialization == 1:
        payload = json.loads(payload)
    elif serialization != 0:
        raise DoubaoError('UnsupportedSerialization')
    return event, session, payload


class DoubaoClient:
    def __init__(self, config_path, connector=None):
        self.config_path = str(config_path)
        # Validate before routing the hardware button to this service.
        load_config(config_path)
        self.connector = connector

    async def talk(self, pcm, on_audio, on_text):
        try:
            return await self._talk(pcm, on_audio, on_text)
        except (DoubaoError, asyncio.CancelledError):
            raise
        except TimeoutError:
            raise DoubaoError('CloudTimeout') from None
        except Exception as error:
            status = getattr(getattr(error, 'response', None), 'status_code', None)
            code = 'HTTP_'+str(status) if type(status) is int else type(error).__name__
            raise DoubaoError(code) from None

    async def _talk(self, pcm, on_audio, on_text):
        """Upload mono PCM16/16kHz; deliver mono PCM16/24kHz response chunks.

        No automatic retry: replaying an utterance could duplicate a paid turn.
        Only real session acknowledgements and nonempty audio constitute success.
        """
        if not pcm or len(pcm) % 2 or len(pcm) > 12*32000:
            raise DoubaoError('InvalidInputAudio')
        import websockets
        cfg = load_config(self.config_path)
        headers = {'X-Api-Resource-Id': 'volc.speech.dialog', 'X-Api-Connect-Id': str(uuid.uuid4())}
        if cfg['api_key']:
            headers['X-Api-Key'] = cfg['api_key']
        else:
            headers.update({'X-Api-App-ID': cfg['app_id'], 'X-Api-Access-Key': cfg['access_token'],
                            'X-Api-App-Key': 'PlgvMymc7f3tQnJ6'})
        session = str(uuid.uuid4())
        connector = self.connector or websockets.connect
        async with asyncio.timeout(75):
            async with connector(ENDPOINT, additional_headers=headers, open_timeout=15,
                                 max_size=MAX_PAYLOAD, ping_interval=20, ping_timeout=20) as ws:
                async def wait_event(expected):
                    while True:
                        event, ident, payload = decode_event(await asyncio.wait_for(ws.recv(), 15))
                        if event in {51, 52, 153} and event != expected:
                            raise DoubaoError('SessionRejected')
                        if event == expected:
                            if expected >= 100 and ident != session:
                                raise DoubaoError('SessionMismatch')
                            return payload

                await ws.send(encode_event(1))
                await wait_event(50)
                await ws.send(encode_event(100, {
                    'asr': {'extra': {'enable_custom_vad': True, 'end_smooth_window_ms': 1200}},
                    'tts': {'speaker': cfg['speaker'], 'audio_config': {
                        'channel': 1, 'format': 'pcm_s16le', 'sample_rate': 24000}},
                    'dialog': {'bot_name': '豆包', 'system_role': '请用简短中文回答，每次尽量不超过两句话。',
                               'extra': {'model': cfg['model'], 'input_mod': 'audio_file'}}}, session))
                await wait_event(150)

                async def upload():
                    # Official recommended 20ms input packets, paced as microphone audio.
                    for offset in range(0, len(pcm), 640):
                        await ws.send(encode_event(200, pcm[offset:offset+640], session, audio=True))
                        await asyncio.sleep(.02)
                    await ws.send(encode_event(400, {}, session))

                sender = asyncio.create_task(upload())
                audio_bytes = 0
                try:
                    while True:
                        event, ident, payload = decode_event(await asyncio.wait_for(ws.recv(), 30))
                        if ident and event >= 100 and ident != session:
                            raise DoubaoError('SessionMismatch')
                        if event in {152, 153}:
                            raise DoubaoError('SessionEndedBeforeReply')
                        if event == 599:
                            code = str(payload.get('status_code', '')) if isinstance(payload, dict) else ''
                            raise DoubaoError('RemoteDialogError_'+code if code.isdigit() else 'RemoteDialogError')
                        if event == 352:
                            if not isinstance(payload, bytes):
                                raise DoubaoError('InvalidOutputAudio')
                            audio_bytes += len(payload)
                            if audio_bytes > 60*48000:
                                raise DoubaoError('ReplyTooLong')
                            await on_audio(payload)
                        elif event == 550 and isinstance(payload, dict):
                            text = payload.get('content', payload.get('text', ''))
                            if isinstance(text, str):
                                await on_text(text)
                        elif event == 359:
                            if not audio_bytes:
                                raise DoubaoError('NoAudioReply')
                            return {'session_started': True, 'audio_bytes_received': audio_bytes,
                                    'model': cfg['model'], 'sample_rate': 24000}
                finally:
                    sender.cancel()
                    await asyncio.gather(sender, return_exceptions=True)
                    try:
                        await ws.send(encode_event(102, {}, session))
                        await asyncio.wait_for(wait_event(152), 3)
                    except Exception:
                        pass
                    try:
                        await ws.send(encode_event(2))
                        await asyncio.wait_for(wait_event(52), 2)
                    except Exception:
                        pass
