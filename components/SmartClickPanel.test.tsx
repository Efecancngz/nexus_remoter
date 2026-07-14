// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import SmartClickPanel from './SmartClickPanel';
import * as gemini from '../services/gemini';
import { executor } from '../services/automation';

describe('SmartClickPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  function typeAndFind(description: string) {
    const input = screen.getByPlaceholderText(/Kaydet butonu/i);
    fireEvent.change(input, { target: { value: description } });
    fireEvent.click(screen.getByRole('button', { name: 'Bul' }));
  }

  it('shows a crosshair preview when the element is located', async () => {
    vi.spyOn(gemini, 'locate').mockResolvedValue({
      found: true,
      x_pct: 40,
      y_pct: 60,
      image: 'data:image/jpeg;base64,abc',
    });

    render(<SmartClickPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    typeAndFind('Kaydet butonu');

    const crosshair = await screen.findByTestId('smartclick-crosshair');
    expect(crosshair.style.left).toBe('40%');
    expect(crosshair.style.top).toBe('60%');
  });

  it('toasts when the element is not found', async () => {
    vi.spyOn(gemini, 'locate').mockResolvedValue({ found: false });
    const onToast = vi.fn();

    render(<SmartClickPanel ip="1.2.3.4" token="tok" onToast={onToast} />);
    typeAndFind('yok');

    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Öğe bulunamadı', 'warning'));
    expect(screen.queryByTestId('smartclick-crosshair')).toBeNull();
  });

  it('issues a percent MOUSE_CLICK on confirm', async () => {
    vi.spyOn(gemini, 'locate').mockResolvedValue({
      found: true,
      x_pct: 40,
      y_pct: 60,
      image: 'data:image/jpeg;base64,abc',
    });
    const runSpy = vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<SmartClickPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    typeAndFind('Kaydet butonu');

    fireEvent.click(await screen.findByRole('button', { name: /Onayla ve Tıkla/i }));

    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(1));
    const [steps, ip, token] = runSpy.mock.calls[0];
    expect(steps[0].type).toBe('MOUSE_CLICK');
    expect(steps[0].value).toBe('40%,60%');
    expect(ip).toBe('1.2.3.4');
    expect(token).toBe('tok');
  });

  it('does not click when the preview is cancelled', async () => {
    vi.spyOn(gemini, 'locate').mockResolvedValue({
      found: true,
      x_pct: 10,
      y_pct: 20,
      image: 'data:image/jpeg;base64,abc',
    });
    const runSpy = vi.spyOn(executor, 'run');

    render(<SmartClickPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    typeAndFind('Kaydet butonu');

    fireEvent.click(await screen.findByRole('button', { name: 'İptal' }));

    await waitFor(() =>
      expect(screen.queryByTestId('smartclick-crosshair')).toBeNull()
    );
    expect(runSpy).not.toHaveBeenCalled();
  });
});
