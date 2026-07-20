import { create } from 'zustand';
import type { ClusterConfig, ClusterHealth } from '../types';

interface ClusterState {
  clusters: ClusterConfig[];
  activeCluster: string | null;
  activeNamespace: string;
  health: Record<string, ClusterHealth>;
  namespaces: Record<string, string[]>;

  setClusters: (c: ClusterConfig[]) => void;
  addCluster: (c: ClusterConfig) => void;
  updateCluster: (name: string, updates: Partial<ClusterConfig>) => void;
  removeCluster: (name: string) => void;
  setActiveCluster: (name: string) => void;
  setActiveNamespace: (ns: string) => void;
  setHealth: (cluster: string, h: ClusterHealth) => void;
  setNamespaces: (cluster: string, ns: string[]) => void;
}

export const useClusterStore = create<ClusterState>((set) => ({
  clusters: [],
  activeCluster: null,
  activeNamespace: 'default',
  health: {},
  namespaces: {},

  setClusters: (c) =>
    set((s) => ({
      clusters: c,
      activeCluster: s.activeCluster ?? c.find((x) => x.active)?.name ?? c[0]?.name ?? null,
    })),

  addCluster: (c) =>
    set((s) => {
      const clusters = [...s.clusters, c];
      const activeCluster = s.activeCluster ?? c.name;
      return { clusters, activeCluster };
    }),

  updateCluster: (name, updates) =>
    set((s) => ({
      clusters: s.clusters.map((c) => (c.name === name ? { ...c, ...updates } : c)),
    })),

  removeCluster: (name) =>
    set((s) => {
      const clusters = s.clusters.filter((c) => c.name !== name);
      const activeCluster =
        s.activeCluster === name ? (clusters[0]?.name ?? null) : s.activeCluster;
      const health = { ...s.health };
      delete health[name];
      return { clusters, activeCluster, health };
    }),

  setActiveCluster: (name) => set({ activeCluster: name, activeNamespace: 'default' }),
  setActiveNamespace: (ns) => set({ activeNamespace: ns }),
  setHealth: (cluster, h) =>
    set((s) => ({ health: { ...s.health, [cluster]: h } })),
  setNamespaces: (cluster, ns) =>
    set((s) => ({ namespaces: { ...s.namespaces, [cluster]: ns } })),
}));
