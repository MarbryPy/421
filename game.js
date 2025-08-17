/* ===== Firebase init (compat) ===== */
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

// ------------------ Elements ------------------
const el = {
  createBtn: document.getElementById("createBtn"),
  joinBtn: document.getElementById("joinBtn"),
  displayName: document.getElementById("displayName"),
  roomInput: document.getElementById("roomInput"),
  lobby: document.getElementById("lobby"),
  game: document.getElementById("game"),
  roomCode: document.getElementById("roomCode"),
  dice: document.getElementById("dice"),
  rollBtn: document.getElementById("rollBtn"),
  endTurnBtn: document.getElementById("endTurnBtn"),
  toggleAllBtn: document.getElementById("toggleAllBtn"),
  startBtn: document.getElementById("startBtn"),
  leaveBtn: document.getElementById("leaveBtn"),
  rollsLeft: document.getElementById("rollsLeft"),
  limitRolls: document.getElementById("limitRolls"),
  currentPlayer: document.getElementById("currentPlayer"),
  interBanner: document.getElementById("interBanner"),
  comboHint: document.getElementById("comboHint"),
  log: document.getElementById("log"),
  players: document.getElementById("players"),
  overlay: document.getElementById("overlay"),
  winnerName: document.getElementById("winnerName"),
  finalRanking: document.getElementById("finalRanking"),
  replayBtn: document.getElementById("replayBtn"),
  toast: document.getElementById("toast"),
};

// ------------------ State ------------------
let roomId = null;
let seat = null;
let me = null;

// ------------------ Sounds ------------------
const sounds = {
  roll: new Audio("sounds/roll.mp3"),
  end: new Audio("sounds/endturn.mp3"),
  notify: new Audio("sounds/notify.mp3"),
  win: new Audio("sounds/victory.mp3"),
};
function play(name) { try { sounds[name].currentTime=0; sounds[name].play(); } catch{} }

// ------------------ Utils ------------------
function randDie() { const a=new Uint32Array(1); crypto.getRandomValues(a); return (a[0]%6)+1; }
function showToast(msg){ el.toast.textContent=msg; el.toast.style.display="block"; setTimeout(()=>el.toast.style.display="none",2000);}
function joinedSeats(room){ return Object.keys(room.players||{}).map(Number); }

// ------------------ Combos ------------------
function rankHand(dice){
  const d=[...dice].sort((a,b)=>b-a); const str=d.join("");
  if(str==="421") return {label:"421",cat:"421",order:100,score:10};
  if(str==="111") return {label:"111",cat:"111",order:90,score:7};
  if(d[0]===1&&d[1]===1) return {label:`11${d[2]}`,cat:"11x",order:80,score:d[2]};
  if(d[0]===d[1]&&d[1]===d[2]) return {label:`Brelan ${d[0]}`,cat:"brelan",order:70,score:d[0]};
  if(d[0]-1===d[1]&&d[1]-1===d[2]) return {label:`Suite ${d.join("-")}`,cat:"suite",order:60,score:d[0]};
  if(d[0]===d[1]) return {label:`Paire ${d[0]}+${d[2]}`,cat:"paire",order:50,score:d[0]};
  if(d[1]===d[2]) return {label:`Paire ${d[1]}+${d[0]}`,cat:"paire",order:50,score:d[1]};
  return {label:`Haute ${d.join("")}`,cat:"haute",order:10,score:d[0]};
}
function winnerPoints(r){
  if(r.cat==="421")return 10;
  if(r.cat==="111")return 7;
  if(r.cat==="11x")return r.score;
  if(r.cat==="brelan")return r.score;
  if(r.cat==="suite")return 2;
  if(r.cat==="paire")return 1;
  return 1;
}
function betterHand(a,b){
  const pa=winnerPoints(a),pb=winnerPoints(b);
  if(pa!==pb)return pb-pa;
  if(a.cat==="11x"&&b.cat!=="11x")return -1;
  if(b.cat==="11x"&&a.cat!=="11x")return 1;
  return (b.order-a.order)||(b.score-a.score);
}

// ------------------ DB ------------------
function UPDATE(obj){ return db.ref("rooms/"+roomId).update(obj); }
async function safeUpdate(obj){ await UPDATE(obj); }

// ------------------ Render ------------------
function render(room){
  if(!room)return; me=room.players?.[seat];
  el.rollsLeft.textContent=me?.rollsLeft??"-";
  el.limitRolls.textContent=room.limitRolls??"3";
  el.currentPlayer.textContent=(room.players?.[room.current]?.name)||"—";
  // Dice
  el.dice.innerHTML="";
  (me?.dice||[1,1,1]).forEach((v,i)=>{
    const d=document.createElement("div");
    d.className="die"+((me?.roll?.[i])?" selected":"");
    d.textContent=v;
    d.onclick=()=>{
      if(me?.rollsLeft>0&&!me?.done){
        const r=[...(me.roll||[])]; r[i]=!r[i];
        safeUpdate({[`players/${seat}/roll`]:r});
      }
    };
    el.dice.appendChild(d);
  });
  if(me){ const rank=rankHand(me.dice); el.comboHint.textContent=`${rank.label} — ${winnerPoints(rank)} pt${winnerPoints(rank)>1?"s":""}`; }
  // Players
  el.players.innerHTML="";
  for(const [s,p] of Object.entries(room.players||{})){
    const div=document.createElement("div");
    div.className="player";
    div.innerHTML=`<b>${p.name}</b><br/>Score: ${p.score}<br/>${p.done?"✔️":"⏳"}`;
    el.players.appendChild(div);
  }
  // Log
  el.log.style.display="block";
  el.players.style.display="flex";
}

// ------------------ Main Flow ------------------
el.createBtn.onclick=async()=>{
  const code=Math.random().toString(36).substr(2,5).toUpperCase();
  roomId=code; const name=el.displayName.value||"Joueur";
  await db.ref("rooms/"+code).set({created:Date.now(),players:{},limitRolls:3,ranking:[]});
  seat=0;
  await db.ref(`rooms/${code}/players/${seat}`).set({name,dice:[1,1,1],roll:[true,true,true],rollsLeft:3,done:false,score:10});
  el.roomCode.textContent=code; el.lobby.style.display="none"; el.game.style.display="block";
};
el.joinBtn.onclick=async()=>{
  const code=el.roomInput.value.toUpperCase(); const snap=await db.ref("rooms/"+code).get();
  if(!snap.exists())return showToast("Salle introuvable");
  roomId=code; const name=el.displayName.value||"Joueur"; const room=snap.val();
  seat=joinedSeats(room).length;
  await db.ref(`rooms/${code}/players/${seat}`).set({name,dice:[1,1,1],roll:[true,true,true],rollsLeft:3,done:false,score:10});
  el.roomCode.textContent=code; el.lobby.style.display="none"; el.game.style.display="block";
};

db.ref("rooms").on("value",snap=>{
  const room=snap.val()?.[roomId]; if(!room)return;
  render(room);
  checkEnd(room);
});

// ------------------ Actions ------------------
el.rollBtn.onclick=async()=>{
  if(!me||me.done||me.rollsLeft<=0)return;
  play("roll");
  const dice=me.dice.map((v,i)=>me.roll[i]?randDie():v);
  const rank=rankHand(dice);
  const newLeft=me.rollsLeft-1;
  await safeUpdate({
    [`players/${seat}/dice`]:dice,
    [`players/${seat}/rollsLeft`]:newLeft,
    [`players/${seat}/lastRank`]:rank,
    [`players/${seat}/roll`]:[false,false,false],
  });
  if(newLeft===0) await endTurn();
};
el.endTurnBtn.onclick=endTurn;
async function endTurn(){
  if(!me||me.done)return;
  play("end");
  const r=rankHand(me.dice);
  await safeUpdate({[`players/${seat}/done`]:true,[`players/${seat}/lastRank`]:r});
  checkSettle();
}
async function checkSettle(){
  const snap=await db.ref("rooms/"+roomId).get(); const room=snap.val(); if(!room)return;
  const seats=joinedSeats(room); if(seats.length<2)return;
  if(!seats.every(i=>room.players[i]?.done))return;
  // settle
  const ranked=seats.map(i=>({i,r:room.players[i].lastRank})).sort((a,b)=>betterHand(a.r,b.r));
  const best=ranked[0],worst=ranked[ranked.length-1]; const amount=winnerPoints(best.r);
  const pay=Math.min(room.players[best.i].score,amount);
  room.players[best.i].score-=pay; room.players[worst.i].score+=pay;
  el.log.innerHTML=`<div>${room.players[best.i].name} (${best.r.label}) fait payer ${pay} à ${room.players[worst.i].name} (${worst.r.label})</div>`+el.log.innerHTML;
  for(const i of seats){ room.players[i].done=false; room.players[i].rollsLeft=3; room.players[i].roll=[true,true,true]; }
  await db.ref("rooms/"+roomId).set(room);
}
function checkEnd(room){
  const alive=joinedSeats(room).filter(i=>room.players[i].score>0);
  if(alive.length<=1){
    play("win");
    const ranking=[...room.ranking];
    const losers=joinedSeats(room).filter(i=>!alive.includes(i));
    losers.forEach(i=>{ if(!ranking.includes(room.players[i].name)) ranking.push(room.players[i].name); });
    if(alive[0]!=null) ranking.unshift(room.players[alive[0]].name);
    el.winnerName.textContent=ranking[0];
    el.finalRanking.innerHTML=ranking.map((n,i)=>`${i+1}. ${n}`).join("<br/>");
    el.overlay.style.display="flex";
  }
}