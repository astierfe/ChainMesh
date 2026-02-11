/**
 * ElizaOS framework types for the ChainMesh plugin.
 *
 * These are minimal type definitions matching the ElizaOS action interface.
 * The actual ElizaOS framework provides these at runtime.
 */

export interface Memory {
  content: {
    text: string;
    [key: string]: unknown;
  };
}

export interface State {
  [key: string]: unknown;
}

export interface HandlerCallback {
  (response: { text: string; data?: Record<string, unknown> }): Promise<void>;
}

export interface ActionHandler {
  (
    message: Memory,
    state: State,
    callback: HandlerCallback,
  ): Promise<boolean>;
}

export interface ActionValidator {
  (message: Memory, state: State): Promise<boolean>;
}

export interface Action {
  name: string;
  description: string;
  examples: string[][];
  handler: ActionHandler;
  validate: ActionValidator;
}

export interface Plugin {
  name: string;
  description: string;
  actions: Action[];
}
