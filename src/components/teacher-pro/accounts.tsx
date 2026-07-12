'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTeacherStore, PERMISSION_CATALOG, type PermissionEntry } from '@/lib/teacher-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/lib/user-toast';
import { useActionLock } from '@/hooks/use-action-lock';
import { useLatestRequest } from '@/hooks/use-latest-request';
import {
  useTeacherProBackgroundSyncDetector,
  useTeacherProSyncKey,
} from '@/hooks/use-teacherpro-sync';

// ─── Permission categories for grouping ──────────────────────────────────────

const PREFERRED_PERMISSION_CATEGORIES = [
  'النظام',
  'الدورات',
  'الفصول',
  'الطلاب',
  'الامتحانات',
  'الدرجات',
  'الدرجات / الطلاب غير الموجودين',
  'الفرص',
  'المتابعة',
  'المتابعة / المكالمات',
  'المتابعة / الإجازات',
  'المتابعة / التعهدات',
  'التصحيح',
  'التصحيح الإلكتروني',
  'إدارة الحسابات / المستخدمين',
  'إدارة الحسابات / الأدوار',
  'إدارة الحسابات / الصلاحيات',
  'إدارة الحسابات / الأمان',
  'الحسابات',
  'السجلات',
  'تصفير الـ Log',
  'المواقع',
  'واتساب',
  'نسخ الديمو',
];

const ALL_PERMISSION_CATEGORIES = Array.from(new Set(PERMISSION_CATALOG.map(permission => permission.category))) as string[];
const PERMISSION_CATEGORIES: string[] = [
  ...PREFERRED_PERMISSION_CATEGORIES.filter(category => ALL_PERMISSION_CATEGORIES.includes(category)),
  ...ALL_PERMISSION_CATEGORIES.filter(category => !PREFERRED_PERMISSION_CATEGORIES.includes(category)),
];

const ACCOUNT_DIALOG_CONTENT_CLASS = 'max-h-[88vh] max-w-3xl overflow-hidden p-0 flex flex-col';
const ACCOUNT_DIALOG_HEADER_CLASS = 'shrink-0 px-6 pt-6 pb-3';
const ACCOUNT_DIALOG_BODY_CLASS = 'min-h-0 flex-1 overflow-y-auto px-6 py-2 space-y-4';
const ACCOUNT_DIALOG_FOOTER_CLASS = 'shrink-0 border-t bg-background/95 px-6 py-4';

const PERMISSION_LEVEL_LABELS: Record<PermissionEntry['level'], string> = {
  read: 'عرض',
  write: 'إضافة/تعديل',
  delete: 'حذف',
  manage: 'إدارة',
};

function normalizePermissionIds(permissions: string[]) {
  return Array.from(new Set(permissions.filter(Boolean)));
}

function getPermissionsByCategory(permissions: PermissionEntry[]) {
  const map = new Map<string, PermissionEntry[]>();
  for (const p of permissions) {
    if (!map.has(p.category)) map.set(p.category, []);
    map.get(p.category)!.push(p);
  }
  return map;
}

function selectedPermissions(permissions: string[]) {
  const selected = new Set(normalizePermissionIds(permissions));
  return PERMISSION_CATALOG.filter(permission => selected.has(permission.id));
}

function selectedPermissionCategories(permissions: string[]) {
  const selected = new Set(normalizePermissionIds(permissions));
  return PERMISSION_CATEGORIES.filter(cat => {
    const catPerms = PERMISSION_CATALOG.filter(p => p.category === cat).map(p => p.id);
    return catPerms.some(p => selected.has(p));
  });
}

function PermissionCategoryBadges({ permissions, limit = 5 }: { permissions: string[]; limit?: number }) {
  const categories = selectedPermissionCategories(permissions);

  if (categories.length === 0) {
    return <Badge variant="outline" className="text-[10px]">بدون صلاحيات</Badge>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {categories.slice(0, limit).map(cat => (
        <Badge key={cat} variant="outline" className="text-[10px]">{cat}</Badge>
      ))}
      {categories.length > limit && (
        <Badge variant="outline" className="text-[10px]">+{categories.length - limit}</Badge>
      )}
    </div>
  );
}

function PermissionCompactSummary({ permissions }: { permissions: string[] }) {
  const normalized = normalizePermissionIds(permissions);
  const selected = new Set(normalized);
  const categoryRows = PERMISSION_CATEGORIES
    .map(category => {
      const categoryPermissions = PERMISSION_CATALOG.filter(permission => permission.category === category);
      const count = categoryPermissions.filter(permission => selected.has(permission.id)).length;
      return { category, count, total: categoryPermissions.length };
    })
    .filter(row => row.count > 0);

  return (
    <div className="rounded-xl border bg-muted/25 p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold">تفصيل مختصر للصلاحيات</span>
        <Badge variant="secondary" className="text-[10px]">{normalized.length} / {PERMISSION_CATALOG.length}</Badge>
      </div>
      {categoryRows.length === 0 ? (
        <p className="text-muted-foreground">لا توجد صلاحيات مفعّلة لهذا الحساب.</p>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {categoryRows.slice(0, 6).map(row => (
            <div key={row.category} className="flex items-center justify-between rounded-lg border bg-background/70 px-2 py-1">
              <span className="font-medium">{row.category}</span>
              <span className="text-muted-foreground">{row.count}/{row.total}</span>
            </div>
          ))}
          {categoryRows.length > 6 && (
            <div className="rounded-lg border bg-background/70 px-2 py-1 text-muted-foreground">
              +{categoryRows.length - 6} أقسام أخرى
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PermissionDetailsList({ permissions, showEmpty = false }: { permissions: string[]; showEmpty?: boolean }) {
  const selected = new Set(normalizePermissionIds(permissions));
  const catalogByCategory = getPermissionsByCategory(PERMISSION_CATALOG);

  return (
    <div className="space-y-3">
      {PERMISSION_CATEGORIES.map(category => {
        const categoryPermissions = catalogByCategory.get(category) || [];
        if (categoryPermissions.length === 0) return null;
        const enabledPermissions = categoryPermissions.filter(permission => selected.has(permission.id));
        if (!showEmpty && enabledPermissions.length === 0) return null;

        return (
          <div key={category} className="rounded-xl border bg-background p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">{category}</div>
              <Badge variant={enabledPermissions.length === categoryPermissions.length ? 'default' : 'secondary'} className="text-[10px]">
                {enabledPermissions.length} من {categoryPermissions.length}
              </Badge>
            </div>
            {enabledPermissions.length === 0 ? (
              <p className="text-xs text-muted-foreground">لا توجد صلاحيات مفعّلة ضمن هذا القسم.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {enabledPermissions.map(permission => (
                  <div key={permission.id} className="rounded-lg border bg-muted/20 p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{permission.label}</span>
                      <Badge variant="outline" className="text-[10px]">{PERMISSION_LEVEL_LABELS[permission.level]}</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{permission.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PermissionChecklist({
  perms,
  onChange,
  readOnly = false,
}: {
  perms: string[];
  onChange: (permissions: string[]) => void;
  readOnly?: boolean;
}) {
  const catalogByCategory = useMemo(() => getPermissionsByCategory(PERMISSION_CATALOG), []);

  const togglePermission = (permId: string) => {
    if (readOnly) return;
    onChange(perms.includes(permId) ? perms.filter(p => p !== permId) : [...perms, permId]);
  };

  const toggleCategory = (category: string) => {
    if (readOnly) return;
    const catPerms = PERMISSION_CATALOG.filter(p => p.category === category).map(p => p.id);
    const allChecked = catPerms.every(p => perms.includes(p));
    onChange(allChecked ? perms.filter(p => !catPerms.includes(p)) : [...new Set([...perms, ...catPerms])]);
  };

  return (
    <ScrollArea className="max-h-[52vh] rounded-xl border bg-muted/15 p-3">
      <div className="space-y-4">
        {PERMISSION_CATEGORIES.map(cat => {
          const catPerms = catalogByCategory.get(cat);
          if (!catPerms || catPerms.length === 0) return null;
          const catIds = catPerms.map(p => p.id);
          const allChecked = catIds.every(p => perms.includes(p));
          const someChecked = catIds.some(p => perms.includes(p));

          return (
            <div key={cat} className="space-y-2 rounded-xl border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`perm-cat-${cat}`}
                    name={`perm-cat-${cat}`}
                    checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                    onCheckedChange={() => toggleCategory(cat)}
                    disabled={readOnly}
                  />
                  <Label htmlFor={`perm-cat-${cat}`} className="font-semibold text-sm">{cat}</Label>
                </div>
                <Badge variant="outline" className="text-[10px]">{catIds.filter(p => perms.includes(p)).length}/{catIds.length}</Badge>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {catPerms.map(perm => (
                  <div key={perm.id} className="flex items-start gap-2 rounded-lg border bg-muted/15 p-2">
                    <Checkbox
                      id={`perm-${perm.id}`}
                      name={`perm-${perm.id}`}
                      checked={perms.includes(perm.id)}
                      onCheckedChange={() => togglePermission(perm.id)}
                      disabled={readOnly}
                      className="mt-1 h-3.5 w-3.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Label htmlFor={`perm-${perm.id}`} className="text-xs font-semibold">{perm.label}</Label>
                        <Badge variant="secondary" className="text-[9px]">{PERMISSION_LEVEL_LABELS[perm.level]}</Badge>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{perm.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}


const PAGE_PERMISSION_BLUEPRINT = [
  { page: 'مكالمات', view: 'follow-up.calls.view', manage: 'follow-up.calls.manage' },
  { page: 'الإجازات', view: 'follow-up.leaves.view', manage: 'follow-up.leaves.manage' },
  { page: 'التعهدات', view: 'follow-up.pledges.view', manage: 'follow-up.pledges.manage' },
  { page: 'الطلاب غير الموجودين', view: 'grades.missing.view', manage: 'grades.missing.manage' },
  { page: 'إدارة الحسابات / المستخدمين', view: 'accounts.users.view', manage: 'accounts.users.add / edit / delete' },
  { page: 'إدارة الحسابات / الأدوار', view: 'accounts.roles.view', manage: 'accounts.roles.add / edit / delete' },
  { page: 'إدارة الحسابات / الصلاحيات', view: 'accounts.permissions.view', manage: 'accounts.permissions.assign' },
  { page: 'السجلات', view: 'logs.view', manage: 'logs.delete' },
  { page: 'تصفير الـ Log', view: 'logs.clear', manage: 'logs.restore' },
];

function PermissionsArchitectureTab() {
  const grouped = getPermissionsByCategory(PERMISSION_CATALOG);
  const totalByLevel = PERMISSION_CATALOG.reduce<Record<string, number>>((acc, permission) => {
    acc[permission.level] = (acc[permission.level] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">هيكلة الصلاحيات الذكية</CardTitle>
          <p className="text-sm text-muted-foreground">
            كل صفحة وكل إجراء حساس صار له رمز الصلاحية واضح. أي ميزة جديدة تنضاف لأي صفحة لازم تنضاف هنا داخل PERMISSION_CATALOG وتنعكس تلقائياً في إدارة الأدوار والحسابات.
          </p>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">إجمالي الصلاحيات</p><p className="text-2xl font-black">{PERMISSION_CATALOG.length}</p></div>
          <div className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">عرض</p><p className="text-2xl font-black">{totalByLevel.read || 0}</p></div>
          <div className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">إضافة/تعديل</p><p className="text-2xl font-black">{totalByLevel.write || 0}</p></div>
          <div className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">إدارة/حذف</p><p className="text-2xl font-black">{(totalByLevel.manage || 0) + (totalByLevel.delete || 0)}</p></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ربط الصفحات والإجراءات</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {PAGE_PERMISSION_BLUEPRINT.map((item) => (
            <div key={item.page} className="rounded-xl border bg-background p-3">
              <p className="mb-2 font-semibold">{item.page}</p>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p><span className="font-semibold text-foreground">عرض:</span> {item.view}</p>
                <p><span className="font-semibold text-foreground">إجراء:</span> {item.manage}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {PERMISSION_CATEGORIES.map((category) => {
          const permissions = grouped.get(category) || [];
          if (permissions.length === 0) return null;
          return (
            <Card key={category}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{category}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {permissions.map((permission) => (
                  <div key={permission.id} className="rounded-xl border bg-muted/15 p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{permission.label}</span>
                      <Badge variant="outline" className="text-[10px]">{permission.id}</Badge>
                      <Badge variant="secondary" className="text-[10px]">{PERMISSION_LEVEL_LABELS[permission.level]}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{permission.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}


// ─── Roles Tab Component ─────────────────────────────────────────────────────

function RolesTab() {
  const { roles, addRole, updateRole, deleteRole, users } = useTeacherStore();

  const [showAddRoleDialog, setShowAddRoleDialog] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRolePerms, setNewRolePerms] = useState<string[]>([]);

  const [editRoleId, setEditRoleId] = useState<string | null>(null);
  const [editRolePerms, setEditRolePerms] = useState<string[]>([]);

  const [deleteRoleDialog, setDeleteRoleDialog] = useState({ open: false, id: '', name: '' });
  const { locked: isAddingRole, runLocked: runAddRoleLocked } = useActionLock();
  const { locked: isSavingRole, runLocked: runSaveRoleLocked } = useActionLock();
  const { locked: isDeletingRole, runLocked: runDeleteRoleLocked } = useActionLock();


  const handleAddRole = runAddRoleLocked(async () => {
    if (!newRoleName.trim()) {
      toast.error('يرجى إدخال اسم الدور');
      return;
    }
    addRole({ name: newRoleName.trim(), isDefault: false, permissions: newRolePerms });
    setShowAddRoleDialog(false);
    setNewRoleName('');
    setNewRolePerms([]);
    toast.success('تمت إضافة الدور');
  });

  const handleEditRole = (roleId: string) => {
    const role = roles.find(r => r.id === roleId);
    if (!role) return;
    setEditRoleId(roleId);
    setEditRolePerms(role.id === 'role_admin' ? PERMISSION_CATALOG.map(p => p.id) : [...role.permissions]);
  };

  const handleSaveRole = runSaveRoleLocked(async () => {
    if (!editRoleId) return;
    updateRole(editRoleId, { permissions: editRolePerms });
    // Also update all users with this role
    const roleName = roles.find(r => r.id === editRoleId)?.name;
    if (roleName) {
      users.forEach(u => {
        if (u.roleId === editRoleId) {
          useTeacherStore.getState().updateUserPermissions(u.id, [...editRolePerms]);
        }
      });
    }
    setEditRoleId(null);
    setEditRolePerms([]);
    toast.success('تم تحديث صلاحيات الدور');
  });

  const handleDeleteRole = runDeleteRoleLocked(async () => {
    const ok = deleteRole(deleteRoleDialog.id);
    if (ok) { toast.success('تم حذف الدور'); } else { toast.error('لا يمكن حذف هذا الدور'); }
    setDeleteRoleDialog({ open: false, id: '', name: '' });
  });


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">الأدوار والصلاحيات</h3>
          <p className="text-sm text-muted-foreground">إدارة أدوار المستخدمين وصلاحياتهم</p>
        </div>
        <Button onClick={() => setShowAddRoleDialog(true)}>إضافة دور</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {roles.map(role => {
          const userCount = users.filter(u => u.roleId === role.id).length;
          const displayedRolePermissions = role.id === 'role_admin' ? PERMISSION_CATALOG.map(p => p.id) : role.permissions;
          return (
            <Card key={role.id} className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-bold">{role.name}</p>
                    <p className="text-xs text-muted-foreground">{displayedRolePermissions.length} صلاحية</p>
                  </div>
                  <div className="flex gap-1">
                    {role.isDefault && <Badge variant="secondary" className="text-[10px]">افتراضي</Badge>}
                    <Badge variant="outline" className="text-[10px]">{userCount} مستخدم</Badge>
                  </div>
                </div>

                <div className="mb-3 space-y-3">
                  <PermissionCategoryBadges permissions={displayedRolePermissions} limit={5} />
                  <PermissionCompactSummary permissions={displayedRolePermissions} />
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="text-xs flex-1" onClick={() => handleEditRole(role.id)}>
                    تعديل الصلاحيات
                  </Button>
                  {!role.isDefault && (
                    <Button variant="destructive" size="sm" className="text-xs" onClick={() => setDeleteRoleDialog({ open: true, id: role.id, name: role.name })}>
                      حذف
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Add Role Dialog */}
      <Dialog open={showAddRoleDialog} onOpenChange={setShowAddRoleDialog}>
        <DialogContent dir="rtl" className={ACCOUNT_DIALOG_CONTENT_CLASS}>
          <DialogHeader className={ACCOUNT_DIALOG_HEADER_CLASS}>
            <DialogTitle>إضافة دور جديد</DialogTitle>
            <DialogDescription>أنشئ دوراً جديداً وحدد الصلاحيات المطلوبة</DialogDescription>
          </DialogHeader>
          <div className={ACCOUNT_DIALOG_BODY_CLASS}>
            <div className="space-y-2">
              <Label htmlFor="role-name">اسم الدور</Label>
              <Input id="role-name" name="roleName" autoComplete="off" value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="اسم الدور بالعربية" />
            </div>
            <div className="space-y-2">
              <span className="text-sm font-medium leading-none">الصلاحيات</span>
              <PermissionChecklist perms={newRolePerms} onChange={setNewRolePerms} />
            </div>
          </div>
          <DialogFooter className={ACCOUNT_DIALOG_FOOTER_CLASS}>
            <Button variant="outline" onClick={() => setShowAddRoleDialog(false)}>إلغاء</Button>
            <Button onClick={handleAddRole} disabled={isAddingRole}>{isAddingRole ? 'جاري الإضافة...' : 'إضافة'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Role Permissions Dialog */}
      <Dialog open={!!editRoleId} onOpenChange={() => { setEditRoleId(null); setEditRolePerms([]); }}>
        <DialogContent dir="rtl" className={ACCOUNT_DIALOG_CONTENT_CLASS}>
          <DialogHeader className={ACCOUNT_DIALOG_HEADER_CLASS}>
            <DialogTitle>تعديل صلاحيات الدور - {roles.find(r => r.id === editRoleId)?.name}</DialogTitle>
            <DialogDescription>
              {roles.find(r => r.id === editRoleId)?.isDefault
                ? 'هذا دور افتراضي. تعديل الصلاحيات سيؤثر على جميع المستخدمين المرتبطين.'
                : 'حدد الصلاحيات المطلوبة لهذا الدور'}
            </DialogDescription>
          </DialogHeader>
          <div className={ACCOUNT_DIALOG_BODY_CLASS}>
            <PermissionChecklist perms={editRolePerms} onChange={setEditRolePerms} readOnly={editRoleId === 'role_admin'} />
          </div>
          <DialogFooter className={ACCOUNT_DIALOG_FOOTER_CLASS}>
            <Button variant="outline" onClick={() => { setEditRoleId(null); setEditRolePerms([]); }}>إلغاء</Button>
            <Button onClick={handleSaveRole} disabled={isSavingRole || editRoleId === 'role_admin'}>{isSavingRole ? 'جاري الحفظ...' : editRoleId === 'role_admin' ? 'صلاحيات المدير كاملة دائماً' : 'حفظ'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Role AlertDialog */}
      <AlertDialog open={deleteRoleDialog.open} onOpenChange={o => setDeleteRoleDialog(prev => ({ ...prev, open: o }))}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد حذف الدور</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف الدور &quot;{deleteRoleDialog.name}&quot;؟ سيتم نقل المستخدمين المرتبطين إلى دور &quot;مشاهدة فقط&quot;. لا يمكن حذف الأدوار الافتراضية.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRole} disabled={isDeletingRole} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isDeletingRole ? 'جاري الحذف...' : 'حذف'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Users Tab Component ─────────────────────────────────────────────────────

function UsersTab() {
  const { users, roles, addUser, updateUser, toggleUser, updateUserPermissions, deleteUser } = useTeacherStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '', name: '', password: '', roleId: 'role_checker', permissions: [] as string[],
  });

  const [editPermsId, setEditPermsId] = useState('');
  const [editPerms, setEditPerms] = useState<string[]>([]);

  const [editUserDialog, setEditUserDialog] = useState({ open: false, id: '', name: '', password: '' });
  const [deleteUserDialog, setDeleteUserDialog] = useState({ open: false, id: '', userName: '' });
  const [detailsUserId, setDetailsUserId] = useState('');
  const { locked: isAddingUser, runLocked: runAddUserLocked } = useActionLock();
  const { locked: isSavingUser, runLocked: runSaveUserLocked } = useActionLock();
  const { locked: isSavingPermissions, runLocked: runSavePermissionsLocked } = useActionLock();
  const { locked: isDeletingUser, runLocked: runDeleteUserLocked } = useActionLock();

  const handleAddUser = runAddUserLocked(async () => {
    if (!newUser.username.trim() || !newUser.name.trim()) {
      toast.error('يرجى إدخال اسم المستخدم والاسم');
      return;
    }
    if (!newUser.password.trim()) {
      toast.error('يرجى إدخال رمز المرور');
      return;
    }
    if (users.some(u => u.username.trim().toLowerCase() === newUser.username.trim().toLowerCase())) {
      toast.error('اسم المستخدم موجود مسبقاً');
      return;
    }
    const role = roles.find(r => r.id === newUser.roleId);
    const perms = newUser.permissions.length > 0 ? newUser.permissions : (role?.permissions || []);
    addUser({
      username: newUser.username.trim(),
      name: newUser.name.trim(),
      roleId: newUser.roleId,
      role: role?.name || 'مشاهدة فقط',
      permissions: perms,
      password: newUser.password.trim(),
      active: true,
    });
    setShowAddDialog(false);
    setNewUser({ username: '', name: '', password: '', roleId: 'role_checker', permissions: [] });
    toast.success('تمت إضافة المستخدم');
  });

  const openEditUserDialog = (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    setEditUserDialog({ open: true, id: userId, name: user.name, password: '' });
  };
  const handleEditUserSave = runSaveUserLocked(async () => {
    if (!editUserDialog.name.trim()) { toast.error('يرجى إدخال الاسم'); return; }
    const updates: { name: string; password?: string } = { name: editUserDialog.name.trim() };
    if (editUserDialog.password.trim()) updates.password = editUserDialog.password.trim();
    updateUser(editUserDialog.id, updates);
    setEditUserDialog({ open: false, id: '', name: '', password: '' });
    toast.success('تم تعديل المستخدم');
  });

  const openDeleteUserDialog = (userId: string) => {
    const user = users.find(u => u.id === userId);
    setDeleteUserDialog({ open: true, id: userId, userName: user?.name || '' });
  };
  const handleDeleteUserConfirm = runDeleteUserLocked(async () => {
    const ok = deleteUser(deleteUserDialog.id);
    if (ok) { toast.success('تم حذف المستخدم'); } else { toast.error('لا يمكن حذف هذا المستخدم'); }
    setDeleteUserDialog({ open: false, id: '', userName: '' });
  });

  const handleEditPermissions = (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    setEditPermsId(userId);
    const isAdminUser = user.username.trim().toLowerCase() === 'admin' || user.roleId === 'role_admin';
    setEditPerms(isAdminUser ? PERMISSION_CATALOG.map(p => p.id) : [...user.permissions]);
  };

  const handleSavePermissions = runSavePermissionsLocked(async () => {
    const editedUser = users.find(u => u.id === editPermsId);
    const isAdminUser = editedUser?.username.trim().toLowerCase() === 'admin' || editedUser?.roleId === 'role_admin';
    updateUserPermissions(editPermsId, isAdminUser ? PERMISSION_CATALOG.map(p => p.id) : editPerms);
    setEditPermsId('');
    setEditPerms([]);
    toast.success(isAdminUser ? 'صلاحيات المدير كاملة دائماً' : 'تم تحديث الصلاحيات');
  });


  const handleRoleChange = (roleId: string) => {
    const role = roles.find(r => r.id === roleId);
    setNewUser(p => ({
      ...p,
      roleId,
      permissions: [...(role?.permissions || [])],
    }));
  };

  const getRoleName = (roleId: string) => roles.find(r => r.id === roleId)?.name || 'غير محدد';
  const generatePasscode = () => {
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower = "abcdefghijkmnopqrstuvwxyz";
    const digits = "23456789";
    const special = "!@#$%&*?";
    const all = upper + lower + digits + special;
    const required = [upper, lower, digits, special].map(
      (chars) => chars[Math.floor(Math.random() * chars.length)],
    );
    while (required.length < 16) {
      required.push(all[Math.floor(Math.random() * all.length)]);
    }
    for (let index = required.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [required[index], required[swapIndex]] = [required[swapIndex], required[index]];
    }
    return required.join("");
  };

  const detailsUser = users.find(u => u.id === detailsUserId) || null;
  const detailsUserRole = detailsUser ? roles.find(r => r.id === detailsUser.roleId) : null;
  const detailsIsAdmin = Boolean(detailsUser && (detailsUser.username.trim().toLowerCase() === 'admin' || detailsUser.roleId === 'role_admin'));
  const detailsPermissions = detailsUser
    ? detailsIsAdmin ? PERMISSION_CATALOG.map(p => p.id) : detailsUser.permissions
    : [];
  const detailsRolePermissions = detailsUserRole
    ? detailsUserRole.id === 'role_admin' ? PERMISSION_CATALOG.map(p => p.id) : detailsUserRole.permissions
    : [];
  const detailsExtraPermissions = selectedPermissions(detailsPermissions.filter(permission => !detailsRolePermissions.includes(permission)));
  const detailsMissingRolePermissions = selectedPermissions(detailsRolePermissions.filter(permission => !detailsPermissions.includes(permission)));


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">المستخدمين</h3>
          <p className="text-sm text-muted-foreground">إدارة حسابات المستخدمين وأدوارهم</p>
        </div>
        <Button onClick={() => {
          setNewUser({ username: '', name: '', password: generatePasscode(), roleId: 'role_checker', permissions: [] });
          setShowAddDialog(true);
        }}>إضافة مستخدم</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {users.map(user => {
          const userRole = roles.find(r => r.id === user.roleId);
          const isAdminUser = user.username.trim().toLowerCase() === 'admin' || user.roleId === 'role_admin';
          const displayedUserPermissions = isAdminUser ? PERMISSION_CATALOG.map(p => p.id) : user.permissions;
          return (
            <Card key={user.id} className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-bold">{user.name}</p>
                    <p className="text-xs text-muted-foreground">@{user.username}</p>
                  </div>
                  <div className="flex gap-1">
                    <Badge variant={user.roleId === 'role_admin' ? 'default' : 'secondary'}>{getRoleName(user.roleId)}</Badge>
                    <Badge variant={user.active ? 'default' : 'destructive'}>
                      {user.active ? 'فعال' : 'معطل'}
                    </Badge>
                  </div>
                </div>

                <div className="mb-3 space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">الصلاحيات الفعلية ({displayedUserPermissions.length})</p>
                    <PermissionCategoryBadges permissions={displayedUserPermissions} limit={4} />
                  </div>
                  <PermissionCompactSummary permissions={displayedUserPermissions} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => setDetailsUserId(user.id)}>
                    تفاصيل الصلاحيات
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => handleEditPermissions(user.id)}>
                    {isAdminUser ? 'صلاحيات كاملة' : 'تعديل الصلاحيات'}
                  </Button>
                  <Button variant="secondary" size="sm" className="text-xs" onClick={() => openEditUserDialog(user.id)}>
                    تعديل
                  </Button>
                  <Button
                    variant={user.active ? 'outline' : 'default'}
                    size="sm"
                    className="text-xs"
                    disabled={user.username.trim().toLowerCase() === 'admin'}
                    onClick={() => {
                      if (user.username.trim().toLowerCase() === 'admin') {
                        toast.info('حساب admin يبقى فعال دائماً');
                        return;
                      }
                      toggleUser(user.id);
                      toast.success(user.active ? 'تم تعطيل المستخدم' : 'تم تفعيل المستخدم');
                    }}
                  >
                    {user.username.trim().toLowerCase() === 'admin' ? 'فعال دائماً' : user.active ? 'تعطيل' : 'تفعيل'}
                  </Button>
                  <Button variant="destructive" size="sm" className="text-xs" disabled={isAdminUser} onClick={() => openDeleteUserDialog(user.id)}>
                    {isAdminUser ? 'محمي' : 'حذف'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* User Permissions Details Dialog */}
      <Dialog open={!!detailsUserId} onOpenChange={(open) => { if (!open) setDetailsUserId(''); }}>
        <DialogContent dir="rtl" className={ACCOUNT_DIALOG_CONTENT_CLASS}>
          <DialogHeader className={ACCOUNT_DIALOG_HEADER_CLASS}>
            <DialogTitle>تفاصيل صلاحيات الحساب - {detailsUser?.name || ''}</DialogTitle>
            <DialogDescription>
              عرض تفصيلي للصلاحيات الفعلية حسب الحساب والدور، حتى تعرف بالضبط شنو يستطيع هذا المستخدم يشوف أو يعدّل.
            </DialogDescription>
          </DialogHeader>
          <div className={ACCOUNT_DIALOG_BODY_CLASS}>
            {detailsUser && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-xl border bg-muted/25 p-3">
                    <p className="text-xs text-muted-foreground">اسم المستخدم</p>
                    <p className="font-semibold">@{detailsUser.username}</p>
                  </div>
                  <div className="rounded-xl border bg-muted/25 p-3">
                    <p className="text-xs text-muted-foreground">الدور</p>
                    <p className="font-semibold">{detailsUserRole?.name || 'غير محدد'}</p>
                  </div>
                  <div className="rounded-xl border bg-muted/25 p-3">
                    <p className="text-xs text-muted-foreground">الحالة</p>
                    <p className="font-semibold">{detailsUser.active ? 'فعال' : 'معطل'}</p>
                  </div>
                </div>

                <div className="rounded-xl border bg-primary/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">الصلاحيات الفعلية</p>
                      <p className="text-xs text-muted-foreground">
                        {detailsIsAdmin
                          ? 'هذا الحساب مدير عام، لذلك يمتلك كل صلاحيات النظام دائماً.'
                          : 'هذه هي الصلاحيات التي تُستخدم فعلياً عند دخول هذا الحساب.'}
                      </p>
                    </div>
                    <Badge variant="default">{detailsPermissions.length} صلاحية</Badge>
                  </div>
                </div>

                {!detailsIsAdmin && (detailsExtraPermissions.length > 0 || detailsMissingRolePermissions.length > 0) && (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {detailsExtraPermissions.length > 0 && (
                      <div className="rounded-xl border bg-muted/20 p-3">
                        <p className="mb-2 text-sm font-semibold">صلاحيات إضافية على الدور</p>
                        <div className="flex flex-wrap gap-1.5">
                          {detailsExtraPermissions.map(permission => (
                            <Badge key={permission.id} variant="outline" className="text-[10px]">{permission.label}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {detailsMissingRolePermissions.length > 0 && (
                      <div className="rounded-xl border bg-muted/20 p-3">
                        <p className="mb-2 text-sm font-semibold">صلاحيات موجودة بالدور لكنها غير مفعّلة للحساب</p>
                        <div className="flex flex-wrap gap-1.5">
                          {detailsMissingRolePermissions.map(permission => (
                            <Badge key={permission.id} variant="outline" className="text-[10px]">{permission.label}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <PermissionDetailsList permissions={detailsPermissions} />
              </div>
            )}
          </div>
          <DialogFooter className={ACCOUNT_DIALOG_FOOTER_CLASS}>
            <Button variant="outline" onClick={() => setDetailsUserId('')}>إغلاق</Button>
            {detailsUser && !detailsIsAdmin && (
              <Button onClick={() => { const id = detailsUser.id; setDetailsUserId(''); handleEditPermissions(id); }}>
                تعديل صلاحيات هذا الحساب
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editUserDialog.open} onOpenChange={o => setEditUserDialog(prev => ({ ...prev, open: o }))}>
        <DialogContent dir="rtl" className={ACCOUNT_DIALOG_CONTENT_CLASS}>
          <DialogHeader className={ACCOUNT_DIALOG_HEADER_CLASS}>
            <DialogTitle>تعديل المستخدم</DialogTitle>
            <DialogDescription>أدخل الاسم الجديد، واترك رمز المرور فارغاً إذا لا تريد تغييره</DialogDescription>
          </DialogHeader>
          <div className={ACCOUNT_DIALOG_BODY_CLASS}>
            <div className="space-y-2">
              <Label htmlFor="user-edit-name">الاسم الكامل</Label>
              <Input id="user-edit-name" name="name" autoComplete="name" value={editUserDialog.name} onChange={e => setEditUserDialog(prev => ({ ...prev, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="user-edit-password">رمز المرور الجديد — اختياري</Label>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditUserDialog(prev => ({ ...prev, password: generatePasscode() }))}>توليد رمز</Button>
              </div>
              <Input id="user-edit-password" name="password" autoComplete="new-password" value={editUserDialog.password} onChange={e => setEditUserDialog(prev => ({ ...prev, password: e.target.value }))} placeholder="اتركه فارغاً للإبقاء على الرمز الحالي" />
            </div>
          </div>
          <DialogFooter className={ACCOUNT_DIALOG_FOOTER_CLASS}>
            <Button variant="outline" onClick={() => setEditUserDialog(prev => ({ ...prev, open: false }))}>إلغاء</Button>
            <Button onClick={handleEditUserSave} disabled={isSavingUser}>{isSavingUser ? 'جاري الحفظ...' : 'حفظ'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User AlertDialog */}
      <AlertDialog open={deleteUserDialog.open} onOpenChange={o => setDeleteUserDialog(prev => ({ ...prev, open: o }))}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف المستخدم &quot;{deleteUserDialog.userName}&quot;؟ لا يمكن حذف المدير أو المستخدم الحالي.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUserConfirm} disabled={isDeletingUser} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isDeletingUser ? 'جاري الحذف...' : 'حذف'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add User Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent dir="rtl" className={ACCOUNT_DIALOG_CONTENT_CLASS}>
          <DialogHeader className={ACCOUNT_DIALOG_HEADER_CLASS}>
            <DialogTitle>إضافة مستخدم جديد</DialogTitle>
            <DialogDescription>أنشئ حساب مستخدم جديد وحدد دوره وصلاحياته</DialogDescription>
          </DialogHeader>
          <div className={ACCOUNT_DIALOG_BODY_CLASS}>
            <div className="space-y-2">
              <Label htmlFor="new-username">اسم المستخدم</Label>
              <Input id="new-username" name="username" autoComplete="username" value={newUser.username} onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))} placeholder="مثال: teacher.admin" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-name">الاسم الكامل</Label>
              <Input id="new-name" name="name" autoComplete="name" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} placeholder="مثال: أحمد محمد" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="new-password">رمز المرور</Label>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setNewUser(p => ({ ...p, password: generatePasscode() }))}>توليد رمز</Button>
              </div>
              <Input id="new-password" name="password" autoComplete="new-password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} placeholder="12 خانة على الأقل: أحرف وأرقام ورمز خاص" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-role">الدور</Label>
              <Select name="roleId" value={newUser.roleId} onValueChange={handleRoleChange}>
                <SelectTrigger id="new-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roles.map(role => (
                    <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="space-y-2">
              <span className="text-sm font-medium leading-none">الصلاحيات</span>
              <PermissionChecklist perms={newUser.permissions} onChange={(permissions) => setNewUser(prev => ({ ...prev, permissions }))} />
            </div>
          </div>
          <DialogFooter className={ACCOUNT_DIALOG_FOOTER_CLASS}>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>إلغاء</Button>
            <Button onClick={handleAddUser} disabled={isAddingUser}>{isAddingUser ? 'جاري الإضافة...' : 'إضافة'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Permissions Dialog */}
      <Dialog open={!!editPermsId} onOpenChange={() => { setEditPermsId(''); setEditPerms([]); }}>
        <DialogContent dir="rtl" className={ACCOUNT_DIALOG_CONTENT_CLASS}>
          <DialogHeader className={ACCOUNT_DIALOG_HEADER_CLASS}>
            <DialogTitle>تحديث الصلاحيات - {users.find(u => u.id === editPermsId)?.name}</DialogTitle>
            <DialogDescription>فعّل الصلاحيات التي تريد السماح بها فقط، ثم اضغط حفظ لتطبيقها.</DialogDescription>
          </DialogHeader>
          <div className={ACCOUNT_DIALOG_BODY_CLASS}>
            <PermissionChecklist
              perms={editPerms}
              onChange={setEditPerms}
              readOnly={users.find(u => u.id === editPermsId)?.username.trim().toLowerCase() === 'admin' || users.find(u => u.id === editPermsId)?.roleId === 'role_admin'}
            />
          </div>
          <DialogFooter className={ACCOUNT_DIALOG_FOOTER_CLASS}>
            <Button variant="outline" onClick={() => { setEditPermsId(''); setEditPerms([]); }}>إلغاء</Button>
            <Button onClick={handleSavePermissions} disabled={isSavingPermissions}>{isSavingPermissions ? 'جاري الحفظ...' : (users.find(u => u.id === editPermsId)?.username.trim().toLowerCase() === 'admin' || users.find(u => u.id === editPermsId)?.roleId === 'role_admin') ? 'تأكيد الصلاحيات الكاملة' : 'حفظ'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


// ─── Security Tab Component ──────────────────────────────────────────────────

type SecurityCheck = {
  id: string;
  title: string;
  ok: boolean;
  severity: 'ok' | 'warn' | 'danger' | string;
  message: string;
};

type SecurityRiskUser = {
  id: string;
  username: string;
  name: string;
  role: string;
  roleId: string | null;
  active: boolean;
  isAdmin: boolean;
  sensitivePermissions: string[];
};

type SecurityRiskRole = {
  id: string;
  name: string;
  userCount: number;
  sensitivePermissions: string[];
};

type SecurityLogItem = {
  id: string;
  module: string;
  action: string;
  details: string;
  userName: string;
  time: string;
};

type SecurityOverview = {
  generatedAt: string;
  checks: SecurityCheck[];
  summary: {
    users: number;
    activeUsers: number;
    disabledUsers: number;
    roles: number;
    riskyUsers: number;
    riskyRoles: number;
  };
  riskyUsers: SecurityRiskUser[];
  riskyRoles: SecurityRiskRole[];
  recentLogs: SecurityLogItem[];
};

function securityBadgeVariant(severity: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (severity === 'danger') return 'destructive';
  if (severity === 'warn') return 'secondary';
  if (severity === 'ok') return 'default';
  return 'outline';
}

function formatSecurityTime(value: string) {
  if (!value) return 'غير محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', { hour12: false });
}

function SecurityTab() {
  const syncKey = useTeacherProSyncKey(['accounts', 'logs']);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);
  const beginSecurityRequest = useLatestRequest();
  const overviewLoadedRef = useRef(false);
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadOverview = useCallback(async (options: { background?: boolean } = {}) => {
    const request = beginSecurityRequest();
    const background = Boolean(options.background || overviewLoadedRef.current);
    if (background) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/accounts/security', {
        credentials: 'same-origin',
        signal: request.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || 'تعذر تحميل لوحة الأمان');
      }
      const data = await res.json() as SecurityOverview;
      if (!request.isLatest()) return;
      setOverview(data);
      overviewLoadedRef.current = true;
    } catch (err) {
      if (!request.isLatest()) return;
      setError(err instanceof Error ? err.message : 'تعذر تحميل لوحة الأمان');
      if (!background) setOverview(null);
    } finally {
      if (!request.isLatest()) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [beginSecurityRequest]);

  useEffect(() => {
    void loadOverview({ background: isBackgroundSync() });
  }, [isBackgroundSync, loadOverview, syncKey]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">جاري تحميل لوحة أمان الحسابات...</CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="space-y-3 p-6">
          <p className="font-semibold text-destructive">{error}</p>
          <p className="text-sm text-muted-foreground">تحتاج صلاحية إدارة الحسابات لفتح هذه اللوحة.</p>
          <Button variant="outline" onClick={() => void loadOverview()}>إعادة المحاولة</Button>
        </CardContent>
      </Card>
    );
  }

  if (!overview) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-bold">أمان الحسابات</h3>
          <p className="text-sm text-muted-foreground">فحص سريع للأسرار، الصلاحيات الحساسة، وآخر تغييرات الحسابات.</p>
        </div>
        <Button variant="outline" disabled={refreshing} onClick={() => void loadOverview({ background: true })}>{refreshing ? 'جارٍ التحديث...' : 'تحديث الفحص'}</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">المستخدمين</p><p className="text-2xl font-black">{overview.summary.users}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">فعالين</p><p className="text-2xl font-black">{overview.summary.activeUsers}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">معطلين</p><p className="text-2xl font-black">{overview.summary.disabledUsers}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">الأدوار</p><p className="text-2xl font-black">{overview.summary.roles}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">مستخدمين حساسين</p><p className="text-2xl font-black">{overview.summary.riskyUsers}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">أدوار حساسة</p><p className="text-2xl font-black">{overview.summary.riskyRoles}</p></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {overview.checks.map((check) => (
          <Card key={check.id} className={check.severity === 'danger' ? 'border-destructive/40' : ''}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold">{check.title}</p>
                <Badge variant={securityBadgeVariant(check.severity)}>{check.ok ? 'سليم' : check.severity === 'danger' ? 'خطر' : 'تنبيه'}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{check.message}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">المستخدمين أصحاب الصلاحيات الحساسة</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {overview.riskyUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد صلاحيات حساسة خارج النطاق المتوقع.</p>
            ) : overview.riskyUsers.map((user) => (
              <div key={user.id} className="rounded-xl border bg-muted/20 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{user.name}</p>
                    <p className="text-xs text-muted-foreground">@{user.username} — {user.role}</p>
                  </div>
                  <Badge variant={user.active ? 'default' : 'secondary'}>{user.active ? 'فعال' : 'معطل'}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {user.sensitivePermissions.map((permission) => (
                    <Badge key={permission} variant={user.isAdmin ? 'default' : 'outline'} className="text-[10px]">{permission}</Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">الأدوار الحساسة</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {overview.riskyRoles.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد أدوار تحتوي صلاحيات حساسة.</p>
            ) : overview.riskyRoles.map((role) => (
              <div key={role.id} className="rounded-xl border bg-muted/20 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{role.name}</p>
                    <p className="text-xs text-muted-foreground">{role.userCount} مستخدم مرتبط</p>
                  </div>
                  <Badge variant={role.id === 'role_admin' ? 'default' : 'secondary'}>{role.id}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {role.sensitivePermissions.map((permission) => (
                    <Badge key={permission} variant="outline" className="text-[10px]">{permission}</Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">آخر تدقيق للحسابات والصلاحيات</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="p-2 text-right">الوقت</th>
                  <th className="p-2 text-right">المستخدم</th>
                  <th className="p-2 text-right">القسم</th>
                  <th className="p-2 text-right">الإجراء</th>
                  <th className="p-2 text-right">التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {overview.recentLogs.length === 0 ? (
                  <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">لا توجد عمليات حديثة.</td></tr>
                ) : overview.recentLogs.slice(0, 30).map((log) => (
                  <tr key={log.id} className="border-b last:border-0">
                    <td className="p-2 text-xs text-muted-foreground">{formatSecurityTime(log.time)}</td>
                    <td className="p-2">{log.userName}</td>
                    <td className="p-2">{log.module}</td>
                    <td className="p-2 font-medium">{log.action}</td>
                    <td className="max-w-md truncate p-2 text-xs text-muted-foreground" title={log.details}>{log.details || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">آخر فحص: {formatSecurityTime(overview.generatedAt)}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Accounts View ──────────────────────────────────────────────────────

export function AccountsView() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">إدارة الحسابات</h2>
        <p className="text-sm text-muted-foreground">إدارة المستخدمين والأدوار والصلاحيات</p>
      </div>

      <Tabs defaultValue="users" dir="rtl">
        <TabsList className="w-full max-w-5xl">
          <TabsTrigger value="users" className="flex-1">المستخدمين</TabsTrigger>
          <TabsTrigger value="roles" className="flex-1">الأدوار والصلاحيات</TabsTrigger>
          <TabsTrigger value="security" className="flex-1">الأمان</TabsTrigger>
          <TabsTrigger value="architecture" className="flex-1">هيكلة الصلاحيات</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-4">
          <UsersTab />
        </TabsContent>
        <TabsContent value="roles" className="mt-4">
          <RolesTab />
        </TabsContent>
        <TabsContent value="security" className="mt-4">
          <SecurityTab />
        </TabsContent>
        <TabsContent value="architecture" className="mt-4">
          <PermissionsArchitectureTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
