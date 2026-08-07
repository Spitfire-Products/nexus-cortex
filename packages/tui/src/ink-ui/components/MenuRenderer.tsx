/**
 * Ink-based Menu Renderer for Nexus Cortex
 *
 * React/Ink component for rendering InteractiveMenuDefinition.
 * Works with any menu definition from the core library.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from '../semantic-colors.js';
import type {
  InteractiveMenuDefinition,
  MenuItem,
  MenuResult
} from '@nexus-cortex/core';
import {
  isToggleItem,
  isSelectItem,
  isNumberItem,
  isTextItem,
  isActionItem,
  isInfoItem,
  shouldLiveUpdate
} from '@nexus-cortex/core';

interface MenuRendererProps {
  /** Menu definition to render */
  definition: InteractiveMenuDefinition;
  /** Initial values for menu items */
  initialValues: Record<string, unknown>;
  /** Callback when menu is completed */
  onComplete: (result: MenuResult) => void;
  /** Optional callback for live updates */
  onLiveUpdate?: (key: string, value: unknown) => Promise<void>;
  /** Whether the component is active/focused */
  isActive?: boolean;
}

interface FlatItem {
  item: MenuItem;
  sectionId: string;
  isSection: boolean;
  sectionTitle?: string;
}

/**
 * Flatten sections into a navigable list
 */
function flattenItems(
  definition: InteractiveMenuDefinition,
  expandedSections: Set<string>
): FlatItem[] {
  const items: FlatItem[] = [];

  for (const section of definition.sections) {
    items.push({
      item: { type: 'info', key: `section_${section.id}`, label: section.title, value: '' },
      sectionId: section.id,
      isSection: true,
      sectionTitle: section.title
    });

    const isExpanded = section.collapsed ? expandedSections.has(section.id) : true;
    if (isExpanded) {
      for (const item of section.items) {
        items.push({ item, sectionId: section.id, isSection: false });
      }
    }
  }

  return items;
}

/**
 * Toggle item component
 */
function ToggleItem({ item, isSelected, value }: {
  item: MenuItem & { type: 'toggle' };
  isSelected: boolean;
  value: boolean;
}) {
  return (
    <Box>
      <Text color={isSelected ? theme.text.primary : theme.text.secondary}>
        {isSelected ? '> ' : ' '}
      </Text>
      <Text color={isSelected ? theme.text.primary : theme.text.secondary}>
        {item.label.padEnd(30)}
      </Text>
      <Text> </Text>
      <Text color={value ? theme.status.success : theme.status.error}>
        [{value ? 'ON' : 'OFF'}]
      </Text>
    </Box>
  );
}

/**
 * Select item component
 */
function SelectItem({ item, isSelected, value }: {
  item: MenuItem & { type: 'select' };
  isSelected: boolean;
  value: string;
}) {
  return (
    <Box>
      <Text color={isSelected ? theme.text.primary : theme.text.secondary}>
        {isSelected ? '> ' : ' '}
      </Text>
      <Text color={isSelected ? theme.text.primary : theme.text.secondary}>
        {item.label.padEnd(30)}
      </Text>
      <Text> </Text>
      <Text color={theme.text.link}>[{value || '(none)'}]</Text>
    </Box>
  );
}

/**
 * Number item component
 */
function NumberItem({ item, isSelected, value, isEditing, editBuffer }: {
  item: MenuItem & { type: 'number' };
  isSelected: boolean;
  value: number;
  isEditing: boolean;
  editBuffer: string;
}) {
  const displayValue = isEditing ? `${editBuffer}_` : String(value);
  return (
    <Box>
      <Text color={isSelected ? theme.text.primary : theme.text.secondary}>
        {isSelected ? '> ' : ' '}
      </Text>
      <Text color={isSelected ? theme.text.primary : theme.text.secondary}>
        {item.label.padEnd(30)}
      </Text>
      <Text> </Text>
      <Text color={isEditing ? theme.status.warning : theme.text.link}>
        [{displayValue}]
      </Text>
    </Box>
  );
}

/**
 * Text item component
 */
function TextItem({ item, isSelected, value, isEditing, editBuffer }: {
  item: MenuItem & { type: 'text' };
  isSelected: boolean;
  value: string;
  isEditing: boolean;
  editBuffer: string;
}) {
  let displayValue: string;
  if (isEditing) {
    displayValue = item.secret ? '*'.repeat(editBuffer.length) + '_' : `${editBuffer}_`;
  } else {
    displayValue = item.secret && value ? '****' : (value || '(empty)');
  }

  return (
    <Box>
      <Text color={isSelected ? theme.text.primary : theme.text.secondary}>
        {isSelected ? '> ' : ' '}
      </Text>
      <Text color={isSelected ? theme.text.primary : theme.text.secondary}>
        {item.label.padEnd(30)}
      </Text>
      <Text> </Text>
      <Text color={isEditing ? theme.status.warning : theme.text.link}>
        [{displayValue}]
      </Text>
    </Box>
  );
}

/**
 * Action item component
 */
function ActionItem({ item, isSelected }: {
  item: MenuItem & { type: 'action' };
  isSelected: boolean;
}) {
  return (
    <Box>
      <Text color={isSelected ? theme.text.primary : theme.text.secondary}>
        {isSelected ? '> ' : ' '}
      </Text>
      <Text color={isSelected ? theme.text.primary : theme.text.secondary}>
        {item.label.padEnd(30)}
      </Text>
      <Text> </Text>
      <Text color={item.destructive ? theme.status.error : theme.text.link}>
        [{item.actionLabel}]
      </Text>
    </Box>
  );
}

/**
 * Info item component
 */
function InfoItem({ item, isSelected }: {
  item: MenuItem & { type: 'info' };
  isSelected: boolean;
}) {
  return (
    <Box>
      <Text color={isSelected ? theme.text.primary : theme.text.secondary}>
        {isSelected ? '> ' : ' '}
      </Text>
      <Text color={theme.text.secondary} dimColor>
        {item.label}
      </Text>
      {item.value && (
        <Text color={theme.text.secondary} dimColor>
          {' '}{item.value}
        </Text>
      )}
    </Box>
  );
}

/**
 * Section header component
 */
function SectionHeader({ title, isExpanded, isSelected }: {
  title: string;
  isExpanded: boolean;
  isSelected: boolean;
}) {
  const icon = isExpanded ? '[-]' : '[+]';
  return (
    <Box>
      <Text color={isSelected ? theme.text.primary : theme.text.secondary}>
        {isSelected ? '> ' : ' '}
      </Text>
      <Text bold color={isSelected ? theme.text.primary : theme.text.secondary}>
        {icon} {title}
      </Text>
    </Box>
  );
}

/**
 * Menu Renderer Component
 */
export function MenuRenderer({
  definition,
  initialValues,
  onComplete,
  onLiveUpdate,
  isActive = true
}: MenuRendererProps): React.JSX.Element {
  const [values, setValues] = useState<Record<string, unknown>>({ ...initialValues });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const section of definition.sections) {
      if (!section.collapsed) {
        set.add(section.id);
      }
    }
    return set;
  });
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState('');

  const flatItems = useMemo(
    () => flattenItems(definition, expandedSections),
    [definition, expandedSections]
  );

  const getChanges = useCallback(() => {
    const changes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (value !== initialValues[key]) {
        changes[key] = value;
      }
    }
    return changes;
  }, [values, initialValues]);

  const handleComplete = useCallback((action: string) => {
    const changes = getChanges();
    onComplete({
      action,
      changes,
      hasChanges: Object.keys(changes).length > 0
    });
  }, [getChanges, onComplete]);

  useInput((input, key) => {
    if (!isActive) return;

    // Handle editing mode
    if (editingItem) {
      if (key.return) {
        const flatItem = flatItems[selectedIndex];
        if (flatItem && !flatItem.isSection) {
          const item = flatItem.item;
          if (isNumberItem(item)) {
            const newValue = parseInt(editBuffer) || (item as any).value;
            setValues(prev => ({ ...prev, [item.key]: newValue }));
            if (shouldLiveUpdate(item) && onLiveUpdate) {
              onLiveUpdate(item.key, newValue);
            }
          } else if (isTextItem(item)) {
            setValues(prev => ({ ...prev, [item.key]: editBuffer }));
            if (shouldLiveUpdate(item) && onLiveUpdate) {
              onLiveUpdate(item.key, editBuffer);
            }
          }
        }
        setEditingItem(null);
        setEditBuffer('');
        return;
      }

      if (key.escape) {
        setEditingItem(null);
        setEditBuffer('');
        return;
      }

      if (key.backspace || key.delete) {
        setEditBuffer(prev => prev.slice(0, -1));
        return;
      }

      if (input && input.length === 1 && input.charCodeAt(0) >= 32) {
        setEditBuffer(prev => prev + input);
        return;
      }

      return;
    }

    // Navigation
    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => Math.min(flatItems.length - 1, prev + 1));
      return;
    }

    // Tab - next section
    if (key.tab) {
      for (let i = selectedIndex + 1; i < flatItems.length; i++) {
        if (flatItems[i]?.isSection) {
          setSelectedIndex(i);
          break;
        }
      }
      return;
    }

    // Space or Enter - interact
    if (input === ' ' || key.return) {
      const current = flatItems[selectedIndex];
      if (!current) return;

      // Toggle section
      if (current.isSection) {
        setExpandedSections(prev => {
          const newSet = new Set(prev);
          if (newSet.has(current.sectionId)) {
            newSet.delete(current.sectionId);
          } else {
            newSet.add(current.sectionId);
          }
          return newSet;
        });
        return;
      }

      const item = current.item;

      // Toggle boolean
      if (isToggleItem(item)) {
        const newValue = !values[item.key];
        setValues(prev => ({ ...prev, [item.key]: newValue }));
        if (shouldLiveUpdate(item) && onLiveUpdate) {
          onLiveUpdate(item.key, newValue);
        }
        return;
      }

      // Cycle select
      if (isSelectItem(item)) {
        const currentValue = values[item.key] as string;
        const currentIdx = item.choices.findIndex(c => c.value === currentValue);
        const nextIdx = (currentIdx + 1) % item.choices.length;
        const newValue = item.choices[nextIdx]?.value || currentValue;
        setValues(prev => ({ ...prev, [item.key]: newValue }));
        if (shouldLiveUpdate(item) && onLiveUpdate) {
          onLiveUpdate(item.key, newValue);
        }
        return;
      }

      // Edit number/text
      if (isNumberItem(item) || isTextItem(item)) {
        setEditingItem(item.key);
        setEditBuffer(String(values[item.key] || ''));
        return;
      }

      // Action
      if (isActionItem(item)) {
        handleComplete(item.key);
        return;
      }

      return;
    }

    // Save - s/S key
    if (input === 's' || input === 'S') {
      handleComplete('save');
      return;
    }

    // Reset
    if (input === 'r' || input === 'R') {
      handleComplete('reset');
      return;
    }

    // Cancel
    if (key.escape || input === 'q' || input === 'Q') {
      handleComplete('cancel');
      return;
    }
  }, { isActive });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border.default}
      paddingX={1}
      paddingY={1}
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color={theme.text.primary}>
          {definition.icon || '#'} {definition.title}
        </Text>
      </Box>

      {definition.description && (
        <Box marginBottom={1}>
          <Text color={theme.text.secondary}>{definition.description}</Text>
        </Box>
      )}

      {/* Items */}
      {flatItems.map((flatItem, index) => {
        const isSelected = index === selectedIndex;

        if (flatItem.isSection) {
          const section = definition.sections.find(s => s.id === flatItem.sectionId);
          const isExpanded = section?.collapsed ? expandedSections.has(flatItem.sectionId) : true;
          return (
            <Box key={flatItem.item.key} marginY={1}>
              <SectionHeader
                title={flatItem.sectionTitle || ''}
                isExpanded={isExpanded}
                isSelected={isSelected}
              />
            </Box>
          );
        }

        const item = flatItem.item;
        const currentValue = values[item.key] !== undefined ? values[item.key] : (item as any).value;
        const isEditing = editingItem === item.key;

        return (
          <Box key={item.key} flexDirection="column">
            <Box>
              {isToggleItem(item) && (
                <ToggleItem item={item} isSelected={isSelected} value={currentValue as boolean} />
              )}
              {isSelectItem(item) && (
                <SelectItem item={item} isSelected={isSelected} value={currentValue as string} />
              )}
              {isNumberItem(item) && (
                <NumberItem
                  item={item}
                  isSelected={isSelected}
                  value={currentValue as number}
                  isEditing={isEditing}
                  editBuffer={editBuffer}
                />
              )}
              {isTextItem(item) && (
                <TextItem
                  item={item}
                  isSelected={isSelected}
                  value={currentValue as string}
                  isEditing={isEditing}
                  editBuffer={editBuffer}
                />
              )}
              {isActionItem(item) && (
                <ActionItem item={item} isSelected={isSelected} />
              )}
              {isInfoItem(item) && (
                <InfoItem item={item} isSelected={isSelected} />
              )}
            </Box>
            {isSelected && item.description && (
              <Box paddingLeft={4}>
                <Text color={theme.text.secondary} dimColor>
                  {item.description}
                </Text>
              </Box>
            )}
          </Box>
        );
      })}

      {/* Footer */}
      <Box marginTop={1} borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} borderColor={theme.border.default}>
        <Text color={theme.text.secondary}>
          {definition.actions.map(a => `${a.shortcut}: ${a.label}`).join(' | ')}
        </Text>
      </Box>

      {definition.footer && (
        <Box>
          <Text color={theme.text.secondary} dimColor>
            {definition.footer}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export default MenuRenderer;
