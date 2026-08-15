import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Key, ShieldCheck, User, Search, Settings2, Users } from 'lucide-react';
import KpiCard from '../components/KpiCard.jsx';
import { Users as UsersApi } from '../api/client.js';
import { useAuth } from '../hooks/useAuth.js';
import Panel  from '../components/Panel.jsx';
import Modal  from '../components/Modal.jsx';
import { FormField, inputClass, buttonPrimary, buttonSecondary, buttonDanger } from '../components/form.jsx';

const EMPTY_CREATE = { username: '', password: '', role: 'supervisor' };
const EMPTY_EDIT   = { username: '', role: 'supervisor' };
const ALL_PERMISSIONS = [
  {
    key:         'view_reports',
    group:       'Reports',
    label:       'View Reports',
    description: 'Access to all reporting dashboards and data exports',
  },
  {
    key:         'change_agent_state',
    group:       'Agent Control',
    label:       'Change Agent State',
    description: 'Set agents to Available, On Break, or Logged Out',
  },
];

function RoleBadge({ role }) {
  return role === 'admin'
    ? <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide
                       bg-brand/10 dark:bg-brand/15 text-brand dark:text-brand-light
                       border border-brand/20 dark:border-brand/25">
        <ShieldCheck size={9} /> Admin
      </span>
    : <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide
                       bg-gray-100 dark:bg-panel-raised text-gray-500 dark:text-ink-dim
                       border border-gray-200 dark:border-panel-border">
        <User size={9} /> Supervisor
      </span>;
}

function Avatar({ username }) {
  return (
    <div className="h-8 w-8 rounded-full bg-brand flex items-center justify-center text-white text-xs font-bold shrink-0">
      {(username || '?').slice(0, 2).toUpperCase()}
    </div>
  );
}

export default function UserManagement() {
  const { user: me } = useAuth();

  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [search,  setSearch]  = useState('');

  // ── Modal states ──────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen,   setEditOpen]   = useState(false);
  const [resetOpen,  setResetOpen]  = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [permsOpen,  setPermsOpen]  = useState(false);
  const [selected,   setSelected]   = useState(null);  // user being acted on
  const [permsForm,  setPermsForm]  = useState([]);

  const [createForm, setCreateForm] = useState(EMPTY_CREATE);
  const [editForm,   setEditForm]   = useState(EMPTY_EDIT);
  const [newPassword, setNewPassword] = useState('');
  const [saving,   setSaving]   = useState(false);
  const [formErr,  setFormErr]  = useState('');

  // ── Data loading ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      setUsers(await UsersApi.list());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = users.filter(u =>
    !search.trim() ||
    u.username.toLowerCase().includes(search.trim().toLowerCase()) ||
    u.role.toLowerCase().includes(search.trim().toLowerCase())
  );

  // ── Action helpers ────────────────────────────────────────────────────────
  function openEdit(user) {
    setSelected(user);
    setEditForm({ username: user.username, role: user.role });
    setFormErr('');
    setEditOpen(true);
  }

  function openReset(user) {
    setSelected(user);
    setNewPassword('');
    setFormErr('');
    setResetOpen(true);
  }

  function openDelete(user) {
    setSelected(user);
    setDeleteOpen(true);
  }

  function openPerms(user) {
    setSelected(user);
    setPermsForm(user.permissions ?? []);
    setFormErr('');
    setPermsOpen(true);
  }

  function togglePerm(key) {
    setPermsForm(prev =>
      prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]
    );
  }

  async function handlePerms(e) {
    e.preventDefault();
    setFormErr('');
    setSaving(true);
    try {
      const updated = await UsersApi.updatePermissions(selected.id, permsForm);
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
      setPermsOpen(false);
    } catch (err) {
      setFormErr(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setFormErr('');
    if (!createForm.username.trim()) return setFormErr('Username is required');
    if (createForm.password.length < 6) return setFormErr('Password must be at least 6 characters');
    setSaving(true);
    try {
      await UsersApi.create(createForm);
      setCreateOpen(false);
      setCreateForm(EMPTY_CREATE);
      load();
    } catch (err) {
      setFormErr(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(e) {
    e.preventDefault();
    setFormErr('');
    if (!editForm.username.trim()) return setFormErr('Username is required');
    setSaving(true);
    try {
      await UsersApi.update(selected.id, editForm);
      setEditOpen(false);
      load();
    } catch (err) {
      setFormErr(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset(e) {
    e.preventDefault();
    setFormErr('');
    if (newPassword.length < 6) return setFormErr('Password must be at least 6 characters');
    setSaving(true);
    try {
      await UsersApi.resetPassword(selected.id, newPassword);
      setResetOpen(false);
      setNewPassword('');
    } catch (err) {
      setFormErr(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await UsersApi.remove(selected.id);
      setDeleteOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  }

  const thClass = 'th whitespace-nowrap';

  return (
    <div className="space-y-5">

      {/* Header KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <KpiCard label="Total Users"  value={users.length}                                   icon={Users}       tone="blue" />
        <KpiCard label="Admins"       value={users.filter(u => u.role === 'admin').length}    icon={ShieldCheck} tone="purple" />
        <KpiCard label="Supervisors"  value={users.filter(u => u.role === 'supervisor').length} icon={User}      tone="default" />
      </div>

      {/* Main table panel */}
      <Panel noPad
             action={
               <div className="flex items-center gap-2">
                 <div className="relative">
                   <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                   <input
                     type="text"
                     placeholder="Search users…"
                     value={search}
                     onChange={e => setSearch(e.target.value)}
                     className="field-input pl-7 py-1.5 w-44 text-xs"
                   />
                 </div>
                 <button
                   onClick={() => { setCreateForm(EMPTY_CREATE); setFormErr(''); setCreateOpen(true); }}
                   className="btn-primary text-xs px-3 py-1.5"
                 >
                   <Plus size={13} /> Add User
                 </button>
               </div>
             }
             eyebrow="Admin"
             title="Accounts">


        {error && (
          <div className="mx-6 mt-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-panel-border">
                <th className={thClass}>User</th>
                <th className={thClass}>Role</th>
                <th className={thClass}>Created</th>
                <th className={`${thClass} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-panel-border">
              {loading && (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-sm text-gray-400">
                    Loading users…
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-sm text-gray-400">
                    No users found.
                  </td>
                </tr>
              )}
              {filtered.map(u => (
                <tr
                  key={u.id}
                  className="hover:bg-blue-50/40 dark:hover:bg-panel-raised/40 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar username={u.username} />
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-ink capitalize">
                          {u.username}
                          {u.id === me?.id && (
                            <span className="ml-1.5 text-[10px] font-bold text-brand dark:text-brand-light">(you)</span>
                          )}
                        </p>
                        <p className="text-[11px] text-gray-400 dark:text-ink-faint font-mono">
                          #{u.id}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <RoleBadge role={u.role} />
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-ink-dim whitespace-nowrap">
                    {new Date(u.created_at).toLocaleDateString(undefined, {
                      month: 'short', day: 'numeric', year: 'numeric'
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => openEdit(u)}
                        title="Edit"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50
                          dark:hover:bg-blue-500/10 dark:hover:text-blue-400 transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                      {u.role === 'supervisor' && (
                        <button
                          onClick={() => openPerms(u)}
                          title="Permissions"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50
                            dark:hover:bg-violet-500/10 dark:hover:text-violet-400 transition-colors"
                        >
                          <Settings2 size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => openReset(u)}
                        title="Reset password"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50
                          dark:hover:bg-amber-500/10 dark:hover:text-amber-400 transition-colors"
                      >
                        <Key size={14} />
                      </button>
                      <button
                        onClick={() => openDelete(u)}
                        title="Delete"
                        disabled={u.id === me?.id}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50
                          dark:hover:bg-red-500/10 dark:hover:text-red-400 transition-colors
                          disabled:opacity-30 disabled:pointer-events-none"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── Create user modal ─────────────────────────────────────────────── */}
      <Modal
        open={createOpen}
        title="Add New User"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button className={buttonSecondary} onClick={() => setCreateOpen(false)}>Cancel</button>
            <button className={buttonPrimary} onClick={handleCreate} disabled={saving}>
              {saving ? 'Creating…' : 'Create User'}
            </button>
          </>
        }
      >
        {formErr && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {formErr}
          </div>
        )}
        <FormField label="Username">
          <input
            type="text"
            className={inputClass}
            placeholder="john.smith"
            value={createForm.username}
            onChange={e => setCreateForm(f => ({ ...f, username: e.target.value }))}
          />
        </FormField>
        <FormField label="Password" hint="Minimum 6 characters">
          <input
            type="password"
            className={inputClass}
            placeholder="••••••••"
            value={createForm.password}
            onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
          />
        </FormField>
        <FormField label="Role">
          <select
            className={inputClass}
            value={createForm.role}
            onChange={e => setCreateForm(f => ({ ...f, role: e.target.value }))}
          >
            <option value="supervisor">Supervisor</option>
            <option value="admin">Admin</option>
          </select>
        </FormField>
      </Modal>

      {/* ── Edit user modal ───────────────────────────────────────────────── */}
      <Modal
        open={editOpen}
        title={`Edit — ${selected?.username}`}
        onClose={() => setEditOpen(false)}
        footer={
          <>
            <button className={buttonSecondary} onClick={() => setEditOpen(false)}>Cancel</button>
            <button className={buttonPrimary} onClick={handleEdit} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        }
      >
        {formErr && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {formErr}
          </div>
        )}
        <FormField label="Username">
          <input
            type="text"
            className={inputClass}
            value={editForm.username}
            onChange={e => setEditForm(f => ({ ...f, username: e.target.value }))}
          />
        </FormField>
        <FormField label="Role">
          <select
            className={inputClass}
            value={editForm.role}
            onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
          >
            <option value="supervisor">Supervisor</option>
            <option value="admin">Admin</option>
          </select>
        </FormField>
      </Modal>

      {/* ── Reset password modal ──────────────────────────────────────────── */}
      <Modal
        open={resetOpen}
        title={`Reset Password — ${selected?.username}`}
        onClose={() => setResetOpen(false)}
        footer={
          <>
            <button className={buttonSecondary} onClick={() => setResetOpen(false)}>Cancel</button>
            <button className={buttonPrimary} onClick={handleReset} disabled={saving}>
              {saving ? 'Resetting…' : 'Reset Password'}
            </button>
          </>
        }
      >
        {formErr && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {formErr}
          </div>
        )}
        <FormField label="New Password" hint="Minimum 6 characters">
          <input
            type="password"
            className={inputClass}
            placeholder="••••••••"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
          />
        </FormField>
      </Modal>

      {/* ── Delete confirmation modal ─────────────────────────────────────── */}
      <Modal
        open={deleteOpen}
        title="Delete User"
        onClose={() => setDeleteOpen(false)}
        footer={
          <>
            <button className={buttonSecondary} onClick={() => setDeleteOpen(false)}>Cancel</button>
            <button className={buttonDanger} onClick={handleDelete} disabled={saving}>
              {saving ? 'Deleting…' : 'Delete User'}
            </button>
          </>
        }
      >
        <p className="text-sm text-gray-700 dark:text-ink-dim">
          Are you sure you want to delete{' '}
          <span className="font-semibold text-gray-900 dark:text-ink capitalize">{selected?.username}</span>?
          This action cannot be undone.
        </p>
      </Modal>

      {/* ── Permissions modal (supervisor only) ──────────────────────────── */}
      <Modal
        open={permsOpen}
        title={`Permissions — ${selected?.username}`}
        onClose={() => setPermsOpen(false)}
        footer={
          <>
            <button className={buttonSecondary} onClick={() => setPermsOpen(false)}>Cancel</button>
            <button className={buttonPrimary} onClick={handlePerms} disabled={saving}>
              {saving ? 'Saving…' : 'Save Permissions'}
            </button>
          </>
        }
      >
        {formErr && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {formErr}
          </div>
        )}
        <p className="text-xs text-gray-500 dark:text-ink-faint mb-4">
          Grant or revoke feature access for this supervisor account.
          Changes take effect on their next login.
        </p>
        <div className="space-y-5">
          {/* Group permissions by their group label */}
          {[...new Set(ALL_PERMISSIONS.map(p => p.group))].map(group => (
            <div key={group}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400
                dark:text-ink-faint mb-2">{group}</p>
              <div className="space-y-2">
                {ALL_PERMISSIONS.filter(p => p.group === group).map(({ key, label, description }) => (
                  <label
                    key={key}
                    className="flex items-start gap-3 p-3 rounded-lg border border-gray-200
                      dark:border-panel-border cursor-pointer hover:bg-gray-50
                      dark:hover:bg-panel-raised/50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600
                        focus:ring-blue-500/30 focus:ring-2 cursor-pointer"
                      checked={permsForm.includes(key)}
                      onChange={() => togglePerm(key)}
                    />
                    <div>
                      <p className="text-sm font-semibold text-gray-800 dark:text-ink">{label}</p>
                      <p className="text-xs text-gray-500 dark:text-ink-faint mt-0.5">{description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
