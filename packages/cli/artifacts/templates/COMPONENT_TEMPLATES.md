# Artifact Component Templates

Ready-to-use React/Ink components for the dynamic artifact system.

## Base Component Contract

All components must follow this contract:

```typescript
interface ArtifactComponentProps {
  // Required
  data: any;                    // Component data
  bridge: MessageBridge;        // Communication bridge

  // Optional
  interactive?: boolean;        // Enable interaction
  theme?: string;              // Theme name
  state?: ArtifactState;       // Current state
  onUpdate?: (data: any) => void;
  onCommand?: (cmd: string, args: any[]) => void;
  onError?: (error: Error) => void;
}
```

## Template Components

### 1. Dashboard Component

```javascript
// templates/Dashboard.jsx
const React = require('react');
const { Box, Text, useInput, useApp } = require('ink');
const { useState, useEffect, useCallback } = React;

const DashboardTemplate = ({ data, bridge, interactive = true, theme = 'default' }) => {
  const [selectedWidget, setSelectedWidget] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedWidget, setExpandedWidget] = useState(null);
  const { exit } = useApp();

  // Handle keyboard input
  useInput((input, key) => {
    if (!interactive) return;

    // Navigation
    if (key.upArrow) {
      setSelectedWidget(prev => Math.max(0, prev - 1));
    }
    if (key.downArrow) {
      setSelectedWidget(prev =>
        Math.min((data.widgets?.length || 1) - 1, prev + 1)
      );
    }

    // Actions
    if (key.return) {
      const widget = data.widgets?.[selectedWidget];
      if (widget) {
        setExpandedWidget(expandedWidget === widget.id ? null : widget.id);
      }
    }

    // Commands
    if (input === 'r') {
      refreshData();
    }
    if (input === 'q' || key.escape) {
      bridge.send({ type: 'command', payload: { command: 'close' } });
      exit();
    }
  });

  const refreshData = useCallback(async () => {
    setRefreshing(true);
    bridge.send({
      type: 'data_request',
      payload: { query: 'all', force: true }
    });

    setTimeout(() => setRefreshing(false), 1000);
  }, [bridge]);

  // Auto-refresh
  useEffect(() => {
    if (data.autoRefresh) {
      const interval = setInterval(refreshData, data.autoRefresh);
      return () => clearInterval(interval);
    }
  }, [data.autoRefresh, refreshData]);

  const renderWidget = (widget, index) => {
    const isSelected = index === selectedWidget;
    const isExpanded = expandedWidget === widget.id;
    const borderColor = isSelected ? 'cyan' : 'gray';

    return (
      <Box
        key={widget.id}
        flexDirection="column"
        borderStyle={isSelected ? 'double' : 'single'}
        borderColor={borderColor}
        padding={1}
        marginBottom={1}
      >
        <Box justifyContent="space-between">
          <Text color={isSelected ? 'cyan' : 'white'} bold>
            {isSelected && '▶ '}{widget.title}
          </Text>
          {widget.badge && (
            <Text color={widget.badgeColor || 'yellow'}>
              {widget.badge}
            </Text>
          )}
        </Box>

        <Box marginTop={1}>
          {widget.type === 'metric' && (
            <Box>
              <Text color="green" bold>{widget.value}</Text>
              <Text color="gray"> {widget.unit}</Text>
              {widget.trend && (
                <Text color={widget.trend > 0 ? 'green' : 'red'}>
                  {' '}({widget.trend > 0 ? '↑' : '↓'}{Math.abs(widget.trend)}%)
                </Text>
              )}
            </Box>
          )}

          {widget.type === 'list' && (
            <Box flexDirection="column">
              {widget.items?.slice(0, isExpanded ? undefined : 3).map((item, i) => (
                <Text key={i} color={item.color || 'white'}>
                  • {item.label}: {item.value}
                </Text>
              ))}
              {!isExpanded && widget.items?.length > 3 && (
                <Text color="gray">... +{widget.items.length - 3} more</Text>
              )}
            </Box>
          )}

          {widget.type === 'chart' && (
            <Box>
              {renderMiniChart(widget.data, isExpanded)}
            </Box>
          )}
        </Box>
      </Box>
    );
  };

  const renderMiniChart = (chartData, expanded = false) => {
    const height = expanded ? 10 : 5;
    const width = expanded ? 60 : 30;
    const max = Math.max(...(chartData?.values || [0]));

    return (
      <Box flexDirection="column">
        {chartData?.values?.slice(-width).map((value, i) => {
          const barHeight = Math.round((value / max) * height);
          const bar = '█'.repeat(barHeight) + '░'.repeat(height - barHeight);
          return <Text key={i} color="cyan">{bar} {value}</Text>;
        }).reverse().slice(0, height)}
      </Box>
    );
  };

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box
        padding={1}
        borderStyle="round"
        borderColor="cyan"
        marginBottom={1}
      >
        <Text color="cyan" bold>
          📊 {data.title || 'Dashboard'}
        </Text>
        {refreshing && <Text color="yellow"> ⟳ Refreshing...</Text>}
        {data.status && (
          <Text color={data.statusColor || 'green'}> [{data.status}]</Text>
        )}
      </Box>

      {/* Widgets */}
      <Box flexDirection="column">
        {data.widgets?.map(renderWidget)}
      </Box>

      {/* Footer */}
      {interactive && (
        <Box
          padding={1}
          borderStyle="single"
          borderColor="gray"
        >
          <Text color="gray">
            ↑↓ Navigate | ↵ Expand | R: Refresh | Q: Quit
          </Text>
        </Box>
      )}
    </Box>
  );
};

module.exports = DashboardTemplate;
```

### 2. Form Component

```javascript
// templates/Form.jsx
const React = require('react');
const { Box, Text, useInput } = require('ink');
const TextInput = require('ink-text-input').default;
const SelectInput = require('ink-select-input').default;
const { useState, useCallback } = React;

const FormTemplate = ({ data, bridge, interactive = true }) => {
  const [fields, setFields] = useState(data.fields || {});
  const [currentField, setCurrentField] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [errors, setErrors] = useState({});

  const fieldList = Object.entries(data.schema || {});

  useInput((input, key) => {
    if (!interactive) return;

    if (!editMode) {
      if (key.upArrow) {
        setCurrentField(prev => Math.max(0, prev - 1));
      }
      if (key.downArrow) {
        setCurrentField(prev => Math.min(fieldList.length - 1, prev + 1));
      }
      if (key.return || input === ' ') {
        setEditMode(true);
      }
      if (input === 's') {
        submitForm();
      }
      if (key.escape) {
        bridge.send({ type: 'command', payload: { command: 'cancel' } });
      }
    } else {
      if (key.escape) {
        setEditMode(false);
      }
    }
  });

  const validateField = useCallback((name, value, schema) => {
    if (schema.required && !value) {
      return 'Required field';
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      return schema.patternMessage || 'Invalid format';
    }
    if (schema.min && value.length < schema.min) {
      return `Minimum ${schema.min} characters`;
    }
    if (schema.max && value.length > schema.max) {
      return `Maximum ${schema.max} characters`;
    }
    return null;
  }, []);

  const submitForm = useCallback(() => {
    const newErrors = {};
    let hasErrors = false;

    // Validate all fields
    fieldList.forEach(([name, schema]) => {
      const error = validateField(name, fields[name], schema);
      if (error) {
        newErrors[name] = error;
        hasErrors = true;
      }
    });

    setErrors(newErrors);

    if (!hasErrors) {
      bridge.send({
        type: 'action',
        payload: {
          action: 'form_submit',
          data: fields,
          formId: data.id
        }
      });
    }
  }, [fields, fieldList, validateField, bridge, data.id]);

  const renderField = ([name, schema], index) => {
    const isSelected = index === currentField;
    const value = fields[name] || '';
    const error = errors[name];

    return (
      <Box key={name} marginBottom={1}>
        <Box width="30%">
          <Text color={isSelected ? 'cyan' : 'white'}>
            {isSelected && '▶ '}{schema.label || name}
            {schema.required && <Text color="red"> *</Text>}
          </Text>
        </Box>
        <Box width="70%">
          {editMode && isSelected ? (
            <Box flexDirection="column">
              {schema.type === 'select' ? (
                <SelectInput
                  items={schema.options.map(opt => ({
                    label: opt.label,
                    value: opt.value
                  }))}
                  onSelect={item => {
                    setFields({ ...fields, [name]: item.value });
                    setEditMode(false);
                  }}
                />
              ) : (
                <TextInput
                  value={value}
                  onChange={v => setFields({ ...fields, [name]: v })}
                  onSubmit={() => setEditMode(false)}
                  placeholder={schema.placeholder}
                />
              )}
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text color={value ? 'green' : 'gray'}>
                {value || '(empty)'}
              </Text>
              {error && <Text color="red">⚠ {error}</Text>}
            </Box>
          )}
        </Box>
      </Box>
    );
  };

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box
        padding={1}
        borderStyle="round"
        borderColor="magenta"
        marginBottom={1}
      >
        <Text color="magenta" bold>
          📝 {data.title || 'Form'}
        </Text>
        {data.description && (
          <Text color="gray"> - {data.description}</Text>
        )}
      </Box>

      {/* Fields */}
      <Box flexDirection="column" padding={1}>
        {fieldList.map(renderField)}
      </Box>

      {/* Actions */}
      <Box padding={1} borderStyle="single" borderColor="gray">
        {!editMode ? (
          <Text color="gray">
            ↑↓ Navigate | ↵ Edit | S: Submit | ESC: Cancel
          </Text>
        ) : (
          <Text color="yellow">
            Editing... | ↵ Save | ESC: Cancel Edit
          </Text>
        )}
      </Box>
    </Box>
  );
};

module.exports = FormTemplate;
```

### 3. Chart Component

```javascript
// templates/Chart.jsx
const React = require('react');
const { Box, Text } = require('ink');
const { useState, useEffect } = React;

const ChartTemplate = ({ data, bridge }) => {
  const [series, setSeries] = useState(data.series || []);
  const [timeRange, setTimeRange] = useState(data.timeRange || '1h');

  useEffect(() => {
    // Update series when data changes
    if (data.series) {
      setSeries(data.series);
    }
  }, [data.series]);

  const renderBarChart = () => {
    const maxValue = Math.max(...series.map(s => s.value));
    const barWidth = 30;

    return (
      <Box flexDirection="column">
        {series.map((item, i) => {
          const percentage = (item.value / maxValue);
          const filledWidth = Math.round(percentage * barWidth);
          const emptyWidth = barWidth - filledWidth;

          const bar = '█'.repeat(filledWidth) + '░'.repeat(emptyWidth);
          const color = item.color || 'cyan';

          return (
            <Box key={i} marginBottom={1}>
              <Box width="20%">
                <Text>{item.name}:</Text>
              </Box>
              <Box width="50%">
                <Text color={color}>{bar}</Text>
              </Box>
              <Box width="30%">
                <Text color={color}> {item.value}</Text>
                {item.unit && <Text color="gray"> {item.unit}</Text>}
                {item.change && (
                  <Text color={item.change > 0 ? 'green' : 'red'}>
                    {' '}({item.change > 0 ? '+' : ''}{item.change}%)
                  </Text>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    );
  };

  const renderLineChart = () => {
    const height = 10;
    const width = 60;
    const points = data.points || [];
    const maxY = Math.max(...points.map(p => p.y));
    const minY = Math.min(...points.map(p => p.y));
    const range = maxY - minY;

    // Create ASCII chart
    const chart = Array(height).fill(null).map(() =>
      Array(width).fill(' ')
    );

    // Plot points
    points.slice(-width).forEach((point, x) => {
      const y = height - 1 - Math.round(((point.y - minY) / range) * (height - 1));
      if (y >= 0 && y < height) {
        chart[y][x] = '●';
      }
    });

    // Draw axes
    for (let y = 0; y < height; y++) {
      chart[y][0] = '│';
    }
    for (let x = 0; x < width; x++) {
      chart[height - 1][x] = chart[height - 1][x] === '●' ? '●' : '─';
    }

    return (
      <Box flexDirection="column">
        <Text color="gray">{maxY}</Text>
        {chart.map((row, i) => (
          <Text key={i} color="cyan">
            {row.join('')}
          </Text>
        ))}
        <Text color="gray">{minY}</Text>
      </Box>
    );
  };

  const renderSparkline = () => {
    const sparks = '▁▂▃▄▅▆▇█';
    const values = data.values || [];
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min;

    const sparkline = values.map(v => {
      const index = Math.round(((v - min) / range) * (sparks.length - 1));
      return sparks[index];
    }).join('');

    return (
      <Box>
        <Text color="cyan">{sparkline}</Text>
        <Text color="gray"> {values[values.length - 1]}</Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box
        padding={1}
        borderStyle="round"
        borderColor="green"
        marginBottom={1}
      >
        <Text color="green" bold>
          📈 {data.title || 'Chart'}
        </Text>
        {data.subtitle && <Text color="gray"> - {data.subtitle}</Text>}
        {timeRange && <Text color="yellow"> [{timeRange}]</Text>}
      </Box>

      {/* Chart Content */}
      <Box padding={1}>
        {data.type === 'bar' && renderBarChart()}
        {data.type === 'line' && renderLineChart()}
        {data.type === 'sparkline' && renderSparkline()}
      </Box>

      {/* Legend */}
      {data.legend && (
        <Box padding={1} borderStyle="single" borderColor="gray">
          <Text color="gray">Legend: </Text>
          {data.legend.map((item, i) => (
            <React.Fragment key={i}>
              <Text color={item.color}>{item.symbol} {item.label} </Text>
            </React.Fragment>
          ))}
        </Box>
      )}
    </Box>
  );
};

module.exports = ChartTemplate;
```

### 4. Table Component

```javascript
// templates/Table.jsx
const React = require('react');
const { Box, Text, useInput } = require('ink');
const { useState } = React;

const TableTemplate = ({ data, bridge, interactive = true }) => {
  const [selectedRow, setSelectedRow] = useState(0);
  const [sortColumn, setSortColumn] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');
  const [filter, setFilter] = useState('');

  const columns = data.columns || [];
  const rows = data.rows || [];

  useInput((input, key) => {
    if (!interactive) return;

    if (key.upArrow) {
      setSelectedRow(prev => Math.max(0, prev - 1));
    }
    if (key.downArrow) {
      setSelectedRow(prev => Math.min(rows.length - 1, prev + 1));
    }
    if (key.leftArrow && columns.length > 0) {
      const currentIndex = columns.findIndex(c => c.key === sortColumn);
      const newIndex = Math.max(0, currentIndex - 1);
      setSortColumn(columns[newIndex].key);
    }
    if (key.rightArrow && columns.length > 0) {
      const currentIndex = columns.findIndex(c => c.key === sortColumn);
      const newIndex = Math.min(columns.length - 1, currentIndex + 1);
      setSortColumn(columns[newIndex].key);
    }
    if (input === 's') {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    }
    if (key.return) {
      const row = sortedRows[selectedRow];
      if (row) {
        bridge.send({
          type: 'action',
          payload: {
            action: 'row_select',
            data: row
          }
        });
      }
    }
  });

  // Apply filtering
  const filteredRows = filter
    ? rows.filter(row =>
        Object.values(row).some(v =>
          String(v).toLowerCase().includes(filter.toLowerCase())
        )
      )
    : rows;

  // Apply sorting
  const sortedRows = sortColumn
    ? [...filteredRows].sort((a, b) => {
        const aVal = a[sortColumn];
        const bVal = b[sortColumn];
        const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return sortDirection === 'asc' ? comparison : -comparison;
      })
    : filteredRows;

  const renderHeader = () => (
    <Box>
      {columns.map((col, i) => (
        <Box key={col.key} width={col.width || '20%'}>
          <Text color="cyan" bold>
            {col.label}
            {sortColumn === col.key && (
              <Text color="yellow">
                {sortDirection === 'asc' ? ' ↑' : ' ↓'}
              </Text>
            )}
          </Text>
        </Box>
      ))}
    </Box>
  );

  const renderRow = (row, index) => {
    const isSelected = index === selectedRow;

    return (
      <Box key={index}>
        {isSelected && <Text color="cyan">▶ </Text>}
        {columns.map(col => (
          <Box key={col.key} width={col.width || '20%'}>
            <Text color={isSelected ? 'yellow' : 'white'}>
              {formatCell(row[col.key], col.format)}
            </Text>
          </Box>
        ))}
      </Box>
    );
  };

  const formatCell = (value, format) => {
    if (!format) return String(value);

    switch (format) {
      case 'number':
        return Number(value).toLocaleString();
      case 'currency':
        return `$${Number(value).toFixed(2)}`;
      case 'percent':
        return `${(Number(value) * 100).toFixed(1)}%`;
      case 'date':
        return new Date(value).toLocaleDateString();
      case 'datetime':
        return new Date(value).toLocaleString();
      default:
        return String(value);
    }
  };

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box
        padding={1}
        borderStyle="round"
        borderColor="blue"
        marginBottom={1}
      >
        <Text color="blue" bold>
          📋 {data.title || 'Table'}
        </Text>
        <Text color="gray"> ({sortedRows.length} rows)</Text>
      </Box>

      {/* Table */}
      <Box flexDirection="column" padding={1}>
        {renderHeader()}
        <Box marginTop={1} marginBottom={1}>
          <Text color="gray">{'─'.repeat(60)}</Text>
        </Box>
        {sortedRows.slice(0, data.pageSize || 20).map(renderRow)}
      </Box>

      {/* Footer */}
      {interactive && (
        <Box padding={1} borderStyle="single" borderColor="gray">
          <Text color="gray">
            ↑↓ Navigate | ←→ Sort Column | S: Toggle Sort | ↵ Select
          </Text>
        </Box>
      )}
    </Box>
  );
};

module.exports = TableTemplate;
```

### 5. Terminal Component

```javascript
// templates/Terminal.jsx
const React = require('react');
const { Box, Text, useInput } = require('ink');
const { useState, useEffect, useRef } = React;

const TerminalTemplate = ({ data, bridge, interactive = true }) => {
  const [output, setOutput] = useState(data.initialOutput || []);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [cursor, setCursor] = useState(0);

  const maxLines = data.maxLines || 100;
  const prompt = data.prompt || '$ ';

  useInput((inputKey, key) => {
    if (!interactive) return;

    if (key.return) {
      executeCommand(input);
      setHistory([...history, input]);
      setInput('');
      setCursor(0);
      setHistoryIndex(-1);
    }

    if (key.upArrow && history.length > 0) {
      const newIndex = historyIndex < history.length - 1
        ? historyIndex + 1
        : historyIndex;
      setHistoryIndex(newIndex);
      setInput(history[history.length - 1 - newIndex]);
      setCursor(history[history.length - 1 - newIndex].length);
    }

    if (key.downArrow && historyIndex > -1) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      if (newIndex === -1) {
        setInput('');
        setCursor(0);
      } else {
        setInput(history[history.length - 1 - newIndex]);
        setCursor(history[history.length - 1 - newIndex].length);
      }
    }

    if (key.leftArrow) {
      setCursor(Math.max(0, cursor - 1));
    }

    if (key.rightArrow) {
      setCursor(Math.min(input.length, cursor + 1));
    }

    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setInput(input.slice(0, cursor - 1) + input.slice(cursor));
        setCursor(cursor - 1);
      }
    }

    if (!key.ctrl && !key.meta && inputKey.length === 1) {
      setInput(input.slice(0, cursor) + inputKey + input.slice(cursor));
      setCursor(cursor + 1);
    }
  });

  const executeCommand = (command) => {
    if (!command.trim()) return;

    // Add command to output
    addOutput(`${prompt}${command}`, 'command');

    // Send command to bridge
    bridge.send({
      type: 'command',
      payload: {
        command: command,
        terminalId: data.id
      }
    });

    // Handle built-in commands
    if (command === 'clear') {
      setOutput([]);
    } else if (command === 'help') {
      addOutput(data.helpText || 'Available commands: help, clear, exit', 'info');
    } else if (command === 'exit') {
      bridge.send({ type: 'command', payload: { command: 'close' } });
    }
  };

  const addOutput = (text, type = 'output') => {
    setOutput(prev => {
      const newOutput = [...prev, { text, type, timestamp: Date.now() }];
      return newOutput.slice(-maxLines);
    });
  };

  // Listen for external output
  useEffect(() => {
    const handleMessage = (msg) => {
      if (msg.type === 'terminal_output') {
        addOutput(msg.payload.text, msg.payload.type);
      }
    };

    bridge.on('message', handleMessage);
    return () => bridge.off('message', handleMessage);
  }, [bridge]);

  const renderOutput = () => {
    return output.map((line, i) => {
      let color = 'white';
      if (line.type === 'error') color = 'red';
      if (line.type === 'success') color = 'green';
      if (line.type === 'info') color = 'cyan';
      if (line.type === 'command') color = 'yellow';

      return (
        <Text key={i} color={color}>
          {line.text}
        </Text>
      );
    });
  };

  const renderInputLine = () => {
    const beforeCursor = input.slice(0, cursor);
    const atCursor = input[cursor] || ' ';
    const afterCursor = input.slice(cursor + 1);

    return (
      <Box>
        <Text color="green">{prompt}</Text>
        <Text>{beforeCursor}</Text>
        <Text backgroundColor="white" color="black">{atCursor}</Text>
        <Text>{afterCursor}</Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box
        padding={1}
        borderStyle="round"
        borderColor="green"
        marginBottom={1}
      >
        <Text color="green" bold>
          💻 {data.title || 'Terminal'}
        </Text>
        {data.subtitle && <Text color="gray"> - {data.subtitle}</Text>}
      </Box>

      {/* Output */}
      <Box
        flexDirection="column"
        height={data.height || 20}
        borderStyle="single"
        borderColor="gray"
        padding={1}
      >
        {renderOutput()}
        {interactive && renderInputLine()}
      </Box>

      {/* Status */}
      {data.showStatus && (
        <Box padding={1}>
          <Text color="gray">
            Lines: {output.length} | History: {history.length}
          </Text>
        </Box>
      )}
    </Box>
  );
};

module.exports = TerminalTemplate;
```

## Template Registry

```javascript
// templates/registry.js
const DashboardTemplate = require('./Dashboard');
const FormTemplate = require('./Form');
const ChartTemplate = require('./Chart');
const TableTemplate = require('./Table');
const TerminalTemplate = require('./Terminal');

class TemplateRegistry {
  constructor() {
    this.templates = new Map();
    this.registerDefaults();
  }

  registerDefaults() {
    this.register('dashboard', DashboardTemplate);
    this.register('form', FormTemplate);
    this.register('chart', ChartTemplate);
    this.register('table', TableTemplate);
    this.register('terminal', TerminalTemplate);
  }

  register(name, component) {
    this.templates.set(name, component);
  }

  get(name) {
    return this.templates.get(name);
  }

  has(name) {
    return this.templates.has(name);
  }

  list() {
    return Array.from(this.templates.keys());
  }

  createComponent(type, props) {
    const Template = this.get(type);
    if (!Template) {
      throw new Error(`Unknown template type: ${type}`);
    }
    return React.createElement(Template, props);
  }
}

module.exports = new TemplateRegistry();
```

## Custom Component Example

```javascript
// Example of creating a custom artifact component
const CustomComponent = ({ data, bridge, interactive }) => {
  const React = require('react');
  const { Box, Text } = require('ink');
  const { useState, useEffect } = React;

  const [state, setState] = useState(data);

  useEffect(() => {
    // Listen for updates
    const handleUpdate = (msg) => {
      if (msg.type === 'data_update') {
        setState(prev => ({ ...prev, ...msg.payload }));
      }
    };

    bridge.on('message', handleUpdate);
    return () => bridge.off('message', handleUpdate);
  }, [bridge]);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta">
      <Text color="magenta" bold>Custom Component</Text>
      <Text>{JSON.stringify(state, null, 2)}</Text>
    </Box>
  );
};

// Register custom component
registry.register('custom-example', CustomComponent);
```

## Usage in Artifact Creation

```javascript
// Using templates in artifact creation
const artifactManager = new ArtifactManager();

// Create dashboard artifact
await artifactManager.createArtifact({
  type: 'dashboard',
  title: 'System Metrics',
  data: {
    title: 'System Dashboard',
    autoRefresh: 5000,
    widgets: [
      {
        id: 'cpu',
        type: 'metric',
        title: 'CPU Usage',
        value: 45.2,
        unit: '%',
        trend: 2.3
      },
      {
        id: 'memory',
        type: 'chart',
        title: 'Memory',
        data: {
          type: 'sparkline',
          values: [50, 52, 48, 55, 60, 58, 62]
        }
      }
    ]
  },
  layout: {
    position: 'right',
    size: '50%'
  },
  interactive: true
});

// Create form artifact
await artifactManager.createArtifact({
  type: 'form',
  title: 'Configuration',
  data: {
    title: 'API Configuration',
    schema: {
      endpoint: {
        label: 'API Endpoint',
        type: 'text',
        required: true,
        pattern: '^https?://',
        placeholder: 'https://api.example.com'
      },
      apiKey: {
        label: 'API Key',
        type: 'text',
        required: true,
        min: 10
      },
      environment: {
        label: 'Environment',
        type: 'select',
        options: [
          { label: 'Development', value: 'dev' },
          { label: 'Staging', value: 'staging' },
          { label: 'Production', value: 'prod' }
        ]
      }
    }
  }
});
```