import { z } from 'zod';
export type Risk = 'READ' | 'WRITE' | 'EXECUTE' | 'SENSITIVE';
export interface Capability {
  name: string;
  risk: Risk;
  description: string;
  schema: z.ZodObject<any>;
}
export interface Device {
  id: string;
  type: string;
  capabilities: string[];
  online: boolean;
  lastSeen: number;
}
export interface Session {
  id: string;
  client: string;
  preferredDevice?: string;
}
export interface ExecutionRequest {
  id: string;
  session: string;
  capability: string;
  args: Record<string, any>;
  timeoutMs: number;
}
export interface ExecutionResult {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
  durationMs?: number;
}
export type PermissionPolicy = Record<string, 'allow' | 'required' | 'deny'>;
export class Fault extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const failure = (e: unknown): ExecutionResult => ({
  ok: false,
  error: {
    code: e instanceof Fault ? e.code : 'EXECUTION_FAILED',
    message: e instanceof Error ? e.message : String(e),
  },
});
