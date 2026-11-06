import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Brand } from '../components/Layout.jsx';
import { Field, Spinner, useToast } from '../components/ui.jsx';
import { useSession } from '../session.jsx';

const MIN_PASSWORD = 8;

export default function Register() {
  const { register } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const validate = () => {
    const next = {};
    if (form.name.trim().length < 2) next.name = 'أدخل اسمًا لا يقل عن حرفين.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) next.email = 'أدخل بريدًا إلكترونيًا صحيحًا.';
    if (form.password.length < MIN_PASSWORD) next.password = `كلمة المرور يجب أن تكون ${MIN_PASSWORD} أحرف على الأقل.`;
    if (form.password !== form.confirm) next.confirm = 'كلمتا المرور غير متطابقتين.';
    setFields(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!validate()) return;
    setBusy(true);
    try {
      const data = await register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      toast.push(`تم إنشاء حسابك بنجاح، ${data.user?.name || ''}`.trim());
      navigate('/app', { replace: true });
    } catch (err) {
      setFields(err.fields || {});
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Brand to="/" small />
        <div className="auth-head">
          <h1>إنشاء حساب جديد</h1>
          <p className="muted small">سجّل مجانًا لاستكشاف الأدوات. التوليد الفعلي يتطلب اشتراكًا نشطًا.</p>
        </div>

        <form className="stack" onSubmit={onSubmit} noValidate>
          <Field label="الاسم الكامل" htmlFor="name" error={fields.name} required>
            <input
              id="name"
              className="input"
              type="text"
              autoComplete="name"
              placeholder="مثال: سارة العتيبي"
              value={form.name}
              onChange={update('name')}
              required
            />
          </Field>

          <Field label="البريد الإلكتروني" htmlFor="email" error={fields.email} required>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              dir="ltr"
              placeholder="name@example.com"
              value={form.email}
              onChange={update('email')}
              required
            />
          </Field>

          <Field
            label="كلمة المرور"
            htmlFor="password"
            error={fields.password}
            hint="8 أحرف على الأقل، ويُفضّل مزج الحروف والأرقام."
            required
          >
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={form.password}
              onChange={update('password')}
              required
            />
          </Field>

          <Field label="تأكيد كلمة المرور" htmlFor="confirm" error={fields.confirm} required>
            <input
              id="confirm"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={form.confirm}
              onChange={update('confirm')}
              required
            />
          </Field>

          {error && <p className="notice notice-danger" role="alert">{error}</p>}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? 'جارٍ إنشاء الحساب…' : 'إنشاء الحساب'}
          </button>
        </form>

        <p className="auth-alt">
          لديك حساب بالفعل؟ <Link to="/login">تسجيل الدخول</Link>
        </p>
      </div>
    </div>
  );
}
