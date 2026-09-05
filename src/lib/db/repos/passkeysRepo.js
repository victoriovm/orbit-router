import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToPasskey(row, { includeCredential = false } = {}) {
  if (!row) return null;
  const passkey = {
    id: row.credentialId,
    name: row.name,
    transports: parseJson(row.transports, []),
    deviceType: row.deviceType || null,
    backedUp: row.backedUp === 1 || row.backedUp === true,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt || null,
  };

  if (includeCredential) {
    passkey.publicKey = row.publicKey;
    passkey.counter = Number(row.counter) || 0;
  }

  return passkey;
}

export async function getPasskeys() {
  const db = await getAdapter();
  return db
    .all(`SELECT * FROM passkeys ORDER BY createdAt ASC`)
    .map((row) => rowToPasskey(row));
}

export async function getPasskeyCount() {
  const db = await getAdapter();
  return Number(db.get(`SELECT COUNT(*) AS count FROM passkeys`)?.count) || 0;
}

export async function getPasskeyByCredentialId(credentialId) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM passkeys WHERE credentialId = ?`, [credentialId]);
  return rowToPasskey(row, { includeCredential: true });
}

export async function createPasskey(passkey) {
  const db = await getAdapter();
  db.run(
    `INSERT INTO passkeys(
      credentialId, publicKey, counter, transports, deviceType,
      backedUp, name, createdAt, lastUsedAt
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      passkey.id,
      passkey.publicKey,
      Number(passkey.counter) || 0,
      stringifyJson(passkey.transports || []),
      passkey.deviceType || null,
      passkey.backedUp ? 1 : 0,
      passkey.name,
      passkey.createdAt,
      passkey.lastUsedAt || null,
    ]
  );
  return rowToPasskey({
    credentialId: passkey.id,
    ...passkey,
    transports: stringifyJson(passkey.transports || []),
    backedUp: passkey.backedUp ? 1 : 0,
  });
}

export async function updatePasskeyUsage(credentialId, { counter, deviceType, backedUp }) {
  const db = await getAdapter();
  const lastUsedAt = new Date().toISOString();
  db.run(
    `UPDATE passkeys
     SET counter = ?, deviceType = ?, backedUp = ?, lastUsedAt = ?
     WHERE credentialId = ?`,
    [Number(counter) || 0, deviceType || null, backedUp ? 1 : 0, lastUsedAt, credentialId]
  );
  return lastUsedAt;
}

export async function deletePasskey(credentialId) {
  const db = await getAdapter();
  const result = db.run(`DELETE FROM passkeys WHERE credentialId = ?`, [credentialId]);
  return (result?.changes ?? 0) > 0;
}
