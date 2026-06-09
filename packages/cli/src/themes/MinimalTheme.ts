/**
 * Minimal monochrome theme for CI/CD and accessibility
 */

import { Theme } from './Theme.interface.js';

/**
 * Minimal theme with no colors and ASCII icons
 */
export const MinimalTheme: Theme = {
  name: 'minimal',
  colors: {
    // Identity functions - no color transformations
    primary: (text: string) => text,
    secondary: (text: string) => text,
    success: (text: string) => text,
    error: (text: string) => text,
    warning: (text: string) => text,
    info: (text: string) => text,
    muted: (text: string) => text,
    highlight: (text: string) => text,
    text: (text: string) => text
  },
  icons: {
    success: '[OK]',
    error: '[ERROR]',
    warning: '[WARN]',
    info: '[INFO]',
    loading: '[...]'
  }
};
