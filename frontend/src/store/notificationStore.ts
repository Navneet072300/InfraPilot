import { create } from 'zustand';

export type NotifType = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: NotifType;
  read: boolean;
  timestamp: Date;
}

const MOCK: Notification[] = [
  {
    id: '1',
    title: 'Pipeline completed',
    message: 'my-app-frontend deployed to production namespace successfully.',
    type: 'success',
    read: false,
    timestamp: new Date(Date.now() - 3 * 60 * 1000),
  },
  {
    id: '2',
    title: 'Token expiring soon',
    message: 'Cluster "prod-eks" bearer token expires in 7 days. Update in Settings.',
    type: 'warning',
    read: false,
    timestamp: new Date(Date.now() - 18 * 60 * 1000),
  },
  {
    id: '3',
    title: 'Cost anomaly detected',
    message: 'EC2 spend is 40% above forecast for the past 3 days in us-east-1b.',
    type: 'error',
    read: false,
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
  },
  {
    id: '4',
    title: 'Node degraded',
    message: 'Node "worker-node-3" status is NotReady. Check cluster health.',
    type: 'warning',
    read: false,
    timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000),
  },
  {
    id: '5',
    title: 'New deployment detected',
    message: 'Rollout detected in namespace "staging" — deployment/api-gateway updated.',
    type: 'info',
    read: true,
    timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
  },
];

interface NotificationState {
  notifications: Notification[];
  markAllRead: () => void;
  markRead: (id: string) => void;
  deleteNotif: (id: string) => void;
  unreadCount: () => number;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: MOCK,

  markAllRead: () =>
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
    })),

  markRead: (id) =>
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    })),

  deleteNotif: (id) =>
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
    })),

  unreadCount: () => get().notifications.filter((n) => !n.read).length,
}));
