const PORT = process.env.PORT || 3000;
const WSS_PORT = process.env.PORT || 8042;
const MIN_WAITING = process.env.MIN_WAITING || 2000;

const express = require("express");
const session = require("express-session");
const { google } = require("googleapis");
var format = require("date-format");
var fs = require("fs");
const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: WSS_PORT });

const filename = `live_chat_${format.asString(
  "yyyy_MM_dd__hh_mm",
  new Date()
)}.txt`;

var stream = fs.createWriteStream(filename, { flags: "a" });

// WebSocket
wss.on("connection", (ws) => {
  console.log(`Connection...`);

  ws.on("message", (data) => {
    console.log(`onClientMessage: ${data}`);
  });
});

var OAuth2 = google.auth.OAuth2;

var oauth2Client = new OAuth2();

const app = express();

const memoryStore = new session.MemoryStore();

// Configure Express session middleware
app.use(
  session({
    secret: "your_secret_key",
    resave: false,
    saveUninitialized: true,
    store: memoryStore,
  })
);

app.set('views', 'src/views');
app.set('view engine', 'ejs');
app.engine('ejs', require('ejs').__express);

// Index, read the credentials json downloaded from Google Cloud
app.get("/", (req, res) => {
  if (process.env.CLIENT_ID && process.env.CLIENT_SECRET) {
    console.log(`Reading clientId and clientSecret from env...`);
    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.CLIENT_SECRET;
    const loginLink = googleLoginLink(clientId, clientSecret);
    res.render("index", { loginLink: loginLink });
  } else {
    console.log(`Reading client_secret.json...`);
    fs.readFile(
      "client_secret.json",
      function processClientSecrets(err, content) {
        if (err) {
          console.log("Error loading client secret file: " + err);
          return;
        }
        const credentials = JSON.parse(content);

        const loginLink = googleLoginLink(
          credentials.installed.client_id,
          credentials.installed.client_secret
        );
        res.render("index", { loginLink: loginLink });
      }
    );
  }
});

const googleLoginLink = (clientId, clientSecret) => {
  // Store credentials in the store.
  memoryStore.set("credentials", { clientId, clientSecret });

  const redirectUrl = `http://localhost:${PORT}/auth/google/callback`;
  oauth2Client = new OAuth2(clientId, clientSecret, redirectUrl);

  const loginLink = oauth2Client.generateAuthUrl({
    scope: ["https://www.googleapis.com/auth/youtube.readonly"],
  });
  return loginLink;
};

app.get("/success", (req, res) => {
  console.log(`Success!`);
  res.render("starting");
});

// Google OAuth2 callback
app.get("/auth/google/callback", (req, res) => {
  // Successful authentication
  if (req.query.error) {
    return res.redirect("/");
  }

  oauth2Client.getToken(req.query.code, function (err, token) {
    if (err) {
      console.error(`Can't get token ${err}`);
      return res.redirect("/");
    }

    console.log(
      `Token from google using the code ${req.query.code}:\n${JSON.stringify(
        token
      )}`
    );

    memoryStore.set("token", token);

    return res.redirect("/success");
  });

  oauth2Client.on("tokens", (tokens) => {
    console.log(`oauth2Client tokens`);
    memoryStore.set("token", tokens);
  });
});

// Access YouTube API
app.get("/youtube", async (req, res) => {
  const liveId = req.query.liveId;
  memoryStore.set("liveId", liveId);

  liveBroadcast(liveId)
    .then(({ chatId, title }) => {
      console.log(`Start listening chatId ${chatId}`);
      memoryStore.set("listening", true);
      res.render("listening", { liveId, chatId, title });

      listening(chatId);
    })
    .catch((err) => {
      console.error(`Error during liveBroadcast ${err}`);
    });
});

app.get("/logout", (req, res) => {
  memoryStore.set("listening", false);
  res.redirect("/");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

/**
 *
 * @returns Youtube Api Client
 */
const ytClient = () => {
  return new Promise((resolve, reject) => {
    memoryStore.get("token", (err, tokens) => {
      if (err) {
        console.error(`Error retrievenig token ${err}`);
        reject(err);
      }

      const youtubeAuthClient = new google.auth.OAuth2();
      youtubeAuthClient.setCredentials(tokens);
      const youtube = google.youtube({
        version: "v3",
        auth: youtubeAuthClient,
      });
      resolve(youtube);
    });
  });
};

/**
 *
 * @param {string} liveId
 * @returns title and chatId of the broadcast
 */
const liveBroadcast = (liveId) => {
  return new Promise((resolve, reject) => {
    ytClient().then((youtube) => {
      youtube.liveBroadcasts.list(
        {
          part: "snippet",
          id: liveId,
        },
        (err, response) => {
          if (err) {
            console.error("Error accessing YouTube API:", err);
            reject(err);
          }
          const title = response.data.items[0]?.snippet?.title;
          const chatId = response.data.items[0]?.snippet?.liveChatId;
          if (chatId) {
            console.log(`Chat Id found! ${chatId}`);
            resolve({ chatId, title });
          } else {
            console.error(`Chat Id not found!`);
            console.warn(`${JSON.stringify(response)}`);
            reject();
          }
        }
      );
    });
  });
};

/**
 *
 * @param {string} liveChatId
 * @param {string} pageToken
 * @returns Live messages from youtube chat
 */
const liveChatMessages = (liveChatId, pageToken) => {
  return new Promise((resolve, reject) => {
    ytClient().then((youtube) => {
      youtube.liveChatMessages.list(
        {
          part: "snippet, authorDetails",
          liveChatId,
          pageToken,
        },
        (err, response) => {
          if (err) {
            console.error("Error accessing YouTube API:", err);
            reject(err);
          }
          const { pollingIntervalMillis, nextPageToken, items } = response.data;

          const waitFor =
            pollingIntervalMillis < MIN_WAITING
              ? MIN_WAITING
              : pollingIntervalMillis;

          resolve({
            nextPageToken,
            items,
            waitFor,
          });
        }
      );
    });
  });
};

/**
 * Recursive call to listen to messages
 * @param {*} chatId
 * @param {*} pageToken
 */
const listening = (chatId, pageToken) => {
  liveChatMessages(chatId, pageToken)
    .then(({ nextPageToken, items, waitFor }) => {
      evaluateMessages(items);

      memoryStore.get("listening", (err, listen) => {
        if (listen) {
          setTimeout(() => {
            listening(chatId, nextPageToken);
          }, waitFor);
        } else {
          console.log(`Do not listen to messages anymore.`);
        }
      });
    })
    .catch((err) => {
      console.error(`Error during listening ${err}`);
    });
};

const evaluateMessages = (items) => {
  if (items == null || items.length == 0) {
    return;
  }
  items.forEach((item) => {
    const { snippet, authorDetails } = item;
    const message = JSON.stringify({
      publishedAt: snippet.publishedAt,
      authorName: authorDetails.displayName,
      displayMessage: snippet.displayMessage,
    });
    // Write to local file
    stream.write(`${message},\n`);
    // Send the message to websocket
    wss.clients.forEach((client) => {
      client.send(message);
    });
  });
};
