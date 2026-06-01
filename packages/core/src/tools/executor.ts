/**
 * Tool Executor — dispatches tool_call objects to registered tools.
 * Never throws. All errors are returned as structured JSON strings.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */

import { ToolRegistry } from "./registry.ts";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string from model
}

export class ToolExecutor {
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  /**
   * Execute a tool call. Never throws — all errors are returned as JSON strings.
   */
  async execute(toolCall: ToolCall): Promise<string> {
    // Check if tool exists
    const tool = this.registry.get(toolCall.name);
    if (!tool) {
      return JSON.stringify({ error: "tool_not_found", tool: toolCall.name });
    }

    // Parse arguments
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.arguments);
    } catch (e) {
      return JSON.stringify({
        error: "malformed_arguments",
        tool: toolCall.name,
        message:
          e instanceof Error ? e.message : "Failed to parse arguments JSON",
      });
    }

    // Execute the tool
    try {
      return await tool.execute(args);
    } catch (e) {
      return JSON.stringify({
        error: "execution_failed",
        tool: toolCall.name,
        message: e instanceof Error ? e.message : "Tool execution failed",
      });
    }
  }
}
