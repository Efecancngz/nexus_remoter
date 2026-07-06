// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ConnectScreen from './ConnectScreen';

afterEach(cleanup);

const ipInput = () => screen.getByPlaceholderText('Örn: 192.168.68.57');
const pinInput = () => screen.getByPlaceholderText('0000');
const submitButton = () => screen.getByRole('button', { name: /Bağlan ve Başlat/i });

describe('ConnectScreen', () => {
  it('renders the IP and PIN inputs with an empty initial state', () => {
    render(<ConnectScreen onPair={vi.fn()} />);

    expect(ipInput()).toHaveProperty('value', '');
    expect(pinInput()).toHaveProperty('value', '');
    expect(screen.queryByText(/sertifikayı onaylayın/i)).toBeNull();
  });

  it('shows the certificate trust link once an IP is typed, pointing at the agent root over https', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen onPair={vi.fn()} />);

    await user.type(ipInput(), 'http://192.168.1.5/');

    const link = screen.getByRole('link', { name: /sertifikayı onaylayın/i });
    expect(link.getAttribute('href')).toBe('https://192.168.1.5:8080/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('validates that an IP is present before pairing', async () => {
    const onPair = vi.fn();
    const user = userEvent.setup();
    render(<ConnectScreen onPair={onPair} />);

    await user.click(submitButton());

    expect(await screen.findByText(/IP adresini girin/i)).toBeTruthy();
    expect(onPair).not.toHaveBeenCalled();
  });

  it('validates that the PIN has 4 digits before pairing', async () => {
    const onPair = vi.fn();
    const user = userEvent.setup();
    render(<ConnectScreen onPair={onPair} />);

    await user.type(ipInput(), '192.168.1.5');
    await user.type(pinInput(), '12');
    await user.click(submitButton());

    expect(await screen.findByText(/4 haneli/i)).toBeTruthy();
    expect(onPair).not.toHaveBeenCalled();
  });

  it('strips non-digits from the PIN input', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen onPair={vi.fn()} />);

    await user.type(pinInput(), '1a2b');

    expect(pinInput()).toHaveProperty('value', '12');
  });

  it('calls onPair with the entered IP and PIN', async () => {
    const onPair = vi.fn().mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<ConnectScreen onPair={onPair} />);

    await user.type(ipInput(), '192.168.1.5');
    await user.type(pinInput(), '1234');
    await user.click(submitButton());

    await waitFor(() => {
      expect(onPair).toHaveBeenCalledWith('192.168.1.5', '1234');
    });
  });

  it('shows the pairing error returned by onPair', async () => {
    const onPair = vi.fn().mockResolvedValue({ success: false, error: 'Hatalı PIN Kodu!' });
    const user = userEvent.setup();
    render(<ConnectScreen onPair={onPair} />);

    await user.type(ipInput(), '192.168.1.5');
    await user.type(pinInput(), '0000');
    await user.click(submitButton());

    expect(await screen.findByText('Hatalı PIN Kodu!')).toBeTruthy();
  });

  it('prefills initial IP and PIN when provided', () => {
    render(<ConnectScreen onPair={vi.fn()} initialIp="10.0.0.7" initialPin="9876" />);

    expect(ipInput()).toHaveProperty('value', '10.0.0.7');
    expect(pinInput()).toHaveProperty('value', '9876');
    // Prefilled IP should immediately expose the trust link too.
    expect(screen.getByRole('link', { name: /sertifikayı onaylayın/i }).getAttribute('href')).toBe(
      'https://10.0.0.7:8080/'
    );
  });
});
