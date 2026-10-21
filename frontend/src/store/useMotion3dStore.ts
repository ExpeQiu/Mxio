import { create } from 'zustand';

interface Motion3dState {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
}

export const useMotion3dStore = create<Motion3dState>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
}));
