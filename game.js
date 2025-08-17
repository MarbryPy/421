// --- Firebase init ---
const firebaseConfig = {
  apiKey: "XXX",
  authDomain: "XXX.firebaseapp.com",
  databaseURL: "https://XXX-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "XXX",
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// --- Elements ---
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
};

// --- Utils ---
function randDie(){
  const a=new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0]%6)+1;
}
function showToast(msg){
  const t=document.getElementById("toast");
  t.textContent=msg;
  t.style.display="block";
  setTimeout(()=>t.style.display="none",2000);
}

// --- Game state ---
let roomId=null;
let seat=null;

el.createBtn.onclick=async ()=>{
  const code=Math.random().toString(36).substr(2,5).toUpperCase();
  await db.ref("rooms/"+code).set({created:Date.now()});
  roomId=code;
  el.roomCode.textContent=code;
  el.lobby.style.display="none";
  el.game.style.display="block";
  showToast("Salle créée: "+code);
};
el.joinBtn.onclick=async ()=>{
  const code=el.roomInput.value.toUpperCase();
  const snap=await db.ref("rooms/"+code).get();
  if(!snap.exists()){ showToast("Salle introuvable"); return;}
  roomId=code;
  el.roomCode.textContent=code;
  el.lobby.style.display="none";
  el.game.style.display="block";
  showToast("Rejoint "+code);
};

// --- Dice actions ---
el.rollBtn.onclick=()=>{
  el.dice.innerHTML="";
  for(let i=0;i<3;i++){
    const v=randDie();
    const d=document.createElement("div");
    d.className="die";
    d.textContent=v;
    el.dice.appendChild(d);
  }
};
el.endTurnBtn.onclick=()=>{
  showToast("Tour terminé");
};