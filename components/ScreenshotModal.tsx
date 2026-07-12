import React from 'react';

interface ScreenshotModalProps {
  dataUrl: string;
  onClose: () => void;
}

export const ScreenshotModal: React.FC<ScreenshotModalProps> = ({ dataUrl, onClose }) => {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4"
      onClick={onClose}
    >
      <img
        src={dataUrl}
        alt="Ekran görüntüsü"
        className="max-w-full max-h-[85vh] object-contain rounded-sm border border-hud-dim"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        aria-label="Kapat"
        className="mt-4 px-6 py-2 bg-hud-cyan/20 text-hud-cyan border border-hud-cyan/40 rounded-sm"
      >
        Kapat
      </button>
    </div>
  );
};
