/**
 * STATE
 */
let userName = "";
let lastVotesRevealed = false;
let channel;
let sessionId = "";

// Creates a reactive state object that triggers a callback when properties change
const createReactiveState = (initialState, onChange) => {
  return new Proxy(initialState, {
    set(target, property, value) {
      target[property] = value;
      onChange(target);
      return true;
    },
    deleteProperty(target, property) {
      delete target[property];
      onChange(target);
      return true;
    },
  });
};

const sessionState = createReactiveState(
  {
    users: {},
    votes: {},
    votesRevealed: false,
  },
  () => updateVotesDisplay()
);

// Itty-sockets client - simplified implementation
function connect(channelName, options = {}) {
  let ws = null;
  let isConnecting = false;
  let messageQueue = [];
  let eventHandlers = {};
  
  function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    
    const url = `wss://ittysockets.io/c/${channelName}?${new URLSearchParams(options)}`;
    ws = new WebSocket(url);
    
    ws.onopen = () => {
      console.log("🦄 Connected to itty-sockets");
      isConnecting = false;
      // Send queued messages
      while (messageQueue.length > 0) {
        const message = messageQueue.shift();
        ws.send(message);
      }
      // Trigger open handlers
      if (eventHandlers.open) {
        eventHandlers.open.forEach(handler => handler());
      }
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const messageEvent = {
          message: data.message,
          date: data.date ? new Date(data.date) : new Date(),
          id: data.id,
          uid: data.uid,
          alias: data.alias
        };
        
        // Trigger message handlers
        if (eventHandlers.message) {
          eventHandlers.message.forEach(handler => handler(messageEvent));
        }
        
        // Trigger specific type handlers
        if (data.message && data.message.type && eventHandlers[data.message.type]) {
          eventHandlers[data.message.type].forEach(handler => handler(messageEvent));
        }
      } catch (error) {
        console.error("🦄 Error parsing message:", error);
      }
    };
    
    ws.onclose = () => {
      console.log("🦄 Disconnected from itty-sockets");
      ws = null;
      isConnecting = false;
      if (eventHandlers.close) {
        eventHandlers.close.forEach(handler => handler());
      }
    };
    
    ws.onerror = (error) => {
      console.error("🦄 WebSocket error:", error);
    };
  }
  
  return {
    send: (message, recipientUid = null) => {
      const payload = JSON.stringify(message);
      const finalPayload = recipientUid ? `@@${recipientUid}@@${payload}` : payload;
      
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(finalPayload);
      } else {
        messageQueue.push(finalPayload);
        if (!isConnecting) {
          isConnecting = true;
          connectWebSocket();
        }
      }
      return this;
    },
    
    on: (eventType, handler) => {
      if (!eventHandlers[eventType]) {
        eventHandlers[eventType] = [];
      }
      eventHandlers[eventType].push(handler);
      return this;
    },
    
    open: () => {
      connectWebSocket();
      return this;
    },
    
    close: () => {
      if (ws) {
        ws.close();
      }
      return this;
    }
  };
}

/**
 * METHODS
 */

// No longer needed - using peer-to-peer communication

function showError(error, hideUI) {
  const errorsDiv = document.getElementById("errors");
  errorsDiv.textContent = error;
  errorsDiv.classList.remove("hidden");
  if (hideUI) {
    document.querySelector(".landing").classList.remove("hidden");
    document.getElementById("session").classList.add("hidden");
  }
}

function enableShareButton() {
  const shareButton = document.getElementById("shareSession");
  shareButton.disabled = false;
  shareButton.addEventListener("click", () => {
    navigator.clipboard.writeText(window.location.href);
    // show feedback
    shareButton.textContent = "Copied!";
    setTimeout(() => {
      shareButton.textContent = "Copy URL";
    }, 2000);
  });
}

function removedFromSession() {
  const sessionDiv = document.getElementById("session");
  const votingUI = sessionDiv.querySelector("#voteButtons");
  const actionButtons = sessionDiv.querySelectorAll(
    "#reveal, #clearVotes, #hideVotes"
  );

  // Hide voting UI
  votingUI.classList.add("hidden");
  actionButtons.forEach((button) => button.classList.add("hidden"));

  // Show removal message
  showError("You have been removed from the session");
  document.getElementById("session").classList.add("hidden");
  document.getElementById("landing").classList.remove("hidden");
  
  // Close the channel connection
  if (channel) {
    channel.close();
  }
}

function createVoteMarkup(revealed, vote, suit) {
  if (!vote) return "";
  if (vote === "?" || Number(vote) > 10) {
    if (!revealed)
      return `<playing-card rank="0" suit="hearts"></playing-card>`;
    return `<div class="custom-number ${
      revealed ? "" : "custom-hidden"
    } ${suit}"><span>${vote}</span></div>`;
  }
  return `<playing-card rank="${revealed ? vote : "0"}" suit="${
    suit || "hearts"
  }"></playing-card>`;
}

// Main function to update the UI. Called through Proxy when the state changes
function updateVotesDisplay() {
  const votesDiv = document.getElementById("votes");
  let users = Object.entries(sessionState.users);

  // Check if votes are being revealed (transition from hidden to revealed)
  const isRevealing = !lastVotesRevealed && sessionState.votesRevealed;
  lastVotesRevealed = sessionState.votesRevealed;

  if (sessionState.votesRevealed) {
    users.sort((a, b) => {
      const voteA = sessionState.votes[a[0]] || 0;
      const voteB = sessionState.votes[b[0]] || 0;
      return voteA - voteB;
    });

    // Only check for matching votes when actually revealing
    if (isRevealing) {
      const votes = Object.values(sessionState.votes).filter(
        (vote) => vote && vote !== "?"
      );
      if (votes.length > 1) {
        const allMatch = votes.every((vote) => vote === votes[0]);
        if (allMatch && confetti) {
          confetti({
            particleCount: 400,
            spread: 100,
            origin: { y: 0.6 },
            colors: ["#FFB3BA", "#BAFFC9", "#BAE1FF"],
            shapes: ["circle", "square"],
            ticks: 300, // how long the confetti will fall
            gravity: 0.8, // affects how fast they fall
            scalar: 1.2, // makes the confetti pieces bigger
          });
        }
      }
    }
  }

  votesDiv.innerHTML = users
    .map(([name, user]) => {
      const vote = sessionState.votes[name];
      const voteMarkup = createVoteMarkup(
        sessionState.votesRevealed,
        vote,
        user.suit
      );
      return `
          <div class="vote-slot" data-user="${name}">
            <div class="user-info">
              <span>${name}</span>
            </div>
            <div class="cards-area">
              <div class="card-container">
                <div class="card-slot"></div>
                ${voteMarkup}
              </div>
            </div>
            <div class="action-buttons">
              <button class="removeUser button-small" data-name="${name}">Remove</button>
            </div>
          </div>`;
    })
    .join("");

  votesDiv.classList.remove("hidden");

  document.querySelectorAll(".removeUser").forEach((button) => {
    button.addEventListener("click", () => {
      const shouldRemove = confirm(
        "Are you sure you want to remove this user?"
      );
      if (shouldRemove) {
        channel.send({
          type: "remove_user",
          name: button.dataset.name,
        });
      }
    });
  });
}

function initIttySockets(sessionId) {
  console.log("🦄 Initializing itty-sockets for session:", sessionId);
  
  // Connect to the channel with the session ID
  channel = connect(`scrum-poker-${sessionId}`, { alias: userName });

  // Handle incoming messages
  channel.on('message', (event) => {
    const message = event.message;
    console.log("🦄 Received message:", message);

    switch (message.type) {
      case "join":
        handleUserJoin(message);
        break;
        
      case "vote":
        handleVote(message);
        break;
        
      case "reveal":
        handleReveal();
        break;
        
      case "clear_votes":
        handleClearVotes();
        break;
        
      case "hide_votes":
        handleHideVotes();
        break;
        
      case "remove_user":
        handleRemoveUser(message);
        break;
        
      case "user_removed":
        if (message.name === userName) {
          delete sessionState.users[message.name];
          removedFromSession();
        }
        break;
    }
  });

  // Send join message when connected
  channel.on('open', () => {
    console.log("🦄 Connected to channel");
    channel.send({
      type: "join",
      name: userName,
      suit: getRandomSuit()
    });
  });

  // Handle user join/leave events
  channel.on('join', (event) => {
    console.log("🦄 User joined:", event.alias);
  });

  channel.on('leave', (event) => {
    console.log("🦄 User left:", event.alias);
  });

  // Attach event listeners to buttons
  document.querySelectorAll(".vote-button").forEach((button) => {
    button.addEventListener("click", () => {
      channel.send({
        type: "vote",
        name: userName,
        value: button.dataset.value,
      });
    });
  });

  document.getElementById("reveal").addEventListener("click", () => {
    channel.send({ type: "reveal" });
  });

  document.getElementById("clearVotes").addEventListener("click", () => {
    channel.send({ type: "clear_votes" });
  });

  document.getElementById("hideVotes").addEventListener("click", () => {
    channel.send({ type: "hide_votes" });
  });

  window.addEventListener("beforeunload", () => {
    channel.send({ type: "disconnected", name: userName });
  });
}

// Helper functions for message handling
function handleUserJoin(message) {
  sessionState.users[message.name] = {
    suit: message.suit,
    online: true
  };
}

function handleVote(message) {
  sessionState.votes[message.name] = message.value;
}

function handleReveal() {
  sessionState.votesRevealed = true;
}

function handleClearVotes() {
  sessionState.votes = {};
  sessionState.votesRevealed = false;
}

function handleHideVotes() {
  sessionState.votesRevealed = false;
}

function handleRemoveUser(message) {
  if (message.name === userName) {
    removedFromSession();
  } else {
    delete sessionState.users[message.name];
    delete sessionState.votes[message.name];
  }
}

function getRandomSuit() {
  const suits = ["hearts", "diamonds", "clubs", "spades"];
  return suits[Math.floor(Math.random() * suits.length)];
}

document.getElementById("newSession").addEventListener("click", () => {
  // Generate a random session ID
  const newSessionId = Math.random().toString(36).substring(2, 15);
  window.location.href = `?session=${newSessionId}`;
});

document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  sessionId = urlParams.get("session");
  
  if (sessionId) {
    console.log("🦄 Session ID found:", sessionId);
    enableShareButton(sessionId);

    document.getElementById("landing").classList.add("hidden");
    document.getElementById("nameInput").classList.remove("hidden");
    
    document.getElementById("joinSession").addEventListener("click", (e) => {
      e.preventDefault();
      userName = document.getElementById("userName").value.trim();
      if (userName) {
        console.log("🦄 User joining session:", userName);
        document.getElementById("landing").classList.add("hidden");
        document.getElementById("nameInput").classList.add("hidden");
        document.getElementById("session").classList.remove("hidden");

        initIttySockets(sessionId);
      }
    });
  }
});
