import { useState, useEffect, useCallback } from 'react';
import { Coffee, Plus, Pencil, Power, Loader2, AlertTriangle } from 'lucide-react';
import { BreakCodes } from '../api/client.js';
import Modal from '../components/Modal.jsx';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { FormField, inputClass, buttonPrimary, buttonSecondary, buttonDanger } from '../components/form.jsx';

const EMPTY_FORM = {
  code: '', name: '', description: '', display_order: 0,
  color: '', icon: '', agent_selectable: true,
  warn_threshold_seconds: '', max_duration_seconds: '', active: true,
};

// Convert minutes (UI) ↔ seconds (API). Empty stays empty (=> null).
const minToSec = (m) => (m === '' || m == null ? null : Math.round(Number(m) * 60));
const secToMin = (s) => (s == null ? '' : Math.round(Number(s) / 60));

export default function BreakCodesPage() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [notice, setNotice]   = useState(null);

  const [formOpen, setFormOpen]   = useState(false);
  const [editing, setEditing]     = useState(null);   // row or null (=create)
  const [form, setForm]           = useState(EMPTY_FORM);
  const [formErr, setFormErr]     = useState(null);
  const [saving, setSaving]       = useState(false);

  const [confirm, setConfirm]     = useState(null);    // row pending (de)activation
  const [confirmBusy, setConfirmBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await BreakCodes.list()); }
    catch (e) { setError(e.response?.data?.error || e.message || 'Failed to load break codes'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditing(null); setForm(EMPTY_FORM); setFormErr(null); setFormOpen(true);
  }
  function openEdit(row) {
    setEditing(row);
    setForm({
      code: row.code, name: row.name, description: row.description || '',
      display_order: row.display_order ?? 0, color: row.color || '', icon: row.icon || '',
      agent_selectable: !!row.agent_selectable,
      warn_threshold_seconds: secToMin(row.warn_threshold_seconds),
      max_duration_seconds: secToMin(row.max_duration_seconds),
      active: !!row.active,
    });
    setFormErr(null); setFormOpen(true);
  }

  function validate(f) {
    if (!editing && !/^[A-Za-z0-9_]{2,64}$/.test(f.code.trim()))
      return 'Code must be 2–64 characters: letters, digits, underscore.';
    if (!f.name.trim()) return 'Name is required.';
    const warn = minToSec(f.warn_threshold_seconds);
    const max  = minToSec(f.max_duration_seconds);
    if (warn != null && max != null && warn > max)
      return 'Warning threshold must be ≤ maximum duration.';
    return null;
  }

  async function submit(e) {
    e.preventDefault();
    const v = validate(form);
    if (v) { setFormErr(v); return; }
    setSaving(true); setFormErr(null);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      display_order: Number(form.display_order) || 0,
      color: form.color.trim() || null,
      icon: form.icon.trim() || null,
      agent_selectable: form.agent_selectable,
      warn_threshold_seconds: minToSec(form.warn_threshold_seconds),
      max_duration_seconds: minToSec(form.max_duration_seconds),
      active: form.active,
    };
    try {
      if (editing) {
        await BreakCodes.update(editing.id, payload);
        setNotice(`Updated "${form.name.trim()}".`);
      } else {
        await BreakCodes.create({ ...payload, code: form.code.trim().toUpperCase() });
        setNotice(`Created "${form.name.trim()}".`);
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      setFormErr(e.response?.data?.error || e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function applyStatus() {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await BreakCodes.setStatus(confirm.id, !confirm.active);
      setNotice(`${confirm.active ? 'Deactivated' : 'Activated'} "${confirm.name}".`);
      setConfirm(null);
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Status change failed');
    } finally {
      setConfirmBusy(false);
    }
  }

  const fmtMin = (s) => (s == null ? '—' : `${Math.round(s / 60)} min`);

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-lg text-gray-900 dark:text-ink flex items-center gap-2">
            <Coffee size={20} className="text-brand dark:text-brand-light" /> Break Codes
          </h1>
          <p className="text-xs text-gray-500 dark:text-ink-faint mt-0.5">
            Configure the break reasons agents can select. Deactivating preserves historical records.
          </p>
        </div>
        <button className={buttonPrimary} onClick={openCreate}>
          <Plus size={15} /> Add Break
        </button>
      </div>

      {notice && (
        <div className="mb-4 rounded-lg border border-lamp-available/30 bg-lamp-available/10 px-3 py-2
                        text-sm text-lamp-available flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-lamp-available/70 hover:text-lamp-available text-xs">Dismiss</button>
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-lamp-alert/30 bg-lamp-alert/10 px-3 py-2
                        text-sm text-lamp-alert flex items-center justify-between">
          <span>{error}</span>
          <button onClick={load} className="text-lamp-alert/70 hover:text-lamp-alert text-xs">Retry</button>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-panel-border bg-white dark:bg-panel-surface overflow-hidden">
        {loading ? (
          <div className="p-5"><LoadingState rows={4} cols={5} label="Loading break codes…" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Coffee} title="No break codes yet"
            body="Create your first break reason so agents can select it."
            action={<button className={buttonPrimary} onClick={openCreate}><Plus size={15} /> Add Break</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 dark:text-ink-faint
                               border-b border-gray-100 dark:border-panel-border">
                  <th className="px-4 py-3 font-semibold">Code</th>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Active</th>
                  <th className="px-4 py-3 font-semibold">Selectable</th>
                  <th className="px-4 py-3 font-semibold">Order</th>
                  <th className="px-4 py-3 font-semibold">Warning</th>
                  <th className="px-4 py-3 font-semibold">Maximum</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 dark:border-panel-border/40
                                            hover:bg-gray-50 dark:hover:bg-panel-raised/50">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full border border-gray-200 dark:border-panel-border shrink-0"
                              style={r.color ? { backgroundColor: r.color } : undefined} aria-hidden="true" />
                        <code className="text-xs text-gray-700 dark:text-ink-dim">{r.code}</code>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-800 dark:text-ink">{r.name}</td>
                    <td className="px-4 py-3">
                      {r.active
                        ? <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-lamp-available/10 text-lamp-available border border-lamp-available/20">Active</span>
                        : <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-gray-100 dark:bg-panel-raised text-gray-400 dark:text-ink-faint border border-gray-200 dark:border-panel-border">Inactive</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-ink-faint">{r.agent_selectable ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-ink-faint tabular-nums">{r.display_order}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-ink-faint">{fmtMin(r.warn_threshold_seconds)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-ink-faint">{fmtMin(r.max_duration_seconds)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => openEdit(r)} title="Edit"
                          className="p-1.5 rounded-lg text-gray-400 dark:text-ink-faint hover:text-brand dark:hover:text-brand-light hover:bg-gray-100 dark:hover:bg-panel-raised">
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => setConfirm(r)} title={r.active ? 'Deactivate' : 'Activate'}
                          className={`p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-panel-raised
                            ${r.active ? 'text-gray-400 dark:text-ink-faint hover:text-lamp-alert' : 'text-gray-400 dark:text-ink-faint hover:text-lamp-available'}`}>
                          <Power size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      <Modal
        open={formOpen}
        title={editing ? `Edit "${editing.name}"` : 'Add Break Code'}
        onClose={() => !saving && setFormOpen(false)}
        footer={
          <>
            <button className={buttonSecondary} onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button>
            <button className={buttonPrimary} onClick={submit} disabled={saving} form="break-form">
              {saving ? <Loader2 size={15} className="animate-spin" /> : null} Save
            </button>
          </>
        }
      >
        <form id="break-form" onSubmit={submit}>
          {formErr && (
            <div className="mb-3 rounded-lg border border-lamp-alert/30 bg-lamp-alert/10 px-3 py-2 text-xs text-lamp-alert">
              {formErr}
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-4">
            <FormField label="Code" required>
              <input className={inputClass} value={form.code} disabled={!!editing}
                onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                placeholder="FIELD_VISIT" />
            </FormField>
            <FormField label="Display name" required>
              <input className={inputClass} value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Field Visit" />
            </FormField>
          </div>
          <FormField label="Description">
            <input className={inputClass} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Agent working outside the office" />
          </FormField>
          <div className="grid grid-cols-3 gap-x-4">
            <FormField label="Display order">
              <input type="number" min="0" className={inputClass} value={form.display_order}
                onChange={e => setForm(f => ({ ...f, display_order: e.target.value }))} />
            </FormField>
            <FormField label="Warning (min)" hint="Optional">
              <input type="number" min="0" className={inputClass} value={form.warn_threshold_seconds}
                onChange={e => setForm(f => ({ ...f, warn_threshold_seconds: e.target.value }))} />
            </FormField>
            <FormField label="Maximum (min)" hint="Optional">
              <input type="number" min="0" className={inputClass} value={form.max_duration_seconds}
                onChange={e => setForm(f => ({ ...f, max_duration_seconds: e.target.value }))} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-x-4">
            <FormField label="Color" hint="Hex, e.g. #3B82F6">
              <input className={inputClass} value={form.color}
                onChange={e => setForm(f => ({ ...f, color: e.target.value }))} placeholder="#3B82F6" />
            </FormField>
            <FormField label="Icon" hint="Optional name">
              <input className={inputClass} value={form.icon}
                onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} />
            </FormField>
          </div>
          <div className="flex items-center gap-6 mt-1">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-ink-dim">
              <input type="checkbox" checked={form.agent_selectable}
                onChange={e => setForm(f => ({ ...f, agent_selectable: e.target.checked }))} />
              Agent selectable
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-ink-dim">
              <input type="checkbox" checked={form.active}
                onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
              Active
            </label>
          </div>
        </form>
      </Modal>

      {/* Activate / deactivate confirmation */}
      <Modal
        open={!!confirm}
        title={confirm?.active ? `Deactivate "${confirm?.name}"?` : `Activate "${confirm?.name}"?`}
        onClose={() => !confirmBusy && setConfirm(null)}
        footer={
          <>
            <button className={buttonSecondary} onClick={() => setConfirm(null)} disabled={confirmBusy}>Cancel</button>
            <button className={confirm?.active ? buttonDanger : buttonPrimary} onClick={applyStatus} disabled={confirmBusy}>
              {confirmBusy ? <Loader2 size={15} className="animate-spin" /> : null}
              {confirm?.active ? 'Deactivate' : 'Activate'}
            </button>
          </>
        }
      >
        {confirm?.active ? (
          <div className="flex items-start gap-3 text-sm text-gray-600 dark:text-ink-dim">
            <AlertTriangle size={18} className="text-lamp-alert shrink-0 mt-0.5" />
            <p>Agents will no longer be able to select this break.
               Existing historical records remain unchanged.</p>
          </div>
        ) : (
          <p className="text-sm text-gray-600 dark:text-ink-dim">
            Agents will be able to select this break again.
          </p>
        )}
      </Modal>
    </div>
  );
}
