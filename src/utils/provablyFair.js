// src/utils/provablyFair.js
const crypto = require('crypto');

const HOUSE_EDGE = parseFloat(process.env.HOUSE_EDGE) || 0.03;

/**
 * Generate a random server seed
 */
function generateServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a client seed (public, shown to players)
 */
function generateClientSeed() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Hash the server seed — this is published BEFORE the round
 * so players can verify later it wasn't changed
 */
function hashServerSeed(serverSeed) {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
}

/**
 * Generate crash point using provably fair algorithm
 *
 * Uses: SHA-256(serverSeed + clientSeed + nonce)
 * Converts hash to a crash multiplier with house edge applied
 *
 * @param {string} serverSeed
 * @param {string} clientSeed
 * @param {number} nonce - round number
 * @returns {number} crash point (e.g. 1.45, 3.21, 22.5)
 */
function generateCrashPoint(serverSeed, clientSeed, nonce) {
  // Combine inputs
  const input = `${serverSeed}:${clientSeed}:${nonce}`;

  // SHA-256 hash
  const hash = crypto.createHash('sha256').update(input).digest('hex');

  // Take first 8 characters of hash → convert to integer
  const hashInt = parseInt(hash.slice(0, 8), 16);

  // Maximum possible value for 8 hex chars
  const maxInt = 0xffffffff;

  // Convert to a float between 0 and 1
  const randomFloat = hashInt / maxInt;

  // Apply house edge and calculate crash point
  // Formula: 0.99 / (1 - r) — produces natural crash distribution
  // House edge reduces payout slightly (99% instead of 100%)
  const houseMultiplier = 1 - HOUSE_EDGE; // e.g. 0.97

  // If random < house edge → instant crash at 1.00 (house wins)
  if (randomFloat < HOUSE_EDGE) {
    return 1.00;
  }

  // Otherwise calculate crash point
  const crashPoint = houseMultiplier / (1 - randomFloat);

  // Round to 2 decimal places, minimum 1.00
  return Math.max(1.00, Math.floor(crashPoint * 100) / 100);
}

/**
 * Verify a crash point — players can use this to check fairness
 * Returns true if the crash point matches what the seeds produce
 */
function verifyCrashPoint(serverSeed, clientSeed, nonce, claimedCrashPoint) {
  const calculated = generateCrashPoint(serverSeed, clientSeed, nonce);
  return Math.abs(calculated - claimedCrashPoint) < 0.01;
}

module.exports = {
  generateServerSeed,
  generateClientSeed,
  hashServerSeed,
  generateCrashPoint,
  verifyCrashPoint,
};
