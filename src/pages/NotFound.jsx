import { Link } from 'react-router-dom';
import { Brand } from '../components/Layout.jsx';

export default function NotFound() {
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <Brand to="/" small />
        <h1 style={{ marginTop: 18, fontSize: '2.4rem' }}>404</h1>
        <p className="muted">الصفحة التي تبحث عنها غير موجودة.</p>
        <Link to="/" className="btn btn-primary btn-block" style={{ marginTop: 14 }}>
          العودة إلى الصفحة الرئيسية
        </Link>
      </div>
    </div>
  );
}
