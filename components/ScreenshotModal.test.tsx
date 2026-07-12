// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ScreenshotModal } from './ScreenshotModal';

afterEach(cleanup);

describe('ScreenshotModal', () => {
  it('renders the image and calls onClose', () => {
    const onClose = vi.fn();
    render(<ScreenshotModal dataUrl="data:image/jpeg;base64,AAAA" onClose={onClose} />);

    const img = screen.getByAltText('Ekran görüntüsü') as HTMLImageElement;
    expect(img.src).toContain('data:image/jpeg;base64,AAAA');

    fireEvent.click(screen.getByRole('button', { name: /kapat/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
