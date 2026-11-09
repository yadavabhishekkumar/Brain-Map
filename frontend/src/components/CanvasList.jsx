import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import MicButton from './MicButton';
import { AI_MODELS, getAiModel, setAiModel } from '../aiModel';

const SYSTEM_TABS = { all: 'all', uncategorized: 'uncategorized', shared: 'shared' };

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function initials(user) {
  const n = ((user && (user.name || user.email)) || '?').trim();
  return n.slice(0, 2).toUpperCase();
}

export default function CanvasList({ user, onOpen, onOpenEpaper, onSignIn, onSignOut, onOpenStats, onProfileUpdated }) {
  const [canvases, setCanvases] = useState([]);
  const [categories, setCategories] = useState([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiModel, setAiModelState] = useState(getAiModel());
  const [activeTab, setActiveTab] = useState(SYSTEM_TABS.all);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [editMsg, setEditMsg] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [addingTab, setAddingTab] = useState(false);
  const [newTabName, setNewTabName] = useState('');
  const [renamingTab, setRenamingTab] = useState(null);

  const load = async () => {
    try {
      const cs = await api.listCanvases();
      let cats = [];
      if (user) {
        try {
          cats = await api.listCategories();
        } catch (e) {
          // categories are optional for older backends
        }
      }
      setCanvases(cs);
      setCategories(cats);
    } catch (e) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user ? user.id : null]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Set());
    setMoveOpen(false);
  };

  const create = async () => {
    if (!user) { onSignIn(); return; }
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const isCategory =
        activeTab !== SYSTEM_TABS.all &&
        activeTab !== SYSTEM_TABS.uncategorized &&
        activeTab !== SYSTEM_TABS.shared;
      const categoryId = isCategory ? activeTab : null;
      const c = await api.createCanvas(name.trim(), categoryId);
      setName('');
      await load();
      onOpen(c.id, c.name);
    } catch (e) {
      alert(e.message);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this canvas and all its content?')) return;
    try {
      await api.deleteCanvas(id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await load();
    } catch (e) {
      alert(e.message);
    }
  };

  const fork = async (id) => {
    if (!window.confirm('Fork this public canvas into your account?')) return;
    try {
      await api.forkCanvas(id);
      await load();
    } catch (e) {
      alert(e.message);
    }
  };

  const togglePublic = async (canvas) => {
    const next = !canvas.is_public;
    const msg = next
      ? 'Make this canvas public? Anyone can then view and fork it.'
      : 'Make this canvas private? It will no longer be visible to others.';
    if (!window.confirm(msg)) return;
    try {
      await api.setCanvasVisibility(canvas.id, next);
      await load();
    } catch (e) {
      alert(e.message);
    }
  };

  const addTab = async () => {
    if (!user) { onSignIn(); return; }
    const n = newTabName.trim();
    if (!n || creating) return;
    setAddingTab(false);
    setNewTabName('');
    try {
      const cat = await api.createCategory(n);
      await load();
      setActiveTab(cat.id);
    } catch (e) {
      alert(e.message);
    }
  };

  const commitRenameTab = async () => {
    const t = renamingTab;
    if (!t) return;
    const n = (t.name || '').trim();
    if (!n) { setRenamingTab(null); return; }
    try {
      await api.renameCategory(t.id, n);
      setRenamingTab(null);
      await load();
    } catch (e) {
      alert(e.message);
    }
  };

  const deleteTab = async (id) => {
    const cat = categories.find((c) => c.id === id);
    if (!window.confirm(`Delete tab "${cat ? cat.name : ''}"? Its canvases will move to "Uncategorized".`)) return;
    try {
      await api.deleteCategory(id);
      if (activeTab === id) setActiveTab(SYSTEM_TABS.uncategorized);
      await load();
    } catch (e) {
      alert(e.message);
    }
  };

  const moveTo = async (categoryId) => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      await api.moveCanvases(ids, categoryId);
      clearSelection();
      await load();
    } catch (e) {
      alert(e.message);
    }
  };

  const moveOne = (id) => {
    setSelected(new Set([id]));
    setMoveOpen(true);
  };

  const createAndMove = async () => {
    if (!user) { onSignIn(); return; }
    const n = newTabName.trim();
    if (!n) return;
    try {
      const cat = await api.createCategory(n);
      setNewTabName('');
      await moveTo(cat.id);
      setActiveTab(cat.id);
    } catch (e) {
      alert(e.message);
    }
  };

  const tabs = useMemo(() => {
    const list = [{ id: SYSTEM_TABS.all, label: 'All', system: true }];
    if (user) list.push({ id: SYSTEM_TABS.uncategorized, label: 'Uncategorized', system: true });
    for (const c of categories) {
      list.push({ id: c.id, label: c.name, system: false, count: c.canvas_count });
    }
    list.push({ id: SYSTEM_TABS.shared, label: 'Shared', system: true });
    return list;
  }, [categories, user]);

  const visibleCanvases = useMemo(() => {
    switch (activeTab) {
      case SYSTEM_TABS.all:
        return canvases;
      case SYSTEM_TABS.uncategorized:
        return canvases.filter((c) => user && c.owner_id === user.id && !c.category_id);
      case SYSTEM_TABS.shared:
        return canvases.filter((c) => c.is_public && (!user || c.owner_id !== user.id));
      default:
        return canvases.filter((c) => c.category_id === activeTab);
    }
  }, [canvases, activeTab, user]);

  const formatDate = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const categoryName = (id) => {
    const c = categories.find((x) => x.id === id);
    return c ? c.name : '';
  };

  const openEdit = () => {
    setEditName(user ? user.name || '' : '');
    setEditMsg('');
    setEditOpen(true);
  };

  const saveProfile = async () => {
    const n = editName.trim();
    if (!n) { setEditMsg('Name is required.'); return; }
    setSavingProfile(true);
    setEditMsg('');
    try {
      const r = await api.updateProfile(n);
      onProfileUpdated(r.user);
      setEditOpen(false);
    } catch (e) {
      setEditMsg(e.message);
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="home">
      <div className="home-aurora" aria-hidden="true">
        <span className="home-aurora-blob home-aurora-1" />
        <span className="home-aurora-blob home-aurora-2" />
        <span className="home-aurora-blob home-aurora-3" />
      </div>

      <div className="home-shell">
        <header className="home-topbar">
          <div className="home-brand">
            <div className="home-logo">🧠</div>
            <div className="home-brand-text">
              <div className="home-brand-name">UPSC Brain Map</div>
              <div className="home-brand-sub">Think · Map · Revise</div>
            </div>
          </div>
          <div className="home-topbar-right">
            {user && (
              <div className="home-ai-select">
                <label htmlFor="ai-model">AI</label>
                <select
                  id="ai-model"
                  value={aiModel}
                  onChange={(e) => {
                    setAiModel(e.target.value);
                    setAiModelState(e.target.value);
                  }}
                >
                  {AI_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
            )}
            {user ? (
              <div className="home-profile">
                <button className="home-chip" onClick={() => setMenuOpen((v) => !v)}>
                  <span className="home-avatar">{initials(user)}</span>
                  <span className="home-chip-name">{user.name || user.email}</span>
                  {user.is_superuser && <span className="home-super" title="Super user">👑</span>}
                  <span className="home-caret">▾</span>
                </button>
                {menuOpen && (
                  <div className="home-dropdown">
                    {user.is_superuser && (
                      <button className="home-dropdown-item" onClick={() => { setMenuOpen(false); onOpenStats(); }}>
                        📊 Statistics
                      </button>
                    )}
                    <button className="home-dropdown-item" onClick={() => { setMenuOpen(false); openEdit(); }}>
                      ✏️ Edit profile
                    </button>
                    <button className="home-dropdown-item home-dropdown-danger" onClick={() => { setMenuOpen(false); onSignOut(); }}>
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button className="home-btn home-btn-primary" onClick={onSignIn}>Sign in</button>
            )}
          </div>
        </header>
        <section className="home-hero">
          <div className="home-hero-copy">
            <h1>{user ? `${greeting()}, ${user.name || user.email}` : 'Your knowledge, mapped.'}</h1>
            <p>Build syllabus-anchored mind maps, attach notes, extract text with AI, and search everything instantly.</p>
          </div>
          <div className="home-create">
            <div className="home-create-input">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
                placeholder="Name a new canvas — Polity, History, Geography…"
              />
              <MicButton onText={(t) => setName((v) => (v ? v + ' ' + t : t))} />
            </div>
            <button className="home-btn home-btn-gradient" onClick={create} disabled={creating || !name.trim()}>
              {creating ? 'Creating…' : '＋ New canvas'}
            </button>
          </div>
        </section>

        <nav className="home-tabs">
          <div className="home-tabs-scroll">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              const renaming = renamingTab && renamingTab.id === tab.id;
              return (
                <div key={tab.id} className={`home-tab${active ? ' home-tab-active' : ''}`}>
                  {renaming ? (
                    <input
                      className="home-tab-input"
                      autoFocus
                      value={renamingTab.name}
                      onChange={(e) => setRenamingTab({ ...renamingTab, name: e.target.value })}
                      onBlur={commitRenameTab}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRenameTab();
                        if (e.key === 'Escape') setRenamingTab(null);
                      }}
                    />
                  ) : (
                    <button
                      className="home-tab-btn"
                      onClick={() => setActiveTab(tab.id)}
                      onDoubleClick={() => !tab.system && setRenamingTab({ id: tab.id, name: tab.label })}
                    >
                      {tab.label}
                      {tab.count !== undefined && <span className="home-tab-count">{tab.count}</span>}
                    </button>
                  )}
                  {!tab.system && !renaming && (
                    <button className="home-tab-close" title="Delete tab" onClick={() => deleteTab(tab.id)}>×</button>
                  )}
                </div>
              );
            })}
            {user &&
              (addingTab ? (
                <div className="home-tab home-tab-add">
                  <input
                    className="home-tab-input"
                    autoFocus
                    value={newTabName}
                    placeholder="Tab name"
                    onChange={(e) => setNewTabName(e.target.value)}
                    onBlur={addTab}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addTab();
                      if (e.key === 'Escape') { setAddingTab(false); setNewTabName(''); }
                    }}
                  />
                </div>
              ) : (
                <button className="home-tab-add" onClick={() => { setAddingTab(true); setNewTabName(''); }} title="New tab">＋</button>
              ))}
          </div>
          <div className="home-tabs-count">{visibleCanvases.length} {visibleCanvases.length === 1 ? 'canvas' : 'canvases'}</div>
        </nav>
        <section className="home-content">
          {loading ? (
            <div className="home-grid">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="home-skeleton" />
              ))}
            </div>
          ) : visibleCanvases.length === 0 ? (
            <div className="home-empty">
              <div className="home-empty-icon">🗂️</div>
              <h3>No canvases here</h3>
              <p>{user ? 'Create your first canvas above, or move existing canvases into this tab.' : 'Sign in to start building your own mind maps.'}</p>
            </div>
          ) : (
            <div className="home-grid">
              {visibleCanvases.map((c) => {
                const isSelected = selected.has(c.id);
                const isOwner = user && c.owner_id === user.id;
                const catId = c.category_id;
                return (
                  <article
                    key={c.id}
                    className={`home-card${isSelected ? ' home-card-selected' : ''}`}
                    onClick={() => onOpen(c.id, c.name)}
                  >
                    {user && (
                      <button
                        type="button"
                        className={`home-check${isSelected ? ' home-check-on' : ''}`}
                        aria-pressed={isSelected}
                        onClick={(e) => { e.stopPropagation(); toggleSelect(c.id); }}
                      >
                        {isSelected ? '✓' : ''}
                      </button>
                    )}
                    <div className="home-card-head">
                      <span className={`home-pill${c.is_public ? ' home-pill-public' : ' home-pill-private'}`}>
                        {c.is_public ? 'Public' : 'Private'}
                      </span>
                      <div className="home-card-actions">
                        {isOwner && (
                          <>
                            <button className="home-mini" title="Move to tab" onClick={(e) => { e.stopPropagation(); moveOne(c.id); }}>⇄</button>
                            <button className="home-mini" title={c.is_public ? 'Make private' : 'Make public'} onClick={(e) => { e.stopPropagation(); togglePublic(c); }}>
                              {c.is_public ? '🔒' : '🌐'}
                            </button>
                            <button className="home-mini home-mini-danger" title="Delete" onClick={(e) => { e.stopPropagation(); remove(c.id); }}>🗑</button>
                          </>
                        )}
                        {c.is_public && user && (!c.owner_id || c.owner_id !== user.id) && (
                          <button className="home-mini" title="Fork into my account" onClick={(e) => { e.stopPropagation(); fork(c.id); }}>🍴</button>
                        )}
                      </div>
                    </div>
                    <h3 className="home-card-title">{c.name}</h3>
                    <p className="home-card-desc">{c.description || 'No description yet'}</p>
                    <div className="home-card-foot">
                      <span className="home-card-meta">
                        {c.node_count} topic{c.node_count === 1 ? '' : 's'}
                        {c.attachment_count ? ` · ${c.attachment_count} 📎` : ''}
                      </span>
                      <span className="home-card-date">{formatDate(c.updated_at)}</span>
                    </div>
                    {catId && (
                      <span
                        className="home-card-tag"
                        onClick={(e) => { e.stopPropagation(); setActiveTab(catId); }}
                      >
                        📁 {categoryName(catId)}
                      </span>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
        {user && (
          <section className="home-extra">
            <button className="home-epaper" onClick={onOpenEpaper}>
              <span className="home-epaper-emoji">📰</span>
              <span className="home-epaper-text">
                <strong>The Hindu E-Paper</strong>
                <small>Download daily e-paper PDFs by date</small>
              </span>
              <span className="home-epaper-cta">Open downloader →</span>
            </button>
          </section>
        )}
      </div>

      {selected.size > 0 && (
        <div className="home-selection">
          <div className="home-selection-inner">
            <span className="home-selection-count">{selected.size} selected</span>
            <button className="home-btn home-btn-ghost" onClick={() => setMoveOpen((v) => !v)}>Move to tab</button>
            <button className="home-btn home-btn-ghost" onClick={clearSelection}>Clear</button>
          </div>
        </div>
      )}

      {moveOpen && (
        <div className="home-modal-overlay" onClick={() => setMoveOpen(false)}>
          <div className="home-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Move {selected.size} canvas{selected.size === 1 ? '' : 'es'} to…</h3>
            <button className="home-modal-row" onClick={() => moveTo(null)}>
              <span>📂</span> Uncategorized
            </button>
            {categories.map((cat) => (
              <button key={cat.id} className="home-modal-row" onClick={() => moveTo(cat.id)}>
                <span>📁</span> {cat.name}
              </button>
            ))}
            <div className="home-modal-divider" />
            <div className="home-modal-new">
              <input
                autoFocus
                value={newTabName}
                placeholder="New tab name…"
                onChange={(e) => setNewTabName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createAndMove()}
              />
              <button className="home-btn home-btn-primary" onClick={createAndMove}>Create & move</button>
            </div>
          </div>
        </div>
      )}

      {editOpen && (
        <div className="home-modal-overlay" onClick={() => setEditOpen(false)}>
          <div className="home-modal" onClick={(e) => e.stopPropagation()}>
            <h3>✏️ Edit profile</h3>
            <label className="home-label">Display name</label>
            <input className="home-input" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
            <div className="home-modal-actions">
              <button className="home-btn home-btn-ghost" onClick={() => setEditOpen(false)}>Cancel</button>
              <button className="home-btn home-btn-primary" onClick={saveProfile} disabled={savingProfile}>
                {savingProfile ? 'Saving…' : 'Save'}
              </button>
            </div>
            {editMsg && <div className="home-error">{editMsg}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
