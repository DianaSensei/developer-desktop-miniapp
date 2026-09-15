import type { PluginSdk } from '@/platform';

export interface BrokerConfig {
  id: string;
  name: string;
  bootstrapServers: string;
  saslMechanism?: string;
  saslUsername?: string;
  saslPassword?: string;
  sslEnabled: boolean;
}

export interface TopicSummary {
  name: string;
  partitionCount: number;
  replicationFactor: number;
}

export interface PartitionInfo {
  id: number;
  leader: number;
  earliestOffset: number;
  latestOffset: number;
}

export interface GroupLag {
  groupId: string;
  partition: number;
  committedOffset: number;
  lag: number;
}

export interface TopicDetails {
  name: string;
  partitions: PartitionInfo[];
  replicationFactor: number;
}

export interface TopicConfig {
  name: string;
  value: string | null;
}

export interface GroupSummary {
  groupId: string;
  state: string;
  protocolType: string;
}

export interface Assignment {
  topic: string;
  partition: number;
  committedOffset: number;
  lag: number;
  // The consumer currently assigned this partition, if the group is active.
  clientId?: string | null;
  clientHost?: string | null;
  memberId?: string | null;
}

export interface GroupMember {
  memberId: string;
  clientId: string;
  clientHost: string;
}

export interface GroupDetails {
  groupId: string;
  state: string;
  memberCount: number;
  members: GroupMember[];
  assignments: Assignment[];
}

export interface BatchRecord {
  key: string | null;
  value: string;
  headers?: Record<string, string>;
}

export interface ProduceResult {
  partition: number;
  offset: number;
}

export interface KafkaMessage {
  offset: number;
  partition: number;
  timestamp: string;
  key: string | null;
  value: string | null;
  headers: Record<string, string>;
}

/** A record streamed by the realtime (anonymous) consumer. */
export interface KafkaConsumedMessage {
  partition: number;
  offset: number;
  timestamp: string;
  key: string | null;
  /** UTF-8 value when decodable, else null. */
  value: string | null;
  /** Raw value bytes, base64 (null when the record had no value) — used for the hex view. */
  valueB64: string | null;
  headers: Record<string, string>;
}

export type ConsumeFrom = 'latest' | 'earliest';

// ── Invoke wrappers ───────────────────────────────────────────────────────────

/**
 * Lớp lệnh Kafka, dựng theo `sdk.service` (Tier B — sidecar `devtool-svc-kafka`)
 * thay vì gọi thẳng `invoke`. Nhờ vậy allowlist `service.methods` trong manifest
 * có hiệu lực thật — một method gõ sai hay ngoài danh sách bị chặn ngay và ghi
 * vào nhật ký, thay vì lặng lẽ đi thẳng xuống sidecar.
 *
 * Dùng qua `useKafkaApi()` (xem api_sdk.ts); factory để lộ ra đây chỉ cho test
 * và cho code không phải React.
 */
export function createKafkaApi(sdk: PluginSdk) {
  const call = <T,>(method: string, params?: Record<string, unknown>) =>
    sdk.service.call<T>(method, params);

  return {
    listConfigs: () => call<BrokerConfig[]>('list-configs'),
    saveConfig: (config: BrokerConfig) => call<BrokerConfig>('save-config', { config }),
    deleteConfig: (configId: string) => call<void>('delete-config', { configId }),
    testConnection: (configId: string) => call<void>('test-connection', { configId }),

    listTopics: (configId: string) => call<TopicSummary[]>('list-topics', { configId }),

    topicDetails: (configId: string, topic: string) =>
      call<TopicDetails>('topic-details', { configId, topic }),

    // On-demand only (Consumers tab) — scans groups, so never call on topic open.
    topicConsumerGroups: (configId: string, topic: string) =>
      call<GroupLag[]>('topic-consumer-groups', { configId, topic }),

    createTopic: (configId: string, name: string, numPartitions: number, replicationFactor: number) =>
      call<void>('create-topic', { configId, name, numPartitions, replicationFactor }),

    listGroups: (configId: string) => call<GroupSummary[]>('list-groups', { configId }),

    groupDetails: (configId: string, groupId: string) =>
      call<GroupDetails>('group-details', { configId, groupId }),

    produce: (configId: string, topic: string, partition: number | null, key: string | null, value: string, headers: Record<string, string>) =>
      call<ProduceResult>('produce', { configId, topic, partition, key, value, headers }),

    produceBatch: (configId: string, topic: string, partition: number | null, records: BatchRecord[]) =>
      call<number[]>('produce-batch', { configId, topic, partition, records }),

    fetchMessages: (configId: string, topic: string, partition: number, offset: number, limit: number, startTimestamp?: number | null) =>
      call<KafkaMessage[]>('fetch-messages', { configId, topic, partition, offset, limit, startTimestamp: startTimestamp ?? null }),

    deleteTopic: (configId: string, name: string) => call<void>('delete-topic', { configId, name }),

    topicConfigs: (configId: string, topic: string) =>
      call<TopicConfig[]>('topic-configs', { configId, topic }),

    /**
     * Start a realtime anonymous consumer over all partitions via the
     * sidecar's STREAM method `consume-start` — same shape as
     * redis-client's `pubsubSubscribe`: the first event carries
     * `{ type: 'started', consumerId }` (an id the sidecar generates
     * internally, distinct from the JSONL request id), every following
     * event carries `{ type: 'message', message }` and is forwarded to
     * `onMessage`. Never resolves with `done: true` on its own — call
     * `.stop()` to end it.
     *
     * A start-time failure (topic missing, connection refused/timeout) is
     * sent by the sidecar as a THIRD event shape, `{ type: 'error',
     * message }` — deliberately NOT as a protocol-level
     * `ServiceResponse.error`, because `service_host.rs`'s `dispatch()`
     * silently drops an `error` response routed to a Stream waiter. This
     * promise properly WAITS for either `started` or `error` before
     * settling.
     *
     * `.stop()` does the two mandatory steps in order: (1) tell the sidecar
     * to actually stop the per-partition poll loops via the one-shot
     * `consume-stop` method (only if a `consumerId` was received), THEN
     * (2) stop the host-side stream registration
     * (`ServiceSubscription.stop()`).
     */
    consumeStart: async (
      args: { configId: string; topic: string; from: ConsumeFrom },
      onMessage: (msg: KafkaConsumedMessage) => void,
    ): Promise<{ stop(): Promise<void> }> => {
      let consumerId: string | null = null;
      let settleReady: (() => void) | null = null;
      let settleFailed: ((e: Error) => void) | null = null;
      const ready = new Promise<void>((resolve, reject) => {
        settleReady = resolve;
        settleFailed = reject;
      });

      const subscription = await sdk.service.stream<{
        type: string;
        consumerId?: string;
        message?: KafkaConsumedMessage;
        errorMessage?: string;
      }>(
        'consume-start',
        (event) => {
          if (event.type === 'started') {
            consumerId = event.consumerId ?? null;
            settleReady?.();
            return;
          }
          if (event.type === 'error') {
            settleFailed?.(new Error(event.errorMessage ?? 'Consume failed'));
            return;
          }
          if (event.type === 'message' && event.message) {
            onMessage(event.message);
          }
        },
        { configId: args.configId, topic: args.topic, from: args.from },
      );

      try {
        await ready;
      } catch (e) {
        // Đăng ký phía host đã lỡ mở (sdk.service.stream ở trên thành công) —
        // dọn nó đi trước khi báo lỗi lên, không để lại một stream mồ côi
        // không ai còn đọc.
        await subscription.stop().catch(() => {});
        throw e;
      }

      return {
        async stop() {
          if (consumerId) {
            await call<void>('consume-stop', { consumerId }).catch(() => {});
          }
          await subscription.stop();
        },
      };
    },
  };
}

export type KafkaApi = ReturnType<typeof createKafkaApi>;
