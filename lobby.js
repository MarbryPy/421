document.addEventListener('DOMContentLoaded', () => {
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
  if (!firebase.apps?.length) firebase.initializeApp(cfg);
  const db=firebase.database();

  /* Shortcuts */
  const $=s=>document.querySelector(s);
  const show=id=>{ ['welcome','create','join','lobby'].forEach(x=>$('#'+x).classList.add('hidden')); $('#'+id).classList.remove('hidden'); };

  /* State */
  let roomCode=null;
  let pid=localStorage.getItem('r421_pid')||(Math.random().toString(36).slice(2,10));
  localStorage.setItem('r421_pid',pid);
  let isOwner=false;

  /* Bind UI nav */
  $('#gotoCreate').addEventListener('click', ()=>show('create'));
  $('#gotoJoin').addEventListener('click',   ()=>show('join'));
  $('#back1').addEventListener('click',      ()=>show('welcome'));
  $('#back2').addEventListener('click',      ()=>show('welcome'));

  /* Create room */
  $('#createBtn').addEventListener('click', async ()=>{
    try{
      $('#createBtn').disabled=true;
      const name=($('#c_name').value||'Joueur').trim();
      const pts = Math.max(1,Math.min(99,parseInt($('#c_points').value||'21',10)));
      roomCode=(Math.random().toString(36).slice(2,7)).toUpperCase();
      isOwner=true;

      const init={ createdAt:Date.now(), owner:pid, started:false, startPoints:pts, players:{} };