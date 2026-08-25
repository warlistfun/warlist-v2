import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';

export function developmentDiagnostic(error: unknown, enabled = import.meta.env.DEV) {
  if (!enabled) return null;
  if (error instanceof Error) return error.stack ?? error.message;
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`;
  return 'Unknown route error';
}

export function RouteErrorPage() {
  const diagnostic = developmentDiagnostic(useRouteError());

  return (
    <div className="page-shell">
      <header className="site-header" aria-label="WARLIST V2">
        <span className="wordmark">WARLIST</span>
        <span className="slice-label">Diagnostik rute</span>
      </header>
      <main id="main-content" tabIndex={-1}>
        <section className="intro error-surface" aria-labelledby="page-title" role="alert">
          <p className="eyebrow">Gangguan tampilan</p>
          <h1 id="page-title">Halaman bermasalah</h1>
          <p className="lede">
            Kami tidak dapat menampilkan halaman ini. Kembali ke halaman utama untuk melanjutkan.
          </p>
          <Link className="primary-link" to="/">
            Kembali ke halaman utama
          </Link>
          {diagnostic ? (
            <details className="diagnostic">
              <summary>Diagnostik pengembangan</summary>
              <pre>{diagnostic}</pre>
            </details>
          ) : null}
        </section>
      </main>
    </div>
  );
}
