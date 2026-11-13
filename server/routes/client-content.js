import express from 'express';

const CATEGORIES = ['الرعب والغموض','التاريخ','تعليم الأطفال','النصائح والتحفيز','التحقيقات والألغاز','الخيال العلمي','الكوميديا والترفيه','الطبيعة والوثائقيات','المال والأعمال','الطبخ والحياة اليومية','الرياضة والسفر والثقافة'];
const ACTIVE_SQL = "status = 'active' AND starts_at <= ? AND expires_at > ?";

function subscriptionFor(db, userId) {
  const now = new Date().toISOString();
  return db.prepare(`SELECT * FROM client_content_subscriptions WHERE user_id = ? AND ${ACTIVE_SQL} ORDER BY expires_at DESC LIMIT 1`).get(userId, now, now) || null;
}
function hasServiceAccess(req, db) {
  return ['owner','admin'].includes(req.user.role) || Boolean(subscriptionFor(db, req.user.id));
}
function logAudit(db, userId, action, projectId = null, details = {}) {
  db.prepare('INSERT INTO client_content_audit (user_id,actor_user_id,project_id,action,details_json,created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, userId, projectId, action, JSON.stringify(details), new Date().toISOString());
}
function safeProject(row) {
  return { id: row.id, title: row.title, creationMode: row.creation_mode, category: row.category, brief: row.brief,
    language: row.language, dialect: row.dialect, voiceProfile: JSON.parse(row.voice_profile || '{}'),
    musicChoice: row.music_choice, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function clientContentRouter(db) {
  const router = express.Router();
  router.get('/client-content', (req,res) => {
    if (!req.user) return res.status(401).json({error:'UNAUTHENTICATED'});
    const subscription = subscriptionFor(db, req.user.id);
    const projects = db.prepare('SELECT * FROM client_content_projects WHERE user_id=? ORDER BY updated_at DESC LIMIT 50').all(req.user.id);
    const ideas = db.prepare('SELECT id,category,title,description,language FROM client_content_ideas WHERE is_active=1 ORDER BY category,id').all();
    res.json({ serviceAccess: hasServiceAccess(req,db), subscription: subscription ? {status:subscription.status,planCode:subscription.plan_code,expiresAt:subscription.expires_at} : null,
      categories:CATEGORIES, ideas, projects:projects.map(safeProject) });
  });

  router.post('/client-content/projects', (req,res) => {
    if (!req.user) return res.status(401).json({error:'UNAUTHENTICATED'});
    if (!hasServiceAccess(req,db)) return res.status(402).json({error:'CLIENT_CONTENT_SUBSCRIPTION_REQUIRED',messageAr:'تحتاج إلى اشتراك مستقل في خدمة إدارة ونشر المحتوى.'});
    const body=req.body||{};
    const title=String(body.title||'').trim();
    const mode=String(body.creationMode||'');
    const brief=String(body.brief||'').trim();
    const language=String(body.language||'ar').trim();
    const dialect=String(body.dialect||'').trim();
    const musicChoice=String(body.musicChoice||'none');
    const allowedMusic=['none','licensed_library','original_generated','client_upload'];
    if(title.length<3||title.length>100||!['custom','suggested'].includes(mode)||brief.length>4000||language.length>16||dialect.length>60||!allowedMusic.includes(musicChoice))
      return res.status(400).json({error:'VALIDATION_ERROR',messageAr:'راجع عنوان المشروع وطريقة الإنشاء والإعدادات.'});
    const ideaId=body.ideaId==null?null:Number(body.ideaId);
    const selectedIdea = mode==='suggested' && Number.isInteger(ideaId)
      ? db.prepare('SELECT id,category FROM client_content_ideas WHERE id=? AND is_active=1').get(ideaId)
      : null;
    if(mode==='suggested' && !selectedIdea)
      return res.status(400).json({error:'INVALID_IDEA',messageAr:'الفكرة المختارة غير متاحة.'});
    if(mode==='suggested' && body.category && body.category !== selectedIdea.category)
      return res.status(400).json({error:'IDEA_CATEGORY_MISMATCH',messageAr:'التصنيف لا يطابق الفكرة المختارة.'});
    const projectCategory = selectedIdea?.category || (body.category && CATEGORIES.includes(body.category) ? body.category : null);
    if(body.category && !projectCategory)
      return res.status(400).json({error:'INVALID_CATEGORY',messageAr:'التصنيف المختار غير متاح.'});
    if(musicChoice==='client_upload' && String(body.musicRightsNote||'').trim().length<10)
      return res.status(400).json({error:'MUSIC_RIGHTS_REQUIRED',messageAr:'يرجى تأكيد امتلاك حقوق استخدام الملف الموسيقي.'});
    const voiceProfile = body.voiceProfile && typeof body.voiceProfile==='object' && !Array.isArray(body.voiceProfile) ? body.voiceProfile : {};
    if(JSON.stringify(voiceProfile).length>3000)
      return res.status(400).json({error:'VOICE_PROFILE_TOO_LARGE'});
    if(mode==='custom' && brief.length<10) return res.status(400).json({error:'BRIEF_REQUIRED',messageAr:'اكتب وصفاً للفكرة لا يقل عن 10 أحرف.'});
    const now=new Date().toISOString();
    const tx=db.transaction(()=>{
      const info=db.prepare(`INSERT INTO client_content_projects(user_id,title,creation_mode,category,idea_id,brief,language,dialect,voice_profile,music_choice,music_rights_note,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id,title,mode,projectCategory,ideaId,brief,language,dialect,
          JSON.stringify(voiceProfile),musicChoice,String(body.musicRightsNote||'').slice(0,500),now,now);
      const projectId=Number(info.lastInsertRowid);
      const calendarInsert=db.prepare('INSERT INTO client_content_calendar_days(project_id,user_id,day_number,planned_date,created_at) VALUES(?,?,?,?,?)');
      const calendarStart = new Date(now);
      calendarStart.setUTCHours(0,0,0,0);
      for(let day=0;day<60;day++) { const date=new Date(calendarStart); date.setUTCDate(calendarStart.getUTCDate()+day); calendarInsert.run(projectId,req.user.id,day+1,date.toISOString().slice(0,10),now); }
      const episodes=Array.isArray(body.episodes)?body.episodes.slice(0,120):[];
      const insertEpisode=db.prepare('INSERT INTO client_content_episodes(project_id,user_id,episode_number,title,planned_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
      episodes.forEach((ep,i)=>insertEpisode.run(projectId,req.user.id,i+1,String(ep.title||'').slice(0,120),ep.plannedDate?String(ep.plannedDate).slice(0,30):null,now,now));
      logAudit(db,req.user.id,'project_created',projectId,{creationMode:mode,episodes:episodes.length});
      return projectId;
    });
    const id=tx();
    const project=db.prepare('SELECT * FROM client_content_projects WHERE id=? AND user_id=?').get(id,req.user.id);
    res.status(201).json({project:safeProject(project),messageAr:'تم إنشاء مساحة المشروع. لم يبدأ الإنتاج أو النشر بعد.'});
  });

  router.get('/client-content/projects/:id', (req,res) => {
    if(!req.user) return res.status(401).json({error:'UNAUTHENTICATED'});
    const project=db.prepare('SELECT * FROM client_content_projects WHERE id=? AND user_id=?').get(Number(req.params.id),req.user.id);
    if(!project) return res.status(404).json({error:'NOT_FOUND'});
    const episodes=db.prepare('SELECT id,episode_number,title,script,status,planned_date FROM client_content_episodes WHERE project_id=? AND user_id=? ORDER BY episode_number').all(project.id,req.user.id);
    const approvals=db.prepare('SELECT id,episode_id,approval_type,decision,scope_json,created_at FROM client_content_approvals WHERE project_id=? AND user_id=? ORDER BY id DESC').all(project.id,req.user.id);
    const contentPlanDays=db.prepare('SELECT day_number,planned_date,status FROM client_content_calendar_days WHERE project_id=? AND user_id=? ORDER BY day_number').all(project.id,req.user.id);
    const schedule=db.prepare('SELECT id,episode_id,platform,scheduled_at,status FROM client_content_schedule WHERE project_id=? AND user_id=? ORDER BY scheduled_at LIMIT 200').all(project.id,req.user.id);
    res.json({project:safeProject(project),episodes,approvals,schedule,contentPlanDays});
  });

  router.post('/client-content/projects/:id/episodes', (req,res) => {
    if(!req.user) return res.status(401).json({error:'UNAUTHENTICATED'});
    if(!hasServiceAccess(req,db)) return res.status(402).json({error:'CLIENT_CONTENT_SUBSCRIPTION_REQUIRED'});
    const project=db.prepare('SELECT id FROM client_content_projects WHERE id=? AND user_id=?').get(Number(req.params.id),req.user.id);
    if(!project) return res.status(404).json({error:'NOT_FOUND'});
    const title=String(req.body?.title||'').trim().slice(0,120);
    const script=String(req.body?.script||'').trim().slice(0,12000);
    const number=Number(req.body?.episodeNumber);
    if(!title||!Number.isInteger(number)||number<1||number>500) return res.status(400).json({error:'VALIDATION_ERROR'});
    const now=new Date().toISOString();
    try {
      const info=db.prepare('INSERT INTO client_content_episodes(project_id,user_id,episode_number,title,script,status,planned_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(project.id,req.user.id,number,title,script,script?'script_draft':'idea',req.body?.plannedDate?String(req.body.plannedDate).slice(0,30):null,now,now);
      logAudit(db,req.user.id,'episode_created',project.id,{episodeId:Number(info.lastInsertRowid),episodeNumber:number});
      res.status(201).json({episode:{id:Number(info.lastInsertRowid),episodeNumber:number,title,script,status:script?'script_draft':'idea'}});
    } catch(err) { if(String(err.code).includes('CONSTRAINT')) return res.status(409).json({error:'EPISODE_NUMBER_TAKEN'}); throw err; }
  });

  router.patch('/client-content/projects/:id/episodes/:episodeId', (req,res) => {
    if(!req.user) return res.status(401).json({error:'UNAUTHENTICATED'});
    if(!hasServiceAccess(req,db)) return res.status(402).json({error:'CLIENT_CONTENT_SUBSCRIPTION_REQUIRED'});
    const project=db.prepare('SELECT id FROM client_content_projects WHERE id=? AND user_id=?').get(Number(req.params.id),req.user.id);
    if(!project) return res.status(404).json({error:'NOT_FOUND'});
    const episode=db.prepare('SELECT id,title,script,status FROM client_content_episodes WHERE id=? AND project_id=? AND user_id=?').get(Number(req.params.episodeId),project.id,req.user.id);
    if(!episode) return res.status(404).json({error:'EPISODE_NOT_FOUND'});
    const body=req.body||{};
    const title=body.title===undefined?episode.title:String(body.title).trim();
    const script=body.script===undefined?episode.script:String(body.script).trim();
    const plannedDate=body.plannedDate===undefined?null:(body.plannedDate===null||body.plannedDate===''?null:String(body.plannedDate));
    if(title.length<1||title.length>120||script.length>12000||(plannedDate!==null&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(plannedDate)))
      return res.status(400).json({error:'VALIDATION_ERROR',messageAr:'تحقق من عنوان الحلقة والسيناريو وتاريخ التخطيط.'});
    const now=new Date().toISOString();
    const status=script?'script_draft':'idea';
    db.prepare('UPDATE client_content_episodes SET title=?,script=?,planned_date=?,status=?,updated_at=? WHERE id=? AND project_id=? AND user_id=?')
      .run(title,script,plannedDate,status,now,episode.id,project.id,req.user.id);
    logAudit(db,req.user.id,'episode_updated',project.id,{episodeId:episode.id,status});
    res.json({episode:{id:episode.id,title,script,plannedDate,status},messageAr:'تم حفظ تعديلات الحلقة كمسودة. يلزم اعتماد المحتوى قبل أي نشر.'});
  });

  router.post('/client-content/projects/:id/schedule', (req,res) => {
    if(!req.user) return res.status(401).json({error:'UNAUTHENTICATED'});
    if(!hasServiceAccess(req,db)) return res.status(402).json({error:'CLIENT_CONTENT_SUBSCRIPTION_REQUIRED'});
    const project=db.prepare('SELECT id FROM client_content_projects WHERE id=? AND user_id=?').get(Number(req.params.id),req.user.id);
    if(!project) return res.status(404).json({error:'NOT_FOUND'});
    const {episodeId,platform,scheduledAt}=req.body||{};
    const allowedPlatforms=['tiktok','instagram','youtube','facebook'];
    const instant=typeof scheduledAt==='string' && /(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(scheduledAt) ? Date.parse(scheduledAt) : NaN;
    if(!allowedPlatforms.includes(platform)||!Number.isFinite(instant)||instant<=Date.now()||instant>Date.now()+365*86400000)
      return res.status(400).json({error:'INVALID_SCHEDULE',messageAr:'اختر منصة مدعومة وموعداً مستقبلياً واضح المنطقة الزمنية خلال سنة.'});
    const episode=db.prepare('SELECT id FROM client_content_episodes WHERE id=? AND project_id=? AND user_id=?').get(Number(episodeId),project.id,req.user.id);
    if(!episode) return res.status(404).json({error:'EPISODE_NOT_FOUND'});
    const now=new Date().toISOString();
    const existing=db.prepare("SELECT id FROM client_content_schedule WHERE episode_id=? AND platform=? AND status NOT IN ('canceled','failed')").get(episode.id,platform);
    if(existing) return res.status(409).json({error:'SCHEDULE_ALREADY_EXISTS',messageAr:'توجد جدولة قائمة لهذه الحلقة على المنصة المختارة.'});
    const info=db.prepare("INSERT INTO client_content_schedule(project_id,episode_id,user_id,platform,scheduled_at,status,created_at,updated_at) VALUES(?,?,?,?,?,'awaiting_approval',?,?)")
      .run(project.id,episode.id,req.user.id,platform,new Date(instant).toISOString(),now,now);
    logAudit(db,req.user.id,'schedule_created',project.id,{scheduleId:Number(info.lastInsertRowid),episodeId:episode.id,platform,scheduledAt:new Date(instant).toISOString()});
    res.status(201).json({schedule:{id:Number(info.lastInsertRowid),episodeId:episode.id,platform,scheduledAt:new Date(instant).toISOString(),status:'awaiting_approval'},
      messageAr:'تم حفظ موعد مقترح بانتظار موافقتك. لم يتم جدولة نشر خارجي.'});
  });

  router.delete('/client-content/projects/:id/schedule/:scheduleId', (req,res) => {
    if(!req.user) return res.status(401).json({error:'UNAUTHENTICATED'});
    const project=db.prepare('SELECT id FROM client_content_projects WHERE id=? AND user_id=?').get(Number(req.params.id),req.user.id);
    if(!project) return res.status(404).json({error:'NOT_FOUND'});
    const item=db.prepare('SELECT id,status FROM client_content_schedule WHERE id=? AND project_id=? AND user_id=?').get(Number(req.params.scheduleId),project.id,req.user.id);
    if(!item) return res.status(404).json({error:'SCHEDULE_NOT_FOUND'});
    if(!['draft','awaiting_approval','approved'].includes(item.status)) return res.status(409).json({error:'SCHEDULE_LOCKED'});
    db.prepare("UPDATE client_content_schedule SET status='canceled',updated_at=? WHERE id=?").run(new Date().toISOString(),item.id);
    logAudit(db,req.user.id,'schedule_canceled',project.id,{scheduleId:item.id});
    res.json({messageAr:'تم إلغاء موعد النشر المقترح.'});
  });

  router.post('/client-content/projects/:id/approvals', (req,res) => {
    if(!req.user) return res.status(401).json({error:'UNAUTHENTICATED'});
    const project=db.prepare('SELECT id FROM client_content_projects WHERE id=? AND user_id=?').get(Number(req.params.id),req.user.id);
    if(!project) return res.status(404).json({error:'NOT_FOUND'});
    const {episodeId=null,approvalType,decision,scope={}}=req.body||{};
    const scopeData=scope&&typeof scope==='object'&&!Array.isArray(scope)?scope:{};
    const scheduleId=scopeData.scheduleId===undefined?null:Number(scopeData.scheduleId);
    if(!['script','asset','schedule','publishing_delegation'].includes(approvalType)||!['approved','rejected','revoked'].includes(decision)||
      (episodeId!==null&&!db.prepare('SELECT id FROM client_content_episodes WHERE id=? AND project_id=? AND user_id=?').get(Number(episodeId),project.id,req.user.id))||
      (approvalType==='schedule'&&scheduleId!==null&&(!Number.isInteger(scheduleId)||!db.prepare('SELECT id FROM client_content_schedule WHERE id=? AND project_id=? AND user_id=?').get(scheduleId,project.id,req.user.id))))
      return res.status(400).json({error:'INVALID_APPROVAL'});
    const now=new Date().toISOString();
    const info=db.prepare('INSERT INTO client_content_approvals(project_id,episode_id,user_id,approval_type,decision,scope_json,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(project.id,episodeId,req.user.id,approvalType,decision,JSON.stringify(scopeData),now);
    if(approvalType==='schedule') {
      const nextStatus=decision==='approved'?'approved':decision==='revoked'?'awaiting_approval':'canceled';
      if(scheduleId!==null) db.prepare("UPDATE client_content_schedule SET status=?,updated_at=? WHERE id=? AND project_id=? AND user_id=? AND status IN ('awaiting_approval','approved')").run(nextStatus,now,scheduleId,project.id,req.user.id);
      else if(episodeId===null) db.prepare("UPDATE client_content_schedule SET status=?,updated_at=? WHERE project_id=? AND user_id=? AND status IN ('awaiting_approval','approved')").run(nextStatus,now,project.id,req.user.id);
      else db.prepare("UPDATE client_content_schedule SET status=?,updated_at=? WHERE project_id=? AND user_id=? AND episode_id=? AND status IN ('awaiting_approval','approved')").run(nextStatus,now,project.id,req.user.id,Number(episodeId));
    }
    logAudit(db,req.user.id,'approval_recorded',project.id,{approvalId:Number(info.lastInsertRowid),approvalType,decision});
    res.status(201).json({approvalId:Number(info.lastInsertRowid),decision,messageAr:'تم تسجيل قرار الموافقة. لا ينفذ هذا الإجراء نشراً خارجياً.'});
  });
  return router;
}
