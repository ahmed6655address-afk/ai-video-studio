import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const EMPTY = { title:'', creationMode:'custom', category:'', ideaId:'', brief:'', language:'ar', dialect:'', musicChoice:'none', musicRightsNote:'', voiceProfile:{gender:'neutral',tone:'natural',speed:'normal',voiceIdentity:''} };

export default function ClientContent() {
  const [data,setData]=useState(null);
  const [form,setForm]=useState(EMPTY);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [detail,setDetail]=useState(null);
  const [scheduleForm,setScheduleForm]=useState({episodeId:'',platform:'youtube',scheduledAt:''});
  const [episodeForm,setEpisodeForm]=useState({id:null,episodeNumber:1,title:'',script:'',plannedDate:''});
  const load=async()=>{ try { setData(await api('/client-content')); } catch(e) { setError(e.message); } };
  useEffect(()=>{ load(); },[]);
  const update=(key,value)=>setForm(prev=>({...prev,[key]:value}));
  const ideas=(data?.ideas||[]).filter(i=>!form.category||i.category===form.category);
  const submit=async(e)=>{
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result=await api('/client-content/projects',{method:'POST',body:{...form,ideaId:form.ideaId?Number(form.ideaId):null}});
      setNotice(result.messageAr); setForm(EMPTY); await load();
    } catch(err) { setError(err.message); } finally { setBusy(false); }
  };
  const openProject=async(id)=>{
    setError('');
    try { const result=await api('/client-content/projects/'+id); setDetail(result); setScheduleForm(prev=>({...prev,episodeId:result.episodes[0]?.id?String(result.episodes[0].id):''})); setEpisodeForm({id:null,episodeNumber:Math.max(0,...result.episodes.map(ep=>ep.episode_number))+1,title:'',script:'',plannedDate:''}); }
    catch(err){setError(err.message);}
  };
  const saveEpisode=async(e)=>{
    e.preventDefault(); setError(''); setNotice('');
    const body={title:episodeForm.title,script:episodeForm.script,plannedDate:episodeForm.plannedDate||null};
    try {
      if(episodeForm.id) await api('/client-content/projects/'+detail.project.id+'/episodes/'+episodeForm.id,{method:'PATCH',body});
      else await api('/client-content/projects/'+detail.project.id+'/episodes',{method:'POST',body:{...body,episodeNumber:Number(episodeForm.episodeNumber)}});
      setNotice(episodeForm.id?'تم حفظ تعديلات الحلقة كمسودة.':'تمت إضافة الحلقة كمسودة.');
      await openProject(detail.project.id);
    } catch(err){setError(err.message);}
  };
  const editEpisode=(ep)=>{
    setEpisodeForm({id:ep.id,episodeNumber:ep.episode_number,title:ep.title||'',script:ep.script||'',plannedDate:ep.planned_date||''});
  };
  const createSchedule=async(e)=>{
    e.preventDefault(); setError(''); setNotice('');
    try {
      await api('/client-content/projects/'+detail.project.id+'/schedule',{method:'POST',body:{episodeId:Number(scheduleForm.episodeId),platform:scheduleForm.platform,scheduledAt:new Date(scheduleForm.scheduledAt).toISOString()}});
      setNotice('تم حفظ مقترح الموعد بانتظار الموافقة. لم يتم النشر.'); await openProject(detail.project.id);
    } catch(err){setError(err.message);}
  };
  const decideSchedule=async(decision,scheduleId,episodeId)=>{
    setError('');
    try {
      await api('/client-content/projects/'+detail.project.id+'/approvals',{method:'POST',body:{episodeId,approvalType:'schedule',decision,scope:{scheduleId,source:'client_workspace'}}});
      await openProject(detail.project.id);
    } catch(err){setError(err.message);}
  };
  if(!data&&!error) return <section className="card card-pad"><p>جارٍ تحميل مساحة إدارة المحتوى…</p></section>;
  return <div className="page-stack" dir="rtl">
    <section className="card card-pad">
      <div className="row-between" style={{gap:12,flexWrap:'wrap'}}>
        <div><p className="eyebrow">خدمة مستقلة عن توليد الفيديو</p><h1 className="page-title">إدارة ونشر محتوى العملاء</h1><p className="muted">خطط القصص والحلقات، جهّز المحتوى، وراجع الموافقات من مساحة واحدة.</p></div>
        <span className={data?.serviceAccess?'badge badge-success':'badge badge-info'}>{data?.serviceAccess?'الخدمة متاحة':'تحتاج اشتراكاً مستقلاً'}</span>
      </div>
      {!data?.serviceAccess&&<div className="notice notice-info" style={{marginTop:16}}><strong>اشتراك النشر منفصل</strong><p>يمكنك استكشاف الواجهة ومكتبة الأفكار. إنشاء المشاريع يتطلب تفعيل اشتراك إدارة ونشر المحتوى. لا يوجد دفع أو تفعيل آلي في هذه النسخة التجريبية.</p></div>}
    </section>
    {error&&<div className="notice notice-error" role="alert">{error}</div>}
    {notice&&<div className="notice notice-success" role="status">{notice}</div>}
    <section className="card card-pad">
      <h2 className="section-title">إنشاء مساحة محتوى جديدة</h2>
      <form onSubmit={submit} className="form-grid">
        <label className="field"><span>اسم المشروع أو السلسلة</span><input required minLength="3" maxLength="100" value={form.title} onChange={e=>update('title',e.target.value)} placeholder="مثال: حكايات من التاريخ"/></label>
        <label className="field"><span>طريقة إنشاء المحتوى</span><select value={form.creationMode} onChange={e=>update('creationMode',e.target.value)}><option value="custom">محتوى مخصص من فكرتي</option><option value="suggested">اختيار فكرة مقترحة</option></select></label>
        <label className="field"><span>التصنيف</span><select value={form.category} onChange={e=>{update('category',e.target.value);update('ideaId','');}}><option value="">كل التصنيفات</option>{(data?.categories||[]).map(c=><option key={c}>{c}</option>)}</select></label>
        {form.creationMode==='suggested'?<label className="field"><span>الفكرة المقترحة</span><select required value={form.ideaId} onChange={e=>update('ideaId',e.target.value)}><option value="">اختر فكرة</option>{ideas.map(i=><option key={i.id} value={i.id}>{i.title} — {i.category}</option>)}</select></label>:<label className="field field-full"><span>اشرح فكرتك والجمهور والأسلوب</span><textarea required minLength="10" maxLength="4000" rows="4" value={form.brief} onChange={e=>update('brief',e.target.value)} placeholder="اكتب ملخص القصة أو نوع المحتوى المطلوب…"/></label>}
        <label className="field"><span>لغة المحتوى</span><select value={form.language} onChange={e=>update('language',e.target.value)}><option value="ar">العربية</option><option value="en">English</option><option value="fr">Français</option><option value="tr">Türkçe</option><option value="other">لغة أخرى (تحدد لاحقاً)</option></select></label>
        <label className="field"><span>اللهجة (اختياري)</span><input maxLength="60" value={form.dialect} onChange={e=>update('dialect',e.target.value)} placeholder="مثال: ليبية / مصرية / خليجية"/></label>
        <label className="field"><span>تفضيل الموسيقى الخلفية</span><select value={form.musicChoice} onChange={e=>update('musicChoice',e.target.value)}><option value="none">بدون موسيقى</option><option value="licensed_library">مكتبة موسيقى مرخصة (التكامل قيد التجهيز)</option><option value="original_generated">موسيقى أصلية مولدة (التكامل قيد التجهيز)</option><option value="client_upload">ملف موسيقي من العميل (الرفع قيد التجهيز)</option></select></label>
        <div className="field-full"><h3 className="section-title">إعدادات الراوي والصوت</h3></div>
        <label className="field"><span>نوع الصوت المفضل</span><select value={form.voiceProfile.gender} onChange={e=>update('voiceProfile',{...form.voiceProfile,gender:e.target.value})}><option value="neutral">بدون تفضيل</option><option value="female">نسائي</option><option value="male">رجالي</option></select></label>
        <label className="field"><span>نبرة الصوت</span><select value={form.voiceProfile.tone} onChange={e=>update('voiceProfile',{...form.voiceProfile,tone:e.target.value})}><option value="natural">طبيعية</option><option value="calm">هادئة</option><option value="energetic">حماسية</option><option value="dramatic">درامية</option><option value="documentary">وثائقية</option></select></label>
        <label className="field"><span>سرعة الإلقاء</span><select value={form.voiceProfile.speed} onChange={e=>update('voiceProfile',{...form.voiceProfile,speed:e.target.value})}><option value="slow">بطيئة</option><option value="normal">متوسطة</option><option value="fast">سريعة</option></select></label>
        <label className="field"><span>هوية صوتية ثابتة للسلسلة (اختياري)</span><input maxLength="80" value={form.voiceProfile.voiceIdentity} onChange={e=>update('voiceProfile',{...form.voiceProfile,voiceIdentity:e.target.value})} placeholder="مثال: الراوي الرئيسي"/></label>
        {form.musicChoice==='client_upload'&&<label className="field field-full"><span>إقرار حقوق الملف</span><textarea rows="2" maxLength="500" value={form.musicRightsNote} onChange={e=>update('musicRightsNote',e.target.value)} placeholder="اذكر مصدر الملف وأكّد امتلاك حق استخدامه تجارياً. رفع الملف الفعلي غير متاح في هذه المرحلة."/></label>}
        <div className="field-full row" style={{justifyContent:'flex-start',gap:10,flexWrap:'wrap'}}><button className="btn btn-primary" type="submit" disabled={busy||!data?.serviceAccess}>{busy?'جارٍ الحفظ…':'إنشاء المشروع'}</button><span className="small muted">إنشاء المشروع لا يعني بدء الإنتاج أو النشر.</span></div>
      </form>
    </section>
    <section className="card card-pad">
      <div className="row-between"><h2 className="section-title">مشاريعي</h2><span className="badge badge-neutral">{data?.projects?.length||0} مشروع</span></div>
      {!data?.projects?.length?<p className="muted">لا توجد مشاريع محتوى بعد.</p>:<div className="list-stack">{data.projects.map(p=><button key={p.id} className="list-row" type="button" onClick={()=>openProject(p.id)}><span><strong>{p.title}</strong><small>{p.creationMode==='custom'?'محتوى مخصص':'فكرة مقترحة'} · {p.language.toUpperCase()} · {p.status}</small></span><span aria-hidden="true">←</span></button>)}</div>}
    </section>
    {detail&&<section className="card card-pad">
      <div className="row-between"><h2 className="section-title">{detail.project.title}</h2><button type="button" className="btn btn-ghost btn-sm" onClick={()=>setDetail(null)}>إغلاق</button></div>
      <p className="muted">خطة المحتوى: {detail.contentPlanDays?.length||0} يوماً · الحلقات: {detail.episodes.length} · مواعيد مقترحة: {detail.schedule.length} · الموافقات: {detail.approvals.length}</p>
      <h3 className="section-title">إدارة الحلقات والسيناريوهات</h3>
      <div className="list-stack">{detail.episodes.map(ep=><div className="list-row" key={ep.id}><span><strong>الحلقة {ep.episode_number}: {ep.title||'بدون عنوان'}</strong><small>{ep.status} {ep.planned_date?'· '+ep.planned_date:''}</small></span><button type="button" className="btn btn-ghost btn-sm" onClick={()=>editEpisode(ep)}>تعديل</button></div>)}</div>
      <form onSubmit={saveEpisode} className="form-grid" style={{marginTop:16}}>
        <div className="field-full"><h4 className="section-title">{episodeForm.id?'تعديل الحلقة':'إضافة حلقة جديدة'}</h4></div>
        {!episodeForm.id&&<label className="field"><span>رقم الحلقة</span><input type="number" min="1" max="500" required value={episodeForm.episodeNumber} onChange={e=>setEpisodeForm(p=>({...p,episodeNumber:e.target.value}))}/></label>}
        <label className="field"><span>عنوان الحلقة</span><input required maxLength="120" value={episodeForm.title} onChange={e=>setEpisodeForm(p=>({...p,title:e.target.value}))} placeholder="عنوان واضح للحلقة"/></label>
        <label className="field"><span>تاريخ التخطيط (اختياري)</span><input type="date" value={episodeForm.plannedDate} onChange={e=>setEpisodeForm(p=>({...p,plannedDate:e.target.value}))}/></label>
        <label className="field field-full"><span>السيناريو / النص</span><textarea rows="6" maxLength="12000" value={episodeForm.script} onChange={e=>setEpisodeForm(p=>({...p,script:e.target.value}))} placeholder="اكتب أو عدّل سيناريو الحلقة هنا…"/></label>
        <div className="field-full row" style={{justifyContent:'flex-start',gap:10}}><button type="submit" className="btn btn-primary">{episodeForm.id?'حفظ التعديلات':'إضافة الحلقة'}</button>{episodeForm.id&&<button type="button" className="btn btn-ghost" onClick={()=>setEpisodeForm({id:null,episodeNumber:Math.max(0,...detail.episodes.map(ep=>ep.episode_number))+1,title:'',script:'',plannedDate:''})}>إلغاء التعديل</button>}<span className="small muted">الحفظ ينشئ مسودة ولا يعتمدها أو ينشرها.</span></div>
      </form>
      <details style={{marginTop:16}}><summary>عرض تقويم التخطيط الكامل ({detail.contentPlanDays?.length||0} يوماً)</summary><div className="list-stack" style={{marginTop:12}}>{(detail.contentPlanDays||[]).map(day=><div className="list-row" key={day.day_number}><span><strong>اليوم {day.day_number}</strong><small>{day.planned_date} · {day.status}</small></span></div>)}</div></details>
      <h3 className="section-title" style={{marginTop:20}}>اقتراح موعد نشر</h3>
      <form onSubmit={createSchedule} className="form-grid">
        <label className="field"><span>الحلقة</span><select required value={scheduleForm.episodeId} onChange={e=>setScheduleForm(p=>({...p,episodeId:e.target.value}))}><option value="">اختر حلقة</option>{detail.episodes.map(ep=><option key={ep.id} value={ep.id}>الحلقة {ep.episode_number} — {ep.title}</option>)}</select></label>
        <label className="field"><span>المنصة</span><select value={scheduleForm.platform} onChange={e=>setScheduleForm(p=>({...p,platform:e.target.value}))}><option value="youtube">YouTube</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="facebook">Facebook</option></select></label>
        <label className="field"><span>الموعد المحلي المقترح</span><input type="datetime-local" required value={scheduleForm.scheduledAt} onChange={e=>setScheduleForm(p=>({...p,scheduledAt:e.target.value}))}/></label>
        <div className="field-full"><button type="submit" className="btn btn-primary" disabled={!detail.episodes.length||!scheduleForm.episodeId||!scheduleForm.scheduledAt}>حفظ الموعد للمراجعة</button></div>
      </form>
      <h3 className="section-title" style={{marginTop:20}}>مقترحات الجدولة والموافقات</h3>
      {!detail.schedule.length?<p className="muted">لا توجد مواعيد مقترحة.</p>:<div className="list-stack">{detail.schedule.map(item=><div className="list-row" key={item.id}><span><strong>{item.platform} · {new Date(item.scheduled_at).toLocaleString('ar')}</strong><small>{item.status} · الحلقة #{item.episode_id}</small></span>{item.status==='awaiting_approval'&&<div className="row"><button type="button" className="btn btn-primary btn-sm" onClick={()=>decideSchedule('approved',item.id,item.episode_id)}>موافقة</button><button type="button" className="btn btn-ghost btn-sm" onClick={()=>decideSchedule('rejected',item.id,item.episode_id)}>رفض</button></div>}</div>)}</div>}
      <p className="small muted">هذه مواعيد داخلية فقط. لا يوجد ربط اجتماعي نشط في هذه المرحلة ولا يتم نشر أي محتوى خارجياً.</p>
    </section>}
    <p className="small muted"><Link to="/app">العودة إلى لوحة التحكم</Link></p>
  </div>;
}
