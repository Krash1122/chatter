# Chatter

A real-time messaging app I built to get hands-on with full-stack, real-time
systems — one-to-one and group chats, image sharing, and live message status
(sent → delivered → seen), the way WhatsApp/iMessage-style ticks work.

**Stack:** React (Vite) · Node.js/Express · Socket.IO · PostgreSQL

## Features

- One-to-one **and** group conversations
- Real-time messaging over WebSockets (Socket.IO), not polling
- Per-message delivery status: sending → sent → delivered → seen, tracked
  *per recipient* so a group chat can show a message as seen by one person
  and only delivered to another
- Image sharing
- Typing indicators and online/offline presence
- JWT authentication with bcrypt-hashed passwords

## Why I built it this way

I wanted a project that forced me to deal with the parts of "real-time"
that are easy to hand-wave and hard to get right: what actually counts as
delivered vs. seen, how a client and server stay in sync without endlessly
polling, and how to structure a database so a feature like group chat isn't
a bolted-on special case. A few decisions I made along the way:

**One `conversations` table for both DMs and groups.** A direct message is
just a conversation with `is_group = false` and exactly two participants.
Early on I was tempted to build a separate table/API for 1:1 chats vs.
groups, but that meant writing (and testing) every feature twice. Modeling
a DM as "a group of two" collapsed that into one code path.

**Delivery status lives in its own table, not a column on `messages`.**
My first instinct was `messages.status = 'delivered'`. That breaks the
moment you add group chats — one message can be seen by one person and
merely delivered to another, at the same time, so a single column can't
represent it. I ended up with `message_status(message_id, user_id, status)`,
one row per recipient, and the "status" the sender sees is computed by
aggregating those rows (seen only once *everyone* has seen it).

**Optimistic UI, reconciled by a `client_temp_id`.** When you hit send, the
message appears instantly with a clock icon — before the server has even
responded. The client generates a temporary ID, sends it along with the
message, and when the server's real message comes back (via the socket ack
*and* the room broadcast, which can both arrive), the client swaps the
temp bubble for the real one by matching that ID instead of rendering it
twice. Getting this to not double- or lose messages was the fiddliest part
of the whole build.

**Images go over REST, not the socket.** Everything else is a socket event,
but file uploads need a real multipart HTTP request, so image messages hit
a normal `POST` endpoint (handled with Multer) and the server broadcasts
the resulting message over the socket afterward, so it still shows up live
for everyone else exactly like a text message would.

## How it works

### Data model

```
users ──< conversation_participants >── conversations ──< messages ──< message_status >── users
```

- `conversations` — one row per chat, `is_group` distinguishes a DM from a group
- `conversation_participants` — who's in which conversation
- `messages` — the message itself (text or image)
- `message_status` — one row per (message, recipient), tracking `sent` /
  `delivered` / `seen` independently for each person

### Real-time flow (`server/src/sockets/index.js`)

This file is the core of the app — everything about "is this message
delivered yet" happens here:

1. The client connects with a JWT (`io(url, { auth: { token } })`). The
   server verifies it and joins the socket to a personal room (`user:<id>`)
   and to a room for every conversation that user is in
   (`conversation:<id>`).
2. **Sending**: client emits `message:send`. The server writes the message,
   creates a `sent` status row per recipient, immediately upgrades any
   *currently online* recipient to `delivered`, broadcasts `message:new` to
   the room, and acks the sender directly.
3. **Delivered while offline**: any message that was still `sent` flips to
   `delivered` the moment its recipient reconnects.
4. **Seen**: while a client has a conversation open, it emits
   `message:seen` with the message IDs it just displayed. The server
   updates those rows and broadcasts `message:status`, so the *sender's*
   ticks update live, on their screen, without a refresh.
5. **Typing / presence** follow the same broadcast-to-room pattern.

### Auth

Register/login hash the password with bcrypt and return a JWT. Every
protected REST route checks `Authorization: Bearer <token>`
(`middleware/auth.js`); the socket connection is authenticated the same
way, once, at handshake time.

## Project structure

```
Chatter/
├── server/                  Express + Socket.IO API
│   └── src/
│       ├── config/db.js         Postgres connection pool
│       ├── db/schema.sql        Table definitions
│       ├── db/migrate.js        Applies schema.sql
│       ├── middleware/          auth.js (JWT check), upload.js (image uploads)
│       ├── routes/              REST endpoints
│       ├── controllers/         Request handlers
│       ├── services/            Shared DB logic (used by both REST & sockets)
│       ├── sockets/index.js     Real-time layer (the heart of the app)
│       └── uploads/             Uploaded images live here
└── client/                  React frontend (Vite)
    └── src/
        ├── api/              axios client + socket.io client
        ├── context/AuthContext.jsx   Login state, token, connects the socket
        ├── pages/            Login, Register, Chat (the main screen)
        └── components/       ConversationList, ChatWindow, MessageBubble, NewConversationModal
```

## Getting started

### 1. Install PostgreSQL (if you don't have it)

```bash
brew install postgresql@16
brew services start postgresql@16
```

### 2. Create the database and a user

```bash
createuser chatter_user --pwprompt   # set password to chatter_pass, or your own
createdb chatter -O chatter_user
```

(Using different names? Update the values in the next step to match.)

### 3. Configure environment variables

```bash
cd server
cp .env.example .env
# edit .env if you used different DB credentials, and set JWT_SECRET to a
# random string, e.g.:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
cd ../client
cp .env.example .env
```

### 4. Install dependencies and create the tables

From the project root:

```bash
npm run install:all
npm run db:migrate --prefix server
```

### 5. Run it

From the project root, this starts both the API server (port 4000) and the
Vite dev server (port 5173) together:

```bash
npm run dev
```

Open http://localhost:5173, register two different accounts (e.g. one in a
normal window, one in an incognito window), and message between them to see
delivery/seen status update live.

## Trying it out

- **1:1 chat**: "+ New conversation" → search a username → select them (no
  group name) → "Start chat".
- **Group chat**: select two or more people, give the group a name, "Create
  group".
- **Images**: click the 📎 button in the composer.
- **Status ticks**: 🕓 sending · ✓ sent · ✓✓ (grey) delivered · ✓✓ (blue) seen.

## What I'd add next

- Message editing/deleting
- Push notifications when the app isn't focused
- Read-receipt avatars in group chats (see exactly who has seen it, not
  just the aggregate tick)
- A "load older messages" UI for scrolling up (the API already supports
  cursor-based pagination via `?before=`, just needs a scroll listener)
- Rate limiting on `/api/auth/*` and the image upload endpoint

## About

Built by Kareem, a Software Engineering student (co-op) at the University
of Ottawa, as a project to practice building a real-time full-stack
application end to end — schema design, a WebSocket layer, and the React
frontend to go with it.
