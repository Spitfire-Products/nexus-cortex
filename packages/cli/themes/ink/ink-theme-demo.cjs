#!/usr/bin/env node
const React = require('react');
const {render, Box, Text} = require('ink');

// Theme definitions with all 12 themes
const themes = {
  vscode: {
    name: 'VS Code One Dark',
    primary: '#61AFEF',
    secondary: '#C678DD',
    success: '#98C379',
    warning: '#E5C07B',
    error: '#E06C75',
    info: '#56B6C2',
    text: '#ABB2BF',
    dimmed: '#5C6370'
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
    dimmed: '#75715E'
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
    dimmed: '#6272A4'
  },
  github: {
    name: 'GitHub Light',
    primary: '#0969da',
    secondary: '#8250df',
    success: '#1a7f37',
    warning: '#9a6700',
    error: '#cf222e',
    info: '#0969da',
    text: '#1f2328',
    dimmed: '#656d76'
  },
  solarized: {
    name: 'Solarized Dark',
    primary: '#268bd2',
    secondary: '#2aa198',
    success: '#859900',
    warning: '#b58900',
    error: '#dc322f',
    info: '#6c71c4',
    text: '#839496',
    dimmed: '#586e75'
  },
  tokyo: {
    name: 'Tokyo Night',
    primary: '#7aa2f7',
    secondary: '#bb9af7',
    success: '#9ece6a',
    warning: '#e0af68',
    error: '#f7768e',
    info: '#7dcfff',
    text: '#a9b1d6',
    dimmed: '#565f89'
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
    dimmed: '#4C566A'
  },
  gruvbox: {
    name: 'Gruvbox Dark',
    primary: '#83a598',
    secondary: '#d3869b',
    success: '#b8bb26',
    warning: '#fabd2f',
    error: '#fb4934',
    info: '#8ec07c',
    text: '#ebdbb2',
    dimmed: '#928374'
  },
  material: {
    name: 'Material Ocean',
    primary: '#82AAFF',
    secondary: '#C792EA',
    success: '#C3E88D',
    warning: '#FFCB6B',
    error: '#F07178',
    info: '#89DDFF',
    text: '#EEFFFF',
    dimmed: '#546E7A'
  },
  atom: {
    name: 'Atom One Light',
    primary: '#4078f2',
    secondary: '#a626a4',
    success: '#50a14f',
    warning: '#c18401',
    error: '#e45649',
    info: '#0184bc',
    text: '#383a42',
    dimmed: '#a0a1a7'
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
    dimmed: '#676e95'
  },
  cobalt: {
    name: 'Cobalt2',
    primary: '#ffc600',
    secondary: '#ff0088',
    success: '#9eff80',
    warning: '#ff9d00',
    error: '#ff628c',
    info: '#80ffbb',
    text: '#ffffff',
    dimmed: '#8b9dc3'
  }
};

// Main App Component
function InkThemeShowcase() {
  return React.createElement(Box, {flexDirection: 'column', padding: 1}, [
    // Header
    React.createElement(Box, {key: 'header', marginBottom: 1},
      React.createElement(Text, {color: 'cyan', bold: true},
        '════════════════════════════════════════════════════════════════'
      )
    ),
    React.createElement(Box, {key: 'title', marginBottom: 1, justifyContent: 'center'},
      React.createElement(Text, {color: 'cyan', bold: true},
        'INK THEME SHOWCASE - All 12 Themes'
      )
    ),
    React.createElement(Box, {key: 'header2', marginBottom: 1},
      React.createElement(Text, {color: 'cyan', bold: true},
        '════════════════════════════════════════════════════════════════'
      )
    ),

    // Display all themes
    ...Object.entries(themes).map(([key, theme], index) =>
      React.createElement(Box, {
        key: key,
        flexDirection: 'column',
        marginBottom: 1,
        borderStyle: 'round',
        borderColor: theme.primary,
        padding: 1
      }, [
        // Theme Name
        React.createElement(Text, {key: 'name', color: theme.primary, bold: true, underline: true},
          `${index + 1}. ${theme.name}`
        ),

        // Color Swatches
        React.createElement(Box, {key: 'colors', marginTop: 1}, [
          React.createElement(Text, {key: 'primary', color: theme.primary}, '■ Primary '),
          React.createElement(Text, {key: 'secondary', color: theme.secondary}, '■ Secondary '),
          React.createElement(Text, {key: 'success', color: theme.success}, '■ Success '),
          React.createElement(Text, {key: 'warning', color: theme.warning}, '■ Warning ')
        ]),

        React.createElement(Box, {key: 'colors2'}, [
          React.createElement(Text, {key: 'error', color: theme.error}, '■ Error '),
          React.createElement(Text, {key: 'info', color: theme.info}, '■ Info '),
          React.createElement(Text, {key: 'text', color: theme.text}, '■ Text '),
          React.createElement(Text, {key: 'dimmed', color: theme.dimmed}, '■ Dimmed ')
        ]),

        // Sample UI
        React.createElement(Box, {key: 'ui', flexDirection: 'column', marginTop: 1}, [
          React.createElement(Box, {key: 'success'}, [
            React.createElement(Text, {color: theme.success}, '✓ '),
            React.createElement(Text, {color: theme.text}, 'Task completed')
          ]),
          React.createElement(Box, {key: 'error'}, [
            React.createElement(Text, {color: theme.error}, '✗ '),
            React.createElement(Text, {color: theme.text}, 'Build failed')
          ]),
          React.createElement(Box, {key: 'warning'}, [
            React.createElement(Text, {color: theme.warning}, '⚠ '),
            React.createElement(Text, {color: theme.text}, 'Warning issued')
          ])
        ])
      ])
    ),

    // Footer
    React.createElement(Box, {key: 'footer', marginTop: 1},
      React.createElement(Text, {color: 'gray'},
        '════════════════════════════════════════════════════════════════'
      )
    ),
    React.createElement(Box, {key: 'instructions'},
      React.createElement(Text, {color: 'gray'},
        'Run with: node ink-theme-demo.cjs'
      )
    )
  ]);
}

// Render the app
render(React.createElement(InkThemeShowcase));