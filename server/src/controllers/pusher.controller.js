// Channel authorization.
//
// Private and presence channels can't be subscribed to by the browser alone --
// pusher-js first POSTs the socket id and channel name here, and only
// subscribes if we hand back a signature generated with the app secret. That
// makes this endpoint the security boundary that io.use()'s handshake check
// used to be: without the membership check below, anyone who learned a
// conversation's UUID could subscribe to it and read every message sent in it
// from then on.
const { pusher, isConfigured, userChannel } = require('../realtime/pusher');
const convService = require('../services/conversations.service');

const CONVERSATION_PREFIX = 'presence-conversation-';

async function authorize(req, res, next) {
  try {
    if (!isConfigured) {
      return res.status(503).json({ error: 'Real-time messaging is not configured on this server' });
    }

    // pusher-js sends this as application/x-www-form-urlencoded.
    const socketId = req.body.socket_id;
    const channelName = req.body.channel_name;

    if (!socketId || !channelName) {
      return res.status(400).json({ error: 'socket_id and channel_name are required' });
    }

    if (channelName.startsWith(CONVERSATION_PREFIX)) {
      const conversationId = channelName.slice(CONVERSATION_PREFIX.length);
      // Throws 403 if they aren't in this conversation.
      await convService.assertParticipant(conversationId, req.user.id);

      // user_info is what the other subscribers see in the presence member
      // list, so it must not contain anything the recipients shouldn't have.
      const auth = pusher.authorizeChannel(socketId, channelName, {
        user_id: req.user.id,
        user_info: { username: req.user.username },
      });
      return res.json(auth);
    }

    // A user's personal channel is only ever their own.
    if (channelName === userChannel(req.user.id)) {
      return res.json(pusher.authorizeChannel(socketId, channelName));
    }

    return res.status(403).json({ error: 'Not allowed to subscribe to this channel' });
  } catch (err) {
    next(err);
  }
}

module.exports = { authorize };
