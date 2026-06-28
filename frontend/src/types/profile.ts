export interface ProfileStats {
  pipelines_run: number;
  files_generated: number;
  pods_diagnosed: number;
  deployments_total: number;
  deployments_successful: number;
}

export interface ActivityItem {
  id: number;
  icon: string;
  description: string;
  time_ago: string;
  action: string;
  resource: string;
  created_at: string;
}

export interface SavedCodeItem {
  id: number;
  prompt: string;
  files: string[];
  tool: string;
  created_at: string;
}

export interface SavedArchItem {
  id: number;
  requirements: string;
  created_at: string;
}
