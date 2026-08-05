import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Users2, X } from 'lucide-react';
import { Queues as QueuesApi, Agents as AgentsApi } from '../api/client.js';
import Panel from '../components/Panel.jsx';
import Modal from '../components/Modal.jsx';
import StatusLamp from '../components/StatusLamp.jsx';
import { FormField, inputClass, buttonPrimary, buttonSecondary } from '../components/form.jsx';

const STRATEGIES = [
  { value: 'longest-idle-agent',          label: 'Longest Idle Agent' },
  { value: 'agent-with-least-talk-time',  label: 'Least Talk Time' },
  { value: 'round-robin',                 label: 'Round Robin' },
  { value: 'top-down',                    label: 'Top Down (by tier)' },
  { value: 'ring-all',                    label: 'Ring All' }
];

const EMPTY_FORM = { name: '', displayName: '', strategy: 'longest-idle-agent', maxWaitTime: 300, maxQueueSize: 50 };

export default function Queues() {
  const [queues, setQueues]       = useState([]);
  const [allAgents, setAllAgents] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingName, setEditingName] = useState(null);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState(null);

  const [tierQueue, setTierQueue]         = useState(null);
  const [tierAgentToAdd, setTierAgentToAdd] = useState('');

  const load = useCallback(async () => {
    try {
      const [q, a] = await Promise.all([QueuesApi.list(), AgentsApi.list()]);
      setQueues(q);
      setAllAgents(a);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditingName(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(q) {
    setEditingName(q.name);
    setForm({ name: q.name, displayName: q.display_name, strategy: q.strategy,
              maxWaitTime: q.max_wait_time, maxQueueSize: q.max_queue_size });
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (editingName) {
        await QueuesApi.update(editingName, form);
      } else {
        await QueuesApi.create(form);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(name) {
    if (!window.confirm(`Delete queue "${name}"? Agents will be unassigned.`)) return;
    await QueuesApi.remove(name);
    await load();
  }

  async function openTiers(queueName) {
    const detail = await QueuesApi.get(queueName);
    setTierQueue(detail);
    setTierAgentToAdd('');
  }

  async function handleAddTier() {
    if (!tierAgentToAdd) return;
    await QueuesApi.addTier(tierQueue.name, { agentId: tierAgentToAdd, level: 1, position: 1 });
    const refreshed = await QueuesApi.get(tierQueue.name);
    setTierQueue(refreshed);
    setTierAgentToAdd('');
    load();
  }

  async function handleRemoveTier(agentId) {
    await QueuesApi.removeTier(tierQueue.name, agentId);
    const refreshed = await QueuesApi.get(tierQueue.name);
    setTierQueue(refreshed);
    load();
  }

  const availableToAdd = tierQueue
    ? allAgents.filter((a) => !tierQueue.agents.some((t) => t.agent_id === a.agent_id))
    : [];

  const thClass = 'pb-2.5 font-display font-medium dark:text-ink-faint text-gray-400 text-[11px] uppercase tracking-widest';

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={openCreate} className={buttonPrimary}>
          <Plus size={15} /> Add Queue
        </button>
      </div>

      <Panel>
        {loading && <p className="text-sm dark:text-ink-dim text-gray-500">Loading queues…</p>}
        {error   && <p className="text-sm text-lamp-alert">{error}</p>}
        {!loading && !error && queues.length === 0 && (
          <p className="text-sm dark:text-ink-dim text-gray-500">No queues configured yet.</p>
        )}
        {!loading && !error && queues.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className={`text-left border-b dark:border-panel-border border-gray-100`}>
                <th className={thClass}>Queue</th>
                <th className={thClass}>Strategy</th>
                <th className={thClass}>Max Wait</th>
                <th className={thClass}>Max Size</th>
                <th className={`${thClass} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {queues.map((q) => (
                <tr key={q.name} className="border-b dark:border-panel-border/60 border-gray-50 last:border-0">
                  <td className="py-3">
                    <p className="font-medium dark:text-ink text-gray-800">{q.display_name}</p>
                    <p className="text-[11px] dark:text-ink-faint text-gray-400 font-mono">{q.name}</p>
                  </td>
                  <td className="py-3 dark:text-ink-dim text-gray-500">
                    {STRATEGIES.find((s) => s.value === q.strategy)?.label || q.strategy}
                  </td>
                  <td className="py-3 font-mono tnum dark:text-ink-dim text-gray-500">{q.max_wait_time}s</td>
                  <td className="py-3 font-mono tnum dark:text-ink-dim text-gray-500">{q.max_queue_size}</td>
                  <td className="py-3">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => openTiers(q.name)}
                        className="p-1.5 rounded-sm dark:text-ink-dim text-gray-400 hover:text-gray-800 dark:hover:text-ink hover:bg-gray-100 dark:hover:bg-panel-raised transition-colors"
                        title="Manage agents">
                        <Users2 size={14} />
                      </button>
                      <button onClick={() => openEdit(q)}
                        className="p-1.5 rounded-sm dark:text-ink-dim text-gray-400 hover:text-gray-800 dark:hover:text-ink hover:bg-gray-100 dark:hover:bg-panel-raised transition-colors">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDelete(q.name)}
                        className="p-1.5 rounded-sm dark:text-ink-dim text-gray-400 hover:text-lamp-alert hover:bg-lamp-alert/10 transition-colors">
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

      {/* Create / edit queue modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingName ? `Edit ${editingName}` : 'Add Queue'}
        footer={
          <>
            <button className={buttonSecondary} onClick={() => setModalOpen(false)}>Cancel</button>
            <button className={buttonPrimary} form="queue-form" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save Queue'}
            </button>
          </>
        }
      >
        <form id="queue-form" onSubmit={handleSave}>
          {formError && <p className="text-sm text-lamp-alert mb-4">{formError}</p>}
          <FormField label="Queue Name" hint="FreeSWITCH queue identifier, e.g. support@default">
            <input required disabled={Boolean(editingName)} value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass} placeholder="support@default" />
          </FormField>
          <FormField label="Display Name">
            <input required value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              className={inputClass} placeholder="Support" />
          </FormField>
          <FormField label="Routing Strategy">
            <select value={form.strategy}
              onChange={(e) => setForm({ ...form, strategy: e.target.value })}
              className={inputClass}>
              {STRATEGIES.map((s) => (
                <option key={s.value} value={s.value} className="dark:bg-panel-surface bg-white">{s.label}</option>
              ))}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-x-4">
            <FormField label="Max Wait Time (sec)">
              <input type="number" min="0" value={form.maxWaitTime}
                onChange={(e) => setForm({ ...form, maxWaitTime: Number(e.target.value) })}
                className={inputClass} />
            </FormField>
            <FormField label="Max Queue Size">
              <input type="number" min="0" value={form.maxQueueSize}
                onChange={(e) => setForm({ ...form, maxQueueSize: Number(e.target.value) })}
                className={inputClass} />
            </FormField>
          </div>
        </form>
      </Modal>

      {/* Tier (agent assignment) modal */}
      <Modal
        open={Boolean(tierQueue)}
        onClose={() => setTierQueue(null)}
        title={tierQueue ? `Agents in ${tierQueue.display_name}` : ''}
      >
        {tierQueue && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <select value={tierAgentToAdd}
                onChange={(e) => setTierAgentToAdd(e.target.value)}
                className={inputClass}>
                <option value="">Select an agent to add…</option>
                {availableToAdd.map((a) => (
                  <option key={a.agent_id} value={a.agent_id} className="dark:bg-panel-surface bg-white">
                    {a.full_name} ({a.agent_id})
                  </option>
                ))}
              </select>
              <button className={buttonPrimary} onClick={handleAddTier} disabled={!tierAgentToAdd}>
                Add
              </button>
            </div>

            <div className="space-y-2">
              {tierQueue.agents.length === 0 && (
                <p className="text-sm dark:text-ink-dim text-gray-500">No agents assigned to this queue yet.</p>
              )}
              {tierQueue.agents.map((a) => (
                <div key={a.agent_id}
                  className="flex items-center justify-between rounded-sm border dark:border-panel-border border-gray-200 px-3 py-2">
                  <div className="flex items-center gap-3">
                    <StatusLamp status={a.status} showLabel={false} />
                    <div>
                      <p className="text-sm font-medium dark:text-ink text-gray-800">{a.full_name}</p>
                      <p className="text-[11px] dark:text-ink-faint text-gray-400 font-mono">
                        {a.agent_id} · tier {a.level}.{a.position}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => handleRemoveTier(a.agent_id)}
                    className="p-1 rounded-sm dark:text-ink-faint text-gray-400 hover:text-lamp-alert hover:bg-lamp-alert/10 transition-colors">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
