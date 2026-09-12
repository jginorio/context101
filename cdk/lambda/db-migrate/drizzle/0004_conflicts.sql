CREATE TYPE "public"."conflict_status" AS ENUM('pending', 'applying', 'accepted', 'rejected');
--> statement-breakpoint
CREATE TABLE "conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"brain_id" text NOT NULL,
	"status" "conflict_status" DEFAULT 'pending' NOT NULL,
	"fingerprint" text NOT NULL,
	"topic" text NOT NULL,
	"title" text NOT NULL,
	"rationale" text,
	"left_side" jsonb NOT NULL,
	"right_side" jsonb NOT NULL,
	"proposed_loser_body" jsonb NOT NULL,
	"resolution" jsonb,
	"apply_record" jsonb,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"last_detected_via" text NOT NULL,
	"last_error" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conflict_pins" (
	"org_id" text NOT NULL,
	"brain_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"outcome" text NOT NULL,
	"left_key" text NOT NULL,
	"right_key" text NOT NULL,
	"topic" text NOT NULL,
	"hashes" jsonb NOT NULL,
	"github_blob_shas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conflict_id" uuid NOT NULL,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conflict_pins_brain_id_fingerprint_pk" PRIMARY KEY("brain_id","fingerprint")
);
--> statement-breakpoint
CREATE TABLE "conflict_doc_hashes" (
	"org_id" text NOT NULL,
	"brain_id" text NOT NULL,
	"key" text NOT NULL,
	"canonical_hash" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conflict_doc_hashes_brain_id_key_pk" PRIMARY KEY("brain_id","key")
);
--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_brain_id_brains_id_fk" FOREIGN KEY ("brain_id") REFERENCES "public"."brains"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conflict_pins" ADD CONSTRAINT "conflict_pins_brain_id_brains_id_fk" FOREIGN KEY ("brain_id") REFERENCES "public"."brains"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conflict_pins" ADD CONSTRAINT "conflict_pins_conflict_id_conflicts_id_fk" FOREIGN KEY ("conflict_id") REFERENCES "public"."conflicts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conflict_doc_hashes" ADD CONSTRAINT "conflict_doc_hashes_brain_id_brains_id_fk" FOREIGN KEY ("brain_id") REFERENCES "public"."brains"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "conflicts_open_fingerprint" ON "conflicts" USING btree ("org_id","brain_id","fingerprint") WHERE "conflicts"."status" in ('pending', 'applying');
--> statement-breakpoint
CREATE INDEX "conflicts_brain_status_idx" ON "conflicts" USING btree ("brain_id","status","created_at");
--> statement-breakpoint
CREATE INDEX "conflicts_org_status_idx" ON "conflicts" USING btree ("org_id","status");
--> statement-breakpoint
CREATE INDEX "conflict_pins_org_idx" ON "conflict_pins" USING btree ("org_id");
--> statement-breakpoint
CREATE INDEX "conflict_doc_hashes_org_idx" ON "conflict_doc_hashes" USING btree ("org_id");
--> statement-breakpoint
ALTER TABLE "conflicts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "conflict_pins" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "conflict_doc_hashes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation_conflicts" ON "conflicts"
  USING ("org_id" = current_setting('app.org_id', true));
--> statement-breakpoint
CREATE POLICY "tenant_isolation_conflict_pins" ON "conflict_pins"
  USING ("org_id" = current_setting('app.org_id', true));
--> statement-breakpoint
CREATE POLICY "tenant_isolation_conflict_doc_hashes" ON "conflict_doc_hashes"
  USING ("org_id" = current_setting('app.org_id', true));
