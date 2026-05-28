import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    app: 'TeacherPro',
    status: 'ok',
    endpoints: [
      '/api/courses',
      '/api/students',
      '/api/exams',
      '/api/grades',
      '/api/logs',
      '/api/backup',
      '/api/whatsapp/send',
    ],
  });
}
