/**
 * Theme interface for CLI output styling
 */

/**
 * Theme color functions
 */
export interface ThemeColors {
  primary: (text: string) => string;
  secondary: (text: string) => string;
  success: (text: string) => string;
  error: (text: string) => string;
  warning: (text: string) => string;
  info: (text: string) => string;
  muted: (text: string) => string;
  highlight: (text: string) => string;
  text: (text: string) => string;
}

/**
 * Theme icons
 */
export interface ThemeIcons {
  success: string;
  error: string;
  warning: string;
  info: string;
  loading: string;
}

/**
 * Complete theme definition
 */
export interface Theme {
  name: string;
  colors: ThemeColors;
  icons: ThemeIcons;
}
