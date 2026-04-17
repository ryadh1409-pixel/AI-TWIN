import { initSmartCompanionNotifications, registerInactivityNotificationListener } from '@/services/smartCompanionNotifications';
import { useEffect } from 'react';

/**
 * Requests notification permission on start and registers smart schedules (morning/evening + inactivity).
 */
export function SmartCompanionNotifications() {
  useEffect(() => {
    void initSmartCompanionNotifications();
  }, []);

  useEffect(() => {
    const remove = registerInactivityNotificationListener();
    return remove;
  }, []);

  return null;
}
