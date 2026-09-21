// Top-level chat page: owns the conversation list, the online-users set, and
// which conversation is currently open.
//
// It also owns the Pusher subscriptions for every conversation the user is in.
// Socket.IO used to do this server-side -- on connect it looked up your
// conversations and joined you to each room. Pusher has no server-side
// equivalent, so the client subscribes to each `presence-conversation-<id>`
// channel itself. That's also what makes the online dots work: presence
// channels report their own membership.
import { useEffect, useState, useCallback, useRef } from 'react';
import api from '../api/client';
import {
  getRealtime,
  subscribe,
  unsubscribe,
  conversationChannelName,
  userChannelName,
} from '../api/realtime';
import { useAuth } from '../context/AuthContext.jsx';
import ConversationList from '../components/ConversationList.jsx';
import ChatWindow from '../components/ChatWindow.jsx';
import NewConversationModal from '../components/NewConversationModal.jsx';

export default function Chat() {
  const { user, logout } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState(new Set());

  // conversationId -> pusher channel, for the presence recount below.
  const channelsRef = useRef(new Map());

  const refreshConversations = useCallback(
    () => api.get('/conversations').then(({ data }) => setConversations(data.conversations)),
    []
  );

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  // Everything addressed to this user that's still sitting at 'sent' was sent
  // while they were away; their client has it now, so acknowledge the lot.
  // This is the old on-connect UPDATE from the socket layer, moved to the
  // client side of the connection.
  useEffect(() => {
    api.post('/messages/delivered').catch(() => {});
  }, []);

  // Recounted from every subscribed channel rather than nudged one member at a
  // time: if you share three conversations with someone, them leaving one
  // channel doesn't mean they went offline.
  const recomputeOnline = useCallback(() => {
    const ids = new Set();
    channelsRef.current.forEach((channel) => {
      channel.members?.each((member) => ids.add(member.id));
    });
    setOnlineUsers(ids);
  }, []);

  const handleNewMessageAnywhere = useCallback(
    (message) => {
      // Re-sorts the list, bumps the preview and the unread badge. Refetching
      // is cheap here and always correct, which beats patching the row.
      refreshConversations();

      // Tell the server we've got it, so the sender's ticks go to double grey
      // even though this conversation isn't open.
      if (message?.sender_id && message.sender_id !== user.id) {
        api.post('/messages/delivered', { messageIds: [message.id] }).catch(() => {});
      }
    },
    [refreshConversations, user.id]
  );

  // Keyed on the id list, not the array: refreshConversations replaces
  // `conversations` on every new message, and re-running this effect each time
  // would tear down and rebuild every subscription.
  const conversationIds = conversations.map((c) => c.id).join(',');

  useEffect(() => {
    if (!getRealtime()) return;

    const wanted = new Set(conversationIds ? conversationIds.split(',') : []);
    const channels = channelsRef.current;

    // Leave conversations that are no longer ours.
    channels.forEach((_, id) => {
      if (!wanted.has(id)) {
        unsubscribe(conversationChannelName(id));
        channels.delete(id);
      }
    });

    // Join any we aren't on yet. Re-subscribing to a channel we already hold
    // is a no-op in pusher-js, but tracking them here keeps the presence
    // recount honest.
    wanted.forEach((id) => {
      if (channels.has(id)) return;
      const channel = subscribe(conversationChannelName(id));
      if (!channel) return;
      channel.bind('pusher:subscription_succeeded', recomputeOnline);
      channel.bind('pusher:member_added', recomputeOnline);
      channel.bind('pusher:member_removed', recomputeOnline);
      channel.bind('message-new', handleNewMessageAnywhere);
      channels.set(id, channel);
    });

    recomputeOnline();
  }, [conversationIds, recomputeOnline, handleNewMessageAnywhere]);

  // Only on unmount -- the effect above deliberately keeps its channels alive
  // across re-runs.
  useEffect(() => {
    const channels = channelsRef.current;
    return () => {
      channels.forEach((_, id) => unsubscribe(conversationChannelName(id)));
      channels.clear();
    };
  }, []);

  // Personal channel: how you find out someone started a conversation with you
  // without refreshing the page. You can't be subscribed to a conversation
  // channel that didn't exist when the page loaded, so the server pings you
  // here instead and you refetch.
  useEffect(() => {
    if (!getRealtime() || !user?.id) return;
    const name = userChannelName(user.id);
    const channel = subscribe(name);
    if (!channel) return;

    const onNewConversation = () => refreshConversations();
    channel.bind('conversation-new', onNewConversation);

    return () => {
      channel.unbind('conversation-new', onNewConversation);
      unsubscribe(name);
    };
  }, [user?.id, refreshConversations]);

  function handleSelect(conversationId) {
    setSelectedId(conversationId);
    // Clear the unread badge immediately in the UI; the server-side "seen"
    // marking happens inside ChatWindow once messages are loaded.
    setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, unread_count: 0 } : c)));
  }

  async function handleCreated(conversationId) {
    setShowNewModal(false);
    // The subscription effect picks the new channel up as soon as this lands.
    await refreshConversations();
    setSelectedId(conversationId);
  }

  const selectedConversation = conversations.find((c) => c.id === selectedId);

  return (
    <div className="chat-page">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="me">
            <div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div>
            <span>{user.username}</span>
          </div>
          <button onClick={logout} className="link-btn">
            Log out
          </button>
        </div>
        <button className="new-conversation-btn" onClick={() => setShowNewModal(true)}>
          + New conversation
        </button>
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={handleSelect}
          currentUserId={user.id}
          onlineUsers={onlineUsers}
        />
      </aside>

      <main className="main-panel">
        {selectedConversation ? (
          <ChatWindow conversation={selectedConversation} currentUser={user} onlineUsers={onlineUsers} />
        ) : (
          <div className="centered empty-state">Select a conversation or start a new one</div>
        )}
      </main>

      {showNewModal && <NewConversationModal onClose={() => setShowNewModal(false)} onCreated={handleCreated} />}
    </div>
  );
}
