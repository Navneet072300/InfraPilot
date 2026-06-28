import type { ExperienceLevel } from './terminology';

interface DevOpsMsg  { title: string; summary: string }
interface BuilderMsg { title: string; summary: string; likelyFix: string; fixButton: string }

interface ErrorEntry {
  devops: DevOpsMsg;
  builder: BuilderMsg;
  learning: BuilderMsg;
}

export const errorMessages: Record<string, ErrorEntry> = {
  ImagePullBackOff: {
    devops:   { title: 'ImagePullBackOff', summary: 'Pod cannot pull container image' },
    builder:  {
      title: "App couldn't download its package",
      summary: "Your app is ready to start but the server can't download the packaged version of your code. This is almost always a password issue.",
      likelyFix: "The server needs permission to access your private code storage. This can usually be fixed in under a minute.",
      fixButton: 'Fix the permission issue',
    },
    learning: {
      title: "ImagePullBackOff — download failed",
      summary: "The server tried to pull (download) your container image but got rejected. Usually means a missing or expired imagePullSecret.",
      likelyFix: "Create an imagePullSecret in the correct namespace.",
      fixButton: 'Fix imagePullSecret',
    },
  },
  CrashLoopBackOff: {
    devops:   { title: 'CrashLoopBackOff', summary: 'Container crashes immediately after start' },
    builder:  {
      title: 'App keeps crashing on startup',
      summary: "Your app starts, then immediately crashes, then tries to start again, then crashes again. This is almost always a code error or a missing password.",
      likelyFix: "Check if all your passwords (DATABASE_URL, etc.) are correctly set. If yes, there's a bug in the startup code.",
      fixButton: 'Check startup logs',
    },
    learning: {
      title: 'CrashLoopBackOff — restart loop',
      summary: "Pod starts, crashes, Kubernetes restarts it, it crashes again. Exponential backoff increases wait time. Check: missing env vars, code exceptions, failed health checks.",
      likelyFix: 'Check pod logs for the crash reason.',
      fixButton: 'View crash logs',
    },
  },
  OOMKilled: {
    devops:   { title: 'OOMKilled', summary: 'Container exceeded memory limit' },
    builder:  {
      title: 'App ran out of memory',
      summary: "Your app was using too much memory and the server had to shut it down to protect other apps. It will restart automatically.",
      likelyFix: "Your app might have a memory leak, or it just needs more memory allocated to it.",
      fixButton: 'Give app more memory',
    },
    learning: {
      title: 'OOMKilled — out of memory',
      summary: "Container hit its memory limit (resources.limits.memory) and was killed by the kernel OOM killer.",
      likelyFix: "Increase memory limit in deployment spec or fix memory leak.",
      fixButton: 'Increase memory limit',
    },
  },
  Pending: {
    devops:   { title: 'Pod stuck in Pending', summary: 'Pod cannot be scheduled to a node' },
    builder:  {
      title: "App is waiting to start",
      summary: "Your app is ready to launch but the server can't find a place to run it yet. This usually means the server is full or there's a configuration mismatch.",
      likelyFix: "The server might not have enough free space. Check what's blocking it.",
      fixButton: "Find out what's blocking it",
    },
    learning: {
      title: 'Pod Pending — scheduling failed',
      summary: "Kubernetes scheduler can't place the pod. Common causes: insufficient CPU/memory, node selector mismatch, taint/toleration issue, PVC not bound.",
      likelyFix: "Check events: kubectl describe pod",
      fixButton: 'Check scheduling events',
    },
  },
  CreateContainerConfigError: {
    devops:   { title: 'CreateContainerConfigError', summary: 'Container config invalid — usually missing secret or configmap' },
    builder:  {
      title: "App is missing a password",
      summary: "Your app is trying to start but one of the passwords or settings it needs doesn't exist yet. It's like trying to log into a website before creating the account.",
      likelyFix: "A required password or setting is missing. Tell me which app and I'll check what's missing.",
      fixButton: 'Find the missing password',
    },
    learning: {
      title: 'CreateContainerConfigError',
      summary: "Referenced Secret or ConfigMap doesn't exist in the namespace. Pod spec references a resource that was never created.",
      likelyFix: "Create the missing secret or configmap in the correct namespace.",
      fixButton: 'Create missing resource',
    },
  },
};

export function getErrorMessage(errorType: string, level: ExperienceLevel) {
  const entry = errorMessages[errorType];
  if (!entry) return null;
  return entry[level];
}

export function translateErrorTitle(errorType: string, level: ExperienceLevel): string {
  const entry = errorMessages[errorType];
  if (!entry || level === 'devops') return errorType;
  return entry[level].title;
}
