(function (root) {
  'use strict';

  const DIE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  function asArray(value) {
    if (Array.isArray(value)) return value.slice();
    if (!value || typeof value !== 'object') return [];
    return Object.keys(value).sort((a, b) => Number(a) - Number(b)).map(key => value[key]);
  }

  function analyseHand(rawDice) {
    const dice = asArray(rawDice).map(Number).sort((a, b) => b - a);
    const key = dice.join('');
    const counts = {};
    dice.forEach(value => { counts[value] = (counts[value] || 0) + 1; });
    const groups = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0]);

    if (key === '421') return { strength: 900, penalty: 8, label: '421' };
    if (key === '111') return { strength: 800, penalty: 7, label: 'Brelan d’as' };
    if (groups[0] && groups[0][1] === 3) {
      const value = Number(groups[0][0]);
      return { strength: 700 + value, penalty: value, label: `Brelan de ${value}` };
    }
    if (key === '654' || key === '543' || key === '432' || key === '321') {
      return { strength: 600 + dice[0], penalty: 2, label: `Suite ${key}` };
    }
    if (groups[0] && groups[0][1] === 2) {
      const pair = Number(groups[0][0]);
      const kicker = Number(groups[1][0]);
      return { strength: 500 + pair * 10 + kicker, penalty: 2, label: `Paire de ${pair}` };
    }
    const total = dice.reduce((sum, value) => sum + value, 0);
    return { strength: total, penalty: 1, label: `${total} points` };
  }

  function activeIds(room) {
    return asArray(room.order).filter(id => room.players && room.players[id] && Number(room.players[id].score) > 0);
  }

  function nextPlayableIndex(room, fromIndex) {
    const order = asArray(room.order);
    for (let offset = 1; offset <= order.length; offset += 1) {
      const index = (Number(fromIndex || 0) + offset) % order.length;
      const id = order[index];
      if (room.players[id] && Number(room.players[id].score) > 0 && !(room.roundHands || {})[id]) return index;
    }
    return -1;
  }

  function appendLog(room, message) {
    const log = asArray(room.log);
    log.push({ message, at: Date.now() });
    room.log = log.slice(-20);
  }

  function settleRound(room) {
    const hands = room.roundHands || {};
    const ids = Object.keys(hands).filter(id => room.players[id]);
    if (!ids.length) return room;

    const analysed = ids.map(id => ({ id, hand: analyseHand(hands[id].dice) }));
    const bestStrength = Math.max(...analysed.map(item => item.hand.strength));
    const weakestStrength = Math.min(...analysed.map(item => item.hand.strength));
    const best = analysed.filter(item => item.hand.strength === bestStrength);
    const weakest = analysed.filter(item => item.hand.strength === weakestStrength);
    const penalty = Math.max(...best.map(item => item.hand.penalty));
    const bestNames = best.map(item => room.players[item.id].name).join(', ');

    weakest.forEach(item => {
      const player = room.players[item.id];
      player.score = Math.max(0, Number(player.score) - penalty);
    });

    const weakNames = weakest.map(item => room.players[item.id].name).join(', ');
    appendLog(room, `${bestNames} remporte la manche. ${weakNames} perd ${penalty} jeton${penalty > 1 ? 's' : ''}.`);

    const survivors = activeIds(room);
    if (survivors.length <= 1) {
      room.status = 'finished';
      room.winnerId = survivors[0] || best[0].id;
      room.finishedAt = Date.now();
      room.turn = null;
      appendLog(room, `${room.players[room.winnerId].name} gagne la partie !`);
      return room;
    }

    const order = asArray(room.order);
    const previousStart = Number(room.roundStartIndex || 0);
    let nextStart = previousStart;
    for (let offset = 1; offset <= order.length; offset += 1) {
      const candidate = (previousStart + offset) % order.length;
      if (room.players[order[candidate]] && Number(room.players[order[candidate]].score) > 0) {
        nextStart = candidate;
        break;
      }
    }
    room.roundNumber = Number(room.roundNumber || 1) + 1;
    room.roundStartIndex = nextStart;
    room.roundHands = {};
    room.turn = { index: nextStart, dice: [1, 1, 1], rollsLeft: 3, nonce: Number(room.turnNonce || 0) + 1 };
    room.turnNonce = room.turn.nonce;
    return room;
  }

  function createController(options) {
    const { db, roomCode, playerId, getRoom, onError } = options;
    const roomRef = db.ref(`rooms/${roomCode}`);
    let held = [false, false, false];
    let seenNonce = null;

    function fail(message) {
      if (onError) onError(message);
    }

    async function mutate(mutator) {
      let reason = '';
      try {
        let result = { committed: false };
        for (let attempt = 0; attempt < 3 && !result.committed; attempt += 1) {
          const prefetchedRoom = attempt === 0 ? getRoom() : (await roomRef.once('value')).val();
          const seed = prefetchedRoom ? JSON.parse(JSON.stringify(prefetchedRoom)) : null;
          let usedPrefetchedRoom = false;
          result = await roomRef.transaction(room => {
            if (!room && seed && !usedPrefetchedRoom) {
              room = JSON.parse(JSON.stringify(seed));
              usedPrefetchedRoom = true;
            }
            if (!room) { reason = 'Ce salon n’existe plus.'; return; }
            const outcome = mutator(room);
            if (typeof outcome === 'string') { reason = outcome; return; }
            room.updatedAt = Date.now();
            return room;
          });
        }
        if (!result.committed && reason) fail(reason);
        return result.committed;
      } catch (error) {
        console.error(error);
        fail('La synchronisation a échoué. Réessaie dans un instant.');
        return false;
      }
    }

    function currentPlayerId(room) {
      if (!room || !room.turn) return null;
      return asArray(room.order)[Number(room.turn.index || 0)] || null;
    }

    function syncLocalTurn(room) {
      const nonce = room && room.turn ? room.turn.nonce : null;
      if (nonce !== seenNonce) {
        seenNonce = nonce;
        held = [false, false, false];
      }
    }

    function toggleHold(index) {
      const room = getRoom();
      if (!room || room.status !== 'playing' || currentPlayerId(room) !== playerId) return;
      if (Number(room.turn.rollsLeft) >= 3) return fail('Lance d’abord les trois dés.');
      held[index] = !held[index];
      render(room);
    }

    async function roll() {
      const snapshot = getRoom();
      if (!snapshot || !snapshot.turn) return;
      const nonce = snapshot.turn.nonce;
      const keep = held.slice();
      const randomDice = [0, 0, 0].map(() => 1 + Math.floor(Math.random() * 6));
      const committed = await mutate(room => {
        if (room.status !== 'playing') return 'La partie n’est pas en cours.';
        if (currentPlayerId(room) !== playerId) return 'Ce n’est pas ton tour.';
        if (!room.turn || room.turn.nonce !== nonce) return 'Le tour a déjà avancé.';
        if (Number(room.turn.rollsLeft) <= 0) return 'Tu as utilisé tes trois lancers.';
        const firstRoll = Number(room.turn.rollsLeft) === 3;
        const dice = asArray(room.turn.dice);
        room.turn.dice = dice.map((value, index) => (firstRoll || !keep[index]) ? randomDice[index] : value);
        room.turn.rollsLeft = Number(room.turn.rollsLeft) - 1;
      });
      if (committed && Number(snapshot.turn.rollsLeft) === 3) held = [false, false, false];
    }

    async function endTurn() {
      const snapshot = getRoom();
      const nonce = snapshot && snapshot.turn ? snapshot.turn.nonce : null;
      await mutate(room => {
        if (room.status !== 'playing') return 'La partie n’est pas en cours.';
        if (currentPlayerId(room) !== playerId) return 'Ce n’est pas ton tour.';
        if (!room.turn || room.turn.nonce !== nonce) return 'Le tour a déjà avancé.';
        if (Number(room.turn.rollsLeft) === 3) return 'Lance les dés avant de valider.';

        room.roundHands = room.roundHands || {};
        room.roundHands[playerId] = { dice: asArray(room.turn.dice), at: Date.now() };
        const hand = analyseHand(room.turn.dice);
        appendLog(room, `${room.players[playerId].name} valide ${hand.label}.`);
        const nextIndex = nextPlayableIndex(room, room.turn.index);
        if (nextIndex >= 0) {
          room.turnNonce = Number(room.turnNonce || 0) + 1;
          room.turn = { index: nextIndex, dice: [1, 1, 1], rollsLeft: 3, nonce: room.turnNonce };
        } else {
          settleRound(room);
        }
      });
    }

    function renderDice(room, isMine) {
      const container = document.getElementById('dice');
      container.replaceChildren();
      const rolled = Number(room.turn.rollsLeft) < 3;
      asArray(room.turn.dice).forEach((value, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `die${held[index] ? ' held' : ''}`;
        button.disabled = !isMine || !rolled;
        button.setAttribute('aria-label', `Dé ${index + 1}: ${value}${held[index] ? ', gardé' : ''}`);
        const face = document.createElement('span');
        face.textContent = DIE[Number(value) - 1] || String(value);
        const caption = document.createElement('small');
        caption.textContent = held[index] ? 'Gardé' : (rolled && isMine ? 'Toucher pour garder' : '');
        button.append(face, caption);
        button.addEventListener('click', () => toggleHold(index));
        container.appendChild(button);
      });
    }

    function renderScores(room, targetId) {
      const target = document.getElementById(targetId);
      target.replaceChildren();
      asArray(room.order).forEach(id => {
        const player = room.players[id];
        if (!player) return;
        const row = document.createElement('div');
        row.className = `score-row${id === currentPlayerId(room) ? ' active' : ''}${Number(player.score) <= 0 ? ' eliminated' : ''}`;
        const avatar = document.createElement('span');
        avatar.className = 'player-avatar';
        avatar.textContent = String(player.name || '?').trim().charAt(0).toUpperCase() || '?';
        const name = document.createElement('span');
        name.className = 'player-name';
        name.textContent = `${player.name}${id === playerId ? ' (toi)' : ''}`;
        const score = document.createElement('strong');
        score.textContent = Number(player.score) > 0 ? `${player.score} jeton${Number(player.score) > 1 ? 's' : ''}` : 'Éliminé';
        row.append(avatar, name, score);
        target.appendChild(row);
      });
    }

    function render(room) {
      if (!room || room.status !== 'playing' || !room.turn) return;
      syncLocalTurn(room);
      const turnId = currentPlayerId(room);
      const isMine = turnId === playerId;
      const turnPlayer = room.players[turnId];
      document.getElementById('gameCode').textContent = roomCode;
      document.getElementById('roundNumber').textContent = room.roundNumber || 1;
      document.getElementById('turnMessage').textContent = isMine ? 'À toi de jouer !' : `Tour de ${turnPlayer ? turnPlayer.name : '…'}`;
      const rollsLeft = Number(room.turn.rollsLeft);
      document.getElementById('rollsBadge').textContent = `${rollsLeft} lancer${rollsLeft > 1 ? 's' : ''}`;
      document.getElementById('gameHint').textContent = isMine
        ? (rollsLeft === 3 ? 'Lance les trois dés.' : 'Touche les dés à garder, puis relance ou valide.')
        : 'La partie se met à jour automatiquement.';
      document.getElementById('rollBtn').disabled = !isMine || rollsLeft <= 0;
      document.getElementById('endTurnBtn').disabled = !isMine || rollsLeft === 3;
      document.getElementById('handLabel').textContent = rollsLeft < 3 ? analyseHand(room.turn.dice).label : '';
      renderDice(room, isMine);
      renderScores(room, 'scoreboard');

      const log = document.getElementById('gameLog');
      log.replaceChildren();
      asArray(room.log).slice().reverse().forEach(entry => {
        const item = document.createElement('p');
        item.textContent = entry.message;
        log.appendChild(item);
      });
    }

    document.getElementById('rollBtn').onclick = roll;
    document.getElementById('endTurnBtn').onclick = endTurn;

    return { render, renderScores, roll, endTurn, toggleHold };
  }

  const api = { analyseHand, settleRound, activeIds, asArray, createController };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Game421 = api;
}(typeof window !== 'undefined' ? window : null));
