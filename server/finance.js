import crypto from 'node:crypto';

export const FAL_VIDEO_RATE_CENTS_PER_SECOND = 10;
export const GENERATION_COST_BUFFER_BPS = 2000;

export function estimateGenerationCostCents(tool, options = {}) {
  if (tool !== 'text_video') return null;
  const raw = Number.parseInt(String(options.duration || '8s'), 10);
  const seconds = Number.isInteger(raw) ? Math.min(15, Math.max(2, raw)) : 8;
  const base = seconds * FAL_VIDEO_RATE_CENTS_PER_SECOND;
  return Math.ceil(base * (10000 + GENERATION_COST_BUFFER_BPS) / 10000);
}

export function providerWalletSummary(db) {
  const credits = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM provider_wallet_ledger WHERE entry_type = 'credit'").get().total;
  const debits = db.prepare("SELECT COALESCE(SUM(-amount_cents), 0) AS total FROM provider_wallet_ledger WHERE entry_type = 'debit'").get().total;
  const held = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM provider_wallet_reservations WHERE status = 'reserved'").get().total;
  return { currency: 'USD', creditedCents: credits, spentCents: debits, reservedCents: held, availableCents: credits - debits - held };
}

export function creditProviderWallet(db, { amountCents, reference, note, userId }) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 100000000) {
    const error = new Error('INVALID_AMOUNT'); error.code = 'INVALID_AMOUNT'; throw error;
  }
  const cleanRef = String(reference || '').trim().slice(0, 100);
  if (cleanRef.length < 4) { const error = new Error('INVALID_REFERENCE'); error.code = 'INVALID_REFERENCE'; throw error; }
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO provider_wallet_ledger (id, amount_cents, entry_type, reference, note, created_by, created_at)
    VALUES (?, ?, 'credit', ?, ?, ?, ?)`).run(crypto.randomUUID(), amountCents, cleanRef, String(note || '').slice(0, 300), userId, now);
  return providerWalletSummary(db);
}

export function reserveGenerationFunds(db, { projectId, tool, options }) {
  const amountCents = estimateGenerationCostCents(tool, options);
  if (amountCents === null) return { allowed: false, code: 'COST_POLICY_MISSING', amountCents: null };
  const tx = db.transaction(() => {
    const wallet = providerWalletSummary(db);
    if (wallet.availableCents < amountCents) return { allowed: false, code: 'INSUFFICIENT_PROVIDER_FUNDS', amountCents, wallet };
    db.prepare(`INSERT INTO provider_wallet_reservations (project_id, amount_cents, status, created_at, updated_at)
      VALUES (?, ?, 'reserved', ?, ?)`).run(projectId, amountCents, new Date().toISOString(), new Date().toISOString());
    return { allowed: true, amountCents, wallet: providerWalletSummary(db) };
  });
  return tx();
}

export function settleGenerationFunds(db, projectId) {
  const tx = db.transaction(() => {
    const reservation = db.prepare("SELECT * FROM provider_wallet_reservations WHERE project_id = ?").get(projectId);
    if (!reservation || reservation.status !== 'reserved') return false;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO provider_wallet_ledger (id, amount_cents, entry_type, reference, note, created_at)
      VALUES (?, ?, 'debit', ?, ?, ?)`).run(crypto.randomUUID(), -reservation.amount_cents, `generation:${projectId}`, 'Accepted by AI provider', now);
    db.prepare("UPDATE provider_wallet_reservations SET status = 'charged', updated_at = ? WHERE project_id = ?").run(now, projectId);
    return true;
  });
  return tx();
}

export function releaseGenerationFunds(db, projectId, reason, userId) {
  const cleanReason = String(reason || '').trim().slice(0, 300);
  if (cleanReason.length < 8) { const error = new Error('RELEASE_REASON_REQUIRED'); error.code = 'RELEASE_REASON_REQUIRED'; throw error; }
  const tx = db.transaction(() => {
    const reservation = db.prepare("SELECT * FROM provider_wallet_reservations WHERE project_id = ?").get(projectId);
    if (!reservation || reservation.status !== 'reserved') return false;
    const now = new Date().toISOString();
    db.prepare("UPDATE provider_wallet_reservations SET status = 'released', updated_at = ?, release_reason = ?, released_by = ? WHERE project_id = ?")
      .run(now, cleanReason, userId, projectId);
    return true;
  });
  return tx();
}
