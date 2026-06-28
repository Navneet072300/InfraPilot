import { create } from 'zustand';
import type { PlatformConfig } from '../types';

interface PlatformState {
  config: PlatformConfig | null;
  loading: boolean;
  error: string | null;

  setConfig: (c: PlatformConfig) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
  reset: () => void;
}

export const usePlatformStore = create<PlatformState>((set) => ({
  config: null,
  loading: false,
  error: null,

  setConfig: (c) => set({ config: c, loading: false, error: null }),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e, loading: false }),
  reset: () => set({ config: null, loading: false, error: null }),
}));
