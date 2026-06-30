import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number; // ms, default 4000
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    }, t.duration ?? 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

// Convenience helpers usable outside React components
export const toast = {
  success: (title: string, message?: string) =>
    useToastStore.getState().push({ type: 'success', title, message }),
  error: (title: string, message?: string) =>
    useToastStore.getState().push({ type: 'error', title, message }),
  warning: (title: string, message?: string) =>
    useToastStore.getState().push({ type: 'warning', title, message }),
  info: (title: string, message?: string) =>
    useToastStore.getState().push({ type: 'info', title, message }),
};
