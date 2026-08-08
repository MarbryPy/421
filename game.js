(function (root) {
  'use strict';

  const DIE = ['âš€', 'âš', 'âš‚', 'âšƒ', 'âš„', 'âš…'];

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
    if (key === '111') return { strength: 800, penalty: 7, label: 'Brelan dâ€™as' };
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
            if (!room) { reason = 'Ce salon nâ€™existe plus.'; return; }
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
        fail('La synchronisation a Ã©chouÃ©. RÃ©essaie dans un instant.');
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
      if (Number(room.turn.rollsLeft) >= 3) return fail('Lance dâ€™abord les trois dÃ©s.');
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
        if (room.status !== 'playing') return 'La partie nâ€™est pas en cours.';
        if (currentPlayerId(room) !== playerId) return 'Ce nâ€™est pas ton tour.';
        if (!room.turn || room.turn.nonce !== nonce) return 'Le tour a dÃ©jÃ  avancÃ©.';
        if (Number(room.turn.rollsLeft) <= 0) return 'Tu as utilisÃ© tes trois lancers.';
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
        if (room.status !== 'playing') return 'La partie nâ€™est pas en cours.';
        if (currentPlayerId(room) !== playerId) return 'Ce nâ€™est pas ton tour.';
        if (!room.turn || room.turn.nonce !== nonce) return 'Le tour a dÃ©jÃ  avancÃ©.';
        if (Number(room.turn.rollsLeft) === 3) return 'Lance les dÃ©s avant de valider.';

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
        button.setAóžx¶‰žËkºwµçA9Õµ‰•È¡ÕÉÉ•¹Ð¹Á±…å•ÉÍm¥‘t¹Í½É”¤€ø€À€˜˜€„¡ÕÉÉ•¹Ð¹É½Õ¹‘!…¹‘Ìñðíô¥m¥‘t¤ì(€€€€€€€€€€€¥˜€¡¹•áÑ%¹‘•à€øô€À¤ì(€€€€€€€€€€€€€ÕÉÉ•¹Ð¹ÑÕÉ¹9½¹”€ô9Õµ‰•È¡ÕÉÉ•¹Ð¹ÑÕÉ¹9½¹”ñð€À¤€¬€Äì(€€€€€€€€€€€€€ÕÉÉ•¹Ð¹ÑÕÉ¸€ôì¥¹‘•àè¹•áÑ%¹‘•à°‘¥”èlÄ°€Ä°€Åt°É½±±Í1•™Ðè€Ì°¹½¹”èÕÉÉ•¹Ð¹ÑÕÉ¹9½¹”ôì(€€€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€€€…µ”ÐÈÄ¹Í•ÑÑ±•I½Õ¹¡ÕÉÉ•¹Ð¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô•±Í”¥˜€¡ÕÉÉ•¹Ð¹ÑÕÉ¸¤ì(€€€€€€€€€€€ÕÉÉ•¹Ð¹ÑÕÉ¸¹¥¹‘•à€ô5…Ñ ¹µ…à À°ÕÉÉ•¹Ð¹½É‘•È¹¥¹‘•á=˜¡½±‘QÕÉ¹%¤¤ì(€€€€€€€€€ô(€€€€€€€ô(€€€€€€€ÕÉÉ•¹Ð¹ÕÁ‘…Ñ•‘Ð€ô…Ñ”¹¹½Ü ¤ì(€€€€€€€É•ÑÕÉ¸ÕÉÉ•¹Ðì(€€€€€ô¤ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€Ñ½…ÍÐ¡•ÉÉ½É5•ÍÍ…”¡•ÉÉ½È¤°ÑÉÕ”¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô™¥¹…±±äì(€€€€€Í•Ñ	ÕÍä¡™…±Í”¤ì(€€€ô(€€€‘•Ñ…¡I½½´ ¤ì(€€€¡¥ÍÑ½Éä¹É•Á±…•MÑ…Ñ”¡íô°€œœ°±½…Ñ¥½¸¹Á…Ñ¡¹…µ”¤ì(€€€Í¡½ÝMÉ••¸ ]•±½µ”œ¤ì(€€€Ñ½…ÍÐ¡QÔ…ÌÅÕ¥ÑÓ¤±”Í…±½¸€‘í±•…Ù¥¹½‘•ô¹€¤ì(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸É•ÍÑ½É•M•ÍÍ¥½¸ ¤ì(€€€±•ÐÍ•ÍÍ¥½¸ì(€€€ÑÉäìÍ•ÍÍ¥½¸€ô)M=8¹Á…ÉÍ”¡±½…±MÑ½É…”¹•Ñ%Ñ•´¡MMM%=9}-d¤¤ìô…Ñ €¡|¤ì±•…ÉM•ÍÍ¥½¸ ¤ìô(€€€¥˜€ …Í•ÍÍ¥½¸ñð€…Í•ÍÍ¥½¸¹É½½µ½‘”ñðÍ•ÍÍ¥½¸¹Á±…å•É%€„ôôÁ±…å•É%¤É•ÑÕÉ¸™…±Í”ì(€€€ÑÉäì(€€€€€½¹ÍÐÍ¹…ÁÍ¡½Ð€ô…Ý…¥Ð‘ˆ¹É•˜¡É½½µÌ¼‘íÍ•ÍÍ¥½¸¹É½½µ½‘•õ€¤¹½¹” Ù…±Õ”œ¤ì(€€€€€½¹ÍÐÕÉÉ•¹Ð€ôÍ¹…ÁÍ¡½Ð¹Ù…° ¤ì(€€€€€¥˜€ …ÕÉÉ•¹Ðñð€…ÕÉÉ•¹Ð¹Á±…å•ÉÌñð€…ÕÉÉ•¹Ð¹Á±…å•ÉÍmÁ±…å•É%‘t¤ì±•…ÉM•ÍÍ¥½¸ ¤ìÉ•ÑÕÉ¸™…±Í”ìô(€€€€€…Ý…¥Ð‘ˆ¹É•˜¡É½½µÌ¼‘íÍ•ÍÍ¥½¸¹É½½µ½‘•ô½Á±…å•ÉÌ¼‘íÁ±…å•É%‘õ€¤¹ÕÁ‘…Ñ”¡ì½¹¹•Ñ•èÑÉÕ”°¹…µ”è±•…¹9…µ”¡Í•ÍÍ¥½¸¹¹…µ”¤ñðÕÉÉ•¹Ð¹Á±…å•ÉÍmÁ±…å•É%‘t¹¹…µ”ô¤ì(€€€€€…ÑÑ…¡I½½´¡Í•ÍÍ¥½¸¹É½½µ½‘”°Í•ÍÍ¥½¸¹¹…µ”¤ì(€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€Ñ½…ÍÐ¡•ÉÉ½É5•ÍÍ…”¡•ÉÉ½È¤°ÑÉÕ”¤ì(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ô(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸½Áå=ÉM¡…É”¡Í¡…É”¤ì(€€€½¹ÍÐÕÉ°€ô€‘í±½…Ñ¥½¸¹½É¥¥¹ô‘í±½…Ñ¥½¸¹Á…Ñ¡¹…µ•ôýÉ½½´ô‘íÉ½½µ½‘•õ€ì(€€€ÑÉäì(€€€€€¥˜€¡Í¡…É”€˜˜¹…Ù¥…Ñ½È¹Í¡…É”¤…Ý…¥Ð¹…Ù¥…Ñ½È¹Í¡…É”¡ìÑ¥Ñ±”è€A…ÉÑ¥”‘”€ÐÈÄœ°Ñ•áÐèI•©½¥¹Ìµ½¸Í…±½¸€ÐÈÄ€è€‘íÉ½½µ½‘•õ€°ÕÉ°ô¤ì(€€€€€•±Í”ì(€€€€€€€…Ý…¥Ð¹…Ù¥…Ñ½È¹±¥Á‰½…É¹ÝÉ¥Ñ•Q•áÐ¡Í¡…É”€ü€‘íÉ½½µ½‘•ôƒŠP€‘íÕÉ±õ€€èÉ½½µ½‘”¤ì(€€€€€€€Ñ½…ÍÐ¡Í¡…É”€ü€1¥•¸½Á§¤€„œ€è€½‘”½Á§¤€„œ¤ì(€€€€€ô(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€¥˜€¡•ÉÉ½È€˜˜•ÉÉ½È¹¹…µ”€„ôô€‰½ÉÑÉÉ½Èœ¤Ñ½…ÍÐ %µÁ½ÍÍ¥‰±”‘”½Á¥•È…ÕÑ½µ…Ñ¥ÅÕ•µ•¹Ð¸œ°ÑÉÕ”¤ì(€€€ô(€ô((€™Õ¹Ñ¥½¸‰¥¹‘U¤ ¤ì(€€€€ ‰Ñ¹½É•…Ñ”œ¤¹½¹±¥¬€ô€ ¤€ôøÍ¡½ÝMÉ••¸ É•…Ñ”œ¤ì(€€€€ ‰Ñ¹½)½¥¸œ¤¹½¹±¥¬€ô€ ¤€ôøÍ¡½ÝMÉ••¸ )½¥¸œ¤ì(€€€€ ‰…­É½µÉ•…Ñ”œ¤¹½¹±¥¬€ô€ ¤€ôøÍ¡½ÝMÉ••¸ ]•±½µ”œ¤ì(€€€€ ‰…­É½µ)½¥¸œ¤¹½¹±¥¬€ô€ ¤€ôøÍ¡½ÝMÉ••¸ ]•±½µ”œ¤ì(€€€€ É•…Ñ•	Ñ¸œ¤¹½¹±¥¬€ôÉ•…Ñ•I½½´ì(€€€€ ©½¥¹	Ñ¸œ¤¹½¹±¥¬€ô©½¥¹I½½´ì(€€€€ É•…‘å	Ñ¸œ¤¹½¹±¥¬€ôÑ½±•I•…‘äì(€€€€ ÍÑ…ÉÑ…µ•	Ñ¸œ¤¹½¹±¥¬€ôÍÑ…ÉÑ…µ”ì(€€€€ ¹•Ý…µ•	Ñ¸œ¤¹½¹±¥¬€ôÉ•Í•Ñ…µ”ì(€€€€ ‰…­Q½1½‰‰å	Ñ¸œ¤¹½¹±¥¬€ô±•…Ù•I½½´ì(€€€€ ±•…Ù•	Ñ¸œ¤¹½¹±¥¬€ô±•…Ù•I½½´ì(€€€€ ½Áå½‘•	Ñ¸œ¤¹½¹±¥¬€ô€ ¤€ôø½Áå=ÉM¡…É”¡™…±Í”¤ì(€€€€ Í¡…É•	Ñ¸œ¤¹½¹±¥¬€ô€ ¤€ôø½Áå=ÉM¡…É”¡ÑÉÕ”¤ì(€€€€ ©½¥¹½‘”œ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¥¹ÁÕÐœ°•Ù•¹Ð€ôøì•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”€ô•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¹Ñ½UÁÁ•É…Í” ¤¹É•Á±…” ½myµhÈ´åt½œ°€œœ¤¹Í±¥” À°€Ô¤ìô¤ì(€€€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ­•å‘½Ý¸œ°•Ù•¹Ð€ôøì(€€€€€¥˜€¡•Ù•¹Ð¹­•ä€„ôô€¹Ñ•Èœ¤É•ÑÕÉ¸ì(€€€€€¥˜€ „ ÍÉ••¹É•…Ñ”œ¤¹±…ÍÍ1¥ÍÐ¹½¹Ñ…¥¹Ì ¡¥‘‘•¸œ¤¤É•…Ñ•I½½´ ¤ì(€€€€€¥˜€ „ ÍÉ••¹)½¥¸œ¤¹±…ÍÍ1¥ÍÐ¹½¹Ñ…¥¹Ì ¡¥‘‘•¸œ¤¤©½¥¹I½½´ ¤ì(€€€ô¤ì(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸¥¹¥Ð ¤ì(€€€‰¥¹‘U¤ ¤ì(€€€¥˜€ …Ý¥¹‘½Ü¹™¥É•‰…Í”ñð€…™¥É•‰…Í”¹…ÕÑ ñð€…Ý¥¹‘½Ü¹…µ”ÐÈÄ¤ì(€€€€€€ ½¹¹•Ñ¥½¹MÑ…ÑÕÌœ¤¹Ñ•áÑ½¹Ñ•¹Ð€ô€ÁÁ±¥…Ñ¥½¸¥¹‘¥ÍÁ½¹¥‰±”œì(€€€€€Ñ½…ÍÐ 1•Ì½µÁ½Í…¹ÑÌ‘Ô©•Ô»Še½¹ÐÁ…ÌÁÔ¡…É•È¸œ°ÑÉÕ”¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€ÑÉäì(€€€€€¥˜€ …™¥É•‰…Í”¹…ÁÁÌ¹±•¹Ñ ¤™¥É•‰…Í”¹¥¹¥Ñ¥…±¥é•ÁÀ¡™¥É•‰…Í•½¹™¥œ¤ì(€€€€€½¹ÍÐ…ÕÑ €ô™¥É•‰…Í”¹…ÕÑ  ¤ì(€€€€€…Ý…¥Ð…ÕÑ ¹Í•ÑA•ÉÍ¥ÍÑ•¹”¡™¥É•‰…Í”¹…ÕÑ ¹ÕÑ ¹A•ÉÍ¥ÍÑ•¹”¹1=0¤ì(€€€€€½¹ÍÐÉ•‘•¹Ñ¥…°€ô…ÕÑ ¹ÕÉÉ•¹ÑUÍ•È€üìÕÍ•Èè…ÕÑ ¹ÕÉÉ•¹ÑUÍ•Èô€è…Ý…¥Ð…ÕÑ ¹Í¥¹%¹¹½¹åµ½ÕÍ±ä ¤ì(€€€€€Á±…å•É%€ôÉ•‘•¹Ñ¥…°¹ÕÍ•È¹Õ¥ì(€€€€€‘ˆ€ô™¥É•‰…Í”¹‘…Ñ…‰…Í” ¤ì(€€€€€‘ˆ¹É•˜ œ¹¥¹™¼½½¹¹•Ñ•œ¤¹½¸ Ù…±Õ”œ°Í¹…ÁÍ¡½Ð€ôøì(€€€€€€€½¹ÍÐ½¹±¥¹”€ôÍ¹…ÁÍ¡½Ð¹Ù…° ¤€ôôôÑÉÕ”ì(€€€€€€€¥˜€¡½¹±¥¹”¤¡…Í½¹¹•Ñ•€ôÑÉÕ”ì(€€€€€€€€ ½¹¹•Ñ¥½¹MÑ…ÑÕÌœ¤¹Ñ•áÑ½¹Ñ•¹Ð€ô½¹±¥¹”€ü€¸±¥¹”œ€è€!½ÉÌ±¥¹”ƒŠPÉ•½¹¹•á¥½»Š˜œì(€€€€€€€€ ½¹¹•Ñ¥½¹MÑ…ÑÕÌœ¤¹±…ÍÍ1¥ÍÐ¹Ñ½±” ½™™±¥¹”œ°€…½¹±¥¹”¤ì(€€€€€ô¤ì(€€€€€Í•ÑQ¥µ•½ÕÐ  ¤€ôøì(€€€€€€€¥˜€ …¡…Í½¹¹•Ñ•¤Ñ½…ÍÐ 1„‰…Í”¥É•‰…Í”¹”Ë¥Á½¹Á…Ì¸[¥É¥™¥”Å×Še•±±”•ÍÐ…Ñ¥Ù”¸œ°ÑÉÕ”¤ì(€€€€€ô°€ÜÀÀÀ¤ì(€€€€€½¹ÍÐÉ•ÍÑ½É•€ô…Ý…¥ÐÉ•ÍÑ½É•M•ÍÍ¥½¸ ¤ì(€€€€€¥˜€ …É•ÍÑ½É•¤ì(€€€€€€€½¹ÍÐ¥¹Ù¥Ñ•‘I½½´€ô¹•ÜUI1M•…É¡A…É…µÌ¡±½…Ñ¥½¸¹Í•…É ¤¹•Ð É½½´œ¤ì(€€€€€€€¥˜€¡¥¹Ù¥Ñ•‘I½½´¤ì(€€€€€€€€€€ ©½¥¹½‘”œ¤¹Ù…±Õ”€ô¥¹Ù¥Ñ•‘I½½´¹Ñ½UÁÁ•É…Í” ¤¹É•Á±…” ½myµhÈ´åt½œ°€œœ¤¹Í±¥” À°€Ô¤ì(€€€€€€€€€Í¡½ÝMÉ••¸ )½¥¸œ¤ì(€€€€€€€ô•±Í”Í¡½ÝMÉ••¸ ]•±½µ”œ¤ì(€€€€€ô(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€ ½¹¹•Ñ¥½¹MÑ…ÑÕÌœ¤¹Ñ•áÑ½¹Ñ•¹Ð€ô€½¹¹•á¥½¸¥µÁ½ÍÍ¥‰±”œì(€€€€€Ñ½…ÍÐ¡•ÉÉ½É5•ÍÍ…”¡•ÉÉ½È¤°ÑÉÕ”¤ì(€€€ô(€ô((€¥¹¥Ð ¤ì)ô¤ì(