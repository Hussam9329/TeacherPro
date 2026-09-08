"use client";
import { useEffect } from 'react';
import { useTeacherStore } from '@/lib/teacher-store';
import { emitTeacherProDataChanged } from '@/lib/teacherpro-sync';
/** Daily server cron runs independently. Authorized operators also settle due
 * work while the app is open; read-only accounts never cause DB mutations. */
export function ScheduledExamWorker() {
 const authenticated = useTeacherStore(s => s.isAuthenticated);
 const owner = useTeacherStore(s => s.currentUserId);
 useEffect(() => {
  if (!authenticated) return;
  let stopped = false, running = false;
  const run = async () => {
   const state = useTeacherStore.getState(), user = state.currentUser();
   if (stopped || running || document.visibilityState !== 'visible' || !user ||
       !(user.username === 'admin' || user.roleId === 'role_admin' || user.permissions.includes('exams.edit'))) return;
   if (!state.exams.some(e => !e.active && e.scheduledActivateAt && new Date(e.scheduledActivateAt).getTime() <= Date.now())) return;
   running = true;
   try {
    const response = await fetch('/api/exams/settle-scheduled', { method: 'POST', headers: { 'x-teacherpro-owner-id': owner } });
    if (response.ok && (await response.json()).activated && !stopped) emitTeacherProDataChanged({ scopes: ['exams', 'students', 'grades', 'opportunities'] });
   } finally { running = false; }
  };
  const safelyRun = () => { void run().catch(() => {}); };
  safelyRun();
  const timer = window.setInterval(safelyRun, 60000);
  document.addEventListener('visibilitychange', safelyRun);
  return () => { stopped = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', safelyRun); };
 }, [authenticated, owner]);
 return null;
}
