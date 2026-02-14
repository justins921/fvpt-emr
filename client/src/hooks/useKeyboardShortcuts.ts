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
          case 's': e.preventDefault(); navigate('/schedule'); break;
          case 'p': e.preventDefault(); navigate('/patients'); break;
          case 'b': e.preventDefault(); navigate('/billing'); break;
          case 'a': e.preventDefault(); navigate('/admin/audit'); break;
          case 'h': e.preventDefault(); navigate('/'); break;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);
}
