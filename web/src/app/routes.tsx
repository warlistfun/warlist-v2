import { Link, type RouteObject } from 'react-router-dom';

import { RouteErrorPage } from './route-error';

function HomePage() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Lewati ke konten utama
      </a>
      <div className="page-shell">
        <header className="site-header" aria-label="WARLIST V2">
          <Link className="wordmark" to="/" aria-label="WARLIST, halaman utama">
            WARLIST
          </Link>
          <nav aria-label="Navigasi utama">
            <ul className="site-nav-list">
              <li>
                <a href="#cara-kerja">Cara kerja</a>
              </li>
              <li>
                <a href="#persiapan">Yang perlu disiapkan</a>
              </li>
            </ul>
          </nav>
        </header>
        <main id="main-content" tabIndex={-1}>
          <section className="hero" aria-labelledby="page-title">
            <div className="hero-copy">
              <p className="eyebrow">AUTOMASI WHATSAPP</p>
              <h1 id="page-title">Balas yang tepat, saat aturan terpenuhi.</h1>
              <p className="hero-lede">
                WARLIST membantu Anda menyusun aturan respons WhatsApp berdasarkan grup tujuan,
                pihak yang diizinkan, kata kunci, dan jadwal aktif.
              </p>
              <a className="primary-link" href="#cara-kerja">
                Lihat cara kerjanya
              </a>
            </div>
            <aside className="hero-brief" aria-labelledby="hero-brief-title">
              <p id="hero-brief-title" className="section-kicker">
                DASAR ATURAN
              </p>
              <ul className="plain-list">
                <li>Grup tujuan</li>
                <li>Pihak yang diizinkan</li>
                <li>Kata kunci</li>
                <li>Jadwal aktif</li>
              </ul>
            </aside>
          </section>

          <section className="value-section" aria-label="Penjelasan WARLIST">
            <div className="value-grid">
              <article className="value-item value-item-featured">
                <h2>Aturan yang jelas</h2>
                <p>
                  Tentukan target, pihak yang diizinkan, pemicu, dan waktu aktif sebelum automasi
                  dijalankan.
                </p>
              </article>
              <article className="value-item">
                <h2>Tinjau sebelum aktif</h2>
                <p>
                  Periksa kembali aturan yang sudah disusun supaya hasilnya sesuai dengan cara kerja
                  yang Anda inginkan.
                </p>
              </article>
              <article className="value-item">
                <h2>Tetap tahu apa yang terjadi</h2>
                <p>
                  WARLIST dirancang untuk membedakan kondisi yang siap, belum lengkap, dan perlu
                  tindakan, bukan menebak status.
                </p>
              </article>
            </div>
          </section>

          <section id="cara-kerja" className="workflow-section" aria-labelledby="workflow-title">
            <div className="section-intro">
              <h2 id="workflow-title">Cara kerja</h2>
            </div>
            <ol className="step-list">
              <li>
                <span className="step-number" aria-hidden="true">
                  1
                </span>
                <div>
                  <h3>Tentukan tujuan</h3>
                  <p>Pilih grup tujuan dan pihak yang boleh memicu respons.</p>
                </div>
              </li>
              <li>
                <span className="step-number" aria-hidden="true">
                  2
                </span>
                <div>
                  <h3>Susun aturan</h3>
                  <p>Atur kata kunci dan jadwal aktif yang sesuai.</p>
                </div>
              </li>
              <li>
                <span className="step-number" aria-hidden="true">
                  3
                </span>
                <div>
                  <h3>Tinjau dan aktifkan</h3>
                  <p>Periksa rangkuman aturan sebelum mengaktifkan automasi.</p>
                </div>
              </li>
            </ol>
          </section>

          <section
            id="persiapan"
            className="preparation-section"
            aria-labelledby="preparation-title"
          >
            <div className="section-intro">
              <h2 id="preparation-title">Yang perlu disiapkan</h2>
            </div>
            <ul className="preparation-list">
              <li>Akun WhatsApp yang akan digunakan bersama WARLIST.</li>
              <li>Grup tujuan yang sesuai.</li>
              <li>Pihak yang diizinkan untuk memicu respons.</li>
              <li>Kata kunci dan jadwal aktif yang ingin diterapkan.</li>
            </ul>
          </section>

          <aside className="limitation" aria-labelledby="limitation-title">
            <p className="section-kicker">BATASAN YANG PERLU DIKETAHUI</p>
            <h2 id="limitation-title">Automasi mengikuti aturan yang Anda tetapkan.</h2>
            <p>
              Respons hanya dijalankan ketika kondisi yang telah dikonfigurasi terpenuhi.
              Ketersediaan layanan pihak ketiga dapat memengaruhi proses.
            </p>
          </aside>
        </main>
        <footer className="site-footer">
          <span className="wordmark wordmark-footer">WARLIST</span>
        </footer>
      </div>
    </>
  );
}

function NotFoundPage() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Lewati ke konten utama
      </a>
      <div className="page-shell">
        <header className="site-header" aria-label="WARLIST V2">
          <span className="wordmark">WARLIST</span>
          <span className="slice-label">404</span>
        </header>
        <main id="main-content" tabIndex={-1}>
          <section className="intro" aria-labelledby="page-title">
            <p className="eyebrow">404</p>
            <h1 id="page-title">Halaman tidak ditemukan</h1>
            <p className="lede">Alamat ini belum menjadi bagian dari WARLIST V2.</p>
            <Link className="primary-link" to="/">
              Kembali ke halaman utama
            </Link>
          </section>
        </main>
      </div>
    </>
  );
}

export const routes: RouteObject[] = [
  {
    path: '/',
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
