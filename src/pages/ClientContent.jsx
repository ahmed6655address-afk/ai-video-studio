import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const EMPTY = { title:'', creationMode:'custom', category:'', ideaId:'', brief:'', language:'ar', dialect:'', musicChoice:'none', musicRightsNote:'' };

export default function ClientContent() {
  const [data,setData]=useState(null);
  const [form,setForm]=useState(EMPTY);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [detail,setDetail]=useState(null);
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
    try { setDetail(await api('/client-content/projects/'+id)); }
    catch(err){setError(err.message);}
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
        <label className="field"><span>الموسيقى الخلفية</span><select value={form.musicChoice} onChange={e=>update('musicChoice',e.target.value)}><option value="none">بدون موسيقى</option><option value="licensed_library">مكتبة مرخصة</option><option value="original_generated">موسيقى أصلية مولدة</option><option value="client_upload">ملف من العميل مع إثبات الحقوق</option></select></label>
        {form.musicChoice==='client_upload'&&<label className="field field-full"><span>إقرار حقوق الملف</span><textarea rows="2" maxLength="500" value={form.musicRightsNote} onChange={e=>update('musicRightsNote',e.target.value)} placeholder="اذكر مصدر الملف وإقرار امتلاك حق استخدامه تجارياً."/></label>}
        <div className="field-full row" style={{justifyContent:'flex-start',gap:10,flexWrap:'wrap'}}><button className="btn btn-primary" type="submit" disabled={busy||!data?.serviceAccess}>{busy?'جارٍ الحفظ…':'إنشاء المشروع'}</button><span className="small muted">إنشاء المشروع لا يعني بدء الإنتاج أو النشر.</span></div>
      </form>
    </section>
    <section className="card card-pad">
      <div className="row-between"><h2 className="section-title">مشاريعي</h2><span className="badge badge-neutral">{data?.projects?.length||0} مشروع</span></div>
      {!data?.projects?.length?<p className="muted">لا توجد مشاريع محتوى بعد.</p>:<div className="list-stack">{data.projects.map(p=><button key={p.id} className="list-row" type="button" onClick={()=>openProject(p.id)}><span><strong>{p.title}</strong><small>{p.creationMode==='custom'?'محتوى مخصص':'فكرة مقترحة'} · {p.language.toUpperCase()} · {p.status}</small></span><span aria-hidden="true">←</span></button>)}</div>}
    </section>
    {detail&&<section className="card card-pad"><div className="row-between"><h2 className="section-title">{detail.project.title}</h2><button type="button" className="btn btn-ghost btn-sm" onClick={()=>setDetail(null)}>إغلاق</button></div><p className="muted">الحلقات: {detail.episodes.length} · جدول النشر: {detail.schedule.length} · الموافقات: {detail.approvals.length}</p><div className="list-stack">{detail.episodes.map(ep=><div className="list-row" key={ep.id}><span><strong>الحلقة {ep.episode_number}: {ep.title||'بدون عنوان'}</strong><small>{ep.status} {ep.planned_date?'· '+ep.planned_date:''}</small></span></div>)}</div><p className="small muted">لا يوجد ربط اجتماعي نشط في هذه المرحلة؛ لا يتم نشر أي محتوى خارجياً.</p></section>}
    <p className="small muted"><Link to="/app">العودة إلى لوحة التحكم</Link></p>
  </div>;
}
