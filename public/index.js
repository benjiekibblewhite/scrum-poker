/**
 * STATE
 */
let userName = "";
let lastVotesRevealed = false;
let ws;

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

/**
 * METHODS
 */

async function getSession(sessionId) {
  const res = await fetch(`/session/${sessionId}`);
  return res.json();
}

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
        ws.send(
          JSON.stringify({
            type: "remove_user",
            name: button.dataset.name,
          })
        );
      }
    });
  });
}

function initWebSocket(sessionId) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

  ws = new WebSocket(
    `${protocol}//${window.location.host}/session/${sessionId}`
  );

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "join", name: userName }));
    ws.send(JSON.stringify({ type: "get_state" }));
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);

    switch (message.type) {
      case "state":
        Object.assign(sessionState, message.state);
        break;

      case "user_removed":
        if (message.name === userName) {
          delete sessionState.users[message.name];
          ws.close();
          removedFromSession();
        }
        break;

      case "no_session_error":
        showError("Session not found", true);
        break;
    }
  };

  // attach event listeners to buttons now that the ws is open
  document.querySelectorAll(".vote-button").forEach((button) => {
    button.addEventListener("click", () => {
      ws.send(
        JSON.stringify({
          type: "vote",
          name: userName,
          value: button.dataset.value,
        })
      );
    });
  });

  document.getElementById("reveal").addEventListener("click", () => {
    ws.send(JSON.stringify({ type: "reveal" }));
  });

  document.getElementById("clearVotes").addEventListener("click", () => {
    ws.send(JSON.stringify({ type: "clear_votes" }));
  });

  document.getElementById("hideVotes").addEventListener("click", () => {
    ws.send(JSON.stringify({ type: "hide_votes" }));
  });

  window.addEventListener("beforeunload", () => {
    ws.send(JSON.stringify({ type: "disconnected", name: userName }));
  });
}

document.getElementById("newSession").addEventListener("click", async () => {
  const res = await fetch("/new-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });
  const data = await res.json();
  window.location.href = `?session=${data.sessionId}`;
});

document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get("session");
  try {
    if (sessionId) {
      const sessionState = await getSession(sessionId);

      if (!sessionState) {
        showError("Session not found", true);
        return;
      }

      enableShareButton(sessionId);

      document.getElementById("landing").classList.add("hidden");
      document.getElementById("nameInput").classList.remove("hidden");
      document.getElementById("joinSession").addEventListener("click", (e) => {
        e.preventDefault();
        userName = document.getElementById("userName").value.trim();
        if (userName) {
          document.getElementById("landing").classList.add("hidden");
          document.getElementById("nameInput").classList.add("hidden");
          document.getElementById("session").classList.remove("hidden");

          initWebSocket(sessionId);
        }
      });
    }
  } catch (error) {
    console.error(error);
    showError("Session not found", true);
  }
});
