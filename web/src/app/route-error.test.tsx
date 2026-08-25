import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { developmentDiagnostic, RouteErrorPage } from './route-error';
import { routes } from './routes';

describe('route diagnostics', () => {
  it('renders a safe route error with development-only diagnostics', async () => {
    expect(routes[0]?.errorElement).toBeTruthy();

    const router = createMemoryRouter(
      [
        {
          path: '/',
          errorElement: <RouteErrorPage />,
          children: [
            { index: true, element: <p>ready</p> },
            {
              path: '__diagnostic-test',
              loader: () => {
                throw new Error('diagnostic sentinel');
              },
              element: <p>unreachable</p>,
            },
          ],
        },
      ],
      { initialEntries: ['/'] },
    );

    render(<RouterProvider router={router} />);
    await act(() => router.navigate('/__diagnostic-test'));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Halaman bermasalah' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Kami tidak dapat menampilkan halaman ini. Kembali ke halaman utama untuk melanjutkan.',
    );
    fireEvent.click(screen.getByText('Diagnostik pengembangan'));
    expect(screen.getByText(/diagnostic sentinel/)).toBeVisible();
  });

  it('withholds raw diagnostics outside development', () => {
    expect(developmentDiagnostic(new Error('private stack'), false)).toBeNull();
  });
});
