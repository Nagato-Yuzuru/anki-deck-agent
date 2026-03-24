PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_card_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`prompt_template` text NOT NULL,
	`response_json_schema` text NOT NULL,
	`anki_note_type` text NOT NULL,
	`anki_fields_mapping` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_card_templates`("id", "name", "prompt_template", "response_json_schema", "anki_note_type", "anki_fields_mapping", "is_active", "created_at") SELECT "id", "name", "prompt_template", "response_json_schema", "anki_note_type", "anki_fields_mapping", "is_active", "created_at" FROM `card_templates`;--> statement-breakpoint
DROP TABLE `card_templates`;--> statement-breakpoint
ALTER TABLE `__new_card_templates` RENAME TO `card_templates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `card_templates_name_unique` ON `card_templates` (`name`);--> statement-breakpoint
CREATE TABLE `__new_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submission_id` integer NOT NULL,
	`word` text NOT NULL,
	`sentence` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`llm_response_json` text,
	`audio_r2_key` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_cards`("id", "submission_id", "word", "sentence", "status", "llm_response_json", "audio_r2_key", "error_message", "created_at", "updated_at") SELECT "id", "submission_id", "word", "sentence", "status", "llm_response_json", "audio_r2_key", "error_message", "created_at", "updated_at" FROM `cards`;--> statement-breakpoint
DROP TABLE `cards`;--> statement-breakpoint
ALTER TABLE `__new_cards` RENAME TO `cards`;--> statement-breakpoint
CREATE TABLE `__new_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`template_id` integer NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`telegram_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `card_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_submissions`("id", "user_id", "template_id", "chat_id", "message_id", "status", "error_message", "created_at", "updated_at") SELECT "id", "user_id", "template_id", "chat_id", "message_id", "status", "error_message", "created_at", "updated_at" FROM `submissions`;--> statement-breakpoint
DROP TABLE `submissions`;--> statement-breakpoint
ALTER TABLE `__new_submissions` RENAME TO `submissions`;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`telegram_id` integer PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`language_code` text,
	`active_template_id` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`active_template_id`) REFERENCES `card_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_users`("telegram_id", "first_name", "language_code", "active_template_id", "created_at") SELECT "telegram_id", "first_name", "language_code", NULL AS "active_template_id", "created_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;
