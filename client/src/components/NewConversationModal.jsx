// Search for a user by username to start a 1:1 chat, or select several and
// give the group a name to create a group conversation.
import { useState } from 'react';
import api from '../api/client';

export default function NewConversationModal({ onClose, onCreated }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState([]); // array of {id, username}
  const [groupName, setGroupName] = useState('');
  const [error, setError] = useState('');

  async function handleSearch(e) {
    const q = e.target.value;
    setQuery(q);
    if (q.trim().length === 0) return setResults([]);
    const { data } = await api.get('/users/search', { params: { q } });
    setResults(data.users.filter((u) => !selected.some((s) => s.id === u.id)));
  }

  function toggleSelect(user) {
    setSelected((prev) =>
      prev.some((u) => u.id === user.id) ? prev.filter((u) => u.id !== user.id) : [...prev, user]
    );
    setResults((prev) => prev.filter((u) => u.id !== user.id));
  }

  async function handleCreate() {
    setError('');
    try {
      if (selected.length === 1 && !groupName.trim()) {
        const { data } = await api.post('/conversations', { participantId: selected[0].id });
        onCreated(data.conversationId);
      } else if (selected.length >= 2) {
        if (!groupName.trim()) return setError('Group chats need a name');
        const { data } = await api.post('/conversations/group', {
          name: groupName,
          participantIds: selected.map((u) => u.id),
        });
        onCreated(data.conversationId);
      } else {
        setError('Pick at least one person to message');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create conversation');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New conversation</h2>
        {error && <div className="error">{error}</div>}

        {selected.length > 0 && (
          <div className="selected-chips">
            {selected.map((u) => (
              <span key={u.id} className="chip" onClick={() => toggleSelect(u)}>
                {u.username} ✕
              </span>
            ))}
          </div>
        )}

        {selected.length >= 2 && (
          <input
            placeholder="Group name"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            className="group-name-input"
          />
        )}

        <input placeholder="Search by username..." value={query} onChange={handleSearch} autoFocus />

        <div className="search-results">
          {results.map((u) => (
            <button key={u.id} className="search-result" onClick={() => toggleSelect(u)}>
              {u.username}
            </button>
          ))}
        </div>

        <div className="modal-actions">
          <button onClick={onClose} className="secondary">
            Cancel
          </button>
          <button onClick={handleCreate} disabled={selected.length === 0}>
            {selected.length >= 2 ? 'Create group' : 'Start chat'}
          </button>
        </div>
      </div>
    </div>
  );
}
