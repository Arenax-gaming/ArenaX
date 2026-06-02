import React from 'react';

interface SkipLinkProps {
  targetId: string;
  label?: string;
}

export const SkipLink: React.FC<SkipLinkProps> = ({
  targetId,
  label = 'Skip to main content',
}) => {
  return (
    <a
      href={`#${targetId}`}
      className="fixed top-4 left-4 z-50 -translate-y-full rounded-md bg-primary/90 px-4 py-2 text-white font-medium focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-transform"
    >
      {label}
    </a>
  );
};
