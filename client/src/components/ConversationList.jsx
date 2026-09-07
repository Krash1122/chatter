// Left-hand sidebar: every conversation the user is part of, sorted by most
// recent activity (the server already sorts them), with a live-updating
// unread badge and last-message preview.
export default function ConversationList({ conversations, selectedId, onSelect, currentUserId, onlineUsers }) {
  function titleFor(conv) {
    if (conv.is_group) return conv.name;
    const other = (conv.other_participants || [])[0];
    return other ? other.username : 'Unknown user';
  }

  function previewFor(conv) {
    if (!conv.last_message_at) return 'No messages yet';
    if (conv.last_message_type === 'image') return '📷 Photo';
    const prefix = conv.last_message_sender_id === currentUserId ? 'You: ' : '';
    return prefix + (conv.last_message_body || '');
  }

  function isOnline(conv) {
    if (conv.is_group) return false;
    const other = (conv.other_participants || [])[0];
    return other && onlineUsers.has(other.id);
  }

  return (
    <div className="conversation-list">
      {conversations.length === 0 && <div className="empty-hint">No conversations yet. Start one!</div>}
      {conversations.map((conv) => (
        <button
          key={conv.id}
          className={`conversation-item ${conv.id === selectedId ? 'active' : ''}`}
          onClick={() => onSelect(conv.id)}
        >
          <div className="avatar">
            {titleFor(conv).slice(0, 1).toUpperCase()}
            {isOnline(conv) && <span className="online-dot" />}
          </div>
          <div className="conversation-info">
            <div className="conversation-title">{titleFor(conv)}</div>
            <div className="conversation-preview">{previewFor(conv)}</div>
          </div>
          {conv.unread_count > 0 && <span className="unread-badge">{conv.unread_count}</span>}
        </button>
      ))}
    </div>
  );
}
