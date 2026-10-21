"""LAN MQTT relay with correlated device MCP calls; cloud audio stays upstream.

Run standalone: VELXIO_XIAOZHI_LAN_IP=<host IP> python -m ...xiaozhi_wifi
Only the configured device IP may use the LAN listeners. Control is loopback-only.
No device credentials or packet bodies are logged or persisted.
"""
import asyncio
import json
import os
import secrets
import ssl
import time
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

MAX_PACKET = 1024 * 1024
ALLOWED_TOOLS = {'self.get_device_status', 'self.audio_speaker.set_volume',
                 'self.screen.set_brightness'}


def packet(kind, body):
    size = len(body)
    length = bytearray()
    while True:
        digit = size % 128
        size //= 128
        length.append(digit | (128 if size else 0))
        if not size:
            return bytes([kind]) + length + body


async def read_packet(reader):
    first = await reader.readexactly(1)
    size = 0
    prefix = bytearray(first)
    for i in range(4):
        digit = (await reader.readexactly(1))[0]
        prefix.append(digit)
        size += (digit & 127) << (7 * i)
        if not digit & 128:
            if size > MAX_PACKET:
                raise ValueError('Packet too large')
            body = await reader.readexactly(size)
            return first[0], body, bytes(prefix) + body
    raise ValueError('Invalid packet length')


def publish_payload(kind, body):
    if kind >> 4 != 3 or len(body) < 2:
        return None
    size = int.from_bytes(body[:2], 'big')
    offset = 2 + size + (2 if kind & 6 else 0)
    if offset > len(body):
        raise ValueError('Invalid publish')
    return body[offset:]


def validate_call(name, arguments):
    if name not in ALLOWED_TOOLS:
        raise ValueError('Tool not allowed')
    key = {'self.audio_speaker.set_volume': 'volume',
           'self.screen.set_brightness': 'brightness'}.get(name)
    if key is None:
        if arguments != {}:
            raise ValueError('Status takes no arguments')
    elif (set(arguments) != {key} or type(arguments[key]) is not int
          or not 0 <= arguments[key] <= 100):
        raise ValueError('Expected an integer from 0 to 100')


class Gateway:
    def __init__(self, lan_ip, device_ip='192.168.0.200', mac='84:C7:BB:60:21:94', routing_file=None):
        self.lan_ip, self.device_ip, self.mac = lan_ip, device_ip, mac
        self.config = None
        self.routing_file = Path(routing_file) if routing_file else None
        if self.routing_file:
            try:
                route = json.loads(self.routing_file.read_text())
                if (route.get('endpoint') in {'api.tenclass.net', 'api.tenclass.net:8883'} and
                    all(isinstance(route.get(k), str) and route[k] for k in ('publish_topic', 'subscribe_topic'))):
                    self.config = {k: route[k] for k in ('endpoint', 'publish_topic', 'subscribe_topic')}
            except (OSError, ValueError, TypeError):
                pass
        self.writer = None
        self.lock = asyncio.Lock()
        self.pending = {}
        self.counter = 1500000000 + secrets.randbelow(100000000)
        self.calls = 0
        self.last_result_time = None
        self.connected = False
        self.session_id = ''
        self.voice = None
        self.upstream_writer = None
        self.connection_lock = asyncio.Lock()
        self.relay_task = None

    def status(self):
        return {'device_mac': self.mac, 'device_ip': self.device_ip,
                'connected': self.connected, 'transport': 'Wi-Fi MQTT relay',
                'successful_device_replies': self.calls,
                'last_device_reply_unix': self.last_result_time,
                'control_tools': sorted(ALLOWED_TOOLS)}

    async def send(self, raw):
        async with self.lock:
            if self.writer is None:
                raise ConnectionError('Device offline')
            self.writer.write(raw)
            await self.writer.drain()

    async def send_json(self, message):
        if not self.config:
            raise ConnectionError('Device offline')
        topic = self.config['subscribe_topic'].encode()
        await self.send(packet(0x30, len(topic).to_bytes(2, 'big') + topic +
                               json.dumps(message, ensure_ascii=False).encode()))

    async def send_upstream_json(self, message):
        if self.upstream_writer and self.config:
            topic = self.config['publish_topic'].encode()
            self.upstream_writer.write(packet(0x30, len(topic).to_bytes(2, 'big')+topic+
                                              json.dumps(message).encode()))
            await self.upstream_writer.drain()

    async def rpc(self, method, params):
        if not self.connected or not self.config:
            raise ConnectionError('Device offline')
        self.counter += 1
        ident = self.counter
        future = asyncio.get_running_loop().create_future()
        self.pending[ident] = future
        payload = json.dumps({'type': 'mcp', 'session_id': self.session_id,
            'payload': {'jsonrpc': '2.0', 'id': ident, 'method': method, 'params': params}}).encode()
        topic = self.config['subscribe_topic'].encode()
        try:
            await self.send(packet(0x30, len(topic).to_bytes(2, 'big') + topic + payload))
            reply = await asyncio.wait_for(future, 15)
            if 'error' in reply:
                raise ValueError('Device rejected MCP request')
            self.calls += 1
            self.last_result_time = time.time()
            return reply['result']
        finally:
            self.pending.pop(ident, None)

    async def relay(self, reader, writer):
        # Refuse unrelated LAN clients and simultaneous device sessions.
        if writer.get_extra_info('peername')[0] != self.device_ip or not self.config:
            writer.close()
            await writer.wait_closed()
            return
        upstream = None
        current = asyncio.current_task()
        async with self.connection_lock:
            # A hardware reset may leave the previous TCP session half-open.
            # Replace that same authorized device's session instead of refusing
            # reconnection until the stale session's keepalive expires.
            previous = self.relay_task
            if previous and previous is not current and not previous.done():
                previous.cancel()
                await asyncio.gather(previous, return_exceptions=True)
            self.relay_task = current
            self.writer = writer
        try:
            endpoint = self.config['endpoint']
            host, _, port = endpoint.partition(':')
            if host != 'api.tenclass.net' or port not in ('', '8883'):
                raise ValueError('Unsupported upstream')
            cloud_reader, upstream = await asyncio.wait_for(asyncio.open_connection(
                host, 8883, ssl=ssl.create_default_context(), server_hostname=host), 15)
            self.upstream_writer = upstream
            kind, body, raw = await asyncio.wait_for(read_packet(reader), 15)
            if kind != 0x10:
                raise ValueError('Expected CONNECT')
            upstream.write(raw)
            await upstream.drain()

            async def from_device():
                while True:
                    kind, body, raw = await read_packet(reader)
                    intercepted = False
                    payload = publish_payload(kind, body)
                    if payload:
                        try:
                            message = json.loads(payload)
                            if self.voice and self.voice.from_device(message):
                                intercepted = True
                            reply = message.get('payload', {}) if message.get('type') == 'mcp' else {}
                            future = self.pending.get(reply.get('id'))
                            if future is not None and ('result' in reply or 'error' in reply):
                                if not future.done():
                                    future.set_result(reply)
                                intercepted = True
                                # Keep MQTT QoS acknowledgement semantics if needed.
                                if kind & 6 == 2:
                                    n = int.from_bytes(body[:2], 'big')
                                    await self.send(packet(0x40, body[2+n:4+n]))
                                elif kind & 6:
                                    raise ValueError('QoS2 replies unsupported')
                        except (json.JSONDecodeError, AttributeError, TypeError):
                            pass
                    if not intercepted:
                        upstream.write(raw)
                        await upstream.drain()

            async def from_cloud():
                while True:
                    kind, body, raw = await read_packet(cloud_reader)
                    if kind == 0x20:
                        self.connected = len(body) == 2 and body[1] == 0
                    payload = publish_payload(kind, body)
                    if payload:
                        try:
                            message = json.loads(payload)
                            if message.get('type') == 'hello':
                                self.session_id = message.get('session_id', '')
                                if self.voice:
                                    await self.voice.configure(message)
                                    raw = packet(kind, body[:len(body)-len(payload)] +
                                                 json.dumps(message, ensure_ascii=False).encode())
                            if self.voice and self.voice.block_cloud(message):
                                continue
                            if message.get('type') == 'mcp':
                                ident = message.get('payload', {}).get('id')
                                if ident in self.pending:
                                    raise ConnectionError('RPC ID collision')
                        except (json.JSONDecodeError, AttributeError, TypeError):
                            pass
                    await self.send(raw)

            tasks = [asyncio.create_task(from_device()), asyncio.create_task(from_cloud())]
            try:
                done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    task.result()
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
        except Exception as error:
            print('Wi-Fi relay ended:', type(error).__name__, flush=True)
        finally:
            self.connected = False
            self.writer = None
            self.upstream_writer = None
            self.session_id = ''
            if self.voice:
                self.voice.cancel()
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(ConnectionError('Device disconnected'))
            for stream in (writer, upstream):
                if stream:
                    stream.close()
                    try:
                        await stream.wait_closed()
                    except (ConnectionError, asyncio.CancelledError):
                        pass


def create_app(gateway):
    @asynccontextmanager
    async def lifespan(app):
        server = await asyncio.start_server(gateway.relay, gateway.lan_ip, 1883)
        if gateway.voice:
            await asyncio.get_running_loop().create_datagram_endpoint(lambda: gateway.voice,
                local_addr=(gateway.lan_ip, 8767))
        async with server:
            yield
        if gateway.voice:
            gateway.voice.close()
        server.close()
        await server.wait_closed()

    app = FastAPI(lifespan=lifespan)

    def local(request):
        if request.client.host not in {'127.0.0.1', '::1', 'testclient'}:
            raise HTTPException(403, 'Control is loopback-only')

    @app.post('/ota/')
    async def ota(request: Request):
        if (request.client.host != gateway.device_ip or
            request.headers.get('device-id', '').upper() != gateway.mac):
            raise HTTPException(403, 'Device not authorized')
        body = await request.body()
        if len(body) > 65536:
            raise HTTPException(413, 'Request too large')
        headers = {k: v for k, v in request.headers.items() if k.lower() in {
            'device-id', 'client-id', 'activation-version', 'user-agent',
            'accept-language', 'serial-number', 'content-type'}}

        def fetch():
            req = urllib.request.Request('https://api.tenclass.net/xiaozhi/ota/',
                                         data=body, headers=headers)
            with urllib.request.urlopen(req, timeout=20) as response:
                return json.load(response)

        try:
            result = await asyncio.to_thread(fetch)
            mqtt = result.get('mqtt')
            if not isinstance(mqtt, dict) or not all(isinstance(mqtt.get(k), str) and mqtt[k]
                for k in ('endpoint', 'publish_topic', 'subscribe_topic')):
                raise ValueError('MQTT configuration missing')
            # Verify the fixed upstream before sending a rewritten configuration.
            if mqtt['endpoint'] not in {'api.tenclass.net', 'api.tenclass.net:8883'}:
                raise ValueError('Unsupported upstream')
            gateway.config = {k: mqtt[k] for k in ('endpoint', 'publish_topic', 'subscribe_topic')}
            if gateway.routing_file:
                gateway.routing_file.parent.mkdir(parents=True, exist_ok=True)
                temporary = gateway.routing_file.with_suffix('.tmp')
                temporary.write_text(json.dumps(gateway.config))
                temporary.chmod(0o600)
                temporary.replace(gateway.routing_file)
            mqtt['endpoint'] = gateway.lan_ip + ':1883'
            # This gateway never triggers automatic firmware changes.
            result.pop('firmware', None)
            return result
        except Exception as error:
            print('OTA relay failed:', type(error).__name__, flush=True)
            raise HTTPException(502, 'Cloud configuration unavailable') from None

    @app.get('/status')
    async def status(request: Request):
        local(request)
        return gateway.status()

    @app.get('/voice/status')
    async def voice_status(request: Request):
        local(request)
        return {'enabled': gateway.voice is not None,
                **(gateway.voice.state if gateway.voice else {})}

    class ButtonRoute(BaseModel):
        route: str = Field(pattern='^(agentcenter|doubao)$')

    @app.post('/voice/button-route')
    async def button_route(body: ButtonRoute, request: Request):
        local(request)
        if not gateway.voice:
            raise HTTPException(503, 'Voice router unavailable')
        if body.route == 'doubao' and not gateway.voice.doubao:
            raise HTTPException(503, 'Doubao speech credentials not configured')
        if body.route == 'agentcenter' and gateway.voice.model is None:
            raise HTTPException(503, 'AgentCenter ASR not configured')
        gateway.voice.button_route = body.route
        gateway.voice.state['button_route'] = body.route
        return {'success': True, 'button_route': body.route, 'effective': 'next conversation'}

    @app.get('/tools')
    async def tools(request: Request):
        local(request)
        try:
            return await gateway.rpc('tools/list', {})
        except (ConnectionError, ValueError, TimeoutError):
            raise HTTPException(503, 'Device reply unavailable') from None

    class Call(BaseModel):
        name: str
        arguments: dict = Field(default_factory=dict)

    @app.post('/call')
    async def call(body: Call, request: Request):
        local(request)
        try:
            validate_call(body.name, body.arguments)
        except ValueError as error:
            raise HTTPException(400, str(error)) from None
        try:
            result = await gateway.rpc('tools/call', body.model_dump())
            return {'success': not result.get('isError', False), 'result': result,
                    'transport': 'Wi-Fi', 'device_reply_received': True}
        except (ConnectionError, ValueError, TimeoutError):
            raise HTTPException(503, 'Device reply unavailable') from None

    return app


if __name__ == '__main__':
    import uvicorn
    lan_ip = os.environ['VELXIO_XIAOZHI_LAN_IP']
    gateway = Gateway(lan_ip, routing_file=Path(__file__).resolve().parents[4]/'logs/xiaozhi-wifi-routing.json')
    credentials = os.environ.get('VELXIO_AGENTCENTER_DEVICE_CONFIG')
    doubao_config = os.environ.get('VELXIO_DOUBAO_CONFIG')
    if credentials or doubao_config:
        from .agentcenter_voice import VoiceRouter
        model = None
        if credentials and os.environ.get('VELXIO_VOICE_ASR_BACKEND') == 'sensevoice':
            from .agentcenter_voice import SenseVoiceASR
            model = SenseVoiceASR(os.environ['VELXIO_VOICE_ASR_MODEL'])
        elif credentials:
            from faster_whisper import WhisperModel
            model = WhisperModel(os.environ['VELXIO_VOICE_ASR_MODEL'], device='cpu', compute_type='int8')
        from .doubao_voice import DoubaoClient
        doubao = DoubaoClient(doubao_config) if doubao_config else None
        button_route = os.environ.get('VELXIO_BUTTON_ROUTE', 'doubao' if doubao else 'agentcenter')
        gateway.voice = VoiceRouter(gateway, model, credentials or '', doubao=doubao, button_route=button_route)
    uvicorn.run(create_app(gateway), host='0.0.0.0', port=8766,
                access_log=False, log_level='warning')
