import { useCallback, useRef, useState } from 'react';
import type { PipelineTask, PipelineConfig, AgentEvent, GeneratedFile } from '../types';

export const INITIAL_TASKS: Omit<PipelineTask, 'status' | 'output' | 'files' | 'error' | 'fix'>[] = [
  { id: 1, title: 'Generate GitHub Actions CI Pipeline', description: 'Creates .github/workflows/ci.yml', stubbed: false },
  { id: 2, title: 'Generate Kustomize Base Manifests', description: 'Creates k8s/base/ deployment, service, kustomization', stubbed: false },
  { id: 3, title: 'Generate Environment Overlays', description: 'Creates k8s/overlays/dev/ and k8s/overlays/prod/', stubbed: false },
  { id: 4, title: 'Store Secrets in Vault', description: 'Writes to secret/{app}/dev and secret/{app}/prod', stubbed: true },
  { id: 5, title: 'Apply Vault Policies to Clusters', description: 'vault policy write + k8s auth role binding', stubbed: true },
  { id: 6, title: 'Push Manifests to GitOps Repo', description: 'Commit and push generated files via GitHub API', stubbed: false },
  { id: 7, title: 'Create ArgoCD Application', description: 'ArgoCD Application manifest + automated sync', stubbed: true },
  { id: 8, title: 'Watch Rollout', description: 'kubectl rollout status until healthy', stubbed: false },
  { id: 9, title: 'Troubleshoot', description: 'Auto-triggered if step 8 fails — reads logs + events', stubbed: false },
  { id: 10, title: 'Get Service URL', description: 'kubectl get svc / ingress → extract public URL', stubbed: false },
  { id: 11, title: 'Configure Cloudflare DNS', description: 'Point target URL → LoadBalancer IP', stubbed: true },
];

function makeTasks(): PipelineTask[] {
  return INITIAL_TASKS.map((t) => ({
    ...t,
    status: 'pending',
    output: '',
    files: [],
  }));
}

export function useAgent() {
  const [tasks, setTasks] = useState<PipelineTask[]>(makeTasks);
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const updateTask = useCallback(
    (id: number, patch: Partial<PipelineTask>) =>
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
      ),
    []
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setTasks(makeTasks());
    setIsRunning(false);
    setIsDone(false);
  }, []);

  const runAll = useCallback(
    async (config: PipelineConfig) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setTasks(makeTasks());
      setIsRunning(true);
      setIsDone(false);

      try {
        const res = await fetch('/api/agent/pipeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            try {
              const ev = JSON.parse(raw) as AgentEvent;

              // Capture run_id from first SSE event
              if ((ev as Record<string, unknown>).type === 'started' && (ev as Record<string, unknown>).run_id) {
                setRunId((ev as Record<string, unknown>).run_id as string);
                continue;
              }

              if ((ev as Record<string, unknown>).type === 'aborted' || ev.pipeline === 'aborted') {
                setIsDone(true);
                setRunId(null);
                continue;
              }

              if (ev.pipeline) {
                setIsDone(true);
                setRunId(null);
                continue;
              }

              const id = ev.task;
              if (!id) continue;

              switch (ev.status) {
                case 'running':
                  updateTask(id, { status: 'running', output: '' });
                  break;
                case 'chunk':
                  setTasks((prev) =>
                    prev.map((t) =>
                      t.id === id ? { ...t, output: t.output + (ev.content ?? '') } : t
                    )
                  );
                  break;
                case 'done':
                  updateTask(id, {
                    status: 'done',
                    files: (ev.files as GeneratedFile[]) ?? [],
                  });
                  break;
                case 'failed':
                  updateTask(id, {
                    status: 'failed',
                    error: ev.error,
                    fix: ev.fix,
                  });
                  break;
                case 'skipped':
                  updateTask(id, { status: 'skipped' });
                  break;
              }
            } catch {
              // skip partial JSON
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Pipeline error:', err.message);
        }
      } finally {
        setIsRunning(false);
      }
    },
    [updateTask]
  );

  const abort = useCallback(async () => {
    // Tell backend to stop the run
    if (runId) {
      try {
        await fetch(`/api/agent/pipeline/${runId}/abort`, { method: 'POST' });
      } catch { /* ignore */ }
      setRunId(null);
    }
    abortRef.current?.abort();
    setIsRunning(false);
  }, [runId]);

  return { tasks, isRunning, isDone, runAll, reset, abort, runId };
}
