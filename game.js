// ===== Firebase config =====
const firebaseConfig = {
  apiKey: "AIzaSyB9QKf88f8YS3b8hQ_hbJC4rwre9UYNIUI",
  authDomain: "mon421-a1108.firebaseapp.com",
  databaseURL: "https://mon421-a1108-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "mon421-a1108",
  storageBucket: "mon421-a1108.appspot.com",
  messagingSenderId: "354289081138",
  appId: "1:354289081138:web:be104504732e1ef984952b"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ===== Elements =====
const el = {
  lobby: document.getElementById("lobby"),
  game: document.getElementById("game"),
  createBtn: document.getElementById("createBtn"),
  joinBtn: document.getElementById("joinBtn"),
  displayName: document.getElementById("displayName"),
  roomInput: document.getElementById("roomInput"),
  roomCode: document.getElementById("roomCode"),
  players: document.getElementById("players"),
  currentPlayer: document.getElementById("currentPlayer"),
  dice: document.getElementById("dice"),
  comboHint: document.getElementById("comboHint"),
  rollBtn: document.getElementById("rollBtn"),
  endTurnBtn: document.getElementById("endTurnBtn"),
  rollsLeft: document.getElementById("rollsLeft"),
  log: document.getElementById("log"),
  overlay: document.getElementById("overlay"),
  winnerName: document.getElementById("winnerName"),
  finalRanking: document.getElementById("finalRanking"),
  replayBtn: document.getElementById("replayBtn"),
  toast: document.getElementById("toast"),
};

// ===== State =====
let roomId=null, seat=null, me=null;

// ===== Utils =====
function randDie(){const a=new Uint32Array(1);crypto.getRandomValues(a);return (a[0]%6)+1;}
function showToast(msg){el.toast.textContent=msg;el.toast.style.display="block";setTimeout(()=>el.toast.style.display="none",2000);}
function joinedSeats(room){return Object.keys(room.players||{}).map(Number);}

// ===== Combos =====
function rankHand(d){
  const s=[...d].sort((a,b)=>b-a); const str=s.join("");
  if(str==="421") return {label:"421",cat:"421",score:10};
  if(str==="111") return {label:"111",cat:"111",score:7};
  if(s[0]===1&&s[1]===1) return {label:`11${s[2]}`,cat:"11x",score:s[2]};
  if(s[0]===s[1]&&s[1]===s[2]) return {label:`Brelan ${s[0]}`,cat:"brelan",score:s[0]};
  if(s[0]-1===s[1]&&s[1]-1===s[2]) return {label:`Suite ${s.join("-")}`,cat:"suite",score:2};
  if(s[0]===s[1]||s[1]===s[2]) return {label:"Paire",cat:"paire",score:1};
  return {label:`Haute ${s[0]}`,cat:"haute",score:1};
}
function betterHand(a,b){
  if(a.score!==b.score) return b.score-a.score;
  if(a.cat==="11x" && b.cat!=="11x") return -1;
  if(b.cat==="11x" && a.cat!=="11x") return 1;
  return 0;
}

// ===== DB =====
function UPDATE(obj){return db.ref("rooms/"+roomId).update(obj);}

// ===== Render =====
function render(room){
  if(!room) return;
  me=room.players?.[seat];
  el.players.innerHTML="";
  for(const [i,p] of Object.entries(room.players||{})){
    const div=document.createElement("div");
    div.className="player";
    div.innerHTML=`<b>${p.name}</b><br/>Score: ${p.score}`;
    el.players.appendChild(div);
  }
  el.currentPlayer.textContent=(room.players?.[room.current]?.name)||"—";
  el.dice.innerHTML="";
  (me?.dice||[1,1,1]).forEach((v,i)=>{
    const d=document.createElement("div");
    d.className="die"+((me?.roll?.[i])?" selected":"");
    d.textContent=v;
    d.onclick=()=>{
      if(me?.rollsLeft>0&&!me?.done){
        const r=[...(me.roll||[])];r[i]=!r[i];
        UPDATE({[`players/${seat}/roll`]:r});
      }
    };
    el.dice.appendChild(d);
  });
  if(me){
    const rank=rankHand(me.dice);
    el.comboHint.textContent=`${rank.label} — ${rank.score} pts`;
    el.rollsLeft.textContent=me.rollsLeft;
  }
}

// ===== Actions =====
el.createBtn.onclick=async()=>{
  const code=Math.random().toString(36).substr(2,5).toUpperCase();
  roomId=code; seat=0;
  await db.ref("rooms/"+code).set({created:Date.now(),players:{}});
  await db.ref(`rooms/${code}/players/${seat}`).set({name:el.displayName.value||"Joueur",dice:[1,1,1],roll:[true,true,true],rollsLeft:3,done:false,score:10});
  el.roomCode.textContent=code; el.lobby.style.display="none"; el.game.style.display="block";
};
el.joinBtn.onclick=async()=>{
  const code=el.roomInput.value.toUpperCase(); const snap=await db.ref("rooms/"+code).get();
  if(!snap.exists()) return showToast("Salle introuvable");
  roomId=code; const room=snap.val(); seat=joinedSeats(room).length;
  await db.ref(`rooms/${code}/players/${seat}`).set({name:el.displayName.value||"Joueur",dice:[1,1,1],roll:[true,true,true],rollsLeft:3,done:false,score:10});
  el.roomCode.textContent=code; el.lobby.style.display="none"; el.game.style.display="block";
};
db.ref("rooms").on("value",snap=>{const room=snap.val()?.[roomId];if(room)render(room);});

el.rollBtn.onclick=async()=>{
  if(!me||me.done||me.rollsLeft<=0) return;
  const dice=me.dice.map((v,i)=>me.roll[i]?randDie():v);
  const rank=rankHand(dice); const newLeft=me.rollsLeft-1;
  await UPDATE({[`players/${seat}/dice`]:dice,[`players/${seat}/rollsLeft`]:newLeft,[`players/${seat}/lastRank`]:rank,[`players/${seat}/roll`]:[false,false,false]});
  if(newLeft===0) endTurn();
};
el.endTurnBtn.onclick=endTurn;
async function endTurn(){
  if(!me||me.done) return;
  const r=rankHand(me.dice);
  await UPDATE({[`players/${seat}/done`]:true,[`players/${seat}/lastRank`]:r});
  settle();
}
async function settle(){
  const snap=await db.ref("rooms/"+roomId).get();const room=snap.val();if(!room)return;
  const seats=joinedSeats(room); if(!seats.every(i=>room.players[i]?.done)) return;
  const ranked=seats.map(i=>({i,r:room.players[i].lastRank})).sort((a,b)=>betterHand(a.r,b.r));
  const best=ranked[0],worst=ranked[ranked.length-1],pay=best.r.score;
  room.players[best.i].score-=pay; room.players[worst.i].score+=pay;
  el.log.innerHTML=`<div>${room.players[best.i].name} (${best.r.label}) fait payer ${pay} à ${room.players[worst.i].name} (${worst.r.label})</div>`+el.log.innerHTML;
  for(const i of seats){room.players[i].done=false;room.players[i].rollsLeft=3;room.players[i].roll=[true,true,true];}
  await db.ref("rooms/"+roomId).set(room);
}