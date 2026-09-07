// Renders one message. For the sender's own messages, also works out and
// shows the aggregate delivery tick:
//   sending    -> clock icon        (optimistic, no server id yet)
//   sent       -> single grey check (server has it, no recipient got it yet)
//   delivered  -> double grey check (at least one recipient's client has it)
//   seen       -> double blue check (EVERY recipient has seen it)
// In a group chat "seen" only lights up once every member has seen it --
// that's the same rule most group chat apps use.
const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace(/\/api\/?$/, '');

function aggregateStatus(message) {
  if (message.pending) return 'sending';
  const statuses = message.statuses || [];
  if (statuses.length === 0) return 'sent';
  if (statuses.every((s) => s.status === 'seen')) return 'seen';
  if (statuses.some((s) => s.status === 'delivered' || s.status === 'seen')) return 'delivered';
  return 'sent';
}

function StatusTick({ status }) {
  if (status === 'sending') return <span className="tick tick-clock">🕓</span>;
  if (status === 'sent') return <span className="tick">✓</span>;
  if (status === 'delivered') return <span className="tick">✓✓</span>;
  if (status === 'seen') return <span className="tick tick-seen">✓✓</span>;
  return null;
}

export default function MessageBubble({ message, isOwn, senderName }) {
  const status = isOwn ? aggregateStatus(message) : null;
  const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`message-row ${isOwn ? 'own' : ''}`}>
      <div className={`message-bubble ${isOwn ? 'own' : ''}`}>
        {!isOwn && senderName && <div className="sender-name">{senderName}</div>}
        {message.type === 'image' ? (
          <img
            className="message-image"
            src={message.image_url.startsWith('http') ? message.image_url : `${API_ORIGIN}${message.image_url}`}
            alt="shared"
          />
        ) : (
          <div className="message-body">{message.body}</div>
        )}
        <div className="message-meta">
          <span className="message-time">{time}</span>
          {isOwn && <StatusTick status={status} />}
        </div>
      </div>
    </div>
  );
}
