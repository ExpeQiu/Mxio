/**
 * Doorbell for the component picker modal (lives in SimulatorCanvas).
 * EditorToolbar's "添加" button rings this so the modal stays next to
 * the canvas handlers that actually place parts.
 */

type Opener = () => void;

let opener: Opener | null = null;

export function registerComponentPickerOpener(fn: Opener | null): void {
  opener = fn;
}

export function openComponentPicker(): void {
  if (!opener) {
    console.warn('[component-picker] open requested but no canvas opener registered');
    return;
  }
  opener();
}
