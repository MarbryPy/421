/* Firebase */
const cfg = {
  apiKey:"AIzaSyB9QKf88f8YS3b8hQ_hbJC4rwre9UYNIUI",
  authDomain:"mon421-a1108.firebaseapp.com",
  databaseURL:"https://mon421-a1108-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:"mon421-a1108",
  storageBucket:"mon421-a1108.appspot.com",
  messagingSenderId:"354289081138",
  appId:"1:354289081138:web:be104504732e1ef984952b"
};
firebase.initializeApp(cfg);
const db=firebase.database();

/* Shortcuts */
const $=s=>document.querySelector(s);
const show=id=>{ ['welcome','create','join','lobby'].forEach(x=>$('#'+x).classList.add('hidden')); $('#'+id).classList.remove('hidden'); };

/* State */
let roomCode=null;
let pid=localStorage.getItem('r421_pid')||(Math.random().toString(36).slice(2,10));
localStorage.setItem('r421_pid',pid);
let isOwner=false;

/* UI nav */
$('#gotoCreate').onclick=()=>show('create');
$('#gotoJoin').onclick =()=>show('join');
$('#back1').onclick=()=>show('welcome');
$('#back2').onclick=()=>show('welcome');

/* Create room */
$('#createBtn').onclick=async ()=>{
  const name=($('#c_name').value||'Joueur').trim();
  const pts = Math.max(1,Math.min(99,parseInt($('#c_points').value||'21',10)));
  roomCode=(Math.random().toString(36).slice(2,7)).toUpperCase();
  isOwner=true;
  const init={
    createdAt:Date.now(), owner:pid, started:false, startPoints:pts,
    players:{}, // map pid -> {name, ready, seat}
  };
  await firebase.database().ref('rooms/'+roomCode).set(init);
  await addPlayer(name);
  enterLobby();
};

/* Join room */
$('#joinBtn').onclick=async ()=>{
  const name=($('#j_name').value||'Joueur').trim();
  const code=($('#j_code').value||'').trim().toUpperCase();
  if(!code){ alert('Code requis'); return; }
  const snap=await db.ref('rooms/'+code).get();
  if(!snap.exists()){ alert('Salle introuvable'); return; }
  roomCode=code;
  isOwner = (snap.val().owner===pid);
  await addPlayer(name);
  enterLobby();
};

/* Add player with dynamic seat */
async function addPlayer(name){
  const roomSnap=await db.ref('rooms/'+roomCode).get(); const room=roomSnap.val();
  // reuse seat if already present
  const already = Object.entries(room.players||{}).find(([,p])=>p.id===pid);
  if(already){ return; }
  // next free seat
  const seats=Object.keys(room.players||{}).map(Number).filter(n=>!Number.isNaN(n));
  let seat=0; while(room.players && room.players[seat]) seat++;
  const player={ id:pid, name, ready:false, seat };
  await db.ref(`rooms/${roomCode}/players/${seat}`).set(player);
}

/* Enter lobby and subscribe */
function enterLobby(){
  $('#roomCode').textContent=roomCode;
  $('#shareCode').textContent=roomCode;
  $('#youAre').textContent=`Tu es: ${pid}${isOwner?' (créateur)':''}`;
  $('#readyBtn').textContent='Je suis prêt';
  $('#hint').textContent='Chaque joueur clique sur "Je suis prêt". Le créateur lance la partie.';
  show('lobby');

  // presence cleanup
  const mySeatRef = db.ref(`rooms/${roomCode}/players`).orderByChild('id').equalTo(pid);
  window.addEventListener('beforeunload', async ()=>{
    const rs=await db.ref('rooms/'+roomCode).get(); if(!rs.exists())return;
    const list=rs.val().players||{};
    const seatKey=Object.keys(list).find(k=>list[k].id===pid);
    if(seatKey && !rs.val().started){ db.ref(`rooms/${roomCode}/players/${seatKey}`).remove(); }
  });

  // listeners
  db.ref('rooms/'+roomCode).on('value', snap=>{
    if(!snap.exists())return;
    const room=snap.val();
    isOwner = (room.owner===pid);
    renderPlayers(room);
    // auto-redirect when started
    if(room.started){
      window.location.href = `game.html?room=${roomCode}&pid=${pid}`;
    }
  });

  // ready toggle
  $('#readyBtn').onclick=async ()=>{
    const rs=await db.ref('rooms/'+roomCode).get(); if(!rs.exists())return;
    const list=rs.val().players||{};
    const seatKey=Object.keys(list).find(k=>list[k].id===pid);
    if(!seatKey) return;
    const cur=list[seatKey].ready===true;
    await db.ref(`rooms/${roomCode}/players/${seatKey}/ready`).set(!cur);
    $('#readyBtn').textContent=cur?'Je suis prêt':'Annuler prêt';
  };

  // owner start
  $('#startGameBtn').onclick=async ()=>{
    const rs=await db.ref('rooms/'+roomCode).get(); if(!rs.exists())return;
    const room=rs.val();
    if(room.owner!==pid) return;
    const playersArr=Object.values(room.players||{});
    const allReady = playersArr.length>=2 && playersArr.every(p=>p.ready===true);
    if(!allReady){ alert('Tous les joueurs ne sont pas prêts (min 2).'); return; }
    await db.ref('rooms/'+roomCode+'/started').set(true);
  };
}

/* Render lobby list and start-button state */
function renderPlayers(room){
  const ul=$('#players'); ul.innerHTML='';
  const list=Object.values(room.players||{}).sort((a,b)=>a.seat-b.seat);
  list.forEach(p=>{
    const li=document.createElement('li');
    const st = p.ready ? 'green' : 'red';
    li.innerHTML = `<span>J${(p.seat??0)+1} • ${p.name}</span><span class="status ${st}">${p.ready?'Prêt':'Pas prêt'}</span>`;
    ul.appendChild(li);
  });

  // owner-only start button visibility + enabled state
  $('#startGameBtn').style.display = (room.owner===pid) ? 'inline-block' : 'none';
  const allReady = list.length>=2 && list.every(p=>p.ready===true);
  $('#startGameBtn').disabled = !allReady;
}
```0