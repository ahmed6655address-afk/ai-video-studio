import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createDb } from './db.js';
import { ensureOwner, parseCookies, SESSION_COOKIE, userFromToken } from './auth.js';
import { adminRouter, publicPlansRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { projectsRouter } from './routes/projects.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "media-src 'self' https: blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );
  next();
}

/**
 * Cookie-based sessions are additionally protected against CSRF by requiring a
 * JSON content type and a custom header on every mutating request.
 */
function csrfGuard(req, res, next) {
  if (!MUTATING.has(req.method)) return next();
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.includes('application/json')) {
    return res.status(415).json({ error: 'UNSUPPORTED_MEDIA_TYPE', messageAr: 'يجب إرسال الطلب بصيغة JSON.' });
  }
  if (req.get('x-requested-with') !== 'ai-video-studio') {
    return res.status(403).json({ error: 'CSRF_REJECTED', messageAr: 'طلب غير موثوق.' });
  }
  return next();
}

export function createApp(options = {}) {
  const dataDir = process.env.DATA_DIR || path.join(ROOT, 'data');
  const dbFile = options.dbFile || process.env.DATABASE_FILE || path.join(dataDir, 'studio.db');
  const db = createDb(dbFile);
  const owner = ensureOwner(db, { log: (msg) => console.log(msg) });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(express.json({ limit: '1mb' }));

  app.use((req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    req.user = userFromToken(db, cookies[SESSION_COOKIE]);
    next();
  });

  const requireAuth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED', messageAr: 'يجب تسجيل الدخول.' });
    next();
  };
  const requireStaff = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    if (req.user.role !== 'owner' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'FORBIDDEN', messageAr: 'هذه الصفحة مخصصة للإدارة.' });
    }
    next();
  };

  const api = express.Router();
  api.use(csrfGuard);
  api.get('/health', (req, res) =>
    res.json({
      status: 'ok',
      app: 'AI VIDEO STUDIO',
      database: 'sqlite',
      ownerConfigured: Boolean(owner?.id),
      time: new Date().toISOString(),
    })
  );
  api.use('/auth', authRouter(db));
  api.use(publicPlansRouter(db));
  api.use(projectsRouter(db));
  api.use('/admin', requireStaff, adminRouter(db));

  api.use((req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  api.use((err, req, res, next) => {
    console.error('[api-error]', err?.message || err);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({
      error: err.code || 'INTERNAL_ERROR',
      messageAr: err.status && err.status < 500 ? err.message : 'حدث خطأ غير متوقع في الخادم.',
    });
  });

  app.use('/api', api);

  const distDir = path.join(ROOT, 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    app.get('/', (req, res) =>
      res
        .status(200)
        .type('html')
        .send('<h1>AI VIDEO STUDIO</h1><p>واجهة المستخدم غير مبنية بعد. شغّل <code>npm run build</code>.</p>')
    );
  }

  app.locals.db = db;
  app.locals.owner = owner;
  return app;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  const port = Number(process.env.PORT) || 3000;
  const app = createApp();
  app.listen(port, '0.0.0.0', () => {
    console.log(`[AI VIDEO STUDIO] listening on http://0.0.0.0:${port}`);
    if (app.locals.owner?.password) {
      console.log('[owner] generated password (change it after first login):', app.locals.owner.password);
    }
  });
}

export default createApp;
