"use client";

import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings, Server, Bot, Database, MessageSquare,
  CheckCircle, AlertCircle, Loader2, Save, Palette, Users, Shield, Trash2, LogOut, X
} from 'lucide-react';
import { ollamaModelKey, RECOMMENDED_EMBEDDING_MODELS } from '@/lib/embedding-models';
import { applyTheme, THEME_OPTIONS } from '@/lib/theme-options';
import HelpHint from './HelpHint';
interface UserSettings {
  huggingFaceBaseUrl: string;
  modelKeepAlive: boolean;
  ollamaKeepAlive: string;
  exclusiveOllamaModels: boolean;
  openClawProvider: string;
  openClawModel: string;
  openClawBaseUrl: string;
  shellExecutionTarget: 'container' | 'host';
  shellExecutionMode: string;
  shellAllowedCommands: string;
  shellHostAllowedRoots: string;
  shellHostAllowedEnvVars: string;
  shellHostMaxTimeoutMs: number;
  shellHostMaxOutputBytes: number;
  openClawFileAccessMode: string;
  openClawAllowedPaths: string;
  openClawFileWriteMode: string;
  openClawWritablePaths: string;
  openClawCodeExecutionMode: string;
  openClawBrowserMode: string;
  openClawUwafBrowserMode: string;
  openClawUwafScreenshots: boolean;
  openClawUwafDefaultMode: string;
  openClawUwafLiveBrowser: boolean;
  openClawAutomationExecutionEnabled: boolean;
  openClawAutomationExecutionModel: string;
  openClawAutomationExecutionMaxRunsPerHour: number;
  openClawAutomationExecutionAttachWorkspace: boolean;
  openClawAutomationExecutionAttachMemory: boolean;
  openClawSessionAutoContinueDefault: 'manual' | 'ask' | 'safe';
  openClawSessionAutoContinueMaxSteps: number;
  openClawMaxToolRoundsPerTurn: number;
  openClawSessionSummariesEnabled: boolean;
  openClawSessionSummaryTargetTokens: number;
  openClawSessionPreserveTurns: number;
  openClawSessionAnalyticsEnabled: boolean;
  openClawSessionBranchingEnabled: boolean;
  ragModel: string;
  ragMode: string;
  ragEnabled: boolean;
  ragTopK: number;
  ollamaHost: string;
  systemPrompt: string;
  temperature: number;
  ollamaUseModelDefaultTemperature: boolean;
  contextLength: number;
  ollamaUseModelDefaultContext: boolean;
  theme: string;
}

interface Model {
  name: string;
}

interface SessionUser {
  id: string;
  username: string;
  role: 'ADMIN' | 'MANAGER' | 'USER';
  isActive: boolean;
  lastLoginAt: string | null;
  permissions: string[];
}

interface PermissionDefinition {
  key: string;
  label: string;
  description: string;
  category: string;
}

interface RoleDefinition {
  key: 'ADMIN' | 'MANAGER' | 'USER';
  label: string;
  description: string;
}

interface PermissionOverrides {
  allow: string[];
  deny: string[];
}

interface ManagedUser {
  id: string;
  username: string;
  role: 'ADMIN' | 'MANAGER' | 'USER';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  permissions: string[];
  permissionOverrides: PermissionOverrides;
}

interface HostAccessStatus {
  error?: string;
  actionRequired?: string;
  filesystem?: {
    readMode: string;
    writeMode: string;
    approvedReadRoots: string[];
    approvedWritableRoots: string[];
    readReady: boolean;
    writeReady: boolean;
    warnings: string[];
    mountedRoots: Array<{
      label: string;
      hostPath: string;
      containerPath: string;
      writable: boolean;
    }>;
  };
  shell?: {
    target: string;
    mode: string;
    hostAllowedRoots: string[];
    hostExecutorStatus?: {
      configured: boolean;
      reachable: boolean;
      url: string;
      error?: string;
    };
  };
}

interface Props {
  onSettingsChange?: (settings: UserSettings) => void;
  onLogout?: () => void;
}

const INITIAL_SETTINGS: UserSettings = {
  huggingFaceBaseUrl: 'https://router.huggingface.co/v1',
  modelKeepAlive: false,
  ollamaKeepAlive: '0',
  exclusiveOllamaModels: false,
  openClawProvider: 'ollama',
  openClawModel: '',
  openClawBaseUrl: '',
  shellExecutionTarget: 'container',
  shellExecutionMode: 'ask-first',
  shellAllowedCommands: '',
  shellHostAllowedRoots: '~/.peakui/workspace',
  shellHostAllowedEnvVars: 'PATH\nHOME\nUSER\nSHELL\nLANG\nTERM',
  shellHostMaxTimeoutMs: 60000,
  shellHostMaxOutputBytes: 262144,
  openClawFileAccessMode: 'read-only',
  openClawAllowedPaths: '',
  openClawFileWriteMode: 'ask-first',
  openClawWritablePaths: '~/.peakui/workspace',
  openClawCodeExecutionMode: 'deny',
  openClawBrowserMode: 'deny',
  openClawUwafBrowserMode: 'deny',
  openClawUwafScreenshots: false,
  openClawUwafDefaultMode: 'direct',
  openClawUwafLiveBrowser: true,
  openClawAutomationExecutionEnabled: false,
  openClawAutomationExecutionModel: '',
  openClawAutomationExecutionMaxRunsPerHour: 6,
  openClawAutomationExecutionAttachWorkspace: true,
  openClawAutomationExecutionAttachMemory: true,
  openClawSessionAutoContinueDefault: 'manual',
  openClawSessionAutoContinueMaxSteps: 3,
  openClawMaxToolRoundsPerTurn: 25,
  openClawSessionSummariesEnabled: true,
  openClawSessionSummaryTargetTokens: 6000,
  openClawSessionPreserveTurns: 6,
  openClawSessionAnalyticsEnabled: true,
  openClawSessionBranchingEnabled: true,
  ragModel: 'nomic-embed-text',
  ragMode: 'semantic',
  ragEnabled: false,
  ragTopK: 8,
  ollamaHost: 'http://127.0.0.1:11434',
  systemPrompt: '',
  temperature: 0.7,
  ollamaUseModelDefaultTemperature: false,
  contextLength: 16384,
  ollamaUseModelDefaultContext: true,
  theme: 'aurora',
};

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ color: 'var(--accent-primary)' }}>{icon}</div>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{title}</h3>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, help, children }: { label: React.ReactNode; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>
        {label}
      </div>
      {children}
      {help && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '5px', lineHeight: 1.4 }}>{help}</div>}
    </div>
  );
}

function setPermissionOverride(overrides: PermissionOverrides, key: string, mode: 'default' | 'allow' | 'deny'): PermissionOverrides {
  const allow = overrides.allow.filter(permission => permission !== key);
  const deny = overrides.deny.filter(permission => permission !== key);

  if (mode === 'allow') allow.push(key);
  if (mode === 'deny') deny.push(key);

  return { allow, deny };
}

function formatTimestamp(value: string | null) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

export default function SettingsPanel({ onSettingsChange, onLogout }: Props) {
  const [settings, setSettings] = useState<UserSettings>(INITIAL_SETTINGS);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [testingEmbed, setTestingEmbed] = useState(false);
  const [embedStatus, setEmbedStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [embedError, setEmbedError] = useState('');
  const [embedDetails, setEmbedDetails] = useState('');
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [hostAccessStatus, setHostAccessStatus] = useState<HostAccessStatus | null>(null);
  const [hostAccessStatusLoading, setHostAccessStatusLoading] = useState(false);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [permissionDefinitions, setPermissionDefinitions] = useState<PermissionDefinition[]>([]);
  const [roleDefinitions, setRoleDefinitions] = useState<RoleDefinition[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [userNotice, setUserNotice] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [createUserModalOpen, setCreateUserModalOpen] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [createUserForm, setCreateUserForm] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    role: 'USER' as ManagedUser['role'],
    isActive: true,
    permissionOverrides: { allow: [], deny: [] } as PermissionOverrides,
  });

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (!data.error) {
        setSettings(data);
        applyTheme(data.theme);
        return data as UserSettings;
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    } finally {
      setLoading(false);
    }
    return null;
  }, []);

  const fetchModels = useCallback(async (host: string) => {
    setOllamaStatus('checking');
    try {
      const res = await fetch(host ? `/api/tags?host=${encodeURIComponent(host)}` : '/api/tags');
      const data = await res.json();
      if (data.models) {
        setModels(data.models);
        setOllamaStatus('online');
      } else {
        setOllamaStatus('offline');
      }
    } catch {
      setOllamaStatus('offline');
    }
  }, []);


  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session');
      if (!res.ok) {
        setSessionUser(null);
        return null;
      }
      const data = await res.json() as { user?: SessionUser };
      const nextUser = data.user || null;
      setSessionUser(nextUser);
      return nextUser;
    } catch {
      setSessionUser(null);
      return null;
    }
  }, []);

  const fetchHostAccessStatus = useCallback(async () => {
    setHostAccessStatusLoading(true);
    try {
      const res = await fetch('/api/openclaw/filesystem', { cache: 'no-store' });
      const data = await res.json().catch(() => ({})) as HostAccessStatus;
      setHostAccessStatus(data);
    } catch (error) {
      setHostAccessStatus({
        error: error instanceof Error ? error.message : 'Failed to load host access status.',
      });
    } finally {
      setHostAccessStatusLoading(false);
    }
  }, []);

  const fetchManagedUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError('');
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json() as {
        error?: string;
        users?: ManagedUser[];
        permissionDefinitions?: PermissionDefinition[];
        roleDefinitions?: RoleDefinition[];
      };
      if (!res.ok) {
        setUsersError(data.error || 'Failed to load users.');
        return;
      }
      setManagedUsers(Array.isArray(data.users) ? data.users : []);
      setPermissionDefinitions(Array.isArray(data.permissionDefinitions) ? data.permissionDefinitions : []);
      setRoleDefinitions(Array.isArray(data.roleDefinitions) ? data.roleDefinitions : []);
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : 'Failed to load users.');
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadInitialSettings = async () => {
      const [loadedSettings, authUser] = await Promise.all([
        fetchSettings(),
        fetchSession(),
      ]);
      const nextSettings = loadedSettings || INITIAL_SETTINGS;
      await Promise.all([
        fetchModels(nextSettings.ollamaHost),
        authUser?.permissions.includes('openclaw.filesystem') ? fetchHostAccessStatus() : Promise.resolve(),
      ]);
      if (authUser?.permissions.includes('users.manage')) {
        await fetchManagedUsers();
      }
    };

    void loadInitialSettings();
  }, [fetchSettings, fetchModels, fetchManagedUsers, fetchSession, fetchHostAccessStatus]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      if (!data.error) {
        setSaved(true);
        setSettings(data);
        applyTheme(data.theme);
        onSettingsChange?.(data);
        void fetchModels(data.ollamaHost);
        if (sessionUser?.permissions.includes('openclaw.filesystem')) void fetchHostAccessStatus();
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (e) {
      console.error('Save failed:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmbedding = async () => {
    setTestingEmbed(true);
    setEmbedStatus('idle');
    setEmbedError('');
    setEmbedDetails('');
    try {
      const res = await fetch('/api/rag/test-embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: settings.ragModel, host: settings.ollamaHost })
      });
      const data = await res.json();
      if (res.ok) {
        const seconds = Math.max(1, Math.round((Number(data.durationMs) || 0) / 1000));
        const dimensions = typeof data.dimensions === 'number' ? data.dimensions.toLocaleString() : data.dimensions;
        setEmbedStatus('ok');
        setEmbedDetails(`${data.model || settings.ragModel} · ${dimensions} dimensions · ${seconds}s`);
      } else {
        setEmbedStatus('error');
        setEmbedError(data.error || 'Unknown error');
      }
    } catch (e) {
      setEmbedStatus('error');
      setEmbedError(e instanceof Error ? e.message : 'Embedding test failed');
    } finally {
      setTestingEmbed(false);
    }
  };

  const update = <K extends keyof UserSettings>(field: K, value: UserSettings[K]) => {
    setSettings(prev => ({ ...prev, [field]: value }));
    if (field === 'theme') applyTheme(value as string);
    if (field === 'ragModel') {
      setEmbedStatus('idle');
      setEmbedError('');
      setEmbedDetails('');
    }
    setSaved(false);
  };

  const applyHostAccessPreset = (preset: 'workspace' | 'home-read' | 'mounted-audit') => {
    setSettings(prev => {
      const mountedRoots = hostAccessStatus?.filesystem?.mountedRoots || [];
      const mountedReadRoots = mountedRoots
        .filter(root => !root.writable)
        .map(root => root.hostPath)
        .filter(Boolean);
      const mountedWritableRoots = mountedRoots
        .filter(root => root.writable)
        .map(root => root.hostPath)
        .filter(Boolean);
      const workspaceRoot = mountedWritableRoots[0]
        || prev.openClawWritablePaths.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean)[0]
        || '~/.peakui/workspace';
      const defaultReadRoots = mountedReadRoots.length > 0 ? mountedReadRoots : ['/home', '/tmp'];

      if (preset === 'workspace') {
        return {
          ...prev,
          shellExecutionTarget: 'host',
          shellExecutionMode: 'ask-first',
          shellHostAllowedRoots: workspaceRoot,
          openClawFileAccessMode: 'read-only',
          openClawAllowedPaths: workspaceRoot,
          openClawFileWriteMode: 'ask-first',
          openClawWritablePaths: workspaceRoot,
        };
      }

      if (preset === 'home-read') {
        return {
          ...prev,
          shellExecutionTarget: 'host',
          shellExecutionMode: 'ask-first',
          shellHostAllowedRoots: [...defaultReadRoots, workspaceRoot].filter((entry, index, all) => all.indexOf(entry) === index).join('\n'),
          openClawFileAccessMode: 'read-only',
          openClawAllowedPaths: defaultReadRoots.join('\n'),
          openClawFileWriteMode: 'ask-first',
          openClawWritablePaths: workspaceRoot,
        };
      }

      const allMountedRoots = [...defaultReadRoots, workspaceRoot]
        .filter((entry, index, all) => all.indexOf(entry) === index);
      return {
        ...prev,
        shellExecutionTarget: 'host',
        shellExecutionMode: 'ask-first',
        shellHostAllowedRoots: allMountedRoots.join('\n'),
        openClawFileAccessMode: 'read-only',
        openClawAllowedPaths: allMountedRoots.join('\n'),
        openClawFileWriteMode: 'ask-first',
        openClawWritablePaths: workspaceRoot,
      };
    });
    setSaved(false);
  };

  const canManageUsers = sessionUser?.permissions.includes('users.manage') ?? false;

  const updateManagedUser = (userId: string, updater: (user: ManagedUser) => ManagedUser) => {
    setManagedUsers(prev => prev.map(user => user.id === userId ? updater(user) : user));
  };

  const saveManagedUser = async (user: ManagedUser) => {
    setUpdatingUserId(user.id);
    setUsersError('');
    setUserNotice('');
    try {
      const password = passwordDrafts[user.id]?.trim() || undefined;
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: user.username,
          role: user.role,
          isActive: user.isActive,
          permissionOverrides: user.permissionOverrides,
          ...(password ? { password } : {}),
        }),
      });
      const data = await res.json() as { error?: string; user?: ManagedUser };
      if (!res.ok || !data.user) {
        setUsersError(data.error || 'Failed to update user.');
        return;
      }
      setManagedUsers(prev => prev.map(entry => entry.id === data.user!.id ? data.user! : entry));
      setPasswordDrafts(prev => {
        const next = { ...prev };
        delete next[user.id];
        return next;
      });
      setUserNotice(`Updated ${data.user.username}.`);
      if (sessionUser && data.user.id === sessionUser.id) {
        void fetchSession();
      }
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : 'Failed to update user.');
    } finally {
      setUpdatingUserId(null);
    }
  };

  const deleteManagedUser = async (user: ManagedUser) => {
    const confirmed = window.confirm(`Delete user "${user.username}"? This also removes their settings, chats, documents, and artifacts.`);
    if (!confirmed) return;

    setDeletingUserId(user.id);
    setUsersError('');
    setUserNotice('');
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setUsersError(data.error || 'Failed to delete user.');
        return;
      }
      setManagedUsers(prev => prev.filter(entry => entry.id !== user.id));
      setUserNotice(`Deleted ${user.username}.`);
      if (sessionUser?.id === user.id) {
        window.location.href = '/login';
      }
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : 'Failed to delete user.');
    } finally {
      setDeletingUserId(null);
    }
  };

  const createManagedUser = async () => {
    setUsersError('');
    setUserNotice('');
    if (!createUserForm.username.trim() || !createUserForm.password) {
      setUsersError('Username and password are required.');
      return;
    }
    if (createUserForm.password !== createUserForm.confirmPassword) {
      setUsersError('New user passwords do not match.');
      return;
    }

    setCreatingUser(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: createUserForm.username,
          password: createUserForm.password,
          role: createUserForm.role,
          isActive: createUserForm.isActive,
          permissionOverrides: createUserForm.permissionOverrides,
        }),
      });
      const data = await res.json() as { error?: string; user?: ManagedUser };
      if (!res.ok || !data.user) {
        setUsersError(data.error || 'Failed to create user.');
        return;
      }
      setManagedUsers(prev => [...prev, data.user!].sort((left, right) => left.username.localeCompare(right.username)));
      setCreateUserForm({
        username: '',
        password: '',
        confirmPassword: '',
        role: 'USER',
        isActive: true,
        permissionOverrides: { allow: [], deny: [] },
      });
      setUserNotice(`Created ${data.user.username}.`);
      setCreateUserModalOpen(false);
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : 'Failed to create user.');
    } finally {
      setCreatingUser(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} color="var(--accent-primary)" />
      </div>
    );
  }

  const installedModelKeys = new Set(models.map(model => ollamaModelKey(model.name)));
  const recommendedModelKeys = new Set(RECOMMENDED_EMBEDDING_MODELS.map(model => ollamaModelKey(model.name)));
  const otherInstalledModels = models.filter(model => !recommendedModelKeys.has(ollamaModelKey(model.name)));
  const availableRoles = roleDefinitions.length > 0 ? roleDefinitions : [
    { key: 'ADMIN' as const, label: 'Admin', description: 'Full access' },
    { key: 'MANAGER' as const, label: 'Manager', description: 'Power-user access' },
    { key: 'USER' as const, label: 'User', description: 'Standard access' },
  ];
  const permissionsByCategory = permissionDefinitions.reduce<Record<string, PermissionDefinition[]>>((acc, permission) => {
    if (!acc[permission.category]) acc[permission.category] = [];
    acc[permission.category].push(permission);
    return acc;
  }, {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '24px', gap: '4px', maxWidth: '680px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
            <div style={{ background: 'var(--accent-gradient)', padding: '8px', borderRadius: '10px' }}>
              <Settings size={22} color="white" />
            </div>
            <h2 style={{ margin: 0, fontSize: '1.5rem' }}>Settings</h2>
          </div>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.85rem' }}>
            Preferences are saved per user and persist across sessions.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {onLogout && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onLogout}
              style={{ padding: '10px 14px', color: 'var(--danger)', borderColor: 'var(--danger)' }}
            >
              <LogOut size={16} /> Logout
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
            style={{ padding: '10px 22px' }}
          >
            {saving ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : saved ? <><CheckCircle size={16} /> Saved!</> : <><Save size={16} /> Save</>}
          </button>
        </div>
      </div>

      {canManageUsers && (
        <Section icon={<Users size={18} />} title="User Management">
          <div style={{ padding: '14px 16px', borderRadius: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '4px' }}>Access control</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Bootstrap stays unchanged: the first deployed login still creates the initial admin. After that, admins manage all accounts here.
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '8px 14px' }}
                  onClick={() => void fetchManagedUsers()}
                  disabled={usersLoading}
                >
                  {usersLoading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : 'Refresh'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '8px 14px' }}
                  onClick={() => {
                    setUsersError('');
                    setUserNotice('');
                    setCreateUserModalOpen(true);
                  }}
                >
                  <Users size={14} />
                  Add user
                </button>
              </div>
            </div>

            {usersError && (
              <div style={{ padding: '12px', borderRadius: '10px', border: '1px solid var(--danger)', background: 'rgba(239,68,68,0.08)', color: '#fca5a5', fontSize: '0.82rem' }}>
                {usersError}
              </div>
            )}

            {userNotice && (
              <div style={{ padding: '12px', borderRadius: '10px', border: '1px solid rgba(34,197,94,0.2)', background: 'rgba(34,197,94,0.08)', color: 'var(--success)', fontSize: '0.82rem' }}>
                {userNotice}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {managedUsers.map(user => (
                <div key={user.id} style={{ padding: '14px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--bg-glass)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{user.username}</div>
                        {sessionUser?.id === user.id && (
                          <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '999px', background: 'var(--accent-soft)', color: 'var(--accent-primary)', border: '1px solid var(--accent-border)' }}>
                            You
                          </span>
                        )}
                        <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '999px', background: user.isActive ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', color: user.isActive ? 'var(--success)' : '#fca5a5', border: `1px solid ${user.isActive ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
                          {user.isActive ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                      <div style={{ marginTop: '6px', fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        Last login: {formatTimestamp(user.lastLoginAt)} · Created: {formatTimestamp(user.createdAt)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void saveManagedUser(user)}
                        disabled={updatingUserId === user.id}
                        style={{ padding: '8px 14px' }}
                      >
                        {updatingUserId === user.id ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void deleteManagedUser(user)}
                        disabled={deletingUserId === user.id}
                        style={{ padding: '8px 14px', color: '#fca5a5' }}
                      >
                        {deletingUserId === user.id ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={14} />}
                        Delete
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                    <input
                      className="input-field"
                      value={user.username}
                      onChange={e => updateManagedUser(user.id, current => ({ ...current, username: e.target.value }))}
                    />
                    <select
                      className="input-field"
                      value={user.role}
                      onChange={e => updateManagedUser(user.id, current => ({ ...current, role: e.target.value as ManagedUser['role'] }))}
                    >
                      {availableRoles.map(role => (
                        <option key={role.key} value={role.key}>{role.label}</option>
                      ))}
                    </select>
                    <input
                      className="input-field"
                      type="password"
                      placeholder="Leave blank to keep password"
                      value={passwordDrafts[user.id] || ''}
                      onChange={e => setPasswordDrafts(prev => ({ ...prev, [user.id]: e.target.value }))}
                    />
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                    <input
                      type="checkbox"
                      checked={user.isActive}
                      onChange={e => updateManagedUser(user.id, current => ({ ...current, isActive: e.target.checked }))}
                    />
                    Account is active
                  </label>

                  {user.role === 'ADMIN' ? (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      Admin role grants the full permission set. Override controls are not applied.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {Object.entries(permissionsByCategory).map(([category, permissions]) => (
                        <div key={category} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{category}</div>
                          {permissions.map(permission => {
                            const mode = user.permissionOverrides.allow.includes(permission.key)
                              ? 'allow'
                              : user.permissionOverrides.deny.includes(permission.key)
                                ? 'deny'
                                : 'default';

                            return (
                              <div key={permission.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 120px', gap: '10px', alignItems: 'center' }}>
                                <div>
                                  <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{permission.label}</div>
                                  <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>{permission.description}</div>
                                </div>
                                <select
                                  className="input-field"
                                  value={mode}
                                  onChange={e => updateManagedUser(user.id, current => ({
                                    ...current,
                                    permissionOverrides: setPermissionOverride(current.permissionOverrides, permission.key, e.target.value as 'default' | 'allow' | 'deny'),
                                  }))}
                                >
                                  <option value="default">Role default</option>
                                  <option value="allow">Allow</option>
                                  <option value="deny">Deny</option>
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {user.permissions.map(permission => (
                      <span key={permission} style={{ fontSize: '0.72rem', padding: '4px 8px', borderRadius: '999px', border: '1px solid var(--accent-border)', background: 'var(--accent-faint)', color: 'var(--accent-primary)' }}>
                        {permission}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}

      {canManageUsers && createUserModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create user"
          onClick={() => !creatingUser && setCreateUserModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            background: 'rgba(3, 6, 23, 0.66)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div
            onClick={event => event.stopPropagation()}
            style={{
              width: 'min(980px, calc(100vw - 32px))',
              maxHeight: 'min(88vh, 900px)',
              overflowY: 'auto',
              padding: '18px',
              borderRadius: '18px',
              border: '1px solid var(--border-color)',
              background: 'var(--sidebar-bg)',
              boxShadow: '0 24px 72px rgba(0, 0, 0, 0.42)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', paddingBottom: '10px', background: 'var(--sidebar-bg)', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Shield size={18} color="var(--accent-primary)" />
                <div>
                  <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>Create user</div>
                  <div style={{ marginTop: '3px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    Add an account and set role-level overrides before first login.
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCreateUserModalOpen(false)}
                disabled={creatingUser}
                aria-label="Close create user dialog"
                style={{ padding: '8px 10px' }}
              >
                <X size={16} />
              </button>
            </div>

            {usersError && (
              <div style={{ padding: '12px', borderRadius: '10px', border: '1px solid var(--danger)', background: 'rgba(239,68,68,0.08)', color: '#fca5a5', fontSize: '0.82rem' }}>
                {usersError}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
              <input
                className="input-field"
                placeholder="Username"
                value={createUserForm.username}
                onChange={e => setCreateUserForm(prev => ({ ...prev, username: e.target.value }))}
              />
              <input
                className="input-field"
                type="password"
                placeholder="Password"
                value={createUserForm.password}
                onChange={e => setCreateUserForm(prev => ({ ...prev, password: e.target.value }))}
              />
              <input
                className="input-field"
                type="password"
                placeholder="Confirm password"
                value={createUserForm.confirmPassword}
                onChange={e => setCreateUserForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
              />
              <select
                className="input-field"
                value={createUserForm.role}
                onChange={e => setCreateUserForm(prev => ({ ...prev, role: e.target.value as ManagedUser['role'] }))}
              >
                {availableRoles.map(role => (
                  <option key={role.key} value={role.key}>{role.label}</option>
                ))}
              </select>
            </div>

            <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              New passwords must use 10+ characters with uppercase, lowercase, and a number.
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                id="create-user-active"
                type="checkbox"
                checked={createUserForm.isActive}
                onChange={e => setCreateUserForm(prev => ({ ...prev, isActive: e.target.checked }))}
              />
              <label htmlFor="create-user-active" style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                User starts active
              </label>
            </div>

            {createUserForm.role !== 'ADMIN' && permissionDefinitions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {Object.entries(permissionsByCategory).map(([category, permissions]) => (
                  <div key={category} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{category}</div>
                    {permissions.map(permission => {
                      const mode = createUserForm.permissionOverrides.allow.includes(permission.key)
                        ? 'allow'
                        : createUserForm.permissionOverrides.deny.includes(permission.key)
                          ? 'deny'
                          : 'default';

                      return (
                        <div key={permission.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 120px', gap: '10px', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{permission.label}</div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>{permission.description}</div>
                          </div>
                          <select
                            className="input-field"
                            value={mode}
                            onChange={e => setCreateUserForm(prev => ({
                              ...prev,
                              permissionOverrides: setPermissionOverride(prev.permissionOverrides, permission.key, e.target.value as 'default' | 'allow' | 'deny'),
                            }))}
                          >
                            <option value="default">Role default</option>
                            <option value="allow">Allow</option>
                            <option value="deny">Deny</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {createUserForm.role === 'ADMIN' && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Admin users always receive the full permission set.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap', paddingTop: '4px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCreateUserModalOpen(false)}
                disabled={creatingUser}
                style={{ padding: '10px 16px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void createManagedUser()}
                disabled={creatingUser}
                style={{ padding: '10px 16px' }}
              >
                {creatingUser ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Appearance */}
      <Section icon={<Palette size={18} />} title="Appearance">
        <Field label="Theme" help="Choose a professional palette for the studio. Save to keep it across sessions.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
            {THEME_OPTIONS.map(theme => {
              const active = settings.theme === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => update('theme', theme.id)}
                  style={{
                    padding: '12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    transition: 'all 0.15s'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{theme.name}</span>
                    {active && <CheckCircle size={14} color="var(--accent-primary)" />}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                    {theme.colors.map(color => (
                      <span
                        key={color}
                        style={{
                          width: '22px',
                          height: '22px',
                          borderRadius: '999px',
                          background: color,
                          border: '1px solid var(--border-color)'
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    {theme.description}
                  </div>
                </button>
              );
            })}
          </div>
        </Field>
      </Section>

      {/* Ollama Connection */}
      <Section icon={<Server size={18} />} title="Ollama Connection">
        <Field label="Ollama Host URL" help="The address of your Ollama instance. Change this if Ollama is running on a different machine or port.">
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              className="input-field"
              style={{ flex: 1 }}
              value={settings.ollamaHost}
              onChange={e => update('ollamaHost', e.target.value)}
              placeholder="http://127.0.0.1:11434"
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
              {ollamaStatus === 'checking' && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
              {ollamaStatus === 'online' && <CheckCircle size={13} color="var(--success)" />}
              {ollamaStatus === 'offline' && <AlertCircle size={13} color="var(--danger)" />}
              <span style={{ color: ollamaStatus === 'online' ? 'var(--success)' : ollamaStatus === 'offline' ? 'var(--danger)' : 'var(--text-secondary)' }}>
                {ollamaStatus === 'online' ? `Online · ${models.length} models` : ollamaStatus === 'offline' ? 'Offline' : 'Checking...'}
              </span>
            </div>
          </div>
        </Field>
      </Section>

      {/* Generation Settings */}
      <Section icon={<MessageSquare size={18} />} title="Generation">
        <Field
          label={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              Model Keep Alive
              <HelpHint text="Optional local Ollama setting that asks a local runner to stay resident after each WorkSpaces response. It is not sent to Ollama cloud model aliases." />
            </span>
          }
          help="Off by default. Enable only when a local Ollama model benefits on your hardware and you have enough memory headroom."
        >
          <div style={{
            padding: '12px 14px',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-glass)',
            display: 'grid',
            gap: '12px',
          }}>
            <button
              type="button"
              onClick={() => {
                const enabled = !settings.modelKeepAlive;
                update('modelKeepAlive', enabled);
                if (enabled && settings.ollamaKeepAlive === '0') update('ollamaKeepAlive', '30m');
              }}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '10px',
                border: `1px solid ${settings.modelKeepAlive ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                background: settings.modelKeepAlive ? 'var(--accent-soft)' : 'transparent',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                textAlign: 'left',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                  {settings.modelKeepAlive ? 'Keep local Ollama models warm after responses' : 'Use Ollama default model lifecycle'}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.45 }}>
                  {settings.modelKeepAlive
                    ? `PeakUI asks local Ollama models to stay loaded for ${settings.ollamaKeepAlive || '30m'} after each response. Cloud aliases ignore this.`
                    : 'PeakUI does not send request-level keep_alive. Ollama decides when local models stay resident or unload.'}
                </div>
              </div>
              <span style={{ color: settings.modelKeepAlive ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: 700 }}>
                {settings.modelKeepAlive ? 'On' : 'Off'}
              </span>
            </button>

            {settings.modelKeepAlive && (
              <div style={{ display: 'grid', gap: '8px' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Longer windows feel more like `ollama run` because the model remains resident between prompts. Use the header <strong>Stop model</strong> button when you want to unload it immediately.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(78px, 1fr))', gap: '8px' }}>
                  {['5m', '30m', '1h', '2h'].map(duration => (
                    <button
                      key={duration}
                      type="button"
                      onClick={() => update('ollamaKeepAlive', duration)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '10px',
                        border: `1px solid ${settings.ollamaKeepAlive === duration ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                        background: settings.ollamaKeepAlive === duration ? 'var(--accent-soft)' : 'transparent',
                        color: settings.ollamaKeepAlive === duration ? 'var(--accent-primary)' : 'var(--text-primary)',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontWeight: 700,
                      }}
                    >
                      {duration}
                    </button>
                  ))}
                </div>
                <input
                  className="input-field"
                  value={settings.ollamaKeepAlive}
                  onChange={event => update('ollamaKeepAlive', event.target.value)}
                  placeholder="30m"
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  Accepted format: a positive number followed by `ms`, `s`, `m`, or `h`.
                </div>
              </div>
            )}
          </div>
        </Field>

        <Field
          label={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              Exclusive Ollama Switching
              <HelpHint text="Before a local WorkSpaces request starts, unload any other running Ollama models so the selected model gets the machine to itself." />
            </span>
          }
          help="When enabled, the app asks Ollama to unload other running models before it starts the selected local WorkSpaces model."
        >
          <button
            type="button"
            onClick={() => update('exclusiveOllamaModels', !settings.exclusiveOllamaModels)}
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: '12px',
              border: `1px solid ${settings.exclusiveOllamaModels ? 'var(--accent-primary)' : 'var(--border-color)'}`,
              background: settings.exclusiveOllamaModels ? 'var(--accent-soft)' : 'var(--bg-glass)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              transition: 'all 0.15s'
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                {settings.exclusiveOllamaModels ? 'Exclusive model mode enabled' : 'Exclusive model mode disabled'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '3px', lineHeight: 1.45 }}>
                {settings.exclusiveOllamaModels
                  ? 'Other running Ollama models are unloaded before the selected Ollama model starts.'
                  : 'Ollama is free to leave other recently-used local models resident until they expire.'}
              </div>
            </div>
            <div style={{
              fontSize: '0.82rem',
              fontWeight: 700,
              color: settings.exclusiveOllamaModels ? 'var(--accent-primary)' : 'var(--text-secondary)',
              whiteSpace: 'nowrap'
            }}>
              {settings.exclusiveOllamaModels ? 'Only one' : 'Shared'}
            </div>
          </button>
        </Field>

        <Field label={`Temperature: ${settings.temperature.toFixed(1)}`} help="Controls randomness. Lower = focused and deterministic. Higher = creative and varied. (0.0 – 2.0)">
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
            <input
              type="checkbox"
              checked={settings.ollamaUseModelDefaultTemperature}
              onChange={e => update('ollamaUseModelDefaultTemperature', e.target.checked)}
            />
            Use Ollama/model default temperature for local Ollama
          </label>
          <input
            type="range"
            min="0" max="2" step="0.1"
            value={settings.temperature}
            onChange={e => update('temperature', parseFloat(e.target.value))}
            disabled={settings.ollamaUseModelDefaultTemperature}
            style={{ width: '100%', accentColor: 'var(--accent-primary)', cursor: settings.ollamaUseModelDefaultTemperature ? 'not-allowed' : 'pointer', opacity: settings.ollamaUseModelDefaultTemperature ? 0.55 : 1 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            <span>0.0 — Precise</span><span>1.0 — Balanced</span><span>2.0 — Creative</span>
          </div>
          {settings.ollamaUseModelDefaultTemperature && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
              Local Ollama requests will omit the custom temperature and let the selected model use its native default.
            </div>
          )}
        </Field>

        <Field label={`Context Window: ${settings.contextLength.toLocaleString()} tokens`} help="Requested maximum for local Ollama. The server applies a safe request cap by default and backs off on memory pressure.">
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
            <input
              type="checkbox"
              checked={settings.ollamaUseModelDefaultContext}
              onChange={e => update('ollamaUseModelDefaultContext', e.target.checked)}
            />
            Use Ollama/model default context for local Ollama
          </label>
          <input
            type="range"
            min="512" max="131072" step="512"
            value={settings.contextLength}
            onChange={e => update('contextLength', parseInt(e.target.value))}
            disabled={settings.ollamaUseModelDefaultContext}
            style={{ width: '100%', accentColor: 'var(--accent-primary)', cursor: settings.ollamaUseModelDefaultContext ? 'not-allowed' : 'pointer', opacity: settings.ollamaUseModelDefaultContext ? 0.55 : 1 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            <span>512</span><span>32k</span><span>128k</span>
          </div>
          {settings.ollamaUseModelDefaultContext && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
              Local Ollama requests will omit the custom context window and let the selected model use its native default.
            </div>
          )}
        </Field>
      </Section>

      <Section icon={<Bot size={18} />} title="WorkSpaces">
        <Field label="Provider" help="Start with local Ollama models. OpenAI-compatible providers can be wired in without changing the workspace later.">
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {[
              { value: 'ollama', label: 'Local Ollama' },
              { value: 'openai-compatible', label: 'OpenAI-compatible' },
            ].map(opt => {
              const active = settings.openClawProvider === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('openClawProvider', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>

        {settings.openClawProvider === 'openai-compatible' && (
          <Field label="API Base URL" help="For example: https://api.openai.com/v1 or a local proxy endpoint.">
            <input
              className="input-field"
              value={settings.openClawBaseUrl}
              onChange={e => update('openClawBaseUrl', e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </Field>
        )}

        <Field label="WorkSpaces Model" help="This model is remembered for the WorkSpaces workspace and reused automatically on return.">
          {settings.openClawProvider === 'ollama' ? (
            <select
              className="input-field"
              value={settings.openClawModel}
              onChange={e => update('openClawModel', e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">— Pick a local model —</option>
              {models.map(m => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          ) : (
            <input
              className="input-field"
              value={settings.openClawModel}
              onChange={e => update('openClawModel', e.target.value)}
              placeholder="gpt-4o-mini"
            />
          )}
        </Field>

        <Field label="Unattended Model Execution" help="Allow automation schedules, heartbeat check-ins, monitors, and wake events to launch background WorkSpaces model runs without an active browser tab. This currently supports local Ollama only.">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { value: true, label: 'Enabled', desc: 'Automation triggers may queue unattended background runs' },
              { value: false, label: 'Disabled', desc: 'Automation stays notification-only' },
            ].map(opt => {
              const active = settings.openClawAutomationExecutionEnabled === opt.value;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => update('openClawAutomationExecutionEnabled', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8rem',
                  }}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>

        {settings.openClawAutomationExecutionEnabled && (
          <>
            <Field label="Automation Execution Model" help="Model used for unattended background runs. Leave blank to fall back to the main WorkSpaces model.">
              {settings.openClawProvider === 'ollama' ? (
                <select
                  className="input-field"
                  value={settings.openClawAutomationExecutionModel}
                  onChange={e => update('openClawAutomationExecutionModel', e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="">Use WorkSpaces model</option>
                  {models.map(m => (
                    <option key={m.name} value={m.name}>{m.name}</option>
                  ))}
                </select>
              ) : (
                <div style={{ padding: '12px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Unattended execution is currently limited to local Ollama models because browser-stored API keys are not available server-side.
                </div>
              )}
            </Field>

            <Field label="Automation Budget" help="Upper bound on unattended model runs per user per hour. Excess queued runs are skipped instead of bursting endlessly.">
              <input
                className="input-field"
                type="number"
                min={1}
                max={60}
                value={settings.openClawAutomationExecutionMaxRunsPerHour}
                onChange={e => update('openClawAutomationExecutionMaxRunsPerHour', Math.max(1, Number(e.target.value) || 1))}
              />
            </Field>

            <Field label="Background Context" help="Choose how much server-side context unattended runs can attach automatically.">
              <div style={{ display: 'grid', gap: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.84rem', color: 'var(--text-primary)' }}>
                  <input
                    type="checkbox"
                    checked={settings.openClawAutomationExecutionAttachWorkspace}
                    onChange={e => update('openClawAutomationExecutionAttachWorkspace', e.target.checked)}
                  />
                  Attach selected workspace instructions (`BOOT.md`, `TOOLS.md`, skills)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.84rem', color: 'var(--text-primary)' }}>
                  <input
                    type="checkbox"
                    checked={settings.openClawAutomationExecutionAttachMemory}
                    onChange={e => update('openClawAutomationExecutionAttachMemory', e.target.checked)}
                  />
                  Attach recent memory and long-term memory
                </label>
              </div>
            </Field>
          </>
        )}

        <Field label="Session Auto-Continue Default" help="Default continuation behavior for new WorkSpaces sessions. Manual never resumes automatically, Ask surfaces a continue prompt when the agent stops mid-flow, and Safe resumes only capped tool-follow-up steps.">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { value: 'manual' as const, label: 'Manual', desc: 'No automatic continuation' },
              { value: 'ask' as const, label: 'Ask', desc: 'Suggest continuation when a task stops mid-flow' },
              { value: 'safe' as const, label: 'Safe', desc: 'Automatically continue capped safe follow-up steps' },
            ].map(opt => {
              const active = settings.openClawSessionAutoContinueDefault === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('openClawSessionAutoContinueDefault', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8rem',
                  }}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Auto-Continue Step Cap" help="Upper bound on chained automatic continuations in one WorkSpaces task flow before the agent stops and hands control back to the user.">
          <input
            className="input-field"
            type="number"
            min={1}
            max={10}
            value={settings.openClawSessionAutoContinueMaxSteps}
            onChange={e => update('openClawSessionAutoContinueMaxSteps', Math.max(1, Number(e.target.value) || 1))}
          />
        </Field>

        <Field label="Tool-Step Cap Per Turn" help="Maximum number of real tool calls WorkSpaces can execute in a single assistant turn before pausing and asking you to continue. Higher values let long tasks run uninterrupted; lower values catch runaway loops earlier. Recovery nudges and duplicate-request warnings do not count toward this cap.">
          <input
            className="input-field"
            type="number"
            min={1}
            max={100}
            value={settings.openClawMaxToolRoundsPerTurn}
            onChange={e => update('openClawMaxToolRoundsPerTurn', Math.max(1, Math.min(100, Number(e.target.value) || 25)))}
          />
        </Field>

        <Field label="Long-Session Context Management" help="Control when WorkSpaces compresses older transcript turns into a rolling session summary instead of dropping context blindly.">
          <div style={{ display: 'grid', gap: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.84rem', color: 'var(--text-primary)' }}>
              <input
                type="checkbox"
                checked={settings.openClawSessionSummariesEnabled}
                onChange={e => update('openClawSessionSummariesEnabled', e.target.checked)}
              />
              Enable rolling context summaries for long WorkSpaces sessions
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>Summary trigger</div>
                <input
                  className="input-field"
                  type="number"
                  min={2048}
                  max={64000}
                  step={256}
                  value={settings.openClawSessionSummaryTargetTokens}
                  onChange={e => update('openClawSessionSummaryTargetTokens', Math.max(2048, Number(e.target.value) || 2048))}
                />
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '5px', lineHeight: 1.45 }}>
                  Approximate token threshold before older turns are compressed.
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>Recent turns kept raw</div>
                <input
                  className="input-field"
                  type="number"
                  min={2}
                  max={16}
                  value={settings.openClawSessionPreserveTurns}
                  onChange={e => update('openClawSessionPreserveTurns', Math.max(2, Number(e.target.value) || 2))}
                />
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '5px', lineHeight: 1.45 }}>
                  Keeps the latest conversation turns verbatim while older turns move into summary memory.
                </div>
              </div>
            </div>
          </div>
        </Field>

        <Field label="Session Insights" help="Analytics track time, tokens, and tool activity per WorkSpaces session. Branching enables session forks and side-by-side branch comparison in the workspace UI.">
          <div style={{ display: 'grid', gap: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.84rem', color: 'var(--text-primary)' }}>
              <input
                type="checkbox"
                checked={settings.openClawSessionAnalyticsEnabled}
                onChange={e => update('openClawSessionAnalyticsEnabled', e.target.checked)}
              />
              Enable per-session analytics
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.84rem', color: 'var(--text-primary)' }}>
              <input
                type="checkbox"
                checked={settings.openClawSessionBranchingEnabled}
                onChange={e => update('openClawSessionBranchingEnabled', e.target.checked)}
              />
              Enable branching and compare workflows
            </label>
          </div>
        </Field>

        <Field label="Host Access Presets" help="Presets update the shell and filesystem fields below. They are not saved until you click Save Settings. Keep ask-first enabled for host access unless the workflow is already proven.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
            {[
              {
                key: 'workspace' as const,
                label: 'Safe Workspace',
                desc: 'Host shell plus read/write access only inside the managed workspace root.',
              },
              {
                key: 'home-read' as const,
                label: 'Home Read + Workspace Write',
                desc: 'Read mounted host home/temp roots, write only inside the managed workspace.',
              },
              {
                key: 'mounted-audit' as const,
                label: 'Mounted Host Audit',
                desc: 'Read all mounted host roots and allow host shell starts from those roots; writes stay workspace-only.',
              },
            ].map(preset => (
              <button
                key={preset.key}
                type="button"
                onClick={() => applyHostAccessPreset(preset.key)}
                style={{
                  textAlign: 'left',
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  padding: '12px',
                  background: 'var(--bg-glass)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>{preset.label}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>{preset.desc}</div>
              </button>
            ))}
          </div>
          <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--bg-soft)', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>Current host access status</div>
            {hostAccessStatusLoading ? (
              <span>Checking host access...</span>
            ) : hostAccessStatus?.error ? (
              <span>{hostAccessStatus.error}{hostAccessStatus.actionRequired ? ` ${hostAccessStatus.actionRequired}` : ''}</span>
            ) : (
              <>
                <div>Filesystem: {hostAccessStatus?.filesystem?.readReady ? 'read-ready' : 'read not ready'} · {hostAccessStatus?.filesystem?.writeReady ? 'write-ready' : 'write not ready'}</div>
                <div>Host executor: {hostAccessStatus?.shell?.hostExecutorStatus?.reachable ? 'reachable' : hostAccessStatus?.shell?.hostExecutorStatus?.configured ? 'configured but unreachable' : 'token not configured'}</div>
                {hostAccessStatus?.filesystem?.warnings?.length ? (
                  <div style={{ marginTop: '4px' }}>
                    {hostAccessStatus.filesystem.warnings.join(' ')}
                  </div>
                ) : null}
              </>
            )}
            <button
              type="button"
              onClick={() => void fetchHostAccessStatus()}
              style={{
                marginTop: '8px',
                border: '1px solid var(--border-color)',
                background: 'transparent',
                color: 'var(--text-primary)',
                borderRadius: '999px',
                padding: '5px 9px',
                cursor: 'pointer',
                fontSize: '0.72rem',
              }}
            >
              Refresh status
            </button>
          </div>
        </Field>

        <Field label="Shell Target" help="Choose whether WorkSpaces shell commands run inside the app container or on the host machine through the optional host executor.">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {([
              { value: 'container', label: 'Container', desc: 'Use the built-in runtime container shell' },
              { value: 'host', label: 'Host', desc: 'Use the optional host executor service' },
            ] as const).map(opt => {
              const active = settings.shellExecutionTarget === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('shellExecutionTarget', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8rem',
                  }}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Shell Approval Mode" help="Auto-approve runs simple allowlisted commands immediately and asks for approval on everything else. Ask First prompts before every non-blocked command.">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { value: 'auto-approve', label: 'Auto-approve', desc: 'Allowlisted commands run automatically; the rest require approval' },
              { value: 'ask-first', label: 'Ask First', desc: 'Approve each command' },
              { value: 'deny', label: 'Deny All', desc: 'Block all commands' },
            ].map(opt => {
              const active = settings.shellExecutionMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('shellExecutionMode', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8rem',
                  }}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Additional Allowed Commands" help="Comma-separated list of commands to allow (safe defaults like ls, git, npm are always allowed).">
          <input
            className="input-field"
            value={settings.shellAllowedCommands}
            onChange={e => update('shellAllowedCommands', e.target.value)}
            placeholder="docker-compose, make, go build"
          />
        </Field>

        {settings.shellExecutionTarget === 'host' && settings.shellExecutionMode !== 'deny' && (
          <>
            <Field label="Host Shell Allowed Roots" help="One absolute host path per line. Host shell commands must start in one of these approved roots. This constrains the working directory, not every possible file access inside an arbitrary shell command.">
              <textarea
                className="input-field"
                rows={4}
                value={settings.shellHostAllowedRoots}
                onChange={e => update('shellHostAllowedRoots', e.target.value)}
                placeholder={`~/.peakui/workspace\\n/home/user/Desktop`}
                style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace' }}
              />
            </Field>

            <Field label="Host Shell Allowed Env Vars" help="One host environment variable per line. Only these names are exposed to host shell commands, plus a minimal fixed runtime environment.">
              <textarea
                className="input-field"
                rows={4}
                value={settings.shellHostAllowedEnvVars}
                onChange={e => update('shellHostAllowedEnvVars', e.target.value)}
                placeholder={`PATH\nHOME\nUSER\nSHELL`}
                style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace' }}
              />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <Field label="Host Shell Timeout (ms)" help="Maximum execution time per host shell command.">
                <input
                  className="input-field"
                  type="number"
                  min={1000}
                  max={300000}
                  value={settings.shellHostMaxTimeoutMs}
                  onChange={e => update('shellHostMaxTimeoutMs', Number(e.target.value))}
                />
              </Field>

              <Field label="Host Output Cap (bytes)" help="Maximum combined stdout/stderr returned from a host shell command.">
                <input
                  className="input-field"
                  type="number"
                  min={16384}
                  max={1048576}
                  value={settings.shellHostMaxOutputBytes}
                  onChange={e => update('shellHostMaxOutputBytes', Number(e.target.value))}
                />
              </Field>
            </div>
          </>
        )}

        <Field label="Filesystem Access" help="Grant WorkSpaces read-only access to approved host paths. This is separate from shell execution and never permits writes.">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { value: 'read-only', label: 'Read-only', desc: 'Allow WorkSpaces to inspect approved host files and directories' },
              { value: 'deny', label: 'Deny', desc: 'Block host filesystem access entirely' },
            ].map(opt => {
              const active = settings.openClawFileAccessMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('openClawFileAccessMode', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8rem',
                  }}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Approved Host Paths" help="One absolute host path per line. WorkSpaces can only read inside these approved roots.">
          <textarea
            className="input-field"
            rows={5}
            value={settings.openClawAllowedPaths}
            onChange={e => update('openClawAllowedPaths', e.target.value)}
            placeholder={`/home\n/tmp`}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace' }}
          />
          <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.5 }}>
            This deployment currently mounts the host <code>/home</code> tree and <code>/tmp</code> into the app container in read-only mode. Approve a broad root like <code>/home</code> if you want WorkSpaces to inspect user directories, or approve a narrower subfolder if you want tighter scope.
          </div>
        </Field>

        <Field label="Filesystem Writes" help="Control whether WorkSpaces can create folders or write text files inside approved writable roots.">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { value: 'deny', label: 'Deny', desc: 'Block file creation and edits entirely' },
              { value: 'ask-first', label: 'Ask First', desc: 'Require approval before each write or mkdir action' },
              { value: 'auto-approve', label: 'Auto-approve', desc: 'Automatically allow writes inside approved writable roots' },
            ].map(opt => {
              const active = settings.openClawFileWriteMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('openClawFileWriteMode', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8rem',
                  }}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Approved Writable Roots" help="One absolute host path per line. WorkSpaces can only create files, edit files, or make folders inside these roots.">
          <textarea
            className="input-field"
            rows={4}
            value={settings.openClawWritablePaths}
            onChange={e => update('openClawWritablePaths', e.target.value)}
            placeholder={`~/.peakui/workspace`}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace' }}
          />
          <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.5 }}>
            The default managed workspace root is mounted read-write for WorkSpaces. If you want broader writable scope later, add an explicit Docker bind mount first, then approve only the narrowest host root you actually want the agent to edit.
          </div>
        </Field>

        <Field label="Code Execution Sandbox" help="Run short Python or Node scripts in a managed WorkSpaces workspace with timeouts, output caps, and approval gates.">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { value: 'deny', label: 'Deny', desc: 'Block all code execution' },
              { value: 'ask-first', label: 'Ask First', desc: 'Require approval before each code run' },
              { value: 'auto-approve', label: 'Auto-approve', desc: 'Automatically run sandbox requests in the managed workspace' },
            ].map(opt => {
              const active = settings.openClawCodeExecutionMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('openClawCodeExecutionMode', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8rem',
                  }}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Browser Control" help="Allow WorkSpaces to browse public websites, inspect links/forms, and optionally submit forms with approval.">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { value: 'deny', label: 'Deny', desc: 'Block all browser actions' },
              { value: 'read-only', label: 'Read-only', desc: 'Allow navigation and scraping, but block form fill/submit actions' },
              { value: 'ask-first', label: 'Ask First', desc: 'Allow navigation and require approval before form submits' },
            ].map(opt => {
              const active = settings.openClawBrowserMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('openClawBrowserMode', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8rem',
                  }}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.5 }}>
            Browser control is limited to public <code>http</code>/<code>https</code> pages. Local network targets, non-standard ports, and private hosts are blocked by design.
          </div>
        </Field>

        <Field label="UWAF Browser" help="Unified Web Agent Framework: dual-mode browser that supports both Clear Web (direct) and Dark Web (Tor) research with sanitization.">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { value: 'deny', label: 'Deny', desc: 'Block all UWAF browser actions' },
              { value: 'direct', label: 'Direct', desc: 'Clear web only — standard browsing with sanitization' },
              { value: 'stealth', label: 'Stealth', desc: 'Tor-routed anonymous browsing including .onion sites' },
            ].map(opt => {
              const active = settings.openClawUwafBrowserMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('openClawUwafBrowserMode', opt.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: `1px solid ${active ? (opt.value === 'stealth' ? '#a855f7' : 'var(--accent-primary)') : 'var(--border-color)'}`,
                    background: active ? (opt.value === 'stealth' ? 'rgba(168, 85, 247, 0.1)' : 'var(--accent-soft)') : 'var(--bg-glass)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8rem',
                  }}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {settings.openClawUwafBrowserMode !== 'deny' && (
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Field label="Default Mode" help="Set whether the UWAF browser defaults to Direct (Clear Web) or Stealth (Tor-routed) mode.">
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { value: 'direct', label: 'Direct (Clear Web)' },
                    { value: 'stealth', label: 'Stealth (Tor)' },
                  ].map(opt => {
                    const active = settings.openClawUwafDefaultMode === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => update('openClawUwafDefaultMode', opt.value)}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                          background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: '0.8rem',
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label="Live Browser" help="Launch a real interactive browser surface in the sidebar. When enabled, you can watch the actual browser session live and take over control using the Take Over button. When disabled, WorkSpaces can still use browser text extraction, but no live visual browser panel is shown.">
                <div
                  onClick={() => update('openClawUwafLiveBrowser', !settings.openClawUwafLiveBrowser)}
                  style={{
                    position: 'relative', width: '48px', height: '26px', borderRadius: '13px',
                    background: settings.openClawUwafLiveBrowser ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)',
                    cursor: 'pointer', transition: 'all 0.2s',
                  }}
                >
                  <div style={{
                    position: 'absolute', top: '3px',
                    left: settings.openClawUwafLiveBrowser ? '25px' : '3px',
                    width: '20px', height: '20px', borderRadius: '50%',
                    background: '#fff', transition: 'left 0.2s',
                  }} />
                </div>
              </Field>
            </div>
          )}
          <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.5 }}>
            UWAF browser renders pages with a real browser engine, sanitizes content to Markdown, and blocks executable downloads. Stealth mode requires a running Tor proxy (tor-proxy service in Docker Compose). Page screenshots are disabled because the live browser is the visual browsing surface.
          </div>
        </Field>
      </Section>

      {/* Knowledge Base / RAG Settings */}
      <Section icon={<Database size={18} />} title="Knowledge Base (RAG)">
        <Field label="Enable Knowledge Base" help="When enabled, relevant content from your indexed documents will be automatically included in WorkSpaces responses and the shared chat-completion pipeline.">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              onClick={() => update('ragEnabled', !settings.ragEnabled)}
              style={{
                position: 'relative', width: '48px', height: '26px', borderRadius: '13px',
                background: settings.ragEnabled ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)',
                cursor: 'pointer', transition: 'all 0.2s',
                border: `1px solid ${settings.ragEnabled ? 'var(--accent-primary)' : 'var(--border-color)'}`,
              }}
            >
              <div style={{
                position: 'absolute', top: '3px', left: settings.ragEnabled ? '26px' : '3px',
                width: '18px', height: '18px', borderRadius: '50%',
                background: settings.ragEnabled ? 'var(--bg-primary)' : 'var(--text-secondary)',
                transition: 'all 0.2s',
              }} />
            </div>
            <span style={{ fontSize: '0.82rem', color: settings.ragEnabled ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
              {settings.ragEnabled ? 'Enabled — knowledge base will be queried for WorkSpaces responses' : 'Disabled — knowledge base will not be used for WorkSpaces responses'}
            </span>
          </div>
        </Field>

        <Field label="Search Results (topK)" help="Number of document chunks to retrieve for each query. Higher values = more context but more tokens. Use 'Full Access' to retrieve all matching chunks.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="1"
                max={settings.ragTopK === -1 ? 50 : 50}
                value={settings.ragTopK === -1 ? 50 : settings.ragTopK}
                onChange={e => update('ragTopK', Math.round(Number(e.target.value)))}
                style={{ flex: 1 }}
                disabled={settings.ragTopK === -1}
              />
              <input
                type="number"
                min="1"
                max="200"
                value={settings.ragTopK === -1 ? 50 : settings.ragTopK}
                onChange={e => {
                  const val = Math.round(Number(e.target.value));
                  update('ragTopK', val >= 1 && val <= 200 ? val : 8);
                }}
                style={{
                  width: '56px', padding: '6px 8px', borderRadius: '8px',
                  background: 'var(--bg-glass)', border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)', fontSize: '0.85rem', textAlign: 'center',
                }}
                disabled={settings.ragTopK === -1}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                onClick={() => update('ragTopK', settings.ragTopK === -1 ? 8 : -1)}
                style={{
                  position: 'relative', width: '44px', height: '24px', borderRadius: '12px',
                  background: settings.ragTopK === -1 ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)',
                  cursor: 'pointer', transition: 'all 0.2s',
                  border: `1px solid ${settings.ragTopK === -1 ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                  flexShrink: 0,
                }}
              >
                <div style={{
                  position: 'absolute', top: '2px', left: settings.ragTopK === -1 ? '24px' : '2px',
                  width: '16px', height: '16px', borderRadius: '50%',
                  background: settings.ragTopK === -1 ? 'var(--bg-primary)' : 'var(--text-secondary)',
                  transition: 'all 0.2s',
                }} />
              </div>
              <span style={{ fontSize: '0.78rem', color: settings.ragTopK === -1 ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
                {settings.ragTopK === -1
                  ? 'Full Access ON — retrieving ALL matching chunks (may use significant tokens)'
                  : 'Full Access OFF — limit chunks to selected count above'}
              </span>
            </div>
          </div>
        </Field>

        <Field label="RAG Search Mode" help="Semantic uses an embedding model for accurate meaning-based search. Keyword uses BM25 text matching — no extra model needed.">
          <div style={{ display: 'flex', gap: '10px' }}>
            {[
              { value: 'semantic', label: '🧠 Semantic', sub: 'Requires embedding model' },
              { value: 'keyword', label: '🔤 Keyword (BM25)', sub: 'No extra model needed' }
            ].map(opt => (
              <div
                key={opt.value}
                onClick={() => update('ragMode', opt.value)}
                style={{
                  flex: 1, padding: '12px', borderRadius: '10px', cursor: 'pointer',
                  border: `1px solid ${settings.ragMode === opt.value ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                  background: settings.ragMode === opt.value ? 'var(--accent-soft)' : 'var(--bg-glass)',
                  transition: 'all 0.15s'
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '2px' }}>{opt.label}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{opt.sub}</div>
              </div>
            ))}
          </div>
        </Field>

        {settings.ragMode === 'semantic' && (
          <>
            <Field label="Embedding Model" help="The Ollama model used to generate vector embeddings for your documents. Smaller models are faster; larger or multilingual models usually improve recall.">
              <div style={{ display: 'flex', gap: '8px' }}>
                <select
                  className="input-field"
                  value={settings.ragModel}
                  onChange={e => { update('ragModel', e.target.value); setEmbedStatus('idle'); }}
                  style={{ flex: 1 }}
                >
                  {RECOMMENDED_EMBEDDING_MODELS.map(model => (
                    <option key={model.name} value={model.name}>
                      {model.name}{installedModelKeys.has(ollamaModelKey(model.name)) ? ' · installed' : ' · pull required'}
                    </option>
                  ))}
                  {otherInstalledModels.length > 0 && (
                    <option disabled>── Other installed models ──</option>
                  )}
                  {otherInstalledModels.map(m => (
                    <option key={m.name} value={m.name}>{m.name}</option>
                  ))}
                </select>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}
                  onClick={handleTestEmbedding}
                  disabled={testingEmbed}
                >
                  {testingEmbed ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : 'Test'}
                </button>
              </div>
              {embedStatus === 'ok' && (
                <div style={{ marginTop: '6px', display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.78rem', color: 'var(--success)' }}>
                  <CheckCircle size={13} /> Model is available and working{embedDetails ? ` (${embedDetails})` : ''}
                </div>
              )}
              {embedStatus === 'error' && (
                <div style={{ marginTop: '6px', display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '0.78rem', color: '#fca5a5' }}>
                  <AlertCircle size={13} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ whiteSpace: 'pre-wrap' }}>{embedError || `Not available. Run: ollama pull ${settings.ragModel}`}</span>
                    <button
                      className="btn btn-secondary"
                      style={{ alignSelf: 'flex-start', padding: '6px 10px', fontSize: '0.75rem' }}
                      onClick={() => update('ragMode', 'keyword')}
                    >
                      Use Keyword/BM25
                    </button>
                  </div>
                </div>
              )}
            </Field>

            <div style={{ padding: '12px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <strong>Recommended embedding models:</strong>
              <div style={{ marginTop: '6px' }}>
                Pick a smaller model for speed and a larger or multilingual model when you want better retrieval quality on bigger libraries.
              </div>
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {RECOMMENDED_EMBEDDING_MODELS.map(m => {
                  const installed = installedModelKeys.has(ollamaModelKey(m.name));
                  return (
                  <div key={m.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <code style={{ fontSize: '0.78rem', color: 'var(--accent-primary)' }}>{m.name}</code>
                    <span>{m.size} · {m.note} · {installed ? 'installed' : 'pull required'}</span>
                  </div>
                  );
                })}
              </div>
              <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                Pull the selected model with: <code style={{ color: 'var(--accent-primary)' }}>ollama pull {settings.ragModel}</code>. If the test times out, switch to Keyword/BM25 or restart Ollama before using Semantic mode.
              </div>
            </div>
          </>
        )}

        {settings.ragMode === 'keyword' && (
          <div style={{ padding: '12px 14px', borderRadius: '10px', background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.2)', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            <CheckCircle size={14} color="var(--success)" style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
            <strong style={{ color: 'var(--success)' }}>No embedding model required.</strong> BM25 keyword search will be used. Documents you upload will be indexed immediately without calling any Ollama model.
          </div>
        )}
      </Section>

      {/* About */}
      <Section icon={<Bot size={18} />} title="About PeakUI">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          {[
            { label: 'Version', value: '1.0.0' },
            { label: 'Database', value: 'PostgreSQL' },
            { label: 'ORM', value: 'Prisma' },
            { label: 'Framework', value: 'Next.js 16' },
          ].map(item => (
            <div key={item.label} style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>{item.label}</div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{item.value}</div>
            </div>
          ))}
        </div>
      </Section>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
