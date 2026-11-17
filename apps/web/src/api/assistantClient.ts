/**
 * Single import point for the assistant client (T-045).
 *
 * UI code imports ONLY from this module. To switch from the temporary stub to
 * Coder's real client, change the one line below to:
 *
 *   export * from "./assistant.js";
 *
 * Coder's module must export the same names as the stub: askAssistant,
 * AssistantError, and types AssistantScope / AssistantResponse /
 * AssistantEvidence / AssistantErrorCode (see assistant.stub.ts header).
 */
export * from "./assistant.stub.js";
