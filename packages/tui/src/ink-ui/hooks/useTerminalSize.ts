/**
 * useTerminalSize - Hook to track terminal dimensions
 */

import { useEffect, useState } from 'react';

export function useTerminalSize(): { width: number; height: number; columns: number; rows: number } {
  const [size, setSize] = useState({
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24,
  });

  useEffect(() => {
    function updateSize() {
      setSize({
        columns: process.stdout.columns || 80,
        rows: process.stdout.rows || 24,
        width: process.stdout.columns || 80,
        height: process.stdout.rows || 24,
      });
    }

    process.stdout.on('resize', updateSize);
    return () => {
      process.stdout.off('resize', updateSize);
    };
  }, []);

  return size;
}
