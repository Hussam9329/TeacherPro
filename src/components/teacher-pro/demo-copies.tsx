'use client';

import React, { useState } from 'react';
import {
  useTeacherStore,
  DEFAULT_DEMO_LIMITS,
  type DemoCopy,
  type DemoUsageLimits,
} from '@/lib/teacher-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { EmptyState } from './ui-kit';
import { useActionLock } from '@/hooks/use-action-lock';
import {
  Copy,
  Play,
  Square,
  RefreshCw,
  Clock,
  Trash2,
  Plus,
  ArrowRightLeft,
  Timer,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

// ─── Helper ──────────────────────────────────────────────────────────────────

function getDemoStatus(demo: DemoCopy): {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  icon: React.ElementType;
} {
  if (!demo.active) return { label: 'معطل', variant: 'secondary', icon: XCircle };
  if (demo.expiresAt && new Date(demo.expiresAt) < new Date())
    return { label: 'منتهي', variant: 'destructive', icon: AlertTriangle };
  return { label: 'فعال', variant: 'default', icon: CheckCircle2 };
}

function formatDate(iso: string | null): string {
  if (!iso) return 'بدون انتهاء';
  return new Date(iso).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function daysRemaining(demo: DemoCopy): number | null {
  if (!demo.expiresAt) return null;
  const diff = new Date(demo.expiresAt).getTime() - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

const LIMIT_LABELS: Record<keyof DemoUsageLimits, string> = {
  students: 'الطلاب',
  courses: 'الدورات',
  sites: 'المواقع',
  chapters: 'الفصول',
  exams: 'الامتحانات',
  grades: 'الدرجات',
  correction: 'التصحيح',
};

// ─── Demo Copies Tab (for Accounts page) ─────────────────────────────────────

export function DemoCopiesTab() {
  const {
    demoCopies,
    activeDemoId,
    createDemoCopy,
    deleteDemoCopy,
    toggleDemoCopy,
    extendDemoCopy,
    resetDemoCopyData,
    enterDemoCopy,
    exitDemoCopy,
  } = useTeacherStore();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newDemo, setNewDemo] = useState({
    name: '',
    description: '',
    durationDays: 7,
    fromData: false,
  });
  const [customLimits, setCustomLimits] = useState<DemoUsageLimits>({
    ...DEFAULT_DEMO_LIMITS,
  });
  const [useCustomLimits, setUseCustomLimits] = useState(false);

  const [extendDialog, setExtendDialog] = useState({
    open: false,
    id: '',
    name: '',
    days: 7,
  });
  const [deleteDialog, setDeleteDialog] = useState({
    open: false,
    id: '',
    name: '',
  });
  const { locked: isCreatingDemo, runLocked: runCreateDemoLocked } = useActionLock();
  const { locked: isExtendingDemo, runLocked: runExtendDemoLocked } = useActionLock();
  const { locked: isDeletingDemo, runLocked: runDeleteDemoLocked } = useActionLock();

  const handleCreate = runCreateDemoLocked(async () => {
    if (!newDemo.name.trim()) {
      toast.error('يرجى إدخال اسم النسخة');
      return;
    }
    createDemoCopy(
      newDemo.name.trim(),
      newDemo.description.trim(),
      newDemo.durationDays,
      newDemo.fromData,
      useCustomLimits ? customLimits : undefined
    );
    setShowCreateDialog(false);
    setNewDemo({ name: '', description: '', durationDays: 7, fromData: false });
    setUseCustomLimits(false);
    setCustomLimits({ ...DEFAULT_DEMO_LIMITS });
    toast.success('تم إنشاء نسخة الديمو');
  });

  const handleExtend = runExtendDemoLocked(async () => {
    if (extendDialog.days <= 0) {
      toast.error('يرجى إدخال عدد أيام صحيح');
      return;
    }
    extendDemoCopy(extendDialog.id, extendDialog.days);
    setExtendDialog({ open: false, id: '', name: '', days: 7 });
    toast.success('تم تمديد نسخة الديمو');
  });

  const handleDelete = runDeleteDemoLocked(async () => {
    const ok = deleteDemoCopy(deleteDialog.id);
    if (ok) toast.success('تم حذف نسخة الديمو');
    else toast.error('لا يمكن حذف هذه النسخة');
    setDeleteDialog({ open: false, id: '', name: '' });
  });

  const handleEnter = (id: string) => {
    enterDemoCopy(id);
    toast.success('تم دخول بيئة الديمو');
  };

  const handleExit = () => {
    exitDemoCopy();
    toast.success('تم الخروج من بيئة الديمو');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">نسخ الديمو التجريبية</h3>
          <p className="text-sm text-muted-foreground">
            إنشاء بيئات تجريبية معزولة للتجربة والتدريب
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="w-4 h-4 ml-2" />
          إنشاء نسخة ديمو
        </Button>
      </div>

      {/* Active demo banner */}
      {activeDemoId && (
        <Card className="border-amber-500 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center">
                <Play className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-amber-900 dark:text-amber-100">
                  أنت الآن في بيئة ديمو تجريبية
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  {demoCopies.find((d) => d.id === activeDemoId)?.name || 'ديمو'}
                </p>
              </div>
              <Button variant="destructive" size="sm" onClick={handleExit}>
                <Square className="w-4 h-4 ml-2" />
                خروج من الديمو
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Demo copies list */}
      {demoCopies.length === 0 ? (
        <EmptyState
          icon={Copy}
          title="لا توجد نسخ ديمو بعد"
          description="أنشئ نسخة ديمو لعزل التجارب والتدريب عن بياناتك الأساسية."
          action={
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="w-4 h-4 ml-2" />
              إنشاء نسخة ديمو
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {demoCopies.map((demo) => {
            const status = getDemoStatus(demo);
            const remaining = daysRemaining(demo);
            const StatusIcon = status.icon;
            const isActive = activeDemoId === demo.id;

            return (
              <Card
                key={demo.id}
                className={`transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10 ${
                  isActive ? 'ring-2 ring-amber-500' : ''
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-bold">{demo.name}</p>
                      {demo.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {demo.description}
                        </p>
                      )}
                    </div>
                    <Badge variant={status.variant} className="text-[10px]">
                      <StatusIcon className="w-3 h-3 ml-1" />
                      {status.label}
                    </Badge>
                  </div>

                  <div className="space-y-2 mb-3">
                    <div className="flex items-center gap-2 text-xs">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>تنتهي: {formatDate(demo.expiresAt)}</span>
                      {remaining !== null && (
                        <Badge
                          variant={remaining <= 0 ? 'destructive' : 'outline'}
                          className="text-[10px]"
                        >
                          {remaining > 0 ? `${remaining} يوم` : 'منتهي'}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Timer className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>
                        المدة: {demo.durationDays} يوم
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>
                        {demo.createdFromData
                          ? 'من البيانات الحالية'
                          : 'بيانات فارغة'}
                      </span>
                    </div>
                  </div>

                  {/* Limits summary */}
                  <div className="mb-3">
                    <p className="text-[10px] text-muted-foreground mb-1">
                      حدود الاستخدام
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {(
                        Object.entries(demo.limits) as [
                          keyof DemoUsageLimits,
                          number,
                        ][]
                      ).slice(0, 5).map(([key, val]) => (
                        <Badge
                          key={key}
                          variant="outline"
                          className="text-[10px]"
                        >
                          {LIMIT_LABELS[key]}: {val}
                        </Badge>
                      ))}
                      {Object.keys(demo.limits).length > 5 && (
                        <Badge variant="outline" className="text-[10px]">
                          +{Object.keys(demo.limits).length - 5}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <Separator className="mb-3" />

                  {/* Actions */}
                  <div className="grid grid-cols-2 gap-2">
                    {isActive ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="text-xs col-span-2"
                        onClick={handleExit}
                      >
                        <Square className="w-3.5 h-3.5 ml-1" />
                        خروج من الديمو
                      </Button>
                    ) : (
                      <Button
                        variant="default"
                        size="sm"
                        className="text-xs"
                        onClick={() => handleEnter(demo.id)}
                        disabled={!demo.active || (demo.expiresAt ? new Date(demo.expiresAt) < new Date() : false)}
                      >
                        <Play className="w-3.5 h-3.5 ml-1" />
                        دخول
                      </Button>
                    )}
                    {!isActive && (
                      <Button
                        variant={demo.active ? 'outline' : 'secondary'}
                        size="sm"
                        className="text-xs"
                        onClick={() => {
                          toggleDemoCopy(demo.id);
                          toast.success(
                            demo.active ? 'تم تعطيل النسخة' : 'تم تفعيل النسخة'
                          );
                        }}
                      >
                        {demo.active ? 'تعطيل' : 'تفعيل'}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() =>
                        setExtendDialog({
                          open: true,
                          id: demo.id,
                          name: demo.name,
                          days: 7,
                        })
                      }
                    >
                      <Clock className="w-3.5 h-3.5 ml-1" />
                      تمديد
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        resetDemoCopyData(demo.id);
                        toast.success('تم تصفير بيانات الديمو');
                      }}
                    >
                      <RefreshCw className="w-3.5 h-3.5 ml-1" />
                      تصفير
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="text-xs"
                      onClick={() =>
                        setDeleteDialog({
                          open: true,
                          id: demo.id,
                          name: demo.name,
                        })
                      }
                    >
                      <Trash2 className="w-3.5 h-3.5 ml-1" />
                      حذف
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Demo Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>إنشاء نسخة ديمو جديدة</DialogTitle>
            <DialogDescription>
              أنشئ بيئة تجريبية معزولة للتجربة والتدريب
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="demo-name">اسم النسخة</Label>
              <Input
                id="demo-name" name="name" autoComplete="off"
                value={newDemo.name}
                onChange={(e) =>
                  setNewDemo((p) => ({ ...p, name: e.target.value }))
                }
                placeholder="مثال: تجربة الفصل الأول"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="demo-description">الوصف</Label>
              <Input
                id="demo-description" name="description" autoComplete="off"
                value={newDemo.description}
                onChange={(e) =>
                  setNewDemo((p) => ({ ...p, description: e.target.value }))
                }
                placeholder="وصف مختصر للنسخة"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="demo-duration">مدة الصلاحية (بالأيام)</Label>
              <Input
                id="demo-duration" name="durationDays" autoComplete="off"
                type="number"
                min={1}
                max={365}
                value={newDemo.durationDays}
                onChange={(e) =>
                  setNewDemo((p) => ({
                    ...p,
                    durationDays: parseInt(e.target.value) || 7,
                  }))
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="demo-fromData"
                name="fromData"
                checked={newDemo.fromData}
                onCheckedChange={(v) =>
                  setNewDemo((p) => ({ ...p, fromData: !!v }))
                }
              />
              <Label htmlFor="demo-fromData">نسخ من البيانات الحالية</Label>
            </div>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="demo-customLimits"
                  name="customLimits"
                  checked={useCustomLimits}
                  onCheckedChange={(v) => setUseCustomLimits(!!v)}
                />
                <Label htmlFor="demo-customLimits">تخصيص حدود الاستخدام</Label>
              </div>
              {useCustomLimits && (
                <ScrollArea className="max-h-48">
                  <div className="grid grid-cols-2 gap-3 pr-2">
                    {(
                      Object.entries(customLimits) as [
                        keyof DemoUsageLimits,
                        number,
                      ][]
                    ).map(([key, val]) => (
                      <div key={key} className="space-y-1">
                        <Label htmlFor={`demo-limit-${key}`} className="text-xs">{LIMIT_LABELS[key]}</Label>
                        <Input
                          id={`demo-limit-${key}`}
                          name={`limit-${key}`}
                          type="number"
                          autoComplete="off"
                          min={1}
                          value={val}
                          onChange={(e) =>
                            setCustomLimits((p) => ({
                              ...p,
                              [key]: parseInt(e.target.value) || 1,
                            }))
                          }
                          className="h-8 text-sm"
                        />
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
            >
              إلغاء
            </Button>
            <Button onClick={handleCreate} disabled={isCreatingDemo}>{isCreatingDemo ? 'جاري الإنشاء...' : 'إنشاء'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extend Demo Dialog */}
      <Dialog
        open={extendDialog.open}
        onOpenChange={(o) =>
          setExtendDialog((p) => ({ ...p, open: o }))
        }
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تمديد نسخة الديمو</DialogTitle>
            <DialogDescription>
              تمديد صلاحية &quot;{extendDialog.name}&quot; بأيام إضافية
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="demo-extend-days">عدد الأيام الإضافية</Label>
              <Input
                id="demo-extend-days" name="days" autoComplete="off"
                type="number"
                min={1}
                max={365}
                value={extendDialog.days}
                onChange={(e) =>
                  setExtendDialog((p) => ({
                    ...p,
                    days: parseInt(e.target.value) || 7,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setExtendDialog({ open: false, id: '', name: '', days: 7 })
              }
            >
              إلغاء
            </Button>
            <Button onClick={handleExtend} disabled={isExtendingDemo}>{isExtendingDemo ? 'جاري التمديد...' : 'تمديد'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Demo AlertDialog */}
      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(o) =>
          setDeleteDialog((p) => ({ ...p, open: o }))
        }
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف نسخة الديمو &quot;{deleteDialog.name}&quot;؟ سيتم حذف
              جميع البيانات المرتبطة بها.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeletingDemo}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingDemo ? 'جاري الحذف...' : 'حذف'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Demo Copies View (standalone section) ───────────────────────────────────

export function DemoCopiesView() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold gradient-brand bg-gradient-to-r from-amber-600 to-orange-500 bg-clip-text text-transparent">
          نسخ الديمو التجريبية
        </h2>
        <p className="text-sm text-muted-foreground">
          إنشاء وإدارة بيئات تجريبية معزولة للتجربة والتدريب
        </p>
      </div>
      <DemoCopiesTab />
    </div>
  );
}
