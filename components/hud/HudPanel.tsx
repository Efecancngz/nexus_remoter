import React from 'react';

interface HudPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  accent?: 'cyan' | 'gold';
}

export default function HudPanel({ accent = 'cyan', className = '', children, ...rest }: HudPanelProps) {
  return (
    <div
      className={`hud-panel ${accent === 'gold' ? 'hud-panel-gold' : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
