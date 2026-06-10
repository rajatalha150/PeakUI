"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Upload, FileText, Trash2, CheckCircle, AlertCircle, Loader2,
  Search, Database, MessageSquare, X, ChevronDown, ChevronRight,
  Folder, ArrowUpDown, Filter as FilterIcon, Home, File as FileIcon,
} from 'lucide-react';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, type FileKind } from '@/lib/file-shared';
import {
  aggregateFolderTree,
  findFolderInTree,
  isFolderPrefix,
  listFolderImmediateChildren,
  normalizeFolderPath,
  type FlattenedFolder,
  type KbFolderDocSummary,
  type KbFolderNode,
} from '@/lib/kb-folders';

interface Document {
  id: string;
  filename: string;
  sourcePath?: string | null;
  kind?: string | null;
  size: number;
  contentHash?: string | null;
  status: string;
  ragMode?: 'semantic' | 'keyword';
  embeddingModel?: string | null;
  errorMessage?: string | null;
  indexedAt?: string | null;
  createdAt: string;
  _count: { chunks: number };
}

interface DocumentListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

interface DocumentListResponse {
  documents: Document[];
  pagination: DocumentListPagination;
}

interface SearchResult {
  chunkId?: string;
  chunkIndex?: number | null;
  documentChunkCount?: number | null;
  documentId?: string;
  content: string;
  filename: string;
  sourcePath?: string | null;
  score: number;
  rawScore?: number;
  mode?: 'semantic' | 'keyword';
  embeddingModel?: string | null;
  extension?: string | null;
  fileKind?: FileKind | null;
  documentSize?: number | null;
  excerptChars?: number | null;
  wholeDocument?: boolean;
}

interface RagHealthEntry {
  id: string;
  filename: string;
  sourcePath?: string | null;
  kind?: string | null;
  size: number;
  status: string;
  ragMode?: string | null;
  embeddingModel?: string | null;
  errorMessage?: string | null;
  indexedAt?: string | null;
  createdAt: string;
  chunkCount: number;
  retrievalScope: 'full-document' | 'chunked';
  reason: string;
}

interface RagHealthSnapshot {
  summary: {
    total: number;
    indexed: number;
    pending: number;
    failed: number;
    warnings: number;
    fullDocuments: number;
    chunkedDocuments: number;
    lastIndexedAt: string | null;
  };
  indexedDocuments: RagHealthEntry[];
  pendingDocuments: RagHealthEntry[];
  failedDocuments: RagHealthEntry[];
}

interface SearchFilters {
  filename: string;
  folder: string;
  extension: string;
  fileKind: string;
}

interface DocumentPreview {
  document: Document;
  content: string;
  retrievalScope?: 'full-document' | 'chunked';
  chunks: Array<{
    id: string;
    chunkIndex: number;
    content: string;
  }>;
}

interface UserSettings {
  ragMode: 'semantic' | 'keyword';
  ragModel: string;
  ollamaHost: string;
}

interface UploadItem {
  file: File;
  sourcePath: string | null;
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath?: string;
}

interface FileSystemFileEntryLike extends FileSystemEntryLike {
  file: (success: (file: File) => void, error?: (error: unknown) => void) => void;
}

interface FileSystemDirectoryReaderLike {
  readEntries: (success: (entries: FileSystemEntryLike[]) => void, error?: (error: unknown) => void) => void;
}

interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  createReader: () => FileSystemDirectoryReaderLike;
}

interface Props {
  onUseInChat?: (context: string, sources: SearchResult[]) => void;
}

function normalizeUploadSourcePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').trim()
}

function buildPageItems(page: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 0) return []
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  const start = page <= 3 ? 2 : Math.max(2, page - 1)
  const end = page >= totalPages - 2 ? totalPages - 1 : Math.min(totalPages - 1, page + 1)
  const items: Array<number | 'ellipsis'> = [1]

  if (start > 2) {
    items.push('ellipsis')
  }

  for (let current = start; current <= end; current += 1) {
    items.push(current)
  }

  if (end < totalPages - 1) {
    items.push('ellipsis')
  }

  items.push(totalPages)
  return items
}

function getUploadSourcePath(file: File): string | null {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath?.trim() || ''
  const normalized = normalizeUploadSourcePath(relativePath)
  return normalized || null
}

async function readDirectoryEntries(reader: FileSystemDirectoryReaderLike): Promise<FileSystemEntryLike[]> {
  const entries: FileSystemEntryLike[] = []

  while (true) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject)
    })

    if (batch.length === 0) break
    entries.push(...batch)
  }

  return entries
}

async function readFileSystemEntry(entry: FileSystemEntryLike, parentPath = ''): Promise<UploadItem[]> {
  const currentPath = normalizeUploadSourcePath(parentPath ? `${parentPath}/${entry.name}` : entry.fullPath || entry.name)

  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FileSystemFileEntryLike).file(resolve, reject)
    })
    return [{ file, sourcePath: currentPath || null }]
  }

  if (!entry.isDirectory) {
    return []
  }

  const reader = (entry as FileSystemDirectoryEntryLike).createReader()
  const childEntries = await readDirectoryEntries(reader)
  const nested = await Promise.all(childEntries.map(child => readFileSystemEntry(child, currentPath)))
  return nested.flat()
}

async function collectUploadItemsFromDataTransfer(dataTransfer: DataTransfer): Promise<UploadItem[]> {
  const items = Array.from(dataTransfer.items || [])
  const entryReader = items.find(item => typeof (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }).webkitGetAsEntry === 'function')

  if (entryReader) {
    const collected = await Promise.all(items.map(async item => {
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }).webkitGetAsEntry?.()
      if (!entry) return []
      return await readFileSystemEntry(entry)
    }))

    const flattened = collected.flat()
    if (flattened.length > 0) return flattened
  }

  return Array.from(dataTransfer.files || []).map(file => ({
    file,
    sourcePath: getUploadSourcePath(file),
  }))
}

export default function KnowledgeBase({ onUseInChat }: Props) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentPagination, setDocumentPagination] = useState<DocumentListPagination | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [documentActionError, setDocumentActionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [expandedResult, setExpandedResult] = useState<number | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const [ragHealth, setRagHealth] = useState<RagHealthSnapshot | null>(null);
  const [ragHealthError, setRagHealthError] = useState<string | null>(null);
  const [searchFilters, setSearchFilters] = useState<SearchFilters>({
    filename: '',
    folder: '',
    extension: '',
    fileKind: '',
  });
  const [documentPreview, setDocumentPreview] = useState<DocumentPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [documentPage, setDocumentPage] = useState(1);
  const [documentPageSize, setDocumentPageSize] = useState(25);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  // -- OneDrive-style browser state --
  const [folderTree, setFolderTree] = useState<KbFolderNode | null>(null);
  const [browserFolder, setBrowserFolder] = useState<string>('');
  const [browserView, setBrowserView] = useState<'all' | 'files' | 'folders'>('all');
  const [browserSort, setBrowserSort] = useState<'name' | 'size' | 'createdAt' | 'indexedAt' | 'kind'>('name');
  const [browserOrder, setBrowserOrder] = useState<'asc' | 'desc'>('asc');
  const [browserKind, setBrowserKind] = useState<string>('');
  const [browserPage, setBrowserPage] = useState(1);
  const [browserPageInfo, setBrowserPageInfo] = useState<DocumentListPagination | null>(null);
  const [browserFolders, setBrowserFolders] = useState<KbFolderNode[]>([]);
  const [browserFiles, setBrowserFiles] = useState<Document[]>([]);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserTotal, setBrowserTotal] = useState(0);

  const fetchDocs = useCallback(async (page = documentPage, pageSize = documentPageSize) => {
    setNowMs(Date.now());

    try {
      const [docsRes, healthRes] = await Promise.all([
        fetch(`/api/rag?page=${page}&pageSize=${pageSize}`),
        fetch('/api/rag/health'),
      ]);

      const docsData = await docsRes.json();
      if (!docsRes.ok) {
        setDocumentActionError(typeof docsData?.error === 'string' ? docsData.error : 'Could not load documents.');
      } else {
        setDocumentActionError(null);
        if (Array.isArray(docsData)) {
          setDocuments(docsData);
          setDocumentPagination(null);
        } else if (Array.isArray(docsData?.documents)) {
          const normalized = docsData as DocumentListResponse;
          setDocuments(normalized.documents);
          setDocumentPagination(normalized.pagination);
          if (normalized.pagination.page !== page) {
            setDocumentPage(normalized.pagination.page);
          }
        } else {
          setDocuments([]);
          setDocumentPagination(null);
        }
      }

      const healthData = await healthRes.json();
      if (healthRes.ok) {
        setRagHealth(healthData as RagHealthSnapshot);
        setRagHealthError(null);
      } else {
        setRagHealth(null);
        setRagHealthError(typeof healthData?.error === 'string' ? healthData.error : 'Could not load RAG health.');
      }
    } catch (error) {
      console.error(error);
      setRagHealthError(error instanceof Error ? error.message : 'Could not load RAG health.');
    }
  }, [documentPage, documentPageSize]);

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void fetchDocs();
    }, 0);
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (!data.error) {
          setSettings({
            ragMode: data.ragMode === 'keyword' ? 'keyword' : 'semantic',
            ragModel: data.ragModel || 'nomic-embed-text',
            ollamaHost: data.ollamaHost || 'http://127.0.0.1:11434'
          });
        }
      })
      .catch(console.error);
    const interval = setInterval(() => {
      void fetchDocs(documentPage, documentPageSize);
    }, 4000);
    return () => {
      clearTimeout(initialLoad);
      clearInterval(interval);
    };
  }, [fetchDocs, documentPage, documentPageSize]);

  useEffect(() => {
    if (!selectAllRef.current) return;
    const selectedOnPage = documents.filter(doc => selectedDocumentIds.includes(doc.id)).length;
    selectAllRef.current.indeterminate = selectedOnPage > 0 && selectedOnPage < documents.length;
  }, [documents, selectedDocumentIds]);

  // -- OneDrive browser: load the folder tree (used for breadcrumbs, popover
  //    in chat composers, and the immediate-children listing at the current
  //    level). --
  const loadFolderTree = useCallback(async () => {
    try {
      const res = await fetch('/api/rag/folders?includeFiles=true');
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.tree) {
        setFolderTree(data.tree as KbFolderNode)
      }
    } catch (error) {
      console.error('Failed to load folder tree:', error);
    }
  }, []);

  useEffect(() => {
    void loadFolderTree();
    const id = setInterval(() => { void loadFolderTree(); }, 8000);
    return () => clearInterval(id);
  }, [loadFolderTree]);

  // Load the immediate children of `browserFolder` for the current view/sort.
  const loadCurrentLevel = useCallback(async () => {
    setBrowserLoading(true);
    try {
      const params = new URLSearchParams({
        folder: browserFolder,
        view: browserView,
        sort: browserSort,
        order: browserOrder,
        kind: browserKind,
        page: String(browserPage),
        pageSize: String(documentPageSize),
      });
      const res = await fetch(`/api/rag?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.folders)) {
        setBrowserFolders(data.folders as KbFolderNode[])
      } else {
        setBrowserFolders([])
      }
      if (Array.isArray(data?.documents)) {
        setBrowserFiles(data.documents as Document[])
      } else {
        setBrowserFiles([])
      }
      if (data?.pagination) {
        setBrowserPageInfo(data.pagination as DocumentListPagination)
        setBrowserTotal(data.pagination.total ?? 0)
      } else {
        setBrowserPageInfo(null)
        setBrowserTotal(0)
      }
    } catch (error) {
      console.error('Failed to load browser level:', error);
    } finally {
      setBrowserLoading(false)
    }
  }, [browserFolder, browserView, browserSort, browserOrder, browserKind, browserPage, documentPageSize])

  useEffect(() => {
    void loadCurrentLevel();
  }, [loadCurrentLevel])

  useEffect(() => {
    // Reset to page 1 whenever the user changes folder / view / sort / order / kind.
    setBrowserPage(1)
  }, [browserFolder, browserView, browserSort, browserOrder, browserKind])

  const readUploadResponse = async (res: Response): Promise<{ error?: string }> => {
    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      return await res.json() as { error?: string };
    }

    const text = await res.text();
    return { error: text || undefined };
  };

  const handleUpload = async (items: UploadItem[] | null) => {
    if (!items || items.length === 0) return;
    setUploading(true);
    setUploadError(null);
    setDocumentActionError(null);
    const uploads = items;
    const folderManifests = uploads.some(item => Boolean(item.sourcePath))
      ? (() => {
          const grouped = new Map<string, UploadItem[]>();

          for (const item of uploads) {
            if (!item.sourcePath) continue;
            const normalized = normalizeUploadSourcePath(item.sourcePath);
            if (!normalized) continue;
            const rootFolder = normalized.split('/')[0]?.trim();
            if (!rootFolder) continue;
            const bucket = grouped.get(rootFolder) || [];
            bucket.push({ file: item.file, sourcePath: normalized });
            grouped.set(rootFolder, bucket);
          }

          const manifests: UploadItem[] = [];
          for (const [rootFolder, files] of grouped.entries()) {
            if (files.length === 0) continue;
            const sortedFiles = [...files].sort((left, right) => (left.sourcePath || '').localeCompare(right.sourcePath || '', undefined, { numeric: true }));
            const totalBytes = sortedFiles.reduce((sum, item) => sum + item.file.size, 0);
            const fileLines = sortedFiles.slice(0, 120).map(item => `- ${item.sourcePath} (${formatSize(item.file.size)})`);
            if (sortedFiles.length > 120) {
              fileLines.push(`- ...and ${sortedFiles.length - 120} more files`);
            }

            const manifestText = [
              `Folder: ${rootFolder}`,
              `Files: ${sortedFiles.length}`,
              `Total size: ${formatSize(totalBytes)}`,
              '',
              'Relative paths:',
              ...fileLines,
              '',
              'This manifest helps the model understand the folder tree and the files it contains.',
            ].join('\n');

            const manifestName = `${rootFolder.replace(/[\\/:"*?<>|]+/g, '_') || 'folder'}.folder-manifest.txt`;
            manifests.push({
              file: new File([manifestText], manifestName, { type: 'text/plain' }),
              sourcePath: `${rootFolder}/.peakui-folder-manifest.txt`,
            });
          }

          return manifests;
        })()
      : [];

    const uploadQueue = [...folderManifests, ...uploads];
    let queuedCount = 0;
    const refreshEvery = uploadQueue.length > 120 ? 25 : uploadQueue.length > 40 ? 10 : 1;

    for (let i = 0; i < uploadQueue.length; i++) {
      const item = uploadQueue[i];
      const relativePath = item.sourcePath || getUploadSourcePath(item.file) || '';
      if (item.file.size > MAX_UPLOAD_BYTES) {
        setUploadError(`"${item.file.name}" is too large. Knowledge base files are limited to ${MAX_UPLOAD_LABEL}.`);
        break;
      }

      setUploadProgress(
        `Queuing "${item.file.name}" (${i + 1}/${uploadQueue.length}) for background indexing...`
      );

      const formData = new FormData();
      formData.append('file', item.file);
      if (relativePath) {
        formData.append('sourcePath', relativePath);
      }

      try {
        const res = await fetch('/api/rag', { method: 'POST', body: formData });
        const data = await readUploadResponse(res);
        if (!res.ok) {
          const timeoutMessage = res.status === 504
            ? 'The upload request timed out before the server could queue indexing. Try a smaller file, or check the app container logs.'
            : 'Upload failed';
          setUploadError(data.error || timeoutMessage);
          break;
        }
        queuedCount += 1;
        setUploadProgress(`Queued "${item.file.name}" (${queuedCount}/${uploadQueue.length}). Indexing continues in the document list...`);
        if (queuedCount % refreshEvery === 0 || i === uploadQueue.length - 1) {
          await fetchDocs(documentPage, documentPageSize);
        }
      } catch (e) {
        setUploadError(`Network error: ${e instanceof Error ? e.message : 'Upload failed'}`);
        break;
      }
    }

    setUploading(false);
    setUploadProgress(null);
    await fetchDocs(documentPage, documentPageSize);

    // Reset file input so same file can be re-uploaded
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const handleFileSelection = (fileList: FileList | null) => {
    void handleUpload(fileList ? Array.from(fileList).map(file => ({
      file,
      sourcePath: getUploadSourcePath(file),
    })) : null);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const items = await collectUploadItemsFromDataTransfer(event.dataTransfer);
    void handleUpload(items);
  };

  const getShortError = (message: string) => (
    message.length > 140 ? `${message.slice(0, 140)}...` : message
  );

  const formatElapsed = (dateValue: string) => {
    if (!nowMs) return '';

    const elapsedMs = nowMs - new Date(dateValue).getTime();
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return '';

    const seconds = Math.max(1, Math.floor(elapsedMs / 1000));
    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;

    return `${Math.floor(minutes / 60)}h`;
  };

  const getDocumentStatusLabel = (doc: Document) => {
    if (doc.status === 'ready') return 'Ready';
    const elapsed = formatElapsed(doc.createdAt);
    if (doc.status === 'queued') return elapsed ? `Queued · ${elapsed}` : 'Queued';
    if (doc.status === 'processing') return elapsed ? `Indexing · ${elapsed}` : 'Indexing';
    return 'Failed — retry upload';
  };

  const handleDelete = async (ids: string[], label: string) => {
    if (ids.length === 0) return;
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return;

    setDocumentActionError(null);

    try {
      const res = await fetch('/api/rag', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids.length === 1 ? { id: ids[0] } : { ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDocumentActionError(typeof data?.error === 'string' ? data.error : 'Delete failed.');
        return;
      }

      // The server returns the actual deleted ids (it can differ from `ids`
      // when a folder cascade widens the set or a single id is malformed).
      const removedIds: string[] = Array.isArray(data?.ids) ? data.ids : ids;
      const removedSet = new Set(removedIds);
      setSelectedDocumentIds(current => current.filter(id => !removedSet.has(id)));
      await Promise.all([
        fetchDocs(documentPage, documentPageSize),
        loadCurrentLevel(),
        loadFolderTree(),
      ]);
    } catch (error) {
      setDocumentActionError(error instanceof Error ? error.message : 'Delete failed.');
    }
  };

  const selectedOnPageCount = documents.filter(doc => selectedDocumentIds.includes(doc.id)).length;
  const selectAllChecked = documents.length > 0 && selectedOnPageCount === documents.length;
  const totalDocuments = documentPagination?.total ?? documents.length;
  const totalPages = documentPagination?.totalPages ?? (documents.length > 0 ? 1 : 0);

  // -- OneDrive browser selection (mirrors the legacy list) --
  const browserFileIds = browserFiles.map(doc => doc.id);
  const selectedOnBrowserPage = browserFiles.filter(doc => selectedDocumentIds.includes(doc.id)).length;
  const selectAllBrowserChecked = browserFileIds.length > 0 && selectedOnBrowserPage === browserFileIds.length;
  const selectAllBrowserIndeterminate = selectedOnBrowserPage > 0 && selectedOnBrowserPage < browserFileIds.length;

  const toggleDocumentSelection = (id: string, checked: boolean) => {
    setSelectedDocumentIds(current => {
      if (checked) {
        return current.includes(id) ? current : [...current, id];
      }

      return current.filter(currentId => currentId !== id);
    });
  };

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedDocumentIds(checked ? documents.map(doc => doc.id) : []);
  };

  const toggleSelectAllBrowser = (checked: boolean) => {
    setSelectedDocumentIds(checked ? Array.from(new Set([...selectedDocumentIds, ...browserFileIds])) : selectedDocumentIds.filter(id => !browserFileIds.includes(id)));
  };

  // Drop any selected ids that no longer correspond to a file the user can see
  // — happens when a folder deletes its subtree or the user changes folder/sort.
  useEffect(() => {
    const knownIds = new Set([...documents.map(d => d.id), ...browserFileIds]);
    setSelectedDocumentIds(current => current.filter(id => knownIds.has(id)));
  }, [documents, browserFileIds]);


  const handleBulkDelete = async () => {
    await handleDelete(selectedDocumentIds, `${selectedDocumentIds.length} selected document${selectedDocumentIds.length !== 1 ? 's' : ''}`);
  };

  // -- OneDrive browser handlers --
  const navigateToFolder = (path: string) => {
    setBrowserFolder(path);
    setSelectedDocumentIds([]);
  };
  const navigateUp = () => {
    if (browserFolder === '') return;
    const segments = browserFolder.split('/');
    segments.pop();
    setBrowserFolder(segments.join('/'));
    setSelectedDocumentIds([]);
  };
  const handleBrowserSort = (key: typeof browserSort) => {
    if (key === browserSort) {
      setBrowserOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setBrowserSort(key);
      setBrowserOrder('asc');
    }
  };
  const handleBrowserDeleteFolder = async (path: string) => {
    if (!folderTree) return;
    const node = findFolderInTree(folderTree, path);
    if (!node) return;
    const count = node.recursiveFileCount;
    if (count === 0) {
      // Nothing to delete (no files in subtree). The folder rows are derived
      // from the docs themselves so an empty subtree will already be gone.
      return;
    }
    const label = path === '' ? 'the root level' : `folder "${path}"`;
    if (!confirm(`Delete ${count} file${count !== 1 ? 's' : ''} in ${label}? This cannot be undone.`)) return;
    setDocumentActionError(null);
    try {
      const res = await fetch('/api/rag', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: path }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDocumentActionError(typeof data?.error === 'string' ? data?.error : 'Folder delete failed.');
        return;
      }
      // Drop any selected ids that just got deleted so the bulk-delete button
      // doesn't try to act on stale rows. The server returns the actual deleted
      // ids (a folder cascade can delete more than the visible set, e.g. files
      // in nested subfolders that the current tree view doesn't render).
      const removedIds = new Set(Array.isArray(data?.ids) ? data.ids : []);
      if (removedIds.size > 0) {
        setSelectedDocumentIds(current => current.filter(id => !removedIds.has(id)));
      }
      await Promise.all([loadFolderTree(), loadCurrentLevel()]);
    } catch (error) {
      setDocumentActionError(error instanceof Error ? error.message : 'Folder delete failed.');
    }
  };
  const breadcrumbSegments = useMemo(() => {
    if (browserFolder === '') return [] as string[];
    return browserFolder.split('/');
  }, [browserFolder]);
  const folderKindOptions = useMemo(() => {
    const set = new Set<string>();
    if (folderTree) {
      const walk = (node: KbFolderNode) => {
        for (const child of node.children) walk(child);
      };
      walk(folderTree);
    }
    browserFiles.forEach(f => { if (f.kind) set.add(f.kind); });
    return Array.from(set).sort();
  }, [folderTree, browserFiles]);

  const handleSearch = async () => {
    if (!searchQuery.trim() || searching) return;
    setSearching(true);
    setSearchResults(null);
    setSearchError(null);
    setExpandedResult(null);

    try {
      const res = await fetch('/api/rag/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchQuery,
          topK: 5,
          filters: {
            filename: searchFilters.filename.trim() || undefined,
            folder: searchFilters.folder.trim() || undefined,
            extension: searchFilters.extension.trim().replace(/^\./, '').toLowerCase() || undefined,
            fileKind: searchFilters.fileKind.trim() || undefined,
          }
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error || 'Search failed');
      } else {
        setSearchResults(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      setSearchError(`Search error: ${e instanceof Error ? e.message : 'Search failed'}`);
    } finally {
      setSearching(false);
    }
  };

  const handleUseInChat = () => {
    if (!searchResults || searchResults.length === 0 || !onUseInChat) return;
    const context = searchResults
      .map((r, idx) => {
        const meta = [
          r.fileKind || null,
          r.extension ? `.${r.extension}` : null,
          r.wholeDocument
            ? 'full document'
            : typeof r.chunkIndex === 'number'
              ? typeof r.documentChunkCount === 'number'
                ? `chunk ${r.chunkIndex + 1}/${r.documentChunkCount}`
                : `chunk ${r.chunkIndex + 1}`
              : null,
          typeof r.documentSize === 'number' ? formatSize(r.documentSize) : null,
          `${(r.score * 100).toFixed(0)}% match`,
          r.mode || 'semantic',
        ].filter(Boolean).join(' · ');

        const sourceLabel = r.sourcePath && r.sourcePath !== r.filename
          ? `${r.filename} (${r.sourcePath})`
          : r.filename;

        return `[Source ${idx + 1}: ${sourceLabel} — ${meta}]\n${r.content}`;
      })
      .join('\n\n---\n\n');
    onUseInChat(context, searchResults);
  };

  const openDocumentPreview = async (documentId?: string) => {
    if (!documentId) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setDocumentPreview(null);
    try {
      const res = await fetch(`/api/rag/documents/${documentId}`);
      const data = await res.json();
      if (!res.ok) {
        setPreviewError(data.error || 'Could not load the full document.');
        return;
      }

      setDocumentPreview({
        document: data.document,
        content: data.content || '',
        retrievalScope: data.retrievalScope === 'full-document' ? 'full-document' : 'chunked',
        chunks: Array.isArray(data.chunks) ? data.chunks : [],
      });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Could not load the full document.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const fileKindOptions = [
    'image',
    'document',
    'text',
    'code',
    'data',
    'archive',
    'audio',
    'video',
    'binary',
  ];
  const documentPageSizeOptions = [10, 25, 50, 100];

  const readyDocs = documents.filter(d => d.status === 'ready');
  const pendingDocs = documents.filter(d => d.status === 'queued' || d.status === 'processing');
  const errorDocs = documents.filter(d => d.status === 'error');
  const showDocumentPreview = Boolean(documentPreview || previewLoading || previewError);
  const ragHealthSummary = ragHealth?.summary;
  const currentDocumentPage = documentPagination?.page ?? documentPage;
  const pageItems = buildPageItems(currentDocumentPage, totalPages);
  const hasReadyDocuments = (ragHealthSummary?.indexed ?? 0) > 0 || documents.some(doc => doc.status === 'ready');
  const searchableDocumentCount = ragHealthSummary?.indexed ?? readyDocs.length;
  const ragHealthHasIssues = Boolean(
    (ragHealthSummary && (ragHealthSummary.failed > 0 || ragHealthSummary.pending > 0 || ragHealthSummary.warnings > 0)) ||
    ragHealthError
  );
  const renderHealthEntry = (entry: RagHealthEntry, tone: 'success' | 'warning' | 'danger' | 'neutral') => {
    const toneTextColor = tone === 'success'
      ? 'var(--success)'
      : tone === 'warning'
        ? '#facc15'
        : tone === 'danger'
          ? 'var(--danger)'
          : 'var(--text-secondary)';
    const toneBorder = tone === 'success'
      ? 'rgba(16,185,129,0.24)'
      : tone === 'warning'
        ? 'rgba(250,204,21,0.24)'
        : tone === 'danger'
          ? 'rgba(239,68,68,0.24)'
          : 'var(--border-color)';
    const toneBackground = tone === 'success'
      ? 'rgba(16,185,129,0.08)'
      : tone === 'warning'
        ? 'rgba(250,204,21,0.08)'
        : tone === 'danger'
          ? 'rgba(239,68,68,0.08)'
          : 'rgba(255,255,255,0.03)';

    return (
      <div
        key={entry.id}
        style={{
          padding: '12px 14px',
          borderRadius: '12px',
          border: `1px solid ${toneBorder}`,
          background: toneBackground,
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.86rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.sourcePath && entry.sourcePath !== entry.filename ? `${entry.filename} · ${entry.sourcePath}` : entry.filename}
            </div>
            <div style={{ marginTop: '4px', fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {entry.kind && <span>{entry.kind}</span>}
              <span>{entry.retrievalScope === 'full-document' ? 'full document' : `${entry.chunkCount} chunks`}</span>
              {entry.ragMode && <span>{entry.ragMode}</span>}
              {entry.errorMessage && entry.status === 'ready' && <span>fallback</span>}
            </div>
          </div>
          <div style={{
            flexShrink: 0,
            fontSize: '0.7rem',
            padding: '2px 8px',
            borderRadius: '999px',
            color: toneTextColor,
            border: `1px solid ${toneBorder}`,
            background: toneBackground,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            whiteSpace: 'nowrap',
          }}>
            {entry.status}
          </div>
        </div>
        <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.6 }} title={entry.reason}>
          {getShortError(entry.reason)}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '24px', gap: '24px' }}>

      {/* Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <div style={{ background: 'var(--accent-gradient)', padding: '8px', borderRadius: '10px' }}>
            <Database size={22} color="white" />
          </div>
          <h2 style={{ margin: 0, fontSize: '1.5rem' }}>Knowledge Base</h2>
        </div>
        <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>
          Upload your documents, then toggle <strong style={{ color: 'var(--accent-primary)' }}>RAG mode</strong> in the chat header to have the AI answer questions using your files.
          {settings?.ragMode === 'keyword'
            ? <> Keyword search is active, so new uploads are indexed without calling an embedding model.</>
            : <> Embeddings are generated locally using <code>{settings?.ragModel || 'nomic-embed-text'}</code> at <code>{settings?.ollamaHost || 'http://127.0.0.1:11434'}</code>.</>
          } Nothing leaves your machine.
        </p>
      </div>

      <details open={ragHealthHasIssues} style={{
        border: '1px solid var(--border-color)',
        borderRadius: '14px',
        background: 'rgba(255,255,255,0.02)',
        overflow: 'hidden',
      }}>
        <summary style={{
          listStyle: 'none',
          cursor: 'pointer',
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)' }}>
              RAG health
            </div>
            <div style={{ marginTop: '4px', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
              {ragHealthSummary
                ? `${ragHealthSummary.indexed} indexed · ${ragHealthSummary.failed} failed · ${ragHealthSummary.pending} pending`
                : ragHealthError || 'Loading health status...'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span style={{ padding: '4px 8px', borderRadius: '999px', background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
              {ragHealthSummary?.total ?? documents.length} files
            </span>
            <span style={{ padding: '4px 8px', borderRadius: '999px', background: 'rgba(16,185,129,0.15)', color: 'var(--success)', fontSize: '0.72rem' }}>
              {ragHealthSummary?.fullDocuments ?? 0} full docs
            </span>
            <span style={{ padding: '4px 8px', borderRadius: '999px', background: 'rgba(245,158,11,0.16)', color: '#facc15', fontSize: '0.72rem' }}>
              {ragHealthSummary?.warnings ?? 0} warnings
            </span>
            <span style={{ padding: '4px 8px', borderRadius: '999px', background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', fontSize: '0.72rem' }}>
              {ragHealthSummary?.failed ?? 0} failed
            </span>
          </div>
        </summary>
        <div style={{ padding: '0 16px 16px 16px', display: 'grid', gap: '14px' }}>
          {ragHealthError && (
            <div style={{
              padding: '12px 14px',
              borderRadius: '12px',
              border: '1px solid var(--danger)',
              background: 'rgba(239,68,68,0.08)',
              color: '#fca5a5',
              fontSize: '0.84rem',
              lineHeight: 1.6,
            }}>
              {ragHealthError}
            </div>
          )}

          {ragHealthSummary && (
            <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
              {[
                { label: 'Indexed', value: ragHealthSummary.indexed, accent: 'var(--success)' },
                { label: 'Full docs', value: ragHealthSummary.fullDocuments, accent: 'var(--accent-primary)' },
                { label: 'Chunked', value: ragHealthSummary.chunkedDocuments, accent: 'var(--text-secondary)' },
                { label: 'Warnings', value: ragHealthSummary.warnings, accent: '#facc15' },
                { label: 'Failed', value: ragHealthSummary.failed, accent: 'var(--danger)' },
                { label: 'Pending', value: ragHealthSummary.pending, accent: 'var(--text-secondary)' },
              ].map(item => (
                <div key={item.label} style={{
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color)',
                  background: 'rgba(255,255,255,0.03)',
                }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {item.label}
                  </div>
                  <div style={{ marginTop: '6px', fontSize: '1.2rem', fontWeight: 700, color: item.accent }}>
                    {item.value}
                  </div>
                  {item.label === 'Indexed' && ragHealthSummary.lastIndexedAt && (
                    <div style={{ marginTop: '4px', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                      Last indexed {formatElapsed(ragHealthSummary.lastIndexedAt)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <div style={{ display: 'grid', gap: '8px' }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)' }}>
                Indexed successfully
              </div>
              {ragHealth?.indexedDocuments.length
                ? ragHealth.indexedDocuments.slice(0, 5).map(entry => renderHealthEntry(entry, entry.errorMessage ? 'warning' : 'success'))
                : (
                  <div style={{ padding: '12px 14px', borderRadius: '12px', border: '1px dashed var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                    {documents.length > 0 ? 'No ready files yet.' : 'Upload files to see indexing status here.'}
                  </div>
                )}
              {ragHealth && ragHealth.indexedDocuments.length > 5 && (
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                  +{ragHealth.indexedDocuments.length - 5} more indexed file{ragHealth.indexedDocuments.length - 5 !== 1 ? 's' : ''}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gap: '8px' }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)' }}>
                Failed and why
              </div>
              {ragHealth?.failedDocuments.length
                ? ragHealth.failedDocuments.slice(0, 5).map(entry => renderHealthEntry(entry, 'danger'))
                : (
                  <div style={{ padding: '12px 14px', borderRadius: '12px', border: '1px dashed var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                    No failed files right now.
                  </div>
                )}
              {ragHealth && ragHealth.failedDocuments.length > 5 && (
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                  +{ragHealth.failedDocuments.length - 5} more failed file{ragHealth.failedDocuments.length - 5 !== 1 ? 's' : ''}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gap: '8px' }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)' }}>
                Still processing
              </div>
              {ragHealth?.pendingDocuments.length
                ? ragHealth.pendingDocuments.slice(0, 5).map(entry => renderHealthEntry(entry, 'neutral'))
                : (
                  <div style={{ padding: '12px 14px', borderRadius: '12px', border: '1px dashed var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                    No pending files right now.
                  </div>
                )}
              {ragHealth && ragHealth.pendingDocuments.length > 5 && (
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                  +{ragHealth.pendingDocuments.length - 5} more pending file{ragHealth.pendingDocuments.length - 5 !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        </div>
      </details>

      {/* How it works banner */}
      <div style={{
        display: 'flex', gap: '0', borderRadius: '12px', overflow: 'hidden',
        border: '1px solid var(--border-color)', fontSize: '0.8rem'
      }}>
        {[
          { icon: '📁', step: '1', label: 'Upload files', sub: 'txt, md, csv, code...' },
          settings?.ragMode === 'keyword'
            ? { icon: '⚡', step: '2', label: 'Keyword indexed', sub: 'BM25, no model needed' }
            : { icon: '⚡', step: '2', label: 'Auto-embedded', sub: `via ${settings?.ragModel || 'nomic-embed-text'}` },
          { icon: '🔍', step: '3', label: 'Search here', sub: settings?.ragMode === 'keyword' ? 'keyword ranking' : 'semantic ranking' },
          { icon: '🤖', step: '4', label: 'AI answers', sub: 'with your context' },
        ].map((item, i) => (
          <div key={i} style={{
            flex: 1, padding: '12px', textAlign: 'center',
            background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.1)',
            borderRight: i < 3 ? '1px solid var(--border-color)' : undefined
          }}>
            <div style={{ fontSize: '1.2rem', marginBottom: '4px' }}>{item.icon}</div>
            <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>Step {item.step}: {item.label}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>{item.sub}</div>
          </div>
        ))}
      </div>

      {/* Upload Zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{
          padding: '32px 24px',
          textAlign: 'center',
          cursor: uploading ? 'wait' : 'default',
          border: `2px dashed ${dragOver ? 'var(--accent-primary)' : 'var(--border-color)'}`,
          borderRadius: '16px',
          background: dragOver ? 'var(--accent-faint)' : 'rgba(255,255,255,0.02)',
          transition: 'all 0.2s',
          transform: dragOver ? 'scale(1.01)' : 'scale(1)',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="*/*"
          style={{ display: 'none' }}
          onChange={e => handleFileSelection(e.target.files)}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          accept="*/*"
          // @ts-expect-error webkitdirectory is a non-standard boolean attribute; React 19 typings do not include webKitDirectory.
          webKitDirectory=""
          directory=""
          style={{ display: 'none' }}
          onChange={e => handleFileSelection(e.target.files)}
        />
        {uploading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <Loader2 size={36} color="var(--accent-primary)" style={{ animation: 'spin 1s linear infinite' }} />
            <div style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>
              {uploadProgress || 'Uploading...'}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              Uploads are queued first; indexing continues in the document list.
            </div>
          </div>
        ) : (
          <>
            <Upload size={36} color={dragOver ? 'var(--accent-primary)' : 'var(--text-secondary)'} style={{ marginBottom: '12px' }} />
            <div style={{ fontWeight: 600, fontSize: '1.05rem', marginBottom: '6px' }}>
              {dragOver ? 'Drop to upload' : 'Click or drag & drop files or folders'}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
              PDF · DOC/DOCX · PPTX · XLSX · ODT · RTF · text · code · data files
            </div>
            <div style={{ marginTop: '14px', display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary"
                style={{ padding: '8px 14px' }}
                onClick={e => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                Choose files
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: '8px 14px' }}
                onClick={e => {
                  e.stopPropagation();
                  folderInputRef.current?.click();
                }}
              >
                Choose folder
              </button>
            </div>
            <div style={{ marginTop: '10px', fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.5, maxWidth: '42rem' }}>
              Folder uploads preserve relative paths, keep the uploaded tree intact in the index, and batch refresh the list so large project drops stay responsive.
            </div>
          </>
        )}
      </div>

      {/* Upload Error */}
      {uploadError && (
        <div style={{
          padding: '14px 16px', borderRadius: '10px',
          background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)',
          color: '#fca5a5', fontSize: '0.85rem', display: 'flex', gap: '10px', alignItems: 'flex-start'
        }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
          <div>
            <strong>Upload failed:</strong> {uploadError}
          </div>
          <X size={16} style={{ marginLeft: 'auto', cursor: 'pointer', flexShrink: 0 }} onClick={() => setUploadError(null)} />
        </div>
      )}


      {/* OneDrive-style Browser */}
      {(browserFiles.length > 0 || browserFolders.length > 0 || browserTotal > 0 || browserLoading) && (
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: '12px',
            flexWrap: 'wrap',
          }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)' }}>
              {folderTree && browserFolder === '' && (
                <span>Knowledge Base — {folderTree.recursiveFileCount} file{folderTree.recursiveFileCount !== 1 ? 's' : ''}</span>
              )}
              {folderTree && browserFolder !== '' && (
                <span>{folderTree.recursiveFileCount} total file{folderTree.recursiveFileCount !== 1 ? 's' : ''}</span>
              )}
              {ragHealthSummary && (
                <span style={{ marginLeft: '8px' }}>
                  · {ragHealthSummary.indexed} indexed · {ragHealthSummary.pending} pending · {ragHealthSummary.failed} failed
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                <span>Per page</span>
                <select
                  className="input-field"
                  value={documentPageSize}
                  onChange={e => {
                    setDocumentPageSize(Number(e.target.value));
                    setBrowserPage(1);
                  }}
                  style={{ minWidth: '90px', padding: '8px 10px' }}
                >
                  {documentPageSizeOptions.map(size => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </label>
              {selectedDocumentIds.length > 0 && (
                <button
                  className="btn btn-secondary"
                  style={{ padding: '8px 12px' }}
                  onClick={handleBulkDelete}
                >
                  Delete selected ({selectedDocumentIds.length})
                </button>
              )}
            </div>
          </div>

          {documentActionError && (
            <div style={{
              marginBottom: '12px',
              padding: '12px 14px',
              borderRadius: '10px',
              background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)',
              color: '#fca5a5', fontSize: '0.85rem', display: 'flex', gap: '10px', alignItems: 'flex-start'
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
              <div style={{ minWidth: 0 }}>{documentActionError}</div>
              <X size={16} style={{ marginLeft: 'auto', cursor: 'pointer', flexShrink: 0 }} onClick={() => setDocumentActionError(null)} />
            </div>
          )}

          {/* Breadcrumb */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
            padding: '10px 12px', borderRadius: '10px',
            border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.03)',
            marginBottom: '10px',
          }}>
            <button
              onClick={() => navigateToFolder('')}
              style={{
                background: browserFolder === '' ? 'var(--accent-soft)' : 'transparent',
                border: 'none', cursor: 'pointer', color: browserFolder === '' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                padding: '4px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: '0.85rem', fontWeight: 500,
              }}
              title="Go to Knowledge Base root"
            >
              <Home size={14} />
              Knowledge Base
            </button>
            {breadcrumbSegments.map((seg, idx) => {
              const path = breadcrumbSegments.slice(0, idx + 1).join('/');
              const isLast = idx === breadcrumbSegments.length - 1;
              return (
                <React.Fragment key={path}>
                  <ChevronRight size={12} color="var(--text-secondary)" />
                  <button
                    onClick={() => navigateToFolder(path)}
                    style={{
                      background: isLast ? 'var(--accent-soft)' : 'transparent',
                      border: 'none', cursor: 'pointer', color: isLast ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      padding: '4px 8px', borderRadius: '6px',
                      fontSize: '0.85rem', fontWeight: isLast ? 600 : 500,
                    }}
                  >
                    {seg}
                  </button>
                </React.Fragment>
              );
            })}
            {browserFolder !== '' && (
              <button
                onClick={navigateUp}
                style={{
                  marginLeft: 'auto', background: 'transparent', border: '1px solid var(--border-color)',
                  cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px 10px', borderRadius: '6px',
                  fontSize: '0.78rem',
                }}
                title="Up one level"
              >
                ↑ Up
              </button>
            )}
          </div>

          {/* Toolbar: view, sort, kind */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
            padding: '8px 10px', borderRadius: '10px',
            border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)',
            marginBottom: '10px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
              {(['all', 'files', 'folders'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setBrowserView(v)}
                  style={{
                    background: browserView === v ? 'var(--accent-primary)' : 'transparent',
                    color: browserView === v ? 'white' : 'var(--text-secondary)',
                    border: 'none', padding: '6px 12px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
                  }}
                >{v === 'all' ? 'All' : v === 'files' ? 'Files' : 'Folders'}</button>
              ))}
            </div>
            {browserView !== 'folders' && browserFileIds.length > 0 && (
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '4px 10px', borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: selectAllBrowserIndeterminate ? 'var(--accent-soft)' : 'rgba(255,255,255,0.04)',
                  color: selectAllBrowserIndeterminate || selectAllBrowserChecked ? 'var(--accent-primary)' : 'var(--text-primary)',
                  fontSize: '0.78rem', fontWeight: 500, cursor: 'pointer',
                  userSelect: 'none',
                }}
                title={`${selectedOnBrowserPage} of ${browserFileIds.length} selected on this page — click to select/deselect all files on the current page`}
              >
                <input
                  type="checkbox"
                  ref={el => {
                    selectAllRef.current = el;
                    if (el) el.indeterminate = selectAllBrowserIndeterminate;
                  }}
                  checked={selectAllBrowserChecked}
                  onChange={e => toggleSelectAllBrowser(e.target.checked)}
                  style={{ margin: 0, cursor: 'pointer' }}
                />
                <span>Select all on page ({browserFileIds.length})</span>
              </label>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              <ArrowUpDown size={12} />
              <span>Sort</span>
              <select
                className="input-field"
                value={browserSort}
                onChange={e => handleBrowserSort(e.target.value as typeof browserSort)}
                style={{ padding: '4px 8px', fontSize: '0.78rem' }}
              >
                <option value="name">Name</option>
                <option value="size">Size</option>
                <option value="createdAt">Created</option>
                <option value="indexedAt">Indexed</option>
                <option value="kind">Kind</option>
              </select>
              <button
                onClick={() => setBrowserOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.74rem' }}
                title={`Sort ${browserOrder === 'asc' ? 'descending' : 'ascending'}`}
              >
                {browserOrder === 'asc' ? '↑' : '↓'}
              </button>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              <FilterIcon size={12} />
              <span>Kind</span>
              <select
                className="input-field"
                value={browserKind}
                onChange={e => setBrowserKind(e.target.value)}
                style={{ padding: '4px 8px', fontSize: '0.78rem' }}
              >
                <option value="">All</option>
                {folderKindOptions.map(k => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>
            {browserFolders.length > 0 && (
              <div style={{ marginLeft: 'auto', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                {browserFolders.length} folder{browserFolders.length !== 1 ? 's' : ''}
                {browserView !== 'folders' && browserTotal > 0 && (
                  <> · {browserTotal} file{browserTotal !== 1 ? 's' : ''}</>
                )}
              </div>
            )}
          </div>

          {/* List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {browserView !== 'files' && browserFolders.map(folder => (
              <div
                key={folder.path}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 14px', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)',
                  cursor: 'pointer', transition: 'background 0.15s',
                }}
                onClick={() => navigateToFolder(folder.path)}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.08)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)' }}
                title={`Open folder ${folder.path}`}
              >
                <Folder size={18} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                    {folder.name}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {folder.recursiveFileCount} file{folder.recursiveFileCount !== 1 ? 's' : ''} · {formatSize(folder.recursiveSize)}
                    {folder.directFileCount > 0 && folder.recursiveFileCount > folder.directFileCount && (
                      <span style={{ marginLeft: '6px' }}>({folder.directFileCount} direct)</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleBrowserDeleteFolder(folder.path);
                  }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '6px', borderRadius: '6px', opacity: 0.7, flexShrink: 0 }}
                  title="Delete folder (cascades to all files inside)"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            {browserView !== 'folders' && browserFiles.map(doc => (
              <div
                key={doc.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 14px', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.08)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)' }}
              >
                <input
                  type="checkbox"
                  checked={selectedDocumentIds.includes(doc.id)}
                  onChange={e => toggleDocumentSelection(doc.id, e.target.checked)}
                  onClick={e => e.stopPropagation()}
                />
                <FileText size={18} color={doc.status === 'error' ? 'var(--danger)' : 'var(--accent-primary)'} style={{ flexShrink: 0 }} />
                <div
                  style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                  onClick={() => openDocumentPreview(doc.id)}
                  title="Click to preview full document"
                >
                  <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.9rem' }}>
                    {doc.filename}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', gap: '10px', marginTop: '2px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>{formatSize(doc.size)}</span>
                    {doc.kind && <span>{doc.kind}</span>}
                    {doc._count.chunks > 0 && <span>{doc._count.chunks} chunks</span>}
                    <span>
                      {doc.ragMode === 'keyword'
                        ? 'Keyword/BM25'
                        : `Semantic${doc.embeddingModel ? ` · ${doc.embeddingModel}` : ''}`}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {doc.status === 'ready' && <CheckCircle size={12} color="var(--success)" />}
                      {(doc.status === 'queued' || doc.status === 'processing') && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
                      {doc.status === 'error' && <AlertCircle size={12} color="var(--danger)" />}
                      <span style={{ color: doc.status === 'ready' ? 'var(--success)' : doc.status === 'error' ? 'var(--danger)' : 'inherit' }}>
                        {getDocumentStatusLabel(doc)}
                      </span>
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete([doc.id], doc.sourcePath && doc.sourcePath !== doc.filename ? `${doc.filename} (${doc.sourcePath})` : doc.filename)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '6px', borderRadius: '6px', opacity: 0.7, flexShrink: 0 }}
                  title="Delete document"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            {browserFolders.length === 0 && browserFiles.length === 0 && !browserLoading && (
              <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--border-color)', borderRadius: '12px' }}>
                <Folder size={28} style={{ marginBottom: '10px', opacity: 0.3 }} />
                <div style={{ fontWeight: 500, marginBottom: '4px' }}>This folder is empty</div>
                <div style={{ fontSize: '0.8rem' }}>Drop files here or use the upload buttons above.</div>
              </div>
            )}
          </div>

          {/* Pagination (files only) */}
          {browserView !== 'folders' && (browserPageInfo?.totalPages ?? 0) > 1 && (
            <div style={{
              marginTop: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              flexWrap: 'wrap',
            }}>
              <button
                className="btn btn-secondary"
                style={{ padding: '8px 12px' }}
                onClick={() => setBrowserPage(current => Math.max(1, current - 1))}
                disabled={!browserPageInfo?.hasPreviousPage}
              >
                &lt;
              </button>
              {buildPageItems(browserPage ?? 1, browserPageInfo?.totalPages ?? 0).map((item, index) => (
                item === 'ellipsis' ? (
                  <span key={`ellipsis-${index}`} style={{ color: 'var(--text-secondary)', padding: '0 6px' }}>...</span>
                ) : (
                  <button
                    key={item}
                    className="btn btn-secondary"
                    style={{
                      padding: '8px 12px',
                      minWidth: '42px',
                      background: item === (browserPage ?? 1) ? 'var(--accent-primary)' : undefined,
                      color: item === (browserPage ?? 1) ? 'white' : undefined,
                    }}
                    onClick={() => setBrowserPage(item)}
                    disabled={item === (browserPage ?? 1)}
                  >
                    {item}
                  </button>
                )
              ))}
              <button
                className="btn btn-secondary"
                style={{ padding: '8px 12px' }}
                onClick={() => setBrowserPage(current => Math.min(browserPageInfo?.totalPages ?? 1, current + 1))}
                disabled={!browserPageInfo?.hasNextPage}
              >
                &gt;
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty State — when the browser has no docs at all */}
      {!browserLoading && browserFolders.length === 0 && browserFiles.length === 0 && browserTotal === 0 && (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--border-color)', borderRadius: '12px' }}>
          <Database size={36} style={{ marginBottom: '12px', opacity: 0.3 }} />
          <div style={{ fontWeight: 500, marginBottom: '4px' }}>No documents yet</div>
          <div style={{ fontSize: '0.82rem' }}>Upload files above to start building your knowledge base.</div>
        </div>
      )}


      {/* Search Section — only show when there are ready documents */}
      {hasReadyDocuments && (
        <div>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            Search Knowledge Base
            {settings && <span style={{ marginLeft: '8px', color: 'var(--accent-primary)' }}>({settings.ragMode === 'keyword' ? 'Keyword/BM25' : 'Semantic'})</span>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: searchResults !== null || searchError ? '16px' : '0' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'stretch' }}>
              <input
                type="text"
                className="input-field"
                placeholder={`Search across ${searchableDocumentCount} document${searchableDocumentCount !== 1 ? 's' : ''}...`}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-primary"
                onClick={handleSearch}
                disabled={searching || !searchQuery.trim()}
                style={{ padding: '10px 20px', opacity: (!searchQuery.trim() || searching) ? 0.5 : 1 }}
              >
                {searching
                  ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                  : <><Search size={16} /> Search</>
                }
              </button>
            </div>

            <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
              <input
                type="text"
                className="input-field"
                placeholder="Filename contains..."
                value={searchFilters.filename}
                onChange={e => setSearchFilters(current => ({ ...current, filename: e.target.value }))}
              />
              <input
                type="text"
                className="input-field"
                placeholder="Folder contains..."
                value={searchFilters.folder}
                onChange={e => setSearchFilters(current => ({ ...current, folder: e.target.value }))}
              />
              <input
                type="text"
                className="input-field"
                placeholder="Extension"
                value={searchFilters.extension}
                onChange={e => setSearchFilters(current => ({ ...current, extension: e.target.value }))}
              />
              <select
                className="input-field"
                value={searchFilters.fileKind}
                onChange={e => setSearchFilters(current => ({ ...current, fileKind: e.target.value }))}
              >
                <option value="">All types</option>
                {fileKindOptions.map(kind => (
                  <option key={kind} value={kind}>{kind}</option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              Tip: use <code>file:</code>, <code>folder:</code>, <code>type:</code>, or <code>ext:</code> inside the query for direct narrowing.
            </div>
          </div>

          {/* Search Error */}
          {searchError && (
            <div style={{
              padding: '12px 14px', borderRadius: '10px',
              background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)',
              color: '#fca5a5', fontSize: '0.85rem', display: 'flex', gap: '8px'
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              {searchError}
            </div>
          )}

          {/* Search Results */}
          {searchResults !== null && !searchError && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {searchResults.length === 0 ? 'No relevant matches found — try rephrasing.' : `${searchResults.length} relevant chunk${searchResults.length !== 1 ? 's' : ''} found`}
                </div>
                {searchResults.length > 0 && onUseInChat && (
                  <button
                    className="btn btn-primary"
                    style={{ padding: '6px 14px', fontSize: '0.8rem' }}
                    onClick={handleUseInChat}
                  >
                    <MessageSquare size={14} /> Send to Chat
                  </button>
                )}
              </div>

              {searchResults.map((r, i) => (
                <div
                  key={i}
                  style={{
                    borderRadius: '12px', overflow: 'hidden',
                    border: '1px solid var(--border-color)',
                    background: 'rgba(255,255,255,0.03)'
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', cursor: 'pointer' }}
                    onClick={() => setExpandedResult(expandedResult === i ? null : i)}
                  >
                    <FileText size={14} color="var(--accent-primary)" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.sourcePath && r.sourcePath !== r.filename ? `${r.filename} · ${r.sourcePath}` : r.filename}
                      </div>
                      <div style={{ marginTop: '4px', fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {r.fileKind && <span>{r.fileKind}</span>}
                        {r.extension && <span>.{r.extension}</span>}
                        {r.wholeDocument
                          ? <span>full document</span>
                          : typeof r.chunkIndex === 'number'
                            ? <span>{typeof r.documentChunkCount === 'number' ? `chunk ${r.chunkIndex + 1}/${r.documentChunkCount}` : `chunk ${r.chunkIndex + 1}`}</span>
                            : null}
                        {typeof r.documentSize === 'number' && <span>{formatSize(r.documentSize)}</span>}
                        {typeof r.excerptChars === 'number' && <span>{r.wholeDocument ? `${r.excerptChars.toLocaleString()} chars full text` : `${r.excerptChars.toLocaleString()} chars excerpt`}</span>}
                      </div>
                    </div>
                    <div style={{
                      fontSize: '0.72rem', padding: '2px 8px', borderRadius: '20px',
                      background: r.score > 0.7 ? 'rgba(34,197,94,0.15)' : r.score > 0.5 ? 'rgba(234,179,8,0.15)' : 'rgba(255,255,255,0.05)',
                      color: r.score > 0.7 ? 'var(--success)' : r.score > 0.5 ? '#eab308' : 'var(--text-secondary)'
                    }}>
                      {(r.score * 100).toFixed(0)}% match · {r.mode || settings?.ragMode || 'semantic'}
                    </div>
                    {expandedResult === i ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </div>
                  {expandedResult === i && (
                    <div style={{
                      padding: '12px 14px', borderTop: '1px solid var(--border-color)',
                      fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7,
                      whiteSpace: 'pre-wrap', fontFamily: 'monospace', background: 'rgba(0,0,0,0.15)'
                    }}>
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center', fontFamily: 'inherit' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '6px 12px', fontSize: '0.78rem' }}
                          onClick={e => {
                            e.stopPropagation();
                            openDocumentPreview(r.documentId);
                          }}
                          disabled={!r.documentId || previewLoading}
                        >
                          {previewLoading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : 'View full document'}
                        </button>
                        {r.documentId && <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{r.documentId}</span>}
                      </div>
                      {r.content}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showDocumentPreview && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1100,
          background: 'rgba(0,0,0,0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}>
          <div style={{
            width: 'min(1100px, 100%)',
            maxHeight: '90vh',
            borderRadius: '18px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 32px 80px rgba(0,0,0,0.45)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '16px 18px',
              borderBottom: '1px solid var(--border-color)',
              }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {documentPreview
                    ? (documentPreview.document.sourcePath && documentPreview.document.sourcePath !== documentPreview.document.filename
                        ? `${documentPreview.document.filename} · ${documentPreview.document.sourcePath}`
                        : documentPreview.document.filename)
                    : previewLoading
                      ? 'Loading document...'
                      : 'Document preview unavailable'}
                </div>
                <div style={{ marginTop: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {documentPreview?.document.kind && <span>{documentPreview.document.kind}</span>}
                  {documentPreview && <span>{formatSize(documentPreview.document.size)}</span>}
                  {documentPreview && <span>{documentPreview.document._count.chunks} chunks</span>}
                  {documentPreview?.retrievalScope && <span>{documentPreview.retrievalScope === 'full-document' ? 'full document' : 'chunked'}</span>}
                  {documentPreview?.document.ragMode && <span>{documentPreview.document.ragMode}</span>}
                </div>
              </div>
              <button
                className="btn btn-secondary"
                style={{ padding: '8px 14px' }}
                onClick={() => {
                  setDocumentPreview(null);
                  setPreviewError(null);
                }}
              >
                Close
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', minHeight: 0, flex: 1 }}>
              <div style={{ padding: '18px', overflow: 'auto', borderRight: '1px solid var(--border-color)' }}>
                {previewError && (
                  <div style={{
                    marginBottom: '12px',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1px solid var(--danger)',
                    background: 'rgba(239,68,68,0.08)',
                    color: '#fca5a5',
                    fontSize: '0.84rem',
                  }}>
                    {previewError}
                  </div>
                )}
                <div style={{
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                  lineHeight: 1.7,
                  color: 'var(--text-primary)',
                  background: 'rgba(0,0,0,0.18)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '14px',
                  padding: '16px',
                }}>
                  {documentPreview
                    ? (documentPreview.content || 'No text was extracted from this document.')
                    : previewLoading
                      ? 'Loading...'
                      : 'Unable to preview this document.'}
                </div>
              </div>
              <div style={{ padding: '18px', overflow: 'auto' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                  Chunks
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {documentPreview?.chunks.length ? documentPreview.chunks.map(chunk => (
                    <div key={chunk.id} style={{
                      padding: '10px 12px',
                      borderRadius: '12px',
                      border: '1px solid var(--border-color)',
                      background: 'rgba(255,255,255,0.03)',
                    }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '6px', color: 'var(--accent-primary)' }}>
                        Chunk {chunk.chunkIndex + 1}
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.72rem', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                        {chunk.content}
                      </div>
                    </div>
                  )) : (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {previewLoading ? 'Loading chunks...' : 'No chunk data available.'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Info Banner if no ready docs but processing */}
      {!hasReadyDocuments && pendingDocs.length > 0 && (
        <div style={{ padding: '14px', borderRadius: '10px', background: 'var(--accent-faint)', border: '1px solid var(--accent-primary)', fontSize: '0.85rem', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <Loader2 size={16} color="var(--accent-primary)" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          Documents are being processed. The search section will appear when they are ready.
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
