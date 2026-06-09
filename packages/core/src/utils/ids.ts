import { randomUUID } from 'crypto';

export function generateId(prefix: string = ''): string {
  return `${prefix}${randomUUID()}`;
}

export function generateToolId(): string {
  return generateId('toolu_');
}

export function generateSessionId(): string {
  return generateId('session_');
}

export function generateMessageId(): string {
  return generateId('msg_');
}