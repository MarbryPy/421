document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const firebaseConfig = {
    apiKey: 'AIzaSyB9QKf88f8YS3b8hQ_hbJC4rwre9UYNIUI',
    authDomain: 'mon421-a1108.firebaseapp.com',
    databaseURL: 'https://mon421-a1108-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'mon421-a1108',
    storageBucket: 'mon421-a1108.appspot.com',
    messagingSenderId: '354289081138',
    appId: '1:354289081138:web:be104504732e1ef984952b'
  };

  const SESSION_KEY = '421_session_v2';
  const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const screens = ['Welcome', 'Create', 'Join', 'Lobby', 'Game', 'Payout', 'Finished'];
  const $ = id => document.getElementById(id);

  let db;
  let playerId = null;
  let roomCode = null;
  let room = null;
  let roomRef = null;
  let roomListener = null;
  let presenceRef = null;
  let presenceInfoRef = null;
  let presenceListener = null;
  let gameController = null;
  let busy = false;
  let hasConnected = false;
  let activeScreen = null;
  const loadingStartedAt = performance.now();

  function finishLoading() {
    const loader = $('loadingScreen');
    if (!loader || loader.classList.contains('is-leaving')) return;
    const remaining = Math.max(0, 900 - (performance.now() - loadingStartedAt));
    setTimeout(() => {
      loader.classList.add('is-leaving');
      document.body.classList.remove('is-loading');
    }, remaining);
  }

  function randomRoomCode() {
    const values = new Uint32Array(5);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(values);
    else values.forEach((_, index) => { values[index] = Math.floor(Math.random() * ROOM_ALPHABET.length); });
    return Array.from(values, value => ROOM_ALPHABET[value % ROOM_ALPHABET.length]).join('');
  }

  function cleanName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  }

  function showScreen(name) {
    const changed = activeScreen !== name;
    screens.forEach(screen => $(`screen${screen}`).classList.toggle('hidden', screen !== name));
    $('leaveBtn').classList.toggle('hidden', !roomCode || name === 'Welcome' || name === 'Create' || name === 'Join');
    activeScreen = name;
    if (changed) window.scrollTo(0, 0);
  }

  function setBusy(value) {
    busy = value;
    ['createBtn', 'joinBtn', 'readyBtn', 'startGameBtn', 'continueRoundBtn', 'newGameBtn'].forEach(id => {
      if ($(id)) $(id).disabled = value;
    });
  }

  let toastTimer;
  function toast(message, isError = false) {
    const element = $('toast');
    element.textContent = message;
    element.classList.toggle('error-toast', isError);
    element.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('visible'), 3500);
  }

  function errorMessage(error) {
    console.error(error);
    if (!navigator.onLine) return 'Tu sembles hors ligne. Vérifie ta connexion.';
    if (error && error.code === 'PERMISSION_DENIED') return 'Firebase refuse l’accès à ce salon. Vérifie les règles de la base.';
    return 'Une erreur de synchronisation est survenue. Réessaie.';
  }

  function saveSession(name) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, playerId, name }));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function addPlayerRow(list, id, player, ownerId) {
    const item = document.createElement('li');
    item.className = 'player-row';
    const identity = document.createElement('span');
    const dot = document.createElement('i');
    dot.className = `presence ${player.connected ? 'online' : ''}`;
    const label = document.createElement('span');
    label.textContent = `${player.name}${id === playerId ? ' (toi)' : ''}${id === ownerId ? ' · hôte' : ''}`;
    identity.append(dot, label);
    const state = document.createElement('strong');
    state.className = player.ready ? 'ready' : 'muted';
    state.textContent = player.ready ? 'Prêt' : 'Pas prêt';
    item.append(identity, state);
    list.appendChild(item);
  }

  function orderedPlayers(currentRoom) {
    return Game421.asArray(currentRoom.order)
      .filter(id => currentRoom.players && currentRoom.players[id])
      .map(id => [id, currentRoom.players[id]]);
  }

  function renderLobby(currentRoom) {
    showScreen('Lobby');
    $('lobbyCode').textContent = roomCode;
    const list = $('lobbyPlayers');
    list.replaceChildren();
    const players = orderedPlayers(currentRoom);
    players.forEach(([id, player]) => addPlayerRow(list, id, player, currentRoom.ownerId));
    $('playerCount').textContent = players.length;

    const me = currentRoom.players && currentRoom.players[playerId];
    $('readyBtn').textContent = me && me.ready ? 'Je ne suis plus prêt' : 'Je suis prêt';
    $('readyBtn').classList.toggle('secondary', Boolean(me && me.ready));
    $('readyBtn').disabled = busy || !me;

    const isOwner = currentRoom.ownerId === playerId;
    const allReady = players.length >= 2 && players.every(([, player]) => player.ready);
    $('startGameBtn').classList.toggle('hidden', !isOwner);
    $('startGameBtn').disabled = busy || !allReady;
    $('lobbyHint').textContent = players.length < 2
      ? 'Il faut au moins deux joueurs.'
      : (!allReady ? 'Tout le monde doit être prêt.' : (isOwner ? 'Tout est prêt : tu peux lancer la partie.' : 'L’hôte peut lancer la partie.'));
  }

  function renderFinished(currentRoom) {
    showScreen('Finished');
    const loser = currentRoom.players && currentRoom.players[currentRoom.loserId];
    $('winnerMessage').textContent = loser ? `${loser.name} a perdu !` : 'Partie terminée';
    gameController.renderScores(currentRoom, 'finalScores');
    $('newGameBtn').classList.toggle('hidden', currentRoom.ownerId !== playerId);
    $('newGameBtn').disabled = busy;
  }

  function renderRoom(currentRoom) {
    room = currentRoom;
    if (!currentRoom) {
      toast('Ce salon a été fermé.', true);
      detachRoom();
      showScreen('Welcome');
      return;
    }
    if (!currentRoom.players || !currentRoom.players[playerId]) {
      toast('Tu ne fais plus partie de ce salon.', true);
      detachRoom();
      showScreen('Welcome');
      return;
    }
    if (currentRoom.status === 'playing') {
      showScreen('Game');
      gameController.render(currentRoom);
    } else if (currentRoom.status === 'payout') {
      showScreen('Payout');
      gameController.renderPayout(currentRoom);
    } else if (currentRoom.status === 'finished') {
      renderFinished(currentRoom);
    } else {
      renderLobby(currentRoom);
    }
  }

  function configurePresence() {
    if (!roomCode) return;
    presenceRef = db.ref(`rooms/${roomCode}/players/${playerId}/connected`);
    const targetPresenceRef = presenceRef;
    presenceInfoRef = db.ref('.info/connected');
    presenceListener = snapshot => {
      const connected = snapshot.val() === true;
      if (connected) hasConnected = true;
      if (!connected || targetPresenceRef !== presenceRef) return;
      targetPresenceRef.onDisconnect().set(false).then(() => targetPresenceRef.set(true)).catch(console.error);
    };
    presenceInfoRef.on('value', presenceListener);
  }

  function attachRoom(code, name) {
    detachRoom(false);
    roomCode = code;
    roomRef = db.ref(`rooms/${roomCode}`);
    gameController = Game421.createController({
      db,
      roomCode,
      playerId,
      getRoom: () => room,
      onError: message => toast(message, true)
    });
    roomListener = snapshot => renderRoom(snapshot.val());
    roomRef.on('value', roomListener, error => toast(errorMessage(error), true));
    saveSession(name);
    configurePresence();
  }

  function detachRoom(forget = true) {
    if (roomRef && roomListener) roomRef.off('value', roomListener);
    if (presenceInfoRef && presenceListener) presenceInfoRef.off('value', presenceListener);
    if (presenceRef) presenceRef.onDisconnect().cancel().catch(() => {});
    roomRef = null;
    roomListener = null;
    presenceRef = null;
    presenceInfoRef = null;
    presenceListener = null;
    gameController = null;
    room = null;
    roomCode = null;
    if (forget) clearSession();
  }

  async function transactCurrentRoom(mutator) {
    let lastResult = { committed: false };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = attempt === 0 && room ? room : (await roomRef.once('value')).val();
      const prefetchedRoom = snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
      let usedPrefetchedRoom = false;
      lastResult = await roomRef.transaction(current => {
        if (!current && prefetchedRoom && !usedPrefetchedRoom) {
          current = JSON.parse(JSON.stringify(prefetchedRoom));
          usedPrefetchedRoom = true;
        }
        return mutator(current);
      });
      if (lastResult.committed) return lastResult;
    }
    return lastResult;
  }

  async function createRoom() {
    if (busy) return;
    const name = cleanName($('createName').value);
    const startPoints = Math.max(5, Math.min(50, Number.parseInt($('startPoints').value, 10) || 21));
    $('createError').textContent = '';
    if (!name) { $('createError').textContent = 'Choisis un pseudo.'; return; }
    setBusy(true);
    try {
      let createdCode = null;
      for (let attempt = 0; attempt < 6 && !createdCode; attempt += 1) {
        const code = randomRoomCode();
        const ref = db.ref(`rooms/${code}`);
        const result = await ref.transaction(existing => {
          if (existing !== null) return;
          return {
            schemaVersion: 2,
            status: 'lobby',
            ownerId: playerId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            settings: { startPoints },
            players: { [playerId]: { name, ready: false, connected: true, score: startPoints, joinedAt: Date.now() } },
            order: [playerId],
            log: []
          };
        }, undefined, false);
        if (result.committed) createdCode = code;
      }
      if (!createdCode) throw new Error('ROOM_CODE_COLLISIONS');
      attachRoom(createdCode, name);
    } catch (error) {
      $('createError').textContent = errorMessage(error);
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom() {
    if (busy) return;
    const name = cleanName($('joinName').value);
    const code = $('joinCode').value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);
    $('joinError').textContent = '';
    if (!name) { $('joinError').textContent = 'Choisis un pseudo.'; return; }
    if (code.length !== 5) { $('joinError').textContent = 'Le code doit contenir 5 caractères.'; return; }
    setBusy(true);
    let reason = '';
    try {
      const targetRoomRef = db.ref(`rooms/${code}`);
      const existingSnapshot = await targetRoomRef.once('value');
      const existingRoom = existingSnapshot.val();
      if (!existingRoom) { $('joinError').textContent = 'Ce salon est introuvable.'; return; }
      if (existingRoom.schemaVersion !== 2) {
        $('joinError').textContent = 'Ce salon utilise une ancienne version. Demande à l’hôte d’en recréer un.';
        return;
      }
      if (existingRoom.status !== 'lobby') { $('joinError').textContent = 'La partie a déjà commencé.'; return; }

      let usedPrefetchedRoom = false;
      const result = await targetRoomRef.transaction(current => {
        // The web SDK can invoke a transaction with an empty local cache before
        // it receives the server value. Seed that first pass from our confirmed
        // read; later server conflicts still re-run this callback with fresh data.
        if (!current && !usedPrefetchedRoom) {
          current = JSON.parse(JSON.stringify(existingRoom));
          usedPrefetchedRoom = true;
        }
        if (!current) { reason = 'Ce salon est introuvable.'; return; }
        if (current.schemaVersion !== 2) { reason = 'Ce salon utilise une ancienne version. Demande à l’hôte d’en recréer un.'; return; }
        if (current.status !== 'lobby') { reason = 'La partie a déjà commencé.'; return; }
        current.players = current.players || {};
        current.order = Game421.asArray(current.order);
        if (!current.players[playerId] && current.order.length >= 8) { reason = 'Ce salon est complet (8 joueurs).'; return; }
        const startPoints = Number(current.settings && current.settings.startPoints) || 21;
        current.players[playerId] = { name, ready: false, connected: true, score: startPoints, joinedAt: Date.now() };
        if (!current.order.includes(playerId)) current.order.push(playerId);
        current.updatedAt = Date.now();
        return current;
      });
      if (!result.committed) { $('joinError').textContent = reason || 'Impossible de rejoindre ce salon.'; return; }
      attachRoom(code, name);
    } catch (error) {
      $('joinError').textContent = errorMessage(error);
    } finally {
      setBusy(false);
    }
  }

  async function toggleReady() {
    if (!roomRef || busy) return;
    setBusy(true);
    try {
      await transactCurrentRoom(current => {
        if (!current || current.status !== 'lobby' || !current.players[playerId]) return;
        current.players[playerId].ready = !current.players[playerId].ready;
        current.updatedAt = Date.now();
        return current;
      });
    } catch (error) { toast(errorMessage(error), true); }
    finally { setBusy(false); }
  }

  async function startGame() {
    if (!roomRef || busy) return;
    setBusy(true);
    let reason = '';
    try {
      const result = await transactCurrentRoom(current => {
        if (!current || current.status !== 'lobby') return;
        if (current.ownerId !== playerId) { reason = 'Seul l’hôte peut lancer la partie.'; return; }
        const ids = Game421.asArray(current.order).filter(id => current.players[id]);
        if (ids.length < 2 || !ids.every(id => current.players[id].ready)) { reason = 'Tous les joueurs doivent être prêts.'; return; }
        const startPoints = Number(current.settings && current.settings.startPoints) || 21;
        ids.forEach(id => { current.players[id].score = startPoints; });
        current.status = 'playing';
        current.roundNumber = 1;
        current.roundStartIndex = 0;
        current.roundHands = {};
        current.roundResult = null;
        current.winnerId = null;
        current.loserId = null;
        current.turnNonce = Number(current.turnNonce || 0) + 1;
        current.turn = { index: 0, dice: [1, 1, 1], rollsLeft: 3, nonce: current.turnNonce };
        current.log = [{ message: 'La partie commence !', at: Date.now() }];
        current.updatedAt = Date.now();
        return current;
      });
      if (!result.committed && reason) toast(reason, true);
    } catch (error) { toast(errorMessage(error), true); }
    finally { setBusy(false); }
  }

  async function resetGame() {
    if (!roomRef || busy) return;
    setBusy(true);
    let reason = '';
    try {
      const result = await transactCurrentRoom(current => {
        if (!current) return;
        if (current.ownerId !== playerId) { reason = 'Seul l’hôte peut relancer une partie.'; return; }
        const startPoints = Number(current.settings && current.settings.startPoints) || 21;
        Object.values(current.players || {}).forEach(player => { player.ready = false; player.score = startPoints; });
        current.status = 'lobby';
        current.roundHands = null;
        current.roundResult = null;
        current.turn = null;
        current.winnerId = null;
        current.loserId = null;
        current.log = [];
        current.updatedAt = Date.now();
        return current;
      });
      if (!result.committed && reason) toast(reason, true);
    } catch (error) { toast(errorMessage(error), true); }
    finally { setBusy(false); }
  }

  async function leaveRoom() {
    if (!roomRef || busy) return;
    setBusy(true);
    const leavingCode = roomCode;
    try {
      await transactCurrentRoom(current => {
        if (!current || !current.players || !current.players[playerId]) return current;
        const oldOrder = Game421.asArray(current.order);
        const oldTurnId = current.turn ? oldOrder[Number(current.turn.index || 0)] : null;
        delete current.players[playerId];
        current.order = oldOrder.filter(id => id !== playerId && current.players[id]);
        if (!current.order.length) return null;
        if (current.ownerId === playerId) current.ownerId = current.order[0];
        if (current.roundHands) delete current.roundHands[playerId];
        if (current.status === 'playing') {
          const survivors = Game421.activeIds(current);
          if (survivors.length <= 1) {
            current.status = 'finished';
            current.loserId = survivors[0] || current.order[0];
            current.winnerId = null;
            current.turn = null;
          } else if (oldTurnId === playerId) {
            const nextIndex = current.order.findIndex(id => Number(current.players[id].score) > 0 && !(current.roundHands || {})[id]);
            if (nextIndex >= 0) {
              current.turnNonce = Number(current.turnNonce || 0) + 1;
              current.turn = { index: nextIndex, dice: [1, 1, 1], rollsLeft: 3, nonce: current.turnNonce };
            } else {
              Game421.settleRound(current);
            }
          } else if (current.turn) {
            current.turn.index = Math.max(0, current.order.indexOf(oldTurnId));
          }
        }
        current.updatedAt = Date.now();
        return current;
      });
    } catch (error) {
      toast(errorMessage(error), true);
      return;
    } finally {
      setBusy(false);
    }
    detachRoom();
    history.replaceState({}, '', location.pathname);
    showScreen('Welcome');
    toast(`Tu as quitté le salon ${leavingCode}.`);
  }

  async function restoreSession() {
    let session;
    try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (_) { clearSession(); }
    if (!session || !session.roomCode || session.playerId !== playerId) return false;
    try {
      const snapshot = await db.ref(`rooms/${session.roomCode}`).once('value');
      const current = snapshot.val();
      if (!current || !current.players || !current.players[playerId]) { clearSession(); return false; }
      await db.ref(`rooms/${session.roomCode}/players/${playerId}`).update({ connected: true, name: cleanName(session.name) || current.players[playerId].name });
      attachRoom(session.roomCode, session.name);
      return true;
    } catch (error) {
      toast(errorMessage(error), true);
      return false;
    }
  }

  async function copyOrShare(share) {
    const url = `${location.origin}${location.pathname}?room=${roomCode}`;
    try {
      if (share && navigator.share) await navigator.share({ title: 'Partie de 421', text: `Rejoins mon salon 421 : ${roomCode}`, url });
      else {
        await navigator.clipboard.writeText(share ? `${roomCode} — ${url}` : roomCode);
        toast(share ? 'Lien copié !' : 'Code copié !');
      }
    } catch (error) {
      if (error && error.name !== 'AbortError') toast('Impossible de copier automatiquement.', true);
    }
  }

  function bindUi() {
    $('btnGoCreate').onclick = () => showScreen('Create');
    $('btnGoJoin').onclick = () => showScreen('Join');
    $('backFromCreate').onclick = () => showScreen('Welcome');
    $('backFromJoin').onclick = () => showScreen('Welcome');
    $('createBtn').onclick = createRoom;
    $('joinBtn').onclick = joinRoom;
    $('readyBtn').onclick = toggleReady;
    $('startGameBtn').onclick = startGame;
    $('newGameBtn').onclick = resetGame;
    $('backToLobbyBtn').onclick = leaveRoom;
    $('leaveBtn').onclick = leaveRoom;
    $('copyCodeBtn').onclick = () => copyOrShare(false);
    $('shareBtn').onclick = () => copyOrShare(true);
    $('joinCode').addEventListener('input', event => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5); });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      if (!$('screenCreate').classList.contains('hidden')) createRoom();
      if (!$('screenJoin').classList.contains('hidden')) joinRoom();
    });
  }

  async function init() {
    bindUi();
    if (!window.firebase || !firebase.auth || !window.Game421) {
      $('connectionStatus').textContent = 'Application indisponible';
      toast('Les composants du jeu n’ont pas pu charger.', true);
      finishLoading();
      return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      const auth = firebase.auth();
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      const credential = auth.currentUser ? { user: auth.currentUser } : await auth.signInAnonymously();
      playerId = credential.user.uid;
      db = firebase.database();
      db.ref('.info/connected').on('value', snapshot => {
        const online = snapshot.val() === true;
        if (online) hasConnected = true;
        $('connectionStatus').textContent = online ? 'En ligne' : 'Hors ligne — reconnexion…';
        $('connectionStatus').classList.toggle('offline', !online);
      });
      setTimeout(() => {
        if (!hasConnected) toast('La base Firebase ne répond pas. Vérifie qu’elle est active.', true);
      }, 7000);
      const restored = await restoreSession();
      if (!restored) {
        const invitedRoom = new URLSearchParams(location.search).get('room');
        if (invitedRoom) {
          $('joinCode').value = invitedRoom.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);
          showScreen('Join');
        } else showScreen('Welcome');
      }
      finishLoading();
    } catch (error) {
      $('connectionStatus').textContent = 'Connexion impossible';
      toast(errorMessage(error), true);
      showScreen('Welcome');
      finishLoading();
    }
  }

  init();
});
