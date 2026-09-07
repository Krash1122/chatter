// Top-level chat page: owns the conversation list, the online-users set
// (from 'presence' events), and which conversation is currently open.
import { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { getSocket } from '../api/socket';
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

  const refreshConversations = useCallback(() => {
    api.get('/conversations').then(({ data }) => setConversations(data.conversations));
  }, []);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  // Any new message anywhere should re-sort the conversation list and bump
  // its unread count/preview -- simplest correct way is to just refetch.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    function onNewMessage() {
      refreshConversations();
    }
    function onPresence({ userId, online }) {
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        online ? next.add(userId) : next.delete(userId);
        return next;
      });
    }

    socket.on('message:new', onNewMessage);
    socket.on('presence', onPresence);
    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('presence', onPresence);
    };
  }, [refreshConversations]);

  function handleSelect(conversationId) {
    setSelectedId(conversationId);
    // Clear the unread badge immediately in the UI; the server-side "seen"
    // marking happens inside ChatWindow once messages are loaded.
    setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, unread_count: 0 } : c)));
  }

  function handleCreated(conversationId) {
    setShowNewModal(false);
    getSocket()?.emit('conversation:join', { conversationId });
    refreshConversations();
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
