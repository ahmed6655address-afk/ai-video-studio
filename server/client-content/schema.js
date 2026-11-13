export const CLIENT_CONTENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS client_content_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','active','past_due','expired','canceled')),
  plan_code TEXT NOT NULL,
  starts_at TEXT,
  expires_at TEXT,
  payment_ref TEXT,
  activated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cc_sub_user_status ON client_content_subscriptions(user_id,status,expires_at);
CREATE TABLE IF NOT EXISTS client_content_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  creation_mode TEXT NOT NULL CHECK (creation_mode IN ('custom','suggested')),
  category TEXT,
  idea_id INTEGER,
  brief TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'ar',
  dialect TEXT NOT NULL DEFAULT '',
  voice_profile TEXT NOT NULL DEFAULT '{}',
  music_choice TEXT NOT NULL DEFAULT 'none',
  music_rights_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','in_production','active','paused','completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cc_projects_user ON client_content_projects(user_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS client_content_ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'ar',
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS client_content_calendar_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES client_content_projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL,
  planned_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','content_in_preparation','ready','published','paused')),
  created_at TEXT NOT NULL,
  UNIQUE(project_id,day_number),
  UNIQUE(project_id,planned_date)
);
CREATE INDEX IF NOT EXISTS idx_cc_calendar_user_date ON client_content_calendar_days(user_id,planned_date);
CREATE TABLE IF NOT EXISTS client_content_episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES client_content_projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  script TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','script_draft','script_review','approved','in_production','asset_review','ready_to_schedule','scheduled','publishing','published','failed','paused')),
  planned_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id,episode_number)
);
CREATE INDEX IF NOT EXISTS idx_cc_episodes_project ON client_content_episodes(project_id,episode_number);
CREATE TABLE IF NOT EXISTS client_content_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES client_content_projects(id) ON DELETE CASCADE,
  episode_id INTEGER REFERENCES client_content_episodes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  approval_type TEXT NOT NULL CHECK (approval_type IN ('script','asset','schedule','publishing_delegation')),
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected','revoked')),
  scope_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS client_content_publish_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES client_content_projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('tiktok','instagram','youtube','facebook')),
  account_label TEXT NOT NULL DEFAULT '',
  connection_status TEXT NOT NULL DEFAULT 'not_connected' CHECK (connection_status IN ('not_connected','pending_oauth','connected','revoked','error')),
  external_account_id TEXT,
  token_ciphertext TEXT,
  token_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id,platform,external_account_id)
);
CREATE TABLE IF NOT EXISTS client_content_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES client_content_projects(id) ON DELETE CASCADE,
  episode_id INTEGER REFERENCES client_content_episodes(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','awaiting_approval','approved','queued','publishing','published','failed','canceled')),
  external_post_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cc_schedule_user_date ON client_content_schedule(user_id,scheduled_at);
CREATE TABLE IF NOT EXISTS client_content_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id),
  project_id INTEGER REFERENCES client_content_projects(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
`;

export function seedClientContentIdeas(db) {
  const ideas = [
    ['الرعب والغموض','الرسالة التي وصلت عند منتصف الليل','سلسلة خيالية قصيرة بأحداث مترابطة'],
    ['التاريخ','محطات من تاريخ المدن','حلقات توثيقية تحتاج مراجعة المصادر'],
    ['تعليم الأطفال','مغامرات الحروف والأرقام','تعليم مبسط مناسب للفئة العمرية'],
    ['النصائح والتحفيز','عادة صغيرة كل يوم','نصائح عملية غير مبالغ فيها'],
    ['التحقيقات والألغاز','لغز في كل حلقة','ألغاز ترفيهية خيالية'],
    ['الخيال العلمي','رحلة إلى محطة بعيدة','سلسلة خيال علمي متصلة'],
    ['الكوميديا والترفيه','مواقف يومية طريفة','مشاهد كوميدية قصيرة'],
    ['الطبيعة والوثائقيات','عجائب العالم الطبيعي','محتوى معلوماتي يتطلب التحقق'],
    ['المال والأعمال','مفاهيم مالية للمبتدئين','معلومات عامة دون نصائح استثمارية شخصية'],
    ['الطبخ والحياة اليومية','وصفات بخطوات واضحة','محتوى عملي قابل للتصوير']
  ];
  const insert = db.prepare('INSERT INTO client_content_ideas (category,title,description) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM client_content_ideas WHERE title=?)');
  const tx = db.transaction(() => ideas.forEach(([category,title,description]) => insert.run(category,title,description,title)));
  tx();
}
