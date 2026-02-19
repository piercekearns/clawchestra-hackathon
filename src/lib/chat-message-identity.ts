import {
  normalizeChatContentForMatch,
  unwrapGatewayContextWrappedUserContent,
} from './chat-normalization';

export interface IdentityMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  _id?: string;
}

export function unwrapUserContentForDisplay(message: IdentityMessage): string {
  if (message.role !== 'user') return message.content;
  return unwrapGatewayContextWrappedUserContent(message.content) ?? message.content;
}

export function normalizeMessageIdentityContent(message: IdentityMessage): string {
  return normalizeChatContentForMatch(unwrapUserContentForDisplay(message));
}

export function messageIdentitySignature(message: IdentityMessage): string {
  return `${message.role}:${normalizeMessageIdentityContent(message)}`;
}

export function isLikelyDuplicateMessage(
  existing: IdentityMessage,
  incoming: IdentityMessage,
  windowMs: number,
): boolean {
  if (existing.role !== incoming.role) return false;

  const existingNorm = normalizeMessageIdentityContent(existing);
  const incomingNorm = normalizeMessageIdentityContent(incoming);
  if (!existingNorm || !incomingNorm) return false;

  const existingTs = existing.timestamp ?? 0;
  const incomingTs = incoming.timestamp ?? 0;
  if (Math.abs(existingTs - incomingTs) > windowMs) return false;

  if (existing.role === 'user') {
    // User turns dedupe only on exact normalized match.
    return existingNorm === incomingNorm;
  }

  return (
    existingNorm === incomingNorm ||
    incomingNorm.startsWith(existingNorm) ||
    existingNorm.startsWith(incomingNorm)
  );
}
