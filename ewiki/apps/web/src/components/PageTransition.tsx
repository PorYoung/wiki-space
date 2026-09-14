import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

interface PageTransitionProps {
  children: React.ReactNode;
}

export function PageTransition({ children }: PageTransitionProps): React.ReactElement {
  const location = useLocation();
  const [displayLocation, setDisplayLocation] = useState(location);
  const [phase, setPhase] = useState<'enter' | 'exit'>('enter');

  useEffect(() => {
    if (location.pathname !== displayLocation.pathname) {
      setPhase('exit');
      const timer = setTimeout(() => {
        setDisplayLocation(location);
        setPhase('enter');
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [location, displayLocation]);

  return (
    <div
      style={{
        opacity: phase === 'enter' ? 1 : 0,
        transform: phase === 'enter' ? 'translateY(0)' : 'translateY(4px)',
        transition: 'opacity 0.25s ease, transform 0.25s ease',
      }}
      key={displayLocation.pathname}
    >
      {children}
    </div>
  );
}
