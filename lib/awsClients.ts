import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { RUMClient } from '@aws-sdk/client-rum';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';

function resolveRegion(): string {
  return process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
}

let cloudWatchLogsClient: CloudWatchLogsClient | null = null;
let eventBridgeClient: EventBridgeClient | null = null;
let rumClient: RUMClient | null = null;
let s3Client: S3Client | null = null;
let sqsClient: SQSClient | null = null;

export function getCloudWatchLogsClient(): CloudWatchLogsClient {
  if (!cloudWatchLogsClient) {
    cloudWatchLogsClient = new CloudWatchLogsClient({ region: resolveRegion() });
  }
  return cloudWatchLogsClient;
}

export function getEventBridgeClient(): EventBridgeClient {
  if (!eventBridgeClient) {
    eventBridgeClient = new EventBridgeClient({ region: resolveRegion() });
  }
  return eventBridgeClient;
}

export function getRumClient(): RUMClient {
  if (!rumClient) {
    rumClient = new RUMClient({ region: resolveRegion() });
  }
  return rumClient;
}

export function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: resolveRegion() });
  }
  return s3Client;
}

export function getSqsClient(): SQSClient {
  if (!sqsClient) {
    sqsClient = new SQSClient({ region: resolveRegion() });
  }
  return sqsClient;
}
