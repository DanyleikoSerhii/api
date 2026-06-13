ALTER TABLE "titles" ADD COLUMN "backdrop_url" varchar(1000);--> statement-breakpoint
ALTER TABLE "titles" ADD COLUMN "tmdb_id" integer;--> statement-breakpoint
ALTER TABLE "titles" ADD COLUMN "trailer_key" varchar(20);