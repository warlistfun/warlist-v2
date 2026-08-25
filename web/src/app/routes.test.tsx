import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { routes } from './routes';

describe('application routes', () => {
  it('renders the frontend foundation at the root route', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });

    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Fondasi frontend' }),
    ).toBeVisible();
    expect(screen.getByText(/Shell WARLIST V2 untuk memeriksa rute dan tampilan/)).toBeVisible();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  });

  it.each(['/missing', '/login', '/register', '/app', '/app/setup', '/admin'])(
    'renders the catch-all page for %s',
    async (path) => {
      const router = createMemoryRouter(routes, { initialEntries: [path] });

      render(<RouterProvider router={router} />);

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Halaman tidak ditemukan' }),
      ).toBeVisible();
    },
  );

  it('navigates from the 404 view back to the root without a document reload', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/missing'] });

    render(<RouterProvider router={router} />);
    fireEvent.click(await screen.findByRole('link', { name: 'Kembali ke halaman utama' }));

    expect(router.state.location.pathname).toBe('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Fondasi frontend' }),
    ).toBeVisible();
  });
});
