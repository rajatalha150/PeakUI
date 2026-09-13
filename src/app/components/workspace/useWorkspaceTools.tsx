import { randomUUID } from '@/lib/uuid';
import { isWindowsHostPath } from '@/lib/workspace-tool-path-check';
import { type UwafBrowserToolResultEntry } from '@/lib/workspace-tool-tool-results';
import {
type WorkspaceToolArchiveDocumentToolRequest,
type WorkspaceToolBrowserToolRequest,
type WorkspaceToolCalendarDocumentToolRequest,
type WorkspaceToolCodeToolRequest,
type WorkspaceToolCsvDocumentToolRequest,
type WorkspaceToolEmailDocumentToolRequest,
type WorkspaceToolFetchSummarizeToolRequest,
type WorkspaceToolFilesystemToolRequest,
type WorkspaceToolImageGenerationToolRequest,
type WorkspaceToolMarkdownDocumentToolRequest,
type WorkspaceToolMermaidDocumentToolRequest,
type WorkspaceToolPdfDocumentToolRequest,
type WorkspaceToolSlidesDocumentToolRequest,
type WorkspaceToolTaxReturnToolRequest,
type WorkspaceToolUwafBrowserToolRequest,
type WorkspaceToolWordDocumentToolRequest,
type WorkspaceToolWorkbookDocumentToolRequest
} from '@/lib/workspace-tool-tools';
import React from 'react';
import { ArchiveDocumentToolResultEntry,BrowserToolResultEntry,CalendarDocumentToolResultEntry,CodeToolResultEntry,CsvDocumentToolResultEntry,EmailDocumentToolResultEntry,FetchSummarizeToolResultEntry,FilesystemToolResultEntry,HUMAN_BROWSER_ASSIST_TIMEOUT_MS,ImageGenerationToolResultEntry,IrsFormFieldEntry,IrsFormSummaryEntry,MarkdownDocumentToolResultEntry,MermaidDocumentToolResultEntry,PdfDocumentToolResultEntry,PendingToolApproval,ShellExecutionRequest,ShellOutputEntry,SlidesDocumentToolResultEntry,TaxReturnToolResultEntry,ToolApprovalResolution,WebToolResultEntry,WordDocumentToolResultEntry,WorkbookDocumentToolResultEntry,WorkspaceToolSettings,WorkspaceToolWorkspaceRecord,describeBrowserRequest,describeCodeExecutionRequest,describeCsvDocumentRequest,describeEmailDocumentRequest,describeFilesystemRequest,describeMarkdownDocumentRequest,describePdfDocumentRequest,describeTaxReturnRequest,describeWordDocumentRequest,describeWorkbookDocumentRequest,normalizeToolSources,safeJson } from './workspace-support';

export function useWorkspaceTools({setShellOutput, setExecutingCommand, currentSessionId, settings, pendingApprovalResolverRef, setPendingApproval, currentWorkspace, uwafBrowserMode, setBrowserModalOpen, setBrowserTakeoverRequestId, browserInterruptedRef, ragFolderPath, pendingApproval}: {setShellOutput: React.Dispatch<React.SetStateAction<ShellOutputEntry[]>>;
setExecutingCommand: React.Dispatch<React.SetStateAction<boolean>>;
currentSessionId: string | null;
settings: WorkspaceToolSettings | null;
pendingApprovalResolverRef: React.RefObject<((result: ToolApprovalResolution) => void) | null>;
setPendingApproval: React.Dispatch<React.SetStateAction<PendingToolApproval | null>>;
currentWorkspace: WorkspaceToolWorkspaceRecord;
uwafBrowserMode: "direct" | "stealth";
setBrowserModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
setBrowserTakeoverRequestId: React.Dispatch<React.SetStateAction<number>>;
browserInterruptedRef: React.RefObject<boolean>;
ragFolderPath: string | null;
pendingApproval: PendingToolApproval | null}) {
const appendShellOutput = (entry: ShellOutputEntry) => {
    setShellOutput(prev => [...prev, entry]);
    return entry;
  };

const truncateApprovalPreview = (value: string, maxChars = 2400) => {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars - 1).trimEnd()}…`;
  };

const executeShellCommand = async (
    shellRequest: ShellExecutionRequest
  ): Promise<ShellOutputEntry> => {
    setExecutingCommand(true);
    try {
      const execRes = await fetch('/api/workspace-tool/shell/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: shellRequest.command,
          approvalToken: shellRequest.approvalToken,
          auditId: shellRequest.auditId,
          sessionId: currentSessionId,
          messageId: shellRequest.messageId,
          description: shellRequest.description,
        }),
      });
      const execData = await execRes.json();
      const entry: ShellOutputEntry = {
        id: randomUUID(),
        messageId: shellRequest.messageId,
        target: execData.target === 'host' ? 'host' : 'container',
        auditId: typeof execData.auditId === 'string' ? execData.auditId : shellRequest.auditId,
        command: shellRequest.command,
        description: shellRequest.description,
        stdout: execData.stdout,
        stderr: execRes.ok ? execData.stderr : execData.error || 'Execution failed',
        exitCode: execRes.ok ? execData.exitCode : -1,
        duration: execRes.ok ? execData.duration : 0,
        success: execRes.ok ? Boolean(execData.success) : false,
      };
      return appendShellOutput(entry);
    } catch (error) {
      const entry: ShellOutputEntry = {
        id: randomUUID(),
        messageId: shellRequest.messageId,
        auditId: shellRequest.auditId,
        command: shellRequest.command,
        description: shellRequest.description,
        stderr: error instanceof Error ? error.message : 'Execution failed',
        exitCode: -1,
        duration: 0,
        success: false,
        target: settings?.shellExecutionTarget === 'host' ? 'host' : 'container',
      };
      return appendShellOutput(entry);
    } finally {
      setExecutingCommand(false);
    }
  };

const requestShellCommand = async (
    command: string,
    options: { description?: string; messageId: string }
  ): Promise<ShellOutputEntry> => {
    try {
      const res = await fetch('/api/workspace-tool/shell/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          description: options.description,
          sessionId: currentSessionId,
          messageId: options.messageId,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Shell command request failed');
      }

      if (data.autoApproved) {
        const fallbackDescription = typeof data.fallbackReason === 'string' && data.fallbackReason.trim()
          ? `${data.description || options.description || `Run: ${command}`}\n\n${data.fallbackReason}`
          : data.description || options.description;
        return await executeShellCommand({
          command,
          description: fallbackDescription,
          approvalToken: typeof data.approvalToken === 'string' ? data.approvalToken : undefined,
          messageId: options.messageId,
          auditId: typeof data.auditId === 'string' ? data.auditId : undefined,
        });
      }

      if (data.requiresApproval) {
        const fallbackDescription = typeof data.fallbackReason === 'string' && data.fallbackReason.trim()
          ? `${data.description || options.description || `Run: ${command}`}\n\n${data.fallbackReason}`
          : data.description || options.description;
        return await new Promise<ShellOutputEntry>(resolve => {
          pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
          setPendingApproval({
            kind: 'shell',
            title: data.target === 'host' ? 'Host Shell Command Approval' : 'Shell Command Approval',
            description: data.reason
              ? `${fallbackDescription || `Run: ${command}`}\n\nReason: ${data.reason}`
              : fallbackDescription,
            previewLabel: 'Command',
            previewContent: `$ ${command}`,
            approvalToken: typeof data.approvalToken === 'string' ? data.approvalToken : undefined,
            messageId: options.messageId,
            request: {
              command,
              description: fallbackDescription,
              auditId: typeof data.auditId === 'string' ? data.auditId : undefined,
            },
          });
        });
      }

      const entry: ShellOutputEntry = {
        id: randomUUID(),
        messageId: options.messageId,
        target: data.target === 'host' ? 'host' : 'container',
        auditId: typeof data.auditId === 'string' ? data.auditId : undefined,
        command,
        description: options.description,
        stderr: `Blocked: ${data.reason || 'Command was rejected'}${typeof data.fallbackReason === 'string' ? `\n${data.fallbackReason}` : ''}`,
        exitCode: -1,
        duration: 0,
        success: false,
        blocked: true,
      };
      return appendShellOutput(entry);
    } catch (error) {
      console.error('Shell command request failed:', error);
      const entry: ShellOutputEntry = {
        id: randomUUID(),
        messageId: options.messageId,
        command,
        description: options.description,
        stderr: error instanceof Error ? error.message : 'Shell command request failed',
        exitCode: -1,
        duration: 0,
        success: false,
        target: settings?.shellExecutionTarget === 'host' ? 'host' : 'container',
      };
      return appendShellOutput(entry);
    }
  };

const executeFilesystemAction = async (
    request: WorkspaceToolFilesystemToolRequest & { approvalToken?: string },
  ): Promise<FilesystemToolResultEntry> => {
    try {
      const res = await fetch('/api/workspace-tool/filesystem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json();
      if (!res.ok) {
        const requestDiagnostic = data && typeof data === 'object'
          ? (data as { diagnostics?: { request?: { actionRequired?: unknown } } }).diagnostics?.request
          : undefined;
        return {
          action: request.action,
          path: request.path,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Filesystem request failed',
          code: typeof data.code === 'string' ? data.code : undefined,
          actionRequired: typeof data.actionRequired === 'string'
            ? data.actionRequired
            : typeof requestDiagnostic?.actionRequired === 'string'
              ? requestDiagnostic.actionRequired
              : undefined,
        };
      }

      return {
        action: request.action,
        path: typeof data.path === 'string' ? data.path : request.path,
        kind: data.kind === 'directory' ? 'directory' : data.kind === 'file' ? 'file' : undefined,
        content: typeof data.content === 'string' ? data.content : undefined,
        truncated: Boolean(data.truncated),
        size: typeof data.size === 'number' ? data.size : undefined,
        modifiedAt: typeof data.modifiedAt === 'string' ? data.modifiedAt : undefined,
        created: Boolean(data.created),
        bytesWritten: typeof data.bytesWritten === 'number' ? data.bytesWritten : undefined,
        entries: Array.isArray(data.entries)
          ? data.entries
            .filter((entry: unknown): entry is { name: string; path: string; kind: 'file' | 'directory'; size?: number } => {
              if (!entry || typeof entry !== 'object') return false;
              const candidate = entry as Record<string, unknown>;
              return typeof candidate.name === 'string'
                && typeof candidate.path === 'string'
                && (candidate.kind === 'file' || candidate.kind === 'directory');
            })
            .map((entry: { name: string; path: string; kind: 'file' | 'directory'; size?: number }) => ({
              name: entry.name,
              path: entry.path,
              kind: entry.kind,
              size: typeof entry.size === 'number' ? entry.size : undefined,
            }))
          : undefined,
        success: true,
      };
    } catch (error) {
      return {
        action: request.action,
        path: request.path,
        success: false,
        error: error instanceof Error ? error.message : 'Filesystem request failed',
      };
    }
  };

const requestFilesystemAction = async (
    request: WorkspaceToolFilesystemToolRequest,
    options: { messageId: string }
  ): Promise<FilesystemToolResultEntry> => {
    if (request.action === 'list' || request.action === 'read' || request.action === 'stat') {
      return await executeFilesystemAction(request);
    }

    try {
      const res = await fetch('/api/workspace-tool/filesystem/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json();

      if (!res.ok) {
        const requestDiagnostic = data && typeof data === 'object'
          ? (data as { diagnostics?: { request?: { actionRequired?: unknown } } }).diagnostics?.request
          : undefined;
        return {
          action: request.action,
          path: request.path,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Filesystem write request failed',
          code: typeof data.code === 'string' ? data.code : undefined,
          actionRequired: typeof data.actionRequired === 'string'
            ? data.actionRequired
            : typeof requestDiagnostic?.actionRequired === 'string'
              ? requestDiagnostic.actionRequired
              : undefined,
        };
      }

      if (data.autoApproved) {
        return await executeFilesystemAction({
          ...request,
          approvalToken: typeof data.approvalToken === 'string' ? data.approvalToken : undefined,
        });
      }

      if (data.requiresApproval) {
        return await new Promise<FilesystemToolResultEntry>(resolve => {
          pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
          setPendingApproval({
            kind: 'filesystem',
            title: 'Filesystem Write Approval',
            description: data.description || describeFilesystemRequest(request.action, request.path),
            previewLabel: 'Requested change',
            previewContent: truncateApprovalPreview(
              request.action === 'mkdir'
                ? request.path
                : `${request.path}\n\n${request.content || ''}`
            ),
            approvalToken: typeof data.approvalToken === 'string' ? data.approvalToken : undefined,
            messageId: options.messageId,
            request,
          });
        });
      }

      return {
        action: request.action,
        path: request.path,
        success: false,
        error: data.reason || 'Filesystem write was rejected',
        code: typeof data.code === 'string' ? data.code : undefined,
        actionRequired: typeof data.actionRequired === 'string' ? data.actionRequired : undefined,
      };
    } catch (error) {
      return {
        action: request.action,
        path: request.path,
        success: false,
        error: error instanceof Error ? error.message : 'Filesystem write request failed',
      };
    }
  };

const executeCodeAction = async (
    request: WorkspaceToolCodeToolRequest & { sessionId: string; approvalToken?: string },
  ): Promise<CodeToolResultEntry> => {
    try {
      const res = await fetch('/api/workspace-tool/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          runtime: request.runtime,
          workingDirectory: '',
          scriptPath: '',
          command: '',
          stdout: '',
          stderr: typeof data.error === 'string' ? data.error : 'Code execution failed',
          exitCode: -1,
          duration: 0,
          success: false,
          files: [],
          error: typeof data.error === 'string' ? data.error : 'Code execution failed',
        };
      }

      return {
        runtime: request.runtime,
        workingDirectory: typeof data.workingDirectory === 'string' ? data.workingDirectory : '',
        scriptPath: typeof data.scriptPath === 'string' ? data.scriptPath : '',
        command: typeof data.command === 'string' ? data.command : '',
        stdout: typeof data.stdout === 'string' ? data.stdout : '',
        stderr: typeof data.stderr === 'string' ? data.stderr : '',
        exitCode: typeof data.exitCode === 'number' ? data.exitCode : data.exitCode === null ? null : -1,
        duration: typeof data.duration === 'number' ? data.duration : 0,
        success: Boolean(data.success),
        outputTruncated: Boolean(data.outputTruncated),
        files: Array.isArray(data.files)
          ? data.files
            .filter((entry: unknown): entry is CodeToolResultEntry['files'][number] => {
              if (!entry || typeof entry !== 'object') return false;
              const candidate = entry as Record<string, unknown>;
              return typeof candidate.path === 'string'
                && typeof candidate.relativePath === 'string'
                && (candidate.kind === 'file' || candidate.kind === 'directory');
            })
            .map((entry: CodeToolResultEntry['files'][number]) => ({
              path: entry.path,
              relativePath: entry.relativePath,
              kind: entry.kind,
              size: typeof entry.size === 'number' ? entry.size : undefined,
              modifiedAt: typeof entry.modifiedAt === 'string' ? entry.modifiedAt : undefined,
            }))
          : [],
      };
    } catch (error) {
      return {
        runtime: request.runtime,
        workingDirectory: '',
        scriptPath: '',
        command: '',
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Code execution failed',
        exitCode: -1,
        duration: 0,
        success: false,
        files: [],
        error: error instanceof Error ? error.message : 'Code execution failed',
      };
    }
  };

const requestCodeExecution = async (
    request: WorkspaceToolCodeToolRequest,
    options: { messageId: string; sessionId: string }
  ): Promise<CodeToolResultEntry> => {
    // Resolve the code-sandbox workspacePath so generated projects land in the
    // active per-user workspace, not the shared workspace root:
    //  - absolute / Windows host path (host-access mode): pass through unchanged
    //  - relative path from the model: anchor it under the active workspace's
    //    managed relative path (e.g. users/<id>/workspaces/default/<project>)
    //  - omitted: use the active workspace directly, else the server's session fallback
    const aiWorkspacePath = request.workspacePath?.trim();
    let resolvedWorkspacePath: string | undefined;
    if (aiWorkspacePath && (aiWorkspacePath.startsWith('/') || isWindowsHostPath(aiWorkspacePath))) {
      resolvedWorkspacePath = aiWorkspacePath;
    } else if (aiWorkspacePath) {
      const base = currentWorkspace?.relativePath?.replace(/\/+$/, '');
      resolvedWorkspacePath = base
        ? `${base}/${aiWorkspacePath.replace(/^\/+/, '')}`
        : aiWorkspacePath;
    } else {
      resolvedWorkspacePath = currentWorkspace?.relativePath || undefined;
    }

    const payload = {
      ...request,
      sessionId: options.sessionId,
      workspacePath: resolvedWorkspacePath,
    };

    try {
      const res = await fetch('/api/workspace-tool/code/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Code execution request failed');
      }

      if (data.autoApproved) {
        return await executeCodeAction(payload);
      }

      if (data.requiresApproval) {
        return await new Promise<CodeToolResultEntry>(resolve => {
          pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
          setPendingApproval({
            kind: 'code',
            title: 'Code Sandbox Approval',
            description: data.description || describeCodeExecutionRequest(request),
            previewLabel: 'Code preview',
            previewContent: truncateApprovalPreview(request.code),
            approvalToken: typeof data.approvalToken === 'string' ? data.approvalToken : undefined,
            messageId: options.messageId,
            request: payload,
          });
        });
      }

      return {
        runtime: request.runtime,
        workingDirectory: '',
        scriptPath: '',
        command: '',
        stdout: '',
        stderr: data.reason || 'Code execution was rejected',
        exitCode: -1,
        duration: 0,
        success: false,
        files: [],
        error: data.reason || 'Code execution was rejected',
      };
    } catch (error) {
      return {
        runtime: request.runtime,
        workingDirectory: '',
        scriptPath: '',
        command: '',
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Code execution request failed',
        exitCode: -1,
        duration: 0,
        success: false,
        files: [],
        error: error instanceof Error ? error.message : 'Code execution request failed',
      };
    }
  };

const executeBrowserAction = async (
    request: WorkspaceToolBrowserToolRequest & { sessionId: string; approvalToken?: string },
  ): Promise<BrowserToolResultEntry> => {
    try {
      const res = await fetch('/api/workspace-tool/browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          action: request.action,
          currentUrl: '',
          title: '',
          text: '',
          links: [],
          forms: [],
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Browser action failed',
        };
      }

      return {
        action: request.action,
        currentUrl: typeof data.currentUrl === 'string' ? data.currentUrl : '',
        title: typeof data.title === 'string' ? data.title : '',
        text: typeof data.text === 'string' ? data.text : '',
        html: typeof data.html === 'string' ? data.html : undefined,
        links: Array.isArray(data.links)
          ? data.links
            .filter((entry: unknown): entry is BrowserToolResultEntry['links'][number] => {
              if (!entry || typeof entry !== 'object') return false;
              const candidate = entry as Record<string, unknown>;
              return typeof candidate.index === 'number'
                && typeof candidate.text === 'string'
                && typeof candidate.url === 'string';
            })
            .map((entry: BrowserToolResultEntry['links'][number]) => ({
              index: entry.index,
              text: entry.text,
              url: entry.url,
            }))
          : [],
        forms: Array.isArray(data.forms)
          ? data.forms
            .filter((entry: unknown): entry is BrowserToolResultEntry['forms'][number] => {
              if (!entry || typeof entry !== 'object') return false;
              const candidate = entry as Record<string, unknown>;
              return typeof candidate.index === 'number'
                && typeof candidate.action === 'string'
                && (candidate.method === 'GET' || candidate.method === 'POST')
                && Array.isArray(candidate.fields);
            })
            .map((entry: BrowserToolResultEntry['forms'][number]) => ({
              index: entry.index,
              action: entry.action,
              method: entry.method,
              fields: Array.isArray(entry.fields)
                ? entry.fields
                  .filter((field: unknown): field is BrowserToolResultEntry['forms'][number]['fields'][number] => {
                    if (!field || typeof field !== 'object') return false;
                    const candidate = field as Record<string, unknown>;
                    return typeof candidate.name === 'string' && typeof candidate.type === 'string';
                  })
                  .map((field: BrowserToolResultEntry['forms'][number]['fields'][number]) => ({
                    name: field.name,
                    type: field.type,
                    value: typeof field.value === 'string' ? field.value : undefined,
                  }))
                : [],
            }))
          : [],
        pendingFormValues: data.pendingFormValues && typeof data.pendingFormValues === 'object' && !Array.isArray(data.pendingFormValues)
          ? Object.fromEntries(Object.entries(data.pendingFormValues).filter(([, value]) => typeof value === 'string')) as Record<string, string>
          : undefined,
        submitted: data.submitted && typeof data.submitted === 'object'
          ? {
              url: typeof data.submitted.url === 'string' ? data.submitted.url : '',
              method: data.submitted.method === 'POST' ? 'POST' : 'GET',
              fieldCount: typeof data.submitted.fieldCount === 'number' ? data.submitted.fieldCount : 0,
            }
          : undefined,
        success: true,
      };
    } catch (error) {
      return {
        action: request.action,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        success: false,
        error: error instanceof Error ? error.message : 'Browser action failed',
      };
    }
  };

const requestBrowserAction = async (
    request: WorkspaceToolBrowserToolRequest,
    options: { messageId: string; sessionId: string }
  ): Promise<BrowserToolResultEntry> => {
    const payload = { ...request, sessionId: options.sessionId };

    if (request.action !== 'submit') {
      return await executeBrowserAction(payload);
    }

    try {
      const res = await fetch('/api/workspace-tool/browser/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Browser request failed');
      }

      if (data.requiresApproval) {
        return await new Promise<BrowserToolResultEntry>(resolve => {
          pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
          setPendingApproval({
            kind: 'browser',
            title: 'Browser Form Approval',
            description: data.description || describeBrowserRequest(request),
            previewLabel: 'Submit target',
            previewContent: truncateApprovalPreview(
              `${data.method || 'GET'} ${data.submitUrl || ''}\nFields: ${typeof data.fieldCount === 'number' ? data.fieldCount : 0}`
            ),
            approvalToken: typeof data.approvalToken === 'string' ? data.approvalToken : undefined,
            messageId: options.messageId,
            request: payload,
          });
        });
      }

      if (data.allowed === false) {
        return {
          action: request.action,
          currentUrl: '',
          title: '',
          text: '',
          links: [],
          forms: [],
          success: false,
          error: data.reason || 'Browser submit was rejected',
        };
      }

      return await executeBrowserAction(payload);
    } catch (error) {
      return {
        action: request.action,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        success: false,
        error: error instanceof Error ? error.message : 'Browser request failed',
      };
    }
  };

const requestUwafBrowserAction = async (
    request: WorkspaceToolUwafBrowserToolRequest,
    options: { messageId: string; sessionId: string }
  ): Promise<UwafBrowserToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      browserMode: request.browserMode || uwafBrowserMode,
    };

    if (request.action === 'wait_for_user') {
      return await waitForHumanBrowserAssistance(
        payload as WorkspaceToolUwafBrowserToolRequest & { sessionId: string; browserMode: 'direct' | 'stealth' }
      );
    }

    if (request.action !== 'submit' && request.action !== 'research_batch') {
      return await executeUwafBrowserAction(payload);
    }

    try {
      const res = await fetch('/api/workspace-tool/uwaf-browser/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await safeJson<{ error?: string; reason?: string; requiresApproval?: boolean; allowed?: boolean; description?: string; approvalToken?: string }>(res)

      if (!res.ok) {
        throw new Error(data.error || 'UWAF browser request failed');
      }

      if (data.requiresApproval) {
        return await new Promise<UwafBrowserToolResultEntry>(resolve => {
          pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
          setPendingApproval({
            kind: 'unified_browser',
            title: 'UWAF Browser Approval',
            description: data.description || `${request.action} request requires approval`,
            previewLabel: 'Action details',
            previewContent: truncateApprovalPreview(
              `Action: ${request.action}\nURL: ${request.url || 'current page'}\nMode: ${payload.browserMode}`
            ),
            approvalToken: typeof data.approvalToken === 'string' ? data.approvalToken : undefined,
            messageId: options.messageId,
            request: payload as WorkspaceToolUwafBrowserToolRequest & { sessionId: string },
          });
        });
      }

      if (data.allowed === false) {
        return {
          action: request.action,
          currentUrl: '',
          title: '',
          text: '',
          links: [],
          forms: [],
          mode: payload.browserMode,
          source: payload.browserMode === 'stealth' ? 'dark_web' as const : 'clear_web' as const,
          success: false,
          error: data.reason || 'UWAF browser action was rejected',
        };
      }

      return await executeUwafBrowserAction(payload);
    } catch (error) {
      return {
        action: request.action,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        mode: payload.browserMode,
        source: payload.browserMode === 'stealth' ? 'dark_web' as const : 'clear_web' as const,
        success: false,
        error: error instanceof Error ? error.message : 'UWAF browser request failed',
      };
    }
  };

const waitForHumanBrowserAssistance = async (
    request: WorkspaceToolUwafBrowserToolRequest & { sessionId: string; browserMode: 'direct' | 'stealth' }
  ): Promise<UwafBrowserToolResultEntry> => {
    if (settings?.workspaceToolUwafLiveBrowser === false) {
      return {
        action: request.action,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        mode: request.browserMode,
        source: request.browserMode === 'stealth' ? 'dark_web' : 'clear_web',
        success: false,
        error: 'Live Browser is disabled in Settings, so human browser assistance is unavailable.',
      };
    }

    setBrowserModalOpen(true);
    setBrowserTakeoverRequestId(previous => previous + 1);

    const startedAt = Date.now();
    while (!browserInterruptedRef.current && Date.now() - startedAt < 15000) {
      await new Promise(resolve => window.setTimeout(resolve, 250));
    }

    if (!browserInterruptedRef.current) {
      return {
        action: request.action,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        mode: request.browserMode,
        source: request.browserMode === 'stealth' ? 'dark_web' : 'clear_web',
        success: false,
        error: 'The live browser did not enter human-control mode.',
      };
    }

    while (browserInterruptedRef.current && Date.now() - startedAt < HUMAN_BROWSER_ASSIST_TIMEOUT_MS) {
      await new Promise(resolve => window.setTimeout(resolve, 500));
    }

    if (browserInterruptedRef.current) {
      return {
        action: request.action,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        mode: request.browserMode,
        source: request.browserMode === 'stealth' ? 'dark_web' : 'clear_web',
        success: false,
        error: 'Timed out waiting for human browser assistance.',
      };
    }

    const observed = await executeUwafBrowserAction({
      action: 'extract',
      sessionId: request.sessionId,
      browserMode: request.browserMode,
      mode: request.mode || 'summary',
    });

    return {
      ...observed,
      action: request.action,
      text: [
        request.description?.trim()
          ? `Human assistance completed: ${request.description.trim()}`
          : 'Human assistance completed.',
        observed.text || observed.markdown || '',
      ].filter(Boolean).join('\n\n'),
    };
  };

const executeUwafBrowserAction = async (payload: Record<string, unknown>): Promise<UwafBrowserToolResultEntry> => {
    try {
      const res = await fetch('/api/workspace-tool/uwaf-browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      // Use safeJson so a Next.js 5xx HTML page does not surface to the
      // model as `Unexpected token '<', "<html>...`; the route's own
      // `if (!res.ok)` branch below will then format a clean error.
      // The runtime shape is UwafBrowserResult, but safeJson returns {}
      // when the body is non-JSON, so we use a permissive type here and
      // rely on the existing typeof/Array.isArray guards.
      const data = await safeJson<Record<string, unknown>>(res) as Partial<{
        action: string
        currentUrl: string
        title: string
        text: string
        links: unknown[]
        forms: unknown[]
        tables: unknown[]
        markdown: string
        mode: 'direct' | 'stealth'
        stealthProfile: 'normal' | 'high'
        source: 'clear_web' | 'dark_web'
        success: boolean
        error: string
        requestedUrl: string
        requestedQuery: string
        finalUrl: string
        redirected: boolean
        httpStatus: number
        queryMatched: boolean
        resultCount: number
        antiBotDetected: boolean
        loginDetected: boolean
        jsErrors: string[]
        networkErrors: string[]
        failureCode: string
        failureDetail: string
        pageChanged: boolean
        navigationChanged: boolean
        selectorMatched: boolean
        waitTimedOut: boolean
        searchEngine: string
        searchProviderId: string
        searchAttempts: unknown[]
        tabs: unknown[]
        activeTabIndex: number
        observations: string[]
        batchResults: unknown
      }>

      if (!res.ok) {
        return {
          action: payload.action as string,
          currentUrl: typeof data.currentUrl === 'string' ? data.currentUrl : '',
          title: typeof data.title === 'string' ? data.title : '',
          text: typeof data.text === 'string' ? data.text : '',
          links: Array.isArray(data.links) ? data.links as UwafBrowserToolResultEntry['links'] : [],
          forms: Array.isArray(data.forms) ? data.forms as UwafBrowserToolResultEntry['forms'] : [],
          mode: (payload.browserMode as 'direct' | 'stealth') || 'direct',
          source: payload.browserMode === 'stealth' ? 'dark_web' as const : 'clear_web' as const,
          success: false,
        error: typeof data.error === 'string' ? data.error : `UWAF browser action failed: ${res.status}`,
        failureCode: typeof data.failureCode === 'string' ? data.failureCode : undefined,
        failureDetail: typeof data.failureDetail === 'string' ? data.failureDetail : undefined,
        observations: Array.isArray(data.observations)
            ? data.observations.filter((item: unknown): item is string => typeof item === 'string')
            : [],
        };
      }

      return {
        action: typeof data.action === 'string' ? data.action : '',
        currentUrl: typeof data.currentUrl === 'string' ? data.currentUrl : '',
        title: typeof data.title === 'string' ? data.title : '',
        text: typeof data.text === 'string' ? data.text : (typeof data.markdown === 'string' ? data.markdown : ''),
        links: Array.isArray(data.links) ? data.links as UwafBrowserToolResultEntry['links'] : [],
        forms: Array.isArray(data.forms) ? data.forms as UwafBrowserToolResultEntry['forms'] : [],
        tables: Array.isArray(data.tables) ? data.tables as UwafBrowserToolResultEntry['tables'] : [],
        markdown: typeof data.markdown === 'string' ? data.markdown : '',
        mode: data.mode === 'stealth' ? 'stealth' : 'direct',
        stealthProfile: data.stealthProfile === 'high' ? 'high' : data.stealthProfile === 'normal' ? 'normal' : undefined,
        source: data.source === 'dark_web' ? 'dark_web' : 'clear_web',
        success: data.success !== false,
        error: typeof data.error === 'string' ? data.error : undefined,
        requestedUrl: typeof data.requestedUrl === 'string' ? data.requestedUrl : undefined,
        requestedQuery: typeof data.requestedQuery === 'string' ? data.requestedQuery : undefined,
        finalUrl: typeof data.finalUrl === 'string' ? data.finalUrl : undefined,
        redirected: typeof data.redirected === 'boolean' ? data.redirected : undefined,
        httpStatus: typeof data.httpStatus === 'number' ? data.httpStatus : undefined,
        queryMatched: typeof data.queryMatched === 'boolean' ? data.queryMatched : undefined,
        resultCount: typeof data.resultCount === 'number' ? data.resultCount : undefined,
        antiBotDetected: typeof data.antiBotDetected === 'boolean' ? data.antiBotDetected : undefined,
        loginDetected: typeof data.loginDetected === 'boolean' ? data.loginDetected : undefined,
        jsErrors: Array.isArray(data.jsErrors) ? data.jsErrors.filter((item: unknown): item is string => typeof item === 'string') : [],
        networkErrors: Array.isArray(data.networkErrors) ? data.networkErrors.filter((item: unknown): item is string => typeof item === 'string') : [],
        failureCode: typeof data.failureCode === 'string' ? data.failureCode : undefined,
        failureDetail: typeof data.failureDetail === 'string' ? data.failureDetail : undefined,
        pageChanged: typeof data.pageChanged === 'boolean' ? data.pageChanged : undefined,
        navigationChanged: typeof data.navigationChanged === 'boolean' ? data.navigationChanged : undefined,
        selectorMatched: typeof data.selectorMatched === 'boolean' ? data.selectorMatched : undefined,
        waitTimedOut: typeof data.waitTimedOut === 'boolean' ? data.waitTimedOut : undefined,
        searchEngine: typeof data.searchEngine === 'string' ? data.searchEngine : undefined,
        searchProviderId: typeof data.searchProviderId === 'string' ? data.searchProviderId : undefined,
        searchAttempts: Array.isArray(data.searchAttempts)
          ? data.searchAttempts.filter((item: unknown): item is NonNullable<UwafBrowserToolResultEntry['searchAttempts']>[number] => {
              if (!item || typeof item !== 'object') return false;
              const attempt = item as Record<string, unknown>;
              return typeof attempt.providerId === 'string'
                && typeof attempt.providerLabel === 'string'
                && typeof attempt.success === 'boolean'
                && typeof attempt.resultCount === 'number';
            })
          : [],
        tabs: Array.isArray(data.tabs) ? data.tabs as UwafBrowserToolResultEntry['tabs'] : [],
        activeTabIndex: typeof data.activeTabIndex === 'number' ? data.activeTabIndex : undefined,
        observations: Array.isArray(data.observations)
          ? data.observations.filter((item: unknown): item is string => typeof item === 'string')
          : [],
        batchResults: data.batchResults as UwafBrowserToolResultEntry['batchResults'],
      };
    } catch (error) {
      return {
        action: payload.action as string,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        mode: (payload.browserMode as 'direct' | 'stealth') || 'direct',
        source: payload.browserMode === 'stealth' ? 'dark_web' as const : 'clear_web' as const,
        success: false,
        error: error instanceof Error ? error.message : 'UWAF browser action failed',
      };
    }
  };

const requestWebContext = async (
    query: string,
    options: { description?: string } = {},
  ): Promise<WebToolResultEntry> => {
    try {
      const res = await fetch('/api/web/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();

      if (!res.ok) {
        return {
          query,
          description: options.description,
          context: '',
          sources: [],
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Web research request failed',
        };
      }

      return {
        query,
        description: options.description,
        context: typeof data.context === 'string' ? data.context : '',
        sources: normalizeToolSources(data.sources),
        success: true,
      };
    } catch (error) {
      return {
        query,
        description: options.description,
        context: '',
        sources: [],
        success: false,
        error: error instanceof Error ? error.message : 'Web research request failed',
      };
    }
  };

const executeTaxReturnAction = async (
    request: WorkspaceToolTaxReturnToolRequest & { sessionId: string; messageId?: string },
  ): Promise<TaxReturnToolResultEntry> => {
    try {
      const res = await fetch('/api/workspace-tool/tax', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          action: request.action,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Tax PDF generation failed',
        };
      }

      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      const draft = data.draft && typeof data.draft === 'object'
        ? data.draft as Record<string, unknown>
        : {};

      const forms = Array.isArray(data.forms)
        ? (data.forms as Record<string, unknown>[]).filter(Boolean).map((form): IrsFormSummaryEntry => ({
            formId: typeof form.formId === 'string' ? form.formId : '',
            filename: typeof form.filename === 'string' ? form.filename : '',
            title: typeof form.title === 'string' ? form.title : '',
            sizeBytes: typeof form.sizeBytes === 'number' ? form.sizeBytes : 0,
          })).filter(form => form.formId)
        : undefined;

      const rawForm = data.form && typeof data.form === 'object' ? data.form as Record<string, unknown> : null;
      const formDetail = rawForm && typeof rawForm.formId === 'string'
        ? {
            formId: String(rawForm.formId),
            filename: typeof rawForm.filename === 'string' ? String(rawForm.filename) : '',
            title: typeof rawForm.title === 'string' ? String(rawForm.title) : '',
            fieldCount: typeof rawForm.fieldCount === 'number' ? rawForm.fieldCount : 0,
            fields: Array.isArray(rawForm.fields)
              ? (rawForm.fields as Record<string, unknown>[]).map((f): IrsFormFieldEntry => ({
                  name: typeof f.name === 'string' ? f.name : '',
                  type: typeof f.type === 'string' ? f.type : 'other',
                })).filter(f => f.name)
              : [],
            pageText: typeof rawForm.pageText === 'string' ? rawForm.pageText : '',
            warnings: Array.isArray(rawForm.warnings) ? (rawForm.warnings as unknown[]).filter((w): w is string => typeof w === 'string') : [],
          }
        : undefined;

      return {
        action: request.action,
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
        filledFields: Array.isArray(data.filledFields) ? data.filledFields.filter((field: unknown): field is string => typeof field === 'string') : [],
        warnings: Array.isArray(data.warnings) ? data.warnings.filter((warning: unknown): warning is string => typeof warning === 'string') : [],
        missingFields: Array.isArray(draft.missingFields) ? draft.missingFields.filter((field: unknown): field is string => typeof field === 'string') : [],
        forms,
        formDetail,
      };
    } catch (error) {
      return {
        action: request.action,
        success: false,
        error: error instanceof Error ? error.message : 'Tax PDF generation failed',
      };
    }
  };

const requestTaxReturnAction = async (
    request: WorkspaceToolTaxReturnToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<TaxReturnToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
      folder: request.folder?.trim() || ragFolderPath || undefined,
    };

    return await new Promise<TaxReturnToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'tax_return',
        title: 'Tax PDF Generation Approval',
        description: describeTaxReturnRequest(payload),
        previewLabel: 'Tax PDF request',
        previewContent: truncateApprovalPreview(
          [
            `Action: ${payload.action}`,
            `Folder: ${payload.folder || 'enabled Knowledge Base context'}`,
            `Tax year: ${payload.taxYear || 'auto-detect'}`,
            payload.templateDocumentId ? `Template document: ${payload.templateDocumentId}` : null,
            payload.flatten ? 'Flatten output form: yes' : null,
            '',
            'This will read ready Knowledge Base tax documents and create a downloadable PDF artifact.',
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

const executePdfDocumentAction = async (
    request: WorkspaceToolPdfDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<PdfDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/workspace-tool/pdf-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'PDF generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title,
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title,
        success: false,
        error: error instanceof Error ? error.message : 'PDF generation failed',
      };
    }
  };

const requestPdfDocumentAction = async (
    request: WorkspaceToolPdfDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<PdfDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };

    return await new Promise<PdfDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'pdf_document',
        title: 'PDF Generation Approval',
        description: describePdfDocumentRequest(request),
        previewLabel: 'PDF content preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${request.title}`,
            `Filename: ${request.filename || `${request.title}.pdf`}`,
            request.template ? `Template: ${request.template}` : null,
            request.subtitle ? `Subtitle: ${request.subtitle}` : null,
            request.sections?.length ? `Sections: ${request.sections.length}` : null,
            request.tables?.length ? `Tables: ${request.tables.length}` : null,
            request.fields?.length ? `Fields: ${request.fields.length}` : null,
            request.callouts?.length ? `Callouts: ${request.callouts.length}` : null,
            '',
            request.content || JSON.stringify({
              sections: request.sections,
              tables: request.tables,
              fields: request.fields,
              callouts: request.callouts,
            }, null, 2),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

const executeWorkbookDocumentAction = async (
    request: WorkspaceToolWorkbookDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<WorkbookDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/workspace-tool/workbook-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Excel workbook generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title,
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title,
        success: false,
        error: error instanceof Error ? error.message : 'Excel workbook generation failed',
      };
    }
  };

const requestWorkbookDocumentAction = async (
    request: WorkspaceToolWorkbookDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<WorkbookDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };

    return await new Promise<WorkbookDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'workbook_document',
        title: 'Excel Workbook Generation Approval',
        description: describeWorkbookDocumentRequest(request),
        previewLabel: 'Workbook structure preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${request.title}`,
            `Filename: ${request.filename || `${request.title}.xlsx`}`,
            request.template ? `Template: ${request.template}` : null,
            request.sheets?.length ? `Sheets: ${request.sheets.length}` : null,
            '',
            JSON.stringify({
              sheets: request.sheets,
              metadata: request.metadata,
            }, null, 2),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

const executeWordDocumentAction = async (
    request: WorkspaceToolWordDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<WordDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/workspace-tool/word-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Word document generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title,
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title,
        success: false,
        error: error instanceof Error ? error.message : 'Word document generation failed',
      };
    }
  };

const requestWordDocumentAction = async (
    request: WorkspaceToolWordDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<WordDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };

    return await new Promise<WordDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'word_document',
        title: 'Word Document Generation Approval',
        description: describeWordDocumentRequest(request),
        previewLabel: 'Word document structure preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${request.title}`,
            `Filename: ${request.filename || `${request.title}.docx`}`,
            request.template ? `Template: ${request.template}` : null,
            request.subtitle ? `Subtitle: ${request.subtitle}` : null,
            request.sections?.length ? `Sections: ${request.sections.length}` : null,
            request.tables?.length ? `Tables: ${request.tables.length}` : null,
            request.fields?.length ? `Fields: ${request.fields.length}` : null,
            request.callouts?.length ? `Callouts: ${request.callouts.length}` : null,
            '',
            request.content || JSON.stringify({
              sections: request.sections,
              tables: request.tables,
              fields: request.fields,
              callouts: request.callouts,
              metadata: request.metadata,
            }, null, 2),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

const executeCsvDocumentAction = async (
    request: WorkspaceToolCsvDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<CsvDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/workspace-tool/csv-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'CSV export failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title,
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title,
        success: false,
        error: error instanceof Error ? error.message : 'CSV export failed',
      };
    }
  };

const requestCsvDocumentAction = async (
    request: WorkspaceToolCsvDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<CsvDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };

    return await new Promise<CsvDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'csv_document',
        title: 'CSV Export Approval',
        description: describeCsvDocumentRequest(request),
        previewLabel: 'CSV preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${request.title}`,
            `Filename: ${request.filename || `${request.title}.csv`}`,
            request.headers?.length ? `Columns: ${request.headers.length}` : null,
            request.rows?.length ? `Rows: ${request.rows.length}` : null,
            '',
            request.content || JSON.stringify({
              headers: request.headers,
              rows: request.rows?.slice(0, 10),
            }, null, 2),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

const executeEmailDocumentAction = async (
    request: WorkspaceToolEmailDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<EmailDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/workspace-tool/email-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const title = request.title || request.subject || 'Generated Email';
        return {
          title,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Email generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      const title = request.title || request.subject || 'Generated Email';
      return {
        title,
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      const title = request.title || request.subject || 'Generated Email';
      return {
        title,
        success: false,
        error: error instanceof Error ? error.message : 'Email generation failed',
      };
    }
  };

const requestEmailDocumentAction = async (
    request: WorkspaceToolEmailDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<EmailDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };
    const title = request.title || request.subject || 'Generated Email';

    return await new Promise<EmailDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'email_document',
        title: 'Email Draft Approval',
        description: describeEmailDocumentRequest(request),
        previewLabel: 'Email preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${title}`,
            `Filename: ${request.filename || `${title}.eml`}`,
            request.to ? `To: ${request.to}` : null,
            request.from ? `From: ${request.from}` : null,
            `Subject: ${request.subject}`,
            '',
            request.body,
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

const executeMarkdownDocumentAction = async (
    request: WorkspaceToolMarkdownDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<MarkdownDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/workspace-tool/markdown-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title || 'Generated Markdown Document',
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Markdown document generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title || 'Generated Markdown Document',
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title || 'Generated Markdown Document',
        success: false,
        error: error instanceof Error ? error.message : 'Markdown document generation failed',
      };
    }
  };

const requestMarkdownDocumentAction = async (
    request: WorkspaceToolMarkdownDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<MarkdownDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };
    const title = request.title || 'Generated Markdown Document';

    return await new Promise<MarkdownDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'markdown_document',
        title: 'Markdown Document Approval',
        description: describeMarkdownDocumentRequest(request),
        previewLabel: 'Markdown preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${title}`,
            `Filename: ${request.filename || `${title}.md`}`,
            '',
            request.content.slice(0, 4000),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

const executeSlidesDocumentAction = async (
    request: WorkspaceToolSlidesDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<SlidesDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/workspace-tool/slides-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title || 'Generated Slides',
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Slide deck generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title || 'Generated Slides',
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title || 'Generated Slides',
        success: false,
        error: error instanceof Error ? error.message : 'Slide deck generation failed',
      };
    }
  };

const requestSlidesDocumentAction = async (
    request: WorkspaceToolSlidesDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<SlidesDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };
    const title = request.title || 'Generated Slides';

    return await new Promise<SlidesDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'slides_document',
        title: 'Slide Deck Approval',
        description: `Generate a slide deck titled "${title}" with ${request.slides.length} slides.`,
        previewLabel: 'Slide structure preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${title}`,
            `Filename: ${request.filename || `${title}.pptx`}`,
            request.subtitle ? `Subtitle: ${request.subtitle}` : null,
            `Slides: ${request.slides.length}`,
            '',
            JSON.stringify({ slides: request.slides }, null, 2).slice(0, 4000),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

const executeArchiveDocumentAction = async (
    request: WorkspaceToolArchiveDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<ArchiveDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/workspace-tool/archive-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title || 'Generated Archive',
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Archive generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title || 'Generated Archive',
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title || 'Generated Archive',
        success: false,
        error: error instanceof Error ? error.message : 'Archive generation failed',
      };
    }
  };

const requestArchiveDocumentAction = async (
    request: WorkspaceToolArchiveDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<ArchiveDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };
    const title = request.title || 'Generated Archive';

    return await new Promise<ArchiveDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'archive_document',
        title: 'Archive Approval',
        description: `Bundle ${request.entries.length} entries into "${title}".`,
        previewLabel: 'Archive preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${title}`,
            `Filename: ${request.filename || `${title}.zip`}`,
            `Entries: ${request.entries.length}`,
            '',
            JSON.stringify({ entries: request.entries.map(e => ({ name: e.name, mimeType: e.mimeType, bytes: typeof e.content === 'string' ? e.content.length : 0 })) }, null, 2),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

const executeCalendarDocumentAction = async (
    request: WorkspaceToolCalendarDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<CalendarDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/workspace-tool/calendar-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title || 'Generated Calendar Event',
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Calendar event generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title || 'Generated Calendar Event',
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title || 'Generated Calendar Event',
        success: false,
        error: error instanceof Error ? error.message : 'Calendar event generation failed',
      };
    }
  };

const requestCalendarDocumentAction = async (
    request: WorkspaceToolCalendarDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<CalendarDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };
    const title = request.title || 'Generated Calendar Event';

    return await new Promise<CalendarDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'calendar_document',
        title: 'Calendar Event Approval',
        description: `Generate calendar with ${request.events.length} event${request.events.length === 1 ? '' : 's'} titled "${title}".`,
        previewLabel: 'Calendar preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${title}`,
            `Filename: ${request.filename || `${title}.ics`}`,
            `Events: ${request.events.length}`,
            '',
            JSON.stringify({ events: request.events }, null, 2).slice(0, 4000),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

const executeMermaidDocumentAction = async (
    request: WorkspaceToolMermaidDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<MermaidDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/workspace-tool/mermaid-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title || 'Generated Diagram',
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Diagram generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title || 'Generated Diagram',
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title || 'Generated Diagram',
        success: false,
        error: error instanceof Error ? error.message : 'Diagram generation failed',
      };
    }
  };

const requestMermaidDocumentAction = async (
    request: WorkspaceToolMermaidDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<MermaidDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };
    const title = request.title || 'Generated Diagram';

    return await new Promise<MermaidDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'mermaid_document',
        title: 'Mermaid Diagram Approval',
        description: `Render a Mermaid diagram titled "${title}" as ${request.format || 'svg'}.`,
        previewLabel: 'Diagram source preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${title}`,
            `Filename: ${request.filename || `${title}.${request.format || 'svg'}`}`,
            `Format: ${request.format || 'svg'}`,
            '',
            request.diagram.slice(0, 4000),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

const executeFetchSummarizeAction = async (
    request: WorkspaceToolFetchSummarizeToolRequest,
  ): Promise<FetchSummarizeToolResultEntry> => {
    try {
      const res = await fetch('/api/workspace-tool/fetch-summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          url: request.url,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Fetch and summarize failed',
        };
      }
      return {
        url: request.url,
        success: data.success !== false,
        title: typeof data.title === 'string' ? data.title : undefined,
        summary: Array.isArray(data.summary) ? data.summary.filter((s: unknown): s is string => typeof s === 'string') : undefined,
        quote: typeof data.quote === 'string' ? data.quote : undefined,
      };
    } catch (error) {
      return {
        url: request.url,
        success: false,
        error: error instanceof Error ? error.message : 'Fetch and summarize failed',
      };
    }
  };

const executeImageGenerationAction = async (
    request: WorkspaceToolImageGenerationToolRequest,
    options: { sessionId: string; messageId: string },
  ): Promise<ImageGenerationToolResultEntry> => {
    try {
      const res = await fetch('/api/image-gen/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, sessionId: options.sessionId, messageId: options.messageId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          prompt: request.prompt,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Image generation failed',
        };
      }
      const images = Array.isArray(data.images)
        ? data.images.filter((img: unknown): img is { filename: string; url: string } =>
            typeof img === 'object' && img !== null && typeof (img as { url?: unknown }).url === 'string')
        : [];
      return {
        prompt: request.prompt,
        success: true,
        images,
      };
    } catch (error) {
      return {
        prompt: request.prompt,
        success: false,
        error: error instanceof Error ? error.message : 'Image generation failed',
      };
    }
  };

const handleToolApprove = async () => {
    if (!pendingApproval || !pendingApprovalResolverRef.current) return;
    const approval = pendingApproval;
    const resolve = pendingApprovalResolverRef.current;
    pendingApprovalResolverRef.current = null;
    setPendingApproval(null);

    try {
      if (approval.kind === 'shell') {
        resolve(await executeShellCommand({
          ...approval.request,
          approvalToken: approval.approvalToken,
          messageId: approval.messageId,
        }));
        return;
      }

      if (approval.kind === 'filesystem') {
        resolve(await executeFilesystemAction({
          ...approval.request,
          approvalToken: approval.approvalToken,
        }));
        return;
      }

      if (approval.kind === 'code') {
        resolve(await executeCodeAction({
          ...approval.request,
          approvalToken: approval.approvalToken,
        }));
        return;
      }

      if (approval.kind === 'unified_browser') {
        resolve(await executeUwafBrowserAction({
          ...approval.request,
          approvalToken: approval.approvalToken,
        }));
        return;
      }

      if (approval.kind === 'tax_return') {
        resolve(await executeTaxReturnAction(approval.request));
        return;
      }

      if (approval.kind === 'pdf_document') {
        resolve(await executePdfDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'workbook_document') {
        resolve(await executeWorkbookDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'word_document') {
        resolve(await executeWordDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'csv_document') {
        resolve(await executeCsvDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'email_document') {
        resolve(await executeEmailDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'markdown_document') {
        resolve(await executeMarkdownDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'slides_document') {
        resolve(await executeSlidesDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'archive_document') {
        resolve(await executeArchiveDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'calendar_document') {
        resolve(await executeCalendarDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'mermaid_document') {
        resolve(await executeMermaidDocumentAction(approval.request));
        return;
      }

      resolve(await executeBrowserAction({
        ...approval.request,
        approvalToken: approval.approvalToken,
      }));
    } catch (error) {
      console.error('Approved tool execution failed:', error);
      const message = error instanceof Error ? error.message : 'Approved tool execution failed';

      if (approval.kind === 'shell') {
        resolve(appendShellOutput({
          id: randomUUID(),
          messageId: approval.messageId,
          auditId: approval.request.auditId,
          target: settings?.shellExecutionTarget === 'host' ? 'host' : 'container',
          command: approval.request.command,
          description: approval.request.description,
          stderr: message,
          exitCode: -1,
          duration: 0,
          success: false,
        }));
        return;
      }

      if (approval.kind === 'filesystem') {
        resolve({
          action: approval.request.action,
          path: approval.request.path,
          success: false,
          error: message,
        });
        return;
      }

      if (approval.kind === 'code') {
        resolve({
          runtime: approval.request.runtime,
          workingDirectory: '',
          scriptPath: '',
          command: '',
          stdout: '',
          stderr: message,
          exitCode: -1,
          duration: 0,
          success: false,
          files: [],
          error: message,
        });
        return;
      }

      if (approval.kind === 'unified_browser') {
        resolve({
          action: approval.request.action,
          currentUrl: '',
          title: '',
          text: '',
          links: [],
          forms: [],
          mode: approval.request.browserMode || 'direct',
          source: (approval.request.browserMode || 'direct') === 'stealth' ? 'dark_web' as const : 'clear_web' as const,
          success: false,
          error: message,
        } satisfies UwafBrowserToolResultEntry);
        return;
      }

      if (approval.kind === 'tax_return') {
        resolve({
          action: approval.request.action,
          success: false,
          error: message,
        } satisfies TaxReturnToolResultEntry);
        return;
      }

      if (approval.kind === 'pdf_document') {
        resolve({
          title: approval.request.title,
          success: false,
          error: message,
        } satisfies PdfDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'workbook_document') {
        resolve({
          title: approval.request.title,
          success: false,
          error: message,
        } satisfies WorkbookDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'word_document') {
        resolve({
          title: approval.request.title,
          success: false,
          error: message,
        } satisfies WordDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'csv_document') {
        resolve({
          title: approval.request.title,
          success: false,
          error: message,
        } satisfies CsvDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'email_document') {
        resolve({
          title: approval.request.title || approval.request.subject || 'Generated Email',
          success: false,
          error: message,
        } satisfies EmailDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'markdown_document') {
        resolve({
          title: approval.request.title || 'Generated Markdown Document',
          success: false,
          error: message,
        } satisfies MarkdownDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'slides_document') {
        resolve({
          title: approval.request.title || 'Generated Slides',
          success: false,
          error: message,
        } satisfies SlidesDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'archive_document') {
        resolve({
          title: approval.request.title || 'Generated Archive',
          success: false,
          error: message,
        } satisfies ArchiveDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'calendar_document') {
        resolve({
          title: approval.request.title || 'Generated Calendar Event',
          success: false,
          error: message,
        } satisfies CalendarDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'mermaid_document') {
        resolve({
          title: approval.request.title || 'Generated Diagram',
          success: false,
          error: message,
        } satisfies MermaidDocumentToolResultEntry);
        return;
      }

      resolve({
        action: approval.request.action,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        success: false,
        error: message,
      });
    }
  };

const handleToolReject = () => {
    if (!pendingApproval || !pendingApprovalResolverRef.current) return;
    const approval = pendingApproval;
    const resolve = pendingApprovalResolverRef.current;
    pendingApprovalResolverRef.current = null;
    setPendingApproval(null);

    if (approval.kind === 'shell') {
      resolve(appendShellOutput({
        id: randomUUID(),
        messageId: approval.messageId,
        command: approval.request.command,
        description: approval.request.description,
        stderr: 'Command rejected by user',
        exitCode: -1,
        duration: 0,
        success: false,
        rejected: true,
      }));
      return;
    }

    if (approval.kind === 'filesystem') {
      resolve({
        action: approval.request.action,
        path: approval.request.path,
        success: false,
        error: 'Filesystem write rejected by user',
      } satisfies FilesystemToolResultEntry);
      return;
    }

    if (approval.kind === 'code') {
      resolve({
        runtime: approval.request.runtime,
        workingDirectory: '',
        scriptPath: '',
        command: '',
        stdout: '',
        stderr: 'Code execution rejected by user',
        exitCode: -1,
        duration: 0,
        success: false,
        files: [],
        error: 'Code execution rejected by user',
      } satisfies CodeToolResultEntry);
      return;
    }

    if (approval.kind === 'unified_browser') {
      resolve({
        action: approval.request.action,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        mode: approval.request.browserMode || 'direct',
        source: (approval.request.browserMode || 'direct') === 'stealth' ? 'dark_web' as const : 'clear_web' as const,
        success: false,
        error: 'UWAF browser action rejected by user',
      } satisfies UwafBrowserToolResultEntry);
      return;
    }

    if (approval.kind === 'tax_return') {
      resolve({
        action: approval.request.action,
        success: false,
        error: 'Tax PDF generation rejected by user',
      } satisfies TaxReturnToolResultEntry);
      return;
    }

    if (approval.kind === 'pdf_document') {
      resolve({
        title: approval.request.title,
        success: false,
        error: 'PDF generation rejected by user',
      } satisfies PdfDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'workbook_document') {
      resolve({
        title: approval.request.title,
        success: false,
        error: 'Excel workbook generation rejected by user',
      } satisfies WorkbookDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'word_document') {
      resolve({
        title: approval.request.title,
        success: false,
        error: 'Word document generation rejected by user',
      } satisfies WordDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'csv_document') {
      resolve({
        title: approval.request.title,
        success: false,
        error: 'CSV export rejected by user',
      } satisfies CsvDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'email_document') {
      resolve({
        title: approval.request.title || approval.request.subject || 'Generated Email',
        success: false,
        error: 'Email draft rejected by user',
      } satisfies EmailDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'markdown_document') {
      resolve({
        title: approval.request.title || 'Generated Markdown Document',
        success: false,
        error: 'Markdown document generation rejected by user',
      } satisfies MarkdownDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'slides_document') {
      resolve({
        title: approval.request.title || 'Generated Slides',
        success: false,
        error: 'Slide deck generation rejected by user',
      } satisfies SlidesDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'archive_document') {
      resolve({
        title: approval.request.title || 'Generated Archive',
        success: false,
        error: 'Archive generation rejected by user',
      } satisfies ArchiveDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'calendar_document') {
      resolve({
        title: approval.request.title || 'Generated Calendar Event',
        success: false,
        error: 'Calendar event generation rejected by user',
      } satisfies CalendarDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'mermaid_document') {
      resolve({
        title: approval.request.title || 'Generated Diagram',
        success: false,
        error: 'Diagram generation rejected by user',
      } satisfies MermaidDocumentToolResultEntry);
      return;
    }

    resolve({
      action: approval.request.action,
      currentUrl: '',
      title: '',
      text: '',
      links: [],
      forms: [],
      success: false,
      error: 'Browser action rejected by user',
    } satisfies BrowserToolResultEntry);
  };
return {appendShellOutput, truncateApprovalPreview, executeShellCommand, requestShellCommand, executeFilesystemAction, requestFilesystemAction, executeCodeAction, requestCodeExecution, executeBrowserAction, requestBrowserAction, requestUwafBrowserAction, waitForHumanBrowserAssistance, executeUwafBrowserAction, requestWebContext, executeTaxReturnAction, requestTaxReturnAction, executePdfDocumentAction, requestPdfDocumentAction, executeWorkbookDocumentAction, requestWorkbookDocumentAction, executeWordDocumentAction, requestWordDocumentAction, executeCsvDocumentAction, requestCsvDocumentAction, executeEmailDocumentAction, requestEmailDocumentAction, executeMarkdownDocumentAction, requestMarkdownDocumentAction, executeSlidesDocumentAction, requestSlidesDocumentAction, executeArchiveDocumentAction, requestArchiveDocumentAction, executeCalendarDocumentAction, requestCalendarDocumentAction, executeMermaidDocumentAction, requestMermaidDocumentAction, executeFetchSummarizeAction, executeImageGenerationAction, handleToolApprove, handleToolReject};
}
