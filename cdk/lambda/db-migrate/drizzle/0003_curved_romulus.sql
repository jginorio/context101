CREATE TABLE "github_app_installations" (
	"installation_id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"repository_selection" text NOT NULL,
	"settings_url" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "github_app_installations_org_idx" ON "github_app_installations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "github_app_installations_org_account_idx" ON "github_app_installations" USING btree ("org_id","account_login");--> statement-breakpoint
ALTER TABLE "github_app_installations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation_github_app_installations" ON "github_app_installations"
  USING ("org_id" = current_setting('app.org_id', true));