"""Read-only Velxio tools served on a XiaoZhi cloud MCP endpoint.

Run with VELXIO_XIAOZHI_ENDPOINT in the environment. It is never logged.
This exposes host tools to XiaoZhi; it does not impersonate the device's MQTT session.
"""
import asyncio
import json
import os
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

TOOLS = [{
    'name': 'velxio_device_channel_status',
    'description': '查询 Velxio 的小智设备通道。Wi-Fi 可用时实时读取设备音量、屏幕亮度和网络状态；USB 验收结果另标为历史观测。不会重启或烧录设备。',
    'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False},
}]


def local_status():
    base = os.environ.get('VELXIO_API_URL', 'http://127.0.0.1:8001').rstrip('/')
    headers = {}
    if os.environ.get('VELXIO_EXEC_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['VELXIO_EXEC_TOKEN']

    def get(path):
        with urllib.request.urlopen(urllib.request.Request(base + path, headers=headers), timeout=5) as response:
            return json.load(response)

    devices = get('/api/exec/esp32/devices')['devices']
    found = next((d for d in devices if '84:C7:BB:60:21:94' in d.get('hwid', '').upper()), None)
    tasks = get('/api/exec/tasks?limit=50')['tasks']
    latest = next((t for t in tasks if found and t.get('device') == found['port']
                   and t.get('kind') == 'esp32-channel' and t.get('status') == 'succeeded'), None)
    result = (latest or {}).get('result') or {}
    result_data = {'usb_present': found is not None, 'port': found['port'] if found else None,
            'device_mac': '84:C7:BB:60:21:94', 'observation_is_historical': True,
            'last_test_time_unix': (latest or {}).get('updated_at'),
            'last_state_observed': result.get('last_state_observed'),
            'last_test_boot_observed': result.get('boot_observed'),
            'device_business_control_ready': False,
            'channel': 'XiaoZhi cloud MCP -> Velxio read-only host tool',
            'usb_control_capabilities': ['observe', 'restart']}
    try:
        req = urllib.request.Request('http://127.0.0.1:8766/call',
            data=json.dumps({'name': 'self.get_device_status', 'arguments': {}}).encode(),
            headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=20) as response:
            wifi = json.load(response)
        if not wifi.get('success') or not wifi.get('device_reply_received'):
            raise ValueError('No device success reply')
        state = json.loads(wifi['result']['content'][0]['text'])
        result_data.update(wifi_live_status=state, wifi_observation_is_historical=False,
            device_business_control_ready=True, wifi_control_capabilities=['status', 'volume', 'brightness'])
    except Exception:
        result_data.update(wifi_live_status=None, wifi_error='Live device reply unavailable')
    return result_data


async def handle(message, status_fn=local_status):
    if not isinstance(message, dict) or message.get('jsonrpc') != '2.0':
        return {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': 'Invalid request'}}
    if 'id' not in message:
        return None
    reply = {'jsonrpc': '2.0', 'id': message['id']}
    method = message.get('method')
    params = message.get('params') or {}
    if not isinstance(params, dict):
        return {**reply, 'error': {'code': -32602, 'message': 'Invalid params'}}
    if method == 'initialize':
        version = params.get('protocolVersion')
        if version not in {'2024-11-05', '2025-03-26', '2025-06-18'}:
            version = '2024-11-05'
        result = {'protocolVersion': version, 'capabilities': {'tools': {}},
                  'serverInfo': {'name': 'velxio-device-channel', 'version': '0.1.0'}}
    elif method == 'ping':
        result = {}
    elif method == 'tools/list':
        result = {'tools': TOOLS}
    elif method == 'tools/call':
        if params.get('name') != TOOLS[0]['name'] or params.get('arguments', {}) != {}:
            return {**reply, 'error': {'code': -32602, 'message': 'Unknown tool or invalid arguments'}}
        try:
            data = await asyncio.to_thread(status_fn)
            result = {'content': [{'type': 'text', 'text': json.dumps(data, ensure_ascii=False)}]}
        except Exception:
            result = {'isError': True, 'content': [{'type': 'text', 'text': 'Velxio backend unavailable'}]}
    else:
        return {**reply, 'error': {'code': -32601, 'message': 'Method not found'}}
    return {**reply, 'result': result}


async def serve():
    import websockets
    endpoint = os.environ.get('VELXIO_XIAOZHI_ENDPOINT', '')
    parsed = urlsplit(endpoint)
    if parsed.scheme != 'wss' or parsed.hostname != 'api.xiaozhi.me' or parsed.path != '/mcp/':
        raise SystemExit('Set VELXIO_XIAOZHI_ENDPOINT to the authorized XiaoZhi MCP endpoint')
    report = Path(os.environ.get('VELXIO_XIAOZHI_REPORT', 'logs/xiaozhi-mcp-bridge.json'))
    report.parent.mkdir(parents=True, exist_ok=True)
    state = {'connected': False, 'initialized': False, 'tools_listed': False, 'tool_calls': 0}
    try:
        previous = json.loads(report.read_text())
        if type(previous.get('tool_calls')) is int and previous['tool_calls'] >= 0:
            state['tool_calls'] = previous['tool_calls']
    except (OSError, ValueError, TypeError):
        pass

    def save():
        state['updated_at_unix'] = time.time()
        temporary = report.with_suffix('.tmp')
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
        temporary.replace(report)

    delay = 1
    while True:
        try:
            async with websockets.connect(endpoint, open_timeout=15, max_size=65536,
                                          ping_interval=20, ping_timeout=20) as websocket:
                state.update(connected=True, initialized=False, tools_listed=False, last_error=None)
                save()
                print('XiaoZhi MCP connected', flush=True)
                delay = 1
                async for raw in websocket:
                    try:
                        message = json.loads(raw)
                    except (ValueError, TypeError):
                        await websocket.send(json.dumps({'jsonrpc': '2.0', 'id': None,
                            'error': {'code': -32700, 'message': 'Parse error'}}))
                        continue
                    response = await handle(message)
                    if response is not None:
                        await websocket.send(json.dumps(response, ensure_ascii=False))
                        method = message.get('method') if isinstance(message, dict) else None
                        if method == 'initialize' and 'result' in response: state['initialized'] = True
                        if method == 'tools/list' and 'result' in response: state['tools_listed'] = True
                        if method == 'tools/call' and 'result' in response:
                            state['tool_calls'] += 1
                            state['last_call_ok'] = not response['result'].get('isError', False)
                            state['last_tool_call_unix'] = time.time()
                        save()
                        print('MCP request handled:', method, flush=True)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            # Exception strings may contain the credential-bearing URI.
            state.update(connected=False, initialized=False, tools_listed=False,
                         last_error=type(error).__name__)
            save()
            print('MCP disconnected:', type(error).__name__, flush=True)
        await asyncio.sleep(delay)
        delay = min(60, delay * 2)


if __name__ == '__main__':
    asyncio.run(serve())
