CREATE TABLE "favorites" (
	"user_id" integer NOT NULL,
	"title_id" integer NOT NULL,
	"added_at" timestamp DEFAULT now(),
	CONSTRAINT "favorites_user_id_title_id_pk" PRIMARY KEY("user_id","title_id")
);
--> statement-breakpoint
CREATE TABLE "genres" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	CONSTRAINT "genres_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" serial PRIMARY KEY NOT NULL,
	"imdb_id" varchar(20) NOT NULL,
	"name" varchar(255) NOT NULL,
	CONSTRAINT "people_imdb_id_unique" UNIQUE("imdb_id")
);
--> statement-breakpoint
CREATE TABLE "title_cast" (
	"title_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	"character" varchar(500),
	"ord" smallint NOT NULL,
	CONSTRAINT "title_cast_title_id_ord_pk" PRIMARY KEY("title_id","ord")
);
--> statement-breakpoint
CREATE TABLE "title_genres" (
	"title_id" integer NOT NULL,
	"genre_id" integer NOT NULL,
	CONSTRAINT "title_genres_title_id_genre_id_pk" PRIMARY KEY("title_id","genre_id")
);
--> statement-breakpoint
CREATE TABLE "titles" (
	"id" serial PRIMARY KEY NOT NULL,
	"imdb_id" varchar(20) NOT NULL,
	"type" varchar(10) NOT NULL,
	"title" varchar(500) NOT NULL,
	"year" smallint NOT NULL,
	"end_year" smallint,
	"director" varchar(255),
	"description" text,
	"rating" numeric(3, 1) NOT NULL,
	"num_votes" integer NOT NULL,
	"seasons_count" smallint,
	"episodes_count" integer,
	"poster_url" varchar(1000),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "titles_imdb_id_unique" UNIQUE("imdb_id"),
	CONSTRAINT "titles_type_check" CHECK ("titles"."type" IN ('movie', 'series'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title_cast" ADD CONSTRAINT "title_cast_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title_cast" ADD CONSTRAINT "title_cast_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title_genres" ADD CONSTRAINT "title_genres_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title_genres" ADD CONSTRAINT "title_genres_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "title_cast_person_id_idx" ON "title_cast" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "title_genres_genre_id_idx" ON "title_genres" USING btree ("genre_id");--> statement-breakpoint
CREATE INDEX "titles_year_idx" ON "titles" USING btree ("year");--> statement-breakpoint
CREATE INDEX "titles_type_idx" ON "titles" USING btree ("type");--> statement-breakpoint
CREATE INDEX "titles_rating_idx" ON "titles" USING btree ("rating");--> statement-breakpoint
DO $$
BEGIN
	-- Best-effort: enable pg_trgm (backs the gin_trgm_ops index). On managed
	-- Postgres (e.g. Nile) where the role can't CREATE EXTENSION, skip silently;
	-- ILIKE search still works without the GIN acceleration.
	BEGIN
		CREATE EXTENSION IF NOT EXISTS pg_trgm;
	EXCEPTION WHEN OTHERS THEN
		RAISE NOTICE 'pg_trgm not enabled (%); skipping trigram index', SQLERRM;
	END;

	-- Create the trigram index only when the opclass is available, so a missing
	-- extension can never abort the migration.
	IF EXISTS (SELECT 1 FROM pg_opclass WHERE opcname = 'gin_trgm_ops') THEN
		CREATE INDEX IF NOT EXISTS "titles_title_gin_idx" ON "titles" USING gin ("title" gin_trgm_ops);
	END IF;
END
$$;