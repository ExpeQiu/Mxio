export function nowNs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return Math.round(performance.now() * 1e6);
  }
  if (typeof process !== 'undefined' && process.hrtime?.bigint) {
    return Number(process.hrtime.bigint());
  }
  return Date.now() * 1e6;
}
