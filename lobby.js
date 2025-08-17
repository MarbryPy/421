/* ===== Firebase init ===== */
const cfg = {
  apiKey: "AIzaSyB9QKf88f8YS3b8hQ_hbJC4rwre9UYNIUI",
  authDomain: "mon421-a1108.firebaseapp.com",
  databaseURL: "https://mon421-a1108-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "mon421-a1108",
  storageBucket: "mon421-a1108.appspot.com",
  messagingSenderId: "354289081138",
  appId: "1:354289081138:web:be104504732e1ef984952b"
};
firebase.initializeApp(cfg);
const db = firebase.database();

/* ===== Variables ===== */
let playerId = genId();
let roomCode = null;

/* ===== Utils ===== */
function genId() { return Math.random().toString(36).substr(2,5).toUpperCase(); }
function genRoom() { return Math.random().toString(36).substr(2,5).toUpperCase(); }

/* ===== Screen Navigation ===== */
function showCreate() {
  document.getElementById("welcome").classList.add("hidden");
  document.getElementById("createForm").classList.remove("hidden");
}
function showJoin() {
  document.getElementById("welcome").classList.add("hidden");
  document.getElementById("joinForm").classList.remove("hidden");
}
function goBack() {
  document.querySelectorAll(".screen").forEach(el => el.classList.add("hidden"));
  document.getElementById("welcome").classList.remove("hidden");
}

/* ===== Create / Join ===== */
function createRoom() {
  let nick = document.getElementById("createName").value || playerId;
  let points = parseInt(document.getElementById("createPoints").value) || 21;
  roomCode = genRoom();
  db.ref(`rooms/${roomCode}`).set({
    players: {
      [playerId]: { name: nick, ready: false }
    },
    started: false,
    startPoints: points
  });
  listenRoom();
}

function joinRoom() {
  let nick = document.getElementById("joinName").value || playerId;
  roomCode = document.getElementById("joinCode").value.trim().toUpperCase();
  db.ref(`rooms/${roomCode}/players/${playerId}`).set({
    name: nick, ready: false
  });
  listenRoom();
}

/* ===== Lobby listener ===== */
function listenRoom() {
  document.querySelectorAll(".screen").forEach(el => el.classList.add("hidden"));
  document.getElementById("lobby").classList.remove("hidden");

  db.ref(`rooms/${roomCode}`).on("value", snap => {
    if (!snap.exists()) return;
    let data = snap.val();
    renderLobby(data);
    if (data.started) {
      document.body.innerHTML = "<h2>La partie commence !</h2>";
      // redirect to game.html if needed
    }
  });
}

/* ===== Render lobby ===== */
function renderLobby(data) {
  let div = document.getElementById("lobby");
  let html = `<h2>Salle ${roomCode}</h2><ul>`;
  for (let pid in data.players) {
    let p = data.players[pid];
    html += `<li>
      ${p.name} - <span style="color:${p.ready?'green':'red'}">${p.ready?'Prêt':'Pas prêt'}</span>
    </li>`;
  }
  html += `</ul>`;

  if (data.players[playerId]) {
    let meReady = data.players[playerId].ready;
    html += `<button onclick="toggleReady()">${meReady?'Annuler prêt':'Prêt'}</button>`;
  }

  div.innerHTML = html;

  // check if all ready
  let allReady = Object.values(data.players).every(p => p.ready);
  if (allReady && Object.keys(data.players).length > 1) {
    db.ref(`rooms/${roomCode}/started`).set(true);
  }
}

/* ===== Actions ===== */
function toggleReady() {
  db.ref(`rooms/${roomCode}/players/${playerId}/ready`).once("value").then(snap => {
    let ready = snap.val();
    db.ref(`rooms/${roomCode}/players/${playerId}/ready`).set(!ready);
  });
}