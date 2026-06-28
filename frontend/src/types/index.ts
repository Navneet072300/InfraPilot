// ─── Cluster & Platform ──────────────────────────────────────────────────────

export interface ClusterConfig {
  name: string;
  environment: 'dev' | 'staging' | 'prod';
  connection_type: 'token' | 'kubeconfig';
  api_url?: string;
  token?: string;
  kubeconfig?: string;
  active: boolean;
}

export interface ClusterHealth {
  healthy: boolean;
  configured: boolean;
  node_count?: number;
  version?: string;
  cluster_name: string;
  error?: string;
}

export interface K8sPod {
  name: string;
  namespace: string;
  status: string;
  ready: string;
  restarts: number;
  image: string;
  node: string;
}

export interface K8sNode {
  name: string;
  status: string;
  roles: string;
  age: string;
  version: string;
}

export interface K8sEvent {
  namespace: string;
  reason: string;
  message: string;
}

export interface ClusterOverview {
  cluster_name: string;
  configured?: boolean;
  nodes: K8sNode[];
  pod_counts: { running: number; pending: number; failed: number; total: number };
  warning_events: K8sEvent[];
  error?: string;
}

export interface PlatformConfig {
  configured: boolean;
  clusters: ClusterConfig[];
  selected_platforms: string[];
  github?: { username: string; pat: string; pat_expires_at?: string; configured: boolean };
  vault?: { address: string; token: string; stubbed: boolean; configured: boolean };
  cloudflare?: { email: string; api_key: string; zone_id: string; stubbed: boolean; configured: boolean };
  argocd?: { url: string; username: string; password: string; stubbed: boolean; configured: boolean };
}

// ─── Onboarding ──────────────────────────────────────────────────────────────

export interface OnboardingSelections {
  cloud: string[];
  cicd: string[];
  gitops: string[];
  secrets: string[];
  monitoring: string[];
  registry: string[];
  cdn: string[];
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface PipelineTask {
  id: number;
  title: string;
  description: string;
  stubbed: boolean;
  status: TaskStatus;
  output: string;
  files: GeneratedFile[];
  error?: string;
  fix?: string;
}

export interface PipelineConfig {
  app_name: string;
  repo_url: string;
  private_repo: boolean;
  gitops_repo: string;
  gitops_path: string;
  namespace: string;
  target_url: string;
  cluster: string;
  iac_tool: 'kustomize' | 'helm';
  registry: string;
  github_pat?: string;
  github_username?: string;
  vault_strategy: 'shared' | 'separate';
  env_vars: Record<string, string>;
  rotate_vault_secret: boolean;
  analysis?: RepoAnalysis;
  clarifications?: Record<string, string>;
}

export interface RepoAnalysis {
  success: boolean;
  language: string;
  has_dockerfile: boolean;
  port: number | null;
  has_manifests: boolean;
  has_cicd: boolean;
  secrets: string[];
  default_branch?: string;
  error?: string;
}

export interface AgentEvent {
  task?: number;
  status?: 'running' | 'chunk' | 'done' | 'failed' | 'skipped';
  message?: string;
  content?: string;
  files?: GeneratedFile[];
  error?: string;
  fix?: string;
  stubbed?: boolean;
  pipeline?: string;
}

// ─── Generate / Code ─────────────────────────────────────────────────────────

export interface GeneratedFile {
  path: string;
  content: string;
  language: 'hcl' | 'yaml' | 'json' | 'markdown' | 'bash' | 'python' | 'dockerfile';
}

// ─── Diagnose ────────────────────────────────────────────────────────────────

export interface DiagnoseResult {
  severity: 'critical' | 'high' | 'medium' | 'low';
  rootCause: string;
  details: string;
  suggestedFix: string;
  before: string;
  after: string;
  prevention: string;
}

// ─── Diagnose Deep (SRE Mode) ────────────────────────────────────────────────

export type CauseStatus = 'investigating' | 'confirmed' | 'ruled_out';

export interface DiagnosisCause {
  id: number;
  title: string;
  confidence_percent: number;
  why: string;
  check_description: string;
  check_command: string;
  if_confirmed: string;
  if_ruled_out: string;
}

export interface DiagnosisFixStep {
  step: number;
  title: string;
  command: string;
  expected_output: string;
  if_different: string;
}

export interface DiagnosisPreventionItem {
  title: string;
  why: string;
  implementation: string;
  effort: string;
}

export interface DiagnosisHistoryItem {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  pod_name?: string | null;
  namespace?: string | null;
  cluster?: string | null;
  issue_title: string;
  created_at: string;
  resolved: boolean;
}

export type SREChatRole = 'assistant' | 'user';

export interface SREChatMessage {
  id: string;
  role: SREChatRole;
  content: string;
  command?: string;
  commandOutput?: string;
  timestamp: Date;
}

// ─── Architecture / Design ───────────────────────────────────────────────────

export interface ArchNode {
  id: string;
  type: 'alb' | 'eks' | 'rds' | 'redis' | 's3' | 'cloudfront' | 'ec2' | 'vpc' | 'igw' | 'nat';
  label: string;
  x: number;
  y: number;
  costPerMonth: number;
}

export interface ArchEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface ArchitectureData {
  diagram_nodes: ArchNode[];
  diagram_edges: ArchEdge[];
  terraform_outline: string;
  k8s_manifests: string;
  cicd_pipeline: string;
  cost_breakdown: { service: string; monthly: number; description: string }[];
}

// ─── App State ───────────────────────────────────────────────────────────────

export type ActiveMode = 'pipeline' | 'generate' | 'diagnose' | 'design' | 'monitor';
export type Environment = 'dev' | 'staging' | 'prod';

export interface Project {
  id: string;
  name: string;
  cloud: 'aws' | 'azure' | 'gcp';
  region: string;
}

// ─── Subscription / Plan ──────────────────────────────────────────────────────

export type PlanTier = 'free' | 'pro' | 'team' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual';

export type PlanFeature =
  | 'design_mode'
  | 'monitor_mode'
  | 'unlimited_ai'
  | 'custom_model'
  | 'vault_integration'
  | 'team_seats'
  | 'audit_log'
  | 'api_keys'
  | 'sso'
  | 'pipeline_unlimited'
  | 'diagnose_unlimited';

export interface GateResult {
  allowed: boolean;
  reason?: string;
  requiredPlan: 'pro' | 'team' | 'enterprise';
  currentUsage?: number;
  limit?: number;
}

export interface PlanLimits {
  clusters: number | 'unlimited';
  aiRequestsPerDay: number | 'unlimited';
  pipelineRunsPerDay: number | 'unlimited';
  diagnoseRunsPerDay: number | 'unlimited';
  teamSeats: number | 'unlimited';
  historyDays: number | 'unlimited';
}

export interface PlanFeatureFlags {
  designMode: boolean;
  monitorMode: boolean;
  customModel: boolean;
  vaultIntegration: boolean;
  apiKeys: boolean;
  rbac: boolean;
  auditLog: boolean;
  sso: boolean;
  saml: boolean;
  slackNotifications: boolean;
  onPremise: boolean;
  sla: boolean;
}

export interface PlanDefinition {
  id: PlanTier;
  name: string;
  monthlyPrice: number;
  annualPrice: number;
  badge?: string;
  highlighted: boolean;
  limits: PlanLimits;
  features: PlanFeatureFlags;
}

export interface UsageStat {
  used: number;
  limit: number | 'unlimited';
  resetsAt?: string;
}

export interface UsageStats {
  aiRequests: UsageStat;
  pipelineRuns: UsageStat;
  diagnoseRuns: UsageStat;
  clusters: UsageStat;
}

export interface UserSubscription {
  plan: PlanTier;
  billingCycle: BillingCycle;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  usage: UsageStats;
}
