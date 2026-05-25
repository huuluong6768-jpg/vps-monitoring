'use client';

import useSWR from 'swr';
import { useState } from 'react';
import {
  FolderTree,
  Plus,
  Pencil,
  Trash2,
  Server,
  RefreshCw,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Group {
  _id: string;
  name: string;
  description?: string;
  color: string;
  agentIds: string[];
  createdAt: string;
}

interface AgentSummary {
  agentId: string;
  hostname: string;
  online: boolean;
}

export function GroupsClient() {
  const { data, isLoading, mutate } = useSWR<{ groups: Group[] }>('/api/groups', fetcher);
  const { data: agentsData } = useSWR<{ agents: AgentSummary[] }>('/api/agents', fetcher);
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', color: '#3b82f6' });
  const [saving, setSaving] = useState(false);

  const groups = data?.groups ?? [];
  const allAgents = agentsData?.agents ?? [];

  const createGroup = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success('Group created');
        setShowCreate(false);
        setForm({ name: '', description: '', color: '#3b82f6' });
        mutate();
      } else {
        toast.error(json.error || 'Failed');
      }
    } catch {
      toast.error('Failed to create group');
    } finally {
      setSaving(false);
    }
  };

  const deleteGroup = async (id: string) => {
    if (!confirm('Delete this group?')) return;
    await fetch(`/api/groups/${id}`, { method: 'DELETE' });
    toast.success('Group deleted');
    mutate();
  };

  const toggleAgent = async (groupId: string, agentId: string, inGroup: boolean) => {
    const body = inGroup
      ? { removeAgentIds: [agentId] }
      : { addAgentIds: [agentId] };

    await fetch(`/api/groups/${groupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Server Groups</h1>
          <p className="mt-1 text-sm text-ink-muted">Organize servers into logical groups</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          New Group
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="rounded-xl border border-border bg-bg-soft p-6">
          <h3 className="mb-4 text-lg font-semibold text-ink">Create Group</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Production Servers"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Main production servers"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Color</label>
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="h-[38px] w-full rounded-lg border border-border bg-bg px-1"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={createGroup}
              disabled={saving || !form.name}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
              Create
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-lg px-4 py-2 text-sm text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Groups */}
      {isLoading && (
        <div className="flex items-center gap-2 py-12 text-ink-muted">
          <RefreshCw className="h-5 w-5 animate-spin" />
          Loading...
        </div>
      )}

      {!isLoading && groups.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <FolderTree className="mx-auto mb-3 h-10 w-10 text-ink-soft" />
          <p className="text-ink-muted">No groups created yet</p>
        </div>
      )}

      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g._id} className="rounded-xl border border-border bg-bg-soft p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="h-4 w-4 rounded-full"
                  style={{ backgroundColor: g.color }}
                />
                <div>
                  <h3 className="font-semibold text-ink">{g.name}</h3>
                  {g.description && (
                    <p className="text-sm text-ink-muted">{g.description}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setEditId(editId === g._id ? null : g._id)}
                  className="rounded p-1.5 text-ink-soft hover:bg-bg-muted hover:text-ink"
                  title="Manage servers"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => deleteGroup(g._id)}
                  className="rounded p-1.5 text-ink-soft hover:bg-bg-muted hover:text-danger"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {g.agentIds.length === 0 ? (
                <span className="text-sm text-ink-soft">No servers in group</span>
              ) : (
                g.agentIds.map((aid) => {
                  const agent = allAgents.find((a) => a.agentId === aid);
                  return (
                    <span
                      key={aid}
                      className="inline-flex items-center gap-1.5 rounded-full bg-bg-muted px-3 py-1 text-xs font-medium text-ink"
                    >
                      <Server className="h-3 w-3" />
                      {agent?.hostname || aid}
                      {editId === g._id && (
                        <button
                          onClick={() => toggleAgent(g._id, aid, true)}
                          className="ml-1 text-ink-soft hover:text-danger"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  );
                })
              )}
            </div>

            {/* Server selector when editing */}
            {editId === g._id && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="mb-2 text-sm text-ink-muted">Add servers to this group:</p>
                <div className="flex flex-wrap gap-2">
                  {allAgents
                    .filter((a) => !g.agentIds.includes(a.agentId))
                    .map((a) => (
                      <button
                        key={a.agentId}
                        onClick={() => toggleAgent(g._id, a.agentId, false)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1 text-xs text-ink-muted hover:bg-bg-muted hover:text-ink"
                      >
                        <Plus className="h-3 w-3" />
                        {a.hostname}
                      </button>
                    ))}
                  {allAgents.filter((a) => !g.agentIds.includes(a.agentId)).length === 0 && (
                    <span className="text-xs text-ink-soft">All servers are already in this group</span>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
