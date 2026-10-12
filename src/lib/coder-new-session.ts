export function siblingWorkspacePath(current: string, directoryName: string): string | null {
  const workspace = current.replace(/\/+$/, '') || '/';
  const name = directoryName.trim();
  if (!workspace.startsWith('/') || workspace.split('/').includes('..') || workspace.split('/').includes('.')
    || /[\\%\x00-\x1f\x7f]/.test(workspace)
    || !name || name === '.' || name === '..' || /[\\/%\x00-\x1f\x7f]/.test(name)) return null;
  const parent = workspace === '/' ? '/' : workspace.slice(0, workspace.lastIndexOf('/')) || '/';
  return `${parent === '/' ? '' : parent}/${name}`;
}
