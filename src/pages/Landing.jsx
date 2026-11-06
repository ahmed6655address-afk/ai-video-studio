import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/Layout.jsx';
import { Icon } from '../components/Icon.jsx';
import { accentOf, ConnectionBadge, formatNumber } from '../components/ui.jsx';
import { studio } from '../api.js';
import { useSession } from '../session.jsx';

const FALLBACK_TOOLS = [
  {
    id: 'text_video',
    nameAr: 'النص إلى فيديو',
    descriptionAr: 'حوّل وصفًا نصيًا عربيًا إلى مشهد فيديو متكامل.',
    icon: 'video',
    accent: 'violet',
    connected: false,
    messageAr: 'غير متصل بمزوّد بعد',
  },
  {
    id: 'image_video',
    nameAr: 'الصورة إلى فيديو',
    descriptionAr: 'أضف حركة سينمائية لصورة ثابتة مع الحفاظ على الهوية البصرية.',
    icon: 'image',
    accent: 'cyan',
    connected: false,
    messageAr: 'غير متصل بمزوّد بعد',
  },
  {
    id: 'voice',
    nameAr: 'التعليق الصوتي العربي',
    descriptionAr: 'تعليق صوتي عربي واضح بلهجات ونبرات متعددة.',
    icon: 'mic',
    accent: 'amber',
    connected: false,
    messageAr: 'غير متصل بمزوّد بعد',
  },
  {
    id: 'cartoon',
    nameAr: 'إنشاء كرتون',
    descriptionAr: 'شخصيات كرتونية أصلية ومشاهد متحركة جاهزة للسرد.',
    icon: 'sparkles',
    accent: 'rose',
    connected: false,
    messageAr: 'غير متصل بمزوّد بعد',
  },
];

const FEATURES = [
  { icon: 'shield', title: 'أمان على مستوى الخادم', text: 'كل الصلاحيات والحدود تُتحقق في الخادم، وليس في المتصفح. الجلسات مشفّرة وموقّعة عبر كوكيز HttpOnly.' },
  { icon: 'crown', title: 'حساب مالك بوصول كامل', text: 'حساب المالك يُنشأ تلقائيًا من إعدادات الخادم السرية ويحصل على وصول مجاني غير محدود لكل الأدوات.' },
  { icon: 'credit', title: 'اشتراكات وحدود استخدام', text: 'التوليد متاح لأصحاب الاشتراك النشط فقط، مع حدود شهرية قابلة للضبط لكل أداة من لوحة الإدارة.' },
  { icon: 'globe', title: 'عربي أولًا وRTL', text: 'واجهة مصمّمة من الأساس للاتجاه من اليمين إلى اليسار، بخط عربي حديث وتجربة قراءة مريحة.' },
  { icon: 'mobile', title: 'مصمّم للجوال أولًا', text: 'تنقّل سفلي، أزرار مريحة، وأداء سريع على الشاشات الصغيرة قبل الشاشات الكبيرة.' },
  { icon: 'lock', title: 'مفاتيح API محمية', text: 'لا تُرسل أي مفاتيح مزوّدين إلى المتصفح. التكامل يُقرأ من متغيّرات بيئة الخادم فقط.' },
];

const STEPS = [
  { title: 'أنشئ حسابك', text: 'تسجيل سريع بالبريد الإلكتروني وكلمة مرور محفوظة بتشفير scrypt.' },
  { title: 'اختر أداتك', text: 'أربع أدوات متخصصة: نص إلى فيديو، صورة إلى فيديو، تعليق صوتي، وكرتون.' },
  { title: 'اكتب الوصف', text: 'وصف عربي واضح مع خيارات المدة والنسبة والأسلوب، ويُحفظ المشروع في سجلك.' },
  { title: 'تابع النتيجة', text: 'حالة كل مشروع واضحة، مع إشعار صريح عندما لا يكون المزوّد متصلًا بعد.' },
];

export default function Landing() {
  const { user, plans } = useSession();
  const [tools, setTools] = useState(FALLBACK_TOOLS);

  useEffect(() => {
    studio
      .tools()
      .then((data) => {
        if (Array.isArray(data.tools) && data.tools.length) setTools(data.tools);
      })
      .catch(() => setTools(FALLBACK_TOOLS));
  }, []);

  const featuredPlan =
    plans.find((p) => p.code === 'pro_yearly') || plans.find((p) => p.priceSar > 0) || null;

  return (
    <div className="shell">
      <header className="topbar">
        <Brand />
        <div className="row" style={{ gap: 8 }}>
          {user ? (
            <Link to="/app" className="btn btn-primary btn-sm">
              <Icon name="grid" size={16} /> لوحة التحكم
            </Link>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost btn-sm">دخول</Link>
              <Link to="/register" className="btn btn-primary btn-sm">ابدأ مجانًا</Link>
            </>
          )}
        </div>
      </header>

      <main>
        <section className="hero container">
          <div>
            <span className="badge badge-violet">
              <Icon name="sparkles" size={13} /> منصة عربية بالكامل · RTL
            </span>
            <h1 className="hero-title">
              استوديو <span className="gradient-text">الفيديو بالذكاء الاصطناعي</span> بالعربية
            </h1>
            <p className="section-sub" style={{ maxWidth: 560 }}>
              أنشئ فيديوهات، حوّل الصور إلى مشاهد متحركة، وولّد تعليقًا صوتيًا عربيًا ورسومًا كرتونية —
              من واجهة واحدة أنيقة، مع سجل مشاريع واشتراكات وحدود استخدام محمية على الخادم.
            </p>
            <div className="row" style={{ marginTop: 22, flexWrap: 'wrap' }}>
              <Link to={user ? '/app' : '/register'} className="btn btn-primary">
                <Icon name="wand" size={18} /> {user ? 'ادخل الاستوديو' : 'أنشئ حسابك الآن'}
              </Link>
              <Link to={user ? '/app/tools/text_video' : '/login'} className="btn btn-outline">
                <Icon name="video" size={18} /> جرّب أداة النص إلى فيديو
              </Link>
            </div>
            <div className="chip-row" style={{ marginTop: 20 }}>
              <span className="chip"><Icon name="check" size={14} /> ٤ أدوات متخصصة</span>
              <span className="chip"><Icon name="check" size={14} /> حساب مالك مجاني</span>
              <span className="chip"><Icon name="check" size={14} /> واجهة للجوال أولًا</span>
            </div>
          </div>

          <div className="hero-visual">
            <div className="prompt-mock card">
              <div className="row-between">
                <span className="badge badge-info"><Icon name="video" size={13} /> النص إلى فيديو</span>
                <ConnectionBadge connected={tools[0]?.connected} compact />
              </div>
              <div className="mock-frame" style={{ marginTop: 14 }}>
                <div className="mock-line" style={{ width: '88%' }} />
                <div className="mock-line" style={{ width: '72%' }} />
                <div className="mock-line" style={{ width: '54%' }} />
                <div className="placeholder-media" style={{ marginTop: 12 }}>
                  <Icon name="film" size={26} />
                  <span className="small faint">معاينة المشهد</span>
                </div>
              </div>
              <p className="demo-note">
                <Icon name="alert" size={14} /> المزوّدات غير متصلة بعد — الواجهة جاهزة لربطها لاحقًا بأمان.
              </p>
            </div>
          </div>
        </section>

        <section className="section container" id="tools">
          <div className="row-between" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <p className="eyebrow">الأدوات</p>
              <h2 className="section-title">أربع أدوات في لوحة واحدة</h2>
              <p className="section-sub">كل أداة لها واجهة وصف خاصة وخيارات ضبط، وتُحفظ نتائجها في سجلك.</p>
            </div>
            <ConnectionBadge connected={tools.every((t) => t.connected)} />
          </div>

          <div className="grid grid-2" style={{ marginTop: 20 }}>
            {tools.map((tool) => {
              const accent = accentOf(tool.accent);
              return (
                <article key={tool.id} className="tool-card card card-hover">
                  <div className="tool-header">
                    <span className="tool-icon" style={{ background: accent.soft, color: accent.color }}>
                      <Icon name={tool.icon} size={20} />
                    </span>
                    <div className="grow">
                      <h3>{tool.nameAr}</h3>
                      <p className="muted small">{tool.descriptionAr}</p>
                    </div>
                  </div>
                  <div className="row-between" style={{ marginTop: 14 }}>
                    <ConnectionBadge connected={tool.connected} compact />
                    <Link to={user ? `/app/tools/${tool.id}` : '/register'} className="btn btn-outline btn-sm">
                      فتح الأداة <Icon name="arrow" size={15} />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="section container">
          <p className="eyebrow">لماذا نحن</p>
          <h2 className="section-title">مبنية بمعايير احترافية</h2>
          <div className="grid grid-3" style={{ marginTop: 20 }}>
            {FEATURES.map((feature) => (
              <article key={feature.title} className="feature-card card card-hover">
                <span className="feature-icon">
                  <Icon name={feature.icon} size={20} />
                </span>
                <h3>{feature.title}</h3>
                <p className="muted small">{feature.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section container">
          <p className="eyebrow">كيف تعمل</p>
          <h2 className="section-title">من الفكرة إلى المشهد في أربع خطوات</h2>
          <div className="steps" style={{ marginTop: 20 }}>
            {STEPS.map((step, index) => (
              <div key={step.title} className="step card card-pad">
                <span className="step-num">{formatNumber(index + 1)}</span>
                <h3>{step.title}</h3>
                <p className="muted small">{step.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section container" id="pricing">
          <p className="eyebrow">الأسعار</p>
          <h2 className="section-title">اشتراك واضح بدون مفاجآت</h2>
          <p className="section-sub">التوليد الفعلي يتطلب اشتراكًا نشطًا. حساب المالك يحصل على كل شيء مجانًا.</p>

          <div className="grid grid-3" style={{ marginTop: 20 }}>
            {(plans.length ? plans : []).map((plan) => (
              <article
                key={plan.code}
                className={`pricing-card card card-pad${featuredPlan?.code === plan.code ? ' card-glow' : ''}`}
              >
                {featuredPlan?.code === plan.code && <span className="badge badge-violet">الأكثر اختيارًا</span>}
                <h3>{plan.nameAr}</h3>
                <p className="muted small">{plan.taglineAr}</p>
                <p className="price">
                  {plan.priceSar === 0 ? 'مجانًا' : `${formatNumber(plan.priceSar)} ر.س`}
                </p>
                <ul className="check-list">
                  {(plan.features || []).map((item) => (
                    <li key={item}>
                      <Icon name="check" size={15} /> {item}
                    </li>
                  ))}
                </ul>
                <Link
                  to={plan.priceSar === 0 ? (user ? '/app' : '/register') : '/register'}
                  className={`btn btn-block ${featuredPlan?.code === plan.code ? 'btn-primary' : 'btn-outline'}`}
                >
                  {plan.priceSar === 0 ? 'ابدأ مجانًا' : 'اشترك الآن'}
                </Link>
              </article>
            ))}
            {!plans.length && (
              <p className="muted small">جارٍ تحميل الخطط…</p>
            )}
          </div>

          <p className="demo-note" style={{ marginTop: 18 }}>
            <Icon name="alert" size={14} /> الدفع الإلكتروني غير متصل بعد في هذه النسخة. تفعيل الاشتراكات
            يتم حاليًا من لوحة الإدارة، وواجهة بوابة الدفع جاهزة للإضافة لاحقًا.
          </p>
        </section>

        <section className="section container">
          <div className="card card-pad card-glow" style={{ textAlign: 'center' }}>
            <h2 className="section-title" style={{ marginBottom: 8 }}>جاهز لتبدأ مشروعك الأول؟</h2>
            <p className="section-sub" style={{ margin: '0 auto 18px' }}>
              أنشئ حسابك المجاني، استكشف الأدوات، وابدأ ببناء سجل مشاريعك الآن.
            </p>
            <Link to={user ? '/app' : '/register'} className="btn btn-primary">
              <Icon name="sparkles" size={18} /> {user ? 'الذهاب إلى لوحة التحكم' : 'إنشاء حساب مجاني'}
            </Link>
          </div>
        </section>
      </main>

      <footer className="footer container">
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <Brand small />
          <p className="faint small" style={{ margin: 0 }}>
            © {new Date().getFullYear()} AI VIDEO STUDIO — نسخة أولى جاهزة لربط مزوّدي الذكاء الاصطناعي.
          </p>
        </div>
      </footer>
    </div>
  );
}
