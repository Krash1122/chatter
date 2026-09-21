const convService = require('../services/conversations.service');
const { trigger, userChannel } = require('../realtime/pusher');

// POST /api/conversations  { participantId }
async function createDirect(req, res, next) {
  try {
    const { participantId } = req.body;
    if (!participantId) return res.status(400).json({ error: 'participantId is required' });

    const conversationId = await convService.getOrCreateDirectConversation(req.user.id, participantId);
    await notifyParticipants(conversationId, req.user.id);
    res.status(201).json({ conversationId });
  } catch (err) {
    next(err);
  }
}

// POST /api/conversations/group  { name, participantIds: [...] }
async function createGroup(req, res, next) {
  try {
    const { name, participantIds } = req.body;
    if (!name || !Array.isArray(participantIds)) {
      return res.status(400).json({ error: 'name and participantIds[] are required' });
    }
    const conversationId = await convService.createGroupConversation(req.user.id, name, participantIds);
    await notifyParticipants(conversationId, req.user.id);
    res.status(201).json({ conversationId });
  } catch (err) {
    next(err);
  }
}

// The other members can't be subscribed to a conversation channel that didn't
// exist when their page loaded, so they'd only discover a new chat on refresh.
// A nudge on each member's personal channel tells them to refetch and
// subscribe. This is what the old socket 'conversation:join' event covered,
// except the server now initiates it instead of waiting for the creator's
// client to ask.
async function notifyParticipants(conversationId, creatorId) {
  const participantIds = await convService.getParticipantIds(conversationId);
  await Promise.all(
    participantIds
      .filter((id) => id !== creatorId)
      .map((id) => trigger(userChannel(id), 'conversation-new', { conversationId }))
  );
}

// GET /api/conversations
async function list(req, res, next) {
  try {
    const conversations = await convService.listConversationsForUser(req.user.id);
    res.json({ conversations });
  } catch (err) {
    next(err);
  }
}

module.exports = { createDirect, createGroup, list };
