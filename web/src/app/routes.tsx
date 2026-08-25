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
          <span className="wordmark">WARLIST</span>
          <span className="slice-label">Shell diagnostik</span>
        </header>
        <main id="main-content" tabIndex={-1}>
          <section className="intro" aria-labelledby="page-title">
            <p className="eyebrow">Rute dasar</p>
            <h1 id="page-title">Fondasi frontend</h1>
            <p className="lede">Shell WARLIST V2 untuk memeriksa rute dan tampilan.</p>
          </section>
        </main>
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
