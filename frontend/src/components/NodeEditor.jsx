import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fileUrl } from '../api';
import { renderMarkdown } from '../markdown';
import MicButton from './MicButton';
import AiModelBadge from './AiModelBadge';
import { getAiModel } from '../aiModel';

const DEFAULT_REARRANGE_PROMPT =
  'Break all child Nodes into individual Nodes, and then based on Title of each of those individual Nodes and description, Connect them based on their relationship. If they are independent, then should exist parallel to each other. If they are somehow connected then connect them sequentially.';

export default function NodeEditor({ nodeId, nodes, onChanged, onClose, onOpenCanvas, editMode, onDeleteNode, width, onResize, tempNode }) {
  const [node, setNode] = useState(null);
  const [label, setLabel] = useState('');
  const [content, setContent] = useState('');
  const [parentId, setParentId] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(true);
  const nodesRef = useRef(nodes);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extractingId, setExtractingId] = useState(null);
  const [extractedText, setExtractedText] = useState('');
  const [activeAttachmentId, setActiveAttachmentId] = useState(null);
  const [applying, setApplying] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState(false);
  const [applyingAnswer, setApplyingAnswer] = useState(false);
  const [chats, setChats] = useState([]);
  const [showChats, setShowChats] = useState(false);
  const [pendingApply, setPendingApply] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [rearrangePrompt, setRearrangePrompt] = useState(DEFAULT_REARRANGE_PROMPT);
  const [rearrangeMode, setRearrangeMode] = useState('keep');
  const [rearranging, setRearranging] = useState(false);
  const resizeRef = useRef({ active: false, startX: 0, startWidth: width });

  const startResize = (e) => {
    e.preventDefault();
    resizeRef.current = { active: true, startX: e.clientX, startWidth: width };
    document.body.classList.add('resizing');
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!resizeRef.current.active) return;
      const dx = e.clientX - resizeRef.current.startX;
      onResize(Math.min(820, Math.max(260, resizeRef.current.startWidth - dx)));
    };
    const onUp = () => {
      resizeRef.current.active = false;
      document.body.classList.remove('resizing');
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing');
    };
  }, [onResize]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const load = useCallback(async () => {
    // Newly created nodes (edit mode) have temp ids and aren't in the DB yet.
    if (tempNode) {
      const d = tempNode.data || {};
      setNode({
        id: tempNode.id,
        label: d.label || '',
        content: d.content || '',
        parent_id: d.parent_id || null,
        depth: d.depth || 0,
        linked_canvas_id: d.linked_canvas_id || null,
        linked_canvas_name: d.linked_canvas_name || '',
        attachment_count: d.attachmentCount || 0,
      });
      setLabel(d.label || '');
      setContent(d.content || '');
      setParentId(d.parent_id || '');
      setAttachments([]);
      setAttachmentsLoading(false);
      return;
    }
    // Seed instantly from the already-loaded canvas data so the panel paints
    // immediately (no network round trip) while attachments load in the background.
    const cached = nodesRef.current.find((n) => n.id === nodeId);
    if (cached) {
      const d = cached.data || {};
      setNode({
        id: cached.id,
        label: d.label || '',
        content: d.content || '',
        parent_id: d.parent_id || null,
        depth: d.depth || 0,
        linked_canvas_id: d.linked_canvas_id || null,
        linked_canvas_name: d.linked_canvas_name || '',
        attachment_count: d.attachmentCount || 0,
      });
      setLabel(d.label || '');
      setContent(d.content || '');
      setParentId(d.parent_id || '');
    }
    setAttachmentsLoading(true);
    try {
      const n = await api.getNode(nodeId);
      setNode(n);
      setLabel(n.label);
      setContent(n.content || '');
      setParentId(n.parent_id || '');
      setAttachments(n.attachments || []);
    } catch (e) {
      alert(e.message);
    } finally {
      setAttachmentsLoading(false);
    }
  }, [nodeId, tempNode]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (editMode) return;
    setSaving(true);
    try {
      const payload = { label, content, parent_id: parentId || null };
      await api.updateNode(nodeId, payload);
      await onChanged();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!window.confirm('Delete this node and its entire subtree?')) return;
    onDeleteNode(nodeId);
    onClose();
  };

  const exportNode = async () => {
    if (tempNode) {
      alert('This node is new — save the canvas first to export it.');
      return;
    }
    if (
      !window.confirm(
        'Export this topic and its children to a new linked canvas? The children will move to the new canvas.'
      )
    )
      return;
    setExporting(true);
    try {
      await api.exportNode(nodeId);
      await load();
      await onChanged();
    } catch (err) {
      alert(err.message);
    } finally {
      setExporting(false);
    }
  };

  const onUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (tempNode) {
      alert('This node is new — save the canvas first to attach notes to it.');
      return;
    }
    setUploading(true);
    try {
      await api.uploadAttachment(nodeId, file);
      await load();
      await onChanged();
    } catch (err) {
      alert(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const extract = async (attId, mode = 'auto') => {
    setExtractingId(attId);
    try {
      const r = await api.extractAttachment(attId, mode);
      setExtractedText(r.extracted_text);
      setActiveAttachmentId(attId);
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setExtractingId(null);
    }
  };

  const apply = async (action) => {
    if (editMode) return;
    setApplying(true);
    try {
      await api.applyAttachment(activeAttachmentId, action, extractedText);
      setActiveAttachmentId(null);
      setExtractedText('');
      await load();
      await onChanged();
    } catch (err) {
      alert(err.message);
    } finally {
      setApplying(false);
    }
  };

  const removeAttachment = async (attId) => {
    if (!window.confirm('Delete this attachment?')) return;
    try {
      await api.deleteAttachment(attId);
      if (activeAttachmentId === attId) {
        setActiveAttachmentId(null);
        setExtractedText('');
      }
      await load();
      await onChanged();
    } catch (err) {
      alert(err.message);
    }
  };

  const ask = async () => {
    if (tempNode) {
      alert('This node is new — save the canvas first to ask AI about it.');
      return;
    }
    if (!question.trim() || asking) return;
    setAsking(true);
    setAnswer('');
    try {
      const r = await api.askAI(nodeId, question.trim(), getAiModel());
      setAnswer(r.answer);
    } catch (err) {
      alert(err.message);
    } finally {
      setAsking(false);
    }
  };

  const loadChats = useCallback(async () => {
    try {
      setChats(await api.listChats(nodeId));
    } catch (e) {
      // ignore — chat history is optional
    }
  }, [nodeId]);

  const doApply = async (action, mode) => {
    if (editMode || !answer.trim() || applyingAnswer) return;
    setApplyingAnswer(true);
    try {
      await api.applyAIAnswer(nodeId, answer.trim(), action, mode, getAiModel());
      setPendingApply(null);
      await load();
      await onChanged();
      if (showChats) await loadChats();
    } catch (err) {
      alert(err.message);
    } finally {
      setApplyingAnswer(false);
    }
  };

  // 'notes' asks for append/override first; child & map apply directly.
  const applyAnswer = (action) => {
    if (editMode) return;
    if (action === 'notes') {
      setPendingApply('notes');
      return;
    }
    doApply(action, 'append');
  };

  const confirmOverride = () => {
    const ok = window.confirm(
      'Override will replace the existing notes in this topic and you will lose the current information. Continue?'
    );
    if (ok) doApply('notes', 'override');
    else setPendingApply(null);
  };

  const rearrangeChildren = async () => {
    if (editMode || !rearrangePrompt.trim() || rearranging) return;
    setRearranging(true);
    try {
      await api.rearrangeNode(nodeId, rearrangePrompt.trim(), rearrangeMode, getAiModel());
      await load();
      await onChanged();
    } catch (err) {
      alert(err.message);
    } finally {
      setRearranging(false);
    }
  };

  const openChat = (chat) => {
    setQuestion(chat.question);
    setAnswer(chat.answer);
    setShowChats(false);
  };

  const toggleChats = async () => {
    if (showChats) {
      setShowChats(false);
    } else {
      await loadChats();
      setShowChats(true);
    }
  };

  if (!node) {
    return (
      <aside className="node-editor">
        <div className="muted">Loading…</div>
      </aside>
    );
  }

  return (
    <aside className="node-editor" style={{ width }}>
      <div className="resize-handle" onMouseDown={startResize} title="Drag to resize" />
      <div className="panel-header">
        <h3>Topic</h3>
        <button className="btn btn-ghost" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="panel-body">
        <label>Title</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} />

        <label>Notes / content</label>
        <div className="voice-field">
          <textarea rows={5} value={content} onChange={(e) => setContent(e.target.value)} />
          <MicButton onText={(t) => setContent((v) => (v ? v + ' ' + t : t))} />
        </div>

        {node.linked_canvas_id && (
          <div className="linked-canvas-box">
            <span>📁 Linked canvas: {node.linked_canvas_name || node.label}</span>
            <button
              className="btn btn-sm"
              onClick={() => onOpenCanvas(node.linked_canvas_id, node.linked_canvas_name || node.label)}
            >
              Open ↗
            </button>
          </div>
        )}

        <label>Parent topic</label>
        <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">— root —</option>
          {nodes
            .filter((n) => n.id !== nodeId)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.data ? n.data.label : n.id}
              </option>
            ))}
        </select>

        <div className="panel-actions">
          <button className="btn btn-primary" onClick={save} disabled={saving || editMode}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn" onClick={exportNode} disabled={exporting || !!tempNode}>
            {exporting ? 'Exporting…' : '📤 Export to new canvas'}
          </button>
          {editMode && (
            <button className="btn btn-danger" onClick={remove}>
              Delete
            </button>
          )}
        </div>

        <h4>📎 Notes &amp; screenshots</h4>
        <label className="upload-btn">
          <input type="file" accept="image/*" hidden onChange={onUpload} />
          {uploading ? 'Uploading…' : '＋ Attach screenshot'}
        </label>

        <div className="attachments">
          {attachmentsLoading && <div className="muted">Loading attachments…</div>}
          {!attachmentsLoading && attachments.length === 0 && <div className="muted">No attachments yet.</div>}
          {attachments.map((a) => (
            <div key={a.id} className="attachment">
              <img
                src={fileUrl(a.id)}
                alt={a.original_filename}
                className="attachment-thumb"
                onClick={() => window.open(fileUrl(a.id), '_blank')}
              />
              <div className="attachment-meta">
                <div className="attachment-name" title={a.original_filename}>
                  {a.original_filename}
                </div>
                <div className="attachment-status">{a.status}</div>
                <div className="attachment-actions">
                  <button
                    className="btn btn-sm"
                    disabled={extractingId === a.id}
                    onClick={() => extract(a.id, 'auto')}
                  >
                    {extractingId === a.id ? 'Extracting…' : '✨ Extract text'}
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => removeAttachment(a.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {activeAttachmentId && (
          <div className="extract-result">
            <h4>Extracted text</h4>
            <textarea
              rows={8}
              value={extractedText}
              onChange={(e) => setExtractedText(e.target.value)}
            />
            <div className="extract-actions">
              <button className="btn" onClick={() => apply('store')} disabled={applying}>
                Leave as text
              </button>
              <button className="btn" onClick={() => apply('append_text')} disabled={applying}>
                Append as text
              </button>
              <button
                className="btn btn-primary"
                onClick={() => apply('append_nodes')}
                disabled={applying}
              >
                Append to brain map
              </button>
            </div>
          </div>
        )}

        <h4>
          🤖 Ask AI about this topic <AiModelBadge />
        </h4>
        <div className="ai-ask">
          <div className="voice-field">
            <textarea
              rows={2}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question (context = this topic + its parent topics)"
            />
            <MicButton onText={(t) => setQuestion((v) => (v ? v + ' ' + t : t))} />
          </div>
          <button className="btn btn-primary" onClick={ask} disabled={asking || !question.trim()}>
            {asking ? 'Thinking…' : 'Ask AI'}
          </button>
          {answer && <div className="ai-answer">{renderMarkdown(answer)}</div>}
          {answer && (
            <div className="ai-answer-actions">
              <button className="btn btn-sm" onClick={() => applyAnswer('notes')} disabled={applyingAnswer}>
                💾 Save to this topic's notes
              </button>
              <button className="btn btn-sm" onClick={() => applyAnswer('child')} disabled={applyingAnswer}>
                ➕ Save to a new child topic
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => applyAnswer('map')} disabled={applyingAnswer}>
                🗺️ Create a map from this
              </button>
              <button className="btn btn-sm" onClick={() => applyAnswer('canvas')} disabled={applyingAnswer}>
                🔗 Create map in a new canvas &amp; link
              </button>
            </div>
          )}
          {pendingApply === 'notes' && (
            <div className="apply-mode-choice">
              <span className="muted">How should it be saved?</span>
              <div className="apply-mode-actions">
                <button className="btn btn-sm" onClick={() => doApply('notes', 'append')} disabled={applyingAnswer}>
                  Append to notes
                </button>
                <button className="btn btn-sm btn-danger" onClick={confirmOverride} disabled={applyingAnswer}>
                  Override notes
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setPendingApply(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          <button className="btn btn-sm view-chats-btn" onClick={toggleChats}>
            {showChats ? 'Hide previous chats' : '📜 View Previous Chats'}
          </button>
          {showChats && (
            <div className="chat-history">
              {chats.length === 0 && <div className="muted">No previous chats for this topic.</div>}
              {chats.map((c) => (
                <div key={c.id} className="chat-item" onClick={() => openChat(c)}>
                  <div className="chat-q">Q: {c.question}</div>
                  <div className="chat-meta">
                    {new Date(c.created_at).toLocaleString()} · {c.author}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <h4>
          🔄 Rearrange child nodes <AiModelBadge />
        </h4>
        {nodes.some((n) => n.data && n.data.parent_id === nodeId) ? (
          <div className="rearrange-section">
            <div className="rearrange-modes">
              <label className="rearrange-mode">
                <input
                  type="radio"
                  name="rearrange-mode"
                  checked={rearrangeMode === 'keep'}
                  onChange={() => setRearrangeMode('keep')}
                />
                Keep title &amp; description
              </label>
              <label className="rearrange-mode">
                <input
                  type="radio"
                  name="rearrange-mode"
                  checked={rearrangeMode === 'modify'}
                  onChange={() => setRearrangeMode('modify')}
                />
                Modify title &amp; description
              </label>
            </div>
            <div className="voice-field">
              <textarea
                rows={3}
                value={rearrangePrompt}
                onChange={(e) => setRearrangePrompt(e.target.value)}
              />
              <MicButton onText={(t) => setRearrangePrompt((v) => (v ? v + ' ' + t : t))} />
            </div>
            <button
              className="btn btn-primary"
              onClick={rearrangeChildren}
              disabled={rearranging || !rearrangePrompt.trim()}
            >
              {rearranging ? 'Arranging…' : 'Arrange child nodes'}
            </button>
          </div>
        ) : (
          <div className="muted">This topic has no child nodes.</div>
        )}
      </div>
    </aside>
  );
}

