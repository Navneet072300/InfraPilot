import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useClusterStore } from '../store/clusterStore';
import type { ClusterOverview, K8sPod } from '../types';

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function useClusterHealth(clusterName: string | null) {
  const setHealth = useClusterStore((s) => s.setHealth);

  const query = useQuery({
    queryKey: ['cluster-health', clusterName],
    queryFn: () =>
      apiFetch<{ healthy: boolean; configured: boolean; node_count?: number; version?: string; cluster_name: string; error?: string }>(
        `/api/k8s/health${clusterName ? `?cluster=${clusterName}` : ''}`
      ),
    refetchInterval: 30_000,
    retry: 1,
    enabled: true,
  });

  useEffect(() => {
    if (query.data) {
      setHealth(clusterName ?? 'default', query.data);
    }
  }, [query.data, clusterName, setHealth]);

  return query;
}

export function useNamespaces(clusterName: string | null) {
  const setNamespaces = useClusterStore((s) => s.setNamespaces);

  const query = useQuery({
    queryKey: ['namespaces', clusterName],
    queryFn: () =>
      apiFetch<{ namespaces: string[] }>(
        `/api/k8s/namespaces${clusterName ? `?cluster=${clusterName}` : ''}`
      ),
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (query.data?.namespaces) {
      setNamespaces(clusterName ?? 'default', query.data.namespaces);
    }
  }, [query.data, clusterName, setNamespaces]);

  return query;
}

export function usePods(clusterName: string | null, namespace: string) {
  return useQuery({
    queryKey: ['pods', clusterName, namespace],
    queryFn: () =>
      apiFetch<{ pods: K8sPod[] }>(
        `/api/k8s/pods?namespace=${namespace}${clusterName ? `&cluster=${clusterName}` : ''}`
      ),
    refetchInterval: 15_000,
    retry: 1,
  });
}

export function useClusterOverview(clusterName: string | null) {
  return useQuery({
    queryKey: ['overview', clusterName],
    queryFn: () =>
      apiFetch<ClusterOverview>(
        `/api/k8s/overview${clusterName ? `?cluster=${clusterName}` : ''}`
      ),
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useResources(clusterName: string | null, namespace: string) {
  return useQuery({
    queryKey: ['resources', clusterName, namespace],
    queryFn: () =>
      apiFetch<{
        pods: Record<string, unknown>[];
        services: Record<string, unknown>[];
        deployments: Record<string, unknown>[];
        statefulsets: Record<string, unknown>[];
        daemonsets: Record<string, unknown>[];
        replicasets: Record<string, unknown>[];
        error?: string;
      }>(
        `/api/k8s/resources?namespace=${namespace}${clusterName ? `&cluster=${clusterName}` : ''}`
      ),
    refetchInterval: 15_000,
    retry: 1,
    enabled: !!clusterName,
  });
}

export function useNodeMetrics(clusterName: string | null) {
  return useQuery({
    queryKey: ['node-metrics', clusterName],
    queryFn: () =>
      apiFetch<{ metrics: { name: string; cpu_cores: string; cpu_percent: string; memory_bytes: string; memory_percent: string }[]; error?: string }>(
        `/api/k8s/node-metrics${clusterName ? `?cluster=${clusterName}` : ''}`
      ),
    refetchInterval: 30_000,
    retry: 1,
    enabled: !!clusterName,
  });
}

export function usePlatformConfig() {
  return useQuery({
    queryKey: ['platform-config'],
    queryFn: () =>
      apiFetch<{ configured: boolean; clusters?: { name: string; environment: string; active: boolean }[] }>(
        '/api/platform/config'
      ),
    staleTime: 5_000,
    retry: 1,
  });
}
