/**
 * Minimal re-export surface for externally-installed DevTool plugins.
 *
 * This is a TRIMMED copy of the app's `src/design-system/index.ts` — only
 * the symbols the three plugins in this repo (redis-client, rabbit-client,
 * container-manager) actually import from `@/design-system`. Add an export
 * here (and vendor the underlying `shared/components/ui/*.tsx` file, see
 * `shared/README.md`) if a future plugin needs another primitive — don't
 * blanket-copy the app's full index, since that pulls in the entire shadcn
 * kit whether a plugin uses it or not.
 */
export {
  JsonEditor, TextEditor, type CodeEditorProps,
} from '@/components/ui/code-editor';
export { CodeViewer, type CodeViewerProps, type CodeViewerHandle } from '@/components/ui/code-viewer';
export { cn } from '@/lib/utils';
