// @ts-check
const express = require("express");
const bcrypt = require("bcrypt");
const session = require("express-session");
const bodyParser = require("body-parser");
/** @ts-ignore */
const randomName = require("node-random-name");
let RedisStore = require("connect-redis")(session);
const path = require("path");
const fs = require("fs").promises;
// On your Express server
const cors = require('cors');
const { instrument } = require("@socket.io/admin-ui");
const  UserChat = require('./models/UserChat');
const GroupChat = require('./models/GroupChat');

const {
  client: redisClient,
  exists,
  set,
  get,
  hgetall,
  sadd,
  zadd,
  hmget,
  smembers,
  sismember,
  srem,
  sub,
  auth: runRedisAuth,
} = require("./redis");
const {
  createUser,
  makeUsernameKey,
  createPrivateRoom,
  sanitise,
  getMessages,
} = require("./utils");
const { createDemoData } = require("./demo-data");
const { PORT, SERVER_ID,connectDB } = require("./config");

const app = express();
app.use(cors({
  origin:["http://localhost:3000/","http://localhost:3000","https://admin.socket.io"],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.options('*', cors());

const server = require("http").createServer(app);
connectDB()

/** @type {SocketIO.Server} */
const io = require("socket.io")(server, {
  cors: {
    origin: ["http://localhost:3000/","http://localhost:3000","https://admin.socket.io"], 
    allowedHeaders: ["Content-Type", "application/json"],
    credentials: true
  }
});

instrument(io, {
  auth: false,
  mode: "development",
  
});

const sessionMiddleware = session({
  store: new RedisStore({ client: redisClient }),
  secret: "keyboard cat",
  saveUninitialized: true,
  resave: true,
});

const auth = (req, res, next) => {
  if (!req.session.user) {
    return res.sendStatus(403);
  }
  next();
};

const publish = (type, data) => {
  const outgoing = {
    serverId: SERVER_ID,
    type,
    data,
  };
  redisClient.publish("MESSAGES", JSON.stringify(outgoing));
};

const initPubSub = () => {
  /** We don't use channels here, since the contained message contains all the necessary data. */
  sub.on("message", (_, message) => {
    /**
     * @type {{
     *   serverId: string;
     *   type: string;
     *   data: object;
     * }}
     **/
    const { serverId, type, data } = JSON.parse(message);
    /** We don't handle the pub/sub messages if the server is the same */
    if (serverId === SERVER_ID) {
      return;
    }
    io.emit(type, data);
  });
  sub.subscribe("MESSAGES");
};

/** Initialize the app */
(async () => {
  /** Need to submit the password from the local stuff. */
  await runRedisAuth();
  /** We store a counter for the total users and increment it on each register */
  const totalUsersKeyExist = await exists("total_users");
  if (!totalUsersKeyExist) {
    /** This counter is used for the id */
    await set("total_users", 0);
    /**
     * Some rooms have pre-defined names. When the clients attempts to fetch a room, an additional lookup
     * is handled to resolve the name.
     * Rooms with private messages don't have a name
     */
    await set(`room:${0}:name`, "General");

    /** Create demo data with the default users */
    await createDemoData();
  }
  /** Once the app is initialized, run the server */
  runApp();
})();

async function runApp() {
  const repoLinks = await fs
    .readFile(path.dirname(__dirname) + "/repo.json")
    .then((x) => JSON.parse(x.toString()));

  app.use(bodyParser.json());
  app.use("/", express.static(path.dirname(__dirname) + "/client/build"));

  initPubSub();

  /** Store session in redis. */
  app.use(sessionMiddleware);
  io.use((socket, next) => {
    /** @ts-ignore */
    sessionMiddleware(socket.request, socket.request.res || {}, next);
  });

  // @ts-ignore
  // @ts-ignore
  app.get("/links", (req, res) => {
    return res.send(repoLinks);
  });

 
io.on("connection", async (socket) => {
  if (socket.request.session.user === undefined) {
    return;
  }

  const userId = socket.request.session.user.id;
  await sadd("online_users", userId);

  const msg = {
    ...socket.request.session.user,
    online: true,
  };

  publish("user.connected", msg);
  socket.broadcast.emit("user.connected", msg);

  socket.on("room.join", (id) => {
    socket.join(`room:${id}`);
  });

  // Simplified message handler to debug the issue
  socket.on("message", async (message) => {
    try {
      if (!message || !message.from || !message.roomId || !message.message) {
        throw new Error('Invalid message format');
      }
  
      const sanitizedMessage = { 
        ...message, 
        message: sanitise(message.message)
      };
      
      const isPrivate = sanitizedMessage.roomId.includes(':');
      const roomKey = `room:${sanitizedMessage.roomId}`;
      const roomHasMessages = await exists(roomKey);
  
      // Store in Redis for real-time features
      await sadd("online_users", sanitizedMessage.from);
      await zadd(roomKey, "" + sanitizedMessage.date, JSON.stringify(sanitizedMessage));
  
      if (isPrivate) {
        const [user1, user2] = sanitizedMessage.roomId.split(':');
        const senderId = sanitizedMessage.from;
        const receiverId = senderId === user1 ? user2 : user1;
  
        // Store in MongoDB
        await UserChat.addMessage({
          content: sanitizedMessage.message,
          sender: senderId,
          receiver: receiverId,
          roomId: sanitizedMessage.roomId,
          timestamp: sanitizedMessage.date
        });
  
        if (!roomHasMessages) {
          const roomMsg = {
            id: sanitizedMessage.roomId,
            names: [
              await hmget(`user:${user1}`, "username"),
              await hmget(`user:${user2}`, "username"),
            ],
          };
          publish("show.room", roomMsg);
          socket.broadcast.emit(`show.room`, roomMsg);
        }
      } else {
  
        await GroupChat.findOneAndUpdate(
          { roomId: sanitizedMessage.roomId },
          {
            $push: {
              messages: {
                content: sanitizedMessage.message,
                sender: sanitizedMessage.from,
                timestamp: sanitizedMessage.date,
                read: false
              }
            }
          },
          { upsert: true, new: true }
        );
      }
  
      publish("message", sanitizedMessage);
      io.to(roomKey).emit("message", sanitizedMessage);
  
    } catch (error) {
      console.error('Error handling message:', error);
      socket.emit('message.error', { error: 'Failed to process message' });
    }
  });
  socket.on("disconnect", async () => {
    await srem("online_users", userId);
    const disconnectMsg = {
      ...socket.request.session.user,
      online: false,
    };
    publish("user.disconnected", disconnectMsg);
    socket.broadcast.emit("user.disconnected", disconnectMsg);
  });
});

  /** Fetch a randomly generated name so users don't have collisions when registering a new user. */
  // @ts-ignore
  app.get("/randomname", (_, res) => {
    return res.send(randomName({ first: true }));
  });

  /** The request the client sends to check if it has the user is cached. */
  // @ts-ignore
  app.get("/me", (req, res) => {
    /** @ts-ignore */
    const { user } = req.session;
    if (user) {
      return res.json(user);
    }
    /** User not found */
    return res.json(null);
  });

  /** Login/register login */
  // @ts-ignore
  app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    const usernameKey = makeUsernameKey(username);
    const userExists = await exists(usernameKey);
    if (!userExists) {
      const newUser = await createUser(username, password);
      /** @ts-ignore */
      req.session.user = newUser;
      return res.status(201).json(newUser);
    } else {
      const userKey = await get(usernameKey);
      const data = await hgetall(userKey);
      if (await bcrypt.compare(password, data.password)) {
        const user = { id: userKey.split(":").pop(), username };
        /** @ts-ignore */
        req.session.user = user;
        return res.status(200).json(user);
      }
    }
    // user not found
    return res.status(404).json({ message: "Invalid username or password" });
  });

  // @ts-ignore
  app.post("/logout", auth, (req, res) => {
    req.session.destroy(() => {});
    return res.sendStatus(200);
  });

  /**
   * Create a private room and add users to it
   */
  // @ts-ignore
  app.post("/room", auth, async (req, res) => {
    const { user1, user2 } = {
      user1: parseInt(req.body.user1),
      user2: parseInt(req.body.user2),
    };

    const [result, hasError] = await createPrivateRoom(user1, user2);
    if (hasError) {
      return res.sendStatus(400);
    }
    return res.status(201).send(result);
  });

  /** Fetch messages from the general chat (just to avoid loading them only once the user was logged in.) */
  // @ts-ignore
  app.get("/room/0/preload", async (req, res) => {
    const roomId = "0";
    try {
      let name = await get(`room:${roomId}:name`);
      const messages = await getMessages(roomId, 0, 20);
      return res.status(200).send({ id: roomId, name, messages });
    } catch (err) {
      return res.status(400).send(err);
    }
  });

  /** Fetch messages from a selected room */
  // @ts-ignore
  app.get("/room/:id/messages", auth, async (req, res) => {
    const roomId = req.params.id;
    // @ts-ignore
    const offset = +req.query.offset;
    // @ts-ignore
    const size = +req.query.size;
    try {
      const messages = await getMessages(roomId, offset, size);
      return res.status(200).send(messages);
    } catch (err) {
      return res.status(400).send(err);
    }
  });

  /** Check which users are online. */
  // @ts-ignore
  app.get(`/users/online`, auth, async (req, res) => {
    const onlineIds = await smembers(`online_users`);
    const users = {};
    for (let onlineId of onlineIds) {
      const user = await hgetall(`user:${onlineId}`);
      users[onlineId] = {
        id: onlineId,
        username: user.username,
        online: true,
      };
    }
    return res.send(users);
  });

  /** Retrieve the user info based on ids sent */
  // @ts-ignore
  app.get(`/users`, async (req, res) => {
    /** @ts-ignore */
    /** @type {string[]} */ const ids = req.query.ids;
    if (typeof ids === "object" && Array.isArray(ids)) {
      /** Need to fetch */
      const users = {};
      for (let x = 0; x < ids.length; x++) {
        /** @type {string} */
        const id = ids[x];
        const user = await hgetall(`user:${id}`);
        users[id] = {
          id: id,
          username: user.username,
          online: !!(await sismember("online_users", id)),
        };
      }
      return res.send(users);
    }
    return res.sendStatus(404);
  });

  /**
   * Get rooms for the selected user.
   * TODO: Add middleware and protect the other user info.
   */
  // @ts-ignore
  app.get(`/rooms/:userId`, auth, async (req, res) => {
    const userId = req.params.userId;
    /** We got the room ids */
    const roomIds = await smembers(`user:${userId}:rooms`);
    const rooms = [];
    for (let x = 0; x < roomIds.length; x++) {
      const roomId = roomIds[x];

      let name = await get(`room:${roomId}:name`);
      /** It's a room without a name, likey the one with private messages */
      if (!name) {
        /**
         * Make sure we don't add private rooms with empty messages
         * It's okay to add custom (named rooms)
         */
        const roomExists = await exists(`room:${roomId}`);
        if (!roomExists) {
          continue;
        }

        const userIds = roomId.split(":");
        if (userIds.length !== 2) {
          return res.sendStatus(400);
        }
        rooms.push({
          id: roomId,
          names: [
            await hmget(`user:${userIds[0]}`, "username"),
            await hmget(`user:${userIds[1]}`, "username"),
          ],
        });
      } else {
        rooms.push({ id: roomId, names: [name] });
      }
    }
    res.status(200).send(rooms);
  });

  app.get('/api/conversations/:userId', auth, async (req, res) => {
    try {
      const conversations = await UserChat.getUserConversations(req.params.userId);
      return res.json({ conversations });
    } catch (error) {
      console.error('Error fetching conversations:', error);
      return res.status(500).json({ error: 'Failed to fetch conversations' });
    }
  });
  
  // Get messages for a specific room
  app.get('/api/messages/:roomId', auth, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const skip = parseInt(req.query.skip) || 0;
      
      const messages = await UserChat.getRoomMessages(req.params.roomId, limit, skip);
      return res.json({ messages });
    } catch (error) {
      console.error('Error fetching messages:', error);
      return res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });
  
  // Mark messages as read
  app.post('/api/messages/:roomId/read', auth, async (req, res) => {
    try {
      await UserChat.markMessagesAsRead(req.params.roomId, req.session.user.id);
      return res.json({ success: true });
    } catch (error) {
      console.error('Error marking messages as read:', error);
      return res.status(500).json({ error: 'Failed to mark messages as read' });
    }
  });
  app.get('/api/group-messages/:roomId', auth, async (req, res) => {
    try {
      const groupChat = await GroupChat.findOne({ roomId: req.params.roomId });
      if (!groupChat) {
        return res.json({ messages: [] });
      }
      
      return res.json({ 
        messages: groupChat.messages.sort((a, b) => b.timestamp - a.timestamp) 
      });
    } catch (error) {
      console.error('Error fetching group messages:', error);
      return res.status(500).json({ error: 'Failed to fetch group messages' });
    }
  });

  /**
   * We have an external port from the environment variable. To get this working on heroku,
   * it's required to specify the host
   * 
   */
  if (process.env.PORT) {
    server.listen(+PORT, "0.0.0.0", () =>
      console.log(`Listening on ${PORT}...`)
    );
  } else {
    server.listen(+PORT, () => console.log(`Listening on ${PORT}...`));
  }
}
