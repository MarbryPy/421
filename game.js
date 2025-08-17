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

/* ===== Variables globales ===== */
let playerId = null;
let roomCode = null;
let localPlayer = null;
let players = {};
let currentTurn = 0;
let rollsLeft = 3;
let dice = [1, 1, 1];
let selected = [false, false, false];

/* ===== Helpers DB ===== */
function set(path, value) {
  db.ref(path).set(value);
}
function update(path, value) {
  db.ref(path).update(value);
}

/* ===== Init ===== */
document.getElementById("createBtn").onclick = () => {
  playerId = genId();
  roomCode = genRoom();
  initRoom();
};
document.getElementById("joinBtn").onclick = () => {
  playerId = genId();
  roomCode = document.getElementById("roomCode").value.trim().toUpperCase();
  joinRoom();
};

function genId() {
  return Math.random().toString(36).substr(2, 5).toUpperCase();
}
function genRoom() {
  return Math.random().toString(36).substr(2, 5).toUpperCase();
}

/* ===== Création / rejoindre ===== */
function initRoom() {
  let nick = document.getElementById("nick").value || playerId;
  set(`rooms/${roomCode}`, {
    players: {
      [playerId]: { name: nick, score: 21, dice: [1,1,1], done: false, rank: null }
    },
    order: [playerId],
    turn: 0,
    status: "waiting"
  });
  listenRoom();
  showRoom();
}

function joinRoom() {
  let nick = document.getElementById("nick").value || playerId;
  db.ref(`rooms/${roomCode}/players/${playerId}`).set({
    name: nick, score: 21, dice: [1,1,1], done: false, rank: null
  });
  db.ref(`rooms/${roomCode}/order`).once("value").then(snap => {
    let order = snap.val() || [];
    order.push(playerId);
    set(`rooms/${roomCode}/order`, order);
  });
  listenRoom();
  showRoom();
}

function showRoom() {
  document.body.innerHTML = `<h2>Salle ${roomCode}</h2>
    <div id="gameArea"></div>`;
}

/* ===== Listener principal ===== */
function listenRoom() {
  db.ref(`rooms/${roomCode}`).on("value", snap => {
    if (!snap.exists()) return;
    let data = snap.val();
    players = data.players || {};
    currentTurn = data.turn || 0;

    render(data);
  });
}

/* ===== Rendu ===== */
function render(data) {
  let area = document.getElementById("gameArea");
  if (!area) return;

  let turnPlayerId = data.order[data.turn % data.order.length];
  let turnPlayer = players[turnPlayerId];

  let me = players[playerId];
  let html = `<p>Tour de : <b>${turnPlayer.name}</b></p>`;
  html += `<p>Lancers restants : ${rollsLeft}</p>`;

  // Affichage dés
  if (me) {
    html += `<div id="diceArea">`;
    dice.forEach((d, i) => {
      html += `<button onclick="toggle(${i})" style="margin:4px;${selected[i]?'background:#ccc':''}">${d}</button>`;
    });
    html += `</div>`;
  }

  // Boutons d'action
  if (turnPlayerId === playerId) {
    html += `<button onclick="roll()">Lancer</button>
             <button onclick="endTurn()">Finir le tour</button>`;
  }

  // Scores
  html += `<h3>Scores</h3><ul>`;
  for (let pid in players) {
    html += `<li>${players[pid].name}: ${players[pid].score} pts</li>`;
  }
  html += `</ul>`;

  area.innerHTML = html;
}

/* ===== Dés ===== */
function toggle(i) {
  selected[i] = !selected[i];
  render({turn:currentTurn, order:Object.keys(players)}); // refresh UI
}

function roll() {
  if (rollsLeft <= 0) return;
  for (let i=0;i<3;i++) {
    if (selected[i]) dice[i] = 1 + Math.floor(Math.random()*6);
  }
  rollsLeft--;
  update(`rooms/${roomCode}/players/${playerId}`, { dice: dice });
}

function endTurn() {
  update(`rooms/${roomCode}/players/${playerId}`, { done: true, dice: dice });
  rollsLeft = 3;
  selected = [false,false,false];

  // vérifier si tous les joueurs ont joué
  db.ref(`rooms/${roomCode}/players`).once("value").then(snap => {
    let all = snap.val();
    let allDone = Object.values(all).every(p => p.done);
    if (allDone) {
      settle(all);
    } else {
      nextTurn();
    }
  });
}

function nextTurn() {
  db.ref(`rooms/${roomCode}/turn`).transaction(n => (n||0)+1);
}

function settle(all) {
  // calculer main gagnante
  let best = null;
  let bestId = null;
  for (let pid in all) {
    let val = handValue(all[pid].dice);
    if (!best || val > best) {
      best = val;
      bestId = pid;
    }
  }

  // le perdant paye ?
  for (let pid in all) {
    if (pid !== bestId) {
      all[pid].score -= best;
      if (all[pid].score <= 0) {
        all[pid].rank = Object.keys(all).length; // dernier
      }
    }
    all[pid].done = false;
  }

  update(`rooms/${roomCode}/players`, all);
  db.ref(`rooms/${roomCode}/turn`).set(0);
}

function handValue(dice) {
  // ordre spécial du 421
  let s = dice.slice().sort((a,b)=>b-a).join("");
  if (s==="421") return 50;
  if (s==="111") return 40;
  if (s==="666") return 36;
  if (s==="555") return 30;
  if (s==="444") return 24;
  if (s==="333") return 18;
  if (s==="222") return 12;
  return dice.reduce((a,b)=>a+b,0);
}