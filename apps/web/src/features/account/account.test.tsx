import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeAuth } from '../../test/fakes';
import { fakeWorker, renderAt } from '../../test/render';
import { passwordMessage } from './passwordMessage';

const worker = () => fakeWorker({});

async function change(current: string, next: string, repeat = next) {
  const ui = userEvent.setup();
  await ui.type(await screen.findByLabelText('Contraseña actual'), current);
  await ui.type(screen.getByLabelText('Contraseña nueva'), next);
  await ui.type(screen.getByLabelText('Repite la contraseña nueva'), repeat);
  await ui.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
}

describe('W-14 account', () => {
  it('shows who I am and how I signed in', async () => {
    renderAt('/cuenta', worker().fetchImpl);
    const dl = (await screen.findByText('Mauricio Bautista')).closest('dl')!;
    expect(dl.textContent).toBe(
      'NombreMauricio BautistaUsuariomauRolMiembroGoogleSin vincularEntraste conUsuario y contraseña',
    );
    expect(screen.getByText(/^Versión .+ · esquema 1$/)).toBeTruthy();
  });

  it('changes the password after checking the current one and the new one twice', async () => {
    const auth = new FakeAuth({ uid: 'u' });
    renderAt('/cuenta', worker().fetchImpl, auth);
    const ui = userEvent.setup();
    await ui.click(await screen.findByRole('button', { name: 'Cambiar contraseña' }));
    expect(screen.getByRole('alert').textContent).toBe('Escribe tu contraseña actual.');
    await change('buena', 'corta');
    expect(screen.getByRole('alert').textContent).toBe('La contraseña nueva necesita al menos 8 caracteres.');
    for (const label of ['Contraseña actual', 'Contraseña nueva', 'Repite la contraseña nueva'])
      await ui.clear(screen.getByLabelText(label));
    await change('buena', 'una-larga', 'otra-larga');
    expect(screen.getByRole('alert').textContent).toBe('Las contraseñas nuevas no coinciden.');
    for (const label of ['Contraseña actual', 'Contraseña nueva', 'Repite la contraseña nueva'])
      await ui.clear(screen.getByLabelText(label));
    await change('mala', 'una-larga');
    expect((await screen.findByRole('alert')).textContent).toBe('La contraseña actual no es correcta.');
    expect(auth.password).toBe('buena');
    for (const label of ['Contraseña actual', 'Contraseña nueva', 'Repite la contraseña nueva'])
      await ui.clear(screen.getByLabelText(label));
    await change('buena', 'una-larga');
    expect((await screen.findByRole('status')).textContent).toBe('Listo: tu contraseña cambió.');
    expect(auth.password).toBe('una-larga');
    // The fields are emptied: nothing stays typed on screen.
    expect((screen.getByLabelText('Contraseña actual') as HTMLInputElement).value).toBe('');
  });

  it('says what Firebase refused', async () => {
    const auth = new FakeAuth({ uid: 'u' });
    renderAt('/cuenta', worker().fetchImpl, auth);
    await change('buena', 'debil123');
    expect((await screen.findByRole('alert')).textContent).toBe('Esa contraseña es muy débil. Elige otra.');
    expect(passwordMessage({ code: 'auth/network-request-failed' })).toBe(
      'Necesitas internet para cambiar la contraseña.',
    );
    expect(passwordMessage({ code: 'auth/too-many-requests' })).toBe(
      'Demasiados intentos. Espera un momento e intenta de nuevo.',
    );
    expect(passwordMessage(new Error('x'))).toBe('No se pudo cambiar la contraseña. Intenta de nuevo.');
  });

  it('does not offer to change the password of a Google session', async () => {
    const auth = new FakeAuth({ uid: 'u' });
    auth.method = 'google';
    renderAt('/cuenta', worker().fetchImpl, auth);
    expect(
      await screen.findByText(
        'Entraste con Google. Para cambiar tu contraseña, cierra sesión y entra con tu usuario y contraseña.',
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Contraseña actual')).toBeNull();
    expect(screen.getByText('Google', { selector: 'dd' })).toBeTruthy();
  });

  it('signs out and goes to the login', async () => {
    const auth = new FakeAuth({ uid: 'u' });
    const router = renderAt('/cuenta', worker().fetchImpl, auth);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(auth.signOuts).toBe(1);
  });
});
