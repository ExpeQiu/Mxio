"""Non-flashing USB channel for devices with existing firmware."""
import re
from app.services.hwexec.esp32 import Esp32Usb, valid_port
from app.services.hwexec.tasks import get_store


def summarize(logs: str) -> dict:
    # Return selected evidence only. Never expose raw firmware logs / credentials.
    evidence = []
    for line in logs.splitlines():
        if re.search(r'password|token|authorization|secret|api.?key|activation.?code|激活码', line, re.I):
            continue
        if re.search(r'ESP-ROM|rst:|App version|SKU=|Got IP|MQTT:|StateMachine:|Activation done', line):
            evidence.append(line[:500])
    text = '\n'.join(evidence)
    states = re.findall(r'State: \S+ -> (\S+)', text)
    ips = re.findall(r'Got IP: ([0-9.]+)', text)
    return {'boot_observed': bool(re.search(r'ESP-ROM|rst:', text)),
            'mqtt_connected_observed': 'MQTT: Connected to endpoint' in text,
            'last_state_observed': states[-1] if states else None,
            'ip_observed': ips[-1] if ips else None,
            'evidence': evidence[-50:]}


async def device_channel(port: str, action: str, duration_s: float, usb=None, store=None) -> dict:
    if not valid_port(port) or action not in {'observe', 'restart'}:
        return {'success': False, 'error_code': 'USAGE'}
    store = store or get_store()
    task_id = store.create('esp32-channel', port)
    if not store.acquire(port, task_id):
        result = {'success': False, 'error_code': 'DEVICE_BUSY', 'task_id': task_id}
        store.finish(task_id, 'failed', result, 'Device busy')
        return result
    try:
        store.mark(task_id, 'running')
        captured = await (usb or Esp32Usb()).capture(port, 115200, duration_s, '', reset=action == 'restart')
        observed = summarize(captured.get('logs', ''))
        success = bool(captured.get('ok')) and (action != 'restart' or observed['boot_observed'])
        result = {'success': success, 'task_id': task_id, 'port': port, 'action': action,
                  'transport': 'usb-serial', 'requested_reset': action == 'restart',
                  'firmware_written': False, **observed,
                  'error_code': None if success else 'NO_BOOT_EVIDENCE' if captured.get('ok') else 'SERIAL',
                  'error': None if success else 'No boot evidence' if captured.get('ok') else 'Serial capture failed',
                  'capabilities': ['observe', 'restart'],
                  'business_control_ready': False}
        store.finish(task_id, 'succeeded' if success else 'failed', result, result['error'])
        return result
    except BaseException:
        store.finish(task_id, 'failed', {'success': False}, 'Channel interrupted')
        raise
    finally:
        store.release(port, task_id)
