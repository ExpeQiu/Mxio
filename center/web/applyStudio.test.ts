import { describe, expect, it, beforeEach } from 'vitest';
import { useEditorStore } from '@velxio/store/useEditorStore';
import { useMotion3dStore } from '@velxio/store/useMotion3dStore';
import { applyStudioAuto } from './applyStudio';

describe('applyStudioAuto', () => {
  beforeEach(() => {
    useEditorStore.getState().setViewMode('both');
    useMotion3dStore.getState().setOpen(false);
  });

  it('enters studio for the vision arm example', () => {
    applyStudioAuto('esp32cam-ai-arm', ['velxio-servo', 'wokwi-led']);
    expect(useEditorStore.getState().viewMode).toBe('studio');
    expect(useMotion3dStore.getState().open).toBe(true);
  });

  it('leaves studio when loading a chat-only example', () => {
    useEditorStore.getState().setViewMode('studio');
    useMotion3dStore.getState().setOpen(true);
    applyStudioAuto('esp32-ai-chat', ['wokwi-ssd1306']);
    expect(useEditorStore.getState().viewMode).toBe('both');
    expect(useMotion3dStore.getState().open).toBe(false);
  });

  it('does not force studio for blink', () => {
    applyStudioAuto(null, ['wokwi-led']);
    expect(useEditorStore.getState().viewMode).toBe('both');
  });
});
