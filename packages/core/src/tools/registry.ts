/**
 * Tool Registry — stores tool definitions and exposes them in OpenAI format.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
  execute(args: Record<string, unknown>): Promise<string>;
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /**
   * Register a tool definition. Throws if a tool with the same name already exists.
   */
  register(def: ToolDefinition): void {
    if (this.tools.has(def.name)) {
      throw new Error(
        `Tool "${def.name}" is already registered. Cannot overwrite existing tools.`
      );
    }
    this.tools.set(def.name, def);
  }

  /**
   * Get a tool definition by name. Returns null if not found.
   */
  get(name: string): ToolDefinition | null {
    return this.tools.get(name) ?? null;
  }

  /**
   * Returns tool definitions in the OpenAI tools format.
   */
  toOpenAITools(): OpenAITool[] {
    const result: OpenAITool[] = [];
    for (const def of this.tools.values()) {
      result.push({
        type: "function",
        function: {
          name: def.name,
          description: def.description,
          parameters: def.parameters,
        },
      });
    }
    return result;
  }

  /**
   * Returns the names of all registered tools.
   */
  list(): string[] {
    return Array.from(this.tools.keys());
  }
}
