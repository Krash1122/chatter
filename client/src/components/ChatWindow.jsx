// The active conversation: message history, the composer (text + image),
// typing indicator, and marking incoming messages as seen.
//
// Sending used to be a socket emit with an acknowledgement callback; it's now
// a POST whose response plays the same role. Receiving is a Pusher event on
// the conversation's presence channel. Chat.jsx owns subscribing to that
// channel, so this component only binds and unbinds its own handlers on it --
// it must not unsubscribe, or it would cut off the sidebar too.
import { useEffect, useRef, useState, useCallback } from 'react';
import api from '../api/client';
import { getRealtime, subscribe, conversationChannelName } from '../api/realtime';
import MessageBubble from './MessageBubble.jsx';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function upsertMessage(list, incoming) {
  // Replace an optimistic temp bubble once the server confirms it (matched
  // by client_temp_id), otherwise replace-or-append by real id so the same
  // message never renders twice (the POST response and the Pusher broadcast
  // both deliver it to the sender).
  if (incoming.client_temp_id) {
    const byTempId = list.findIndex((m) => m.id === incoming.client_temp_id);
    if (byTempId !== -1) {
      const copy = [...list];
      copy[byTempId] = incoming;
      return copy;
    }
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
  const [error, setError] = useState('');
  const [typingUsers, setTypingUsers] = useState(new Set());
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const channelRef = useRef(null);
  const conversationId = conversation.id;

  const otherName = conversation.is_group
    ? conversation.name
    : (conversation.other_participants || [])[0]?.username || 'Unknown user';

  const markSeen = useCallback(
    (msgs) => {
      const unseenIds = msgs
        .filter((m) => m.sender_id !== currentUser.id && !m.pending)
        .filter((m) => (m.statuses || []).some((s) => s.userId === currentUser.id && s.status !== 'seen'))
        .map((m) => m.id);
      if (unseenIds.length > 0) {
        api.post(`/conversations/${conversationId}/messages/seen`, { messageIds: unseenIds }).catch(() => {});
      }
    },
    [conversationId, currentUser.id]
  );

  // Load history whenever the selected conversation changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .get(`/conversations/${conversationId}/messages`)
      .then(({ data }) => {
        if (cancelled) return;
        setMessages(data.messages);
        setLoading(false);
        markSeen(data.messages);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setError('Could not load messages.');
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime listeners scoped to this conversation.
  useEffect(() => {
    if (!getRealtime()) return;
    const channel = subscribe(conversationChannelName(conversationId));
    if (!channel) return;
    channelRef.current = channel;

    function onNewMessage(message) {
      if (message.conversation_id !== conversationId) return;
      setMessages((prev) => {
        const next = upsertMessage(prev, message);
        markSeen(next);
        return next;
      });
    }

    // Status changes arrive batched, one event per burst.
    function onStatus({ updates = [] }) {
      if (updates.length === 0) return;
      setMessages((prev) =>
        prev.map((m) => {
          const forThis = updates.filter((u) => u.messageId === m.id);
          if (forThis.length === 0) return m;
          const statuses = [...(m.statuses || [])];
          forThis.forEach(({ userId, status }) => {
            const idx = statuses.findIndex((s) => s.userId === userId);
            if (idx === -1) statuses.push({ userId, status });
            else statuses[idx] = { ...statuses[idx], status };
          });
          return { ...m, statuses };
        })
      );
    }

    // Typing is a client event: it goes browser -> Pusher -> browser without
    // touching our API at all. There's no point spending a function
    // invocation on something that's stale in 1.5 seconds.
    function onTyping({ userId, isTyping }) {
      if (userId === currentUser.id) return;
      setTypingUsers((prev) => {
        const next = new Set(prev);
        if (isTyping) next.add(userId);
        else next.delete(userId);
        return next;
      });
    }

    channel.bind('message-new', onNewMessage);
    channel.bind('message-status', onStatus);
    channel.bind('client-typing', onTyping);

    return () => {
      // Unbind only our own handlers -- Chat.jsx has its own on this channel
      // and owns the subscription itself.
      channel.unbind('message-new', onNewMessage);
      channel.unbind('message-status', onStatus);
      channel.unbind('client-typing', onTyping);
      channelRef.current = null;
    };
  }, [conversationId, currentUser.id, markSeen]);

  // Reset the typing indicator when switching conversations.
  useEffect(() => {
    setTypingUsers(new Set());
    return () => clearTimeout(typingTimeoutRef.current);
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function emitTyping(isTyping) {
    try {
      channelRef.current?.trigger('client-typing', { userId: currentUser.id, isTyping });
    } catch {
      // Client events are rejected until the subscription completes, and are
      // off entirely unless enabled in the Pusher dashboard. Neither is worth
      // interrupting typing over.
    }
  }

  function handleTyping(value) {
    setDraft(value);
    emitTyping(true);
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => emitTyping(false), 1500);
  }

  function optimisticBubble(clientTempId, fields) {
    return {
      id: clientTempId,
      client_temp_id: clientTempId,
      conversation_id: conversationId,
      sender_id: currentUser.id,
      created_at: new Date().toISOString(),
      statuses: [],
      pending: true,
      ...fields,
    };
  }

  function newTempId() {
    return `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function markFailed(clientTempId) {
    setMessages((prev) =>
      prev.map((m) => (m.id === clientTempId ? { ...m, failed: true, pending: false } : m))
    );
  }

  async function handleSend(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    emitTyping(false);

    const clientTempId = newTempId();
    setMessages((prev) => [...prev, optimisticBubble(clientTempId, { type: 'text', body })]);

    try {
      const { data } = await api.post(`/conversations/${conversationId}/messages`, {
        type: 'text',
        body,
        clientTempId,
      });
      setMessages((prev) => upsertMessage(prev, { ...data.message, statuses: [] }));
    } catch {
      markFailed(clientTempId);
    }
  }

  async function handleImagePick(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    // multer used to enforce these server-side. The upload no longer passes
    // through our server at all, so the check moves here (Cloudinary enforces
    // its own limits too, but its errors are not worth showing a user).
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setError('Only PNG, JPEG, GIF or WEBP images are allowed.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Images must be under 8MB.');
      return;
    }
    setError('');

    const clientTempId = newTempId();
    const localUrl = URL.createObjectURL(file);
    setMessages((prev) => [
      ...prev,
      optimisticBubble(clientTempId, { type: 'image', image_url: localUrl }),
    ]);

    try {
      // 1. Ask our API to sign the upload. The Cloudinary secret stays server-side.
      const { data: sig } = await api.get('/uploads/signature');

      // 2. Upload straight to Cloudinary. Deliberately fetch, not the shared
      //    axios instance -- that one attaches our JWT to every request, and
      //    it has no business being sent to a third party.
      const form = new FormData();
      form.append('file', file);
      form.append('api_key', sig.apiKey);
      form.append('timestamp', sig.timestamp);
      form.append('folder', sig.folder);
      form.append('signature', sig.signature);

      const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, {
        method: 'POST',
        body: form,
      });
      if (!uploadRes.ok) throw new Error('Cloudinary upload failed');
      const uploaded = await uploadRes.json();

      // 3. Only now does a message row exist, pointing at the hosted URL.
      const { data } = await api.post(`/conversations/${conversationId}/messages`, {
        type: 'image',
        imageUrl: uploaded.secure_url,
        clientTempId,
      });
      setMessages((prev) => upsertMessage(prev, { ...data.message, statuses: [] }));
      // Only now that the bubble points at the hosted URL instead of the local
      // preview -- revoking on failure would blank out the failed bubble.
      URL.revokeObjectURL(localUrl);
    } catch {
      markFailed(clientTempId);
      setError('Could not send that image.');
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

      {error && <div className="error">{error}</div>}

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
