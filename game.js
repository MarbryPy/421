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

    const analysed = ids.map(id => ({ id, dice: asArray(hands[id].dice), hand: analyseHand(hands[id].dice) }));
    const bestStrength = Math.max(...analysed.map(item => item.hand.strength));
    const weakestStrength = Math.min(...analysed.map(item => item.hand.strength));
    const best = analysed.filter(item => item.hand.strength === bestStrength);
    const weakest = analysed.filter(item => item.hand.strength === weakestStrength);
    const penalty = Math.max(...best.map(item => item.hand.penalty));
    const bestNames = best.map(item => room.players[item.id].name).join(', ');
    const transfers = [];
    const scoresBefore = Object.fromEntries(ids.map(id => [id, Number(room.players[id].score)]));

    if (bestStrength !== weakestStrength) {
      best.forEach((item, winnerIndex) => {
        const winner = room.players[item.id];
        const paid = Math.min(Number(winner.score), penalty);
        winner.score = Number(winner.score) - paid;
        for (let chip = 0; chip < paid; chip += 1) {
          const loser = weakest[(chip + winnerIndex) % weakest.length];
          room.players[loser.id].score = Number(room.players[loser.id].score) + 1;
          let transfer = transfers.find(entry => entry.from === item.id && entry.to === loser.id);
          if (!transfer) {
            transfer = { from: item.id, to: loser.id, amount: 0 };
            transfers.push(transfer);
          }
          transfer.amount += 1;
        }
      });
    }

    const weakNames = weakest.map(item => room.players[item.id].name).join(', ');
    appendLog(room, bestStrength === weakestStrength
      ? 'Manche nulle : aucun jeton ne bouge.'
      : `${bestNames} remporte la manche et donne ${penalty} jeton${penalty > 1 ? 's' : ''} à ${weakNames}.`);

    const survivors = activeIds(room);
    const orderIndex = new Map(asArray(room.order).map((id, index) => [id, index]));
    const ranked = analysed.slice().sort((a, b) => b.hand.strength - a.hand.strength || orderIndex.get(a.id) - orderIndex.get(b.id));
    room.roundResult = {
      roundNumber: Number(room.roundNumber || 1),
      penalty,
      winnerIds: best.map(item => item.id),
      loserIds: weakest.map(item => item.id),
      transfers,
      ranked: ranked.map((item, index) => ({
        id: item.id,
        dice: item.dice,
        label: item.hand.label,
        strength: item.hand.strength,
        rank: index + 1,
        scoreBefore: scoresBefore[item.id],
        scoreAfter: Number(room.players[item.id].score)
      })),
      gameFinished: survivors.length <= 1,
      at: Date.now()
    };
    room.status = 'payout';
    room.loserId = survivors.length <= 1 ? (survivors[0] || weakest[0].id) : null;
    room.winnerId = null;
    room.turn = null;
    return room;
  }

  function beginNextRound(room) {
    if (!room || room.status !== 'payout' || !room.roundResult) return room;
    if (room.roundResult.gameFinished) {
      room.status = 'finished';
      room.finishedAt = Date.now();
      if (room.loserId && room.players[room.loserId]) appendLog(room, `${room.players[room.loserId].name} perd la partie.`);
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
    room.status = 'playing';
    room.roundNumber = Number(room.roundNumber || 1) + 1;
    room.roundStartIndex = nextStart;
    room.roundHands = {};
    room.roundResult = null;
    room.turnNonce = Number(room.turnNonce || 0) + 1;
    room.turn = { index: nextStart, dice: [1, 1, 1], rollsLeft: 3, nonce: room.turnNonce };
    return room;
  }

  function createController(options) {
    const { db, roomCode, playerId, getRoom, onError } = options;
    const roomRef = db.ref(`rooms/${roomCode}`);
    let held = [false, false, false];
    let seenNonce = null;
    let turnPromptDismissed = false;
    let rolling = false;
    let audioContext = null;

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
        turnPromptDismissed = false;
      }
    }

    function setHold(index, value) {
      const room = getRoom();
      if (!room || room.status !== 'playing' || currentPlayerId(room) !== playerId) return;
      turnPromptDismissed = true;
      const prompt = document.getElementById('yourTurnPrompt');
      if (prompt) prompt.classList.add('hidden');
      if (Number(room.turn.rollsLeft) >= 3) return;
      held[index] = Boolean(value);
      render(room);
    }

    function toggleHold(index) {
      setHold(index, !held[index]);
    }

    function playRollSound() {
      try {
        const AudioEngine = window.AudioContext || window.webkitAudioContext;
        if (!AudioEngine) return;
        audioContext = audioContext || new AudioEngine();
        const context = audioContext;
        if (context.state === 'suspended') context.resume();
        const start = context.currentTime;
        const duration = 0.7;
        const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let index = 0; index < data.length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
        const noise = context.createBufferSource();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();
        noise.buffer = buffer;
        filter.type = 'bandpass';
        filter.frequency.value = 720;
        filter.Q.value = 0.7;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.13, start + 0.035);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        noise.connect(filter).connect(gain).connect(context.destination);
        noise.start(start);
        [0.08, 0.2, 0.34, 0.49, 0.61].forEach((offset, index) => {
          const thud = context.createOscillator();
          const thudGain = context.createGain();
          thud.type = 'triangle';
          thud.frequency.setValueAtTime(115 + index * 17, start + offset);
          thud.frequency.exponentialRampToValueAtTime(58, start + offset + 0.055);
          thudGain.gain.setValueAtTime(0.07, start + offset);
          thudGain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.07);
          thud.connect(thudGain).connect(context.destination);
          thud.start(start + offset);
          thud.stop(start + offset + 0.08);
        });
      } catch (error) {
        console.debug('Audio unavailable', error);
      }
    }

    function animateRoll() {
      const faces = Array.from(document.querySelectorAll('.die:not(.held) span'));
      const dice = faces.map(face => face.closest('.die'));
      dice.forEach(die => die.classList.add('rolling'));
      const timer = setInterval(() => {
        faces.forEach(face => { face.textContent = DIE[Math.floor(Math.random() * DIE.length)]; });
      }, 65);
      return new Promise(resolve => setTimeout(() => {
        clearInterval(timer);
        dice.forEach(die => die.classList.remove('rolling'));
        resolve();
      }, 650));
    }

    async function roll() {
      const snapshot = getRoom();
      if (!snapshot || !snapshot.turn || rolling) return;
      const nonce = snapshot.turn.nonce;
      const keep = held.slice();
      const randomDice = [0, 0, 0].map(() => 1 + Math.floor(Math.random() * 6));
      rolling = true;
      render(snapshot);
      playRollSound();
      await animateRoll();
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
      rolling = false;
      if (committed && Number(snapshot.turn.rollsLeft) === 3) held = [false, false, false];
      if (committed && getRoom() && getRoom().status === 'playing') render(getRoom());
      if (committed && Number(snapshot.turn.rollsLeft) === 1) {
        await new Promise(resolve => setTimeout(resolve, 650));
        await endTurn(nonce);
      } else if (!committed) {
        render(getRoom());
      }
    }

    async function endTurn(expectedNonce) {
      const snapshot = getRoom();
      const nonce = expectedNonce || (snapshot && snapshot.turn ? snapshot.turn.nonce : null);
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

    async function continueRound() {
      await mutate(room => {
        if (room.status !== 'payout') return 'Le résultat de la manche n’est plus disponible.';
        if (room.ownerId !== playerId) return 'Seul l’hôte peut lancer la manche suivante.';
        beginNextRound(room);
      });
    }

    function attachDrag(button, index, isMine, rolled) {
      if (!isMine) return;
      let origin = null;
      let moved = false;
      button.addEventListener('pointerdown', event => {
        turnPromptDismissed = true;
        const prompt = document.getElementById('yourTurnPrompt');
        if (prompt) prompt.classList.add('hidden');
        if (!rolled || rolling) return;
        origin = { x: event.clientX, y: event.clientY };
        moved = false;
        button.setPointerCapture(event.pointerId);
        button.classList.add('dragging');
        window.addEventListener('pointerup', finish, { once: true, capture: true });
        window.addEventListener('mouseup', finish, { once: true, capture: true });
      });
      button.addEventListener('pointermove', event => {
        if (!origin) return;
        const x = event.clientX - origin.x;
        const y = event.clientY - origin.y;
        if (Math.abs(x) + Math.abs(y) > 7) moved = true;
        button.style.setProperty('--drag-x', `${x}px`);
        button.style.setProperty('--drag-y', `${y}px`);
      });
      const finish = event => {
        if (!origin) return;
        button.classList.remove('dragging');
        button.style.removeProperty('--drag-x');
        button.style.removeProperty('--drag-y');
        button.style.pointerEvents = 'none';
        const target = document.elementFromPoint(event.clientX, event.clientY);
        button.style.pointerEvents = '';
        const zone = target && target.closest('[data-hold-zone]');
        origin = null;
        if (moved) button.dataset.dragCompleted = 'true';
        if (moved && zone) setHold(index, zone.dataset.holdZone === 'true');
      };
      button.addEventListener('pointerup', finish);
      button.addEventListener('pointercancel', () => {
        origin = null;
        button.classList.remove('dragging');
        button.style.removeProperty('--drag-x');
        button.style.removeProperty('--drag-y');
      });
    }

    function renderDice(room, isMine) {
      const container = document.getElementById('dice');
      const keepContainer = document.getElementById('keepDice');
      container.replaceChildren();
      keepContainer.replaceChildren();
      const rolled = Number(room.turn.rollsLeft) < 3;
      asArray(room.turn.dice).forEach((value, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `die${held[index] ? ' held' : ''}`;
        button.disabled = !isMine;
        button.setAttribute('aria-label', `Dé ${index + 1}: ${value}${held[index] ? ', gardé' : ''}`);
        const face = document.createElement('span');
        face.textContent = DIE[Number(value) - 1] || String(value);
        const caption = document.createElement('small');
        caption.textContent = held[index] ? 'Gardé' : '';
        button.append(face, caption);
        button.onclick = () => {
          if (button.dataset.dragCompleted === 'true') {
            delete button.dataset.dragCompleted;
            return;
          }
          toggleHold(index);
        };
        attachDrag(button, index, isMine, rolled);
        (held[index] ? keepContainer : container).appendChild(button);
      });
      document.querySelector('.keep-zone').classList.toggle('has-dice', held.some(Boolean));
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
        score.textContent = Number(player.score) > 0 ? `${player.score} jeton${Number(player.score) > 1 ? 's' : ''}` : 'Sorti ✓';
        row.append(avatar, name, score);
        target.appendChild(row);
      });
    }

    function renderPayout(room) {
      const result = room && room.roundResult;
      if (!result) return;
      document.getElementById('payoutRound').textContent = result.roundNumber || room.roundNumber || 1;
      const ranking = document.getElementById('payoutRanking');
      ranking.replaceChildren();
      const winnerIds = asArray(result.winnerIds);
      asArray(result.ranked).forEach(item => {
        const player = room.players[item.id];
        if (!player) return;
        const row = document.createElement('article');
        const winner = winnerIds.includes(item.id);
        row.className = `payout-row${winner ? ' round-winner' : ''}`;
        const rank = document.createElement('span');
        rank.className = 'payout-rank';
        rank.textContent = winner ? '♛' : `#${item.rank}`;
        const identity = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = `${player.name}${item.id === playerId ? ' (toi)' : ''}`;
        const label = document.createElement('small');
        label.textContent = item.label;
        identity.append(name, label);
        const dice = document.createElement('div');
        dice.className = 'payout-dice';
        asArray(item.dice).forEach(value => {
          const die = document.createElement('i');
          die.textContent = DIE[Number(value) - 1] || value;
          dice.appendChild(die);
        });
        const score = document.createElement('div');
        score.className = 'payout-score';
        const delta = Number(item.scoreAfter) - Number(item.scoreBefore);
        score.innerHTML = `<strong>${item.scoreAfter}</strong><small>${delta > 0 ? `+${delta}` : delta || '—'}</small>`;
        row.append(rank, identity, dice, score);
        ranking.appendChild(row);
      });

      const transfers = document.getElementById('payoutTransfers');
      transfers.replaceChildren();
      const transferList = asArray(result.transfers);
      if (!transferList.length) {
        const neutral = document.createElement('p');
        neutral.textContent = 'Aucun jeton ne change de main.';
        transfers.appendChild(neutral);
      } else {
        transferList.forEach(transfer => {
          const line = document.createElement('p');
          const from = room.players[transfer.from];
          const to = room.players[transfer.to];
          line.textContent = `${from ? from.name : '—'}  →  ${to ? to.name : '—'}  ·  ${transfer.amount}`;
          transfers.appendChild(line);
        });
      }
      const continueButton = document.getElementById('continueRoundBtn');
      const isOwner = room.ownerId === playerId;
      continueButton.classList.toggle('hidden', !isOwner);
      continueButton.querySelector('span').textContent = result.gameFinished ? 'Voir le vainqueur' : 'Manche suivante';
      document.getElementById('payoutHint').textContent = isOwner ? '' : 'L’hôte lancera la suite.';
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
        ? (rollsLeft === 3 ? 'Lance les trois dés.' : 'Glisse les dés entre les deux zones, puis relance ou garde.')
        : 'La partie se met à jour automatiquement.';
      document.getElementById('rollBtn').disabled = rolling || !isMine || rollsLeft <= 0;
      document.getElementById('endTurnBtn').disabled = rolling || !isMine || rollsLeft === 3;
      document.getElementById('rollBtn').querySelector('strong').textContent = rollsLeft === 1 ? 'Dernier lancer' : 'Lancer';
      document.getElementById('yourTurnPrompt').classList.toggle('hidden', !isMine || turnPromptDismissed);
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
    document.getElementById('endTurnBtn').onclick = () => endTurn();
    document.getElementById('continueRoundBtn').onclick = continueRound;

    return { render, renderPayout, renderScores, roll, endTurn, continueRound, toggleHold };
  }

  const api = { analyseHand, settleRound, beginNextRound, activeIds, asArray, createController };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Game421 = api;
}(typeof window !== 'undefined' ? window : null));
