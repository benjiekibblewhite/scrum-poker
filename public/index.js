let ws;

const createReactiveState = (initialState, onChange) => {
    const handler = {
        set(target, property, value) {
            const result = Reflect.set(target, property, value)
            console.log({target, property, value, result})
            onChange(target)
            return result;
        },
        deleteProperty(target, property) {
            const result = Reflect.deleteProperty(target, property)
            onChange(target)
            return result
        }
    }

    return new Proxy(initialState, handler)
}

// init reactive state
let sessionState = createReactiveState({
    users: {},
    votes: {},
    votesRevealed: false
},
    (state) => {
        updateVotesDisplay()
    }
)



function showError(error, hideUI) {
    const errorsDiv = document.getElementById("errors");
    errorsDiv.textContent = error;
    errorsDiv.classList.remove("hidden");
    if (hideUI) {
      document.querySelector(".landing").classList.remove("hidden");
      document.getElementById("session").classList.add("hidden");
    }
  }

  async function getSession(sessionId) {
    const res = await fetch(`/session/${sessionId}`);
    return res.json();
  }

  function enableShareButton(sessionId) {
    const shareButton = document.getElementById("shareSession");
    shareButton.disabled = false;
    shareButton.addEventListener("click", () => {
      navigator.clipboard.writeText(window.location.href);
      // show a tooltip
      shareButton.textContent = "Copied!";
      setTimeout(() => {
        shareButton.textContent = "Copy URL";
      }, 2000);
    });
  }


  document.addEventListener("DOMContentLoaded", async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get("session");
    try {
      if (sessionId) {
        const sessionState = await getSession(sessionId);
        enableShareButton(sessionId);
        if (!sessionState) {
          showError("Session not found", true);
          return;
        }
        document.getElementById("landing").classList.add("hidden");
        document.getElementById("nameInput").classList.remove("hidden");
        document
          .getElementById("joinSession")
          .addEventListener("click", (e) => {
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


  document
  .getElementById("newSession")
  .addEventListener("click", async () => {
    const res = await fetch("/new-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data = await res.json();
    window.location.href = `?session=${data.sessionId}`;
  });

function updateVotesDisplay() {
  const votesDiv = document.getElementById("votes");
  let users = Object.entries(sessionState.users);

  if (sessionState.votesRevealed) {
    users.sort((a, b) => {
      const voteA = sessionState.votes[a[0]] || 0;
      const voteB = sessionState.votes[b[0]] || 0;
      return voteA - voteB;
    });
  }

  function getVoteDisplay(revealed, vote, suit) {
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

  votesDiv.innerHTML = users
    .map(([name, user]) => {
      const vote = sessionState.votes[name];
      const voteDisplay = getVoteDisplay(
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
              ${voteDisplay}
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

  document
    .getElementById("startNewSession")
    .addEventListener("click", async () => {
      const res = await fetch("/new-session");
      const data = await res.json();
      window.location.href = `?session=${data.sessionId}`;
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
    if (message.type === "state") {
      sessionState = message.state;
    //   updateVotesDisplay();
    }
    if (message.type === "user_removed") {
      if (message.name === userName) {
        delete sessionState.users[message.name];
        delete sessionState.votes[message.name];
        // updateVotesDisplay();
        ws.close();
        removedFromSession();
      }
    }
    if (message.type === "no_session_error") {
      showError("Session not found", true);
    }
  };

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