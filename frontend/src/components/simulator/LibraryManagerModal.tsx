import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  searchLibraries,
  installLibrary,
  getInstalledLibraries,
  getLibraryCatalog,
  getCustomLibraries,
  deleteCustomLibrary,
} from '../../services/libraryService';
import type { ArduinoLibrary, InstalledLibrary } from '../../services/libraryService';
import { trackInstallLibrary } from '../../utils/analytics';
import { useSimulatorStore } from '../../store/useSimulatorStore';
import { boardDisplayName } from '../../types/board';
import {
  recommendLibrariesFromCircuit,
  componentTypeLabel,
} from '../../utils/componentLibraryHints';
import { normalizeLibName } from '../../utils/libraryManifest';
import './LibraryManagerModal.css';

interface LibraryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Case/separator-insensitive name match, matching the backend's _norm_lib_name
 *  so the UI's "in project" state agrees with what the compiler scopes. */
const normLib = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** One row of the single unified list. A search result and an installed/custom
 *  library both normalise to this so they render identically. */
interface LibRow {
  name: string;
  version: string;
  author: string;
  desc: string;
  installed: boolean;
  custom: boolean;
  releases?: Record<string, unknown>;
  /** Suggested from parts currently on the canvas */
  recommended?: boolean;
  /** Short labels of the parts that asked for this lib */
  recommendFrom?: string;
}

/** Fixed row slot so the full index (~10k) can scroll without mounting every node. */
const LIB_ROW_HEIGHT = 96;

/**
 * Library Manager — ONE list, no tabs. Each row is state-aware:
 *   + Add to project   (installs if needed, then declares it on this board)
 *   In project ✓       (click to remove from this board's libraries.json)
 *   Uninstall / Remove (free the cache / remove your custom upload)
 *
 * The per-board manifest (board.libraries) IS the compile scope and is what the
 * read-only `libraries.json` file in the explorer shows. This modal is the only
 * place that edits it.
 */
export const LibraryManagerModal: React.FC<LibraryManagerModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();

  // Per-board manifest: the libraries.json edited here belongs to the ACTIVE
  // board, so two boards in one project can scope to different libraries.
  const boards = useSimulatorStore((s) => s.boards);
  const activeBoardId = useSimulatorStore((s) => s.activeBoardId);
  const updateBoard = useSimulatorStore((s) => s.updateBoard);
  const components = useSimulatorStore((s) => s.components);
  const activeBoard = boards.find((b) => b.id === activeBoardId) ?? boards[0];
  const manifestLibs = activeBoard?.libraries ?? null;
  const declared = manifestLibs ?? [];

  const circuitHints = useMemo(
    () =>
      recommendLibrariesFromCircuit(
        components.map((c) => ({ metadataId: c.metadataId, type: (c as { type?: string }).type })),
        activeBoard?.boardKind,
      ),
    [components, activeBoard?.boardKind],
  );
  const hintByNorm = useMemo(() => {
    const map = new Map<string, { fromTypes: string[] }>();
    for (const h of circuitHints) map.set(normalizeLibName(h.name), h);
    return map;
  }, [circuitHints]);

  const [searchQuery, setSearchQuery] = useState('');
  const [onlyRecommended, setOnlyRecommended] = useState(false);
  const [searchResults, setSearchResults] = useState<ArduinoLibrary[]>([]);
  const [catalog, setCatalog] = useState<ArduinoLibrary[] | null>(null);
  // 'pending' until the first catalog attempt finishes — avoids flashing
  // "none installed" while the ~10k-row index is still downloading.
  const [catalogStatus, setCatalogStatus] = useState<'pending' | 'ready' | 'error'>('pending');
  const [installedLibraries, setInstalledLibraries] = useState<InstalledLibrary[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [listHeight, setListHeight] = useState(480);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [busyLib, setBusyLib] = useState<string | null>(null); // install/uninstall in flight
  const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>({});
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setLibraries = useCallback(
    (libs: string[] | null) => {
      if (!activeBoard) return;
      updateBoard(activeBoard.id, { libraries: libs && libs.length ? libs : undefined });
    },
    [activeBoard, updateBoard],
  );

  const inManifest = useCallback(
    (name: string): boolean => declared.some((l) => normLib(l) === normLib(name)),
    [declared],
  );
  const addToManifest = useCallback(
    (name: string) => {
      const clean = name.trim();
      if (!clean) return;
      const cur = manifestLibs ?? [];
      if (cur.some((l) => normLib(l) === normLib(clean))) return;
      setLibraries([...cur, clean]);
    },
    [manifestLibs, setLibraries],
  );
  const removeFromManifest = useCallback(
    (name: string) => {
      const cur = manifestLibs ?? [];
      const next = cur.filter((l) => normLib(l) !== normLib(name));
      setLibraries(next.length ? next : null);
    },
    [manifestLibs, setLibraries],
  );

  const isInstalled = useCallback(
    (name: string): boolean =>
      installedLibraries.some((il) => normLib(il.library?.name || il.name || '') === normLib(name)),
    [installedLibraries],
  );

  const fetchInstalled = useCallback(async () => {
    try {
      // The shared index libs PLUS the user's per-user custom uploads (which
      // live in their per-user store). Custom first; de-duped by name.
      const [libs, custom] = await Promise.all([getInstalledLibraries(), getCustomLibraries()]);
      const customNames = new Set(custom.map((c) => (c.name || '').toLowerCase()));
      setInstalledLibraries([
        ...custom,
        ...libs.filter((l) => !customNames.has((l.library?.name || l.name || '').toLowerCase())),
      ]);
    } catch (e: unknown) {
      setStatusMsg({
        type: 'error',
        text: e instanceof Error ? e.message : 'Failed to load installed libraries',
      });
    }
  }, []);

  // Reset transient state when the modal closes.
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setSearchResults([]);
      setOnlyRecommended(false);
      setStatusMsg(null);
    }
  }, [isOpen]);

  // When the circuit yields new hints, default to showing them first (not
  // filtered-only — user can still browse the full index).
  useEffect(() => {
    if (isOpen && circuitHints.length) {
      console.info('[library-manager] circuit filter ready', {
        hints: circuitHints.length,
        parts: components.map((c) => c.metadataId),
      });
    }
  }, [isOpen, circuitHints, components]);

  // Load the installed/custom list and the full index whenever the modal opens.
  // The index is the default list; the search box filters it locally.
  useEffect(() => {
    if (!isOpen) return;
    fetchInstalled();
    let cancelled = false;
    if (catalog) {
      setCatalogStatus('ready');
      return;
    }
    setCatalogStatus('pending');
    getLibraryCatalog()
      .then((libs) => {
        // Always commit — Strict Mode may cancel the first effect while the
        // shared inflight promise is still the source of truth for reopen.
        setCatalog(libs);
        setCatalogStatus('ready');
        if (!cancelled) {
          console.info('[library-manager] showing catalog', { count: libs.length });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setCatalog(null);
        setCatalogStatus('error');
        setStatusMsg({
          type: 'error',
          text: e instanceof Error ? e.message : 'Failed to load library catalog',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, fetchInstalled, catalog]);

  // Escape closes it, like any dialog. The overlay already closes on a
  // backdrop click, but the toolbar button that OPENED this sits underneath
  // the overlay — so someone who installs a library and reaches for it to get
  // back to their sketch clicks a button that cannot be hit, and the editor
  // reads as frozen. Escape is the exit everyone tries next.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Remote search is only the fallback when the local index failed to load.
  // With a catalog, the search box filters that list in the browser.
  useEffect(() => {
    if (!isOpen) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (catalog || !searchQuery.trim()) {
      setSearchResults([]);
      setLoadingSearch(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoadingSearch(true);
      setStatusMsg(null);
      try {
        setSearchResults(await searchLibraries(searchQuery));
      } catch (e: unknown) {
        setStatusMsg({ type: 'error', text: e instanceof Error ? e.message : 'Search failed' });
        setSearchResults([]);
      } finally {
        setLoadingSearch(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, isOpen, catalog]);

  // A custom .zip upload (pro) lands in the user's per-user store; auto-declare
  // it on the active board and refresh the list. The upload BUTTON is injected
  // into .lib-modal-header by the pro overlay (libraryUploadInjector).
  useEffect(() => {
    const onUploaded = (e: Event) => {
      const name = (e as CustomEvent).detail?.library;
      if (name) addToManifest(name);
      fetchInstalled();
    };
    window.addEventListener('velxio-custom-library-installed', onUploaded);
    return () => window.removeEventListener('velxio-custom-library-installed', onUploaded);
  }, [addToManifest, fetchInstalled]);

  // ── actions ────────────────────────────────────────────────────────────────
  const install = useCallback(
    async (name: string): Promise<boolean> => {
      setBusyLib(name);
      setStatusMsg(null);
      try {
        const result = await installLibrary(name, selectedVersions[name]);
        if (result.success) {
          trackInstallLibrary(name);
          fetchInstalled();
          return true;
        }
        setStatusMsg({ type: 'error', text: result.error || `Failed to install "${name}"` });
        return false;
      } catch (e: unknown) {
        setStatusMsg({ type: 'error', text: e instanceof Error ? e.message : 'Installation failed' });
        return false;
      } finally {
        setBusyLib(null);
      }
    },
    [selectedVersions, fetchInstalled],
  );

  // Primary action: install if needed, then declare on THIS board.
  const addToProject = useCallback(
    async (row: LibRow) => {
      if (!row.installed) {
        const ok = await install(row.name);
        if (!ok) return;
      }
      addToManifest(row.name);
      setStatusMsg({ type: 'success', text: `"${row.name}" added to ${activeBoard ? boardDisplayName(activeBoard) : 'this board'}.` });
    },
    [install, addToManifest, activeBoard],
  );

  // A CUSTOM lib lives in the user's per-user store, so removing it hits the
  // per-user delete endpoint and also drops it from the manifest.
  const removeCustom = useCallback(
    async (name: string) => {
      setBusyLib(name);
      setStatusMsg(null);
      try {
        const result = await deleteCustomLibrary(name);
        if (result.success) {
          setStatusMsg({ type: 'success', text: `Removed your custom "${name}".` });
          removeFromManifest(name);
          fetchInstalled();
        } else {
          setStatusMsg({ type: 'error', text: result.error || `Failed to remove "${name}"` });
        }
      } finally {
        setBusyLib(null);
      }
    },
    [removeFromManifest, fetchInstalled],
  );

  const annotateHint = useCallback(
    (row: LibRow): LibRow => {
      const hint = hintByNorm.get(normLib(row.name));
      if (!hint) return row;
      return {
        ...row,
        recommended: true,
        recommendFrom: hint.fromTypes.map(componentTypeLabel).join(', '),
      };
    },
    [hintByNorm],
  );

  const toRow = useCallback(
    (lib: ArduinoLibrary, custom = false): LibRow =>
      annotateHint({
        name: lib.name || 'Unknown',
        version: lib.latest?.version || lib.version || '',
        author: lib.latest?.author || lib.author || '',
        desc: lib.latest?.sentence || lib.sentence || '',
        installed: custom || isInstalled(lib.name || ''),
        custom,
        releases: lib.releases,
      }),
    [isInstalled, annotateHint],
  );

  // Full index by default. Circuit-based recommendations float to the top.
  // The search box filters name / author / sentence; "仅看推荐" narrows further.
  const rows: LibRow[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matches = (name: string, author: string, desc: string, category?: string) => {
      if (!q) return true;
      return `${name} ${author} ${desc} ${category || ''}`.toLowerCase().includes(q);
    };

    const sortRecommendedFirst = (list: LibRow[]) => {
      const rec: LibRow[] = [];
      const rest: LibRow[] = [];
      for (const row of list) (row.recommended ? rec : rest).push(row);
      return [...rec, ...rest];
    };

    const applyRecommendFilter = (list: LibRow[]) =>
      onlyRecommended ? list.filter((r) => r.recommended) : list;

    if (catalog) {
      const seen = new Set<string>();
      const fromIndex = catalog
        .filter((lib) =>
          matches(lib.name || '', lib.author || '', lib.sentence || '', lib.category),
        )
        .map((lib) => {
          const row = toRow(lib);
          seen.add(normLib(row.name));
          return row;
        });
      const extras = installedLibraries
        .filter((lib) => {
          const name = lib.library?.name || lib.name || '';
          return (
            name &&
            !seen.has(normLib(name)) &&
            matches(
              name,
              lib.library?.author || lib.author || '',
              lib.library?.sentence || lib.sentence || '',
            )
          );
        })
        .map((lib) =>
          annotateHint({
            name: lib.library?.name || lib.name || 'Unknown',
            version: lib.library?.version || lib.version || '',
            author: lib.library?.author || lib.author || '',
            desc: lib.library?.sentence || lib.sentence || '',
            installed: true,
            custom: !!lib.custom,
          }),
        );

      // Hints whose exact name is missing from the local index still appear
      // so the user can try + Add (install will resolve via arduino-cli).
      for (const hint of circuitHints) {
        const n = normLib(hint.name);
        if (seen.has(n)) continue;
        if (!matches(hint.name, '', '', '')) continue;
        extras.push(
          annotateHint({
            name: hint.name,
            version: '',
            author: '',
            desc: '',
            installed: isInstalled(hint.name),
            custom: false,
          }),
        );
        seen.add(n);
      }

      return applyRecommendFilter(sortRecommendedFirst([...extras, ...fromIndex]));
    }

    if (q) {
      return applyRecommendFilter(sortRecommendedFirst(searchResults.map((lib) => toRow(lib))));
    }
    return applyRecommendFilter(
      sortRecommendedFirst(
        installedLibraries.map((lib) =>
          annotateHint({
            name: lib.library?.name || lib.name || 'Unknown',
            version: lib.library?.version || lib.version || '',
            author: lib.library?.author || lib.author || '',
            desc: lib.library?.sentence || lib.sentence || '',
            installed: true,
            custom: !!lib.custom,
          }),
        ),
      ),
    );
  }, [
    searchQuery,
    searchResults,
    installedLibraries,
    catalog,
    toRow,
    annotateHint,
    onlyRecommended,
    circuitHints,
    isInstalled,
  ]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [searchQuery, onlyRecommended]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !isOpen) return;
    const measure = () => setListHeight(el.clientHeight || 480);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isOpen, catalogStatus]);

  if (!isOpen) return null;
  const catalogLoading = catalogStatus === 'pending' && !catalog;
  const rowStart = Math.max(0, Math.floor(scrollTop / LIB_ROW_HEIGHT) - 4);
  const rowEnd = Math.min(rows.length, rowStart + Math.ceil(listHeight / LIB_ROW_HEIGHT) + 8);
  const visibleRows = rows.slice(rowStart, rowEnd);

  // Portaled to <body>: the toolbar ancestor has container-type
  // (container queries), which turns it into the containing block for
  // position:fixed and shrank the overlay to the toolbar's box.
  return createPortal(
    <div className="lib-modal-overlay" onClick={onClose}>
      <div className="lib-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header — the pro custom-upload button injects into .lib-modal-header */}
        <div className="lib-modal-header">
          <div className="lib-modal-title">
            <svg
              className="lib-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
              <path d="m3.3 7 8.7 5 8.7-5" />
              <path d="M12 22V12" />
            </svg>
            <span>{t('editor.libraryManager.title')}</span>
            {activeBoard && (
              <span
                title="Libraries apply to this board (its libraries.json = compile scope)"
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  color: '#a5d6a7',
                  background: '#1b3a1e',
                  border: '1px solid #2e7d32',
                  borderRadius: 10,
                  padding: '1px 8px',
                }}
              >
                {boardDisplayName(activeBoard)} · {declared.length}
              </span>
            )}
          </div>
          <button className="lib-close-btn" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="lib-search-bar">
          <svg
            className="lib-search-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder={t('editor.libraryManager.filterPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          {loadingSearch || catalogLoading ? (
            <svg className="lib-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            catalog && <span className="lib-catalog-count">{rows.length}</span>
          )}
        </div>

        {circuitHints.length > 0 && (
          <div className="lib-recommend-bar">
            <button
              type="button"
              className={`lib-recommend-toggle${onlyRecommended ? ' active' : ''}`}
              onClick={() => setOnlyRecommended((v) => !v)}
              title={t('editor.libraryManager.recommendToggleTitle')}
            >
              {t('editor.libraryManager.recommendToggle', { count: circuitHints.length })}
            </button>
            <span className="lib-recommend-hint">
              {t('editor.libraryManager.recommendHint', {
                parts: [...new Set(circuitHints.flatMap((h) => h.fromTypes.map(componentTypeLabel)))].join(
                  ', ',
                ),
              })}
            </span>
          </div>
        )}

        {/* Status */}
        {statusMsg && <div className={`lib-status ${statusMsg.type}`}>{statusMsg.text}</div>}

        {/* Single unified list */}
        <div className="lib-content">
          <div
            className="lib-list"
            ref={listRef}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          >
            {catalogLoading ? (
              <div className="lib-empty">
                <p>{t('editor.libraryManager.loadingLibraries')}</p>
              </div>
            ) : !loadingSearch && rows.length === 0 ? (
              <div className="lib-empty">
                <p>
                  {searchQuery
                    ? t('editor.libraryManager.noResultsFor', { query: searchQuery })
                    : catalog
                      ? t('editor.libraryManager.noResults')
                      : t('editor.libraryManager.noneInstalled')}
                </p>
              </div>
            ) : (
            <div className="lib-list-spacer" style={{ height: rows.length * LIB_ROW_HEIGHT }}>
            <div className="lib-list-window" style={{ top: rowStart * LIB_ROW_HEIGHT }}>
            {visibleRows.map((row) => {
              const inProj = inManifest(row.name);
              const busy = busyLib === row.name;
              return (
                <div key={row.name} className="lib-item">
                  <div className="lib-item-info">
                    <div className="lib-item-header">
                      <span className="lib-item-name">{row.name}</span>
                      {row.recommended && (
                        <span
                          className="lib-recommend-badge"
                          title={
                            row.recommendFrom
                              ? t('editor.libraryManager.recommendBadgeTitle', {
                                  parts: row.recommendFrom,
                                })
                              : undefined
                          }
                        >
                          {t('editor.libraryManager.recommendBadge')}
                          {row.recommendFrom ? ` · ${row.recommendFrom}` : ''}
                        </span>
                      )}
                      {row.custom && (
                        <span
                          style={{
                            fontSize: 10,
                            color: '#ffd60a',
                            background: '#3a330f',
                            borderRadius: 6,
                            padding: '0 6px',
                          }}
                        >
                          custom
                        </span>
                      )}
                      {row.author && (
                        <span className="lib-item-author">
                          {t('editor.libraryManager.byAuthor', { author: row.custom ? 'you' : row.author })}
                        </span>
                      )}
                    </div>
                    {row.desc && <p className="lib-item-desc">{row.desc}</p>}
                  </div>
                  <div className="lib-item-actions">
                    {row.version && <span className="lib-item-version">{row.version}</span>}
                    {!row.installed && row.releases && Object.keys(row.releases).length > 1 && (
                      <select
                        className="lib-version-select"
                        value={selectedVersions[row.name] ?? row.version}
                        onChange={(e) => setSelectedVersions((p) => ({ ...p, [row.name]: e.target.value }))}
                      >
                        {Object.keys(row.releases).map((ver) => (
                          <option key={ver} value={ver}>
                            {ver}
                          </option>
                        ))}
                      </select>
                    )}
                    {inProj ? (
                      <button
                        className="lib-uninstall-btn"
                        style={{ color: '#a5d6a7', borderColor: '#2e7d32' }}
                        onClick={() => removeFromManifest(row.name)}
                        title="Remove from this board (libraries.json)"
                      >
                        In project ✓
                      </button>
                    ) : (
                      <button
                        className="lib-install-btn"
                        onClick={() => addToProject(row)}
                        disabled={busy}
                        title="Install if needed and add to this board"
                      >
                        {busy ? '…' : '+ Add to project'}
                      </button>
                    )}
                    {/* Only CUSTOM uploads can be removed (per-user store). Index
                        libraries live in the shared content-addressed cache — you
                        add/remove them from THIS project, but never "uninstall" a
                        copy everyone shares, so no Uninstall button for them. */}
                    {row.custom && (
                      <button
                        className="lib-uninstall-btn"
                        onClick={() => removeCustom(row.name)}
                        disabled={busy}
                        title="Remove your custom upload"
                      >
                        {busy ? '…' : 'Remove'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            </div>
            </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
