import express from 'express';
import { canUseTool, getEntitlements, monthlyUsage } from '../entitlements.js';
import {
  ProviderNotConnectedError,
  TOOL_DEFINITIONS,
  TOOL_IDS,
  createAdapter,
  providerStatus,
  publicTools,
} from '../providers.js';

const MAX_PROMPT = 2000;

function parseOptions(def, raw) {
  const options = {};
  if (!raw || typeof raw !== 'object') return options;
  for (const field of def.options || []) {
    const value = raw[field.key];
    if (value === undefined || value === null || value === '') continue;
    if (field.type === 'select' && !field.choices.includes(String(value))) continue;
    options[field.key] = String(value).slice(0, 80);
  }
  return options;
}

export function projectsRouter(db) {
  const router = express.Router();

  router.get('/tools', (req, res) => {
    res.json({ tools: publicTools(), providers: providerStatus() });
  });

  router.get('/dashboard', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    const entitlements = getEntitlements(db, req.user);
    const recent = db
      .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 5')
      .all(req.user.id);
    const total = db.prepare('SELECT COUNT(*) AS c FROM projects WHERE user_id = ?').get(req.user.id).c;
    const byStatus = db
      .prepare('SELECT status, COUNT(*) AS c FROM projects WHERE user_id = ? GROUP BY status')
      .all(req.user.id);
    res.json({
      entitlements,
      recentProjects: recent.map(serializeProject),
      totals: { projects: total, byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.c])) },
      tools: publicTools(),
      providers: providerStatus(),
    });
  });

  router.post('/projects', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });

      const { tool, prompt, negativePrompt, options, imageUrl } = req.body || {};
      if (!TOOL_IDS.includes(tool)) {
        return res.status(400).json({ error: 'INVALID_TOOL', messageAr: 'أداة غير معروفة.' });
      }
      const def = TOOL_DEFINITIONS[tool];
      const cleanPrompt = String(prompt || '').trim();
      if (cleanPrompt.length < 6) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', fields: { prompt: 'الوصف قصير جدًا (٦ أحرف على الأقل).' } });
      }
      if (cleanPrompt.length > MAX_PROMPT) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', fields: { prompt: `الوصف أطول من ${MAX_PROMPT} حرف.` } });
      }
      if (def.requiresImage && !String(imageUrl || '').trim()) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', fields: { imageUrl: 'هذه الأداة تتطلب رابط صورة.' } });
      }

      // Server-side authorization: never trust the client for plan/role/quota.
      const entitlements = getEntitlements(db, req.user);
      const gate = canUseTool(entitlements, tool);
      if (!gate.allowed) {
        const status = gate.code === 'QUOTA_EXCEEDED' ? 429 : 402;
        return res.status(status).json({
          error: gate.code,
          messageAr: gate.messageAr,
          entitlements,
        });
      }

      const now = new Date().toISOString();
      const cleanOptions = parseOptions(def, options);
      const info = db
        .prepare(
          `INSERT INTO projects (user_id, tool, prompt, negative_prompt, options, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pending_provider', ?, ?)`
        )
        .run(
          req.user.id,
          tool,
          cleanPrompt,
          negativePrompt ? String(negativePrompt).slice(0, MAX_PROMPT) : null,
          JSON.stringify(cleanOptions),
          now,
          now
        );

      const projectId = info.lastInsertRowid;
      // The quota is consumed by the accepted request itself, not by a successful
      // provider callback — otherwise limits could never be enforced while no
      // provider is connected.
      db.prepare(
        "INSERT INTO usage_events (user_id, tool, project_id, kind, created_at) VALUES (?, ?, ?, 'generation', ?)"
      ).run(req.user.id, tool, projectId, now);

      const adapter = createAdapter(tool);
      let status = 'pending_provider';
      let message = 'تم حفظ الطلب. هذه الأداة غير متصلة بمزوّد ذكاء اصطناعي بعد، لذلك لم يتم توليد فيديو.';

      if (adapter.connected) {
        try {
          const result = await adapter.submit({ prompt: cleanPrompt, options: cleanOptions, imageUrl });
          db.prepare(
            "UPDATE projects SET status = 'queued', provider = ?, provider_job_id = ?, updated_at = ? WHERE id = ?"
          ).run(def.providerLabel, result.jobId, new Date().toISOString(), projectId);
          db.prepare(
            "INSERT INTO usage_events (user_id, tool, project_id, kind, created_at) VALUES (?, ?, ?, 'generation', ?)"
          ).run(req.user.id, tool, projectId, new Date().toISOString());
          status = 'queued';
          message = 'تم إرسال الطلب إلى المزوّد.';
        } catch (err) {
          db.prepare(
            "UPDATE projects SET status = 'failed', provider = ?, error_message = ?, updated_at = ? WHERE id = ?"
          ).run(def.providerLabel, String(err.message).slice(0, 300), new Date().toISOString(), projectId);
          status = 'failed';
          message = 'تعذّر إرسال الطلب إلى المزوّد.';
        }
      }

      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      res.status(201).json({
        project: serializeProject(project),
        providerConnected: adapter.connected,
        messageAr: message,
        entitlements: getEntitlements(db, req.user),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/projects', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    const { tool, status } = req.query;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const clauses = ['user_id = ?'];
    const params = [req.user.id];
    if (tool && TOOL_IDS.includes(String(tool))) {
      clauses.push('tool = ?');
      params.push(String(tool));
    }
    if (status) {
      clauses.push('status = ?');
      params.push(String(status));
    }
    const where = clauses.join(' AND ');
    const rows = db
      .prepare(`SELECT * FROM projects WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) AS c FROM projects WHERE ${where}`).get(...params).c;
    res.json({ projects: rows.map(serializeProject), total, limit, offset });
  });

  router.get('/projects/:id', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params.id));
    if (!project) return res.status(404).json({ error: 'NOT_FOUND' });
    const isOwnerOfProject = project.user_id === req.user.id;
    const isStaff = req.user.role === 'owner' || req.user.role === 'admin';
    if (!isOwnerOfProject && !isStaff) return res.status(403).json({ error: 'FORBIDDEN' });
    res.json({ project: serializeProject(project) });
  });

  router.delete('/projects/:id', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params.id));
    if (!project) return res.status(404).json({ error: 'NOT_FOUND' });
    const isStaff = req.user.role === 'owner' || req.user.role === 'admin';
    if (project.user_id !== req.user.id && !isStaff) return res.status(403).json({ error: 'FORBIDDEN' });
    db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
    res.json({ ok: true });
  });

  router.get('/usage', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    res.json({ usage: monthlyUsage(db, req.user.id), entitlements: getEntitlements(db, req.user) });
  });

  return router;
}

export function serializeProject(row) {
  if (!row) return null;
  let options = {};
  try {
    options = JSON.parse(row.options || '{}');
  } catch {
    options = {};
  }
  return {
    id: row.id,
    tool: row.tool,
    toolNameAr: TOOL_DEFINITIONS[row.tool]?.nameAr || row.tool,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    options,
    status: row.status,
    provider: row.provider,
    providerJobId: row.provider_job_id,
    outputUrl: row.output_url,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export { ProviderNotConnectedError };
