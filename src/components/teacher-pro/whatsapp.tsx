'use client';

import React, { useState, useMemo } from 'react';
import { useTeacherStore } from '@/lib/teacher-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';

export function WhatsAppView() {
  const {
    students, courses, exams, whatsappReports, whatsappQueue,
    queueWhatsAppMessage, markWhatsAppMessageStatus, dismissStudent,
  } = useTeacherStore();

  const [command, setCommand] = useState<'QR' | 'تقرير' | 'رسالة حرة'>('QR');
  const [recipient, setRecipient] = useState<'الطالب' | 'ولي الأمر'>('ولي الأمر');
  const [filterCourseId, setFilterCourseId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [freeMessage, setFreeMessage] = useState('');
  const [showSendDialog, setShowSendDialog] = useState(false);

  // Filter students for sending
  const targetStudents = useMemo(() => {
    return students.filter(s => {
      if (filterCourseId && s.courseId !== filterCourseId) return false;
      if (filterStatus && s.status !== filterStatus) return false;
      return true;
    });
  }, [students, filterCourseId, filterStatus]);

  const generateMessage = (student: typeof students[0]): string => {
    if (command === 'رسالة حرة') return freeMessage;

    if (command === 'QR') {
      return `السلام عليكم ورحمة الله وبركاته\nرمز QR للطالب ${student.name}\nالكود: ${student.code}\nيرجى المراسلة في حالة وجود مشكلة.\nادارة الاستاذ حسن فلاح - مدرس مادة الاحياء`;
    }

    // Report
    if (student.status === 'مفصول') {
      if (student.dismissalType === 'فصل مؤقت' && student.dismissalReason.includes('غش')) {
        return `السلام عليكم ورحمة الله وبركاته\nتم فصل الطالب ${student.name} فصلاً مؤقتاً بسبب قيام الطالب بالغش بالامتحان.\nيرجى مراسلة المعرف (@) على التلكرام لغرض اتمام اجراءات التعهد.\nادارة الاستاذ حسن فلاح - مدرس مادة الاحياء`;
      }
      if (student.dismissalType === 'فصل مؤقت') {
        return `السلام عليكم ورحمة الله وبركاته\nتم فصل الطالب ${student.name} فصلاً مؤقتاً بسبب انتهاء فرصه.\nيرجى مراسلة المعرف (@) على التلكرام لغرض اتمام اجراءات التعهد.\nادارة الاستاذ حسن فلاح - مدرس مادة الاحياء`;
      }
      return `السلام عليكم ورحمة الله وبركاته\nتم فصل الطالب ${student.name} فصلاً نهائياً بسبب عدم الالتزام بالتعهد السابق.\nشكرا جزيلاً\nادارة الاستاذ حسن فلاح - مدرس مادة الاحياء`;
    }

    return `السلام عليكم ورحمة الله وبركاته\nتقرير الطالب ${student.name}\nالكود: ${student.code}\nالفرص المتبقية: ${student.opportunities}/${student.baseOpportunities}\nادارة الاستاذ حسن فلاح - مدرس مادة الاحياء`;
  };

  const handleSend = () => {
    if (command === 'رسالة حرة' && !freeMessage.trim()) {
      toast.error('يرجى إدخال الرسالة');
      return;
    }

    targetStudents.forEach(student => {
      const message = generateMessage(student);
      queueWhatsAppMessage([student], recipient, message, command);
    });

    setShowSendDialog(false);
    toast.success(`تم جدولة ${targetStudents.length} رسالة واتساب`);
  };

  // Queue stats
  const scheduled = whatsappQueue.filter(m => m.status === 'مجدول').length;
  const batchCount = whatsappQueue.length > 0 ? Math.ceil(whatsappQueue.length / 200) : 0;
  const cooldownTotal = batchCount > 1 ? (batchCount - 1) * 30 : 0;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="send" dir="rtl">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="send">إرسال رسائل</TabsTrigger>
          <TabsTrigger value="queue">طابور الإرسال</TabsTrigger>
          <TabsTrigger value="reports">تقارير الإرسال</TabsTrigger>
        </TabsList>

        {/* Send Tab */}
        <TabsContent value="send" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>إرسال رسائل واتساب</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="whatsapp-command">نوع الأمر</Label>
                  <Select value={command} onValueChange={v => setCommand(v as typeof command)}>
                    <SelectTrigger id="whatsapp-command"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="QR">QR</SelectItem>
                      <SelectItem value="تقرير">تقرير</SelectItem>
                      <SelectItem value="رسالة حرة">رسالة حرة</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="whatsapp-recipient">المستلم</Label>
                  <Select value={recipient} onValueChange={v => setRecipient(v as typeof recipient)}>
                    <SelectTrigger id="whatsapp-recipient"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="الطالب">الطالب</SelectItem>
                      <SelectItem value="ولي الأمر">ولي الأمر</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="whatsapp-course">الدورة</Label>
                  <Select value={filterCourseId} onValueChange={v => setFilterCourseId(v === 'all' ? '' : v)}>
                    <SelectTrigger id="whatsapp-course"><SelectValue placeholder="الكل" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">الكل</SelectItem>
                      {courses.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="whatsapp-status">حالة الطلاب</Label>
                <Select value={filterStatus} onValueChange={v => setFilterStatus(v === 'all' ? '' : v)}>
                  <SelectTrigger id="whatsapp-status"><SelectValue placeholder="الكل" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="نشط">نشط</SelectItem>
                    <SelectItem value="مفصول">مفصول</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {command === 'رسالة حرة' && (
                <div className="space-y-2">
                  <Label htmlFor="whatsapp-message">نص الرسالة</Label>
                  <textarea
                    id="whatsapp-message" name="freeMessage"
                    className="w-full min-h-36 rounded-2xl border bg-background/70 px-3.5 py-3 text-sm shadow-xs backdrop-blur"
                    value={freeMessage}
                    onChange={e => setFreeMessage(e.target.value)}
                    placeholder="اكتب الرسالة هنا..."
                  />
                </div>
              )}

              {/* Cooldown Info */}
              <div className="p-3 rounded-2xl border border-amber-500/20 bg-amber-500/10">
                <p className="text-sm">
                  <strong>نظام الطابور:</strong> 200 رسالة ثم 30 دقيقة تبريد
                </p>
                {batchCount > 1 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    سيتم الإرسال على {batchCount} دفعات - مدة التبريد الإجمالية: {cooldownTotal} دقيقة
                  </p>
                )}
              </div>

              <div className="p-3 rounded-2xl border bg-card/80 shadow-sm text-xs text-muted-foreground">
                <strong className="text-foreground">ربط WhatsApp Business:</strong> أضف WHATSAPP_TOKEN وWHATSAPP_PHONE_NUMBER_ID في ملف البيئة ثم استخدم مسار API: <code>/api/whatsapp/send</code>. من غير المفاتيح يبقى النظام على الجدولة والمحاكاة المحلية.
              </div>

              {/* Preview */}
              <div className="p-3 rounded-2xl bg-muted/60">
                <p className="text-xs text-muted-foreground mb-1">معاينة - {targetStudents.length} مستلم</p>
                {targetStudents.slice(0, 3).map(s => (
                  <p key={s.id} className="text-sm">{s.name} - {recipient === 'الطالب' ? s.phone : s.parentPhone}</p>
                ))}
                {targetStudents.length > 3 && (
                  <p className="text-xs text-muted-foreground">+{targetStudents.length - 3} آخرين</p>
                )}
              </div>


              <Button className="w-full" onClick={() => setShowSendDialog(true)}>
                إرسال {targetStudents.length} رسالة
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Queue Tab */}
        <TabsContent value="queue">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>طابور الإرسال</CardTitle>
              <div className="flex gap-2">
                <Badge variant="secondary">{scheduled} مجدول</Badge>
                <Badge>{whatsappQueue.length} إجمالي</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {whatsappQueue.length === 0 ? (
                  <p className="empty-state">الطابور فارغ</p>
                ) : (
                  whatsappQueue.slice(0, 50).map(msg => {
                    const student = students.find(s => s.id === msg.studentId);
                    return (
                      <div key={msg.id} className="flex items-center justify-between text-sm p-2 rounded-xl bg-muted/60">
                        <div>
                          <span className="font-medium">{student?.name || 'غير محدد'}</span>
                          <span className="text-muted-foreground mx-2">•</span>
                          <span className="text-muted-foreground">{msg.phone || 'بدون رقم'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">دفعة {msg.batch}</Badge>
                          <Badge variant={msg.status === 'مجدول' ? 'secondary' : msg.status === 'فشل' ? 'destructive' : 'default'}>
                            {msg.status}
                          </Badge>
                          {msg.status === 'مجدول' && (
                            <Button size="sm" variant="outline" onClick={() => markWhatsAppMessageStatus(msg.id, 'تم الإرسال', `local-${msg.id}`)}>
                              تعليم كمرسل
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => markWhatsAppMessageStatus(msg.id, 'فشل', undefined, 'تم وضعها كفشل يدوياً')}>
                            فشل
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Reports Tab */}
        <TabsContent value="reports">
          <Card>
            <CardHeader>
              <CardTitle>تقارير الإرسال</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {whatsappReports.length === 0 ? (
                  <p className="empty-state">لا توجد تقارير</p>
                ) : (
                  whatsappReports.map(report => (
                    <div key={report.id} className="p-4 rounded-2xl border bg-card/80 shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="font-medium text-sm">{report.command}</p>
                          <p className="text-xs text-muted-foreground">{report.time} - إلى: {report.recipient}</p>
                        </div>
                        <div className="flex gap-2">
                          <Badge variant="default">{report.delivered.length} تم التسليم</Badge>
                          {report.failed.length > 0 && (
                            <Badge variant="destructive">{report.failed.length} فشل</Badge>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">إجمالي: {report.total}</p>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirm Send Dialog */}
      <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تأكيد الإرسال</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            سيتم إرسال {targetStudents.length} رسالة واتساب ({command}) إلى {recipient}.
          </p>
          {batchCount > 1 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              سيتم تقسيم الإرسال إلى {batchCount} دفعات مع تبريد {cooldownTotal} دقيقة بينها.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSendDialog(false)}>إلغاء</Button>
            <Button onClick={handleSend}>تأكيد الإرسال</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
