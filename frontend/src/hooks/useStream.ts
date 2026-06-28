import { useCallback, useRef, useState } from 'react';

interface StreamCallbacks {
  onChunk?: (chunk: string) => void;
  onEvent?: (event: Record<string, unknown>) => void;
  onDone?: (meta: Record<string, unknown>) => void;
  onError?: (err: string) => void;
}

export function useStream(endpoint: string, callbacks: StreamCallbacks) {
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const retriesRef = useRef(0);

  const start = useCallback(
    async (body: Record<string, unknown>) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      retriesRef.current = 0;

      const attempt = async () => {
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!res.ok) {
            const text = await res.text();
            throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
          }

          const reader = res.body?.getReader();
          if (!reader) throw new Error('No response body');

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
                const parsed = JSON.parse(raw) as Record<string, unknown>;
                if (parsed.error) {
                  callbacks.onError?.(String(parsed.error));
                  return;
                }
                if (parsed.done) {
                  callbacks.onDone?.(parsed);
                } else if (typeof parsed.chunk === 'string') {
                  callbacks.onChunk?.(parsed.chunk);
                } else {
                  callbacks.onEvent?.(parsed);
                }
              } catch {
                // partial JSON — skip
              }
            }
          }
        } catch (err: unknown) {
          if (err instanceof Error) {
            if (err.name === 'AbortError') return;
            if (retriesRef.current < 3) {
              retriesRef.current++;
              await new Promise((r) => setTimeout(r, 1000 * retriesRef.current));
              return attempt();
            }
            callbacks.onError?.(err.message);
          }
        }
      };

      try {
        await attempt();
      } finally {
        setLoading(false);
      }
    },
    [endpoint, callbacks]
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  return { loading, start, abort };
}
