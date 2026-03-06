export type ChatConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'error' | 'disconnected';

export interface ChatAttachment {
  id: string;
  name: string;
  mediaType: string;
  dataUrl: string;
  size: number;
}

let attachmentIdCounter = 0;
export function createAttachmentId(): string {
  return `attachment-${Date.now()}-${++attachmentIdCounter}`;
}

export interface ChatSendPayload {
  text: string;
  images: ChatAttachment[];
}

export interface ChatPrefillRequest {
  id: string;
  text: string;
}

// Queued message waiting to be sent
export interface QueuedMessage {
  id: string;
  text: string;
  attachments: ChatAttachment[];
  queuedAt: number;
  attemptCount: number;
  status: 'queued' | 'failed';
  lastError?: string;
}

let queueIdCounter = 0;
export function createQueueId(): string {
  return `queued-${Date.now()}-${++queueIdCounter}`;
}
