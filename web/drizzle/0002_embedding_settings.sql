ALTER TABLE "brains" ADD COLUMN "embedding_model_provider" text;--> statement-breakpoint
ALTER TABLE "brains" ADD COLUMN "embedding_model_id" text;--> statement-breakpoint
ALTER TABLE "brains" ADD COLUMN "embedding_model_arn" text;--> statement-breakpoint
ALTER TABLE "brains" ADD COLUMN "embedding_dimensions" integer;--> statement-breakpoint
ALTER TABLE "brains" ADD COLUMN "embedding_chunking" jsonb;--> statement-breakpoint
ALTER TABLE "brains" ADD COLUMN "source_brain_id" text;--> statement-breakpoint
ALTER TABLE "brains" ADD COLUMN "replaced_by_brain_id" text;--> statement-breakpoint
UPDATE "brains" SET
  "embedding_model_provider" = 'aws',
  "embedding_model_id" = 'amazon.titan-embed-text-v2:0',
  "embedding_dimensions" = 1024,
  "embedding_chunking" = '{"strategy":"default"}'::jsonb
WHERE "embedding_model_provider" IS NULL;