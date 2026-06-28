export type ExperienceLevel = 'builder' | 'devops' | 'learning';

export const terminology = {
  cluster:        { devops: 'Cluster',                    builder: 'Your Server',                     learning: 'Cluster (your server)' },
  namespace:      { devops: 'Namespace',                  builder: 'App section',                     learning: 'Namespace (app section)' },
  pod:            { devops: 'Pod',                        builder: 'App instance',                    learning: 'Pod (app instance)' },
  deployment:     { devops: 'Deployment',                 builder: 'Your app',                        learning: 'Deployment (your app)' },
  container:      { devops: 'Container',                  builder: 'App package',                     learning: 'Container (app package)' },
  image:          { devops: 'Container image',            builder: 'App package',                     learning: 'Container image (app package)' },
  registry:       { devops: 'Container registry',         builder: 'App storage',                     learning: 'Registry (where your app is stored)' },
  secret:         { devops: 'Secret',                     builder: 'Password / private value',        learning: 'Secret (password)' },
  configmap:      { devops: 'ConfigMap',                  builder: 'App settings',                    learning: 'ConfigMap (app settings)' },
  ingress:        { devops: 'Ingress',                    builder: 'URL routing',                     learning: 'Ingress (URL routing)' },
  service:        { devops: 'Service',                    builder: 'App connection',                  learning: 'Service (app connection)' },
  node:           { devops: 'Node',                       builder: 'Server machine',                  learning: 'Node (server machine)' },
  manifest:       { devops: 'Manifest',                   builder: 'App configuration',               learning: 'Manifest (app config file)' },
  helm:           { devops: 'Helm chart',                 builder: 'App installer',                   learning: 'Helm chart (app installer)' },
  kustomize:      { devops: 'Kustomize overlay',          builder: 'Environment settings',            learning: 'Kustomize overlay (environment settings)' },
  pipeline:       { devops: 'Pipeline',                   builder: 'Auto-deploy',                     learning: 'Pipeline (auto-deploy)' },
  cicd:           { devops: 'CI/CD',                      builder: 'Automatic deploys',               learning: 'CI/CD (automatic deploys)' },
  workflow:       { devops: 'GitHub Actions workflow',    builder: 'Auto-deploy script',              learning: 'Workflow (auto-deploy script)' },
  artifact:       { devops: 'Build artifact',             builder: 'Built app',                       learning: 'Artifact (built app)' },
  vault:          { devops: 'HashiCorp Vault',            builder: 'Password manager (Vault)',        learning: 'Vault (password manager)' },
  secretStore:    { devops: 'Secrets store',              builder: 'Password storage',                learning: 'Secrets store (password storage)' },
  pat:            { devops: 'Personal Access Token (PAT)', builder: 'GitHub password for apps',      learning: 'Personal Access Token — PAT (GitHub app password)' },
  imagePullSecret:{ devops: 'imagePullSecret',            builder: 'App download permission',         learning: 'imagePullSecret (app download permission)' },
  serviceAccount: { devops: 'Service Account',            builder: 'App identity',                    learning: 'Service Account (app identity)' },
  argocd:         { devops: 'ArgoCD',                     builder: 'Auto-sync tool',                  learning: 'ArgoCD (auto-sync tool)' },
  gitops:         { devops: 'GitOps',                     builder: 'Git-based deploys',               learning: 'GitOps (Git-based deploys)' },
  sync:           { devops: 'Sync',                       builder: 'Update from latest code',         learning: 'Sync (update from latest code)' },
  rollout:        { devops: 'Rollout',                    builder: 'Deploy update',                   learning: 'Rollout (deploy update)' },
  crashLoopBackOff:  { devops: 'CrashLoopBackOff',        builder: 'App keeps crashing',              learning: 'CrashLoopBackOff — app keeps crashing' },
  imagePullBackOff:  { devops: 'ImagePullBackOff',        builder: "Can't download app package",      learning: "ImagePullBackOff — can't download app" },
  oomKilled:      { devops: 'OOMKilled',                  builder: 'App ran out of memory',           learning: 'OOMKilled — app ran out of memory' },
  pending:        { devops: 'Pending',                    builder: 'Waiting to start',                learning: 'Pending (waiting to start)' },
  evicted:        { devops: 'Evicted',                    builder: 'App was stopped to free space',   learning: 'Evicted — stopped to free space' },
  kubectl:        { devops: 'kubectl',                    builder: 'server command',                  learning: 'kubectl (server command)' },
  apply:          { devops: 'kubectl apply',              builder: 'Apply this fix',                  learning: 'Apply (kubectl apply)' },
  rolloutRestart: { devops: 'kubectl rollout restart',    builder: 'Restart the app',                 learning: 'Restart (rollout restart)' },
  portForward:    { devops: 'Port forward',               builder: 'Test locally',                    learning: 'Port forward (test locally)' },
  kubeconfig:     { devops: 'Kubeconfig',                 builder: 'Server connection file',          learning: 'Kubeconfig (server connection file)' },
  bearerToken:    { devops: 'Bearer Token',               builder: 'Server access key',               learning: 'Bearer Token (server access key)' },
} as const;

export type TermKey = keyof typeof terminology;

export function getTerm(key: TermKey, level: ExperienceLevel): string {
  return terminology[key][level];
}

// Pipeline task name translations for builder mode
export const PIPELINE_TASK_NAMES: Record<string, { builder: string; sub: string }> = {
  'Generate GitHub Actions CI Pipeline': {
    builder: 'Set up automatic builds',
    sub: 'Every time you push code to GitHub, it will automatically build and test',
  },
  'Generate Kustomize Base Manifests': {
    builder: 'Create app configuration',
    sub: 'Tells the server how to run your app',
  },
  'Generate Environment Overlays': {
    builder: 'Set up dev and production settings',
    sub: 'Different settings for testing vs live',
  },
  'Store Secrets in Vault': {
    builder: "Save your app's passwords safely",
    sub: "Encrypted, only your app can read them",
  },
  'Apply Vault Policies to Clusters': {
    builder: "Give your app permission to read its passwords",
    sub: 'Like giving your app a key to the password vault',
  },
  'Push Manifests to GitOps Repo': {
    builder: 'Save app configuration to GitHub',
    sub: 'All changes tracked in git history',
  },
  'Create ArgoCD Application': {
    builder: 'Connect auto-deploy',
    sub: 'App updates automatically when configuration changes',
  },
  'Watch Rollout': {
    builder: 'Starting your app...',
    sub: 'Watching until everything is running',
  },
  'Troubleshoot (if pods unhealthy)': {
    builder: 'Something went wrong — fixing it',
    sub: 'Checking what happened and repairing',
  },
  'Get Service URL': {
    builder: "Getting your app's address",
    sub: 'The URL where your app will be live',
  },
  'Configure Cloudflare DNS': {
    builder: 'Connecting your domain',
    sub: 'Pointing yourapp.com to the new server',
  },
};

// Severity translations
export const SEVERITY_LABELS: Record<string, Record<ExperienceLevel, string>> = {
  critical: { devops: 'CRITICAL', builder: 'App is down', learning: 'CRITICAL — App is down' },
  high:     { devops: 'HIGH',     builder: 'Serious issue', learning: 'HIGH — Serious issue' },
  medium:   { devops: 'MEDIUM',   builder: 'Worth fixing', learning: 'MEDIUM — Worth fixing' },
  low:      { devops: 'LOW',      builder: 'Minor issue', learning: 'LOW — Minor issue' },
};
