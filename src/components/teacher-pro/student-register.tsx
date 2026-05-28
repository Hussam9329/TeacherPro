'use client';

import React, { useMemo, useState } from 'react';
import { useTeacherStore } from '@/lib/teacher-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { getPhoneValidationError, sanitizePhoneInput, toLatinDigits } from '@/lib/format';
import { PUBLIC_MAIN_SITE_OPTIONS, PRIVATE_BAGHDAD_SUB_SITES, IRAQI_PROVINCES } from '@/lib/iraq';
import { getStudentDuplicateMessage, isValidAccountingGraceDays, sanitizeTelegramInput } from '@/lib/student-utils';
import {
  AlertCircle, Barcode, BookOpen, CheckCircle2, Coins,
  Lock, MapPin, PhoneCall, Receipt, Save, School, Smartphone, Star,
  User, UserPlus, Users, VenusAndMars, WalletCards,
} from 'lucide-react';

const fieldBaseClass =
  'h-12 rounded-xl border border-gray-300 bg-white/95 pr-10 pl-4 text-right shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-0 dark:border-white/10 dark:bg-white/10';
const selectTriggerClass =
  'h-12 rounded-xl border border-gray-300 bg-white/95 px-4 shadow-sm focus:ring-2 focus:ring-blue-500 dark:border-white/10 dark:bg-white/10';

type CourseType = 'خاصة' | 'عامة';

type StudentRegisterForm = {
  name: string;
  school: string;
  gender: 'ذكر' | 'أنثى';
  phone: string;
  parentPhone: string;
  telegram: string;
  courseType: CourseType;
  courseId: string;
  groupId: string;
  mainSite: string;
  subSite: string;
  receiptNo: string;
  codeSequence: string;
  totalAmount: string;
  paidAmount: string;
  accountingStart: string;
  createdAt: string;
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): StudentRegisterForm {
  return {
    name: '',
    school: '',
    gender: 'ذكر',
    phone: '',
    parentPhone: '',
    telegram: '',
    courseType: 'عامة',
    courseId: '',
    groupId: '',
    mainSite: 'بغداد',
    subSite: '',
    receiptNo: '',
    codeSequence: '',
    totalAmount: '',
    paidAmount: '',
    accountingStart: '0',
    createdAt: todayISO(),
  };
}

function amountValue(value: string): number {
  return Number(toLatinDigits(value).replace(/\D/g, '')) || 0;
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function FieldIcon({ icon: Icon, className = '' }: { icon: React.ElementType; className?: string }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
      <Icon className={`h-4 w-4 text-gray-400 ${className}`} />
    </div>
  );
}

function RequiredMark() {
  return <span className="text-red-500">*</span>;
}

export function StudentRegisterView() {
  const { students, courses, groups, addStudent, activeChapterForCourse } = useTeacherStore();
  const [form, setForm] = useState<StudentRegisterForm>(() => emptyForm());
  const [showRules, setShowRules] = useState(false);

  const isPrivate = form.courseType === 'خاصة';

  const filteredCourses = useMemo(
    () => courses.filter(c => c.type === form.courseType && c.active),
    [courses, form.courseType],
  );

  const filteredGroups = useMemo(
    () => groups.filter(g => g.courseId === form.courseId && g.active),
    [groups, form.courseId],
  );

  const mainSiteOptions = useMemo(() => {
    if (isPrivate) return ['بغداد'];
    return [...PUBLIC_MAIN_SITE_OPTIONS];
  }, [isPrivate]);

  const subSiteOptions = useMemo<string[]>(() => {
    if (isPrivate && form.mainSite === 'بغداد') return [...PRIVATE_BAGHDAD_SUB_SITES];
    if (!isPrivate && form.mainSite === 'بغداد') return [];
    if (!isPrivate && form.mainSite === 'محافظات') return [...IRAQI_PROVINCES];
    return [];
  }, [isPrivate, form.mainSite]);

  const totalAmount = useMemo(() => amountValue(form.totalAmount), [form.totalAmount]);
  const paidAmount = useMemo(() => amountValue(form.paidAmount), [form.paidAmount]);
  const remainingAmount = Math.max(totalAmount - paidAmount, 0);

  const updateForm = (key: keyof StudentRegisterForm, value: string) => {
    setForm(prev => ({ ...prev, [key]: toLatinDigits(value) }));
  };

  const updateAmountForm = (key: 'totalAmount' | 'paidAmount', value: string) => {
    setForm(prev => ({ ...prev, [key]: toLatinDigits(value).replace(/\D/g, '') }));
  };

  const updateGraceDays = (value: string) => {
    setForm(prev => ({ ...prev, accountingStart: toLatinDigits(value).replace(/\D/g, '').slice(0, 2) }));
  };

  const updatePhoneForm = (key: 'phone' | 'parentPhone', value: string) => {
    setForm(prev => ({ ...prev, [key]: sanitizePhoneInput(value) }));
  };

  const handleCourseTypeChange = (value: string) => {
    const nextType = value as CourseType;
    setForm(prev => ({
      ...prev,
      courseType: nextType,
      courseId: '',
      groupId: '',
      mainSite: 'بغداد',
      subSite: '',
      receiptNo: nextType === 'خاصة' ? prev.receiptNo : '',
      codeSequence: nextType === 'خاصة' ? prev.codeSequence : '',
      totalAmount: nextType === 'خاصة' ? prev.totalAmount : '',
      paidAmount: nextType === 'خاصة' ? prev.paidAmount : '',
    }));
  };

  const handleCourseChange = (value: string) => {
    setForm(prev => ({ ...prev, courseId: value, groupId: '', subSite: '' }));
  };

  const validateRequiredFields = () => {
    const requiredChecks: [boolean, string][] = [
      [Boolean(form.name.trim()), 'اسم الطالب مطلوب'],
      [Boolean(form.school.trim()), 'اسم المدرسة مطلوب'],
      [Boolean(form.gender), 'الجنس مطلوب'],
      [Boolean(form.phone.trim()), 'رقم هاتف الطالب مطلوب'],
      [Boolean(form.parentPhone.trim()), 'رقم هاتف ولي الأمر مطلوب'],
      [Boolean(form.courseType), 'نوع الدورة مطلوب'],
      [Boolean(form.courseId), filteredCourses.length === 0 ? 'لا توجد دورات مسجلة لهذا النوع' : 'يرجى اختيار الدورة'],
      [Boolean(form.mainSite), 'الموقع الرئيسي مطلوب'],
      [subSiteOptions.length === 0 || Boolean(form.subSite), 'الموقع الفرعي مطلوب'],
      [Boolean(form.groupId), filteredGroups.length === 0 ? 'لا توجد كروبات إلكترونية لهذه الدورة' : 'يرجى اختيار الكروب الإلكتروني'],
      [form.accountingStart.trim() !== '', 'فترة السماح مطلوبة'],
    ];

    if (isPrivate) {
      requiredChecks.push(
        [Boolean(form.receiptNo.trim()), 'رقم الوصل مطلوب للدورة الخاصة'],
        [Boolean(form.codeSequence.trim()), 'تسلسل الكود مطلوب للدورة الخاصة'],
        [form.totalAmount.trim() !== '', 'المبلغ الكلي مطلوب للدورة الخاصة'],
        [form.paidAmount.trim() !== '', 'المبلغ المدفوع مطلوب للدورة الخاصة'],
      );
    }

    const missing = requiredChecks.find(([ok]) => !ok);
    if (missing) return missing[1];

    const phoneError = getPhoneValidationError(form.phone, 'رقم هاتف الطالب', true);
    if (phoneError) return phoneError;

    const parentPhoneError = getPhoneValidationError(form.parentPhone, 'رقم هاتف ولي الأمر', true);
    if (parentPhoneError) return parentPhoneError;

    if (!isValidAccountingGraceDays(form.accountingStart)) return 'فترة السماح يجب أن تكون رقماً من 0 إلى 30 يوم';

    if (isPrivate && paidAmount > totalAmount) return 'المبلغ المدفوع لا يمكن أن يكون أكبر من المبلغ الكلي';

    const duplicateMessage = getStudentDuplicateMessage(students, {
      name: form.name,
      phone: form.phone,
      telegram: form.telegram,
    });
    if (duplicateMessage) return duplicateMessage;

    return null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const requiredError = validateRequiredFields();
    if (requiredError) { toast.error(requiredError); return; }

    const chapter = activeChapterForCourse(form.courseId);
    const result = addStudent({
      name: form.name.trim(),
      school: form.school.trim(),
      gender: form.gender,
      phone: form.phone.trim(),
      parentPhone: form.parentPhone.trim(),
      telegram: sanitizeTelegramInput(form.telegram),
      courseType: form.courseType,
      courseId: form.courseId,
      groupId: form.groupId,
      mainSite: isPrivate ? 'بغداد' : form.mainSite,
      subSite: form.subSite,
      receiptNo: isPrivate ? form.receiptNo.trim() : '',
      codeSequence: isPrivate ? form.codeSequence.trim() : '',
      totalAmount: isPrivate ? totalAmount : 0,
      paidAmount: isPrivate ? paidAmount : 0,
      installments: isPrivate ? [{ date: todayISO(), amount: paidAmount, note: 'دفعة التسجيل' }] : [],
      status: 'نشط',
      dismissalType: '',
      dismissalReason: '',
      createdAt: form.createdAt,
      accountingStart: form.accountingStart,
      opportunities: chapter?.opportunities ?? 0,
      baseOpportunities: chapter?.opportunities ?? 0,
    });

    if (!result.ok) { toast.error(result.message); return; }

    setForm(emptyForm());
    toast.success('تم حفظ بيانات الطالب', { description: 'تمت إضافة الطالب إلى سجل الطلاب بنجاح' });
  };

  return (
    <div className="mx-auto max-w-6xl px-1 py-2 md:px-4">
      <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white/95 shadow-xl shadow-black/5 dark:border-white/10 dark:bg-card/90">
        <div className="p-5 md:p-8 lg:p-10">
          <div className="mb-8 flex items-center justify-center border-b border-gray-100 pb-6 dark:border-white/10">
            <UserPlus className="ml-4 h-9 w-9 text-blue-600 dark:text-primary" />
            <div className="text-center">
              <h2 className="text-2xl font-extrabold text-gray-800 dark:text-foreground md:text-3xl">إضافة طالب جديد</h2>
              <p className="mt-2 text-sm text-gray-500 dark:text-muted-foreground">نموذج تسجيل الطالب حسب التصميم والمنطق المرفق</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            <input type="hidden" id="reg-createdAt" name="createdAt" value={form.createdAt} readOnly />
            <input type="hidden" id="reg-telegram" name="telegram" value={form.telegram} readOnly />

            <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="reg-name" className="font-bold text-gray-700 dark:text-foreground">اسم الطالب <RequiredMark /></Label>
                <div className="relative">
                  <FieldIcon icon={User} />
                  <Input id="reg-name" name="name" value={form.name} onChange={e => updateForm('name', e.target.value)} required placeholder="الاسم الرباعي واللقب" className={fieldBaseClass} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reg-school" className="font-bold text-gray-700 dark:text-foreground">اسم المدرسة <RequiredMark /></Label>
                <div className="relative">
                  <FieldIcon icon={School} />
                  <Input id="reg-school" name="school" value={form.school} onChange={e => updateForm('school', e.target.value)} required placeholder="اسم المدرسة" className={fieldBaseClass} />
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="reg-phone" className="font-bold text-gray-700 dark:text-foreground">رقم هاتف الطالب <RequiredMark /></Label>
                <div className="relative">
                  <FieldIcon icon={Smartphone} />
                  <Input
                    id="reg-phone"
                    name="phone"
                    value={form.phone}
                    onChange={e => updatePhoneForm('phone', e.target.value)}
                    required
                    placeholder="07xxxxxxxxx"
                    inputMode="numeric"
                    maxLength={11}
                    pattern="07[0-9]{9}"
                    dir="ltr"
                    className={`${fieldBaseClass} text-left`}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reg-parentPhone" className="font-bold text-gray-700 dark:text-foreground">رقم هاتف ولي الأمر <RequiredMark /></Label>
                <div className="relative">
                  <FieldIcon icon={PhoneCall} />
                  <Input
                    id="reg-parentPhone"
                    name="parentPhone"
                    value={form.parentPhone}
                    onChange={e => updatePhoneForm('parentPhone', e.target.value)}
                    required
                    placeholder="07xxxxxxxxx"
                    inputMode="numeric"
                    maxLength={11}
                    pattern="07[0-9]{9}"
                    dir="ltr"
                    className={`${fieldBaseClass} text-left`}
                  />
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-blue-100 bg-blue-50/60 p-5 dark:border-primary/20 dark:bg-primary/10 md:p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <h3 className="flex items-center text-lg font-extrabold text-blue-800 dark:text-primary">
                  <BookOpen className="ml-2 h-5 w-5" />
                  تفاصيل الدورة
                </h3>
                {isPrivate && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowRules(true)}>
                    عرض شروط الدورة الخاصة
                  </Button>
                )}
              </div>

              <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="reg-courseType" className="font-bold text-gray-700 dark:text-foreground">نوع الدورة <RequiredMark /></Label>
                  <Select value={form.courseType} onValueChange={handleCourseTypeChange}>
                    <SelectTrigger id="reg-courseType" className={selectTriggerClass} aria-required="true"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="عامة">عامة</SelectItem>
                      <SelectItem value="خاصة">خاصة</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reg-courseId" className="font-bold text-gray-700 dark:text-foreground">الدورة <RequiredMark /></Label>
                  <Select value={form.courseId} onValueChange={handleCourseChange} disabled={filteredCourses.length === 0}>
                    <SelectTrigger id="reg-courseId" className={selectTriggerClass} aria-required="true">
                      <SelectValue placeholder={filteredCourses.length === 0 ? 'لا توجد دورات مسجلة' : 'اختر الدورة...'} />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredCourses.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">لا توجد دورات مسجلة لهذا النوع</div>
                      ) : filteredCourses.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isPrivate && (
                <div className="mb-6 space-y-6 rounded-2xl border border-purple-200 bg-purple-50/80 p-5 dark:border-primary/30 dark:bg-primary/10 md:p-6">
                  <div className="flex items-center">
                    <Star className="ml-2 h-5 w-5 text-purple-600 dark:text-primary" />
                    <h4 className="font-extrabold text-purple-800 dark:text-primary">بيانات الدورة الخاصة</h4>
                  </div>

                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="reg-receiptNo" className="font-bold text-gray-700 dark:text-foreground">رقم الوصل <RequiredMark /></Label>
                      <div className="relative">
                        <FieldIcon icon={Receipt} className="text-purple-400" />
                        <Input id="reg-receiptNo" name="receiptNo" value={form.receiptNo} onChange={e => updateForm('receiptNo', e.target.value)} required placeholder="أدخل رقم الوصل" className="h-12 rounded-xl border border-purple-200 bg-white pr-10 pl-4 focus-visible:ring-2 focus-visible:ring-purple-500 dark:border-primary/30 dark:bg-white/10" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reg-codeSequence" className="font-bold text-gray-700 dark:text-foreground">تسلسل الكود <RequiredMark /></Label>
                      <div className="relative">
                        <FieldIcon icon={Barcode} className="text-purple-400" />
                        <Input id="reg-codeSequence" name="codeSequence" value={form.codeSequence} onChange={e => updateForm('codeSequence', e.target.value)} required placeholder="أدخل تسلسل الكود" className="h-12 rounded-xl border border-purple-200 bg-white pr-10 pl-4 focus-visible:ring-2 focus-visible:ring-purple-500 dark:border-primary/30 dark:bg-white/10" />
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-purple-200 pt-6 dark:border-primary/20">
                    <h4 className="mb-4 flex items-center font-extrabold text-purple-800 dark:text-primary">
                      <Coins className="ml-2 h-5 w-5" />
                      نظام الأقساط
                    </h4>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="reg-totalAmount" className="font-bold text-gray-700 dark:text-foreground">المبلغ الكلي <RequiredMark /></Label>
                        <div className="relative">
                          <Input id="reg-totalAmount" name="totalAmount" value={form.totalAmount} onChange={e => updateAmountForm('totalAmount', e.target.value)} required inputMode="numeric" placeholder="0" className="h-12 rounded-xl border border-purple-200 bg-white pl-12 pr-4 focus-visible:ring-2 focus-visible:ring-purple-500 dark:border-primary/30 dark:bg-white/10" />
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 font-bold text-gray-500">د.ع</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reg-paidAmount" className="font-bold text-gray-700 dark:text-foreground">المبلغ المدفوع <RequiredMark /></Label>
                        <div className="relative">
                          <Input id="reg-paidAmount" name="paidAmount" value={form.paidAmount} onChange={e => updateAmountForm('paidAmount', e.target.value)} required inputMode="numeric" placeholder="0" className="h-12 rounded-xl border border-purple-200 bg-white pl-12 pr-4 focus-visible:ring-2 focus-visible:ring-purple-500 dark:border-primary/30 dark:bg-white/10" />
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 font-bold text-gray-500">د.ع</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reg-remainingAmount" className="font-bold text-gray-700 dark:text-foreground">المبلغ المتبقي</Label>
                        <div className="relative">
                          <Input id="reg-remainingAmount" name="remainingAmount" value={String(remainingAmount)} readOnly placeholder="0" className="h-12 rounded-xl border border-gray-200 bg-gray-100 pl-12 pr-4 font-bold text-red-600 dark:border-white/10 dark:bg-white/5" />
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 font-bold text-gray-500">د.ع</span>
                        </div>
                        <p className="text-xs text-muted-foreground">المتبقي: {formatAmount(remainingAmount)} د.ع</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="reg-mainSite" className="font-bold text-gray-700 dark:text-foreground">الموقع الرئيسي <RequiredMark /></Label>
                  <Select value={form.mainSite} onValueChange={v => setForm(prev => ({ ...prev, mainSite: v, subSite: '' }))} disabled={isPrivate}>
                    <SelectTrigger id="reg-mainSite" className={`${selectTriggerClass} disabled:opacity-100`} aria-required="true">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {mainSiteOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className={isPrivate ? 'text-xs font-bold text-purple-600 dark:text-primary' : 'text-xs text-gray-500 dark:text-muted-foreground'}>
                    {isPrivate ? <><Lock className="ml-1 inline h-3.5 w-3.5" /> تم تحديد بغداد تلقائياً للدورة الخاصة</> : 'اختر الموقع الرئيسي حسب الدورة'}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reg-subSite" className="font-bold text-gray-700 dark:text-foreground">الموقع الفرعي {subSiteOptions.length > 0 && <RequiredMark />}</Label>
                  <Select value={form.subSite} onValueChange={v => updateForm('subSite', v)} disabled={subSiteOptions.length === 0}>
                    <SelectTrigger id="reg-subSite" className={selectTriggerClass} aria-required={subSiteOptions.length > 0}>
                      <SelectValue placeholder={subSiteOptions.length === 0 ? 'لا توجد مواقع فرعية' : 'اختر الموقع الفرعي...'} />
                    </SelectTrigger>
                    <SelectContent>
                      {subSiteOptions.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">لا توجد مواقع فرعية لهذا الموقع</div>
                      ) : subSiteOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="reg-groupId" className="font-bold text-gray-700 dark:text-foreground">الكروب الإلكتروني <RequiredMark /></Label>
                  <Select value={form.groupId} onValueChange={v => updateForm('groupId', v)} disabled={!form.courseId || filteredGroups.length === 0}>
                    <SelectTrigger id="reg-groupId" className={selectTriggerClass} aria-required="true">
                      <SelectValue placeholder={!form.courseId ? 'اختر الدورة أولاً...' : filteredGroups.length === 0 ? 'لا توجد كروبات إلكترونية' : 'اختر الكروب الإلكتروني...'} />
                    </SelectTrigger>
                    <SelectContent>
                      {!form.courseId ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">اختر الدورة أولاً</div>
                      ) : filteredGroups.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">لا توجد كروبات إلكترونية لهذه الدورة</div>
                      ) : filteredGroups.map(g => <SelectItem key={g.id} value={g.id}>{g.name} - {g.electronicGroup}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-white/10 dark:bg-white/5">
                <Label htmlFor="reg-accountingStart" className="mb-2 block font-bold text-gray-700 dark:text-foreground">فترة السماح (أيام)</Label>
                <div className="flex items-center gap-4">
                  <Input id="reg-accountingStart" name="accountingStart" value={form.accountingStart} onChange={e => updateGraceDays(e.target.value)} inputMode="numeric" pattern="(?:[0-9]|[12][0-9]|30)" required className="h-11 w-24 rounded-lg text-center" />
                  <span className="text-sm text-gray-500 dark:text-muted-foreground">أيام لا تُحتسب فيها النقاط</span>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-white/10 dark:bg-white/5">
                <Label className="mb-3 block font-bold text-gray-700 dark:text-foreground">الجنس <RequiredMark /></Label>
                <div className="flex gap-8">
                  <label htmlFor="reg-gender-male" className="inline-flex cursor-pointer items-center">
                    <input type="radio" id="reg-gender-male" name="gender" value="ذكر" checked={form.gender === 'ذكر'} onChange={() => updateForm('gender', 'ذكر')} required className="h-5 w-5 accent-blue-600" />
                    <span className="mr-2 font-medium text-gray-700 dark:text-foreground">ذكر</span>
                  </label>
                  <label htmlFor="reg-gender-female" className="inline-flex cursor-pointer items-center">
                    <input type="radio" id="reg-gender-female" name="gender" value="أنثى" checked={form.gender === 'أنثى'} onChange={() => updateForm('gender', 'أنثى')} required className="h-5 w-5 accent-pink-500" />
                    <span className="mr-2 font-medium text-gray-700 dark:text-foreground">أنثى</span>
                  </label>
                </div>
              </div>
            </section>

            <div className="flex flex-col gap-3 pt-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-2 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm text-blue-800 dark:border-primary/20 dark:bg-primary/10 dark:text-primary">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>الدورة الخاصة تثبت الموقع الرئيسي على بغداد وتطلب اختيار المنصور أو زيونة أو البنوك مع بيانات الوصل والأقساط.</span>
              </div>
              <Button type="submit" className="h-14 min-w-56 rounded-xl px-10 py-4 text-lg font-bold shadow-lg transition-all hover:shadow-xl">
                <Save className="ml-3 h-5 w-5" />
                حفظ بيانات الطالب
              </Button>
            </div>
          </form>
        </div>
      </div>

      <Dialog open={showRules} onOpenChange={setShowRules}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>شروط الدورة الخاصة</DialogTitle>
          </DialogHeader>
          <ul className="space-y-3 text-sm leading-7">
            <li className="flex gap-2"><CheckCircle2 className="mt-1 h-4 w-4 text-green-600" /> الموقع الرئيسي يثبت تلقائياً على بغداد.</li>
            <li className="flex gap-2"><MapPin className="mt-1 h-4 w-4 text-purple-600" /> الموقع الفرعي مطلوب ويعرض فقط: المنصور، زيونة، البنوك.</li>
            <li className="flex gap-2"><WalletCards className="mt-1 h-4 w-4 text-blue-600" /> تظهر حقول رقم الوصل، تسلسل الكود، المبلغ الكلي، المدفوع، والمتبقي للدورات الخاصة فقط.</li>
            <li className="flex gap-2"><Users className="mt-1 h-4 w-4 text-blue-600" /> الكروب الإلكتروني يتغير حسب الدورة المختارة.</li>
            <li className="flex gap-2"><VenusAndMars className="mt-1 h-4 w-4 text-pink-600" /> الجنس وفترة السماح من بيانات التسجيل الأساسية.</li>
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
