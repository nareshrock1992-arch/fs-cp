import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Search, KeyRound } from 'lucide-react';
import { Agents as AgentsApi } from '../api/client.js';
import { useSocketEvent } from '../api/socket.js';
import Panel from '../components/Panel.jsx';
import Modal from '../components/Modal.jsx';
import StatusLamp from '../components/StatusLamp.jsx';
import { FormField, inputClass, buttonPrimary, buttonSecondary } from '../components/form.jsx';

const EMPTY_FORM = {
  agentId: '', fullName: '', avayaExtension: '', contact: '',
  maxNoAnswer: 3, wrapUpTime: 20, rejectDelayTime: 2, busyDelayTime: 60
};

const STATUS_OPTIONS = ['Available', 'On Break', 'Logged Out'];

export default function Agents() {
  const [agents, setAgents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [search, setSearch]   = useState('');

  // ── Agent create/edit modal ─────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState(null);

  // ── PIN modal ───────────────────────────────────────────────────────────────
  const [pinModal, setPinModal]     = useState(false);
  const [pinAgentId, setPinAgentId] = useState(null);
  const [pinAgentName, setPinAgentName] = useState('');
  const [pinValue, setPinValue]     = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinSaving, setPinSaving]   = useState(false);
  const [pinError, setPinError]     = useState(null);
  const [pinSuccess, setPinSuccess] = useState(false);

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
    setForm({
      agentId:         agent.agent_id,
      fullName:        agent.full_name,
      avayaExtension:  agent.avaya_extension,
      contact:         agent.contact,
      maxNoAnswer:     agent.max_no_answer,
      wrapUpTime:      agent.wrap_up_time,
      rejectDelayTime: agent.reject_delay_time,
      busyDelayTime:   agent.busy_delay_time
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
      // Auto-close after 1.5s
      setTimeout(() => setPinModal(false), 1500);
    } catch (err) {
      setPinError(err.response?.data?.error || err.message);
    } finally {
      setPinSaving(false);
    }
  }

  const thClass = 'pb-2.5 font-display font-medium dark:text-ink-faint text-gray-400 text-[11px] uppercase tracking-widest';
  const tdBase  = 'py-3';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-full max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 dark:text-ink-faint text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, ID or extension"
            className={`${inputClass} pl-9`}
          />
        </div>
        <button onClick={openCreate} className={buttonPrimary}>
          <Plus size={15} /> Add Agent
        </button>
      </div>

      <Panel>
        {loading && <p className="text-sm dark:text-ink-dim text-gray-500">Loading agents…</p>}
        {error   && <p className="text-sm text-lamp-alert">{error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <p className="text-sm dark:text-ink-dim text-gray-500">
            {agents.length === 0
              ? 'No agents yet — start the backend so it can sync from FreeSWITCH, or click Add Agent.'
              : 'No agents match your search.'}
          </p>
        )}
        {!loading && !error && filtered.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b dark:border-panel-border border-gray-100">
                <th className={thClass}>Agent</th>
                <th className={thClass}>Avaya Ext</th>
                <th className={thClass}>Contact</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>PIN</th>
                <th className={`${thClass} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.agent_id}
                    className="border-b dark:border-panel-border/60 border-gray-50 last:border-0 align-middle">
                  <td className={tdBase}>
                    <p className="font-medium dark:text-ink text-gray-800">{a.full_name}</p>
                    <p className="text-[11px] dark:text-ink-faint text-gray-400 font-mono">{a.agent_id}</p>
                  </td>
                  <td className={`${tdBase} font-mono tnum dark:text-ink-dim text-gray-500`}>{a.avaya_extension}</td>
                  <td className={`${tdBase} font-mono text-xs dark:text-ink-dim text-gray-500 truncate max-w-[220px]`}>{a.contact}</td>
                  <td className={tdBase}>
                    <div className="flex items-center gap-2">
                      <StatusLamp status={a.status} />
                      <select
                        value={a.status || ''}
                        onChange={(e) => handleStatusChange(a.agent_id, e.target.value)}
                        className="bg-transparent text-xs dark:text-ink-faint text-gray-500
                                   border dark:border-panel-border border-gray-200 rounded-sm
                                   px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-lamp-live/50
                                   dark:bg-transparent"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s} className="dark:bg-panel-surface bg-white">{s}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className={tdBase}>
                    {/* PIN status indicator — does not reveal the hash */}
                    <span className="text-[11px] dark:text-ink-faint text-gray-400">
                      {a.pin_hash ? (
                        <span className="text-lamp-available">● Set</span>
                      ) : (
                        <span className="text-lamp-alert">● Not set</span>
                      )}
                    </span>
                  </td>
                  <td className={tdBase}>
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => openPinModal(a)}
                        title="Set Agent Desktop PIN"
                        className="p-1.5 rounded-sm dark:text-ink-dim text-gray-400
                                   hover:text-blue-500 hover:bg-blue-500/10 transition-colors"
                        aria-label="Set PIN"
                      >
                        <KeyRound size={14} />
                      </button>
                      <button
                        onClick={() => openEdit(a)}
                        className="p-1.5 rounded-sm dark:text-ink-dim text-gray-400
                                   hover:text-gray-800 dark:hover:text-ink hover:bg-gray-100
                                   dark:hover:bg-panel-raised transition-colors"
                        aria-label="Edit agent"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(a.agent_id)}
                        className="p-1.5 rounded-sm dark:text-ink-dim text-gray-400
                                   hover:text-lamp-alert hover:bg-lamp-alert/10 transition-colors"
                        aria-label="Delete agent"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
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
        title={editingId ? `Edit ${editingId}` : 'Add Agent'}
        footer={
          <>
            <button className={buttonSecondary} onClick={() => setModalOpen(false)}>Cancel</button>
            <button className={buttonPrimary} form="agent-form" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save Agent'}
            </button>
          </>
        }
      >
        <form id="agent-form" onSubmit={handleSave}>
          {formError && <p className="text-sm text-lamp-alert mb-4">{formError}</p>}
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
            <FormField label="Contact (SIP dial string)">
              <input
                required
                value={form.contact}
                onChange={(e) => setForm({ ...form, contact: e.target.value })}
                className={inputClass}
                placeholder="sofia/gateway/avaya_gw/5001"
              />
            </FormField>
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
        title={`Set Agent Desktop PIN — ${pinAgentName}`}
        footer={
          <>
            <button className={buttonSecondary} onClick={() => setPinModal(false)}>Cancel</button>
            <button className={buttonPrimary} form="pin-form" type="submit" disabled={pinSaving}>
              {pinSaving ? 'Saving…' : 'Set PIN'}
            </button>
          </>
        }
      >
        <form id="pin-form" onSubmit={handleSetPin} className="space-y-4">
          <p className="text-sm dark:text-ink-dim text-gray-500">
            Set a PIN for <strong className="dark:text-ink text-gray-800">{pinAgentId}</strong> to log in
            to the Agent Desktop at{' '}
            <code className="text-xs bg-gray-100 dark:bg-panel-raised px-1 rounded">:8080</code>.
          </p>
          {pinError   && <p className="text-sm text-lamp-alert">{pinError}</p>}
          {pinSuccess  && <p className="text-sm text-lamp-available">✓ PIN updated successfully</p>}
          <FormField label="New PIN" hint="Minimum 4 characters — can be digits or letters">
            <input
              id="pin-value"
              type="password"
              value={pinValue}
              onChange={(e) => setPinValue(e.target.value)}
              required
              minLength={4}
              autoFocus
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
              required
              minLength={4}
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
