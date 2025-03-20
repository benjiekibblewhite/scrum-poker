import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { createServer, Server } from "http";

interface SessionUser {
  online: boolean;
  suit: string;
  socket?: WebSocket;
}

interface SessionState {
  users: { [key: string]: SessionUser };
  votes: { [key: string]: string };
  votesRevealed?: boolean;
}

interface Sessions {
  [key: string]: SessionState;
}

interface WSMessage {
  type: string;
  name?: string;
  value?: string;
  state?: SessionState;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const BASE_PORT = process.env.PORT || 3000;
let PORT = typeof BASE_PORT === "string" ? parseInt(BASE_PORT, 10) : BASE_PORT;

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Store sessions in memory
const sessions: Sessions = {};

// Add available suits constant at the top with other constants
const SUITS = ["hearts", "diamonds", "clubs", "spades"];

// Create HTTP server with port finding mechanism
function startServer(port: number): Promise<Server> {
  const server = createServer(app);

  return new Promise((resolve, reject) => {
    server.on("error", (error: NodeJS.ErrnoException) => {
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
app.post("/new-session", (_req: express.Request, res: express.Response) => {
  const sessionId = randomUUID();
  sessions[sessionId] = {
    users: {},
    votes: {},
    votesRevealed: false,
  };
  res.json({ sessionId });
});

// get session ID from url, like /session/123
app.get("/session/:id", (req: express.Request, res: express.Response) => {
  const sessionId = req.params.id;
  res.json(sessions[sessionId]);
});

// Start server and initialize WebSocket
startServer(PORT)
  .then((server) => {
    const wss = new WebSocketServer({ server });

    wss.on("connection", (ws: WebSocket, req: Request) => {
      const sessionId = req.url?.split("/").pop() || "";
      if (!sessionId || !sessions[sessionId]) {
        ws.send(
          JSON.stringify({
            type: "no_session_error",
            message: "Session not found",
          })
        );
        ws.close();
        return;
      }

      function sendStateUpdate(): void {
        Object.values(sessions[sessionId].users).forEach((user) => {
          if (user.socket?.readyState === WebSocket.OPEN) {
            user.socket.send(
              JSON.stringify({
                type: "state",
                state: sessions[sessionId],
              })
            );
          }
        });
      }

      ws.on("message", (data: WebSocket.RawData) => {
        try {
          const message: WSMessage = JSON.parse(data.toString());
          console.log("✉️", message);
          console.log("🗳️", sessions[sessionId]);

          if (message.type === "get_state") {
            sendStateUpdate();
          }

          if (message.type === "join" && message.name) {
            try {
              const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
              sessions[sessionId].users[message.name] = {
                online: true,
                suit: suit,
                socket: ws,
              };
              sendStateUpdate();
            } catch (error) {
              console.error(
                `Error handling join for user ${message.name} in session ${sessionId}:`,
                error
              );
            }
          }

          if (message.type === "vote" && message.name) {
            try {
              sessions[sessionId].votes[message.name] = message.value || "";
              sendStateUpdate();
            } catch (error) {
              console.error(
                `Error handling vote for user ${message.name} in session ${sessionId}:`,
                error
              );
            }
          }

          if (message.type === "reveal") {
            try {
              sessions[sessionId].votesRevealed = true;
              sendStateUpdate();
            } catch (error) {
              console.error(
                `Error handling reveal in session ${sessionId}:`,
                error
              );
            }
          }

          if (message.type === "clear_votes") {
            try {
              sessions[sessionId].votes = {};
              sessions[sessionId].votesRevealed = false;
              sendStateUpdate();
            } catch (error) {
              console.error(
                `Error handling clear_votes in session ${sessionId}:`,
                error
              );
            }
          }

          if (message.type === "hide_votes") {
            try {
              sessions[sessionId].votesRevealed = false;
              sendStateUpdate();
            } catch (error) {
              console.error(
                `Error handling hide_votes in session ${sessionId}:`,
                error
              );
            }
          }

          if (message.type === "disconnected" && message.name) {
            try {
              if (sessions[sessionId].users[message.name]) {
                sessions[sessionId].users[message.name].online = false;
                sendStateUpdate();
              }
            } catch (error) {
              console.error(
                `Error handling disconnect event for session ${sessionId}:`,
                error
              );
            }
          }

          if (message.type === "remove_user" && message.name) {
            try {
              // First notify all users including the one being removed
              Object.values(sessions[sessionId].users).forEach((user) => {
                if (user.socket?.readyState === WebSocket.OPEN) {
                  console.log("Sending User Removed to User");
                  user.socket.send(
                    JSON.stringify({ type: "user_removed", name: message.name })
                  );
                }
              });

              // Then delete the user data
              delete sessions[sessionId].users[message.name];
              delete sessions[sessionId].votes[message.name];

              // Finally send state update to remaining users
              sendStateUpdate();
            } catch (error) {
              console.error(
                `Error removing user ${message.name} for session ${sessionId}:`,
                error
              );
            }
          }
        } catch (error) {
          console.error(
            `Error parsing message in session ${sessionId}:`,
            error
          );
        }
      });

      ws.on("close", () => {
        try {
          // Find and remove the disconnected user
          const disconnectedUser = Object.entries(
            sessions[sessionId].users
          ).find(([_, user]) => user.socket === ws);

          if (disconnectedUser) {
            const [userName] = disconnectedUser;
            delete sessions[sessionId].users[userName];

            // Clean up empty sessions
            if (Object.keys(sessions[sessionId].users).length === 0) {
              delete sessions[sessionId];
            }
          }
        } catch (error) {
          console.error(
            `Error handling WebSocket close for session ${sessionId}:`,
            error
          );
        }
      });
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });

app.use(express.static("public")); // Serve HTML, JS, and CSS from the 'public' folder
