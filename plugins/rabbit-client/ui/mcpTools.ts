// MCP tool catalogue for this plugin — bundled with it, not with the
// platform. Registered once (mcp_register_tools) when this plugin's own
// mcpBridge.ts mounts its `mcp:call` listener, so devtool-mcp-server.rs's
// dynamic `list_tools()` (no compiled-in tool list of its own — see that
// file's own comment) can advertise these to an MCP client without knowing
// this plugin exists at compile time. Kept in sync BY HAND with the
// `rabbit_*` handlers in ./mcpBridge.ts — one JSON-Schema entry per tool
// name that file's `buildHandlers()` answers.
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const RABBIT_MCP_TOOLS: McpToolDef[] = [
  {
            "name": "rabbit_list_connections",
            "description": "List every saved RabbitMQ connection profile (id, name, host, port, vhost, username, password, useTls, amqpPort, amqpOnly, and optional TLS/heartbeat/extraHosts fields). Values are returned as stored, unmasked, same as the app's own connection form.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "rabbit_get_connection",
            "description": "Get one saved RabbitMQ connection profile by id.",
            "inputSchema": { "type": "object", "properties": { "connectionId": { "type": "string" } }, "required": ["connectionId"] }
        },
        {
            "name": "rabbit_add_connection",
            "description": "Save a new RabbitMQ connection profile and return it (with its generated id). `name`/`host` required; `port` defaults to 15672 (management), `vhost` to \"/\", `username`/`password` to \"guest\", `amqpPort` to 5672, `amqpOnly` to true (no management HTTP API — AMQP-only topology probes).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "host": { "type": "string" },
                    "port": { "type": "number", "description": "Management API port." },
                    "vhost": { "type": "string" },
                    "username": { "type": "string" },
                    "password": { "type": "string" },
                    "useTls": { "type": "boolean" },
                    "amqpPort": { "type": "number" },
                    "amqpOnly": { "type": "boolean" }
                },
                "required": ["name"]
            }
        },
        {
            "name": "rabbit_update_connection",
            "description": "Patch a saved RabbitMQ connection profile. `patch` is a partial object — only included fields change.",
            "inputSchema": {
                "type": "object",
                "properties": { "connectionId": { "type": "string" }, "patch": { "type": "object" } },
                "required": ["connectionId", "patch"]
            }
        },
        {
            "name": "rabbit_delete_connection",
            "description": "Delete a saved RabbitMQ connection profile by id. The broker itself is unaffected — only the local saved profile.",
            "inputSchema": { "type": "object", "properties": { "connectionId": { "type": "string" } }, "required": ["connectionId"] }
        },
        {
            "name": "rabbit_test_connection",
            "description": "Verify a saved connection is reachable over AMQP (and the management API too, unless amqpOnly), without marking it as the connected one.",
            "inputSchema": { "type": "object", "properties": { "connectionId": { "type": "string" } }, "required": ["connectionId"] }
        },
        {
            "name": "rabbit_connect",
            "description": "Test and mark a saved connection as the active one in the RabbitMQ Client UI (same as pressing Connect). Stops any live consumers still running against a previously-connected connection, since only one connection is live at a time.",
            "inputSchema": { "type": "object", "properties": { "connectionId": { "type": "string" } }, "required": ["connectionId"] }
        },
        {
            "name": "rabbit_disconnect",
            "description": "Clear the active RabbitMQ connection (same as pressing Disconnect) and stop any live consumers running against it.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "rabbit_connection_status",
            "description": "Get the currently selected/connected RabbitMQ connection id.",
            "inputSchema": { "type": "object", "properties": {} }
        },
];
