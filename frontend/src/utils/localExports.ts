/**
 * 本地导出：物料清单和原理图，不经过付费接口。
 */
import { useSimulatorStore } from '../store/useSimulatorStore';

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function downloadBillOfMaterials(): void {
  const { boards, components } = useSimulatorStore.getState();
  const rows: string[][] = [['类别', '名称', '标识', '数量']];
  const tally = new Map<string, { kind: string; name: string; count: number }>();
  const add = (kind: string, name: string) => {
    const key = `${kind}:${name}`;
    const prev = tally.get(key);
    if (prev) prev.count += 1;
    else tally.set(key, { kind, name, count: 1 });
  };
  for (const board of boards) add('开发板', board.name || board.boardKind);
  for (const part of components) add('元件', part.metadataId || part.id);
  if (tally.size === 0) throw new Error('画布上还没有开发板或元件。');
  for (const item of tally.values()) {
    rows.push([item.kind, item.name, item.name, String(item.count)]);
  }
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  downloadBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), '物料清单.csv');
}

export function downloadSchematicPng(): void {
  const { boards, components, wires } = useSimulatorStore.getState();
  const nodes = [
    ...boards.map((board) => ({
      x: board.x,
      y: board.y,
      w: 200,
      h: 120,
      label: board.name || board.boardKind,
    })),
    ...components.map((part) => ({
      x: part.x,
      y: part.y,
      w: 96,
      h: 48,
      label: part.metadataId || part.id,
    })),
  ];
  if (nodes.length === 0 && wires.length === 0) {
    throw new Error('画布上还没有电路。');
  }
  const xs = nodes.flatMap((n) => [n.x, n.x + n.w]);
  const ys = nodes.flatMap((n) => [n.y, n.y + n.h]);
  for (const wire of wires) {
    xs.push(wire.start.x, wire.end.x, ...wire.waypoints.map((p) => p.x));
    ys.push(wire.start.y, wire.end.y, ...wire.waypoints.map((p) => p.y));
  }
  const minX = Math.min(...xs, 0);
  const minY = Math.min(...ys, 0);
  const maxX = Math.max(...xs, 200);
  const maxY = Math.max(...ys, 120);
  const pad = 48;
  const width = Math.max(320, Math.ceil(maxX - minX + pad * 2));
  const height = Math.max(240, Math.ceil(maxY - minY + pad * 2));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布。');
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, width, height);
  const ox = pad - minX;
  const oy = pad - minY;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (const wire of wires) {
    const points = [wire.start, ...wire.waypoints, wire.end];
    ctx.strokeStyle = wire.color || '#4c9aff';
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = point.x + ox;
      const y = point.y + oy;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.font = '12px sans-serif';
  ctx.textBaseline = 'middle';
  for (const node of nodes) {
    const x = node.x + ox;
    const y = node.y + oy;
    ctx.fillStyle = '#2a2d2e';
    ctx.strokeStyle = '#007acc';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, node.w, node.h);
    ctx.strokeRect(x, y, node.w, node.h);
    ctx.fillStyle = '#e6edf3';
    ctx.fillText(node.label, x + 8, y + node.h / 2, node.w - 16);
  }
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, '原理图.png');
  }, 'image/png');
}
