CREATE TYPE "public"."brain_status" AS ENUM('provisioning', 'ready', 'error', 'deleting');--> statement-breakpoint
CREATE TYPE "public"."mcp_token_role" AS ENUM('read', 'read_suggest', 'admin');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('pending_auth', 'syncing', 'connected', 'error', 'paused');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('sheets', 'docs', 'slides', 'notion', 'github', 'manual');--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"org_id" text NOT NULL,
	"brain_id" text,
	"actor_id" text,
	"actor_kind" text NOT NULL,
	"action" text NOT NULL,
	"target_kind" text,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brains" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"system_prompt" text,
	"status" "brain_status" DEFAULT 'provisioning' NOT NULL,
	"error_msg" text,
	"kb_id" text,
	"ds_id" text,
	"docs_bucket" text,
	"vector_index_arn" text,
	"token_secret_arn" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"brain_id" text NOT NULL,
	"type" "source_type" NOT NULL,
	"label" text NOT NULL,
	"external_url" text,
	"external_id" text,
	"status" "source_status" DEFAULT 'pending_auth' NOT NULL,
	"token_secret_arn" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"item_count" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"brain_id" text NOT NULL,
	"hashed_token" text NOT NULL,
	"prefix" text NOT NULL,
	"role" "mcp_token_role" DEFAULT 'read_suggest' NOT NULL,
	"label" text,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_tokens_hashed_token_unique" UNIQUE("hashed_token")
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"brain_id" text NOT NULL,
	"status" "suggestion_status" DEFAULT 'pending' NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"target_path" text,
	"final_path" text,
	"rationale" text,
	"trigger" text,
	"proposed_by" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_metrics" (
	"org_id" text NOT NULL,
	"date" date NOT NULL,
	"metric" text NOT NULL,
	"value" bigint NOT NULL,
	CONSTRAINT "usage_metrics_org_id_date_metric_pk" PRIMARY KEY("org_id","date","metric")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_brain_id_brains_id_fk" FOREIGN KEY ("brain_id") REFERENCES "public"."brains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_brain_id_brains_id_fk" FOREIGN KEY ("brain_id") REFERENCES "public"."brains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_brain_id_brains_id_fk" FOREIGN KEY ("brain_id") REFERENCES "public"."brains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "audit_org_time_idx" ON "audit_log" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "brains_org_id_id_idx" ON "brains" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "brains_org_status_idx" ON "brains" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "connectors_brain_idx" ON "connectors" USING btree ("brain_id");--> statement-breakpoint
CREATE INDEX "connectors_org_status_idx" ON "connectors" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "mcp_tokens_brain_active_idx" ON "mcp_tokens" USING btree ("brain_id");--> statement-breakpoint
CREATE INDEX "mcp_tokens_lookup_idx" ON "mcp_tokens" USING btree ("hashed_token");--> statement-breakpoint
CREATE INDEX "suggestions_brain_status_idx" ON "suggestions" USING btree ("brain_id","status","created_at");--> statement-breakpoint
CREATE INDEX "suggestions_org_status_idx" ON "suggestions" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "usage_metrics_org_date_idx" ON "usage_metrics" USING btree ("org_id","date");
--> statement-breakpoint
ALTER TABLE "brains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suggestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connectors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usage_metrics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation_brains" ON "brains"
  USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation_suggestions" ON "suggestions"
  USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation_connectors" ON "connectors"
  USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation_mcp_tokens" ON "mcp_tokens"
  USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation_audit_log" ON "audit_log"
  USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation_usage_metrics" ON "usage_metrics"
  USING ("org_id" = current_setting('app.org_id', true));