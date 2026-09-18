"use client";

import React, { useState, useEffect } from 'react';
import KnowledgeBase from './components/KnowledgeBase';
import SettingsPanel from './components/SettingsPanel';
import WorkspaceToolWorkspace from './components/WorkspaceToolWorkspace';

const WORKSPACE_TOOL_VIEW_STORAGE = 'peakui-workspace-tool-view';

type WorkspaceToolView = 'workspace' | 'knowledge-base' | 'settings';

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
    // Coding lives on its own route; open it in a new tab so it doesn't replace
    // the main interface and a refresh stays on the coding surface.
    window.open('/coder', '_blank', 'noopener,noreferrer');
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  return (
    <div className="app-container">
      <main className="main-content">
        <WorkspaceToolWorkspace
          view={workspaceToolView}
          settingsRevision={workspaceToolSettingsRevision}
          knowledgeBaseContent={<KnowledgeBase />}
          settingsContent={(
            <SettingsPanel
              onLogout={handleLogout}
              onOpenCoding={openCoding}
              onSettingsChange={() => {
                setWorkspaceToolSettingsRevision(value => value + 1);
              }}
            />
          )}
          onNavigateToKnowledgeBase={openWorkspaceToolKnowledgeBase}
          onNavigateToWorkspace={openWorkspaceToolWorkspace}
          onNavigateToSettings={openSettings}
          onNavigateToCoding={openCoding}
        />
      </main>
    </div>
  );
}
