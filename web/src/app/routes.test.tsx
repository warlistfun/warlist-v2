import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { routes } from './routes';

describe('application routes', () => {
  it('renders the frozen public landing at the root route', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });

    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Balas yang tepat, saat aturan terpenuhi.',
      }),
    ).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Lihat cara kerjanya' })).toHaveAttribute(
      'href',
      '#cara-kerja',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Aturan yang jelas' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Cara kerja' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Yang perlu disiapkan' })).toBeVisible();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Automasi mengikuti aturan yang Anda tetapkan.',
      }),
    ).toBeVisible();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(document.body.textContent).not.toContain('—');
    expect(
      screen.queryByRole('link', { name: /ketentuan|privasi|refund|masuk|daftar/i }),
    ).toBeNull();
  });

  it('publishes the frozen landing metadata', () => {
    const html = readFileSync(resolve(process.cwd(), 'web/index.html'), 'utf8');

    expect(html).toContain('<title>WARLIST: Automasi WhatsApp yang lebih tertib</title>');
    expect(html).toContain(
      'content="Susun aturan respons WhatsApp berdasarkan target, pemicu, dan jadwal melalui alur yang jelas."',
    );
  });

  it('keeps the design contract square-cornered', () => {
    const css = readFileSync(resolve(process.cwd(), 'web/src/styles.css'), 'utf8');
    const design = readFileSync(resolve(process.cwd(), 'DESIGN.md'), 'utf8');

    expect(css).toContain('--radius: 0px;');
    const radii = [...css.matchAll(/border-radius:\s*([^;]+)/g)].map((match) => match[1]?.trim());
    expect(radii.length).toBeGreaterThan(0);
    expect(radii.every((radius) => radius === 'var(--radius)')).toBe(true);
    expect(design).toContain('none: 0px');
    expect(design).not.toMatch(/sm:\s*4px|md:\s*6px|rounded: "\{rounded\.(sm|md)\}"/);
  });

  it('keeps text reflowable when the root text size doubles', () => {
    const css = readFileSync(resolve(process.cwd(), 'web/src/styles.css'), 'utf8');

    expect(css).toMatch(/h1,\s*h2,\s*h3,\s*p\s*{[^}]*overflow-wrap:\s*normal;/s);
    expect(css).toContain('font-size: clamp(1.5rem, 13vw, 6.5rem);');
    expect(css).toContain('font-size: clamp(1.5rem, 7vw, 4rem);');
    expect(css).toMatch(/\.value-grid\s*{[^}]*repeat\(auto-fit,/s);
    expect(css).toMatch(/\.step-list li\s*{[^}]*flex-wrap:\s*wrap;/s);
    expect(css).toMatch(/\.preparation-list li\s*{[^}]*padding:\s*clamp\(/s);
  });

  it.each([
    '/missing',
    '/login',
    '/register',
    '/app',
    '/app/setup',
    '/admin',
    '/terms',
    '/privacy',
    '/refund',
  ])('renders the catch-all page for %s', async (path) => {
    const router = createMemoryRouter(routes, { initialEntries: [path] });

    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Halaman tidak ditemukan' }),
    ).toBeVisible();
  });

  it('navigates from the 404 view back to the root without a document reload', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/missing'] });

    render(<RouterProvider router={router} />);
    fireEvent.click(await screen.findByRole('link', { name: 'Kembali ke halaman utama' }));

    expect(router.state.location.pathname).toBe('/');
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Balas yang tepat, saat aturan terpenuhi.',
      }),
    ).toBeVisible();
  });
});
