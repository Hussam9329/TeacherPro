'use client';

import React, { useState, useMemo } from 'react';
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
import { toast } from 'sonner';
import { DemoCopiesTab } from './demo-copies';
import { useActionLock } from '@/hooks/use-action-lock';

// ─── Permission categories for grouping ──────────────────────────────────────

const PERMISSION_CATEGORIES = [
  'النظام', 'الدورات', 'المجموعات الإلكترونية', 'المواقع', 'الفصول',
  'الطلاب', 'الامتحانات', 'الدرجات', 'الفرص', 'التصحيح',
  'واتساب', 'الحسابات', 'السجلات',
];

function getPermissionsByCategory(permissions: PermissionEntry[]) {
  const map = new Map<string, PermissionEntry[]>();
  for (const p of permissions) {
    if (!map.has(p.category)) map.set(p.category, []);
    map.get(p.category)!.push(p);
  }
  return map;
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
    <ScrollArea className="max-h-96">
      <div className="space-y-4">
        {PERMISSION_CATEGORIES.map(cat => {
          const catPerms = catalogByCategory.get(cat);
          if (!catPerms || catPerms.length === 0) return null;
          const catIds = catPerms.map(p => p.id);
          const allChecked = catIds.every(p => perms.includes(p));
          const someChecked = catIds.some(p => perms.includes(p));

          return (
            <div key={cat} className="space-y-2">
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
              <div className="grid grid-cols-2 gap-1.5 pr-6">
                {catPerms.map(perm => (
                  <div key={perm.id} className="flex items-center gap-1.5">
                    <Checkbox
                      id={`perm-${perm.id}`}
                      name={`perm-${perm.id}`}
                      checked={perms.includes(perm.id)}
                      onCheckedChange={() => togglePermission(perm.id)}
                      disabled={readOnly}
                      className="h-3.5 w-3.5"
                    />
                    <Label htmlFor={`perm-${perm.id}`} className="text-xs">{perm.label}</Label>
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
    setEditRolePerms([...role.permissions]);
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
          return (
            <Card key={role.id} className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-bold">{role.name}</p>
                    <p className="text-xs text-muted-foreground">{role.permissions.length} صلاحية</p>
                  </div>
                  <div className="flex gap-1">
                    {role.isDefault && <Badge variant="secondary" className="text-[10px]">افتراضي</Badge>}
                    <Badge variant="outline" className="text-[10px]">{userCount} مستخدم</Badge>
                  </div>
                </div>

                <div className="mb-3">
                  <div className="flex flex-wrap gap-1">
                    {PERMISSION_CATEGORIES.filter(cat => {
                      const catPerms = PERMISSION_CATALOG.filter(p => p.category === cat).map(p => p.id);
                      return catPerms.some(p => role.permissions.includes(p));
                    }).slice(0, 5).map(cat => (
                      <Badge key={cat} variant="outline" className="text-[10px]">{cat}</Badge>
                    ))}
                    {PERMISSION_CATEGORIES.filter(cat => {
                      const catPerms = PERMISSION_CATALOG.filter(p => p.category === cat).map(p => p.id);
                      return catPerms.some(p => role.permissions.includes(p));
                    }).length > 5 && (
                      <Badge variant="outline" className="text-[10px]">
                        +{PERMISSION_CATEGORIES.filter(cat => {
                          const catPerms = PERMISSION_CATALOG.filter(p => p.category === cat).map(p => p.id);
                          return catPerms.some(p => role.permissions.includes(p));
                        }).length - 5}
                      </Badge>
                    )}
                  </div>
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
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>إضافة دور جديد</DialogTitle>
            <DialogDescription>أنشئ دوراً جديداً وحدد الصلاحيات المطلوبة</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role-name">اسم الدور</Label>
              <Input id="role-name" name="roleName" autoComplete="off" value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="اسم الدور بالعربية" />
            </div>
            <div className="space-y-2">
              <span className="text-sm font-medium leading-none">الصلاحيات</span>
              <PermissionChecklist perms={newRolePerms} onChange={setNewRolePerms} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddRoleDialog(false)}>إلغاء</Button>
            <Button onClick={handleAddRole} disabled={isAddingRole}>{isAddingRole ? 'جاري الإضافة...' : 'إضافة'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Role Permissions Dialog */}
      <Dialog open={!!editRoleId} onOpenChange={() => { setEditRoleId(null); setEditRolePerms([]); }}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>تعديل صلاحيات الدور - {roles.find(r => r.id === editRoleId)?.name}</DialogTitle>
            <DialogDescription>
              {roles.find(r => r.id === editRoleId)?.isDefault
                ? 'هذا دور افتراضي. تعديل الصلاحيات سيؤثر على جميع المستخدمين المرتبطين.'
                : 'حدد الصلاحيات المطلوبة لهذا الدور'}
            </DialogDescription>
          </DialogHeader>
          <PermissionChecklist perms={editRolePerms} onChange={setEditRolePerms} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditRoleId(null); setEditRolePerms([]); }}>إلغاء</Button>
            <Button onClick={handleSaveRole} disabled={isSavingRole}>{isSavingRole ? 'جاري الحفظ...' : 'حفظ'}</Button>
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
    username: '', name: '', password: '123456', roleId: 'role_checker', permissions: [] as string[],
  });

  const [editPermsId, setEditPermsId] = useState('');
  const [editPerms, setEditPerms] = useState<string[]>([]);

  const [editUserDialog, setEditUserDialog] = useState({ open: false, id: '', name: '', password: '' });
  const [deleteUserDialog, setDeleteUserDialog] = useState({ open: false, id: '', userName: '' });
  const { locked: isAddingUser, runLocked: runAddUserLocked } = useActionLock();
  const { locked: isSavingUser, runLocked: runSaveUserLocked } = useActionLock();
  const { locked: isSavingPermissions, runLocked: runSavePermissionsLocked } = useActionLock();
  const { locked: isDeletingUser, runLocked: runDeleteUserLocked } = useActionLock();

  const handleAddUser = runAddUserLocked(async () => {
    if (!newUser.username.trim() || !newUser.name.trim()) {
      toast.error('يرجى إدخال اسم المستخدم والاسم');
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
      password: newUser.password,
      active: true,
    });
    setShowAddDialog(false);
    setNewUser({ username: '', name: '', password: '123456', roleId: 'role_checker', permissions: [] });
    toast.success('تمت إضافة المستخدم');
  });

  const openEditUserDialog = (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    setEditUserDialog({ open: true, id: userId, name: user.name, password: user.password || '123456' });
  };
  const handleEditUserSave = runSaveUserLocked(async () => {
    if (!editUserDialog.name.trim()) { toast.error('يرجى إدخال الاسم'); return; }
    updateUser(editUserDialog.id, { name: editUserDialog.name.trim(), password: editUserDialog.password });
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
    setEditPerms([...user.permissions]);
  };

  const handleSavePermissions = runSavePermissionsLocked(async () => {
    updateUserPermissions(editPermsId, editPerms);
    setEditPermsId('');
    setEditPerms([]);
    toast.success('تم تحديث الصلاحيات');
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


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">المستخدمين</h3>
          <p className="text-sm text-muted-foreground">إدارة حسابات المستخدمين وأدوارهم</p>
        </div>
        <Button onClick={() => setShowAddDialog(true)}>إضافة مستخدم</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {users.map(user => {
          const userRole = roles.find(r => r.id === user.roleId);
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

                <div className="mb-3">
                  <p className="text-xs text-muted-foreground mb-1">الصلاحيات ({user.permissions.length})</p>
                  <div className="flex flex-wrap gap-1">
                    {PERMISSION_CATEGORIES.filter(cat => {
                      const catPerms = PERMISSION_CATALOG.filter(p => p.category === cat).map(p => p.id);
                      return catPerms.some(p => user.permissions.includes(p));
                    }).slice(0, 4).map(cat => (
                      <Badge key={cat} variant="outline" className="text-[10px]">{cat}</Badge>
                    ))}
                    {PERMISSION_CATEGORIES.filter(cat => {
                      const catPerms = PERMISSION_CATALOG.filter(p => p.category === cat).map(p => p.id);
                      return catPerms.some(p => user.permissions.includes(p));
                    }).length > 4 && (
                      <Badge variant="outline" className="text-[10px]">
                        +{PERMISSION_CATEGORIES.filter(cat => {
                          const catPerms = PERMISSION_CATALOG.filter(p => p.category === cat).map(p => p.id);
                          return catPerms.some(p => user.permissions.includes(p));
                        }).length - 4}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => handleEditPermissions(user.id)}>
                    الصلاحيات
                  </Button>
                  <Button variant="secondary" size="sm" className="text-xs" onClick={() => openEditUserDialog(user.id)}>
                    تعديل
                  </Button>
                  <Button
                    variant={user.active ? 'outline' : 'default'}
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      toggleUser(user.id);
                      toast.success(user.active ? 'تم تعطيل المستخدم' : 'تم تفعيل المستخدم');
                    }}
                  >
                    {user.active ? 'تعطيل' : 'تفعيل'}
                  </Button>
                  <Button variant="destructive" size="sm" className="text-xs" onClick={() => openDeleteUserDialog(user.id)}>
                    حذف
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Edit User Dialog */}
      <Dialog open={editUserDialog.open} onOpenChange={o => setEditUserDialog(prev => ({ ...prev, open: o }))}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل المستخدم</DialogTitle>
            <DialogDescription>أدخل البيانات الجديدة للمستخدم</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="user-edit-name">الاسم الكامل</Label>
              <Input id="user-edit-name" name="name" autoComplete="name" value={editUserDialog.name} onChange={e => setEditUserDialog(prev => ({ ...prev, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-edit-password">كلمة المرور الجديدة</Label>
              <Input id="user-edit-password" name="password" type="password" autoComplete="new-password" value={editUserDialog.password} onChange={e => setEditUserDialog(prev => ({ ...prev, password: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
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
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>إضافة مستخدم جديد</DialogTitle>
            <DialogDescription>أنشئ حساب مستخدم جديد وحدد دوره وصلاحياته</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-username">اسم المستخدم</Label>
              <Input id="new-username" name="username" autoComplete="username" value={newUser.username} onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))} placeholder="مثال: teacher.admin" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-name">الاسم الكامل</Label>
              <Input id="new-name" name="name" autoComplete="name" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} placeholder="مثال: أحمد محمد" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">كلمة المرور</Label>
              <Input id="new-password" name="password" autoComplete="new-password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} placeholder="كلمة مرور آمنة" type="password" />
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>إلغاء</Button>
            <Button onClick={handleAddUser} disabled={isAddingUser}>{isAddingUser ? 'جاري الإضافة...' : 'إضافة'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Permissions Dialog */}
      <Dialog open={!!editPermsId} onOpenChange={() => { setEditPermsId(''); setEditPerms([]); }}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>تحديث الصلاحيات - {users.find(u => u.id === editPermsId)?.name}</DialogTitle>
            <DialogDescription>فعّل الصلاحيات التي تريد السماح بها فقط، ثم اضغط حفظ لتطبيقها.</DialogDescription>
          </DialogHeader>
          <PermissionChecklist perms={editPerms} onChange={setEditPerms} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditPermsId(''); setEditPerms([]); }}>إلغاء</Button>
            <Button onClick={handleSavePermissions} disabled={isSavingPermissions}>{isSavingPermissions ? 'جاري الحفظ...' : 'حفظ'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
        <TabsList className="w-full max-w-lg">
          <TabsTrigger value="users" className="flex-1">المستخدمين</TabsTrigger>
          <TabsTrigger value="roles" className="flex-1">الأدوار والصلاحيات</TabsTrigger>
          <TabsTrigger value="demos" className="flex-1">نسخ الديمو</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-4">
          <UsersTab />
        </TabsContent>
        <TabsContent value="roles" className="mt-4">
          <RolesTab />
        </TabsContent>
        <TabsContent value="demos" className="mt-4">
          <DemoCopiesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
