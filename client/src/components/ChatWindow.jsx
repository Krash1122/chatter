// The active conversation: message history, the composer (text + image),
// typing indicator, and marking incoming messages as seen.
import { useEffect, useRef, useState, useCallback } from 'react';
import api from '../api/client';
import { getSocket } from '../api/socket';
import MessageBubble from './MessageBubble.jsx';

function upsertMessage(list, incoming) {
  // Replace an optimistic temp bubble once the server confirms it (matched
  // by client_temp_id), otherwise replace-or-append by real id so the same
  // message never renders twice (REST response + socket broadcast both
  // deliver it).
  const byTempId = incoming.client_temp_id && list.findIndex((m) => m.id === incoming.client_temp_id);
  if (byTempId !== undefined && byTempId !== -1 && byTempId !== false) {
    const copy = [...list];
    copy[byTempId] = incoming;
    return copy;
  }
  const byId = list.findIndex((m) => m.id === incoming.id);
  if (byId !== -1) {
    const copy = [...list];
    copy[byId] = { ...copy[byId], ...incoming };
    return copy;
  }
  return [...list, incoming];
}

export default function ChatWindow({ conversation, currentUser, onlineUsers }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [typingUsers, setTypingUsers] = useState(new Set());
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const conversationId = conversation.id;

  const otherName = conversation.is_group
    ? conversation.name
    : (conversation.other_participants || [])[0]?.username || 'Unknown user';

  const markSeen = useCallback(
    (msgs) => {
      const socket = getSocket();
      if (!socket) return;
      const unseenIds = msgs
        .filter((m) => m.sender_id !== currentUser.id && !m.pending)
        .filter((m) => (m.statuses || []).some((s) => s.userId === currentUser.id && s.status !== 'seen'))
        .map((m) => m.id);
      if (unseenIds.length > 0) {
        socket.emit('message:seen', { conversationId, messageIds: unseenIds });
      }
    },
    [conversationId, currentUser.id]
  );

  // Load history whenever the selected conversation changes.
  useEffect(() => {
    setLoading(true);
    api.get(`/conversations/${conversationId}/messages`).then(({ data }) => {
      setMessages(data.messages);
      setLoading(false);
      markSeen(data.messages);
    });
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Socket listeners scoped to this conversation.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    function onNewMessage(message) {
      if (message.conversation_id !== conversationId) return;
      setMessages((prev) => {
        const next = upsertMessage(prev, message);
        markSeen(next);
        return next;
      });
    }

    function onStatus({ messageId, userId, status }) {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const statuses = m.statuses || [];
          const idx = statuses.findIndex((s) => s.userId === userId);
          const nextStatuses =
            idx === -1
              ? [...statuses, { userId, status }]
              : statuses.map((s, i) => (i === idx ? { ...s, status } : s));
          return { ...m, statuses: nextStatuses };
        })
      );
    }

    function onTyping({ conversationId: cid, userId, isTyping }) {
      if (cid !== conversationId || userId === currentUser.id) return;
      setTypingUsers((prev) => {
        const next = new Set(prev);
        isTyping ? next.add(userId) : next.delete(userId);
        return next;
      });
    }

    socket.on('message:new', onNewMessage);
    socket.on('message:status', onStatus);
    socket.on('typing', onTyping);
    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('message:status', onStatus);
      socket.off('typing', onTyping);
    };
  }, [conversationId, currentUser.id, markSeen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleTyping(value) {
    setDraft(value);
    const socket = getSocket();
    if (!socket) return;
    socket.emit('typing:start', { conversationId });
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing:stop', { conversationId });
    }, 1500);
  }

  function handleSend(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft('');

    const clientTempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic = {
      id: clientTempId,
      client_temp_id: clientTempId,
      conversation_id: conversationId,
      sender_id: currentUser.id,
      type: 'text',
      body,
      created_at: new Date().toISOString(),
      statuses: [],
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);

    const socket = getSocket();
    socket.emit('message:send', { conversationId, body, clientTempId }, (res) => {
      if (res?.ok) {
        setMessages((prev) => upsertMessage(prev, { ...res.message, statuses: [] }));
      } else {
        // Mark the bubble as failed rather than silently losing it.
        setMessages((prev) => prev.map((m) => (m.id === clientTempId ? { ...m, failed: true, pending: false } : m)));
      }
    });
  }

  async function handleImagePick(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    const clientTempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const localUrl = URL.createObjectURL(file);
    const optimistic = {
      id: clientTempId,
      client_temp_id: clientTempId,
      conversation_id: conversationId,
      sender_id: currentUser.id,
      type: 'image',
      image_url: localUrl,
      created_at: new Date().toISOString(),
      statuses: [],
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);

    const formData = new FormData();
    formData.append('image', file);
    formData.append('clientTempId', clientTempId);

    try {
      const { data } = await api.post(`/conversations/${conversationId}/messages/image`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setMessages((prev) => upsertMessage(prev, { ...data.message, statuses: [] }));
    } catch (err) {
      setMessages((prev) => prev.map((m) => (m.id === clientTempId ? { ...m, failed: true, pending: false } : m)));
    }
  }

  return (
    <div className="chat-window">
      <div className="chat-header">
        <div className="avatar">{otherName.slice(0, 1).toUpperCase()}</div>
        <div>
          <div className="chat-header-title">{otherName}</div>
          {typingUsers.size > 0 ? (
            <div className="chat-header-subtitle">typing...</div>
          ) : !conversation.is_group ? (
            <div className="chat-header-subtitle">
              {onlineUsers.has((conversation.other_participants || [])[0]?.id) ? 'Online' : 'Offline'}
            </div>
          ) : null}
        </div>
      </div>

      <div className="message-list">
        {loading ? (
          <div className="centered">Loading messages...</div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              isOwn={m.sender_id === currentUser.id}
              senderName={
                conversation.is_group
                  ? (conversation.other_participants || []).find((p) => p.id === m.sender_id)?.username
                  : null
              }
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <form className="composer" onSubmit={handleSend}>
        <button type="button" className="attach-btn" onClick={() => fileInputRef.current?.click()}>
          📎
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImagePick} />
        <input
          className="composer-input"
          placeholder="Type a message..."
          value={draft}
          onChange={(e) => handleTyping(e.target.value)}
        />
        <button type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
