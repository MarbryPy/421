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
      return {
        strength: 500 + pair * 10 + kicker,
        penalty: pair === 1 ? kicker : 2,
        label: pair === 1 ? 'Paire d’as' : `Paire de ${pair}`
      };
    }
    const total = dice.reduce((sum, value) => sum + value, 0);
    return { strength: total, penalty: 1, label: `${total} points` };
  }

  function activeIds(room) {
    return asArray(room.order).filter(id => room.players && room.players[id] && Number(room.players[id].score) > 0);
  }

  function maxRolls(turn) {
    return Math.max(1, Math.min(3, Number(turn && turn.maxRolls) || 3));
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

    const analysed = ids.map(id => ({
      id,
      dice: asArray(hands[id].dice),
      rollsUsed: Number(hands[id].rollsUsed) || 1,
      hand: analyseHand(hands[id].dice)
    }));
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
        rollsUsed: item.rollsUsed,
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
    const roundLoser = asArray(room.roundResult.loserIds)
      .find(id => room.players[id] && Number(room.players[id].score) > 0);
    let nextStart = Math.max(0, order.indexOf(roundLoser));
    if (!roundLoser) nextStart = order.findIndex(id => room.players[id] && Number(room.players[id].score) > 0);
    room.status = 'playing';
    room.roundNumber = Number(room.roundNumber || 1) + 1;
    room.roundStartIndex = nextStart;
    room.roundHands = {};
    room.roundRollLimit = null;
    room.roundResult = null;
    room.turnNonce = Number(room.turnNonce || 0) + 1;
    room.turn = { index: nextStart, dice: [1, 1, 1], maxRolls: 3, rollsLeft: 3, nonce: room.turnNonce };
    return room;
  }

  function createController(options) {
    const { db, roomCode, playerId, getRoom, onError } = options;
    const roomRef = db.ref(`rooms/${roomCode}`);
    let held = [false, false, false];
    let seenNonce = null;
    let turnPromptDismissed = false;
    let rolling = false;
    const pendingDieOrigins = new Map();
    const rollSounds = typeof Audio === 'undefined' ? [] : [null, 1, 2, 3].map(count => {
      if (!count) return null;
      const sound = new Audio(`assets/audio/toss-${count}.wav?v=2`);
      sound.preload = 'auto';
      sound.volume = 0.48;
      return sound;
    });

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
        pendingDieOrigins.clear();
        turnPromptDismissed = false;
      }
    }

    function setHold(index, value) {
      const room = getRoom();
      if (!room || room.status !== 'playing' || currentPlayerId(room) !== playerId) return;
      turnPromptDismissed = true;
      const prompt = document.getElementById('yourTurnPrompt');
      if (prompt) prompt.classList.add('hidden');
      if (Number(room.turn.rollsLeft) >= maxRolls(room.turn)) return;
      held[index] = Boolean(value);
      render(room);
    }

    function toggleHold(index) {
      setHold(index, !held[index]);
    }

    function playRollSound(diceCount) {
      const sound = rollSounds[Math.max(0, Math.min(3, Number(diceCount) || 0))];
      if (!sound) return;
      sound.currentTime = 0;
      sound.play().catch(error => console.debug('Audio unavailable', error));
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
      const firstRoll = Number(snapshot.turn.rollsLeft) === maxRolls(snapshot.turn);
      const diceToRoll = firstRoll ? 3 : keep.filter(value => !value).length;
      const randomDice = [0, 0, 0].map(() => 1 + Math.floor(Math.random() * 6));
      rolling = true;
      render(snapshot);
      playRollSound(diceToRoll);
      await animateRoll();
      const committed = await mutate(room => {
        if (room.status !== 'playing') return 'La partie n’est pas en cours.';
        if (currentPlayerId(room) !== playerId) return 'Ce n’est pas ton tour.';
        if (!room.turn || room.turn.nonce !== nonce) return 'Le tour a déjà avancé.';
        if (Number(room.turn.rollsLeft) <= 0) return 'Tu as utilisé tes trois lancers.';
        const firstRoll = Number(room.turn.rollsLeft) === maxRolls(room.turn);
        const dice = asArray(room.turn.dice);
        room.turn.dice = dice.map((value, index) => (firstRoll || !keep[index]) ? randomDice[index] : value);
        room.turn.rollsLeft = Number(room.turn.rollsLeft) - 1;
      });
      rolling = false;
      if (committed && Number(snapshot.turn.rollsLeft) === maxRolls(snapshot.turn)) held = [false, false, false];
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
        const allowedRolls = maxRolls(room.turn);
        if (Number(room.turn.rollsLeft) === allowedRolls) return 'Lance les dés avant de valider.';

        room.roundHands = room.roundHands || {};
        const firstHand = Object.keys(room.roundHands).length === 0;
        const usedRolls = allowedRolls - Number(room.turn.rollsLeft);
        if (firstHand) room.roundRollLimit = usedRolls;
        room.roundHands[playerId] = { dice: asArray(room.turn.dice), rollsUsed: usedRolls, at: Date.now() };
        const hand = analyseHand(room.turn.dice);
        appendLog(room, `${room.players[playerId].name} valide ${hand.label}.`);
        const nextIndex = nextPlayableIndex(room, room.turn.index);
        if (nextIndex >= 0) {
          const nextMaxRolls = Math.max(1, Number(room.roundRollLimit) || allowedRolls);
          room.turnNonce = Number(room.turnNonce || 0) + 1;
          room.turn = { index: nextIndex, dice: [1, 1, 1], maxRolls: nextMaxRolls, rollsLeft: nextMaxRolls, nonce: room.turnNonce };
        } else {
          settleRound(room);
        }
      });
    }

    async function continueRound() {
      await mutate(room => {
        if (room.status !== 'payout') return 'Le résultat de la manche n’est plus disponible.';
        if (!asArray(room.roundResult && room.roundResult.loserIds).includes(playerId)) return 'Le perdant de la manche lance la suivante.';
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
        if (moved && zone) {
          pendingDieOrigins.set(index, { x: event.clientX, y: event.clientY });
          setHold(index, zone.dataset.holdZone === 'true');
        }
        else if (!moved) toggleHold(index);
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
      const previousPositions = new Map();
      document.querySelectorAll('.dice-dropzone .die[data-die-index]').forEach(die => {
        previousPositions.set(Number(die.dataset.dieIndex), die.getBoundingClientRect());
      });
      container.replaceChildren();
      keepContainer.replaceChildren();
      const rolled = Number(room.turn.rollsLeft) < maxRolls(room.turn);
      asArray(room.turn.dice).forEach((value, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `die${held[index] ? ' held' : ''}`;
        button.dataset.dieIndex = index;
        button.style.gridColumn = String(index + 1);
        button.disabled = !isMine;
        button.setAttribute('aria-label', `Dé ${index + 1}: ${value}${held[index] ? ', gardé' : ''}`);
        const face = document.createElement('span');
        face.textContent = DIE[Number(value) - 1] || String(value);
        const caption = document.createElement('small');
        caption.textContent = held[index] ? 'Gardé' : '';
        button.append(face, caption);
        button.onkeydown = event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          toggleHold(index);
        };
        attachDrag(button, index, isMine, rolled);
        (held[index] ? keepContainer : container).appendChild(button);

        const destination = button.getBoundingClientRect();
        const dropOrigin = pendingDieOrigins.get(index);
        const previous = previousPositions.get(index);
        const x = dropOrigin ? dropOrigin.x - (destination.left + destination.width / 2) : (previous ? previous.left - destination.left : 0);
        const y = dropOrigin ? dropOrigin.y - (destination.top + destination.height / 2) : (previous ? previous.top - destination.top : 0);
        pendingDieOrigins.delete(index);
        if ((Math.abs(x) > 1 || Math.abs(y) > 1) && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          button.animate([
            { transform: `translate(${x}px, ${y}px) scale(1.03)` },
            { transform: 'translate(0, 0) scale(1)' }
          ], { duration: 300, easing: 'cubic-bezier(.2,.78,.25,1)' });
        }
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
        const chips = document.createElement('span');
        chips.className = 'score-chips';
        const visibleChips = Math.min(6, Math.ceil(Math.max(0, Number(player.score)) / 4));
        for (let chip = 0; chip < visibleChips; chip += 1) chips.appendChild(document.createElement('i'));
        row.append(avatar, name, score, chips);
        target.appendChild(row);
      });
    }

    function renderPayout(room) {
      const result = room && room.roundResult;
      if (!result) return;
      document.getElementById('payoutRound').textContent = result.roundNumber || room.roundNumber || 1;
      const winnerIds = asArray(result.winnerIds);
      const loserIds = asArray(result.loserIds);
      const ranked = asArray(result.ranked);

      function createDice(item) {
        const dice = document.createElement('div');
        dice.className = 'payout-dice';
        asArray(item.dice).forEach(value => {
          const die = document.createElement('i');
          die.textContent = DIE[Number(value) - 1] || value;
          dice.appendChild(die);
        });
        return dice;
      }

      function createScore(item) {
        const score = document.createElement('div');
        score.className = 'payout-score';
        const delta = Number(item.scoreAfter) - Number(item.scoreBefore);
        const total = document.createElement('strong');
        total.textContent = item.scoreAfter;
        const change = document.createElement('small');
        change.textContent = `${delta > 0 ? `+${delta}` : delta || '—'} jeton${Math.abs(delta) > 1 ? 's' : ''}`;
        const pile = document.createElement('span');
        pile.className = 'payout-chip-dots';
        for (let chip = 0; chip < Math.min(5, Math.ceil(Math.max(0, Number(item.scoreAfter)) / 5)); chip += 1) pile.appendChild(document.createElement('i'));
        score.append(total, change, pile);
        return score;
      }

      function createRankingRow(item) {
        const player = room.players[item.id];
        if (!player) return null;
        const row = document.createElement('article');
        const winner = winnerIds.includes(item.id);
        const loser = loserIds.includes(item.id);
        const draw = winner && loser;
        row.className = `payout-row${winner && !draw ? ' round-winner' : ''}${loser && !draw ? ' round-loser' : ''}`;
        const rank = document.createElement('span');
        rank.className = 'payout-rank';
        rank.textContent = winner ? '♛' : `#${item.rank}`;
        const identity = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = `${player.name}${item.id === playerId ? ' (toi)' : ''}`;
        const outcome = document.createElement('span');
        outcome.className = 'payout-outcome';
        outcome.textContent = draw ? 'ÉGALITÉ' : (winner ? 'GAGNÉ' : (loser ? 'PERDU' : 'NEUTRE'));
        const label = document.createElement('small');
        const used = Number(item.rollsUsed) || 1;
        label.textContent = `${item.label} · ${used} lancer${used > 1 ? 's' : ''}`;
        identity.append(name, outcome, label);
        row.append(rank, identity, createDice(item), createScore(item));
        return row;
      }

      function createContender(item, winner) {
        const player = room.players[item.id];
        const card = document.createElement('article');
        card.className = `payout-contender ${winner ? 'round-winner' : 'round-loser'}`;
        const header = document.createElement('div');
        header.className = 'contender-header';
        const emblem = document.createElement('span');
        emblem.className = 'payout-rank';
        emblem.textContent = winner ? '♛' : `#${item.rank}`;
        const identity = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = `${player.name}${item.id === playerId ? ' (toi)' : ''}`;
        const outcome = document.createElement('span');
        outcome.className = 'payout-outcome';
        outcome.textContent = winner ? 'GAGNÉ' : 'PERDU';
        identity.append(name, outcome);
        header.append(emblem, identity);

        const hand = document.createElement('div');
        hand.className = 'contender-hand';
        const used = Number(item.rollsUsed) || 1;
        const label = document.createElement('small');
        label.textContent = `${item.label} · ${used} lancer${used > 1 ? 's' : ''}`;
        const handLine = document.createElement('div');
        handLine.className = 'contender-hand-line';
        handLine.append(createDice(item), createScore(item));
        hand.append(label, handLine);
        card.append(header, hand);
        return card;
      }

      function createTransfer(transfer) {
        const flow = document.createElement('div');
        flow.className = 'duel-transfer';
        const title = document.createElement('span');
        title.textContent = 'Transfert';
        const track = document.createElement('span');
        track.className = 'chip-track';
        const amountValue = Number(transfer && transfer.amount) || 0;
        for (let chip = 0; chip < Math.min(8, amountValue); chip += 1) {
          const token = document.createElement('i');
          token.style.setProperty('--chip-delay', `${chip * 0.16}s`);
          track.appendChild(token);
        }
        const amount = document.createElement('strong');
        amount.textContent = amountValue ? `${amountValue} jeton${amountValue > 1 ? 's' : ''}` : 'Égalité';
        flow.setAttribute('aria-label', amountValue ? `Transfert de ${amountValue} jetons du gagnant vers le perdant` : 'Aucun transfert de jetons');
        flow.append(title, track, amount);
        return flow;
      }

      const transferList = asArray(result.transfers);
      const duel = document.getElementById('payoutDuel');
      const winnerItem = ranked.find(item => item.id === winnerIds[0]);
      const loserItem = ranked.find(item => item.id === loserIds[0]);
      const simpleDuel = winnerIds.length === 1 && loserIds.length === 1 && winnerIds[0] !== loserIds[0] && winnerItem && loserItem;
      if (simpleDuel) {
        const transfer = transferList.find(item => item.from === winnerItem.id && item.to === loserItem.id) || transferList[0];
        duel.replaceChildren(createContender(winnerItem, true), createTransfer(transfer), createContender(loserItem, false));
        duel.classList.remove('hidden');
      } else {
        duel.replaceChildren();
        duel.classList.add('hidden');
      }

      const otherItems = simpleDuel ? ranked.filter(item => item.id !== winnerItem.id && item.id !== loserItem.id) : ranked;
      const others = document.getElementById('payoutOthers');
      const ranking = document.getElementById('payoutRanking');
      ranking.replaceChildren(...otherItems.map(createRankingRow).filter(Boolean));
      others.classList.toggle('hidden', !otherItems.length);
      document.getElementById('payoutOthersTitle').textContent = simpleDuel ? 'Mains des autres joueurs' : 'Classement de la manche';

      const continueButton = document.getElementById('continueRoundBtn');
      const canContinue = loserIds.includes(playerId);
      const roundLoser = room.players[loserIds[0]];
      continueButton.classList.toggle('hidden', !canContinue);
      continueButton.querySelector('span').textContent = result.gameFinished ? 'Voir le vainqueur' : 'Manche suivante';
      document.getElementById('payoutHint').textContent = canContinue ? 'Tu ouvriras la prochaine manche.' : `${roundLoser ? roundLoser.name : 'Le perdant'} lancera la suite.`;
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
      const allowedRolls = maxRolls(room.turn);
      const isRoundLeader = Object.keys(room.roundHands || {}).length === 0;
      document.getElementById('rollsBadge').textContent = `${rollsLeft} lancer${rollsLeft > 1 ? 's' : ''}${allowedRolls < 3 ? ' max' : ''}`;
      const rollLights = document.getElementById('rollLights');
      rollLights.setAttribute('aria-label', `${rollsLeft} lancer${rollsLeft > 1 ? 's' : ''} restant${rollsLeft > 1 ? 's' : ''}`);
      Array.from(rollLights.children).forEach((light, index) => {
        light.classList.toggle('lit', index < rollsLeft);
      });
      document.getElementById('gameHint').textContent = isMine
        ? (rollsLeft === allowedRolls
          ? (allowedRolls < 3 ? `Tu as ${allowedRolls} lancer${allowedRolls > 1 ? 's' : ''}, comme le premier joueur.` : 'Lance les trois dés.')
          : (isRoundLeader ? 'Glisse les dés entre les deux zones, puis relance ou garde.' : 'Tu peux valider ta main ou utiliser les lancers restants.'))
        : 'La partie se met à jour automatiquement.';
      document.getElementById('rollBtn').disabled = rolling || !isMine || rollsLeft <= 0;
      document.getElementById('endTurnBtn').disabled = rolling || !isMine || rollsLeft === allowedRolls;
      document.getElementById('rollBtn').querySelector('strong').textContent = rollsLeft === 1 ? 'Dernier lancer' : 'Lancer';
      document.getElementById('yourTurnPrompt').classList.toggle('hidden', !isMine || turnPromptDismissed);
      document.getElementById('handLabel').textContent = rollsLeft < allowedRolls ? analyseHand(room.turn.dice).label : '';
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
