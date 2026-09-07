# Chatter

A real-time messaging app: one-to-one and group chats, image sharing, and
per-message delivery status (sent → delivered → seen).

## Stack

| Layer     | Choice                                            |
|-----------|----------------------------------------------------|
| Frontend  | React (Vite), React Router, Axios, Socket.IO client |
| Backend   | Node.js, Express, Socket.IO, JWT auth, bcrypt, Multer |
| Database  | PostgreSQL                                         |

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

## How it works

### Data model

Everything — a 1:1 chat and a group chat — is a **conversation**. A direct
message is just a conversation with `is_group = false` and exactly two
participants; this means one code path handles both, instead of duplicating
"DM logic" and "group logic".

Delivery status is **not** a single column on `messages`. It lives in its own
table, `message_status(message_id, user_id, status)` — one row per
*recipient* per message. That's what lets a group message be "seen" by one
member and only "delivered" to another, at the same time. A message's status
shown to the sender is computed by aggregating those rows:

- **sending** — pure client-side state, before the server has acknowledged
  the message at all (no DB row exists yet).
- **sent** — the server has stored the message, but no recipient has a
  `delivered`/`seen` row yet.
- **delivered** — at least one recipient's client has received it in real time.
- **seen** — *every* recipient has opened the conversation and viewed it.

### Real-time flow (Socket.IO)

`server/src/sockets/index.js` is where the status transitions actually
happen:

1. Client connects with a JWT (`io(url, { auth: { token } })`). The server
   verifies it and joins the socket to `user:<id>` (a personal room) and to
   `conversation:<id>` for every conversation that user is part of.
2. **Sending**: client emits `message:send`. Server inserts the message,
   creates a `message_status` row per recipient (status `sent`), immediately
   upgrades any *currently online* recipients to `delivered`, then broadcasts
   `message:new` to the whole conversation room and acks the sender.
3. **Delivered while offline**: if a recipient wasn't online at send time,
   their pending messages flip from `sent` to `delivered` the moment they
   reconnect (handled in the `connection` handler).
4. **Seen**: when a client has a conversation open, it emits `message:seen`
   with the message IDs it just displayed. The server updates those rows and
   broadcasts `message:status` so the sender's ticks update live.
5. **Typing / presence**: `typing:start`/`typing:stop` and online/offline are
   broadcast the same way, scoped to the relevant conversation room(s).

Image messages are the one thing that goes over plain REST
(`POST /api/conversations/:id/messages/image`, handled by Multer) instead of
a socket event, because file uploads need a real multipart HTTP request. The
server still broadcasts the resulting message over the socket, so it appears
in real time for everyone else exactly like a text message would.

### Auth

Registration hashes the password with bcrypt and returns a JWT. Every
protected REST route checks `Authorization: Bearer <token>` via
`middleware/auth.js`; the socket connection is authenticated the same way,
once, at handshake time.

## Setup

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

Open http://localhost:5173, register two different accounts in two browser
windows (or one normal + one incognito), and message between them to see
delivery/seen status update live.

## Trying it out

- **1:1 chat**: "+ New conversation" → search a username → select them (no
  group name) → "Start chat".
- **Group chat**: select two or more people, give the group a name, "Create
  group".
- **Images**: click the 📎 button in the composer.
- **Status ticks**: 🕓 sending · ✓ sent · ✓✓ (grey) delivered · ✓✓ (blue) seen.

## Pushing to GitHub

```bash
git add -A
git commit -m "Initial Chatter implementation"
gh repo create chatter --private --source=. --remote=origin
git push -u origin main
```

(Or create the empty repo on github.com first, then
`git remote add origin <url> && git push -u origin main`.)

## Ideas for next steps

- Message editing/deleting
- Push notifications when the app isn't focused
- Read-receipt avatars in group chats (who specifically has seen it)
- Pagination UI for scrolling up to load older messages (the API already
  supports it via `?before=`)
- Rate limiting on `/api/auth/*` and the image upload endpoint
