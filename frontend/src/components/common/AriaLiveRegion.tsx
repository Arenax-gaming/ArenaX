import React, { useState, useEffect } from 'react';

export interface AriaLiveRegionProps {
  message: string;
  ariaLive?: 'polite' | 'assertive';
}

/**
 * Component for Advanced Accessibility with ARIA Live Regions (Resolves #601)
 */
export const AriaLiveRegion: React.FC<AriaLiveRegionProps> = ({ message, ariaLive = 'polite' }) => {
  const [announcedMessage, setAnnouncedMessage] = useState('');

  useEffect(() => {
    if (message) {
      setAnnouncedMessage(message);
    }
  }, [message]);

  return (
    <div aria-live={ariaLive} className="sr-only" aria-atomic="true">
      {announcedMessage}
    </div>
  );
};
