import { useAuthStore } from '../store/authStore';
import { getTerm, SEVERITY_LABELS } from '../lib/terminology';
import type { TermKey, ExperienceLevel } from '../lib/terminology';

export function useExperienceLevel(): ExperienceLevel {
  const user = useAuthStore((s) => s.user);
  return user?.experience_level ?? 'devops';
}

export function useIsBuilder(): boolean {
  const level = useExperienceLevel();
  return level === 'builder' || level === 'learning';
}

export function useTerm(key: TermKey): string {
  const level = useExperienceLevel();
  return getTerm(key, level);
}

export function useSeverityLabel(severity: string): string {
  const level = useExperienceLevel();
  return SEVERITY_LABELS[severity.toLowerCase()]?.[level] ?? severity.toUpperCase();
}
