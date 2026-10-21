import { create } from 'zustand';

interface CenterState {
  firmwareOpen: boolean;
  setFirmwareOpen: (open: boolean) => void;
  toggleFirmware: () => void;
}

export const useCenterStore = create<CenterState>((set) => ({
  firmwareOpen: false,
  setFirmwareOpen: (open) => set({ firmwareOpen: open }),
  toggleFirmware: () => set((s) => ({ firmwareOpen: !s.firmwareOpen })),
}));
