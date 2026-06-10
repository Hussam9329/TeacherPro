export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server-auth';

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  return NextResponse.json({
    app: 'TeacherPro',
    status: 'ok',
    endpoints: [
      '/api/courses',
      '/api/students',
      '/api/exams',
      '/api/grades',
      '/api/student-leaves',
      '/api/student-calls',
      '/api/student-notes',
      '/api/logs',
      '/api/backup',
    ],
  });
}
