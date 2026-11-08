import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import {
  ConnectionBadge,
  EmptyState,
  Field,
  Progress,
  Spinner,
  accentOf,
  formatNumber,
  statusMeta,
  timeAgo,
  useToast,
} from '../components/ui.jsx';
import { studio } from '../api.js';
import { useSession } from '../session.jsx';

const MAX_PROMPT = 1200;

export default function ToolPage() {
  const { toolId } = useParams();
  const { entitlements, tools, setEntitlements, refresh } = useSession();
  const toast = useToast();

  const [tool, setTool] = useState(() => tools.find((t) => t.id === toolId) || null);
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [options, setOptions] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  useEffect(() => {
    const found = tools.find((t) => t.id === toolId);
    if (found) setTool(found);
    else {
      studio
        .tools()
        .then((data) => setTool((data.tools || []).find((t) => t.id === toolId) || null))
        .catch(() => setTool(null));
    }
  }, [toolId, tools]);

  useEffect(() => {
    if (!tool) return;
    const defaults = {};
    (tool.options || []).forEach((option) => {
      defaults[option.key] = option.default ?? option.choices?.[0] ?? '';
    });
    setOptions(defaults);
    setResult(null);
    setPrompt('');
    setNegativePrompt('');
    setImageUrl('');
    setFieldErrors({});
  }, [tool]);

  useEffect(() => {
    let alive = true;
    setLoadingRecent(true);
    studio
      .projects(`?tool=${encodeURIComponent(toolId)}&limit=6`)
      .then((data) => {
        if (alive) setRecent(data.projects || []);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoadingRecent(false);
      });
    return () => {
      alive = false;
    };
  }, [toolId, result]);

  const accent = accentOf(tool?.accent);
  const ent = entitlements;
  const used = Number(ent?.usage?.[toolId] ?? 0);
  const limit = Number(ent?.limits?.[toolId] ?? 0);
  const remaining = ent?.isUnlimited ? null : Math.max(limit - used, 0);
  const canGenerate = Boolean(ent?.canGenerate) && (ent?.isUnlimited || remaining > 0);

  const accessNote = useMemo(() => {
    if (!ent) return '';
    if (ent.isStaff) return ent.isOwner ? 'حساب المالك: وصول غير محدود لكل الأدوات.' : 'حساب إداري: وصول غير محدود لكل الأدوات.';
    if (!ent.hasActiveSubscription) return 'التوليد متاح لأصحاب الاشتراك النشط فقط.';
    if (!ent.isOwner && remaining === 0) return 'استهلكت حدك الشهري لهذه الأداة.';
    return `متبقٍ لك ${formatNumber(remaining)} عملية في هذه الأداة هذا الشهر.`;
  }, [ent, remaining]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!tool) return;

    const errors = {};
    if (prompt.trim().length < 6) errors.prompt = 'اكتب وصفًا من ٦ أحرف على الأقل.';
    if (tool.requiresImage && !imageUrl.trim()) errors.imageUrl = 'أدخل رابط صورة صالحًا.';
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setSubmitting(true);
    try {
      const data = await studio.createProject({
        tool: tool.id,
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim() || undefined,
        options,
        imageUrl: imageUrl.trim() || undefined,
      });
      setResult({ project: data.project, messageAr: data.messageAr, providerConnected: data.providerConnected });
      if (data.entitlements) setEntitlements(data.entitlements);
      toast.push(data.messageAr || 'تم حفظ المشروع.', data.providerConnected ? 'success' : 'info');
      setPrompt('');
    } catch (err) {
      if (err.data?.entitlements) setEntitlements(err.data.entitlements);
      if (err.fields) setFieldErrors(err.fields);
      toast.push(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id) {
    try {
      await studio.deleteProject(id);
      setRecent((rows) => rows.filter((row) => row.id !== id));
      toast.push('تم حذف المشروع.', 'success');
    } catch (err) {
      toast.push(err.message, 'error');
    }
  }

  if (!tool) {
    return (
      <div className="page">
        <EmptyState icon="alert" title="أداة غير معروفة" action={<Link to="/app" className="btn btn-primary btn-sm">رجوع للوحة التحكم</Link>}>
          الأداة المطلوبة غير موجودة. اختر واحدة من الأدوات الأربع.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span className="tool-icon" style={{ background: accent.soft, color: accent.color }}>
            <Icon name={tool.icon} size={20} />
          </span>
          <div>
            <p className="eyebrow">{tool.shortAr}</p>
            <h1 className="page-title" style={{ fontSize: '1.5rem' }}>{tool.nameAr}</h1>
            <p className="muted small" style={{ margin: '4px 0 0' }}>{tool.descriptionAr}</p>
          </div>
        </div>
        <ConnectionBadge connected={tool.connected} />
      </header>

      {!canGenerate && (
        <div className="alert alert-warn">
          <Icon name="lock" size={16} />
          <span>
            {accessNote || 'تحتاج اشتراكًا نشطًا لبدء التوليد.'}{' '}
            <Link to="/app/profile" className="link">عرض خطتك</Link>
          </span>
        </div>
      )}

      {tool.connected === false && (
        <div className="alert alert-info">
          <Icon name="alert" size={16} />
          <span>
            {tool.messageAr || 'هذه الأداة غير متصلة بمزوّد ذكاء اصطناعي بعد.'} سيتم حفظ طلبك في السجل
            بحالة «بانتظار المزوّد» دون توليد وهمي.
          </span>
        </div>
      )}

      <div className="tool-layout">
        <form className="card card-pad" onSubmit={handleSubmit}>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <h2 className="section-title" style={{ margin: 0, fontSize: '1.05rem' }}>
              <Icon name="wand" size={17} /> {tool.promptLabelAr || 'وصف المشروع'}
            </h2>
            <span className="small faint">{formatNumber(prompt.length)} / {formatNumber(MAX_PROMPT)}</span>
          </div>

          <Field label="الوصف" htmlFor="prompt" error={fieldErrors.prompt} required>
            <textarea
              id="prompt"
              className="input textarea"
              rows={6}
              maxLength={MAX_PROMPT}
              placeholder={tool.placeholderAr}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </Field>

          {tool.requiresImage && (
            <Field
              label="رابط الصورة المصدر"
              htmlFor="imageUrl"
              hint="الصق رابطًا مباشرًا لصورة (https). لا يتم رفع الملفات في هذه النسخة."
              error={fieldErrors.imageUrl}
              required
            >
              <input
                id="imageUrl"
                className="input"
                type="url"
                dir="ltr"
                placeholder="https://example.com/image.jpg"
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
              />
            </Field>
          )}

          <div className="grid grid-2" style={{ gap: 12 }}>
            {(tool.options || []).map((option) => (
              <Field key={option.key} label={option.labelAr} htmlFor={`opt-${option.key}`}>
                <select
                  id={`opt-${option.key}`}
                  className="input select"
                  value={options[option.key] ?? ''}
                  onChange={(event) => setOptions((prev) => ({ ...prev, [option.key]: event.target.value }))}
                >
                  {(option.choices || []).map((choice) => (
                    <option key={choice} value={choice}>{choice}</option>
                  ))}
                </select>
              </Field>
            ))}
          </div>

          <Field
            label="وصف سلبي (اختياري)"
            htmlFor="negative"
            hint="ما لا تريد ظهوره في المشهد."
          >
            <input
              id="negative"
              className="input"
              placeholder="مثال: نص، شعارات، تشويه في الوجوه"
              value={negativePrompt}
              onChange={(event) => setNegativePrompt(event.target.value)}
            />
          </Field>

          <div className="row-between" style={{ marginTop: 8, gap: 12, flexWrap: 'wrap' }}>
            <div className="small muted">
              {ent?.isUnlimited
                ? 'غير محدود'
                : `الاستخدام: ${formatNumber(used)} / ${formatNumber(limit)}`}
              <div style={{ width: 160, marginTop: 6 }}>
                <Progress value={used} max={ent?.isUnlimited ? Math.max(used, 1) : limit || 1} tone={tool.accent} />
              </div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={submitting || !canGenerate}>
              {submitting ? <Spinner size={16} /> : <Icon name="sparkles" size={17} />}
              {canGenerate ? 'إنشاء المشروع' : 'يتطلب اشتراكًا نشطًا'}
            </button>
          </div>
        </form>

        <aside className="card card-pad">
          <h2 className="section-title" style={{ margin: 0, fontSize: '1.05rem' }}>
            <Icon name="film" size={17} /> النتيجة
          </h2>

          {result ? (
            <div style={{ marginTop: 12 }}>
              <span className={`badge badge-${statusMeta(result.project.status).tone}`}>
                <span className="dot" /> {statusMeta(result.project.status).label}
              </span>
              <p className="small muted" style={{ marginTop: 10 }}>{result.messageAr}</p>
              <div className="placeholder-media" style={{ marginTop: 12 }}>
                <Icon name="film" size={26} />
                <span className="small faint">
                  {result.project.outputUrl ? 'الملف جاهز' : 'لا يوجد ملف ناتج — المزوّد غير متصل'}
                </span>
              </div>
              <dl className="meta-list" style={{ marginTop: 12 }}>
                <div><dt>رقم المشروع</dt><dd dir="ltr">#{result.project.id}</dd></div>
                <div><dt>المزوّد</dt><dd>{result.project.provider || 'غير متصل'}</dd></div>
                <div><dt>التاريخ</dt><dd>{timeAgo(result.project.createdAt)}</dd></div>
              </dl>
              <Link to={`/app/history?project=${result.project.id}`} className="btn btn-outline btn-sm btn-block" style={{ marginTop: 10 }}>
                عرض في السجل
              </Link>
            </div>
          ) : (
            <div className="empty-inline" style={{ marginTop: 12 }}>
              <Icon name="image" size={24} />
              <p className="small faint">لم تُنشئ مشروعًا بعد في هذه الجلسة.</p>
            </div>
          )}

          <hr className="divider" />

          <div className="row-between" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem' }}>أحدث مشاريع هذه الأداة</h3>
            {loadingRecent && <Spinner size={14} />}
          </div>

          {recent.length ? (
            <div className="mini-list">
              {recent.map((project) => {
                const meta = statusMeta(project.status);
                return (
                  <div key={project.id} className="mini-row">
                    <div className="grow">
                      <p className="list-title" style={{ fontSize: '0.85rem' }}>{project.prompt}</p>
                      <p className="muted small" style={{ margin: 0 }}>{timeAgo(project.createdAt)}</p>
                    </div>
                    <span className={`badge badge-${meta.tone}`}>{meta.label}</span>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => handleDelete(project.id)}
                      aria-label="حذف المشروع"
                      title="حذف"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            !loadingRecent && <p className="small faint">لا توجد مشاريع سابقة لهذه الأداة.</p>
          )}

          <button type="button" className="btn btn-ghost btn-sm btn-block" style={{ marginTop: 10 }} onClick={() => { refresh(); toast.push('تم تحديث بياناتك.', 'info'); }}>
            <Icon name="refresh" size={15} /> تحديث الرصيد
          </button>
        </aside>
      </div>
    </div>
  );
}
