import { parseAssert, parseDrive, resolveDrivePin } from '../src/sim/spice.ts';

const drive = parseDrive('gpio=17:1,23:1,5:1,16:1,27:0,24:0,6:0,13:0');
if (drive.length !== 8 || drive[0]!.pin !== '17' || !drive[0]!.high || drive[4]!.pin !== '27' || drive[4]!.high) {
  throw new Error('parseDrive gpio list failed');
}
const arduino = parseDrive('D13:HIGH,D12:0');
if (arduino[0]!.pin !== 'D13' || !arduino[0]!.high || arduino[1]!.high) {
  throw new Error('parseDrive named pins failed');
}
const wired = ['GPIO17', 'D13', '5V'];
if (resolveDrivePin('raspberry-pi-5', '17', wired) !== 'GPIO17') {
  throw new Error('resolveDrivePin Pi failed');
}
if (resolveDrivePin('arduino-uno', '13', ['D13']) !== 'D13') {
  throw new Error('resolveDrivePin Uno failed');
}
const a = parseAssert('current:m_fl>5mA');
if (a.kind !== 'current' || a.target !== 'm_fl' || a.op !== '>' || Math.abs(a.value - 0.005) > 1e-12) {
  throw new Error('parseAssert current failed');
}
const v = parseAssert('voltage:vm>2.4V');
if (v.kind !== 'voltage' || v.target !== 'vm' || Math.abs(v.value - 2.4) > 1e-12) {
  throw new Error('parseAssert voltage failed');
}
console.log('ok parse-drive');
