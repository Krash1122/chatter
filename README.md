# Chatter

A real-time messaging app with one-to-one and group chats, image sharing,
typing indicators, and live message status (sending, sent, delivered, seen).
Built with React, Express, PostgreSQL and Pusher, deployed on Vercel.

## Why I made it

I wanted to challenge myself and find out how hard it actually is to build
the texting part of social media. Every app I use has it, it looks simple,
and I assumed that meant it was simple. It isn't. The moment you ask what
"delivered" really means, or what happens when one person in a group has
read a message and another hasn't, or how the little ticks on the sender's
screen update without them refreshing, the whole thing opens up. That gap
between "looks obvious" and "is obvious" was the reason I picked it.

## How I built it

**The database.** Everything hangs off one `conversations` table. A direct
message is just a conversation with `is_group = false` and two participants,
so group chat isn't a separate feature with its own tables and its own code
path. It's the same path. My first instinct was to build DMs and groups
separately, and that would have meant writing and testing every feature
twice.

Message status lives in its own table, `message_status(message_id, user_id,
status)`, with one row per recipient. I originally had a single `status`
column on the message, which works right up until a group chat needs to show
one person as "seen" and another as "delivered" at the same time. One column
can't hold two answers. The tick the sender sees is computed by aggregating
those rows, so the blue double check only appears once everyone has seen it.

**The frontend.** React with Vite. When you hit send, the message appears
instantly with a clock icon before the server has answered. The client makes
up a temporary ID, sends it along, and when the real message comes back it
swaps the temp bubble for the real one by matching that ID. The message
arrives twice, once as the HTTP response and once as the realtime broadcast,
so without that matching you get every message rendered twice.

**The realtime layer.** The browser holds a WebSocket open to Pusher.
Everyone in a conversation subscribes to a channel for it, and the server
broadcasts to that channel when something happens. Subscribing is gated by
my own API, which checks the JWT and confirms you're actually in that
conversation. Without that check, anyone who learned a conversation's ID
could subscribe and read it.

**Images** upload straight from the browser to Cloudinary. The API's only
job is to sign the upload so the secret never reaches the browser.

## Problems I ran into

**Socket.IO doesn't work on Vercel, and I found out by deploying.** The
first version was Express and Socket.IO as one long-running process. Vercel
runs serverless functions, which exist for the length of one request. There
is no process to hold a WebSocket open, and no guarantee two requests from
the same user even hit the same instance. My room membership lived in
Socket.IO's memory, so two instances wouldn't agree on who was online.
Rewriting the realtime layer onto Pusher fixed it: the browser holds the
connection, and my API only makes a short outbound call to say "broadcast
this," which fits inside a function invocation.

**A self-deadlock that took 10 seconds to fail.** Once I capped the Postgres
pool at one connection per instance, sending a message started timing out.
`createMessage` grabs the pool's connection to open a transaction, then
called a helper that went back to the pool for a second connection to look
up the participants, a connection only the transaction could release. It was
waiting for itself. Sending a message went from **failing after 10,005 ms to
a 3.6 ms median** once everything inside the transaction used the same
connection. I only caught it because I wrote an end to end test script. It
never showed up in normal development, because a default pool of 10 quietly
hides it.

*How I measured it:* a loop that sends 200 messages one after another and
records `performance.now()` before and after each request. Median 3.6 ms,
95th percentile 7.2 ms, against a local Postgres.

**Read receipts were spamming the realtime service.** Opening a conversation
with 30 unread messages marks all 30 as seen at once, and I was sending one
broadcast per message. Batching them into a single event with an array took
that from **30 broadcasts down to 1, a 97% reduction**. The total bytes are
about the same, so this isn't a bandwidth win. It matters because Pusher's
free tier bills per message, and because the client was re-rendering 30
times in a row instead of once.

*How I measured it:* counted the broadcast calls the server makes when
marking 30 messages seen, which is the same count you can watch live in
Pusher's debug console.

**Typing indicators were burning server calls for nothing.** Every keystroke
burst was hitting my API just to tell one other person that someone was
typing, which is information that's worthless 1.5 seconds later. I moved it
to a Pusher client event that goes browser to browser, taking it from one
server call per 1.5 seconds of typing to **zero**.

**Too many database connections.** Every cold started instance was opening a
pool of 10. I fired 50 concurrent queries at both settings and watched the
connection count from Postgres itself. The pool of 10 **peaked at 13 open
connections, and capping it at 1 peaked at 4, a 69% reduction**, with Neon's
connection pooler doing the real pooling behind it.

*How I measured it:* ran `SELECT count(*) FROM pg_stat_activity WHERE
datname = 'chatter'` on a 5 ms interval while the 50 queries were running,
and kept the highest number.

**Image uploads had nowhere to land.** Vercel's filesystem is read only, so
the Multer setup writing to a local folder had no disk to write to. Vercel
also caps a request body at 4.5 MB, which is smaller than the 8 MB images I
already allowed. Uploading directly to Cloudinary means an 8 MB image now
sends **150 bytes through my API instead of 8,388,608, which is 99.998%
less**. The API only returns the upload signature.

**A timing attack defence that didn't defend anything.** On login I compared
against a dummy hash when no user was found, so the response time wouldn't
reveal whether an email exists. The dummy string I'd used wasn't a valid
bcrypt hash, so the comparison bailed out immediately instead of taking the
same time as a real one, which leaked exactly what it was meant to hide.
Replacing it with a real hash fixed it.

**Unread counts drifting.** I was setting the "last read" pointer from the
last row an `UPDATE ... RETURNING` handed back, assuming that was the newest
message. SQL makes no promise about row order, so the pointer sometimes
landed on an older message and the unread badge was wrong. It's now computed
with an explicit `ORDER BY created_at DESC LIMIT 1`.

**Swapped bcrypt for bcryptjs.** `bcrypt` is a native module that has to be
compiled for the exact build platform. `bcryptjs` is pure JavaScript with
the same API and the same hash format, so it's one less thing that can break
on a build machine I don't control.

## Running it locally

You'll need PostgreSQL, plus free Pusher and Cloudinary accounts for
realtime and images. Copy `server/.env.example` to `server/.env` and
`client/.env.example` to `client/.env`, then fill them in.

```bash
npm run install:all
npm run db:migrate
npm run dev
```

That starts the API on port 4000 and the frontend on 5173. Register two
accounts in two windows (one incognito) and message between them to see the
ticks update live.

Without Pusher and Cloudinary configured the app still runs. Messages send
and load, they just don't appear until you refresh, and the image button
returns an error.

## Deploying

Postgres on Neon (use the pooled connection string, the host ending in
`-pooler`), a Pusher Channels app with client events enabled in its settings,
and a Cloudinary account. Import the repo into Vercel, where the build config
is already in `vercel.json`, and set these environment variables:
`DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PUSHER_APP_ID`,
`PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`, `CLOUDINARY_CLOUD_NAME`,
`CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `VITE_PUSHER_KEY`,
`VITE_PUSHER_CLUSTER`.

Anything starting with `VITE_` gets baked into the JavaScript the browser
downloads, so it's public. That's fine for the Pusher key, since channel
access is granted by my API and not by the key, but no secret goes in one.

## What I'd add next

Message editing and deleting, push notifications when the app isn't focused,
and read receipt avatars so you can see exactly who in a group has seen a
message rather than just the aggregate tick. The API already does cursor
based pagination for older messages, so that just needs a scroll listener on
the frontend. I'd also keep the end to end test script I wrote while
migrating, since it caught the deadlock immediately.

## About

Built by Kareem, a Software Engineering student (co-op) at the University of
Ottawa.
