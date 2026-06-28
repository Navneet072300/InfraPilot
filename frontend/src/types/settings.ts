export interface GeneralSettings {
  name: string;
  email: string;
  avatar_color: string;
  timezone: string;
  default_environment: 'dev' | 'staging' | 'prod';
  default_iac_tool: 'terraform' | 'kustomize' | 'helm' | 'ansible';
  default_cloud: 'aws' | 'azure' | 'gcp' | 'bare-metal';
  default_namespace: string;
  code_font_size: number;
  experience_level: 'builder' | 'devops' | 'learning' | null;
}

export interface NotificationPrefs {
  pipeline_completed: boolean;
  pipeline_failed: boolean;
  pipeline_approval: boolean;
  pipeline_step: boolean;
  pod_crashloop: boolean;
  node_not_ready: boolean;
  high_memory: boolean;
  pod_restarts: boolean;
  daily_usage_summary: boolean;
  approaching_limits: boolean;
  new_features: boolean;
  inapp: boolean;
  email: boolean;
  slack: boolean;
}

export const DEFAULT_NOTIF_PREFS: NotificationPrefs = {
  pipeline_completed: true,
  pipeline_failed: true,
  pipeline_approval: true,
  pipeline_step: false,
  pod_crashloop: true,
  node_not_ready: true,
  high_memory: true,
  pod_restarts: false,
  daily_usage_summary: true,
  approaching_limits: false,
  new_features: true,
  inapp: true,
  email: false,
  slack: false,
};

export interface AISettings {
  primary_endpoint: string;
  primary_model: string;
  secondary_endpoint: string;
  secondary_model: string;
  temperature: number;
  max_tokens: number;
  streaming: boolean;
  system_prompt_addendum: string;
}

export interface ActiveSession {
  id: number;
  device_info: string;
  ip_address: string;
  last_active: string;
  created_at: string;
  is_current: boolean;
}

export interface APIKeyEntry {
  id: number;
  name: string;
  key_prefix: string;
  scopes: string[];
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface TeamMember {
  id: number;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  joined_at: string;
  is_current: boolean;
}

export interface TeamInvite {
  id: number;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
}

export interface AuditEntry {
  id: number;
  user_email: string;
  action: string;
  resource: string;
  ip_address: string;
  status: 'success' | 'failed';
  details: string | null;
  created_at: string;
}
