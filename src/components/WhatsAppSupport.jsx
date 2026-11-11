const SUPPORT_NUMBER = String(import.meta.env.VITE_WHATSAPP_NUMBER || '').replace(/\D/g, '');
const MESSAGE = 'مرحبًا، أريد الاستفسار عن خدمات AI VIDEO STUDIO.';

export default function WhatsAppSupport() {
  // لا نعرض زرًا معطّلًا أو رابطًا وهميًا قبل ضبط رقم الدعم.
  if (SUPPORT_NUMBER.length < 8 || SUPPORT_NUMBER.length > 15) return null;

  const href = `https://wa.me/${SUPPORT_NUMBER}?text=${encodeURIComponent(MESSAGE)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="تواصل مع دعم AI VIDEO STUDIO عبر واتساب"
      title="تواصل معنا عبر واتساب"
      style={{
        position: 'fixed',
        insetInlineEnd: '20px',
        bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
        zIndex: 1000,
        width: '58px',
        height: '58px',
        display: 'grid',
        placeItems: 'center',
        borderRadius: '50%',
        background: '#25D366',
        color: '#fff',
        boxShadow: '0 5px 18px rgba(0, 0, 0, .22)',
        textDecoration: 'none',
        transition: 'transform .18s ease, box-shadow .18s ease',
      }}
    >
      <svg viewBox="0 0 32 32" width="30" height="30" fill="currentColor" aria-hidden="true">
        <path d="M16.04 3C8.87 3 3.04 8.77 3.04 15.88c0 2.28.61 4.51 1.77 6.47L3 29l6.85-1.78a13.1 13.1 0 0 0 6.19 1.55h.01c7.17 0 13-5.77 13-12.88 0-3.45-1.36-6.69-3.82-9.12A12.93 12.93 0 0 0 16.04 3Zm0 23.58h-.01c-1.91 0-3.78-.51-5.42-1.48l-.39-.23-4.06 1.06 1.08-3.94-.25-.4a10.66 10.66 0 0 1-1.64-5.71c0-5.87 4.81-10.65 10.7-10.65 2.85 0 5.53 1.1 7.55 3.12a10.55 10.55 0 0 1 3.14 7.53c0 5.87-4.8 10.65-10.7 10.65Zm5.87-7.98c-.32-.16-1.9-.93-2.2-1.03-.3-.11-.51-.16-.73.16-.21.32-.83 1.03-1.02 1.24-.19.21-.38.24-.7.08-.32-.16-1.35-.49-2.57-1.55-.95-.82-1.59-1.83-1.78-2.15-.19-.32-.02-.49.14-.65.14-.14.32-.38.48-.57.16-.19.21-.32.32-.54.11-.21.05-.4-.03-.57-.08-.16-.73-1.74-1-2.38-.26-.62-.53-.54-.73-.55h-.62c-.21 0-.57.08-.86.4-.3.32-1.13 1.1-1.13 2.68s1.16 3.11 1.32 3.33c.16.21 2.28 3.47 5.52 4.87.77.33 1.37.53 1.84.68.77.24 1.47.21 2.02.13.62-.09 1.9-.77 2.17-1.52.27-.75.27-1.39.19-1.52-.08-.14-.29-.22-.61-.38Z" />
      </svg>
    </a>
  );
}
