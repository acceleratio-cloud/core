CREATE TABLE "image_version_check" (
	"image" text PRIMARY KEY NOT NULL,
	"candidate_tag" varchar(128),
	"candidate_digest" varchar(80),
	"error" text,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
