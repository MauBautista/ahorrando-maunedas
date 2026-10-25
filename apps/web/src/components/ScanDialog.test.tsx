import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScanDialog } from './ScanDialog';

const camera = vi.hoisted(() => ({
  available: true,
  reads: [] as string[],
  error: null as Error | null,
  stopped: 0,
}));

vi.mock('../lib/scanner', () => ({
  canScan: () => camera.available,
  startScanner: async (_video: HTMLVideoElement, onRead: (text: string) => void) => {
    if (camera.error) throw camera.error;
    // The frames arrive after the camera opened.
    setTimeout(() => camera.reads.forEach(onRead), 0);
    return () => camera.stopped++;
  },
}));

beforeEach(() => {
  Object.assign(camera, { available: true, reads: [], error: null, stopped: 0 });
});

describe('ScanDialog (06 §3)', () => {
  it('reports a code once it is read twice, never a one-frame misread, and stops the camera', async () => {
    // The misread comes first: on its own it must never count.
    camera.reads = ['7509999999999', '7501020515343', '750-1020-515343', '7501020515343'];
    const onCode = vi.fn();
    render(<ScanDialog onCode={onCode} onClose={() => {}} />);
    await waitFor(() => expect(onCode).toHaveBeenCalledTimes(1));
    expect(onCode).toHaveBeenCalledWith('7501020515343');
    expect(camera.stopped).toBe(1);
  });

  it('says why the camera did not open, and takes a typed code', async () => {
    camera.error = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const onCode = vi.fn();
    render(<ScanDialog onCode={onCode} onClose={() => {}} />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Permite el uso de la cámara en el navegador para escanear.',
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('O escribe el código'), '123');
    await user.click(screen.getByRole('button', { name: 'Usar' }));
    expect(screen.getByText('Un código tiene de 6 a 14 dígitos.')).toBeTruthy();
    await user.clear(screen.getByLabelText('O escribe el código'));
    await user.type(screen.getByLabelText('O escribe el código'), '75010205 15343{Enter}');
    expect(onCode).toHaveBeenCalledWith('7501020515343');
  });

  it('without a camera in this browser, only the typed code', () => {
    camera.available = false;
    render(<ScanDialog onCode={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('alert').textContent).toBe('Este navegador no puede abrir la cámara.');
    expect(screen.queryByLabelText('Cámara')).toBeNull();
  });
});
