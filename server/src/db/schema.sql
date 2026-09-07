-- Chatter database schema (PostgreSQL)
--
-- Design notes:
--   * UUIDs for primary keys (gen_random_uuid(), from pgcrypto) so client-generated
--     temp IDs and server IDs never collide, and IDs aren't guessable.
--   * "conversations" covers BOTH one-to-one chats and groups. A 1:1 chat is just a
--     conversation with is_group = false and exactly two participants -- this avoids
--     duplicating logic between direct messages and group messages.
--   * Message delivery/seen status is tracked PER RECIPIENT in message_status, not as
--     a single column on messages. In a group chat, message A can be "seen" by one
--     member and merely "delivered" to another at the same time -- a single status
--     column on the message can't represent that.
--   * "sending" (the greyed-out clock tick you see right after hitting send) is a
--     purely client-side, optimistic state and never touches the database -- by the
--     time a row exists here the server has already accepted the message, so its
--     initial status is always 'sent'.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(32)  NOT NULL UNIQUE,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT         NOT NULL,
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_group   BOOLEAN     NOT NULL DEFAULT false,
    -- Only used for groups; a 1:1 conversation's "name" is derived on the client
    -- from whichever participant isn't the current user.
    name       VARCHAR(100),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversation_participants (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Denormalized pointer used to quickly compute "unread count" without scanning
    -- message_status. Updated whenever this user reads up to a given message.
    last_read_message_id UUID,
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TYPE message_type AS ENUM ('text', 'image');

CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    type            message_type NOT NULL DEFAULT 'text',
    body            TEXT,          -- text content (NULL for pure image messages)
    image_url       TEXT,          -- path/URL to the uploaded image (NULL for text messages)
    -- Lets a client that sent a message optimistically match the server's row back
    -- to the temporary bubble it already rendered, so it can update in place
    -- instead of flickering/duplicating.
    client_temp_id  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (type = 'text'  AND body IS NOT NULL) OR
        (type = 'image' AND image_url IS NOT NULL)
    )
);

CREATE TYPE delivery_status AS ENUM ('sent', 'delivered', 'seen');

CREATE TABLE message_status (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- the recipient
    status     delivery_status NOT NULL DEFAULT 'sent',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id)
);

-- Lookups the app does constantly: "give me this user's conversations",
-- "give me this conversation's messages in order", "give me this message's statuses".
CREATE INDEX idx_participants_user ON conversation_participants(user_id);
CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at);
CREATE INDEX idx_message_status_user ON message_status(user_id, status);
