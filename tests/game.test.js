'use strict';

const assert = require('node:assert/strict');
const { analyseHand, settleRound, beginNextRound, asArray } = require('../game.js');

function player(name, score = 21) {
  return { name, score, ready: true, connected: true };
}

function roomWith(hands, scores = {}) {
  const ids = Object.keys(hands);
  const players = Object.fromEntries(ids.map(id => [id, player(id, scores[id] ?? 21)]));
  return {
    status: 'playing',
    players,
    order: ids,
    roundHands: Object.fromEntries(ids.map(id => [id, { dice: hands[id] }])),
    roundNumber: 1,
    roundStartIndex: 0,
    turnNonce: 1,
    turn: { index: ids.length - 1, dice: hands[ids.at(-1)], rollsLeft: 0, nonce: 1 },
    log: []
  };
}

assert.equal(analyseHand([4, 2, 1]).label, '421');
assert.ok(analyseHand([4, 2, 1]).strength > analyseHand([1, 1, 1]).strength);
assert.ok(analyseHand([1, 1, 1]).strength > analyseHand([6, 6, 6]).strength);
assert.ok(analyseHand([6, 5, 4]).strength > analyseHand([6, 6, 5]).strength);
assert.ok(analyseHand([6, 6, 5]).strength > analyseHand([6, 5, 2]).strength);
assert.deepEqual(asArray({ 0: 'a', 1: 'b' }), ['a', 'b']);

const normalRound = roomWith({ Alice: [4, 2, 1], Bob: [6, 5, 2], Chloé: [2, 2, 1] });
settleRound(normalRound);
assert.equal(normalRound.players.Bob.score, 29, 'the weakest hand receives the winning 421 penalty');
assert.equal(normalRound.players.Alice.score, 13, 'the winner gives away the chips');
assert.equal(normalRound.players.Chloé.score, 21);
assert.equal(normalRound.status, 'payout');
assert.equal(normalRound.roundNumber, 1);
assert.equal(normalRound.roundResult.transfers[0].amount, 8);
assert.equal(normalRound.roundResult.transfers[0].from, 'Alice');
assert.equal(normalRound.roundResult.transfers[0].to, 'Bob');
assert.deepEqual(normalRound.roundHands.Alice.dice, [4, 2, 1]);
beginNextRound(normalRound);
assert.equal(normalRound.status, 'playing');
assert.equal(normalRound.roundNumber, 2);
assert.equal(normalRound.turn.index, 1, 'round starter rotates');
assert.deepEqual(normalRound.roundHands, {});

const elimination = roomWith({ Alice: [4, 2, 1], Bob: [6, 5, 2] }, { Alice: 5, Bob: 3 });
settleRound(elimination);
assert.equal(elimination.players.Alice.score, 0);
assert.equal(elimination.players.Bob.score, 8);
assert.equal(elimination.status, 'payout');
assert.equal(elimination.roundResult.gameFinished, true);
assert.equal(elimination.loserId, 'Bob');
assert.equal(elimination.turn, null);
beginNextRound(elimination);
assert.equal(elimination.status, 'finished');

const tiedWeakest = roomWith({ Alice: [6, 6, 6], Bob: [3, 2, 1], Chloé: [1, 2, 3] });
settleRound(tiedWeakest);
assert.equal(tiedWeakest.players.Chloé.score, 24);
assert.equal(tiedWeakest.players.Bob.score, 24);
assert.equal(tiedWeakest.players.Alice.score, 15);

const drawnRound = roomWith({ Alice: [3, 3, 2], Bob: [3, 3, 2] });
settleRound(drawnRound);
assert.equal(drawnRound.players.Alice.score, 21);
assert.equal(drawnRound.players.Bob.score, 21);
assert.deepEqual(drawnRound.roundResult.transfers, []);

console.log('Game rules: all tests passed');
