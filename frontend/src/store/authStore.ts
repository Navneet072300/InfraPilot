import { create } from 'zustand';
import type { ExperienceLevel } from '../lib/terminology';

export interface AuthUser {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  plan: 'free' | 'pro' | 'team' | 'enterprise';
  provider: string;
  email_verified: boolean;
  phone_verified: boolean;
  avatar_color?: string;
  totp_enabled?: boolean;
  role?: string;
  experience_level: ExperienceLevel | null;
}

interface AuthState {
  user: AuthUser | null;
  isDemoMode: boolean;
  isLoading: boolean;
  login: (user: AuthUser) => void;
  logout: () => Promise<void>;
  setDemoMode: (v: boolean) => void;
  setUser: (user: Partial<AuthUser>) => void;
  isAuthenticated: () => boolean;
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  isDemoMode: false,
  isLoading: true,

  login: (user) => set({ user, isDemoMode: false }),

  setUser: (updates) => set((s) => ({ user: s.user ? { ...s.user, ...updates } : null })),

  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore network errors on logout
    }
    set({ user: null, isDemoMode: false });
  },

  setDemoMode: (v) => set({ isDemoMode: v }),

  isAuthenticated: () => {
    const { user, isDemoMode } = get();
    return isDemoMode || user !== null;
  },

  checkSession: async () => {
    set({ isLoading: true });
    try {
      const r = await fetch('/api/auth/me');
      if (r.ok) {
        const user = await r.json() as AuthUser;
        set({ user, isLoading: false });
      } else {
        set({ user: null, isLoading: false });
      }
    } catch {
      set({ user: null, isLoading: false });
    }
  },
}));
