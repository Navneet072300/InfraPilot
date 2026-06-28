import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Plan = 'free' | 'pro' | 'team' | 'enterprise';

export interface UserProfile {
  name: string;
  email: string;
  avatar: string | null; // base64 data URL or null
  plan: Plan;
  company: string;
  role: string;
}

interface ProfileState extends UserProfile {
  setProfile: (updates: Partial<UserProfile>) => void;
  setAvatar: (dataUrl: string | null) => void;
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      name: 'Navneet Shahi',
      email: 'navneetshahi345@gmail.com',
      avatar: null,
      plan: 'pro',
      company: 'InfraPilot',
      role: 'DevOps Engineer',

      setProfile: (updates) => set((s) => ({ ...s, ...updates })),
      setAvatar: (dataUrl) => set({ avatar: dataUrl }),
    }),
    { name: 'infrapilot-profile' }
  )
);
