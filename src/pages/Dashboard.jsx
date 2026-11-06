import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import {
  ConnectionBadge,
  EmptyState,
  Progress,
  Spinner,
  Stat,
  accentOf,
  formatNumber,
  statusMeta,
  timeAgo,
} from '../components/ui.jsx';
import { studio } from '../api.js';
import { useSession } from '../session.jsx';

export default function Dashboard() {
  const { user, entitlements, tools } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    studio
      .dashboard()
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((err) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const ent = data?.entitlements || entitlements || null;
  const toolList = (data?.tools?.length ? data.tools : tools) || [];

  const monthlyUsed = useMemo(() => {
    if (!ent?.usage) return 0;
    return Object.values(ent.usage).reduce((sum, value) => sum + (Number(value) || 0), 0);
  }, [ent]);

  const totalQuota = useMemo(() => {
    if (!ent?.limits) return 0;
    return Object.values(ent.limits).reduce((sum, value) => {
      const num = Number(value);
      return sum + (Number.isFinite(num) && num >= 0 ? num : 0);
    }, 0);
  }, [ent]);

  const access = Boolean(ent?.canGenerate);
  const greeting = user?.name ? `أهلًا ${user.name.split(' ')[0]}` : 'أهلًا بك';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">لوحة التحكم</p>
          <h1 className="page-title">{greeting} 👋</h1>
          <p className="muted small">
            {access
              ? 'وصولك للتوليد مُفعّل. اختر أداة وابدأ مشروعًا جديدًا.'
              : 'تحتاج إلى اشتراك نشط لبدء التوليد. يمكنك استكشاف الأدوات وحفظ المسودات الآن.'}
          </p>
        </div>
        <ConnectionBadge connected={toolList.length > 0 && toolList.every((t) => t.connected)} />
      </header>

      {error && (
        <div className="alert alert-danger">
          <Icon name="alert" size={16} /> {error}
        </div>
      )}

      <section className={`card card-pad access-card ${access ? 'access-on' : 'access-off'}`}>
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="row" style={{ gap: 12 }}>
            <span className="tool-icon" style={{ background: 'rgba(124,92,255,0.16)', color: '#a78bfa' }}>
              <Icon name={access ? 'crown' : 'lock'} size={20} />
            </span>
            <div>
              <h3 style={{ margin: 0 }}>
                {ent?.isOwner
                  ? 'حساب المالك — وصول غير محدود'
                  : ent?.hasActiveSubscription
                    ? `الخطة الحالية: ${ent.planNameAr || ent.planCode}`
                    : 'لا يوجد اشتراك نشط'}
              </h3>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                {ent?.isOwner
                  ? 'كل الأدوات متاحة لك مجانًا وبدون حدود شهرية.'
                  : ent?.hasActiveSubscription
                    ? `ينتهي الاشتراك في ${ent.subscriptionEndsAt ? new Date(ent.subscriptionEndsAt).toLocaleDateString('ar-EG-u-nu-latn') : '—'}`
                    : 'اشتراكك غير نشط حاليًا. تواصل مع الإدارة لتفعيل خطة مدفوعة.'}
              </p>
            </div>
          </div>
          <Link to="/app/profile" className="btn btn-outline btn-sm">
            <Icon name="credit" size={16} /> إدارة الاشتراك
          </Link>
        </div>
      </section>

      <section className="grid grid-4" style={{ marginTop: 16 }}>
        <Stat label="إجمالي المشاريع" value={formatNumber(data?.totals?.projects ?? 0)} icon="film" tone="violet" />
        <Stat
          label="مشاريع مكتملة"
          value={formatNumber(data?.totals?.byStatus?.completed ?? 0)}
          icon="check"
          tone="emerald"
        />
        <Stat
          label="بانتظار المزوّد"
          value={formatNumber(data?.totals?.byStatus?.pending_provider ?? 0)}
          icon="clock"
          tone="amber"
        />
        <Stat
          label="استخدام هذا الشهر"
          value={formatNumber(monthlyUsed)}
          hint={ent?.isOwner ? 'غير محدود' : totalQuota ? `من ${formatNumber(totalQuota)}` : '—'}
          icon="chart"
          tone="cyan"
        />
      </section>

      <section style={{ marginTop: 26 }}>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h2 className="section-title" style={{ margin: 0, fontSize: '1.15rem' }}>
            <Icon name="grid" size={18} /> الأدوات
          </h2>
          <Link to="/app/history" className="link small">
            سجل المشاريع <Icon name="arrow" size={14} />
          </Link>
        </div>

        <div className="grid grid-2">
          {toolList.map((tool) => {
            const accent = accentOf(tool.accent);
            const used = Number(ent?.usage?.[tool.id] ?? 0);
            const limit = Number(ent?.limits?.[tool.id] ?? 0);
            return (
              <article key={tool.id} className="tool-card card card-hover">
                <div className="tool-header">
                  <span className="tool-icon" style={{ background: accent.soft, color: accent.color }}>
                    <Icon name={tool.icon} size={20} />
                  </span>
                  <div className="grow">
                    <h3>{tool.nameAr}</h3>
                    <p className="muted small" style={{ margin: '2px 0 0' }}>{tool.descriptionAr}</p>
                  </div>
                </div>

                <div style={{ marginTop: 14 }}>
                  <div className="row-between small muted" style={{ marginBottom: 6 }}>
                    <span>الاستخدام الشهري</span>
                    <span>{ent?.isOwner ? `${formatNumber(used)} · غير محدود` : `${formatNumber(used)} / ${formatNumber(limit)}`}</span>
                  </div>
                  <Progress value={used} max={ent?.isOwner ? Math.max(used, 1) : limit || 1} tone={tool.accent} />
                </div>

                <div className="row-between" style={{ marginTop: 14, gap: 10, flexWrap: 'wrap' }}>
                  <ConnectionBadge connected={tool.connected} compact />
                  <Link to={`/app/tools/${tool.id}`} className="btn btn-primary btn-sm">
                    <Icon name="wand" size={15} /> ابدأ الإنشاء
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section style={{ marginTop: 26 }}>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h2 className="section-title" style={{ margin: 0, fontSize: '1.15rem' }}>
            <Icon name="clock" size={18} /> آخر المشاريع
          </h2>
        </div>

        {loading ? (
          <div className="card card-pad center">
            <Spinner /> <span className="muted small">جارٍ تحميل مشاريعك…</span>
          </div>
        ) : data?.recentProjects?.length ? (
          <div className="list">
            {data.recentProjects.map((project) => {
              const meta = statusMeta(project.status);
              const tool = toolList.find((t) => t.id === project.tool);
              return (
                <Link key={project.id} to={`/app/history?project=${project.id}`} className="list-row card card-hover">
                  <span className="tool-icon sm" style={{ background: accentOf(tool?.accent).soft, color: accentOf(tool?.accent).color }}>
                    <Icon name={tool?.icon || 'film'} size={16} />
                  </span>
                  <div className="grow">
                    <p className="list-title">{project.prompt}</p>
                    <p className="muted small" style={{ margin: '2px 0 0' }}>
                      {tool?.nameAr || project.tool} · {timeAgo(project.createdAt)}
                    </p>
                  </div>
                  <span className={`badge badge-${meta.tone}`}>
                    <span className="dot" /> {meta.label}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState icon="film" title="لا توجد مشاريع بعد" action={
            <Link to="/app/tools/text_video" className="btn btn-primary btn-sm">
              <Icon name="wand" size={16} /> أنشئ مشروعك الأول
            </Link>
          }>
            ابدأ بأداة النص إلى فيديو واكتب وصفًا لمشهدك الأول.
          </EmptyState>
        )}
      </section>

      <section className="card card-pad" style={{ marginTop: 22 }}>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <Icon name="alert" size={18} />
          <p className="small muted" style={{ margin: 0 }}>
            <strong style={{ color: 'var(--text)' }}>ملاحظة صريحة:</strong> مزوّدات توليد الفيديو والصوت
            غير متصلة بهذه النسخة. كل مشروع جديد يُحفظ بحالة «بانتظار المزوّد» دون أي توليد وهمي، ويمكن
            ربط المزوّدات لاحقًا عبر مفاتيح بيئة على الخادم فقط.
          </p>
        </div>
      </section>
    </div>
  );
}
