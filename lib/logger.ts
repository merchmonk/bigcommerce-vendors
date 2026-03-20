import {
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  PutLogEventsCommand,
  ResourceAlreadyExistsException,
} from '@aws-sdk/client-cloudwatch-logs';
import { hostname } from 'node:os';
import { getCloudWatchLogsClient } from './awsClients';
import { getRequestContext } from './requestContext';
import { ensureRecord, redactValue, serializeError } from './telemetry';

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  service: string;
  environment: string;
  correlation_id?: string;
  request_id?: string;
  vendor_id?: number;
  integration_job_id?: number;
  order_integration_state_id?: number;
  sync_run_id?: number;
  method?: string;
  path?: string;
  source?: string;
  meta?: Record<string, unknown>;
}

const ensuredLogGroups = new Set<string>();
const ensuredLogStreams = new Set<string>();
const sequenceTokens = new Map<string, string>();

function getStructuredLogGroupName(): string | undefined {
  return process.env.STRUCTURED_LOG_GROUP_NAME ?? process.env.CLOUDWATCH_LOG_GROUP_NAME;
}

function getStructuredLogStreamName(): string {
  return (
    process.env.STRUCTURED_LOG_STREAM_NAME ??
    process.env.AWS_LAMBDA_LOG_STREAM_NAME ??
    `${hostname()}-${process.pid}`
  );
}

async function ensureCloudWatchTransport(logGroupName: string, logStreamName: string): Promise<void> {
  const client = getCloudWatchLogsClient();
  if (!ensuredLogGroups.has(logGroupName)) {
    try {
      await client.send(new CreateLogGroupCommand({ logGroupName }));
    } catch (error) {
      if (!(error instanceof ResourceAlreadyExistsException)) {
        throw error;
      }
    }
    ensuredLogGroups.add(logGroupName);
  }

  const streamKey = `${logGroupName}:${logStreamName}`;
  if (!ensuredLogStreams.has(streamKey)) {
    try {
      await client.send(new CreateLogStreamCommand({ logGroupName, logStreamName }));
    } catch (error) {
      if (!(error instanceof ResourceAlreadyExistsException)) {
        throw error;
      }
    }
    ensuredLogStreams.add(streamKey);
  }
}

async function writeStructuredLog(serializedEntry: string): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const logGroupName = getStructuredLogGroupName();
  if (!logGroupName) {
    return;
  }

  const logStreamName = getStructuredLogStreamName();
  const streamKey = `${logGroupName}:${logStreamName}`;
  const client = getCloudWatchLogsClient();

  await ensureCloudWatchTransport(logGroupName, logStreamName);

  const sequenceToken = sequenceTokens.get(streamKey);
  const response = await client.send(
    new PutLogEventsCommand({
      logGroupName,
      logStreamName,
      sequenceToken,
      logEvents: [
        {
          message: serializedEntry,
          timestamp: Date.now(),
        },
      ],
    }),
  );

  if (response.nextSequenceToken) {
    sequenceTokens.set(streamKey, response.nextSequenceToken);
  }
}

function writeConsole(level: LogLevel, serializedEntry: string): void {
  if (level === 'error') {
    console.error(serializedEntry);
    return;
  }
  if (level === 'warn') {
    console.warn(serializedEntry);
    return;
  }
  console.log(serializedEntry);
}

function buildLogEntry(level: LogLevel, message: string, meta?: Record<string, unknown>): LogEntry {
  const context = getRequestContext();
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    service: 'bigcommerce-vendors',
    environment: process.env.NODE_ENV ?? 'development',
    correlation_id: context?.correlationId,
    request_id: context?.requestId,
    vendor_id: context?.vendorId,
    integration_job_id: context?.integrationJobId,
    order_integration_state_id: context?.orderIntegrationStateId,
    sync_run_id: context?.syncRunId,
    method: context?.method,
    path: context?.path,
    source: context?.source,
    ...(meta && Object.keys(meta).length > 0 ? { meta: ensureRecord(meta) } : {}),
  };
}

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry = buildLogEntry(level, message, meta);
  const serializedEntry = JSON.stringify(redactValue(entry));
  writeConsole(level, serializedEntry);
  void writeStructuredLog(serializedEntry).catch(error => {
    const fallback = JSON.stringify({
      level: 'warn',
      message: 'structured log transport error',
      timestamp: new Date().toISOString(),
      meta: serializeError(error),
    });
    console.warn(fallback);
  });
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    emit('info', message, meta);
  },
  warn(message: string, meta?: Record<string, unknown>) {
    emit('warn', message, meta);
  },
  error(message: string, meta?: Record<string, unknown>) {
    emit('error', message, meta);
  },
};

export default logger;
