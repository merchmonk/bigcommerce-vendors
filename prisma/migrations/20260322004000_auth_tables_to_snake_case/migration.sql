ALTER TABLE "storeUsers" RENAME TO "store_users";

ALTER SEQUENCE "storeUsers_id_seq" RENAME TO "store_users_id_seq";

ALTER TABLE "users" RENAME COLUMN "userId" TO "user_id";

ALTER TABLE "stores" RENAME COLUMN "storeHash" TO "store_hash";
ALTER TABLE "stores" RENAME COLUMN "accessToken" TO "access_token";

ALTER TABLE "store_users" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "store_users" RENAME COLUMN "storeHash" TO "store_hash";
ALTER TABLE "store_users" RENAME COLUMN "isAdmin" TO "is_admin";

ALTER INDEX "users_userId_key" RENAME TO "users_user_id_key";
ALTER INDEX "stores_storeHash_key" RENAME TO "stores_store_hash_key";
ALTER INDEX "storeUsers_userId_storeHash_key" RENAME TO "store_users_user_id_store_hash_key";

ALTER TABLE "store_users" RENAME CONSTRAINT "storeUsers_pkey" TO "store_users_pkey";
