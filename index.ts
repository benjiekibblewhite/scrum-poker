import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import { createServer, Server } from "http";
import prisma from "./prisma-client.ts";

interface SessionUser {
  online: boolean;
  suit: string;
  socket?: WebSocket;
  id: string;
}

interface WSMessage {
  type: string;
  name?: string;
  value?: string;
  state?: any;
}

// Store active WebSocket connections
const activeConnections: {
  [socketId: string]: {
    socket: WebSocket;
    userId?: string;
    sessionId?: string;
  };
} = {};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const BASE_PORT = process.env.PORT || 3000;
let PORT = typeof BASE_PORT === "string" ? parseInt(BASE_PORT, 10) : BASE_PORT;

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Add available suits constant
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

// Format session state for the client
async function formatSessionState(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      users: true,
      votes: true,
    },
  });

  if (!session) return null;

  const users: { [key: string]: { suit: string; online: boolean } } = {};
  const votes: { [key: string]: string } = {};

  // Process users and their votes
  session.users.forEach((user) => {
    users[user.name] = {
      suit: user.suit,
      online: true, // Always true for DB users
    };
  });

  // Process votes
  session.votes.forEach((vote) => {
    const user = session.users.find((u) => u.id === vote.userId);
    if (user) {
      votes[user.name] = vote.value || "";
    }
  });

  return {
    users,
    votes,
    votesRevealed: session.votesRevealed,
  };
}

// Create a new session
app.post(
  "/new-session",
  async (_req: express.Request, res: express.Response) => {
    try {
      const session = await prisma.session.create({
        data: {
          votesRevealed: false,
        },
      });
      res.json({ sessionId: session.id });
    } catch (error) {
      console.error("Error creating session:", error);
      res.status(500).json({ error: "Failed to create session" });
    }
  }
);

// get session ID from url, like /session/123
app.get("/session/:id", async (req: express.Request, res: express.Response) => {
  try {
    const sessionId = req.params.id;
    const formattedState = await formatSessionState(sessionId);

    if (!formattedState) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.json(formattedState);
  } catch (error) {
    console.error("Error fetching session:", error);
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

// Start server and initialize WebSocket
startServer(PORT)
  .then((server) => {
    const wss = new WebSocketServer({ server });

    wss.on("connection", (ws: WebSocket, req: any) => {
      // Generate a unique ID for this connection
      const socketId = Math.random().toString(36).substring(2, 15);
      activeConnections[socketId] = { socket: ws };

      const sessionId = req.url?.split("/").pop() || "";
      if (!sessionId) {
        ws.send(
          JSON.stringify({
            type: "no_session_error",
            message: "Session not found",
          })
        );
        ws.close();
        return;
      }

      // Verify the session exists
      prisma.session
        .findUnique({ where: { id: sessionId } })
        .then((session) => {
          if (!session) {
            ws.send(
              JSON.stringify({
                type: "no_session_error",
                message: "Session not found",
              })
            );
            ws.close();
            return;
          }

          // Save the sessionId with this connection
          activeConnections[socketId].sessionId = sessionId;

          // Set up message handling
          async function sendStateUpdate() {
            const formattedState = await formatSessionState(sessionId);

            // Send state update to all clients in this session
            Object.values(activeConnections).forEach((conn) => {
              if (
                conn.sessionId === sessionId &&
                conn.socket.readyState === WebSocket.OPEN
              ) {
                conn.socket.send(
                  JSON.stringify({
                    type: "state",
                    state: formattedState,
                  })
                );
              }
            });
          }

          ws.on("message", async (data: WebSocket.RawData) => {
            try {
              const message: WSMessage = JSON.parse(data.toString());
              console.log("✉️", message);

              if (message.type === "get_state") {
                await sendStateUpdate();
              }

              if (message.type === "join" && message.name) {
                try {
                  // Check if user already exists in this session
                  const existingUser = await prisma.user.findFirst({
                    where: {
                      name: message.name,
                      sessionId: sessionId,
                    },
                  });

                  let userId;

                  if (existingUser) {
                    userId = existingUser.id;
                  } else {
                    // Create new user
                    const suit =
                      SUITS[Math.floor(Math.random() * SUITS.length)];
                    const user = await prisma.user.create({
                      data: {
                        name: message.name,
                        suit,
                        session: { connect: { id: sessionId } },
                      },
                    });
                    userId = user.id;
                  }

                  // Store user ID with this connection
                  activeConnections[socketId].userId = userId;

                  await sendStateUpdate();
                } catch (error) {
                  console.error(
                    `Error handling join for user ${message.name} in session ${sessionId}:`,
                    error
                  );
                }
              }

              if (message.type === "vote" && message.name) {
                try {
                  // Find the user
                  const user = await prisma.user.findFirst({
                    where: {
                      name: message.name,
                      sessionId,
                    },
                  });

                  if (user) {
                    // Check if vote exists
                    const existingVote = await prisma.vote.findFirst({
                      where: {
                        userId: user.id,
                        sessionId,
                      },
                    });

                    // Update or create vote
                    if (existingVote) {
                      await prisma.vote.update({
                        where: { id: existingVote.id },
                        data: { value: message.value || "" },
                      });
                    } else {
                      await prisma.vote.create({
                        data: {
                          value: message.value || "",
                          user: { connect: { id: user.id } },
                          session: { connect: { id: sessionId } },
                        },
                      });
                    }

                    await sendStateUpdate();
                  }
                } catch (error) {
                  console.error(
                    `Error handling vote for user ${message.name} in session ${sessionId}:`,
                    error
                  );
                }
              }

              if (message.type === "reveal") {
                try {
                  await prisma.session.update({
                    where: { id: sessionId },
                    data: { votesRevealed: true },
                  });
                  await sendStateUpdate();
                } catch (error) {
                  console.error(
                    `Error handling reveal in session ${sessionId}:`,
                    error
                  );
                }
              }

              if (message.type === "clear_votes") {
                try {
                  // Delete all votes for this session
                  await prisma.vote.deleteMany({
                    where: { sessionId },
                  });

                  // Reset votes revealed flag
                  await prisma.session.update({
                    where: { id: sessionId },
                    data: { votesRevealed: false },
                  });

                  await sendStateUpdate();
                } catch (error) {
                  console.error(
                    `Error handling clear_votes in session ${sessionId}:`,
                    error
                  );
                }
              }

              if (message.type === "hide_votes") {
                try {
                  await prisma.session.update({
                    where: { id: sessionId },
                    data: { votesRevealed: false },
                  });
                  await sendStateUpdate();
                } catch (error) {
                  console.error(
                    `Error handling hide_votes in session ${sessionId}:`,
                    error
                  );
                }
              }

              if (message.type === "disconnected" && message.name) {
                // We don't delete users on disconnect in DB-based system
                // They'll reappear when they reconnect
                // Just remove socket connection from active connections
                delete activeConnections[socketId];
              }

              if (message.type === "remove_user" && message.name) {
                try {
                  // Find the user to remove
                  const userToRemove = await prisma.user.findFirst({
                    where: {
                      name: message.name,
                      sessionId,
                    },
                  });

                  if (userToRemove) {
                    // Notify all users including the one being removed
                    Object.values(activeConnections).forEach((conn) => {
                      if (
                        conn.sessionId === sessionId &&
                        conn.socket.readyState === WebSocket.OPEN
                      ) {
                        console.log("Sending User Removed to User");
                        conn.socket.send(
                          JSON.stringify({
                            type: "user_removed",
                            name: message.name,
                          })
                        );
                      }
                    });

                    // Delete the user - cascades to votes due to relations
                    await prisma.user.delete({
                      where: { id: userToRemove.id },
                    });

                    // Send updated state to remaining users
                    await sendStateUpdate();
                  }
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
              // Remove connection from active connections
              delete activeConnections[socketId];

              // We don't delete users on disconnect in DB-based system
              // They can reconnect later
            } catch (error) {
              console.error(
                `Error handling WebSocket close for session ${sessionId}:`,
                error
              );
            }
          });
        })
        .catch((error) => {
          console.error("Error verifying session:", error);
          ws.send(
            JSON.stringify({
              type: "no_session_error",
              message: "Error connecting to session",
            })
          );
          ws.close();
        });
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
