'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTeacherStore, PERMISSION_CATALOG, type PermissionEntry } from '@/lib/teacher-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/lib/user-toast';
import { useActionLock } from '@/hooks/use-action-lock';
import { useLatestRequest } from '@/hooks/use-latest-request';
import {
  useTeacherProBackgroundSyncDetector,
  useTeacherProSyncKey,
} from '@/hooks/use-teacherpro-sync';
import { baghdadTodayKey, formatBaghdadDateTime } from '@/lib/baghdad-time';
import { ChevronDown, Download, FileUp, ScrollText, TriangleAlert, KeyRound, Lock, RefreshCw, ShieldAlert, ShieldCheck, ShieldPlus, Trash2, UserCheck, UserPen, UserPlus, UserRoundSearch, UserX } from 'lucide-react';
import { RowActionsMenu, type RowAction } from './row-actions-menu';
import { FormDialogHero } from './form-dialog';
import { ListToolbar, type ListChip } from './list-toolbar';
import { EmptyState, LoadingState } from './ui-kit';
import { validatePasswordPolicy } from '@/lib/password-policy';
import { searchAny } from '@/lib/validation';
import { formatAuditLogDisplay } from '@/lib/audit-log-display';
import { humanizeTeacherProText } from '@/lib/teacherpro-language';
import './tp-list.css';

// ─── Permission categories for grouping ──────────────────────────────────────

const PREFERRED_PERMISSION_CATEGORIES = [
  'النظام',
  'الدورات',
  'الفصول',
  'الطلاب',
  'الامتحانات',
  'الدرجات',
  'الفرص',
  'المتابعة',
  'المتابعة / المكالمات',
  'المتابعة / الإجازات',
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

const PERMISSION_IDS = new Set(PERMISSION_CATALOG.map(permission => permission.id));
const PERMISSION_LABELS = new Map(PERMISSION_CATALOG.map(permission => [permission.id, permission.label]));

/** A permission by its Arabic name; the technical id only when it has none. */
function permissionLabel(id: string): string {
  return PERMISSION_LABELS.get(id) || id;
}

/** A sign-in code the server accepts: 10 characters, letters and digits. */
function generatePasscode(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set: string) => {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return set[values[0] % set.length];
  };
  const chars = [pick(letters), pick(digits)];
  while (chars.length < 10) chars.push(pick(letters + digits));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    const j = values[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** The same password rule the server applies, said before sending. */
function passwordProblem(password: string): string {
  const check = validatePasswordPolicy(password);
  return check.ok ? '' : check.reason;
}

// The account windows: the system's dark header, a scrolling form, one footer.
const ACCOUNT_DIALOG_CONTENT_CLASS = 'tp-form-dialog max-w-3xl';
const ACCOUNT_DIALOG_BODY_CLASS = 'tp-form-dialog__body';

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
  lockedPerms = [],
}: {
  perms: string[];
  onChange: (permissions: string[]) => void;
  readOnly?: boolean;
  /** Given by the account's role: shown ticked and locked, «من الدور». */
  lockedPerms?: string[];
}) {
  const catalogByCategory = useMemo(() => getPermissionsByCategory(PERMISSION_CATALOG), []);
  const locked = useMemo(() => new Set(lockedPerms), [lockedPerms]);
  const isOn = (permId: string) => locked.has(permId) || perms.includes(permId);
  const [openCategories, setOpenCategories] = useState<Set<string>>(() => new Set());

  const togglePermission = (permId: string) => {
    if (readOnly || locked.has(permId)) return;
    onChange(perms.includes(permId) ? perms.filter(p => p !== permId) : [...perms, permId]);
  };

  const toggleCategory = (category: string) => {
    if (readOnly) return;
    const catPerms = PERMISSION_CATALOG.filter(p => p.category === category && !locked.has(p.id)).map(p => p.id);
    if (!catPerms.length) return;
    const allChecked = catPerms.every(p => perms.includes(p));
    onChange(allChecked ? perms.filter(p => !catPerms.includes(p)) : [...new Set([...perms, ...catPerms])]);
  };

  const toggleOpen = (category: string) => setOpenCategories(current => {
    const next = new Set(current);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    return next;
  });

  // Each section is one line: tick it for all of it, open it for the details.
  return (
    <div className="tp-perm-list">
      {PERMISSION_CATEGORIES.map(cat => {
        const catPerms = catalogByCategory.get(cat);
        if (!catPerms || catPerms.length === 0) return null;
        const catIds = catPerms.map(p => p.id);
        const onCount = catIds.filter(p => isOn(p)).length;
        const allChecked = onCount === catIds.length;
        const open = openCategories.has(cat);
        const groupId = `perm-group-${catIds[0]}`;

        return (
          <div key={cat} className="tp-perm-group" data-open={open || undefined}>
            <div className="tp-perm-group__head">
              <Checkbox
                id={`perm-cat-${cat}`}
                name={`perm-cat-${cat}`}
                aria-label={`كل صلاحيات ${cat}`}
                checked={allChecked ? true : onCount > 0 ? 'indeterminate' : false}
                onCheckedChange={() => toggleCategory(cat)}
                disabled={readOnly}
              />
              <button
                type="button"
                className="tp-perm-group__toggle"
                aria-expanded={open}
                aria-controls={groupId}
                onClick={() => toggleOpen(cat)}
              >
                <span className="tp-perm-group__name">{cat}</span>
                <span className="tp-perm-group__count" data-state={allChecked ? 'all' : onCount > 0 ? 'some' : 'none'}>
                  {onCount} من {catIds.length}
                </span>
                <ChevronDown aria-hidden="true" className="tp-perm-group__chevron" />
              </button>
            </div>
            {open ? (
              <ul id={groupId} className="tp-perm-group__items">
                {catPerms.map(perm => (
                  <li key={perm.id}>
                    <label htmlFor={`perm-${perm.id}`} className="tp-perm-item" data-disabled={readOnly || locked.has(perm.id) || undefined}>
                      <Checkbox
                        id={`perm-${perm.id}`}
                        name={`perm-${perm.id}`}
                        checked={isOn(perm.id)}
                        onCheckedChange={() => togglePermission(perm.id)}
                        disabled={readOnly || locked.has(perm.id)}
                      />
                      <span className="tp-perm-item__text">
                        <span className="tp-perm-item__name">
                          {perm.label}
                          <span className="tp-perm-item__level">{PERMISSION_LEVEL_LABELS[perm.level]}</span>
                          {locked.has(perm.id) ? <span className="tp-perm-item__level">من الدور</span> : null}
                        </span>
                        <span className="tp-perm-item__hint">{perm.description}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
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
  const [editRoleName, setEditRoleName] = useState('');

  const [deleteRoleDialog, setDeleteRoleDialog] = useState({ open: false, id: '', name: '', users: 0 });
  const { locked: isAddingRole, runLocked: runAddRoleLocked } = useActionLock();
  const { locked: isSavingRole, runLocked: runSaveRoleLocked } = useActionLock();
  const { locked: isDeletingRole, runLocked: runDeleteRoleLocked } = useActionLock();


  const handleAddRole = runAddRoleLocked(async () => {
    if (!newRoleName.trim()) {
      toast.error('يرجى إدخال اسم الدور');
      return;
    }
    const result = await addRole({ name: newRoleName.trim(), permissions: newRolePerms });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setShowAddRoleDialog(false);
    setNewRoleName('');
    setNewRolePerms([]);
    toast.success('تمت إضافة الدور');
  });

  const handleEditRole = (roleId: string) => {
    const role = roles.find(r => r.id === roleId);
    if (!role) return;
    setEditRoleId(roleId);
    setEditRoleName(role.name);
    setEditRolePerms(role.id === 'role_admin' ? PERMISSION_CATALOG.map(p => p.id) : [...role.permissions]);
  };

  // The server applies a role change to its users itself (a permission
  // taken off the role is taken off them too); nothing is rewritten here.
  const handleSaveRole = runSaveRoleLocked(async () => {
    if (!editRoleId) return;
    const role = roles.find(r => r.id === editRoleId);
    if (!editRoleName.trim()) {
      toast.error('يرجى إدخال اسم الدور');
      return;
    }
    const result = await updateRole(editRoleId, {
      permissions: editRolePerms,
      ...(role && editRoleName.trim() !== role.name ? { name: editRoleName.trim() } : {}),
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setEditRoleId(null);
    setEditRolePerms([]);
    const roleUsers = users.filter(u => u.roleId === editRoleId).length;
    toast.success(
      roleUsers
        ? `تم تحديث الدور، وينطبق على ${roleUsers} حساب`
        : 'تم تحديث الدور',
    );
  });

  const handleDeleteRole = runDeleteRoleLocked(async () => {
    const result = await deleteRole(deleteRoleDialog.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('تم حذف الدور');
    setDeleteRoleDialog({ open: false, id: '', name: '', users: 0 });
  });


  return (
    <div className="tp-list">
      <ListToolbar
        label="الأدوار"
        actions={
          <Button onClick={() => setShowAddRoleDialog(true)}>
            <ShieldPlus aria-hidden="true" />
            إضافة دور
          </Button>
        }
        summary={<><b>{roles.length}</b> دور</>}
      />

      <ul className="tp-rcards" data-columns="2" aria-label="الأدوار">
        {roles.map(role => {
          const userCount = users.filter(u => u.roleId === role.id).length;
          const displayedRolePermissions = role.id === 'role_admin' ? PERMISSION_CATALOG.map(p => p.id) : role.permissions;
          const permissionCount = displayedRolePermissions.filter(id => PERMISSION_IDS.has(id)).length;
          const permissionShare = PERMISSION_CATALOG.length ? permissionCount / PERMISSION_CATALOG.length : 0;
          const categories = selectedPermissionCategories(displayedRolePermissions);
          return (
            <li key={role.id} className="tp-rcard">
              <div className="tp-rcard__head">
                <h3 className="tp-rcard__name">{role.name}</h3>
                <span className="tp-rcard__sep" aria-hidden="true" />
                <span className="tp-rcard__sub">{userCount ? `${userCount} مستخدم` : 'بدون مستخدمين'}</span>
                {role.isDefault ? (
                  <span className="tp-rcard__head-end">
                    <span className="tp-rcard__pill">افتراضي</span>
                  </span>
                ) : null}
              </div>

              <div className="tp-rcard__panel">
                <span className="tp-rcard__eyebrow">الصلاحيات</span>
                <span className="tp-account-card__bar" aria-hidden="true">
                  <span style={{ inlineSize: `${Math.round(permissionShare * 100)}%` }} />
                </span>
                <span className="tp-rcard__line">
                  <b>{permissionCount}</b> من <b>{PERMISSION_CATALOG.length}</b> صلاحية
                  {role.id === 'role_admin'
                    ? ' · كل الصلاحيات دائماً'
                    : categories.length
                      ? ` · ${categories.slice(0, 4).join('، ')}${categories.length === 5 ? ' وقسم ثاني' : categories.length > 5 ? ` و${categories.length - 4} أقسام ثانية` : ''}`
                      : ''}
                </span>
              </div>

              <div className="tp-rcard__foot">
                <span className="tp-rcard__foot-end">
                  <Button variant="outline" size="sm" onClick={() => handleEditRole(role.id)}>
                    <ShieldCheck aria-hidden="true" />
                    تعديل
                  </Button>
                  {!role.isDefault ? (
                    <RowActionsMenu
                      label={`إجراءات ${role.name}`}
                      actions={[{
                        key: 'delete',
                        label: 'حذف الدور…',
                        icon: <Trash2 aria-hidden="true" />,
                        danger: true,
                        onSelect: () => setDeleteRoleDialog({ open: true, id: role.id, name: role.name, users: userCount }),
                      }]}
                    />
                  ) : null}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Add Role Dialog */}
      <Dialog open={showAddRoleDialog} onOpenChange={setShowAddRoleDialog}>
        <DialogContent dir="rtl" className={ACCOUNT_DIALOG_CONTENT_CLASS}>
          <FormDialogHero icon={ShieldPlus} title="إضافة دور جديد" />
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddRoleDialog(false)}>إلغاء</Button>
            <Button onClick={handleAddRole} disabled={isAddingRole}>{isAddingRole ? 'جاري الإضافة...' : 'إضافة'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Role Permissions Dialog */}
      <Dialog open={!!editRoleId} onOpenChange={() => { setEditRoleId(null); setEditRolePerms([]); }}>
        <DialogContent dir="rtl" className={ACCOUNT_DIALOG_CONTENT_CLASS}>
          <FormDialogHero
            icon={ShieldCheck}
            title={<>تعديل صلاحيات الدور - {roles.find(r => r.id === editRoleId)?.name}</>}
            description={roles.find(r => r.id === editRoleId)?.isDefault
              ? 'دور افتراضي: التعديل ينطبق على كل الحسابات المرتبطة بيه.'
              : 'التعديل ينطبق على كل الحسابات المرتبطة بهذا الدور.'}
          />
          <div className={ACCOUNT_DIALOG_BODY_CLASS}>
            {editRoleId !== 'role_admin' ? (
              <div className="space-y-2">
                <Label htmlFor="role-edit-name">اسم الدور</Label>
                <Input id="role-edit-name" autoComplete="off" value={editRoleName} onChange={e => setEditRoleName(e.target.value)} />
              </div>
            ) : null}
            <PermissionChecklist perms={editRolePerms} onChange={setEditRolePerms} readOnly={editRoleId === 'role_admin'} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditRoleId(null); setEditRolePerms([]); }}>إلغاء</Button>
            <Button onClick={handleSaveRole} disabled={isSavingRole || editRoleId === 'role_admin'}>{isSavingRole ? 'جاري الحفظ...' : editRoleId === 'role_admin' ? 'صلاحيات المدير كاملة دائماً' : 'حفظ'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Role AlertDialog */}
      <AlertDialog open={deleteRoleDialog.open} onOpenChange={o => setDeleteRoleDialog(prev => ({ ...prev, open: o }))}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الدور «{deleteRoleDialog.name}»؟</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRoleDialog.users > 0
                ? `مربوط بيه ${deleteRoleDialog.users} مستخدم. انقلهم لدور ثاني أولاً (من «تعديل» بكل حساب)؛ الحذف ما يصير وهم مربوطين.`
                : 'ما مربوط بيه أي مستخدم. ينحذف الدور نهائياً.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRole} disabled={isDeletingRole || deleteRoleDialog.users > 0} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isDeletingRole ? 'جاري الحذف...' : 'حذف'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Users Tab Component ─────────────────────────────────────────────────────

type UserChip = 'all' | 'active' | 'disabled' | 'protected';

const USER_CHIPS: ListChip[] = [
  { key: 'all', label: 'الكل' },
  { key: 'active', label: 'فعّال', tone: 'success' },
  { key: 'disabled', label: 'معطّل', tone: 'danger' },
  { key: 'protected', label: 'محمي', tone: 'muted', hint: 'حسابات المدير: ما تنحذف ولا تنقص صلاحياتها' },
];

function UsersTab() {
  const { users, roles, addUser, updateUser, toggleUser, updateUserPermissions, deleteUser, currentUserId } = useTeacherStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  // A new account starts on the least powerful role the database has.
  const defaultNewUserRoleId =
    roles.find(r => r.id === 'role_checker')?.id ||
    roles.find(r => r.id === 'role_viewer')?.id ||
    roles.find(r => r.id !== 'role_admin')?.id ||
    '';
  const [newUser, setNewUser] = useState({
    username: '', name: '', password: '', roleId: defaultNewUserRoleId, permissions: [] as string[],
  });

  const [editPermsId, setEditPermsId] = useState('');
  const [editPerms, setEditPerms] = useState<string[]>([]);

  const [editUserDialog, setEditUserDialog] = useState({ open: false, id: '', name: '', password: '', roleId: '' });
  const [deleteUserDialog, setDeleteUserDialog] = useState({ open: false, id: '', userName: '' });
  const [detailsUserId, setDetailsUserId] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [userChip, setUserChip] = useState<UserChip>('all');
  const { locked: isAddingUser, runLocked: runAddUserLocked } = useActionLock();
  const { locked: isSavingUser, runLocked: runSaveUserLocked } = useActionLock();
  const { locked: isSavingPermissions, runLocked: runSavePermissionsLocked } = useActionLock();
  const { locked: isDeletingUser, runLocked: runDeleteUserLocked } = useActionLock();

  const rolePermissionsOf = (roleId: string) => roles.find(r => r.id === roleId)?.permissions || [];

  const handleAddUser = runAddUserLocked(async () => {
    const username = newUser.username.trim();
    const name = newUser.name.trim();
    if (!username || !name) {
      toast.error('يرجى إدخال اسم المستخدم والاسم');
      return;
    }
    const passwordError = passwordProblem(newUser.password.trim());
    if (passwordError) {
      toast.error(passwordError);
      return;
    }
    if (users.some(u => u.username.trim().toLowerCase() === username.toLowerCase())) {
      toast.error('اسم المستخدم موجود مسبقاً');
      return;
    }
    // The account's own permissions, on top of its role.
    const rolePerms = rolePermissionsOf(newUser.roleId);
    const result = await addUser({
      username,
      name,
      roleId: newUser.roleId,
      permissions: newUser.permissions.filter(p => !rolePerms.includes(p)),
      password: newUser.password.trim(),
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setShowAddDialog(false);
    setNewUser({ username: '', name: '', password: '', roleId: defaultNewUserRoleId, permissions: [] });
    toast.success(`تمت إضافة الحساب. رمز الدخول: ${newUser.password.trim()}`);
  });

  const openEditUserDialog = (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    setEditUserDialog({ open: true, id: userId, name: user.name, password: '', roleId: user.roleId });
  };
  const handleEditUserSave = runSaveUserLocked(async () => {
    const user = users.find(u => u.id === editUserDialog.id);
    if (!user) { toast.error('الحساب غير موجود. حدّث الصفحة.'); return; }
    if (!editUserDialog.name.trim()) { toast.error('يرجى إدخال الاسم'); return; }
    const password = editUserDialog.password.trim();
    if (password) {
      const passwordError = passwordProblem(password);
      if (passwordError) { toast.error(passwordError); return; }
    }
    const updates: { name?: string; password?: string; roleId?: string; permissions?: string[] } = {};
    if (editUserDialog.name.trim() !== user.name) updates.name = editUserDialog.name.trim();
    if (password) updates.password = password;
    if (editUserDialog.roleId && editUserDialog.roleId !== user.roleId) {
      // New role: keep only what the account had on top of its old role.
      const oldRolePerms = rolePermissionsOf(user.roleId);
      updates.roleId = editUserDialog.roleId;
      updates.permissions = (user.ownPermissions ?? user.permissions).filter(p => !oldRolePerms.includes(p));
    }
    if (!Object.keys(updates).length) {
      setEditUserDialog({ open: false, id: '', name: '', password: '', roleId: '' });
      return;
    }
    const result = await updateUser(editUserDialog.id, updates);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setEditUserDialog({ open: false, id: '', name: '', password: '', roleId: '' });
    toast.success(password ? `تم حفظ التعديل. رمز الدخول الجديد: ${password}` : 'تم حفظ التعديل');
  });

  const handleToggleUser = async (userId: string) => {
    const user = users.find(u => u.id === userId);
    const result = await toggleUser(userId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(user?.active ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب');
  };

  const openDeleteUserDialog = (userId: string) => {
    const user = users.find(u => u.id === userId);
    setDeleteUserDialog({ open: true, id: userId, userName: user?.name || '' });
  };
  const handleDeleteUserConfirm = runDeleteUserLocked(async () => {
    const result = await deleteUser(deleteUserDialog.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('تم حذف الحساب');
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
    if (!editedUser || isAdminUser) {
      setEditPermsId('');
      setEditPerms([]);
      return;
    }
    // Saved: only what the account has on top of its role.
    const rolePerms = rolePermissionsOf(editedUser.roleId);
    const result = await updateUserPermissions(editPermsId, editPerms.filter(p => !rolePerms.includes(p)));
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setEditPermsId('');
    setEditPerms([]);
    toast.success('تم حفظ الصلاحيات');
  });

  const handleRoleChange = (roleId: string) => {
    setNewUser(p => ({ ...p, roleId, permissions: [] }));
  };

  const getRoleName = (roleId: string) => roles.find(r => r.id === roleId)?.name || 'غير محدد';

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


  const isAdminAccount = (user: { username: string; roleId: string }) =>
    user.username.trim().toLowerCase() === 'admin' || user.roleId === 'role_admin';
  const searchedUsers = userSearch.trim()
    ? users.filter(u => searchAny(userSearch, [u.name, u.username, getRoleName(u.roleId)]))
    : users;
  const userChipMatches = (key: UserChip, user: (typeof users)[number]) =>
    key === 'active' ? user.active
      : key === 'disabled' ? !user.active
        : key === 'protected' ? isAdminAccount(user)
          : true;
  const userChips: ListChip[] = USER_CHIPS.map(chip => ({
    ...chip,
    count: searchedUsers.filter(user => userChipMatches(chip.key as UserChip, user)).length,
  }));
  const shownUsers = searchedUsers.filter(user => userChipMatches(userChip, user));

  return (
    <div className="tp-list">
      <ListToolbar
        label="المستخدمون"
        search={
          <Input
            id="accounts-user-search"
            type="search"
            autoComplete="off"
            aria-label="ابحث عن مستخدم"
            placeholder="ابحث بالاسم أو اسم الدخول أو الدور"
            value={userSearch}
            onChange={(event) => setUserSearch(event.target.value)}
          />
        }
        actions={
          <Button onClick={() => {
            setNewUser({ username: '', name: '', password: generatePasscode(), roleId: defaultNewUserRoleId, permissions: [] });
            setShowAddDialog(true);
          }}>
            <UserPlus aria-hidden="true" />
            إضافة مستخدم
          </Button>
        }
        chips={userChips}
        chipsLabel="حالة الحساب"
        activeChip={userChip}
        onChipChange={(key) => setUserChip(key as UserChip)}
        summary={<>المعروض <b>{shownUsers.length}</b> من <b>{users.length}</b> مستخدم</>}
      />

      {/* One card per user, in the system's card look: who, role, state and how
          much they can do. «تعديل» stays visible; the rest waits in «⋯». The
          protected admin carries «محمي» instead of buttons that cannot work. */}
      {shownUsers.length === 0 ? (
        <EmptyState title="ماكو مستخدم بهذا البحث أو الفلتر." />
      ) : (
        <ul className="tp-rcards" data-columns="2" aria-label="المستخدمون">
          {shownUsers.map(user => {
            const isAdminUser = isAdminAccount(user);
            const isProtectedAccount = user.username.trim().toLowerCase() === 'admin';
            const displayedUserPermissions = isAdminUser ? PERMISSION_CATALOG.map(p => p.id) : user.permissions;
            const permissionCount = displayedUserPermissions.filter(id => PERMISSION_IDS.has(id)).length;
            const permissionShare = PERMISSION_CATALOG.length ? permissionCount / PERMISSION_CATALOG.length : 0;
            const tone = user.active ? 'success' : 'danger';
            const menuActions: RowAction[] = [
              { key: 'details', label: 'تفاصيل الصلاحيات', icon: <UserRoundSearch aria-hidden="true" />, onSelect: () => setDetailsUserId(user.id) },
              { key: 'permissions', label: isAdminUser ? 'صلاحيات كاملة' : 'تعديل الصلاحيات', icon: <KeyRound aria-hidden="true" />, onSelect: () => handleEditPermissions(user.id) },
            ];
            if (!isProtectedAccount) {
              menuActions.push({
                key: 'toggle',
                label: user.active ? 'تعطيل الحساب' : 'تفعيل الحساب',
                icon: user.active ? <UserX aria-hidden="true" /> : <UserCheck aria-hidden="true" />,
                onSelect: () => void handleToggleUser(user.id),
              });
            }
            if (!isAdminUser) {
              menuActions.push({ key: 'delete', label: 'حذف المستخدم…', icon: <Trash2 aria-hidden="true" />, danger: true, onSelect: () => openDeleteUserDialog(user.id) });
            }
            return (
              <li key={user.id} className="tp-rcard" data-muted={user.active ? undefined : 'true'}>
                <div className="tp-rcard__head">
                  <span className="tp-rcard__light" data-tone={tone} aria-hidden="true" />
                  <h3 className="tp-rcard__name">{user.name}</h3>
                  <span className="tp-rcard__sep" aria-hidden="true" />
                  <span dir="ltr" className="tp-rcard__code">{user.username}</span>
                  <span className="tp-rcard__sub">{getRoleName(user.roleId)}</span>
                  <span className="tp-rcard__head-end">
                    {isAdminUser ? (
                      <span className="tp-rcard__pill" title={isProtectedAccount ? 'حساب admin محمي: يبقى فعّال دائماً ولا ينحذف' : 'حساب مدير: لا ينحذف'}>
                        <Lock aria-hidden="true" />
                        محمي
                      </span>
                    ) : null}
                    <span className="tp-rcard__pill" data-tone={tone}>{user.active ? 'فعّال' : 'معطّل'}</span>
                  </span>
                </div>
                <div className="tp-rcard__panel">
                  <span className="tp-rcard__eyebrow">الصلاحيات</span>
                  <span className="tp-account-card__bar" aria-hidden="true">
                    <span style={{ inlineSize: `${Math.round(permissionShare * 100)}%` }} />
                  </span>
                  <span className="tp-rcard__line">
                    <b>{permissionCount}</b> من <b>{PERMISSION_CATALOG.length}</b> صلاحية
                    {isAdminUser ? ' · كل الصلاحيات دائماً' : ''}
                  </span>
                </div>
                <div className="tp-rcard__foot">
                  <span className="tp-rcard__foot-end">
                    <Button variant="outline" size="sm" onClick={() => openEditUserDialog(user.id)}>
                      <UserPen aria-hidden="true" />
                      تعديل
                    </Button>
                    <RowActionsMenu label={`إجراءات ${user.name}`} actions={menuActions} />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* User Permissions Details Dialog */}
      <Dialog open={!!detailsUserId} onOpenChange={(open) => { if (!open) setDetailsUserId(''); }}>
        <DialogContent dir="rtl" className={ACCOUNT_DIALOG_CONTENT_CLASS}>
          <FormDialogHero icon={UserRoundSearch} title={<>تفاصيل صلاحيات الحساب - {detailsUser?.name || ''}</>} description="عرض تفصيلي للصلاحيات الفعلية حسب الحساب والدور، حتى تعرف بالضبط شنو يستطيع هذا المستخدم يشوف أو يعدّل." />
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
          <DialogFooter>
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
          <FormDialogHero icon={UserPen} title="تعديل المستخدم" description="أدخل الاسم الجديد، واترك رمز المرور فارغاً إذا لا تريد تغييره" />
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
              <p className="text-xs text-muted-foreground">8 أحرف على الأقل، بيها حرف ورقم.</p>
            </div>
            {(() => {
              const editedUser = users.find(u => u.id === editUserDialog.id);
              if (!editedUser) return null;
              const isAdminUser = editedUser.username.trim().toLowerCase() === 'admin' || editedUser.roleId === 'role_admin';
              if (isAdminUser) return <p className="text-xs text-muted-foreground">حساب المدير: دوره وصلاحياته ثابتة.</p>;
              if (editedUser.id === currentUserId) return <p className="text-xs text-muted-foreground">ما تگدر تغيّر دور حسابك من نفس الجلسة.</p>;
              return (
                <div className="space-y-2">
                  <Label htmlFor="user-edit-role">الدور</Label>
                  <Select value={editUserDialog.roleId} onValueChange={roleId => setEditUserDialog(prev => ({ ...prev, roleId }))}>
                    <SelectTrigger id="user-edit-role"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roles.filter(role => role.id !== 'role_admin').map(role => (
                        <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {editUserDialog.roleId !== editedUser.roleId ? (
                    <p className="text-xs text-muted-foreground">يأخذ صلاحيات الدور الجديد، وتبقى صلاحياته الإضافية.</p>
                  ) : null}
                </div>
              );
            })()}
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
        <DialogContent dir="rtl" className={ACCOUNT_DIALOG_CONTENT_CLASS}>
          <FormDialogHero icon={UserPlus} title="إضافة مستخدم جديد" description="أنشئ حساب مستخدم جديد وحدد دوره وصلاحياته" />
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
              <Input id="new-password" name="password" autoComplete="new-password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} placeholder="أدخل رمزاً أو اضغط توليد رمز" />
              <p className="text-xs text-muted-foreground">8 أحرف على الأقل، بيها حرف ورقم. انسخه وسلّمه لصاحب الحساب.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-role">الدور</Label>
              <Select name="roleId" value={newUser.roleId} onValueChange={handleRoleChange}>
                <SelectTrigger id="new-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roles.filter(role => role.id !== 'role_admin').map(role => (
                    <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="space-y-2">
              <span className="text-sm font-medium leading-none">الصلاحيات</span>
              <p className="text-xs text-muted-foreground">صلاحيات الدور مؤشّرة ومقفولة؛ أشّر على أي صلاحية إضافية تريدها لهذا الحساب.</p>
              <PermissionChecklist
                perms={newUser.permissions}
                lockedPerms={rolePermissionsOf(newUser.roleId)}
                onChange={(permissions) => setNewUser(prev => ({ ...prev, permissions }))}
              />
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
        <DialogContent dir="rtl" className={ACCOUNT_DIALOG_CONTENT_CLASS}>
          <FormDialogHero icon={KeyRound} title={<>تحديث الصلاحيات - {users.find(u => u.id === editPermsId)?.name}</>} description="صلاحيات الدور مقفولة (تتغيّر من تبويب الأدوار أو بتغيير دور الحساب). أشّر على الصلاحيات الإضافية لهذا الحساب ثم احفظ." />
          <div className={ACCOUNT_DIALOG_BODY_CLASS}>
            <PermissionChecklist
              perms={editPerms}
              onChange={setEditPerms}
              lockedPerms={rolePermissionsOf(users.find(u => u.id === editPermsId)?.roleId || '')}
              readOnly={users.find(u => u.id === editPermsId)?.username.trim().toLowerCase() === 'admin' || users.find(u => u.id === editPermsId)?.roleId === 'role_admin'}
            />
          </div>
          <DialogFooter>
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

function formatSecurityTime(value: string) {
  return formatBaghdadDateTime(value, 'غير محدد');
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
    return <LoadingState title="جاري تحميل لوحة أمان الحسابات..." />;
  }

  if (error) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title={error}
        description="تحتاج صلاحية إدارة الحسابات لفتح هذه اللوحة."
        action={<Button variant="outline" onClick={() => void loadOverview()}>إعادة المحاولة</Button>}
      />
    );
  }

  if (!overview) return null;

  // One line instead of a strip of number boxes.
  const summaryParts = [
    `${overview.summary.users} مستخدم`,
    `${overview.summary.activeUsers} فعّال`,
    ...(overview.summary.disabledUsers ? [`${overview.summary.disabledUsers} معطّل`] : []),
    `${overview.summary.roles} أدوار`,
    ...(overview.summary.riskyRoles ? [`${overview.summary.riskyRoles} أدوار حساسة`] : []),
  ];

  const openSecurityLogs = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.history.pushState({}, '', event.currentTarget.href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div className="tp-list">
      <ListToolbar
        label="أمان الحسابات"
        actions={
          <Button variant="outline" disabled={refreshing} onClick={() => void loadOverview({ background: true })}>
            <RefreshCw className={refreshing ? 'animate-spin motion-reduce:animate-none' : undefined} aria-hidden="true" />
            {refreshing ? 'جارٍ التحديث...' : 'تحديث الفحص'}
          </Button>
        }
        summary={<>{summaryParts.join(' · ')} · آخر فحص: <b>{formatSecurityTime(overview.generatedAt)}</b></>}
      />

      <ul className="tp-rcards" data-columns="2" aria-label="فحوصات الأمان">
        {overview.checks.map((check) => {
          const tone = check.ok ? 'success' : check.severity === 'danger' ? 'danger' : 'warning';
          return (
            <li key={check.id} className="tp-rcard">
              <div className="tp-rcard__head">
                <span className="tp-rcard__light" data-tone={tone} aria-hidden="true" />
                <h3 className="tp-rcard__name">{check.title}</h3>
                <span className="tp-rcard__head-end">
                  <span className="tp-rcard__pill" data-tone={tone}>{check.ok ? 'سليم' : check.severity === 'danger' ? 'خطر' : 'تنبيه'}</span>
                </span>
              </div>
              <p className="tp-rcard__line">{check.message}</p>
            </li>
          );
        })}
      </ul>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="tp-rcard content-start" aria-labelledby="security-risky-users">
          <h3 id="security-risky-users" className="tp-rcard__name">المستخدمين أصحاب الصلاحيات الحساسة</h3>
          {overview.riskyUsers.length === 0 ? (
            <EmptyState compact icon={ShieldCheck} title="لا توجد صلاحيات حساسة خارج النطاق المتوقع." />
          ) : overview.riskyUsers.map((user) => (
            <div key={user.id} className="tp-rcard__panel">
              <span className="tp-rcard__title">{user.name}</span>
              <span className="tp-rcard__line">
                <span dir="ltr">@{user.username}</span> · {user.role} · {user.active ? 'فعال' : 'معطل'}
              </span>
              <span className="flex flex-wrap gap-1">
                {user.sensitivePermissions.map((permission) => (
                  <Badge key={permission} variant={user.isAdmin ? 'default' : 'outline'} className="text-[10px]">{permissionLabel(permission)}</Badge>
                ))}
              </span>
            </div>
          ))}
        </section>

        <section className="tp-rcard content-start" aria-labelledby="security-risky-roles">
          <h3 id="security-risky-roles" className="tp-rcard__name">الأدوار الحساسة</h3>
          {overview.riskyRoles.length === 0 ? (
            <EmptyState compact icon={ShieldCheck} title="لا توجد أدوار تحتوي صلاحيات حساسة." />
          ) : overview.riskyRoles.map((role) => (
            <div key={role.id} className="tp-rcard__panel">
              <span className="tp-rcard__title">{role.name}</span>
              <span className="tp-rcard__line">
                {role.userCount} مستخدم مرتبط{role.id === 'role_admin' ? ' · دور المدير' : ''}
              </span>
              <span className="flex flex-wrap gap-1">
                {role.sensitivePermissions.map((permission) => (
                  <Badge key={permission} variant="outline" className="text-[10px]">{permissionLabel(permission)}</Badge>
                ))}
              </span>
            </div>
          ))}
        </section>
      </div>

      <section className="tp-rcard" aria-labelledby="security-recent-logs">
        <div className="tp-rcard__head">
          <h3 id="security-recent-logs" className="tp-rcard__name">آخر عمليات الحسابات</h3>
          <span className="tp-rcard__head-end">
            <Button asChild variant="outline" size="sm">
              <a href={`/?section=logs&module=${encodeURIComponent('أمان الحسابات')}`} onClick={openSecurityLogs}>
                <ScrollText aria-hidden="true" />
                عرض بالسجلات
              </a>
            </Button>
          </span>
        </div>
        {overview.recentLogs.length === 0 ? (
          <p className="tp-rcard__line">ماكو عمليات حديثة.</p>
        ) : (
          <ol className="tp-logs-list">
            {overview.recentLogs.slice(0, 10).map((log) => (
              <li key={log.id} className="tp-logs-row">
                <div className="tp-logs-row__plain">
                  <span className="tp-logs-row__icon" data-tone="muted" aria-hidden="true">أ</span>
                  <span className="tp-logs-row__text">
                    <span className="tp-logs-row__summary">{humanizeTeacherProText(formatAuditLogDisplay(log).summary)}</span>
                    <span className="tp-logs-row__meta">
                      {log.userName || 'النظام'} · {log.action || '—'}
                    </span>
                  </span>
                  <time className="tp-logs-row__time" dateTime={log.time}>{formatSecurityTime(log.time)}</time>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

// ─── Backup Tab ──────────────────────────────────────────────────────────────

type BackupRecordCounts = {
  courses?: number; chapters?: number; courseChapters?: number;
  students?: number; exams?: number; examCourses?: number;
  grades?: number; opportunityLogs?: number;
  studentLeaves?: number; studentCalls?: number; studentNotes?: number;
  users?: number; roles?: number; logs?: number;
  studentLeaveGradeBackups?: number;
  studentEnrollmentArchives?: number;
  permissionCatalog?: number;
};

type BackupExport = {
  version: number;
  exportedAt: string;
  tableCount?: number;
  recordCounts?: BackupRecordCounts;
  [key: string]: unknown;
};

type RestoreResponse = {
  ok?: boolean;
  mode?: string;
  backupVersion?: number;
  beforeCounts?: Record<string, number>;
  afterCounts?: Record<string, number>;
  inserted?: Record<string, number>;
  updated?: Record<string, number>;
  skipped?: Record<string, number>;
  errors?: Array<{ table: string; message: string; sample?: unknown }>;
  restoredAt?: string;
  error?: string;
  code?: string;
};

/** The word typed to confirm a restore; the server still receives RESTORE. */
const RESTORE_WORD = 'استعادة';

const BACKUP_TABLE_LABELS: Record<string, string> = {
  courses: 'الدورات',
  chapters: 'الفصول',
  courseChapters: 'روابط الفصول',
  students: 'الطلاب',
  exams: 'الامتحانات',
  examCourses: 'دورات الامتحانات',
  grades: 'الدرجات',
  opportunityLogs: 'حركات الفرص',
  studentLeaves: 'الإجازات',
  studentCalls: 'المكالمات',
  studentNotes: 'الملاحظات',
  users: 'المستخدمين',
  roles: 'الأدوار',
  logs: 'السجلات',
  studentLeaveGradeBackups: 'درجات الإجازات',
  studentEnrollmentArchives: 'أرشيف الاشتراكات',
  permissionCatalog: 'الصلاحيات',
};

function BackupTab() {
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge');
  const [confirmText, setConfirmText] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedBackup, setParsedBackup] = useState<BackupExport | null>(null);
  const [parseError, setParseError] = useState('');
  const [restoreResult, setRestoreResult] = useState<RestoreResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [exportLocked, setExportLocked] = useState(false);

  // ─── Export backup ──────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (exportLocked) return;
    setExportLocked(true);
    setExporting(true);
    try {
      const res = await fetch('/api/backup', { credentials: 'same-origin' });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || 'تعذر تصدير النسخة الاحتياطية');
      }
      const data = (await res.json()) as BackupExport;
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = baghdadTodayKey();
      a.href = url;
      a.download = `teacherpro-backup-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('تم تصدير النسخة الاحتياطية بنجاح');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تصدير النسخة الاحتياطية');
    } finally {
      setExporting(false);
      setExportLocked(false);
    }
  }, [exportLocked]);

  // ─── Parse selected file ────────────────────────────────────────────────
  const handleFileSelect = useCallback(async (file: File | null) => {
    setSelectedFile(file);
    setParsedBackup(null);
    setParseError('');
    setRestoreResult(null);
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as BackupExport;
      if (!parsed || typeof parsed !== 'object' || !parsed.version) {
        throw new Error('الملف لا يحتوي على نسخة احتياطية صالحة (حقل version مفقود)');
      }
      setParsedBackup(parsed);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'تعذر قراءة الملف كـ JSON صالح');
    }
  }, []);

  // ─── Restore backup ─────────────────────────────────────────────────────
  const handleRestore = useCallback(async () => {
    if (!parsedBackup) {
      toast.error('يرجى اختيار ملف نسخة احتياطية صالح أولاً');
      return;
    }
    if (confirmText.trim() !== RESTORE_WORD) {
      toast.error(`اكتب «${RESTORE_WORD}» حتى تأكد الاستعادة`);
      return;
    }
    setConfirmOpen(false);
    setRestoring(true);
    setRestoreResult(null);
    try {
      const res = await fetch('/api/backup', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: parsedBackup.version,
          mode: restoreMode,
          confirm: 'RESTORE',
          backup: parsedBackup,
        }),
      });
      const data = (await res.json()) as RestoreResponse;
      if (!res.ok) {
        throw new Error(data.error || `تعذر إكمال الاستعادة (${res.status})`);
      }
      setRestoreResult(data);
      toast.success('تمت الاستعادة بنجاح. قد تحتاج الصفحات لإعادة التحميل لرؤية البيانات المحدّثة.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر إكمال الاستعادة');
    } finally {
      setRestoring(false);
      setConfirmText('');
    }
  }, [parsedBackup, confirmText, restoreMode]);

  const recordCountEntries = parsedBackup?.recordCounts
    ? Object.entries(parsedBackup.recordCounts).filter(([, v]) => typeof v === 'number' && v > 0)
    : [];

  return (
    <div className="tp-list">
      <section className="tp-rcard" aria-labelledby="backup-export-title">
        <h3 id="backup-export-title" className="tp-rcard__name">تصدير نسخة</h3>
        <p className="tp-rcard__line">ملف واحد بيه كل بيانات النظام، تحتفظ بيه عندك.</p>
        <div className="tp-rcard__foot">
          <Button onClick={handleExport} disabled={exporting || exportLocked}>
            <Download aria-hidden="true" />
            {exporting ? 'جارٍ التصدير...' : 'تصدير نسخة'}
          </Button>
        </div>
      </section>

      <section className="tp-rcard" aria-labelledby="backup-restore-title">
        <h3 id="backup-restore-title" className="tp-rcard__name">استعادة نسخة</h3>
        <div className="grid gap-4">
          <div role="note" className="flex items-start gap-2 rounded-xl border border-warning-line border-s-4 border-s-warning-vivid bg-warning-soft p-3 text-sm leading-relaxed text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>الاستعادة تغيّر بيانات النظام الحالية. صدّر نسخة جديدة قبلها.</span>
          </div>

          {/* File picker: the system's own button, not the browser's English «Choose File». */}
          <div className="space-y-2">
            <Label htmlFor="backup-file">ملف النسخة</Label>
            <input
              id="backup-file"
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={(e) => void handleFileSelect(e.target.files?.[0] ?? null)}
              className="sr-only"
              tabIndex={-1}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={restoring}>
                <FileUp aria-hidden="true" />
                اختر ملف النسخة
              </Button>
              <span className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {selectedFile
                  ? <><bdi>{selectedFile.name}</bdi> · {(selectedFile.size / 1024).toFixed(1)} كيلوبايت</>
                  : 'ما اخترت ملف بعد'}
              </span>
            </div>
          </div>

          {parseError && (
            <div className="tp-field-feedback tp-field-feedback-error">
              {parseError}
            </div>
          )}

          {parsedBackup && (
            <div className="tp-rcard__panel">
              <span className="tp-rcard__title">
                {parsedBackup.exportedAt ? `نسخة ${formatBaghdadDateTime(parsedBackup.exportedAt)}` : 'نسخة بدون تاريخ'}
              </span>
              {recordCountEntries.length > 0 && (
                <span className="tp-rcard__line">
                  {recordCountEntries.map(([k, v]) => `${BACKUP_TABLE_LABELS[k] || k} ${v}`).join(' · ')}
                </span>
              )}
            </div>
          )}

          {parsedBackup && (
            <div className="space-y-2">
              <Label htmlFor="backup-mode">طريقة الاستعادة</Label>
              <Select value={restoreMode} onValueChange={(v) => setRestoreMode(v as 'merge' | 'replace')}>
                <SelectTrigger id="backup-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="merge">دمج: يضيف ويحدّث بدون ما يحذف شي</SelectItem>
                  <SelectItem value="replace">استبدال: يمسح البيانات الحالية ويحط النسخة مكانها</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Button
              onClick={() => { setConfirmText(''); setConfirmOpen(true); }}
              disabled={restoring || !parsedBackup}
              variant={restoreMode === 'replace' ? 'destructive' : 'default'}
            >
              {restoring ? 'جارٍ الاستعادة... (قد تاخذ دقائق)' : 'استعادة النسخة…'}
            </Button>
          </div>

          {restoreResult && (
            <div className="rounded-xl border border-success-line border-s-4 border-s-success-vivid bg-success-soft p-4 space-y-3 text-sm">
              <div className="flex items-center gap-2 font-semibold text-success">
                <ShieldCheck className="size-4" aria-hidden="true" />
                تمت الاستعادة
              </div>
              {[
                ['انضاف', restoreResult.inserted],
                ['تحدّث', restoreResult.updated],
                ['تخطّى', restoreResult.skipped],
              ].map(([label, counts]) => {
                const rows = Object.entries((counts || {}) as Record<string, number>).filter(([, v]) => v > 0);
                if (!rows.length) return null;
                return (
                  <p key={label as string} className="text-xs">
                    <b>{label as string}:</b> {rows.map(([k, v]) => `${BACKUP_TABLE_LABELS[k] || k} ${v}`).join(' · ')}
                  </p>
                );
              })}
              {restoreResult.errors && restoreResult.errors.length > 0 && (
                <div className="text-xs text-warning">
                  <strong>سجلات ما انستعادت:</strong>
                  <ul className="mt-1 space-y-0.5">
                    {restoreResult.errors.slice(0, 5).map((e, i) => (
                      <li key={i}>{BACKUP_TABLE_LABELS[e.table] || e.table}: {e.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-muted-foreground">حدّث الصفحة حتى تشوف البيانات الجديدة بكل الأقسام.</p>
            </div>
          )}
        </div>
      </section>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!restoring) setConfirmOpen(open); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>استعادة النسخة؟</AlertDialogTitle>
            <AlertDialogDescription>
              {restoreMode === 'replace'
                ? 'طريقة الاستبدال تمسح البيانات الحالية وتحط النسخة مكانها، وما تنرجع.'
                : 'طريقة الدمج تضيف وتحدّث السجلات من النسخة، والبيانات الحالية تبقى.'}
              {' '}حتى تأكد، اكتب «{RESTORE_WORD}».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            aria-label={`اكتب ${RESTORE_WORD}`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={RESTORE_WORD}
            className="text-center"
            disabled={restoring}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => { event.preventDefault(); void handleRestore(); }}
              disabled={restoring || confirmText.trim() !== RESTORE_WORD}
              className={restoreMode === 'replace' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
            >
              {restoring ? 'جارٍ الاستعادة...' : 'استعادة'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Main Accounts View ──────────────────────────────────────────────────────

/**
 * On a phone the five tabs do not fit: the bar scrolls sideways, fades at the
 * side that has more tabs, and keeps the open tab in view.
 */
function useScrollableTabs(active: string) {
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => {
      // In RTL the start is on the right: scrollLeft runs from 0 to negative.
      const max = list.scrollWidth - list.clientWidth;
      const scrolled = Math.abs(list.scrollLeft);
      list.dataset.moreStart = scrolled > 4 ? 'true' : 'false';
      list.dataset.moreEnd = max - scrolled > 4 ? 'true' : 'false';
    };
    update();
    list.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      list.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  return listRef;
}

export function AccountsView() {
  const refreshAccounts = useTeacherStore((state) => state.refreshAccounts);
  const [tab, setTab] = useState('users');
  const tabsListRef = useScrollableTabs(tab);
  // The page shows the accounts and roles as the database has them now.
  useEffect(() => {
    void refreshAccounts();
  }, [refreshAccounts]);
  return (
    <div className="space-y-6 tp-accounts-page">
      <Tabs value={tab} onValueChange={setTab} dir="rtl">
        <TabsList ref={tabsListRef} className="w-full max-w-5xl">
          <TabsTrigger value="users" className="flex-1">المستخدمين</TabsTrigger>
          <TabsTrigger value="roles" className="flex-1">الأدوار والصلاحيات</TabsTrigger>
          <TabsTrigger value="security" className="flex-1">الأمان</TabsTrigger>
          <TabsTrigger value="backup" className="flex-1">النسخ الاحتياطي</TabsTrigger>
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
        <TabsContent value="backup" className="mt-4">
          <BackupTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
