export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { settleDueScheduledExamActivations } from '@/lib/scheduled-exam-activation-server';
export async function POST(req: NextRequest) {
 const error = await requirePermission(req, 'exams.edit');
 if (error) return error;
 return NextResponse.json(await settleDueScheduledExamActivations({ batchSize: 25 }));
}
