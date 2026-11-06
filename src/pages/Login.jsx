import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Brand } from '../components/Layout.jsx';
import { Field, Spinner, useToast } from '../components/ui.jsx';
import { useSession } from '../session.jsx';

export default function Login() {
  const { login } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await login(form.email.trim(), form.password);
      toast.push(`أهلًا بعودتك، ${data.user?.name || ''}`.trim());
      const target = location.state?.from || '/app';
      navigate(target, { replace: true });
    } catch (err) {
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
          <h1>تسجيل الدخول</h1>
          <p className="muted small">ادخل إلى استوديو الفيديو العربي وتابع مشاريعك.</p>
        </div>

        <form className="stack" onSubmit={onSubmit} noValidate>
          <Field label="البريد الإلكتروني" htmlFor="email" required>
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

          <Field label="كلمة المرور" htmlFor="password" required>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={form.password}
              onChange={update('password')}
              required
            />
          </Field>

          {error && <p className="notice notice-danger" role="alert">{error}</p>}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? 'جارٍ الدخول…' : 'دخول'}
          </button>
        </form>

        <p className="auth-alt">
          ليس لديك حساب؟ <Link to="/register">أنشئ حسابًا جديدًا</Link>
        </p>
        <p className="faint small" style={{ textAlign: 'center' }}>
          الدخول متاح للمستخدمين المسجّلين فقط. حساب المالك يُنشأ تلقائيًا من إعدادات الخادم الآمنة.
        </p>
      </div>
    </div>
  );
}
