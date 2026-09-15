// MCP tool catalogue for this plugin — bundled with it, not with the
// platform. Registered once (mcp_register_tools) when this plugin's own
// mcpBridge.ts mounts its `mcp:call` listener, so devtool-mcp-server.rs's
// dynamic `list_tools()` (no compiled-in tool list of its own — see that
// file's own comment) can advertise these to an MCP client without knowing
// this plugin exists at compile time. Kept in sync BY HAND with the
// `kafka_*` handlers in ./mcpBridge.ts — one JSON-Schema entry per tool
// name that file's `buildHandlers()` answers.
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const KAFKA_MCP_TOOLS: McpToolDef[] = [
  {
            "name": "kafka_list_connections",
            "description": "List every saved Kafka broker profile (id, name, bootstrapServers, saslMechanism, saslUsername, saslPassword, sslEnabled). Values are returned as stored, unmasked, same as the app's own connection form.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "kafka_get_connection",
            "description": "Get one saved Kafka broker profile by id.",
            "inputSchema": { "type": "object", "properties": { "connectionId": { "type": "string" } }, "required": ["connectionId"] }
        },
        {
            "name": "kafka_add_connection",
            "description": "Save a new Kafka broker profile and return it (with its generated id). `name`/`bootstrapServers` required; `sslEnabled` defaults to false.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "bootstrapServers": { "type": "string", "description": "Comma-separated host:port list." },
                    "saslMechanism": { "type": "string" },
                    "saslUsername": { "type": "string" },
                    "saslPassword": { "type": "string" },
                    "sslEnabled": { "type": "boolean" }
                },
                "required": ["name", "bootstrapServers"]
            }
        },
        {
            "name": "kafka_update_connection",
            "description": "Patch a saved Kafka broker profile. `patch` is a partial object — only included fields change.",
            "inputSchema": {
                "type": "object",
                "properties": { "connectionId": { "type": "string" }, "patch": { "type": "object" } },
                "required": ["connectionId", "patch"]
            }
        },
        {
            "name": "kafka_delete_connection",
            "description": "Delete a saved Kafka broker profile by id. The broker itself is unaffected — only the local saved profile.",
            "inputSchema": { "type": "object", "properties": { "connectionId": { "type": "string" } }, "required": ["connectionId"] }
        },
        {
            "name": "kafka_test_connection",
            "description": "Verify a saved broker is reachable, without marking it as the connected one.",
            "inputSchema": { "type": "object", "properties": { "connectionId": { "type": "string" } }, "required": ["connectionId"] }
        },
        {
            "name": "kafka_connect",
            "description": "Test and mark a saved broker as the active one in the Kafka Explorer UI (same as pressing Connect). Stops any realtime consumers still running against a previously-connected broker, since only one broker is live at a time.",
            "inputSchema": { "type": "object", "properties": { "connectionId": { "type": "string" } }, "required": ["connectionId"] }
        },
        {
            "name": "kafka_disconnect",
            "description": "Clear the active Kafka broker (same as pressing Disconnect) and stop any realtime consumers running against it.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "kafka_connection_status",
            "description": "Get the currently selected/connected Kafka broker id.",
            "inputSchema": { "type": "object", "properties": {} }
        },

];
