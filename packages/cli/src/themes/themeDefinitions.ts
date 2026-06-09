/**
 * Comprehensive theme color definitions
 * Ported from themes/chalk/theme-definitions.cjs
 */

export interface ThemeDefinition {
  name: string;
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  text: string;
  dimmed: string;
  background: string;
  accent?: string;
  // Syntax highlighting
  keyword: string;
  function: string;
  string: string;
  number: string;
  variable: string;
  comment: string;
}

export const themeDefinitions: Record<string, ThemeDefinition> = {
  vscodeOneDark: {
    name: 'VS Code One Dark',
    primary: '#61AFEF',
    secondary: '#C678DD',
    success: '#98C379',
    warning: '#E5C07B',
    error: '#E06C75',
    info: '#56B6C2',
    text: '#ABB2BF',
    dimmed: '#5C6370',
    background: '#282C34',
    keyword: '#C678DD',
    function: '#61AFEF',
    string: '#98C379',
    number: '#D19A66',
    variable: '#E06C75',
    comment: '#5C6370'
  },

  monokai: {
    name: 'Monokai',
    primary: '#66D9EF',
    secondary: '#F92672',
    success: '#A6E22E',
    warning: '#FD971F',
    error: '#F92672',
    info: '#AE81FF',
    text: '#F8F8F2',
    dimmed: '#75715E',
    background: '#272822',
    keyword: '#F92672',
    function: '#A6E22E',
    string: '#E6DB74',
    number: '#AE81FF',
    variable: '#FD971F',
    comment: '#75715E'
  },

  dracula: {
    name: 'Dracula',
    primary: '#8BE9FD',
    secondary: '#FF79C6',
    success: '#50FA7B',
    warning: '#FFB86C',
    error: '#FF5555',
    info: '#BD93F9',
    text: '#F8F8F2',
    dimmed: '#6272A4',
    background: '#282A36',
    keyword: '#FF79C6',
    function: '#50FA7B',
    string: '#F1FA8C',
    number: '#BD93F9',
    variable: '#F8F8F2',
    comment: '#6272A4'
  },

  githubLight: {
    name: 'GitHub Light',
    primary: '#0969da',
    secondary: '#8250df',
    success: '#1a7f37',
    warning: '#9a6700',
    error: '#cf222e',
    info: '#0969da',
    text: '#1f2328',
    dimmed: '#656d76',
    background: '#ffffff',
    keyword: '#d73a49',
    function: '#6f42c1',
    string: '#032f62',
    number: '#005cc5',
    variable: '#e36209',
    comment: '#6a737d'
  },

  solarizedDark: {
    name: 'Solarized Dark',
    primary: '#268bd2',
    secondary: '#2aa198',
    success: '#859900',
    warning: '#b58900',
    error: '#dc322f',
    info: '#6c71c4',
    text: '#839496',
    dimmed: '#586e75',
    background: '#002b36',
    accent: '#cb4b16',
    keyword: '#859900',
    function: '#268bd2',
    string: '#2aa198',
    number: '#d33682',
    variable: '#b58900',
    comment: '#586e75'
  },

  tokyoNight: {
    name: 'Tokyo Night',
    primary: '#7aa2f7',
    secondary: '#bb9af7',
    success: '#9ece6a',
    warning: '#e0af68',
    error: '#f7768e',
    info: '#7dcfff',
    text: '#a9b1d6',
    dimmed: '#565f89',
    background: '#1a1b26',
    accent: '#ff9e64',
    keyword: '#9d7cd8',
    function: '#7aa2f7',
    string: '#9ece6a',
    number: '#ff9e64',
    variable: '#bb9af7',
    comment: '#565f89'
  },

  nord: {
    name: 'Nord',
    primary: '#88C0D0',
    secondary: '#81A1C1',
    success: '#A3BE8C',
    warning: '#EBCB8B',
    error: '#BF616A',
    info: '#5E81AC',
    text: '#D8DEE9',
    dimmed: '#4C566A',
    background: '#2E3440',
    keyword: '#81A1C1',
    function: '#88C0D0',
    string: '#A3BE8C',
    number: '#B48EAD',
    variable: '#D8DEE9',
    comment: '#616E88'
  },

  gruvboxDark: {
    name: 'Gruvbox Dark',
    primary: '#83a598',
    secondary: '#d3869b',
    success: '#b8bb26',
    warning: '#fabd2f',
    error: '#fb4934',
    info: '#8ec07c',
    text: '#ebdbb2',
    dimmed: '#928374',
    background: '#282828',
    keyword: '#fb4934',
    function: '#b8bb26',
    string: '#b8bb26',
    number: '#d3869b',
    variable: '#83a598',
    comment: '#928374'
  },

  materialOcean: {
    name: 'Material Ocean',
    primary: '#82AAFF',
    secondary: '#C792EA',
    success: '#C3E88D',
    warning: '#FFCB6B',
    error: '#F07178',
    info: '#89DDFF',
    text: '#EEFFFF',
    dimmed: '#546E7A',
    background: '#0F111A',
    keyword: '#C792EA',
    function: '#82AAFF',
    string: '#C3E88D',
    number: '#F78C6C',
    variable: '#FFCB6B',
    comment: '#546E7A'
  },

  atomOneLight: {
    name: 'Atom One Light',
    primary: '#4078f2',
    secondary: '#a626a4',
    success: '#50a14f',
    warning: '#c18401',
    error: '#e45649',
    info: '#0184bc',
    text: '#383a42',
    dimmed: '#a0a1a7',
    background: '#fafafa',
    keyword: '#a626a4',
    function: '#4078f2',
    string: '#50a14f',
    number: '#986801',
    variable: '#e45649',
    comment: '#a0a1a7'
  },

  palenight: {
    name: 'Palenight',
    primary: '#82b1ff',
    secondary: '#c792ea',
    success: '#c3e88d',
    warning: '#ffcb6b',
    error: '#ff5370',
    info: '#82aaff',
    text: '#959dcb',
    dimmed: '#676e95',
    background: '#292d3e',
    keyword: '#c792ea',
    function: '#82aaff',
    string: '#c3e88d',
    number: '#f78c6c',
    variable: '#ff5370',
    comment: '#676e95'
  },

  cobalt2: {
    name: 'Cobalt2',
    primary: '#ffc600',
    secondary: '#ff0088',
    success: '#9eff80',
    warning: '#ff9d00',
    error: '#ff628c',
    info: '#80ffbb',
    text: '#ffffff',
    dimmed: '#8b9dc3',
    background: '#193549',
    keyword: '#ff0088',
    function: '#ffc600',
    string: '#9eff80',
    number: '#ff628c',
    variable: '#80ffbb',
    comment: '#0088ff'
  },

  aura: {
    name: 'Aura',
    primary: '#a277ff',
    secondary: '#61ffca',
    success: '#82e2ff',
    warning: '#ffca85',
    error: '#ff6767',
    info: '#f694ff',
    text: '#edecee',
    dimmed: '#6d6d6d',
    background: '#15141b',
    keyword: '#a277ff',
    function: '#82e2ff',
    string: '#61ffca',
    number: '#ffca85',
    variable: '#f694ff',
    comment: '#6d6d6d'
  }
};

export type ThemeName = keyof typeof themeDefinitions;

export const themeNames: ThemeName[] = Object.keys(themeDefinitions) as ThemeName[];
