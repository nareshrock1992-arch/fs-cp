import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Search, KeyRound, Users, CheckCircle2, XCircle } from 'lucide-react';
import { Agents as AgentsApi } from '../api/client.js';
import { useAuth } from '../hooks/useAuth.js';
import { useSocketEvent } from '../api/socket.js';
import Panel from '../components/Panel.jsx';
import Modal from '../components/Modal.jsx';
import StatusLamp from '../components/StatusLamp.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { FormField, inputClass, buttonPrimary, buttonSecondary } from '../components/form.jsx';

const EMPTY_FORM = {
  agentId: '', fullName: '', avayaExtension: '',
  // Structured contact fields — backend builds the full contact string server-side.
  // agentType: 'internal' → extension field shown; 'gateway' → gateway + destination shown.
  agentType: 'internal', extension: '', gateway: '', destination: '',
  maxNoAnswer: 3, wrapUpTime: 20, rejectDelayTime: 2, busyDelayTime: 60
};

const STATUS_OPTIONS = ['Available', 'On Break', 'Logged Out'];

const STATUS_SELECT = {
  'Available':  { dot: 'bg-lamp-available', cls: 'border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-lamp-available' },
  'On Break':   { dot: 'bg-lamp-live',      cls: 'border-amber-300  dark:border-amber-500/40  text-amber-700  dark:text-lamp-live'      },
  'Logged Out': { dot: 'bg-lamp-alert',     cls: 'border-red-300    dark:border-red-500/40    text-red-600    dark:text-lamp-alert'     },
};

export default function Agents() {
  const { user } = useAuth();
  const isAdmin        = user?.role === 'admin';
  const canChangeState = isAdmin || (Array.isArray(user?.permissions) && user.permissions.includes('change_agent_state'));

  const [agents,  setAgents]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [search,  setSearch]  = useState('');

  // ── Agent create/edit modal ─────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form,      setForm]      = useState(EMPTY_FORM);
  const [saving,    setSaving]    = useState(false);
  const [formError, setFormError] = useState(null);

  // ── PIN modal ───────────────────────────────────────────────────────────────
  const [pinModal,     setPinModal]     = useState(false);
  const [pinAgentId,   setPinAgentId]   = useState(null);
  const [pinAgentName, setPinAgentName] = useState('');
  const [pinValue,     setPinValue]     = useState('');
  const [pinConfirm,   setPinConfirm]   = useState('');
  const [pinSaving,    setPinSaving]    = useState(false);
  const [pinError,     setPinError]     = useState(null);
  const [pinSuccess,   setPinSuccess]   = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await AgentsApi.list();
      setAgents(rows);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Null-safe optimistic update — preserves existing status/state when event carries null
  const onAgentEvent = useCallback(({ agentId, status, state }) => {
    setAgents((prev) =>
      prev.map((a) =>
        a.agent_id === agentId
          ? { ...a, status: status ?? a.status, state: state ?? a.state }
          : a
      )
    );
  }, []);
  useSocketEvent('agent:state',  onAgentEvent);
  useSocketEvent('agent:status', onAgentEvent);
  useSocketEvent('agent:update', load);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        a.full_name.toLowerCase().includes(q) ||
        a.agent_id.toLowerCase().includes(q) ||
        String(a.avaya_extension).includes(q)
    );
  }, [agents, search]);

  // ── Create / Edit ───────────────────────────────────────────────────────────

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(agent) {
    setEditingId(agent.agent_id);
    // Reconstruct structured fields from the stored contact string for display.
    // The backend always stores the canonical form: {sip_cid_type=pid}<endpoint>
    const contact = agent.contact || '';
    const endpoint = contact.replace(/^(\{[^}]*\})+/, ''); // strip prefix blocks
    const isInternal = endpoint.startsWith('user/');
    const isGateway  = endpoint.startsWith('sofia/gateway/');

    let extension   = '';
    let gateway     = '';
    let destination = '';
    if (isInternal) {
      // user/<ext>@<domain> → extract <ext>
      extension = endpoint.replace(/^user\//, '').replace(/@.*$/, '');
    } else if (isGateway) {
      // sofia/gateway/<gw>/<dest> → extract parts
      const parts = endpoint.replace('sofia/gateway/', '').split('/');
      gateway     = parts[0] || '';
      destination = parts[1] || '';
    }

    setForm({
      agentId:         agent.agent_id,
      fullName:        agent.full_name,
      avayaExtension:  agent.avaya_extension,
      agentType:       agent.agent_type || (isGateway ? 'gateway' : 'internal'),
      extension,
      gateway,
      destination,
      maxNoAnswer:     agent.max_no_answer,
      wrapUpTime:      agent.wrap_up_time,
      rejectDelayTime: agent.reject_delay_time,
      busyDelayTime:   agent.busy_delay_time,
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        await AgentsApi.update(editingId, form);
      } else {
        await AgentsApi.create(form);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(agentId) {
    if (!window.confirm(`Remove agent ${agentId}? This also removes it from FreeSWITCH.`)) return;
    await AgentsApi.remove(agentId);
    await load();
  }

  async function handleStatusChange(agentId, status) {
    setAgents((prev) => prev.map((a) => (a.agent_id === agentId ? { ...a, status } : a)));
    try {
      await AgentsApi.setStatus(agentId, status);
    } catch {
      load();
    }
  }

  // ── PIN management ──────────────────────────────────────────────────────────

  function openPinModal(agent) {
    setPinAgentId(agent.agent_id);
    setPinAgentName(agent.full_name);
    setPinValue('');
    setPinConfirm('');
    setPinError(null);
    setPinSuccess(false);
    setPinModal(true);
  }

  async function handleSetPin(e) {
    e.preventDefault();
    setPinError(null);
    setPinSuccess(false);

    if (pinValue.length < 4) {
      setPinError('PIN must be at least 4 characters');
      return;
    }
    if (pinValue !== pinConfirm) {
      setPinError('PINs do not match');
      return;
    }

    setPinSaving(true);
    try {
      await AgentsApi.setPin(pinAgentId, pinValue);
      setPinSuccess(true);
      setPinValue('');
      setPinConfirm('');
      setTimeout(() => setPinModal(false), 1500);
    } catch (err) {
      setPinError(err.response?.data?.error || err.message);
    } finally {
      setPinSaving(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const availableCount = agents.filter(a => a.status === 'Available').length;
  const breakCount     = agents.filter(a => a.status === 'On Break').length;
  const outCount       = agents.filter(a => a.status === 'Logged Out').length;

  return (
    <div className="space-y-4">

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-ink-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, ID or extension…"
              className="field-input pl-9 w-64"
            />
          </div>
          {/* Status summary chips */}
          {!loading && agents.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-lamp-available font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-lamp-available" />
                {availableCount}
              </span>
              <span className="text-gray-300 dark:text-panel-border">·</span>
              <span className="flex items-center gap-1 text-blue-600 dark:text-lamp-break font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-lamp-break" />
                {breakCount}
              </span>
              <span className="text-gray-300 dark:text-panel-border">·</span>
              <span className="flex items-center gap-1 text-gray-500 dark:text-ink-faint font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-lamp-loggedout" />
                {outCount}
              </span>
            </div>
          )}
        </div>
        {isAdmin && (
          <button onClick={openCreate} className="btn-primary">
            <Plus size={15} /> Add Agent
          </button>
        )}
      </div>

      {/* Agents table */}
      <Panel noPad>
        {loading && (
          <div className="p-8 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex gap-4 items-center">
                <div className="skeleton h-9 w-9 rounded-xl" />
                <div className="skeleton h-4 flex-1 rounded max-w-[200px]" />
                <div className="skeleton h-4 w-20 rounded" />
                <div className="skeleton h-6 w-24 rounded-full ml-auto" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="p-6">
            <p className="text-sm text-lamp-alert">{error}</p>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <EmptyState
            icon={Users}
            title={agents.length === 0 ? 'No agents yet' : 'No agents match your search'}
            body={agents.length === 0
              ? 'Agents sync from FreeSWITCH automatically when the backend starts, or add one manually.'
              : 'Try adjusting your search term.'}
            action={agents.length === 0 && isAdmin
              ? <button onClick={openCreate} className="btn-primary"><Plus size={14} /> Add Agent</button>
              : undefined}
          />
        )}

        {!loading && !error && filtered.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-panel-border text-left">
                <th className="th rounded-tl-xl">Agent</th>
                <th className="th">Extension</th>
                <th className="th hidden md:table-cell">Contact</th>
                <th className="th">Status</th>
                <th className="th">PIN</th>
                {isAdmin && <th className="th text-right rounded-tr-xl">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.agent_id}
                    className="border-b border-gray-50 dark:border-panel-border/60 last:border-0
                               hover:bg-gray-50 dark:hover:bg-panel-raised/30 transition-colors align-middle">

                  {/* Agent name + ID */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-brand/10 dark:bg-brand/20 flex items-center justify-center shrink-0
                                      text-brand dark:text-brand-light text-xs font-bold">
                        {(a.full_name?.[0] || '?').toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-ink">{a.full_name}</p>
                        <p className="text-[11px] text-gray-400 dark:text-ink-faint font-mono">{a.agent_id}</p>
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3 font-mono tnum text-gray-500 dark:text-ink-dim">{a.avaya_extension}</td>

                  <td className="px-4 py-3 font-mono text-xs text-gray-400 dark:text-ink-faint truncate max-w-[200px] hidden md:table-cell">
                    {a.contact}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    {canChangeState ? (() => {
                      const sc = STATUS_SELECT[a.status] ?? STATUS_SELECT['Logged Out'];
                      return (
                        <div className="inline-flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full shrink-0 ${sc.dot}`} aria-hidden="true" />
                          <select
                            value={a.status || ''}
                            onChange={(e) => handleStatusChange(a.agent_id, e.target.value)}
                            className={`text-xs rounded-lg border px-2 py-1.5 bg-white dark:bg-panel-raised
                                        focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/60
                                        transition-colors cursor-pointer ${sc.cls}`}
                          >
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s} className="dark:bg-panel-surface bg-white text-gray-800 dark:text-ink">{s}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })() : (
                      <StatusLamp status={a.status} variant="badge" />
                    )}
                  </td>

                  {/* PIN */}
                  <td className="px-4 py-3">
                    {a.pin_hash ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold
                                       text-emerald-600 dark:text-lamp-available">
                        <CheckCircle2 size={12} /> Set
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold
                                       text-gray-400 dark:text-ink-faint">
                        <XCircle size={12} /> Not set
                      </span>
                    )}
                  </td>

                  {/* Actions */}
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openPinModal(a)}
                          title="Set Agent Desktop PIN"
                          aria-label="Set PIN"
                          className="p-1.5 rounded-lg text-gray-400 dark:text-ink-faint
                                     hover:text-blue-600 dark:hover:text-lamp-break
                                     hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
                        >
                          <KeyRound size={14} />
                        </button>
                        <button
                          onClick={() => openEdit(a)}
                          aria-label="Edit agent"
                          className="p-1.5 rounded-lg text-gray-400 dark:text-ink-faint
                                     hover:text-gray-700 dark:hover:text-ink
                                     hover:bg-gray-100 dark:hover:bg-panel-raised transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(a.agent_id)}
                          aria-label="Delete agent"
                          className="p-1.5 rounded-lg text-gray-400 dark:text-ink-faint
                                     hover:text-lamp-alert hover:bg-lamp-alert/10 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {/* ── Create / Edit Modal ──────────────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? `Edit Agent — ${editingId}` : 'Add New Agent'}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn-primary" form="agent-form" type="submit" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Agent'}
            </button>
          </>
        }
      >
        <form id="agent-form" onSubmit={handleSave}>
          {formError && (
            <div className="mb-4 p-3 rounded-lg bg-lamp-alert/10 border border-lamp-alert/25">
              <p className="text-sm text-lamp-alert">{formError}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-4">
            <FormField label="Agent ID" hint="FreeSWITCH agent name, e.g. Agent_1001@default">
              <input
                required
                disabled={Boolean(editingId)}
                value={form.agentId}
                onChange={(e) => setForm({ ...form, agentId: e.target.value })}
                className={inputClass}
                placeholder="Agent_1001@default"
              />
            </FormField>
            <FormField label="Full Name">
              <input
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                className={inputClass}
                placeholder="Jane Doe"
              />
            </FormField>
            <FormField label="Avaya Extension">
              <input
                required
                value={form.avayaExtension}
                onChange={(e) => setForm({ ...form, avayaExtension: e.target.value })}
                className={inputClass}
                placeholder="5001"
              />
            </FormField>
            <FormField label="Endpoint Type" hint="How FreeSWITCH dials this agent">
              <select
                value={form.agentType}
                onChange={(e) => setForm({ ...form, agentType: e.target.value, extension: '', gateway: '', destination: '' })}
                className={inputClass}
              >
                <option value="internal">Internal (SIP extension)</option>
                <option value="gateway">Gateway (SIP trunk)</option>
              </select>
            </FormField>
            {form.agentType === 'internal' && (
              <FormField label="Extension" hint="SIP extension number (e.g. 1002). Domain is set by server config.">
                <input
                  required
                  type="tel"
                  value={form.extension}
                  onChange={(e) => setForm({ ...form, extension: e.target.value })}
                  className={inputClass}
                  placeholder="1002"
                />
              </FormField>
            )}
            {form.agentType === 'gateway' && (
              <>
                <FormField label="Gateway Name" hint="FreeSWITCH gateway name (e.g. service-provider)">
                  <input
                    required
                    value={form.gateway}
                    onChange={(e) => setForm({ ...form, gateway: e.target.value })}
                    className={inputClass}
                    placeholder="service-provider"
                  />
                </FormField>
                <FormField label="Destination" hint="E.164 number or extension routed via the gateway">
                  <input
                    required
                    value={form.destination}
                    onChange={(e) => setForm({ ...form, destination: e.target.value })}
                    className={inputClass}
                    placeholder="0507221769"
                  />
                </FormField>
              </>
            )}
            <FormField label="Max No Answer">
              <input type="number" min="0" value={form.maxNoAnswer}
                onChange={(e) => setForm({ ...form, maxNoAnswer: Number(e.target.value) })}
                className={inputClass} />
            </FormField>
            <FormField label="Wrap-up Time (sec)">
              <input type="number" min="0" value={form.wrapUpTime}
                onChange={(e) => setForm({ ...form, wrapUpTime: Number(e.target.value) })}
                className={inputClass} />
            </FormField>
            <FormField label="Reject Delay (sec)">
              <input type="number" min="0" value={form.rejectDelayTime}
                onChange={(e) => setForm({ ...form, rejectDelayTime: Number(e.target.value) })}
                className={inputClass} />
            </FormField>
            <FormField label="Busy Delay (sec)">
              <input type="number" min="0" value={form.busyDelayTime}
                onChange={(e) => setForm({ ...form, busyDelayTime: Number(e.target.value) })}
                className={inputClass} />
            </FormField>
          </div>
        </form>
      </Modal>

      {/* ── Set PIN Modal ────────────────────────────────────────────────────── */}
      <Modal
        open={pinModal}
        onClose={() => setPinModal(false)}
        title={`Set Agent Desktop PIN`}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setPinModal(false)}>Cancel</button>
            <button className="btn-primary" form="pin-form" type="submit" disabled={pinSaving}>
              {pinSaving ? 'Saving…' : 'Set PIN'}
            </button>
          </>
        }
      >
        <form id="pin-form" onSubmit={handleSetPin} className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-ink-dim">
            Set a PIN for <strong className="text-gray-800 dark:text-ink">{pinAgentName}</strong>{' '}
            (<code className="text-xs bg-gray-100 dark:bg-panel-raised px-1 rounded font-mono">{pinAgentId}</code>)
            to log in to the Agent Desktop.
          </p>
          {pinError && (
            <div className="p-3 rounded-lg bg-lamp-alert/10 border border-lamp-alert/25">
              <p className="text-sm text-lamp-alert">{pinError}</p>
            </div>
          )}
          {pinSuccess && (
            <div className="p-3 rounded-lg bg-lamp-available/10 border border-lamp-available/25">
              <p className="text-sm text-lamp-available">✓ PIN updated successfully</p>
            </div>
          )}
          <FormField label="New PIN" hint="Minimum 4 characters — digits or letters">
            <input
              type="password"
              value={pinValue}
              onChange={(e) => setPinValue(e.target.value)}
              required minLength={4} autoFocus
              className={inputClass}
              placeholder="••••"
              inputMode="numeric"
            />
          </FormField>
          <FormField label="Confirm PIN">
            <input
              type="password"
              value={pinConfirm}
              onChange={(e) => setPinConfirm(e.target.value)}
              required minLength={4}
              className={inputClass}
              placeholder="••••"
              inputMode="numeric"
            />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
