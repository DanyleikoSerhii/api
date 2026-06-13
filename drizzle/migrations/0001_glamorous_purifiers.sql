ALTER TABLE "users" ADD COLUMN "nickname" varchar(50);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_name" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_nickname_lower_idx" ON "users" USING btree (lower("nickname"));