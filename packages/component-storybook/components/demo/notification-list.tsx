'use client';

import { useState } from 'react';

interface Notification {
  id: number;
  isRead: boolean;
  message: string;
  time: string;
}

interface NotificationItemProps {
  notification: Notification;
  onMarkRead: (id: number) => void;
}

const NotificationItem = ({ notification, onMarkRead }: NotificationItemProps) => {
  return (
    <div
      className={`flex items-start gap-3 rounded-md p-3 transition-colors ${
        notification.isRead ? 'bg-white' : 'bg-indigo-50'
      }`}
    >
      <div
        className={`mt-1.5 h-2 w-2 rounded-full ${
          notification.isRead ? 'bg-zinc-300' : 'bg-indigo-500'
        }`}
      />
      <div className="flex-1">
        <p className="text-sm text-zinc-700">{notification.message}</p>
        <p className="mt-0.5 text-xs text-zinc-400">{notification.time}</p>
      </div>
      {!notification.isRead && (
        <button
          className="text-xs text-indigo-500 hover:text-indigo-700"
          onClick={() => onMarkRead(notification.id)}
        >
          Mark read
        </button>
      )}
    </div>
  );
};

const initialNotifications: Notification[] = [
  { id: 1, isRead: false, message: 'New deployment succeeded', time: '2 min ago' },
  { id: 2, isRead: false, message: 'PR #42 was merged', time: '10 min ago' },
  { id: 3, isRead: true, message: 'Build completed', time: '1 hour ago' },
];

export const NotificationList = () => {
  const [notifications, setNotifications] = useState(initialNotifications);

  const unreadCount = notifications.filter((notification) => !notification.isRead).length;

  const handleMarkRead = (notificationId: number) => {
    setNotifications((previous) =>
      previous.map((notification) =>
        notification.id === notificationId
          ? { ...notification, isRead: true }
          : notification,
      ),
    );
  };

  return (
    <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-900">Notifications</h3>
        {unreadCount > 0 && (
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-600">
            {unreadCount} new
          </span>
        )}
      </div>
      <div className="divide-y divide-zinc-50 p-2">
        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onMarkRead={handleMarkRead}
          />
        ))}
      </div>
    </div>
  );
};
