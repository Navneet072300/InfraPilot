import { useAuthStore } from '../store/authStore';
import type { PlanFeature, GateResult, PlanTier } from '../types';

type FeatureConfig = {
  requiredPlan: 'pro' | 'team' | 'enterprise';
  allowedPlans: PlanTier[];
};

const FEATURE_REQUIREMENTS: Record<PlanFeature, FeatureConfig> = {
  design_mode:          { requiredPlan: 'pro',        allowedPlans: ['pro', 'team', 'enterprise'] },
  monitor_mode:         { requiredPlan: 'pro',        allowedPlans: ['pro', 'team', 'enterprise'] },
  unlimited_ai:         { requiredPlan: 'pro',        allowedPlans: ['pro', 'team', 'enterprise'] },
  custom_model:         { requiredPlan: 'pro',        allowedPlans: ['pro', 'team', 'enterprise'] },
  vault_integration:    { requiredPlan: 'pro',        allowedPlans: ['pro', 'team', 'enterprise'] },
  api_keys:             { requiredPlan: 'pro',        allowedPlans: ['pro', 'team', 'enterprise'] },
  pipeline_unlimited:   { requiredPlan: 'pro',        allowedPlans: ['pro', 'team', 'enterprise'] },
  diagnose_unlimited:   { requiredPlan: 'pro',        allowedPlans: ['pro', 'team', 'enterprise'] },
  team_seats:           { requiredPlan: 'team',       allowedPlans: ['team', 'enterprise'] },
  audit_log:            { requiredPlan: 'team',       allowedPlans: ['team', 'enterprise'] },
  sso:                  { requiredPlan: 'team',       allowedPlans: ['team', 'enterprise'] },
};

export function usePlanGate(feature: PlanFeature): GateResult {
  const { user } = useAuthStore();
  const plan = (user?.plan ?? 'free') as PlanTier;
  const config = FEATURE_REQUIREMENTS[feature];

  const allowed = config.allowedPlans.includes(plan);

  if (allowed) {
    return { allowed: true, requiredPlan: config.requiredPlan };
  }

  const REASON: Record<PlanFeature, string> = {
    design_mode: 'Architecture Design mode requires Pro or above',
    monitor_mode: 'Monitor Dashboard requires Pro or above',
    unlimited_ai: 'Unlimited AI requests require Pro or above',
    custom_model: 'Custom model endpoints require Pro or above',
    vault_integration: 'Vault & ArgoCD integrations require Pro or above',
    api_keys: 'API key generation requires Pro or above',
    pipeline_unlimited: 'Unlimited pipeline runs require Pro or above',
    diagnose_unlimited: 'Unlimited diagnose runs require Pro or above',
    team_seats: 'Team seats require Team plan',
    audit_log: 'Audit log requires Team plan',
    sso: 'SSO requires Team plan',
  };

  return {
    allowed: false,
    reason: REASON[feature],
    requiredPlan: config.requiredPlan,
  };
}

// Usage limit gate — checks if a daily usage cap has been hit
export function useDailyLimit(
  feature: 'ai_requests' | 'pipeline_runs' | 'diagnose_runs',
  used: number
): { blocked: boolean; limit: number | 'unlimited'; remaining: number | null } {
  const { user } = useAuthStore();
  const plan = (user?.plan ?? 'free') as PlanTier;

  const LIMITS: Record<PlanTier, Record<string, number | 'unlimited'>> = {
    free:       { ai_requests: 50, pipeline_runs: 3, diagnose_runs: 3 },
    pro:        { ai_requests: 'unlimited', pipeline_runs: 'unlimited', diagnose_runs: 'unlimited' },
    team:       { ai_requests: 'unlimited', pipeline_runs: 'unlimited', diagnose_runs: 'unlimited' },
    enterprise: { ai_requests: 'unlimited', pipeline_runs: 'unlimited', diagnose_runs: 'unlimited' },
  };

  const limit = LIMITS[plan][feature];
  if (limit === 'unlimited') return { blocked: false, limit: 'unlimited', remaining: null };
  const remaining = Math.max(0, (limit as number) - used);
  return { blocked: remaining === 0, limit: limit as number, remaining };
}
