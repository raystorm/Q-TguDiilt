export interface ExecuteOptions {
   context?:   string;
   sessionId?: string;
   model?:     string;
}

export function validateExecuteArgs(command: string, options: ExecuteOptions = {}): void {
   if (null === command || undefined === command || '' === command.trim())
   { throw new Error('command is required and must be a non-empty string'); }
   if (options.model !== undefined && '' === options.model)
   { throw new Error('options.model must be a non-empty string when provided'); }
}
