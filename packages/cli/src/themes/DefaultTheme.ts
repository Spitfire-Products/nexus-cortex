/**
 * Default colorful theme using chalk
 */

import chalk from 'chalk';
import { Theme } from './Theme.interface.js';

/**
 * Default theme with colors and Unicode icons
 */
export const DefaultTheme: Theme = {
  name: 'default',
  colors: {
    primary: (text: string) => chalk.cyan.bold(text),
    secondary: (text: string) => chalk.cyan(text),
    success: (text: string) => chalk.green(text),
    error: (text: string) => chalk.red(text),
    warning: (text: string) => chalk.yellow(text),
    info: (text: string) => chalk.blue(text),
    muted: (text: string) => chalk.gray(text),
    highlight: (text: string) => chalk.bold(text),
    text: (text: string) => chalk.white(text)
  },
  icons: {
    success: '✓',
    error: '✗',
    warning: '⚠',
    info: 'ℹ',
    loading: '⏳'
  }
};
