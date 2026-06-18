"use client";

import React, { useState, useEffect } from 'react';
import KnowledgeBase from './components/KnowledgeBase';
import SettingsPanel from './components/SettingsPanel';
import OpenClawWorkspace from './components/OpenClawWorkspace';

const OPENCLAW_VIEW_STORAGE = 'peakui-openclaw-view';

type OpenClawView = 'workspace' | 'knowledge-base' | 'settings';

function normalizeOpenClawView(): OpenClawView {
  return 'workspace';
}

export default function Home() {
  const getStoredOpenClawView = (): OpenClawView => {
    if (typeof window === 'undefined') return 'workspace';
    try {
      window.sessionStorage.removeItem(OPENCLAW_VIEW_STORAGE);
      return normalizeOpenClawView();
    } catch {
      return 'workspace';
    }
  };

  const [openClawView, setOpenClawView] = useState<OpenClawView>(getStoredOpenClawView);
  const [openClawSettingsRevision, setOpenClawSettingsRevision] = useState(0);
  const [userSettings, setUserSettings] = useState<unknown>(null);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(OPENCLAW_VIEW_STORAGE, openClawView);
    } catch {
      // Ignore browser storage failures.
    }
  }, [openClawView]);

  const closeMobileChrome = () => {
    // Legacy mobile chrome state removed; kept as integration hook.
  };

  const openOpenClawWorkspace = () => {
    closeMobileChrome();
    setOpenClawView('workspace');
  };

  const openOpenClawKnowledgeBase = () => {
    closeMobileChrome();
    setOpenClawView('knowledge-base');
  };

  const openSettings = () => {
    closeMobileChrome();
    setOpenClawView('settings');
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  return (
    <div className="app-container">
      <main className="main-content">
        <OpenClawWorkspace
          view={openClawView}
          settingsRevision={openClawSettingsRevision}
          knowledgeBaseContent={<KnowledgeBase />}
          settingsContent={(
            <SettingsPanel
              onLogout={handleLogout}
              onSettingsChange={(s) => {
                setUserSettings(s);
                setOpenClawSettingsRevision(value => value + 1);
              }}
            />
          )}
          onNavigateToKnowledgeBase={openOpenClawKnowledgeBase}
          onNavigateToWorkspace={openOpenClawWorkspace}
          onNavigateToSettings={openSettings}
        />
      </main>
    </div>
  );
}
