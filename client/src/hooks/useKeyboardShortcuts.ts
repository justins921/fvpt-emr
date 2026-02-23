import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function useKeyboardShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if in input/textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.altKey) {
        switch (e.key) {
          case 's': e.preventDefault(); navigate('/app/schedule'); break;
          case 'p': e.preventDefault(); navigate('/app/patients'); break;
          case 'b': e.preventDefault(); navigate('/app/billing'); break;
          case 'a': e.preventDefault(); navigate('/app/admin/audit'); break;
          case 'h': e.preventDefault(); navigate('/app'); break;
          case 'm': e.preventDefault(); navigate('/app/messages'); break;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);
}
