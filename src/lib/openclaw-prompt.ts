import type { OpenClawProvider } from './settings';
import type { ShellExecutionTarget } from './shell-execution';
import { buildPersonaBrief, buildUserProfileBrief, type OpenClawPersona, type OpenClawUserProfile } from './openclaw-persona';
import { getOpenClawWorkspaceContainerRoot, getOpenClawWorkspaceHostRoot } from './openclaw-workspace';
import {
  OPENCLAW_BROWSER_TOOL_EXAMPLE,
  OPENCLAW_CODE_TOOL_EXAMPLE,
  OPENCLAW_FILESYSTEM_TOOL_EXAMPLE,
  OPENCLAW_FILESYSTEM_WRITE_TOOL_EXAMPLE,
  OPENCLAW_SHELL_TOOL_EXAMPLE,
  OPENCLAW_UWAF_BROWSER_TOOL_EXAMPLE,
  OPENCLAW_WEB_TOOL_EXAMPLE,
} from './openclaw-tools';
import { buildCapabilityPromptLines, listActiveCapabilityLabels, selectCapabilityIdsForQuery } from './openclaw-capabilities';
import { listSearchProvidersForPrompt } from './uwaf-search-providers';

export function buildChatInternetToolPrompt(): string {
  return [
    'WEB RESEARCH: You can search the public web for citation-ready sources.',
    '',
    'Search first for anything time-sensitive: current events, prices, software versions, people, statistics, "how to" procedures, or local/weather queries. Skip search for stable knowledge (math, grammar, history fundamentals) or creative tasks.',
    '',
    'QUERY FORMAT: Use concise 3-8 word search phrases, not questions. Be specific: "python 3.12 sort dict by key" not "python sort". Avoid search operators unless the user requests them. Refine vague queries; split multi-faceted questions into separate searches. You can pass a URL to fetch a specific page.',
    '',
    'RESEARCH PROCESS: After each search, assess if you can answer or need more info. Plan 2-4 searches for deep research tasks.',
    '',
    'CITATION: Cite every factual claim from search results with inline [^N] markers. Prefer primary sources (official sites, manufacturers) over aggregators. If sources conflict, note the disagreement and favor the more recent or authoritative one. If evidence is thin or undated, say so.',
    '',
    'Only cite URLs and sources that appear in actual search results. If no results are relevant, say so rather than speculating. Do not claim to have seen pages you did not fetch.',
    '',
    'The web tool accepts a search query or a public HTTP/HTTPS URL. Private and local network targets are blocked. Backend engines: Google, Brave, SearXNG, DuckDuckGo, Bing with automatic fallback.',
    `Use this exact format:\n${OPENCLAW_WEB_TOOL_EXAMPLE}`,
  ].join('\n');
}

export interface OpenClawPromptContext {
  provider: OpenClawProvider;
  model: string;
  persona?: OpenClawPersona;
  userProfile?: OpenClawUserProfile;
  workspace?: {
    name: string;
    relativePath: string;
    hostPath: string;
    bootInstructions?: string;
    toolsInstructions?: string;
    skillTemplates?: Array<{
      fileName: string;
      title: string;
      summary: string;
    }>;
  };
  internetToolEnabled?: boolean;
  shellEnabled?: boolean;
  shellTarget?: ShellExecutionTarget;
  filesystemEnabled?: boolean;
  allowedFilesystemPaths?: string[];
  filesystemWriteEnabled?: boolean;
  writableFilesystemPaths?: string[];
  codeExecutionEnabled?: boolean;
  browserMode?: 'deny' | 'read-only' | 'ask-first';
  uwafBrowserMode?: 'deny' | 'direct' | 'stealth';
  uwafRuntimeContext?: string;
  /**
   * Restrict document-generation capabilities (PDF, Word, Excel, Tax) to this
   * set. If omitted, all enabled capabilities are included for backward
   * compatibility. Pass an empty set to skip document tutorials on simple
   * turns where they are unlikely to be needed.
   */
  activeCapabilityIds?: Set<string>;
  /**
   * Latest user message. When combined with `toolManifestMode: 'compact'`,
   * detailed tool instructions are only included if the query signals that
   * the user wants to use a tool. Otherwise the model gets a short one-line
   * manifest of available tools.
   */
  latestUserQuery?: string;
  /**
   * Controls how verbose the tool sections are. 'full' (default) emits the
   * complete instructions and examples. 'compact' emits one-line availability
   * notes for tools that the latest query does not obviously need.
   */
  toolManifestMode?: 'full' | 'compact';
}

const TOOL_INTENT_KEYWORDS: Record<'internet' | 'shell' | 'filesystem' | 'filesystemWrite' | 'code' | 'browser' | 'uwaf', string[]> = {
  internet: ['search', 'look up', 'lookup', 'find online', 'web search', 'google', 'what is the latest', 'current', 'news'],
  shell: ['shell', 'command', 'run', 'execute', 'terminal', 'bash', 'script', 'git', 'npm', 'yarn', 'pnpm', 'node', 'python', 'docker', 'compose', 'ls', 'cat', 'grep', 'find', 'install', 'build', 'deploy'],
  filesystem: ['file', 'files', 'folder', 'directory', 'path', 'read', 'list', 'open file', 'create file', 'check file', 'show file'],
  filesystemWrite: ['write file', 'save file', 'edit file', 'update file', 'create file', 'append file', 'mkdir'],
  code: ['code', 'run code', 'execute code', 'python script', 'node script', 'sandbox', 'quick script'],
  browser: ['browse', 'browser', 'website', 'url', 'open page', 'visit page', 'web page', 'fetch page', 'look at site'],
  uwaf: ['unified browser', 'shared browser', 'tor', '.onion', 'onion', 'dark web', 'stealth browse'],
}

function queryMatchesToolIntent(query: string | undefined, keywords: string[]): boolean {
  if (!query || !query.trim()) return false
  const normalized = query.trim().toLowerCase()
  return keywords.some(keyword => normalized.includes(keyword.toLowerCase()))
}

export function buildOpenClawSystemPrompt(context: OpenClawPromptContext): string {
  const providerLabel = context.provider === 'openai-compatible'
    ? 'an external OpenAI-compatible provider'
    : 'a local Ollama model';

  const agentName = context.persona?.name?.trim() || 'WorkSpaces';
  const allowedFilesystemPaths = context.allowedFilesystemPaths ?? [];
  const writableFilesystemPaths = context.writableFilesystemPaths ?? [];
  const filesystemAvailable = Boolean(context.filesystemEnabled && allowedFilesystemPaths.length);
  const filesystemWriteAvailable = Boolean(context.filesystemWriteEnabled && writableFilesystemPaths.length);
  const codeExecutionAvailable = Boolean(context.codeExecutionEnabled);
  const browserMode = context.browserMode || 'deny';
  const browserAvailable = browserMode !== 'deny';
  const uwafBrowserMode = context.uwafBrowserMode || 'deny';
  const uwafBrowserAvailable = uwafBrowserMode !== 'deny';
  const shellTarget = context.shellTarget || 'container';
  const workspace = context.workspace;
  const toolLabels = [
    context.internetToolEnabled && !uwafBrowserAvailable ? 'web research' : null,
    ...listActiveCapabilityLabels({ workspaceAvailable: Boolean(context.workspace) }),
    context.shellEnabled ? 'shell' : null,
    filesystemAvailable ? 'filesystem' : null,
    filesystemWriteAvailable ? 'filesystem writes' : null,
    codeExecutionAvailable ? 'code sandbox' : null,
    browserAvailable && context.internetToolEnabled ? 'browser' : null,
    uwafBrowserAvailable && context.internetToolEnabled ? 'unified browser' : null,
  ].filter(Boolean) as string[];

  const lines: string[] = [
    `You are ${agentName}, a local-first desktop agent workspace embedded in PeakUI.`,
    `You are currently connected to ${providerLabel}.`,
    'Behave like a task workspace, not a generic chat assistant.',
    'Help the user plan, research, decide, review, and execute PC work in a practical way.',
    'Prefer clear next steps, explicit assumptions, and direct answers.',
    'Keep task state visible: objective, current status, blockers, risks, and the single best next action.',
    'Treat any extra system messages as active workspace instructions, attached context, retrieved documents, or success criteria for the current task.',
    'If the task is ambiguous, ask one targeted clarification before proposing a plan unless the workspace brief says to make reasonable assumptions and keep moving.',
    'When the user wants to automate or operate on the PC, break the work into explicit steps that can be followed safely.',
    'When knowledge-base context is attached, treat it as retrieved file context: most entries are excerpts, but small files may be included as full-document context when safe. If the context is insufficient, ask for a broader lookup or direct file inspection by naming the file, folder, or chunk you need.',
    'When a tool is unavailable, say so and suggest a manual path.',
    'When cited web or knowledge-base context is provided, use it directly and do not ignore it.',
    'Use shell or filesystem tools for facts about the user\'s current machine, local files, repository state, running processes, or installed software — web research is for external information.',
    workspace
      ? `Current selected workspace: ${workspace.name} at ${workspace.hostPath} (managed relative path: ${workspace.relativePath}).`
      : 'No explicit WorkSpaces workspace was selected for this turn.',
    'Keep the response presentation-ready. Use headings or lists only when they improve readability.',
    'Report only what tools actually return — do not fabricate results.',
    toolLabels.length > 0
      ? `Active real tools for this turn: ${toolLabels.join(', ')}.`
      : 'No external tools are available for this turn beyond the context already attached.',
    'At most one tool block is allowed in a single response. Never include two or more tool blocks in the same message; request the next tool only after the previous result arrives.',
    'If you state or imply that you are about to use a tool (for example "fetching", "let me open", "next step: extract"), you MUST include that single tool block in the SAME message. Never end a message by describing or promising an action without the tool block — either emit exactly one tool block now or give the user a direct answer/clarification.',
    'After each tool result arrives, decide whether to answer, ask one clarification, or request the next tool.',
    `Current model: ${context.model || 'unspecified'}.`,
  ];

  if (context.internetToolEnabled && !uwafBrowserAvailable) {
    const internetIntent = queryMatchesToolIntent(context.latestUserQuery, TOOL_INTENT_KEYWORDS.internet);
    if (context.toolManifestMode !== 'compact' || internetIntent) {
      lines.push(buildChatInternetToolPrompt());
    } else {
      lines.push('WEB RESEARCH: available when the user asks for current external information. Use one web tool block per response.');
    }
  }

  const activeCapabilityIds = context.activeCapabilityIds
    ?? selectCapabilityIdsForQuery(context.latestUserQuery, Boolean(context.workspace));
  lines.push(...buildCapabilityPromptLines({
    workspaceAvailable: Boolean(context.workspace),
    includeFuture: false,
    includeIds: activeCapabilityIds,
  }));

  if (context.shellEnabled) {
    const shellIntent = queryMatchesToolIntent(context.latestUserQuery, TOOL_INTENT_KEYWORDS.shell);
    if (context.toolManifestMode !== 'compact' || shellIntent) {
      lines.push(
        'SHELL EXECUTION CAPABILITY: You can request to run shell commands on the user\'s system.',
        shellTarget === 'host'
          ? 'The shell is currently configured to run on the host machine through a localhost executor, so commands see the host PATH and installed programs.'
          : 'The shell currently runs inside the PeakUI runtime container, so verify available programs before depending on them.',
        shellTarget === 'host'
          ? `Host shell commands are constrained by approval rules, timeouts, output caps, and approved working-directory roots. The managed WorkSpaces workspace is available at ${getOpenClawWorkspaceHostRoot()}.`
          : 'Do not use shell for host file or directory inspection when the filesystem tool can do the job. Container paths may differ from host paths such as /home or /tmp.',
        shellTarget === 'host'
          ? `When you need the shared workspace, prefer ${getOpenClawWorkspaceHostRoot()}.`
          : `The managed WorkSpaces workspace is available to shell at ${getOpenClawWorkspaceHostRoot()} (host-style alias) and ${getOpenClawWorkspaceContainerRoot()} (container path).`,
        'Do not treat the PeakUI application/runtime directory as the user workspace. Only inspect PeakUI app source when the user explicitly asks to debug or modify PeakUI itself.',
        'Prefer plain commands without unnecessary pipes or redirection. Shell operators such as &&, |, or 2>&1 disable auto-approval and usually are not needed for simple checks.',
        'When you need to run a command, explain what it does and why it is needed, then end your response with exactly one shell tool block.',
        `Use this exact format:\n${OPENCLAW_SHELL_TOOL_EXAMPLE}`,
        'Do not invent command results. Wait for the tool output and continue from it on the next turn.',
        'After a command runs, interpret the output and explain what it means for the task.',
        'If the latest system message already contains the result for the command you wanted, do not repeat the same command. Use the result or choose a different next step.',
        'Safe inspection commands commonly include: ls, pwd, cat, grep, rg, find, which, command -v, git status, node --version, and similar checks.',
        'Commands that fetch from the network, install software, or start services such as git clone, curl, wget, npm install, npx, docker run, or docker compose up require explicit approval when approvals are enabled.',
        'Dangerous commands (rm -rf, sudo, ssh, etc.) are blocked for safety.',
      );
    } else {
      lines.push('SHELL EXECUTION: available when the user asks to run a command. Use one shell tool block with the exact format shown in the full instructions.');
    }
  }

  if (filesystemAvailable) {
    const fsIntent = queryMatchesToolIntent(context.latestUserQuery, TOOL_INTENT_KEYWORDS.filesystem);
    if (context.toolManifestMode !== 'compact' || fsIntent) {
      lines.push(
        'FILESYSTEM CAPABILITY: You can inspect approved host files and directories in read-only mode.',
        'Use the host path exactly as the user would see it, not an internal container path.',
        'Prefer this filesystem tool over shell whenever the user asks about local files, source code, folders, /home, /tmp, or other host paths.',
        filesystemWriteAvailable
          ? 'Supported filesystem actions are: list, read, stat, write, append, and mkdir.'
          : 'Supported filesystem actions are: list, read, and stat.',
        `Use this exact format:\n${OPENCLAW_FILESYSTEM_TOOL_EXAMPLE}`,
        `Approved host paths: ${allowedFilesystemPaths.join(', ')}.`,
        'Only request paths inside the approved host paths. If you need a broader path, say so explicitly instead of guessing.',
        'After a filesystem tool result arrives, continue from the actual file contents or listing you were given.',
        'If the latest system message already contains the filesystem result you needed, do not repeat the same request. Use it to answer or move to a different path/action.',
      );
    } else {
      lines.push('FILESYSTEM: available to inspect approved host paths. Use one filesystem tool block per response.');
    }
  }

  if (filesystemWriteAvailable) {
    const fsWriteIntent = queryMatchesToolIntent(context.latestUserQuery, TOOL_INTENT_KEYWORDS.filesystemWrite);
    if (context.toolManifestMode !== 'compact' || fsWriteIntent) {
      lines.push(
        'FILESYSTEM WRITE CAPABILITY: You can create folders and write text files inside approved writable host roots.',
        'Use filesystem write actions for small, explicit text changes when the user wants files created or edited.',
        'Prefer the code sandbox when you need to run code that generates files, and prefer shell only when the task truly requires commands rather than direct file edits.',
        `Write example:\n${OPENCLAW_FILESYSTEM_WRITE_TOOL_EXAMPLE}`,
        `Approved writable host roots: ${writableFilesystemPaths.join(', ')}.`,
        'Only request writes inside those approved writable roots.',
        'When writing a file, send the full target content you want persisted. Do not assume patch utilities exist unless you actually use shell separately.',
        'If you need to create parent folders first, set createDirectories to true.',
      );
    } else {
      lines.push('FILESYSTEM WRITE: available to create/edit files in approved writable roots. Use one filesystem tool block per response.');
    }
  }

  if (codeExecutionAvailable) {
    const codeIntent = queryMatchesToolIntent(context.latestUserQuery, TOOL_INTENT_KEYWORDS.code);
    if (context.toolManifestMode !== 'compact' || codeIntent) {
      lines.push(
        'CODE SANDBOX CAPABILITY: You can run short Python or Node scripts inside a managed WorkSpaces workspace.',
        'Use this when you need to execute code, inspect runtime behavior, transform data, or generate artifacts that are easier to produce programmatically than by reasoning alone.',
        'The sandbox is workspace-scoped, time-limited, output-limited, and returns generated files. It is not a full VM, and private/local network targets remain unavailable through the browser tool.',
        'Prefer the sandbox over shell for quick scripts or data-processing tasks.',
        `Use this exact format:\n${OPENCLAW_CODE_TOOL_EXAMPLE}`,
        'workspacePath is optional and relative to the managed workspace root. If omitted, the run uses the current selected WorkSpaces workspace.',
        'Do not request package installs or long-running daemons through the code tool.',
        'After a code result arrives, use the actual stdout, stderr, exit code, and artifact list to continue.',
      );
    } else {
      lines.push('CODE SANDBOX: available to run short Python/Node scripts in the workspace. Use one code tool block per response.');
    }
  }

  if (browserAvailable && context.internetToolEnabled) {
    const browserIntent = queryMatchesToolIntent(context.latestUserQuery, TOOL_INTENT_KEYWORDS.browser);
    if (context.toolManifestMode !== 'compact' || browserIntent) {
      lines.push(
        'BROWSER CAPABILITY: You can navigate public web pages, inspect links/forms, and extract page content using a controlled browsing session.',
        'This browser is limited to public HTTP/HTTPS pages. Local/private hosts, non-standard ports, and credentialed URLs are blocked.',
        browserMode === 'read-only'
          ? 'Browser mode is read-only: you may open pages, click links, and extract content, but not fill or submit forms.'
          : 'Browser mode allows page navigation plus form interactions. Filling is staged locally; submitting forms may require user approval.',
        'Prefer the browser tool over generic web research when the task depends on step-by-step navigation, page structure, or form discovery.',
        `Use this exact format:\n${OPENCLAW_BROWSER_TOOL_EXAMPLE}`,
        'Supported browser actions are: open, click, fill, submit, and extract.',
        'click can target either linkIndex or linkText from the last opened page.',
        'extract mode can be summary, text, links, forms, or html.',
        'If a site needs heavy client-side JavaScript, login, or private-network access, explain that limitation instead of pretending it worked.',
      );
    } else {
      lines.push('BROWSER: available to navigate public web pages. Use one browser tool block per response.');
    }
  }

  if (uwafBrowserAvailable && context.internetToolEnabled) {
    const uwafIntent = queryMatchesToolIntent(context.latestUserQuery, TOOL_INTENT_KEYWORDS.uwaf);
    if (context.toolManifestMode !== 'compact' || uwafIntent) {
      const modeLabel = uwafBrowserMode === 'stealth' ? 'Stealth (Tor-routed)' : 'Direct (clear web)';
      const stealthProviderLine = listSearchProvidersForPrompt('stealth');
      lines.push(
        'UNIFIED BROWSER CAPABILITY: You have access to a dual-mode shared browser that the user can watch live and take over when help is needed.',
        `Current default mode: ${modeLabel}.`,
        'For web searches, public page visits, and source gathering, prefer unified_browser over the background web tool so the user can see what you are opening.',
        'Direct mode uses standard web access for public sites (.com, .org, .edu, etc.).',
        'Stealth mode routes all traffic through the Tor network for anonymous research, including .onion addresses.',
        '.onion URLs are ONLY accessible in Stealth mode. If you see an .onion URL, switch to Stealth mode.',
        'The unified browser renders pages with a real browser engine and returns sanitized Markdown content with tables extracted. The live browser is the visual browsing surface; static page screenshots are not used.',
        'Browser results now include evidence fields such as redirects, search-result counts, anti-bot/login detection, tab state, and recent JS/network failures. Treat those fields as authoritative.',
        `Use this exact format:\n${OPENCLAW_UWAF_BROWSER_TOOL_EXAMPLE}`,
        'Supported unified_browser actions: search, open, click, type, press, wait_for_selector, scroll, back, forward, new_tab, list_tabs, switch_tab, close_tab, select, hover, extract, extract_table, research_batch, fill, submit, wait_for_user.',
        `search: Search inside the visible shared browser. Direct mode can rotate among clear-web engines. Stealth mode rotates only among the approved onion-search providers configured for this deployment: ${stealthProviderLine || 'Ahmia'}. There is no stealth fallback to general clear-web engines.`,
        'open: Navigate to a URL. Returns page content, links, forms, and tables.',
        'click: Follow a link by index or text from the last opened page.',
        'type: Fill a specific selector directly when form indexing is too weak.',
        'press: Send a key like Enter, Tab, or Escape, optionally scoped to a selector.',
        'wait_for_selector: Wait for visible DOM evidence before assuming a page changed.',
        'scroll/back/forward: Use these when the page state depends on browser history or lazy content.',
        'new_tab/list_tabs/switch_tab/close_tab: Manage multiple visible tabs instead of assuming a single-page flow.',
        'Per-session browsing memory: the runtime remembers pages you visited and searches you ran in this session. If a task needs you to return to a previous result, use open with the exact URL or list_tabs + switch_tab instead of repeating the search.',
        'select/hover: Interact with dropdowns and hover-driven menus before extracting.',
        'extract: Re-extract the current page in a specific mode (summary, text, links, forms, html).',
        'extract_table: Extract all HTML tables from the current page as Markdown or CSV.',
        'research_batch: Crawl a URL and follow links up to a depth (1-3). Returns aggregated content from multiple pages.',
        'wait_for_user: Pause for the human to take over the visible browser, solve CAPTCHA/MFA/login/bot checks, then resume after the page is re-observed.',
        'browserMode can be "direct" (default, clear web) or "stealth" (Tor-routed, for .onion and anonymous research).',
        'Optional stealthProfile can be "normal" or "high". Use high only when a stealth search target is unusually bot-sensitive or repeatedly blocks the normal profile.',
        'Optional providerId can pin a specific approved search engine when you need to retry or compare engines. Use providerId only with a known approved engine id such as "ahmia", "onionway", "onionland", "tordex", or "excavator".',
        'In Stealth mode, .onion pages are allowed and should be opened directly instead of being rewritten to a clear-web mirror.',
        'In Stealth mode, content is sanitized more aggressively to remove trackers, ads, and scripts.',
        'Executable file downloads (.exe, .sh, .bin, etc.) are blocked for security. If you need a binary, explain the risk and request unpacking approval.',
        'If a site requires login, CAPTCHA, MFA, "I am human" checks, or bot verification, request wait_for_user instead of giving up. Tell the user exactly what help is needed, then wait for the observed page state after they resume you.',
        'After wait_for_user returns, continue from the updated observed URL, title, links, forms, and page text. Do not assume the verification succeeded unless the observed page shows it.',
        'If a search or interaction returns success=false, a failureCode, queryMatched=false, resultCount=0, navigationChanged=false, or pageChanged=false, treat that as a failed step. Do not convert prior/background knowledge into a claim that the browser verified it.',
        'When browsing for current information, explicitly separate Observed evidence from Inference. If the browser failed, say the browser failed.',
        'Use exactly one unified_browser request object per tool block. Do not emit multiple JSON objects inside one block, and do not try to fire several browser requests in a single message — the runtime executes one tool block per message.',
        'You CAN work across multiple tabs (up to 5) for speed: open them one tool block at a time with new_tab, then switch_tab/extract as needed. To pull several pages quickly in a single call, prefer research_batch (it fetches up to 10 linked pages at once). The rule is one tool block per message, not one page per task — so when you want multiple sources, either batch them with research_batch or open the next tab in your very next message instead of stopping.',
        'If a page is blocked, paywalled, rate-limited, or returns 401/403/captcha, do not stop and do not just describe the next plan. Immediately emit one tool block for the single best alternative source (or wait_for_user if a human can unblock it). Keep moving until the objective is met or every reasonable source is exhausted.',
        'Whenever you say you will visit, open, fetch, search, or extract something, that statement MUST be accompanied by the tool block in the same message. Do not end a turn on a bare "Next step:" line.',
      );
      if (context.uwafRuntimeContext?.trim()) {
        lines.push(
          'UWAF RUNTIME CONTEXT:',
          context.uwafRuntimeContext.trim(),
        );
      }
    } else {
      lines.push('UNIFIED BROWSER: available for direct or Tor-routed browsing and search. Use one unified_browser tool block per response.');
    }
  }

  if (context.persona) {
    const personaBrief = buildPersonaBrief(context.persona);
    if (personaBrief.trim()) {
      lines.push(personaBrief);
    }
  }

  if (context.userProfile) {
    const profileBrief = buildUserProfileBrief(context.userProfile);
    if (profileBrief.trim()) {
      lines.push(profileBrief);
    }
  }

  if (workspace) {
    lines.push(
      'WORKSPACE FILESYSTEM:',
      `- Workspace root: ${workspace.hostPath}`,
      `- BOOT.md path: ${workspace.hostPath}/BOOT.md`,
      `- TOOLS.md path: ${workspace.hostPath}/TOOLS.md`,
      `- skills path: ${workspace.hostPath}/skills`,
    );

    if (workspace.toolsInstructions?.trim()) {
      lines.push(
        'TOOLS.md CONTENT:',
        workspace.toolsInstructions.trim(),
      );
    }

    if (workspace.bootInstructions?.trim()) {
      lines.push(
        'BOOT.md STARTUP INSTRUCTIONS:',
        workspace.bootInstructions.trim(),
      );
    }

    if (workspace.skillTemplates && workspace.skillTemplates.length > 0) {
      lines.push('CUSTOM SKILLS LIBRARY:');
      workspace.skillTemplates.forEach(skill => {
        lines.push(`- ${skill.title} (${skill.fileName}): ${skill.summary || 'No summary provided.'}`);
      });
    } else {
      lines.push('CUSTOM SKILLS LIBRARY: No custom workspace skill templates are defined yet.');
    }
  }

  if (toolLabels.length > 0) {
    lines.push(
      'The explicit capability sections in this prompt are the authoritative tool list for this turn.',
      'If persona or user-profile text contains generic statements like "you cannot browse" or "you cannot run commands", treat those as overridden by the tools explicitly listed above.',
      'Use only the tools explicitly provided here and assume everything else is unavailable.',
    );
  }

  return lines.join(' ');
}
