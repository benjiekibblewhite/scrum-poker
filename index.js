import express from "express";
import { WebSocketServer } from "ws";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const BASE_PORT = process.env.port || 3000;
let PORT = BASE_PORT;

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Store sessions in memory
const sessions = {};

// Create HTTP server with port finding mechanism
function startServer(port) {
  const server = createServer(app);

  return new Promise((resolve, reject) => {
    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.log(`Port ${port} is in use, trying ${port + 1}`);
        resolve(startServer(port + 1));
      } else {
        reject(error);
      }
    });

    server.listen(port, () => {
      console.log(`Server running on port ${port}`);
      resolve(server);
    });
  });
}

// Create a new session
app.get("/new-session", (req, res) => {
  const sessionId = randomUUID();
  sessions[sessionId] = { users: {}, votes: {} };
  res.json({ sessionId });
});

// Start server and initialize WebSocket
startServer(PORT)
  .then((server) => {
    const wss = new WebSocketServer({ server });

    wss.on("connection", (ws, req) => {
      const sessionId = req.url.split("/").pop();
      if (!sessions[sessionId]) {
        ws.close();
        return;
      }

      function sendStateUpdate() {
        wss.clients.forEach((client) => {
          if (client.readyState === ws.OPEN) {
            client.send(
              JSON.stringify({ type: "state", state: sessions[sessionId] })
            );
          }
        });
      }

      ws.on("message", (data) => {
        const message = JSON.parse(data);
        console.log("✉️", message);
        console.log("🗳️", sessions[sessionId]);

        if (message.type === "get_state") {
          sendStateUpdate();
        }

        if (message.type === "join") {
          sessions[sessionId].users[message.name] = { online: true };

          sendStateUpdate();
        }

        if (message.type === "vote") {
          sessions[sessionId].votes[message.name] = message.value;

          sendStateUpdate();
        }

        if (message.type === "reveal") {
          sessions[sessionId].votesRevealed = true;

          sendStateUpdate();
        }

        if (message.type === "clear_votes") {
          sessions[sessionId].votes = {}; // Clear votes
          sessions[sessionId].votesRevealed = false; // Hide votes

          sendStateUpdate();
        }

        if (message.type === "hide_votes") {
          sessions[sessionId].votesRevealed = false; // Hide votes

          sendStateUpdate();
        }

        if (message.type === "disconnected") {
          console.log("🦄", "hey");
          sessions[sessionId].users[message.name].online = false;

          sendStateUpdate();
        }

        if (message.type === "remove_user") {
          delete sessions[sessionId].users[message.name];
          delete sessions[sessionId].votes[message.name];

          wss.clients.forEach((client) => {
            if (client.readyState === ws.OPEN) {
              client.send(
                JSON.stringify({ type: "user_removed", name: message.name })
              );
            }
          });
          sendStateUpdate();
        }
      });

      ws.on("close", () => {
        if (Object.keys(sessions[sessionId].votes).length === 0) {
          delete sessions[sessionId];
        }
      });
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });

app.use(express.static("public")); // Serve HTML, JS, and CSS from the 'public' folder
