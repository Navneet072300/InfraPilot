import { create } from 'zustand';
import type { ActiveMode, GeneratedFile, ArchitectureData } from '../types';

interface AppState {
  activeMode: ActiveMode;
  sidebarCollapsed: boolean;

  // Generate
  generateInput: string;
  generatedFiles: GeneratedFile[];
  activeFileTab: string;
  isGenerating: boolean;
  generateMeta: { elapsed?: number; lines?: number; costEstimate?: string } | null;

  // Diagnose
  diagnoseInput: string;
  diagnoseRaw: string;
  isDiagnosing: boolean;

  // Design
  designInput: string;
  designBudget: number;
  designCloud: string;
  designCompliance: string[];
  architectureData: ArchitectureData | null;
  architectureRaw: string;
  isDesigning: boolean;
  designActiveTab: string;

  setActiveMode: (m: ActiveMode) => void;
  setSidebarCollapsed: (v: boolean) => void;

  setGenerateInput: (v: string) => void;
  setGeneratedFiles: (f: GeneratedFile[]) => void;
  setActiveFileTab: (t: string) => void;
  setIsGenerating: (v: boolean) => void;
  setGenerateMeta: (m: AppState['generateMeta']) => void;

  setDiagnoseInput: (v: string) => void;
  appendDiagnoseRaw: (s: string) => void;
  resetDiagnoseRaw: () => void;
  setIsDiagnosing: (v: boolean) => void;

  setDesignInput: (v: string) => void;
  setDesignBudget: (v: number) => void;
  setDesignCloud: (v: string) => void;
  setDesignCompliance: (v: string[]) => void;
  setArchitectureData: (d: ArchitectureData | null) => void;
  appendArchitectureRaw: (s: string) => void;
  setIsDesigning: (v: boolean) => void;
  setDesignActiveTab: (t: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeMode: 'pipeline',
  sidebarCollapsed: false,

  generateInput: 'Create a production-ready EKS cluster with managed node groups, auto-scaling, and IRSA configured',
  generatedFiles: [],
  activeFileTab: '',
  isGenerating: false,
  generateMeta: null,

  diagnoseInput: '',
  diagnoseRaw: '',
  isDiagnosing: false,

  designInput: '',
  designBudget: 1000,
  designCloud: '',
  designCompliance: [],
  architectureData: null,
  architectureRaw: '',
  isDesigning: false,
  designActiveTab: 'architecture',

  setActiveMode: (m) => set({ activeMode: m }),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

  setGenerateInput: (v) => set({ generateInput: v }),
  setGeneratedFiles: (f) => set((state) => ({
    generatedFiles: f,
    // Preserve the user's tab selection if that file still exists; otherwise fall back to first file
    activeFileTab: f.some((file) => file.path === state.activeFileTab)
      ? state.activeFileTab
      : (f[0]?.path ?? ''),
  })),
  setActiveFileTab: (t) => set({ activeFileTab: t }),
  setIsGenerating: (v) => set({ isGenerating: v }),
  setGenerateMeta: (m) => set({ generateMeta: m }),

  setDiagnoseInput: (v) => set({ diagnoseInput: v }),
  appendDiagnoseRaw: (s) => set((st) => ({ diagnoseRaw: st.diagnoseRaw + s })),
  resetDiagnoseRaw: () => set({ diagnoseRaw: '' }),
  setIsDiagnosing: (v) => set({ isDiagnosing: v }),

  setDesignInput: (v) => set({ designInput: v }),
  setDesignBudget: (v) => set({ designBudget: v }),
  setDesignCloud: (v) => set({ designCloud: v }),
  setDesignCompliance: (v) => set({ designCompliance: v }),
  setArchitectureData: (d) => set({ architectureData: d }),
  appendArchitectureRaw: (s) => set((st) => ({ architectureRaw: st.architectureRaw + s })),
  setIsDesigning: (v) => set({ isDesigning: v }),
  setDesignActiveTab: (t) => set({ designActiveTab: t }),
}));
