/** 探测 3Dm 视口是否在听（跨端口，no-cors：通为 opaque，拒绝连接则抛错）。 */
export async function probe3dm(origin: string): Promise<boolean> {
  try {
    await fetch(origin, { mode: 'no-cors', cache: 'no-store' });
    return true;
  } catch {
    return false;
  }
}

export function threeDmOrigin(src: string): string {
  try {
    return new URL(src).origin;
  } catch {
    return 'http://127.0.0.1:5174';
  }
}
