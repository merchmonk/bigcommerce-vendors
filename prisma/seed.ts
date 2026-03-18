import { Prisma, PrismaClient } from '@prisma/client';
import { PROMOSTANDARDS_SEED_RECORDS } from './seeds/promostandards';

const prisma = new PrismaClient();

async function seedPromoStandardsMappings(): Promise<void> {
  for (const record of PROMOSTANDARDS_SEED_RECORDS) {
    const structureJson = record.structure_json as Prisma.InputJsonValue;
    const requestSchema = record.request_schema as Prisma.InputJsonValue;
    const responseSchema = record.response_schema as Prisma.InputJsonValue;
    const transformSchema = record.transform_schema as Prisma.InputJsonValue;
    const metadata = record.metadata as Prisma.InputJsonValue;

    await prisma.endpointMapping.upsert({
      where: {
        standard_type_endpoint_name_endpoint_version_operation_name: {
          standard_type: record.standard_type,
          endpoint_name: record.endpoint_name,
          endpoint_version: record.endpoint_version,
          operation_name: record.operation_name,
        },
      },
      update: {
        protocol: record.protocol,
        payload_format: record.payload_format,
        is_product_endpoint: record.is_product_endpoint,
        structure_json: structureJson,
        structure_xml: record.structure_xml,
        request_schema: requestSchema,
        response_schema: responseSchema,
        transform_schema: transformSchema,
        metadata,
        updated_at: new Date(),
      },
      create: {
        standard_type: record.standard_type,
        endpoint_name: record.endpoint_name,
        endpoint_version: record.endpoint_version,
        operation_name: record.operation_name,
        protocol: record.protocol,
        payload_format: record.payload_format,
        is_product_endpoint: record.is_product_endpoint,
        structure_json: structureJson,
        structure_xml: record.structure_xml,
        request_schema: requestSchema,
        response_schema: responseSchema,
        transform_schema: transformSchema,
        metadata,
      },
    });
  }
}

async function main(): Promise<void> {
  await seedPromoStandardsMappings();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async error => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
