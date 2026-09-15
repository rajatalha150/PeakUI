"use client";

import React, { useState, useEffect } from 'react';
import KnowledgeBase from './components/KnowledgeBase';
import SettingsPanel from './components/SettingsPanel';
import WorkspaceToolWorkspace from './components/WorkspaceToolWorkspace';
import CodingView from './components/CodingView';

const WORKSPACE_TOOL_VIEW_STORAGE = 'peakui-workspace-tool-view';

type WorkspaceToolView = 'workspace' | 'knowledge-base' | 'settings' | 'coding';

function normalizeWorkspaceToolView(): WorkspaceToolView {
  return 'workspace';
}

export default function Home() {
  const getStoredWorkspaceToolView = (): WorkspaceToolView => {
    if (typeof window === 'undefined') return 'workspace';
    try {
      window.sessionStorage.removeItem(WORKSPACE_TOOL_VIEW_STORAGE);
      return normalizeWorkspaceToolView();
    } catch {
      return 'workspace';
    }
  };

  const [workspaceToolView, setWorkspaceToolView] = useState<WorkspaceToolView>(getStoredWorkspaceToolView);
  const [workspaceToolSettingsRevision, setWorkspaceToolSettingsRevision] = useState(0);
  const [userSettings, setUserSettings] = useState<unknown>(null);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(WORKSPACE_TOOL_VIEW_STORAGE, workspaceToolView);
    } catch {
      // Ignore browser storage failures.
    }
  }, [workspaceToolView]);

  const closeMobileChrome = () => {
    // Legacy mobile chrome state removed; kept as integration hook.
  };

  const openWorkspaceToolWorkspace = () => {
    closeMobileChrome();
    setWorkspaceToolView('workspace');
  };

  const openWorkspaceToolKnowledgeBase = () => {
    closeMobileChrome();
    setWorkspaceToolView('knowledge-base');
  };

  const openSettings = () => {
    closeMobileChrome();
    setWorkspaceToolView('settings');
  };

  const openCoding = () => {
    closeMobileChrome();
    setWorkspaceToolView('coding');
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  return (
    <div className="app-container">
      <main className="main-content">
        {workspaceToolView === 'coding' ? (
          <CodingView onExit={openWorkspaceToolWorkspace} />
        ) : (
          <WorkspaceToolWorkspace
            view={workspaceToolView}
            settingsRevision={workspaceToolSettingsRevision}
            knowledgeBaseContent={<KnowledgeBase />}
            settingsContent={(
              <SettingsPanel
                onLogout={handleLogout}
                onOpenCoding={openCoding}
                onSettingsChange={(s) => {
                  setUserSettings(s);
                  setWorkspaceToolSettingsRevision(value => value + 1);
                }}
              />
            )}
            onNavigateToKnowledgeBase={openWorkspaceToolKnowledgeBase}
            onNavigateToWorkspace={openWorkspaceToolWorkspace}
            onNavigateToSettings={openSettings}
            onNavigateToCoding={openCoding}
          />
        )}
      </main>
    </div>
  );
}
